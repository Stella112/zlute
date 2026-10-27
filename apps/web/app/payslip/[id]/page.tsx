'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, get } from '@/lib/api';
import { short, zecShort } from '@/lib/format';

interface Payslip {
  label: string;
  amount_zat: string;
  network: string;
  status: 'PAID' | 'CONFIRMING' | 'AWAITING_APPROVAL' | 'NOT_PAID';
  txid: string | null;
}

const STATUS: Record<Payslip['status'], [string, string]> = {
  PAID: ['Paid', 'bg-ok/15 text-ok'],
  CONFIRMING: ['Confirming on the network', 'bg-warn/15 text-warn'],
  AWAITING_APPROVAL: ['Waiting for your employer to approve', 'bg-raised text-muted'],
  NOT_PAID: ['Not paid', 'bg-bad/12 text-bad'],
};

/**
 * Private payslip: one person's line of a payroll, by its unguessable id (also in the memo of
 * their payment). It shows nothing about anyone else on the payroll.
 */
export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ payslip: Payslip; signature?: string; public_key?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    get<{ payslip: Payslip; signature?: string; public_key?: string }>(`/v1/public/payslips/${encodeURIComponent(id)}`)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof ApiError && e.status === 404 ? 'No such payslip.' : 'Unavailable right now.'));
  }, [id]);
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
        <p className="text-xs text-muted">Lute payslip</p>
        {error && <p className="mt-4 text-sm text-bad">{error}</p>}
        {data && (
          <>
            <p className="mt-1 text-lg">{data.payslip.label}</p>
            <p className="font-display num mt-1 text-4xl">{zecShort(data.payslip.amount_zat)} ZEC</p>
            <p className={`mt-3 inline-block rounded-full px-3 py-1 text-sm ${STATUS[data.payslip.status][1]}`}>{STATUS[data.payslip.status][0]}</p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted">Network</dt>
              <dd>{data.payslip.network === 'main' ? 'Zcash mainnet' : data.payslip.network}</dd>
              {data.payslip.txid && (
                <>
                  <dt className="text-muted">Transaction</dt>
                  <dd className="break-all font-mono text-xs">{short(data.payslip.txid, 10)}</dd>
                </>
              )}
              {data.signature && (
                <>
                  <dt className="text-muted">Signed by</dt>
                  <dd className="break-all font-mono text-xs">receipt key {short(data.public_key ?? '', 8)}</dd>
                </>
              )}
            </dl>
            <p className="mt-4 text-xs text-muted">
              This page shows only your line of the payroll. The payment was part of one shielded transaction: others on it cannot see your amount, and you cannot see theirs. Anyone with this
              link sees this page, so share it only if you mean to.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
