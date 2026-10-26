'use client';

import Link from 'next/link';
import { useState } from 'react';
import { get, post, type RequestRow } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useMe } from '@/components/AppShell';
import { zec, when } from '@/lib/format';
import { Button, Card, Empty, ErrorNote, PageTitle, State, Txid } from '@/components/ui';

export default function RequestsPage() {
  const me = useMe()!;
  const list = useLoad(() => get<{ requests: RequestRow[] }>('/v1/requests'));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(id: string) {
    setBusy(id);
    setError(null);
    try {
      await post(`/v1/requests/${id}/refresh`);
      await list.reload();
    } catch {
      setError('Could not check this request right now.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageTitle title="Payment requests" sub="Everything you have asked to be paid, and whether it arrived." />
      <ErrorNote error={error} />
      <Card action={<Link href="/receive" className="text-xs text-accent hover:underline">New request</Link>}>
        {(list.data?.requests ?? []).length === 0 ? (
          <Empty>{list.error ? `Unavailable (${list.error})` : 'No requests yet.'}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm [&_td]:whitespace-nowrap [&_td]:pr-4 [&_th]:whitespace-nowrap [&_th]:pr-4">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2 font-medium">Amount</th>
                  <th className="pb-2 font-medium">Received</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Transactions</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data!.requests.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 text-xs text-muted">{when(r.created_at)}</td>
                    <td className="num py-2">{zec(r.amount_zat)}</td>
                    <td className="num py-2">{zec(r.received_zat)}</td>
                    <td className="py-2">
                      <State s={r.status} />
                      {r.matched_by && <span className="ml-2 text-[11px] text-muted">{r.matched_by.replaceAll('_', ' ')}</span>}
                    </td>
                    <td className="space-x-2 py-2">
                      {r.txids.map((t) => (
                        <Txid key={t} txid={t} network={me.network} />
                      ))}
                    </td>
                    <td className="py-2 text-right">
                      {r.status !== 'PAID' && (
                        <Button variant="ghost" disabled={busy === r.id} onClick={() => refresh(r.id)}>
                          {busy === r.id ? 'Checking…' : 'Check'}
                        </Button>
                      )}
                    </td>
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
