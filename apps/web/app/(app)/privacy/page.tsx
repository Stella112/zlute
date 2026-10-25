'use client';

import { get, type PrivacyStatus } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { when } from '@/lib/format';
import { Card, Empty, PageTitle, StatusBadge, Txid } from '@/components/ui';

/**
 * Privacy Center (mandate §19.10). Everything comes from GET /v1/privacy/status, which computes
 * module status from evidence/results.json (real test runs) and stored LuteGuard decisions.
 * Nothing on this page is hardcoded except the light-server disclosure text.
 */
export default function PrivacyCenter() {
  const st = useLoad(() => get<PrivacyStatus>('/v1/privacy/status'));
  const p = st.data;
  if (!p) return <p className="text-sm text-muted">{st.error ? `Unavailable (${st.error})` : 'Loading…'}</p>;

  const limited = p.evidence.filter((e) => e.limits);
  return (
    <>
      <PageTitle title="Privacy Center" sub="Status is computed from the latest test run and on-chain evidence. Only PROVEN is presented as working." />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card title="Last test run">
          {p.run ? (
            <>
              <p className="num text-sm">{p.run.generated_at.replace('T', ' ').slice(0, 19)} UTC</p>
              <p className="mt-1 font-mono text-xs text-muted">
                commit {p.run.commit.slice(0, 10)}
                {p.run.dirty ? ' (uncommitted changes)' : ''}
              </p>
            </>
          ) : (
            <p className="text-sm text-warn">No results: every module is UNTESTED.</p>
          )}
        </Card>
        <Card title="Policy">
          <p className="font-mono text-sm">{p.policy_version}</p>
          <p className="mt-1 text-xs text-muted">Sidecar: LUTE_STRICT / D-002 single pool, zero transparent</p>
        </Card>
        <Card title="LuteGuard decisions (recent)">
          <p className="num text-sm">
            <span className="text-ok">{p.decisions.allow} allow</span> · <span className="text-bad">{p.decisions.deny} deny</span>
          </p>
          <p className="mt-1 text-xs text-muted">Reason codes only; no amounts, addresses or memos.</p>
        </Card>
      </div>

      <Card title="Modules" className="mb-6">
        <ul className="divide-y divide-line">
          {p.modules.map((m) => (
            <li key={m.key} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,2fr)_auto_minmax(0,3fr)] sm:items-center sm:gap-4">
              <div>
                <p className="text-sm">{m.label}</p>
                {m.tests.passed + m.tests.failed > 0 && (
                  <p className="num text-xs text-muted">
                    {m.tests.passed}/{m.tests.passed + m.tests.failed} tests pass
                  </p>
                )}
              </div>
              <StatusBadge status={m.status} />
              <div className="text-xs text-muted">
                {m.reasons.length > 0 && <p>{m.reasons.join(' · ')}</p>}
                {m.failing.length > 0 && <p className="text-bad">{m.failing.slice(0, 3).join(' · ')}</p>}
                {m.evidence.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {m.evidence.map((e) => (
                      <span key={e.id}>
                        {e.id} <span className="uppercase">{e.env}</span>
                        {e.txids.slice(0, 1).map((t) => (
                          <span key={t} className="ml-1">
                            <Txid txid={t} network={e.env === 'mainnet' ? 'main' : 'regtest'} />
                          </span>
                        ))}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title="Recent DENY decisions">
          {p.decisions.recent_denies.length === 0 ? (
            <Empty>No denials recorded.</Empty>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {p.decisions.recent_denies.map((d) => (
                <li key={d.decision_id} className="py-2">
                  <p className="text-xs text-muted">{when(d.evaluated_at)}</p>
                  <p className="font-mono text-xs text-bad">{d.reasons.map((r) => r.reason_code).join(', ')}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Test suites">
          {p.run ? (
            <ul className="divide-y divide-line text-sm">
              {p.run.suites.map((s) => (
                <li key={s.name} className="flex items-center justify-between py-2">
                  <span>
                    {s.name} {s.source && s.source !== 'local' && <span className="text-xs text-muted">({s.source})</span>}
                  </span>
                  <span className={`num text-xs ${s.failed ? 'text-bad' : s.missing ? 'text-warn' : 'text-ok'}`}>{s.missing ? 'not run' : `${s.passed}/${s.passed + s.failed} pass`}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No run recorded.</Empty>
          )}
          <p className="mt-3 text-xs text-muted">External review: {p.run?.reviewed ? `${p.findings.filter((f) => f.status === 'open').length} open finding(s)` : 'not reviewed yet (self-review only)'}.</p>
        </Card>
      </div>

      <Card title="Known limitations" className="mb-6">
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
          <li>
            <span className="text-text">Light server.</span> The wallet syncs from a public lightwalletd server (zec.rocks). It sees the wallet&apos;s IP address and timing, the birthday height,
            and, when Lute checks a specific transaction, that this transaction interests the wallet. It never sees keys, amounts or memos.
          </li>
          <li>
            <span className="text-text">Server-side keys.</span> Lute&apos;s own wallets are hot wallets on the operator&apos;s server (capped at 0.1 ZEC). Spends need the owner&apos;s signature from
            the owner&apos;s laptop. Field encryption protects data at rest; it is not end-to-end.
          </li>
          {limited.map((e) => (
            <li key={e.id}>
              <span className="text-text">{e.id}.</span> {e.limits}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Evidence">
        <ul className="divide-y divide-line text-sm">
          {p.evidence.map((e) => (
            <li key={e.id} className="grid gap-1 py-2 sm:grid-cols-[4rem_5rem_1fr]">
              <span className="font-mono text-xs">{e.id}</span>
              <span className="text-xs uppercase text-muted">{e.env}</span>
              <span>
                {e.claim}
                {e.txids.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-2">
                    {e.txids.map((t) => (
                      <Txid key={t} txid={t} network={e.env === 'mainnet' ? 'main' : 'regtest'} />
                    ))}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
