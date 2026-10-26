'use client';

import { useState } from 'react';
import { ApiError, get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { zec, when } from '@/lib/format';
import { Button, Card, Empty, ErrorNote, Field, PageTitle, StatusBadge, inputCls } from '@/components/ui';

interface Plan {
  id: string;
  name: string;
  amount_zat: string;
  period_s: number;
  grace_s: number;
}
interface Sub {
  id: string;
  subscriber: string;
  plan: Plan;
  status: string;
  period_no: number;
  period_end: number;
  current_invoice: { request_id: string; status: string; share_path: string } | null;
  invoices: number;
  share_path: string;
}

const PERIODS: [string, number][] = [
  ['10 minutes (demo)', 600],
  ['1 day', 86400],
  ['1 week', 7 * 86400],
  ['30 days', 30 * 86400],
];

const SUB_STYLE: Record<string, string> = { ACTIVE: 'PROVEN', DUE: 'PARTIAL', LAPSED: 'BLOCKED', CANCELLED: 'ROADMAP' };

export default function SubscriptionsPage() {
  const plans = useLoad(() => get<{ plans: Plan[] }>('/v1/subscriptions/plans'));
  const subs = useLoad(() => get<{ subscriptions: Sub[] }>('/v1/subscriptions'));
  const [name, setName] = useState('Pro plan');
  const [amount, setAmount] = useState('0.0001');
  const [period, setPeriod] = useState(30 * 86400);
  const [planId, setPlanId] = useState('');
  const [subscriber, setSubscriber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const label = (s: number) => PERIODS.find(([, v]) => v === s)?.[0] ?? `${s} s`;

  return (
    <>
      <PageTitle
        title="Subscriptions"
        sub="Each period, the subscriber gets a fresh shielded invoice and pays it from their own wallet. Lute never pulls funds: there is no auto-debit in shielded Zcash."
      />
      <ErrorNote error={error} />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title="New plan">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                const p = await post<Plan>('/v1/subscriptions/plans', { name, amount_zec: amount.trim(), period_s: period, grace_s: Math.min(3 * 86400, Math.floor(period / 4)) });
                setPlanId(p.id);
                await plans.reload();
              } catch (err) {
                setError(err instanceof ApiError ? err.code : 'Request failed');
              }
            }}
          >
            <Field label="Plan name">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price per period (ZEC)">
                <input className={`${inputCls} num`} value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </Field>
              <Field label="Period" hint="Grace: a quarter of the period (max 3 days).">
                <select className={inputCls} value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
                  {PERIODS.map(([l, v]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Button type="submit">Create plan</Button>
          </form>
        </Card>
        <Card title="Add a subscriber">
          {(plans.data?.plans ?? []).length === 0 ? (
            <Empty>Create a plan first.</Empty>
          ) : (
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setError(null);
                try {
                  await post('/v1/subscriptions', { plan_id: planId || plans.data!.plans[0]!.id, subscriber: subscriber.trim() });
                  setSubscriber('');
                  await subs.reload();
                } catch (err) {
                  setError(err instanceof ApiError ? err.code : 'Request failed');
                }
              }}
            >
              <Field label="Plan">
                <select className={inputCls} value={planId || plans.data!.plans[0]!.id} onChange={(e) => setPlanId(e.target.value)}>
                  {plans.data!.plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {zec(p.amount_zat)} ZEC / {label(p.period_s)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Subscriber (your label, stored encrypted)">
                <input className={inputCls} value={subscriber} onChange={(e) => setSubscriber(e.target.value)} required />
              </Field>
              <Button type="submit">Add subscriber</Button>
            </form>
          )}
        </Card>
      </div>

      <Card title="Subscribers">
        {(subs.data?.subscriptions ?? []).length === 0 ? (
          <Empty>No subscribers yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {subs.data!.subscriptions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p>
                    {s.subscriber} <span className="text-muted">· {s.plan.name}</span>
                  </p>
                  <p className="num text-xs text-muted">
                    period {s.period_no + 1} ends {when(s.period_end)} · {s.invoices} invoice(s)
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span title={s.status}>
                    <StatusBadge status={SUB_STYLE[s.status] ?? s.status} />
                  </span>
                  <span className="text-xs">{s.status.toLowerCase()}</span>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      await navigator.clipboard.writeText(`${window.location.origin}${s.share_path}`);
                    }}
                  >
                    Copy subscriber link
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy === s.id}
                    onClick={async () => {
                      setBusy(s.id);
                      await post(`/v1/subscriptions/${s.id}/refresh`).catch(() => setError('Could not check now.'));
                      await subs.reload();
                      setBusy(null);
                    }}
                  >
                    {busy === s.id ? 'Checking…' : 'Check'}
                  </Button>
                  {s.status !== 'CANCELLED' && (
                    <Button
                      variant="danger"
                      onClick={async () => {
                        await post(`/v1/subscriptions/${s.id}/cancel`);
                        await subs.reload();
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
