'use client';

import Link from 'next/link';
import { get, type ActionRow, type Balance, type RequestRow } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { zecShort } from '@/lib/format';
import { useMe } from '@/components/AppShell';
import { ActivityList, buildActivity } from '@/components/activity';
import { Icon } from '@/components/icons';

const total = (b: Balance | null) => (b ? BigInt(b.ironwood.total_zat + b.sapling.total_zat + b.orchard.total_zat) : 0n);
const spendable = (b: Balance | null) => (b ? BigInt(b.ironwood.spendable_zat + b.sapling.spendable_zat + b.orchard.spendable_zat) : 0n);

export default function Home() {
  const me = useMe()!;
  const payout = useLoad(() => get<Balance>('/v1/wallets/payout/balance'));
  const merchant = useLoad(() => get<Balance>('/v1/wallets/merchant/balance'));
  const acts = useLoad(() => get<{ actions: ActionRow[] }>('/v1/actions'));
  const reqs = useLoad(() => get<{ requests: RequestRow[] }>('/v1/requests'));

  const loading = payout.loading || merchant.loading;
  const failed = !!(payout.error && merchant.error);
  const avail = spendable(payout.data) + spendable(merchant.data);
  const arriving = total(payout.data) + total(merchant.data) - avail;
  const items = buildActivity(acts.data?.actions ?? [], reqs.data?.requests ?? []).slice(0, 6);

  return (
    <>
      <p className="mb-1 text-sm text-muted">Hi, {me.username}</p>
      <section className="mb-6 rounded-3xl border border-line bg-gradient-to-br from-accent/25 via-surface to-surface p-6 md:p-8">
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Icon name="shield" className="h-4 w-4 text-accent" /> Private balance
        </p>
        <p className="num mt-2 text-5xl font-semibold tracking-tight md:text-6xl">
          {loading ? '…' : failed ? '—' : zecShort(avail)} <span className="text-2xl font-normal text-muted">ZEC</span>
        </p>
        <p className="mt-2 h-5 text-sm text-muted">
          {failed ? 'Your wallet is syncing. Refresh in a moment.' : arriving > 0n ? `+${zecShort(arriving)} ZEC arriving (confirming)` : ''}
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Link href="/receive" className="flex items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-[15px] font-medium text-on-accent hover:bg-accent/90">
            <Icon name="request" /> Request
          </Link>
          <Link href="/send" className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-raised py-3.5 text-[15px] font-medium hover:border-accent">
            <Icon name="pay" /> Pay
          </Link>
        </div>
      </section>

      <section className="mb-6 grid grid-cols-4 gap-2 text-center text-xs">
        {(
          [
            ['/commerce', 'store', 'Checkout'],
            ['/subscriptions', 'repeat', 'Subscribe'],
            ['/groups', 'users', 'Split bill'],
            ['/streams', 'stream', 'Stream'],
          ] as const
        ).map(([href, icon, label]) => (
          <Link key={href} href={href} className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface py-3.5 hover:border-accent">
            <Icon name={icon} className="h-5 w-5 text-accent" />
            {label}
          </Link>
        ))}
      </section>

      <section className="rounded-3xl border border-line bg-surface px-5 py-2">
        <div className="flex items-center justify-between pt-3">
          <h2 className="text-[15px] font-medium">Recent activity</h2>
          <Link href="/activity" className="text-sm text-accent">
            See all
          </Link>
        </div>
        <ActivityList
          items={items}
          network={me.network}
          empty={
            <>
              No payments yet.{' '}
              <Link href="/receive" className="text-accent">
                Request your first payment
              </Link>
            </>
          }
        />
      </section>

      <Link href="/privacy" className="mt-4 flex items-center gap-3 rounded-2xl border border-line px-4 py-3 text-sm text-muted hover:text-text">
        <Icon name="shield" className="h-5 w-5 text-accent" />
        <span className="flex-1">Every payment is shielded. See what is proven and what still leaks.</span>
        <Icon name="chevron" className="h-4 w-4" />
      </Link>
    </>
  );
}
