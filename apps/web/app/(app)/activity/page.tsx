'use client';

import { get, type ActionRow } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { zec, when } from '@/lib/format';
import { Card, Empty, PageTitle, State, Txid } from '@/components/ui';

export default function ActivityPage() {
  const list = useLoad(() => get<{ actions: ActionRow[] }>('/v1/actions'));
  return (
    <>
      <PageTitle title="Actions" sub="Every spend goes through one engine: LuteGuard, then your signature, then the sidecar. Recipients and memos are stored encrypted and never shown here." />
      <Card>
        {(list.data?.actions ?? []).length === 0 ? (
          <Empty>{list.error ? `Unavailable (${list.error})` : 'No actions yet.'}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 text-right font-medium">Amount (ZEC)</th>
                  <th className="pb-2 pl-4 font-medium">State</th>
                  <th className="pb-2 font-medium">Transaction / reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data!.actions.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2 text-xs text-muted">{when(a.created_at)}</td>
                    <td className="py-2">{a.type.replaceAll('_', ' ').toLowerCase()}</td>
                    <td className="num py-2 text-right">{zec(a.amount_zat)}</td>
                    <td className="py-2 pl-4">
                      <State s={a.state} />
                    </td>
                    <td className="py-2">{a.txid ? <Txid txid={a.txid} network={a.network} /> : a.reject_reason ? <span className="font-mono text-xs text-muted">{a.reject_reason}</span> : null}</td>
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
