'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, get, post } from '@/lib/api';
import { decryptDetails } from '@/lib/fragment';
import { zecShort, when } from '@/lib/format';
import { Qr } from '@/components/Qr';
import { Icon } from '@/components/icons';
import { PaymentProgress, type ProgressInfo } from '@/components/progress';

interface PublicRequest {
  status: 'OPEN' | 'PAID' | 'CLOSED';
  amount_zat: string;
  zip321_uri: string | null;
  details_ciphertext: string | null;
  expires_at: number;
}

type Check = ProgressInfo & { status: string; receipt_id: string | null };

/** Public pay page. Reads the note key from the #fragment only; nothing about the owner is shown. */
export default function PayPage() {
  const { id } = useParams<{ id: string }>();
  const [req, setReq] = useState<PublicRequest | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);

  useEffect(() => {
    const recheck = () =>
      post<Check>(`/v1/public/requests/${encodeURIComponent(id)}/check`)
        .then(setCheck)
        .catch(() => undefined);
    let timer: ReturnType<typeof setInterval> | undefined;
    get<PublicRequest>(`/v1/public/requests/${encodeURIComponent(id)}`)
      .then(async (r) => {
        setReq(r);
        if (r.status === 'PAID') void recheck();
        // While open, check every 20 s so the page turns to "Paid" by itself.
        if (r.status === 'OPEN') timer = setInterval(() => void recheck(), 20000);
        const key = new URLSearchParams(window.location.hash.slice(1)).get('k');
        // The note key never reaches a server (fragments are not sent) and the CSP allows only this
        // site's own scripts and connections. Drop it from the address bar once read, so it does not
        // linger in history or get copied along with the page URL.
        if (key) window.history.replaceState(null, '', window.location.pathname);
        if (r.details_ciphertext && key) setNote(await decryptDetails(r.details_ciphertext, key).catch(() => null));
      })
      .catch((e: unknown) => setError(e instanceof ApiError && e.status === 404 ? 'This payment link does not exist.' : 'This page is unavailable right now.'));
    return () => clearInterval(timer);
  }, [id]);

  const paid = req?.status === 'PAID' || check?.status === 'PAID';

  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-xs font-display text-[1.05em] text-on-accent">L</span>
        Private payment via Lute
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center">
        {error && <p className="py-10 text-sm text-bad">{error}</p>}
        {!req && !error && <p className="py-10 text-sm text-muted">Loading…</p>}
        {req && (
          <>
            <p className="text-sm text-muted">{paid ? 'Paid' : 'Amount to pay'}</p>
            <p className="font-display num mt-1 text-6xl">
              {zecShort(req.amount_zat)} <span className="text-2xl font-normal text-muted">ZEC</span>
            </p>
            {note && <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-raised px-4 py-3 text-left text-sm">{note}</p>}

            {paid ? (
              <>
                <div className="mx-auto my-8 grid h-28 w-28 place-items-center rounded-full bg-ok/15 text-ok">
                  <Icon name="check" className="h-14 w-14" />
                </div>
                <p className="text-sm">Payment received and confirmed. Thank you.</p>
                {check?.receipt_id && (
                  <a className="mt-4 inline-block rounded-2xl border border-line px-4 py-2.5 text-sm text-accent" href={`/receipt/${check.receipt_id}`}>
                    View receipt
                  </a>
                )}
              </>
            ) : req.status === 'OPEN' && req.zip321_uri ? (
              <>
                <Qr value={req.zip321_uri} className="mt-6" />
                <p className="mt-4 text-sm text-muted">Scan with Zodl or another compatible shielded Zcash wallet.</p>
                <a href={req.zip321_uri} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 font-medium text-on-accent">
                  Open in my wallet
                </a>
                <button
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-raised py-3.5 text-sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(req.zip321_uri!);
                    setCopied(true);
                  }}
                >
                  <Icon name="copy" className="h-4 w-4" /> {copied ? 'Copied' : 'Copy payment details'}
                </button>
                <PaymentProgress info={check} payer />
                <p className="mt-3 text-[11px] text-muted">Keep the memo your wallet fills in: it is how this payment is recognized. Link expires {when(req.expires_at).slice(0, 16)} UTC.</p>
              </>
            ) : (
              <p className="py-8 text-sm text-muted">This payment link is closed.</p>
            )}
          </>
        )}
      </div>
      <p className="mt-6 max-w-sm text-center text-[11px] text-muted">Shielded Zcash payment: payment details stay off the public blockchain. Lute, which hosts this page, sees the amount and when it was paid.</p>
    </div>
  );
}
