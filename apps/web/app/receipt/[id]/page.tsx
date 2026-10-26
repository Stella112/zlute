'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, get, post } from '@/lib/api';
import { zec, when, short } from '@/lib/format';

interface Receipt {
  version: string;
  receipt_id: string;
  order_id: string;
  network: string;
  amount_zat: string;
  paid_zat: string;
  txids: string[];
  item_hash: string;
  paid_at: number;
  key_id: string;
}

/**
 * Public receipt. It shows what the merchant signed and checks the signature with the merchant's
 * published receipt key. It contains no address and no item text: only amounts, txids and a hash.
 */
export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ receipt: Receipt; signature: string; public_key: string } | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<{ receipt: Receipt; signature: string; public_key: string }>(`/v1/public/receipts/${encodeURIComponent(id)}`)
      .then(async (d) => {
        setData(d);
        const v = await post<{ valid: boolean }>('/v1/public/receipts/verify', { receipt: d.receipt, signature: d.signature });
        setValid(v.valid);
      })
      .catch((e: unknown) => setError(e instanceof ApiError && e.status === 404 ? 'No such receipt.' : 'Unavailable right now.'));
  }, [id]);

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
        <p className="text-xs text-muted">Lute payment receipt</p>
        {error && <p className="mt-4 text-sm text-bad">{error}</p>}
        {data && (
          <>
            <p className="num mt-1 text-3xl font-semibold">{zec(data.receipt.paid_zat)} ZEC</p>
            <p className={`mt-2 text-sm font-medium ${valid ? 'text-ok' : valid === false ? 'text-bad' : 'text-muted'}`}>
              {valid === null ? 'Checking signature…' : valid ? 'Signature valid: issued by this merchant.' : 'Signature INVALID: do not trust this receipt.'}
            </p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted">Price</dt>
              <dd className="num">{zec(data.receipt.amount_zat)} ZEC</dd>
              <dt className="text-muted">Paid</dt>
              <dd>{when(data.receipt.paid_at)}</dd>
              <dt className="text-muted">Network</dt>
              <dd>{data.receipt.network === 'main' ? 'Zcash mainnet' : data.receipt.network}</dd>
              <dt className="text-muted">Transaction</dt>
              <dd className="break-all font-mono text-xs">{data.receipt.txids.map((t) => short(t, 10)).join(', ')}</dd>
              <dt className="text-muted">Item hash</dt>
              <dd className="break-all font-mono text-xs">{short(data.receipt.item_hash, 10)}</dd>
              <dt className="text-muted">Receipt key</dt>
              <dd className="break-all font-mono text-xs">{short(data.public_key, 10)}</dd>
            </dl>
            <p className="mt-4 text-xs text-muted">The receipt contains no addresses and no item description. The payment itself was a shielded Zcash transaction.</p>
          </>
        )}
      </div>
    </div>
  );
}
