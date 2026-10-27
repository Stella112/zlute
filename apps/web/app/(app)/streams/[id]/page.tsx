'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, get, idemKey, post, type ActionResponse, type Stream } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useMe } from '@/components/AppShell';
import { AuthorizePanel } from '@/components/AuthorizePanel';
import { zec, when } from '@/lib/format';
import { Button, Card, ErrorNote, PageTitle, State, Txid } from '@/components/ui';

/** Display-only estimate between server reads, using the same floor(total*active/duration) rule. */
function estimate(s: Stream, offset: number): bigint {
  if (s.status !== 'ACTIVE') return BigInt(s.accrued_zat);
  const now = Math.floor(Date.now() / 1000) - offset;
  const extra = BigInt(Math.max(0, Math.min(now, s.end_ts) - s.server_time)) * BigInt(s.rate_zat_per_s);
  const v = BigInt(s.accrued_zat) + extra;
  return v > BigInt(s.contracted_zat) ? BigInt(s.contracted_zat) : v;
}

export default function StreamDetail() {
  const { id } = useParams<{ id: string }>();
  const me = useMe()!;
  const st = useLoad(() => get<Stream>(`/v1/streams/${id}`), [id]);
  const [offset, setOffset] = useState(0);
  const [, tick] = useState(0);
  const [pending, setPending] = useState<ActionResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = st.data;

  useEffect(() => {
    if (s) setOffset(Math.floor(Date.now() / 1000) - s.server_time);
  }, [s]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    const r = setInterval(() => void st.reload(), 15000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [st.reload]);

  async function act(kind: 'pause' | 'resume' | 'cancel' | 'refresh' | 'settle') {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'settle') {
        const r = await post<ActionResponse>(`/v1/streams/${id}/settle`, {}, { 'idempotency-key': idemKey('web-settle') });
        if (r.result.state === 'AWAITING_AUTHORIZATION') setPending(r);
        else setError(`Settlement ${r.result.state}${'reasons' in r.result && r.result.reasons ? `: ${r.result.reasons.join(', ')}` : ''}${'reason' in r.result && r.result.reason ? `: ${r.result.reason}` : ''}`);
      } else {
        st.setData(await post<Stream>(`/v1/streams/${id}/${kind}`));
      }
      if (kind !== 'refresh') await st.reload();
    } catch (e) {
      setError(e instanceof ApiError ? (e.code === 'BELOW_MIN_PAYOUT' ? 'Not enough is due yet for a payout (minimum not reached).' : e.code) : 'Request failed');
    } finally {
      setBusy(null);
    }
  }

  if (!s) return <p className="text-sm text-muted">{st.error ? `Unavailable (${st.error})` : 'Loading…'}</p>;
  const live = estimate(s, offset);
  const pct = Number((live * 1000n) / BigInt(s.contracted_zat)) / 10;
  const open = s.status === 'ACTIVE' || s.status === 'PAUSED' || s.status === 'SCHEDULED';

  return (
    <>
      <PageTitle title={`Stream ${s.id.slice(0, 10)}…`} sub={s.labels.model} />
      <Card className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs text-muted">Earned so far · {s.labels.accrued.toLowerCase()}</p>
            <p className="font-display num mt-1 text-4xl">
              {zec(live)} <span className="text-base font-normal text-muted">/ {zec(s.contracted_zat)} ZEC</span>
            </p>
            <p className="num mt-1 text-xs text-muted">
              {s.rate_zat_per_s} zat/s · {when(s.start_ts)} → {when(s.end_ts)}
            </p>
          </div>
          <State s={s.status} />
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-raised">
          <div className="h-full bg-accent transition-[width] duration-1000" style={{ width: `${pct}%` }} />
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ['Contracted', s.contracted_zat],
            ['Pending (in flight)', s.pending_zat],
            ['Paid (confirmed)', s.confirmed_paid_zat],
            ['Outstanding (server)', s.outstanding_zat],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="num mt-0.5 text-lg">{zec(v!)}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button disabled={!!busy || !!pending || BigInt(s.outstanding_zat) <= 0n} onClick={() => act('settle')}>
            {busy === 'settle' ? 'Preparing payout…' : 'Pay what is due'}
          </Button>
          {BigInt(s.outstanding_zat) > 0n && (
            <p className="w-full text-xs text-muted">
              Payout {zec(s.outstanding_zat)} ZEC + network fee about 0.0001 ZEC (exact fee shown before you confirm). Each payout is one shielded payment, so fewer, larger payouts cost less.
            </p>
          )}
          <Button variant="ghost" disabled={!!busy} onClick={() => act('refresh')}>
            {busy === 'refresh' ? 'Checking…' : 'Check confirmations'}
          </Button>
          {s.status === 'ACTIVE' && (
            <Button variant="ghost" disabled={!!busy} onClick={() => act('pause')}>
              Pause
            </Button>
          )}
          {s.status === 'PAUSED' && (
            <Button variant="ghost" disabled={!!busy} onClick={() => act('resume')}>
              Resume
            </Button>
          )}
          {open && (
            <Button variant="danger" disabled={!!busy} onClick={() => act('cancel')}>
              Cancel stream
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-muted">The counter ticks locally between reads; the server value (refreshed every 15 s) is authoritative.</p>
        <div className="mt-3">
          <ErrorNote error={error} />
        </div>
      </Card>

      {pending && pending.result.state === 'AWAITING_AUTHORIZATION' && 'summary' in pending.result && (
        <div className="mb-6">
          <AuthorizePanel
            actionId={pending.action_id}
            result={pending.result}
            network={me.network}
            onDone={() => {
              setPending(null);
              void st.reload();
            }}
          />
        </div>
      )}

      <Card title="Settlements">
        {s.settlements.length === 0 ? (
          <p className="text-sm text-muted">No payouts yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {s.settlements.map((x) => (
              <li key={x.seq} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 py-2 text-sm">
                <span className="text-muted">#{x.seq}</span>
                <span className="num">{zec(x.amount_zat)} ZEC</span>
                <State s={x.state} />
                {x.txid ? <Txid txid={x.txid} network={me.network} /> : <span className="text-xs text-muted">no transaction</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
