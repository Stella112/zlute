'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { zec, when } from '@/lib/format';

interface PublicSub {
  plan: { name: string; amount_zat: string; period_s: number };
  status: 'ACTIVE' | 'DUE' | 'LAPSED' | 'CANCELLED';
  period_no: number;
  period_end: number;
  pay_path: string | null;
}

const TEXT: Record<PublicSub['status'], string> = {
  ACTIVE: 'Active: this period is paid.',
  DUE: 'Payment due for this period.',
  LAPSED: 'Lapsed: this period was not paid in time.',
  CANCELLED: 'Cancelled by the merchant.',
};

/** Subscriber page: status and this period's invoice. Paid from the subscriber's own wallet. */
export default function SubscriberPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<PublicSub | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    post<PublicSub>(`/v1/public/subscriptions/${encodeURIComponent(id)}`)
      .then(setS)
      .catch((e: unknown) => setError(e instanceof ApiError && e.status === 404 ? 'No such subscription.' : 'Unavailable right now.'));
  }, [id]);

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
        <p className="text-xs text-muted">Subscription</p>
        {error && <p className="mt-4 text-sm text-bad">{error}</p>}
        {s && (
          <>
            <p className="mt-1 text-xl font-semibold">{s.plan.name}</p>
            <p className="num text-sm text-muted">{zec(s.plan.amount_zat)} ZEC per period</p>
            <p className={`mt-4 text-sm font-medium ${s.status === 'ACTIVE' ? 'text-ok' : s.status === 'DUE' ? 'text-warn' : 'text-bad'}`}>{TEXT[s.status]}</p>
            <p className="mt-1 text-xs text-muted">
              Period {s.period_no + 1} ends {when(s.period_end)}
            </p>
            {s.pay_path && (
              <a href={s.pay_path} className="mt-5 inline-block rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white">
                Pay this period
              </a>
            )}
            <p className="mt-4 text-xs text-muted">Each period is a separate shielded payment from your own wallet. Nothing is ever taken automatically.</p>
          </>
        )}
      </div>
    </div>
  );
}
