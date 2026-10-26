'use client';

import QRCode from 'qrcode';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, get, post } from '@/lib/api';
import { decryptDetails } from '@/lib/fragment';
import { zec, when } from '@/lib/format';

interface PublicRequest {
  status: 'OPEN' | 'PAID' | 'CLOSED';
  amount_zat: string;
  zip321_uri: string | null;
  details_ciphertext: string | null;
  expires_at: number;
}

/** Public pay page. Reads the note key from the #fragment only; nothing about the owner is shown. */
export default function PayPage() {
  const { id } = useParams<{ id: string }>();
  const [req, setReq] = useState<PublicRequest | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [check, setCheck] = useState<{ status: string; receipt_id: string | null } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    get<PublicRequest>(`/v1/public/requests/${encodeURIComponent(id)}`)
      .then(async (r) => {
        setReq(r);
        if (r.status === 'PAID') setCheck(await post<{ status: string; receipt_id: string | null }>(`/v1/public/requests/${encodeURIComponent(id)}/check`).catch(() => null));
        if (r.zip321_uri) setQr(await QRCode.toString(r.zip321_uri, { type: 'svg', margin: 4, errorCorrectionLevel: 'L', color: { dark: '#000000', light: '#ffffff' } }));
        const key = new URLSearchParams(window.location.hash.slice(1)).get('k');
        if (r.details_ciphertext && key) {
          setNote(await decryptDetails(r.details_ciphertext, key).catch(() => '(the note could not be decrypted with this link)'));
        }
      })
      .catch((e: unknown) => setError(e instanceof ApiError && e.status === 404 ? 'This payment request does not exist.' : 'Unavailable right now.'));
  }, [id]);

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
        <p className="text-xs text-muted">Shielded Zcash payment request</p>
        {error && <p className="mt-4 text-sm text-bad">{error}</p>}
        {req && (
          <>
            <p className="num mt-1 text-3xl font-semibold">{zec(req.amount_zat)} ZEC</p>
            {note && <p className="mt-3 whitespace-pre-wrap rounded-md border border-line bg-bg p-3 text-sm">{note}</p>}
            {req.status === 'OPEN' && req.zip321_uri ? (
              <>
                {qr && <div className="mx-auto mt-5 w-full max-w-[18rem] overflow-hidden rounded-lg bg-white" dangerouslySetInnerHTML={{ __html: qr }} />}
                <p className="mt-4 text-center text-xs text-muted">Scan with a shielded wallet (for example Zodl). The memo is filled in for you; keep it so the payment can be matched.</p>
                <div className="mt-4 flex justify-center gap-2">
                  <a href={req.zip321_uri} className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white">
                    Open in wallet
                  </a>
                  <button
                    className="rounded-lg border border-line px-3.5 py-2 text-sm"
                    onClick={async () => {
                      await navigator.clipboard.writeText(req.zip321_uri!);
                      setCopied(true);
                    }}
                  >
                    {copied ? 'Copied' : 'Copy payment URI'}
                  </button>
                </div>
                <div className="mt-4 text-center">
                  <button
                    className="rounded-lg border border-line px-3.5 py-2 text-sm disabled:opacity-60"
                    disabled={checking}
                    onClick={async () => {
                      setChecking(true);
                      try {
                        setCheck(await post(`/v1/public/requests/${encodeURIComponent(id)}/check`));
                      } catch {
                        setCheck({ status: 'UNAVAILABLE', receipt_id: null });
                      } finally {
                        setChecking(false);
                      }
                    }}
                  >
                    {checking ? 'Checking…' : "I've paid: check"}
                  </button>
                  {check && (
                    <p className="mt-2 text-sm">
                      {check.status === 'PAID' ? 'Paid and confirmed.' : check.status === 'PENDING' ? 'Payment seen; waiting for confirmations (about 4 minutes).' : check.status === 'OPEN' ? 'Not seen yet. It can take a minute to appear.' : 'Cannot check right now.'}
                      {check.receipt_id && (
                        <a className="ml-2 text-accent hover:underline" href={`/receipt/${check.receipt_id}`}>
                          View receipt
                        </a>
                      )}
                    </p>
                  )}
                </div>
                <p className="mt-4 text-center text-[11px] text-muted">Expires {when(req.expires_at)}</p>
              </>
            ) : (
              <p className="mt-4 text-sm">
                {req.status === 'PAID' ? 'This request has been paid.' : 'This request is closed.'}
                {check?.receipt_id && (
                  <a className="ml-2 text-accent hover:underline" href={`/receipt/${check.receipt_id}`}>
                    View receipt
                  </a>
                )}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
