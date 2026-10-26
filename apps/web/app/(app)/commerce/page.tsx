'use client';

import { useState } from 'react';
import { ApiError, get, idemKey, post, type ActionResponse } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useMe } from '@/components/AppShell';
import { AuthorizePanel } from '@/components/AuthorizePanel';
import { zec, when } from '@/lib/format';
import { Button, Card, Empty, ErrorNote, Field, PageTitle, State, Txid, inputCls } from '@/components/ui';

interface Order {
  id: string;
  item: string;
  amount_zat: string;
  status: string;
  received_zat: string;
  txids: string[];
  share_path: string;
  expires_at: number;
  receipt_id: string | null;
  refunded_zat: string;
  refundable_zat: string;
  refunds: { seq: number; action_id: string; amount_zat: string; state: string; txid: string | null; reason: string | null }[];
  created_at: number;
}

function Refund({ order, onDone }: { order: Order; onDone: () => void }) {
  const me = useMe()!;
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState(zec(order.refundable_zat));
  const [key] = useState(() => idemKey('web-refund'));
  const [res, setRes] = useState<ActionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (res && res.result.state === 'AWAITING_AUTHORIZATION' && 'summary' in res.result) {
    return <AuthorizePanel actionId={res.action_id} result={res.result} network={me.network} onDone={onDone} />;
  }
  return (
    <form
      className="mt-3 grid gap-3 rounded-lg border border-line bg-bg p-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          const r = await post<ActionResponse>(`/v1/commerce/orders/${order.id}/refunds`, { to: to.trim(), amount_zec: amount.trim() }, { 'idempotency-key': key });
          if (r.result.state === 'AWAITING_AUTHORIZATION') setRes(r);
          else setError(`${r.result.state}${'reasons' in r.result && r.result.reasons ? `: ${r.result.reasons.join(', ')}` : ''}`);
        } catch (err) {
          setError(err instanceof ApiError ? err.code : 'Request failed');
        }
      }}
    >
      <Field label="Customer's refund address (shielded)" hint="A shielded payment does not reveal its sender, so the customer gives you this.">
        <input className={`${inputCls} font-mono text-xs`} value={to} onChange={(e) => setTo(e.target.value)} required spellCheck={false} />
      </Field>
      <Field label={`Amount (max ${zec(order.refundable_zat)})`}>
        <input className={`${inputCls} num`} value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </Field>
      <Button type="submit">Review refund</Button>
      <div className="sm:col-span-3">
        <ErrorNote error={error} />
      </div>
    </form>
  );
}

export default function CommercePage() {
  const me = useMe()!;
  const list = useLoad(() => get<{ orders: Order[] }>('/v1/commerce/orders'));
  const [item, setItem] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<string | null>(null);

  async function refresh(id: string) {
    setBusy(id);
    try {
      await post(`/v1/commerce/orders/${id}/refresh`);
      await list.reload();
    } catch {
      setError('Could not check this order right now.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageTitle title="Checkout" sub="Sell something: share a checkout link, your customer pays from their wallet and gets a receipt they can verify. You can refund too." />
      <Card title="New order" className="mb-6">
        <form
          className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await post('/v1/commerce/orders', { item: item.trim(), amount_zec: amount.trim() });
              setItem('');
              setAmount('');
              await list.reload();
            } catch (err) {
              setError(err instanceof ApiError ? err.code : 'Request failed');
            }
          }}
        >
          <Field label="Item" hint="Stored encrypted. Receipts carry only a hash of it.">
            <input className={inputCls} value={item} onChange={(e) => setItem(e.target.value)} maxLength={200} required />
          </Field>
          <Field label="Price (ZEC)">
            <input className={`${inputCls} num`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0002" required />
          </Field>
          <Button type="submit">Create checkout</Button>
        </form>
        <div className="mt-3">
          <ErrorNote error={error} />
        </div>
      </Card>

      <Card title="Orders">
        {(list.data?.orders ?? []).length === 0 ? (
          <Empty>{list.error ? `Unavailable (${list.error})` : 'No orders yet.'}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.orders.map((o) => (
              <li key={o.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p>
                      {o.item} <span className="num text-muted">· {zec(o.amount_zat)} ZEC</span>
                    </p>
                    <p className="text-xs text-muted">{when(o.created_at)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <State s={o.status} />
                    {o.txids.map((t) => (
                      <Txid key={t} txid={t} network={me.network} />
                    ))}
                    {o.status !== 'PAID' && (
                      <a href={o.share_path} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-raised">
                        Checkout link
                      </a>
                    )}
                    {o.receipt_id && (
                      <a href={`/receipt/${o.receipt_id}`} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-raised">
                        Receipt
                      </a>
                    )}
                    <Button variant="ghost" disabled={busy === o.id} onClick={() => refresh(o.id)}>
                      {busy === o.id ? 'Checking…' : 'Check'}
                    </Button>
                    {o.status === 'PAID' && BigInt(o.refundable_zat) > 0n && (
                      <Button variant="ghost" onClick={() => setRefunding(refunding === o.id ? null : o.id)}>
                        Refund
                      </Button>
                    )}
                  </div>
                </div>
                {o.refunds.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-muted">
                    {o.refunds.map((r) => (
                      <li key={r.seq} className="flex flex-wrap items-center gap-2">
                        Refund #{r.seq} {zec(r.amount_zat)} ZEC <State s={r.state} />
                        {r.txid && <Txid txid={r.txid} network={me.network} />}
                        {r.reason && <span className="font-mono">{r.reason}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {refunding === o.id && (
                  <Refund
                    order={o}
                    onDone={() => {
                      setRefunding(null);
                      void list.reload();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
