'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, get, post } from '@/lib/api';
import { encryptDetails } from '@/lib/fragment';
import { Qr } from '@/components/Qr';
import { Icon } from '@/components/icons';
import { ErrorNote } from '@/components/ui';

interface Created {
  id: string;
  url: string;
  uri: string;
  amount: string;
}

export default function RequestPage() {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [req, setReq] = useState<Created | null>(null);
  const [status, setStatus] = useState<string>('UNPAID');
  const [copied, setCopied] = useState(false);

  // Live status: re-check every 20 s until paid (PAID needs 3 confirmations on mainnet).
  useEffect(() => {
    if (!req || status === 'PAID') return;
    const t = setInterval(() => {
      void post<{ status: string }>(`/v1/requests/${req.id}/refresh`)
        .then((r) => setStatus(r.status))
        .catch(() => undefined);
    }, 20000);
    return () => clearInterval(t);
  }, [req, status]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The note is encrypted here; the key stays in the link's #fragment (never sent to the server).
      const enc = note.trim() ? await encryptDetails(note.trim()) : null;
      const r = await post<{ id: string; share_path: string }>('/v1/requests', { wallet: 'merchant', amount_zec: amount.trim(), ...(enc ? { details_ciphertext: enc.ciphertext } : {}) });
      const pub = await get<{ zip321_uri: string }>(`/v1/public/requests/${r.id}`);
      setReq({ id: r.id, url: `${window.location.origin}${r.share_path}${enc ? `#k=${enc.key}` : ''}`, uri: pub.zip321_uri, amount: amount.trim() });
      setStatus('UNPAID');
    } catch (err) {
      setError(err instanceof ApiError ? (err.code === 'BAD_AMOUNT' || err.code === 'BAD_REQUEST' ? 'Enter an amount like 0.001' : err.code) : 'Could not create the request.');
    } finally {
      setBusy(false);
    }
  }

  if (req) {
    const paid = status === 'PAID';
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{paid ? 'Paid' : 'Request created'}</h1>
        <p className="num mt-2 text-4xl font-semibold">
          {req.amount} <span className="text-xl font-normal text-muted">ZEC</span>
        </p>
        {paid ? (
          <div className="mx-auto my-8 grid h-28 w-28 place-items-center rounded-full bg-ok/15 text-ok">
            <Icon name="check" className="h-14 w-14" />
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">Show this code, or share the link. The payer scans it with Zodl or any Zcash wallet.</p>
            <Qr value={req.uri} className="mt-6" />
          </>
        )}
        <p className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${paid ? 'bg-ok/15 text-ok' : status === 'PENDING' ? 'bg-warn/15 text-warn' : 'bg-raised text-muted'}`}>
          {paid ? 'Received and confirmed' : status === 'PENDING' ? 'Payment seen, confirming…' : 'Waiting for payment…'}
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            className="flex items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 font-medium text-on-accent"
            onClick={async () => {
              if (navigator.share) await navigator.share({ title: 'Payment request', url: req.url }).catch(() => undefined);
              else {
                await navigator.clipboard.writeText(req.url);
                setCopied(true);
              }
            }}
          >
            <Icon name="share" /> Share link
          </button>
          <button
            className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-raised py-3.5 font-medium"
            onClick={async () => {
              await navigator.clipboard.writeText(req.url);
              setCopied(true);
            }}
          >
            <Icon name="copy" /> {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        <div className="mt-6 flex justify-center gap-6 text-sm">
          <button
            className="text-accent"
            onClick={() => {
              setReq(null);
              setAmount('');
              setNote('');
            }}
          >
            New request
          </button>
          <Link href="/activity" className="text-muted hover:text-text">
            All activity
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={create} className="mx-auto max-w-md">
      <h1 className="text-center text-2xl font-semibold tracking-tight">Request a payment</h1>
      <p className="mt-1 text-center text-sm text-muted">Get paid privately. The payer needs only a Zcash wallet.</p>
      <div className="mt-10 flex items-baseline justify-center gap-2">
        <input
          className="num w-full bg-transparent text-center text-6xl font-semibold tracking-tight outline-none placeholder:text-muted/40"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          inputMode="decimal"
          placeholder="0"
          autoFocus
          required
        />
      </div>
      <p className="mt-1 text-center text-lg text-muted">ZEC</p>
      <div className="mt-8">
        {showNote ? (
          <textarea
            className="h-24 w-full rounded-2xl border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="What's it for? Only people with the link can read this."
          />
        ) : (
          <button type="button" className="w-full text-center text-sm text-accent" onClick={() => setShowNote(true)}>
            + Add a private note
          </button>
        )}
      </div>
      <div className="mt-4">
        <ErrorNote error={error} />
      </div>
      <button type="submit" disabled={busy || !amount} className="mt-6 w-full rounded-2xl bg-accent py-4 text-base font-medium text-on-accent disabled:bg-accent/40">
        {busy ? 'Creating…' : 'Create request'}
      </button>
    </form>
  );
}
