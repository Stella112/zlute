'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ApiError, get, post, type Stream } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { zec } from '@/lib/format';
import { Button, Card, Empty, ErrorNote, Field, PageTitle, State, inputCls } from '@/components/ui';

function NewStream({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [to, setTo] = useState('');
  const [total, setTotal] = useState('');
  const [minutes, setMinutes] = useState('2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Start a stream" className="mb-6">
      <form
        className="grid gap-4 md:grid-cols-[2fr_1fr_1fr]"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const s = await post<Stream>('/v1/streams', { wallet: 'payout', to: to.trim(), total_zec: total.trim(), duration_s: Math.round(Number(minutes) * 60) });
            router.push(`/streams/${s.id}`);
          } catch (err) {
            setError(err instanceof ApiError ? err.code : 'Request failed');
            setBusy(false);
          }
        }}
      >
        <Field label="Recipient (shielded)">
          <input className={`${inputCls} font-mono text-xs`} value={to} onChange={(e) => setTo(e.target.value)} required spellCheck={false} />
        </Field>
        <Field label="Total (ZEC)">
          <input className={`${inputCls} num`} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0.0003" inputMode="decimal" required />
        </Field>
        <Field label="Duration (minutes)">
          <input className={`${inputCls} num`} value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="decimal" required />
        </Field>
        <div className="flex flex-wrap items-center gap-2 md:col-span-3">
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Start stream'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <p className="text-xs text-muted">Payer-controlled, not trustless: earnings accrue per second, and each payout is a shielded transaction you approve.</p>
        </div>
        <div className="md:col-span-3">
          <ErrorNote error={error} />
        </div>
      </form>
    </Card>
  );
}

function StreamsInner() {
  const params = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  const list = useLoad(() => get<{ streams: Stream[] }>('/v1/streams'));
  return (
    <>
      <PageTitle title="Streams" sub="Per-second accrual on the server clock. Earned is accounting; paid means confirmed on chain." />
      {creating ? <NewStream onCancel={() => setCreating(false)} /> : <Button className="mb-6" onClick={() => setCreating(true)}>Start stream</Button>}
      <Card>
        {(list.data?.streams ?? []).length === 0 ? (
          <Empty>{list.error ? `Unavailable (${list.error})` : 'No streams yet.'}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2 font-medium">Stream</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 text-right font-medium">Earned</th>
                  <th className="pb-2 text-right font-medium">Pending</th>
                  <th className="pb-2 text-right font-medium">Paid (confirmed)</th>
                  <th className="pb-2 text-right font-medium">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data!.streams.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2">
                      <Link href={`/streams/${s.id}`} className="font-mono text-xs text-accent hover:underline">
                        {s.id.slice(0, 12)}…
                      </Link>
                    </td>
                    <td className="py-2">
                      <State s={s.status} />
                    </td>
                    <td className="num py-2 text-right">
                      {zec(s.accrued_zat)} / {zec(s.contracted_zat)}
                    </td>
                    <td className="num py-2 text-right">{zec(s.pending_zat)}</td>
                    <td className="num py-2 text-right">{zec(s.confirmed_paid_zat)}</td>
                    <td className="num py-2 text-right">{zec(s.outstanding_zat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export default function StreamsPage() {
  return (
    <Suspense>
      <StreamsInner />
    </Suspense>
  );
}
