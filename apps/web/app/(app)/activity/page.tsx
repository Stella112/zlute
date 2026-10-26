'use client';

import Link from 'next/link';
import { get, type ActionRow, type RequestRow } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useMe } from '@/components/AppShell';
import { ActivityList, buildActivity } from '@/components/activity';

export default function ActivityPage() {
  const me = useMe()!;
  const acts = useLoad(() => get<{ actions: ActionRow[] }>('/v1/actions'));
  const reqs = useLoad(() => get<{ requests: RequestRow[] }>('/v1/requests'));
  const items = buildActivity(acts.data?.actions ?? [], reqs.data?.requests ?? []);
  return (
    <>
      <h1 className="mb-1 font-display text-[2rem] leading-tight">Activity</h1>
      <p className="mb-6 text-sm text-muted">Payments in and out. Tap a payment to see it on the Zcash explorer.</p>
      <section className="rounded-2xl border border-line bg-surface px-5">
        <ActivityList
          items={items}
          network={me.network}
          empty={
            acts.loading || reqs.loading ? (
              'Loading…'
            ) : (
              <>
                Nothing yet.{' '}
                <Link href="/receive" className="text-accent">
                  Request a payment
                </Link>
              </>
            )
          }
        />
      </section>
    </>
  );
}
