'use client';

import { get, type PrivacyStatus } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { Card, PageTitle, StatusBadge } from '@/components/ui';

export default function CrossChain() {
  const st = useLoad(() => get<PrivacyStatus>('/v1/privacy/status'));
  const m = st.data?.modules.find((x) => x.key === 'crosschain');
  return (
    <>
      <PageTitle title="Cross-Chain" sub="Routes into shielded ZEC are classified, not executed." />
      <Card>
        <div className="flex items-center gap-3">
          <p className="text-sm">Route classifier</p>
          {m && <StatusBadge status={m.status} />}
        </div>
        <p className="mt-3 text-sm text-muted">
          A route whose source chain is public is never presented as fully private. Execution is enabled only for a route classified STRICT_PRIVATE_VERIFIED with tests passing. No route meets
          that bar in this build, so nothing can be executed from here.
        </p>
        {m && m.reasons.length > 0 && <p className="mt-3 text-xs text-muted">{m.reasons.join(' · ')}</p>}
      </Card>
    </>
  );
}
