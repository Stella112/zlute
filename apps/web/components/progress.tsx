'use client';

import { zecShort } from '@/lib/format';

export type Progress = 'OPEN' | 'PARTIAL' | 'CONFIRMING' | 'PAID' | 'EXPIRED';

export interface ProgressInfo {
  progress?: Progress;
  amount_zat?: string;
  received_zat?: string;
  seen_zat?: string;
}

/**
 * Payment state for a request, as the payer and the owner see it: Waiting, Partially paid (with how
 * much arrived and what is left), Confirming (the full amount is seen, not yet confirmed), Paid.
 */
export function PaymentProgress({ info, payer }: { info: ProgressInfo | null; payer?: boolean }) {
  const p = info?.progress ?? 'OPEN';
  const seen = BigInt(info?.seen_zat ?? '0');
  const amount = BigInt(info?.amount_zat ?? '0');
  const left = amount > seen ? amount - seen : 0n;
  const style =
    p === 'PAID' ? 'bg-ok/15 text-ok' : p === 'PARTIAL' ? 'bg-bad/12 text-bad' : p === 'CONFIRMING' ? 'bg-warn/15 text-warn' : 'bg-raised text-muted';
  const label =
    p === 'PAID'
      ? 'Paid: received and confirmed'
      : p === 'PARTIAL'
        ? `Partially paid: ${zecShort(seen.toString())} of ${zecShort(amount.toString())} ZEC`
        : p === 'CONFIRMING'
          ? 'Confirming: full amount seen (about 4 min)'
          : p === 'EXPIRED'
            ? 'Expired'
            : payer
              ? 'Waiting for your payment…'
              : 'Waiting for payment…';
  return (
    <div className="mt-4 flex flex-col items-center gap-1.5">
      <p className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${style}`}>
        {p === 'OPEN' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />}
        {label}
      </p>
      {p === 'PARTIAL' && (
        <p className="text-xs text-muted">
          {zecShort(left.toString())} ZEC still to pay{payer ? ', to the same address with the same memo.' : '.'}
        </p>
      )}
    </div>
  );
}
