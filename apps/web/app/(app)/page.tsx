'use client';

import Link from 'next/link';
import { get, type ActionRow, type Balance, type PrivacyStatus, type RequestRow, type Stream } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { zec, when } from '@/lib/format';
import { useMe } from '@/components/AppShell';
import { Card, Empty, PageTitle, State, StatusBadge, Txid } from '@/components/ui';

export default function Overview() {
  const me = useMe()!;
  const bal = useLoad(() => get<Balance>('/v1/wallets/payout/balance'));
  const mbal = useLoad(() => get<Balance>('/v1/wallets/merchant/balance'));
  const acts = useLoad(() => get<{ actions: ActionRow[] }>('/v1/actions'));
  const streams = useLoad(() => get<{ streams: Stream[] }>('/v1/streams'));
  const reqs = useLoad(() => get<{ requests: RequestRow[] }>('/v1/requests'));
  const privacy = useLoad(() => get<PrivacyStatus>('/v1/privacy/status'));
  const grants = useLoad(() => get<{ grants: { revoked: boolean; expires_at: number; spent_zat: string }[] }>('/v1/agent/grants'));

  const b = bal.data;
  const shielded = b ? b.ironwood.total_zat + b.sapling.total_zat + b.orchard.total_zat : 0;
  const spendable = b ? b.ironwood.spendable_zat + b.sapling.spendable_zat + b.orchard.spendable_zat : 0;
  const earned = (streams.data?.streams ?? []).reduce((a, s) => a + BigInt(s.confirmed_paid_zat), 0n);
  const active = (streams.data?.streams ?? []).filter((s) => s.status === 'ACTIVE' || s.status === 'PAUSED' || BigInt(s.outstanding_zat) > 0n || BigInt(s.pending_zat) > 0n);
  const openReqs = (reqs.data?.requests ?? []).filter((r) => r.status === 'UNPAID' || r.status === 'PENDING');
  const activeGrants = (grants.data?.grants ?? []).filter((g) => !g.revoked && g.expires_at * 1000 > Date.now());
  const agentSpent = (grants.data?.grants ?? []).reduce((a, g) => a + BigInt(g.spent_zat), 0n);
  const proven = (privacy.data?.modules ?? []).filter((m) => m.status === 'PROVEN').length;
  const blocked = (privacy.data?.modules ?? []).filter((m) => m.status === 'BLOCKED').length;

  return (
    <>
      <PageTitle title="Overview" sub="Every figure here comes from the wallet sidecar or the API database." />

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs text-muted">Payout wallet · shielded balance</p>
            {b ? (
              <>
                <p className="num mt-1 text-3xl font-semibold tracking-tight">
                  {zec(spendable)} <span className="text-base font-normal text-muted">ZEC spendable</span>
                </p>
                <p className="num mt-1 text-sm text-muted">
                  {zec(shielded - spendable)} ZEC pending confirmation · transparent {zec(b.transparent_total_zat)}
                </p>
                {mbal.data && (
                  <p className="num mt-1 text-sm text-muted">
                    Merchant wallet (payments received): {zec(mbal.data.ironwood.total_zat + mbal.data.sapling.total_zat + mbal.data.orchard.total_zat)} ZEC
                  </p>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">{bal.error ? `Wallet unavailable (${bal.error})` : 'Loading…'}</p>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            <dt className="text-muted">Network</dt>
            <dd>{me.network === 'main' ? 'Zcash mainnet' : me.network}</dd>
            <dt className="text-muted">Signer</dt>
            <dd>{me.self_serve ? 'Your approval key, held in this browser' : 'Owner key on your laptop (lute-owner)'}</dd>
            <dt className="text-muted">Wallet sync</dt>
            <dd className="num">{b ? `height ${b.fully_scanned_height.toLocaleString()} / tip ${b.chain_tip_height.toLocaleString()}` : '—'}</dd>
            <dt className="text-muted">Privacy</dt>
            <dd>
              {privacy.data ? (
                <Link href="/privacy" className="text-accent hover:underline">
                  {proven} proven{blocked ? `, ${blocked} blocked` : ''} · single pool, zero transparent
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </dl>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            ['/send', 'Send'],
            ['/receive', 'Receive'],
            ['/receive', 'Request'],
            ['/streams?new=1', 'Start Stream'],
          ].map(([href, label]) => (
            <Link key={label} href={href!} className="rounded-lg border border-line px-3.5 py-2 text-sm hover:border-accent hover:bg-accent-soft">
              {label}
            </Link>
          ))}
        </div>
      </Card>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card title="Stream payouts confirmed">
          <p className="num text-2xl font-semibold">{zec(earned)} ZEC</p>
          <p className="mt-1 text-xs text-muted">Confirmed on chain, not accrual</p>
        </Card>
        <Card title="Open payment requests">
          <p className="num text-2xl font-semibold">{openReqs.length}</p>
          <p className="mt-1 text-xs text-muted">Paid only with ≥ {me.network === 'main' ? 3 : 1} confirmations</p>
        </Card>
        <Card title="Agent budgets">
          <p className="num text-2xl font-semibold">{activeGrants.length} active</p>
          <p className="num mt-1 text-xs text-muted">
            {zec(agentSpent)} ZEC spent by agents inside signed mandates
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Streams" action={<Link href="/streams" className="text-xs text-accent hover:underline">All streams</Link>}>
          {active.length === 0 ? (
            <Empty>No open streams.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {active.slice(0, 5).map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/streams/${s.id}`} className="font-mono text-xs hover:text-accent">
                    {s.id.slice(0, 10)}…
                  </Link>
                  <span className="num text-muted">
                    {zec(s.accrued_zat)} / {zec(s.contracted_zat)}
                  </span>
                  <State s={s.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent activity" action={<Link href="/activity" className="text-xs text-accent hover:underline">All actions</Link>}>
          {(acts.data?.actions ?? []).length === 0 ? (
            <Empty>{acts.error ? `Unavailable (${acts.error})` : 'No actions yet.'}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {acts.data!.actions.slice(0, 6).map((a) => (
                <li key={a.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2 text-sm">
                  <span>
                    {a.type.replaceAll('_', ' ').toLowerCase()} <span className="text-xs text-muted">{when(a.created_at).slice(5, 16)}</span>
                  </span>
                  <span className="num">{zec(a.amount_zat)}</span>
                  {a.txid ? <Txid txid={a.txid} network={a.network} /> : <State s={a.state} />}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Privacy verification" className="lg:col-span-2" action={<Link href="/privacy" className="text-xs text-accent hover:underline">Privacy Center</Link>}>
          {privacy.data ? (
            <div className="flex flex-wrap gap-2">
              {privacy.data.modules.map((m) => (
                <span key={m.key} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-xs">
                  {m.label} <StatusBadge status={m.status} />
                </span>
              ))}
            </div>
          ) : (
            <Empty>{privacy.error ? `Unavailable (${privacy.error})` : 'Loading…'}</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
