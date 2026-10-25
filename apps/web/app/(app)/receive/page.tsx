'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { encryptDetails } from '@/lib/fragment';
import { Button, Card, ErrorNote, Field, PageTitle, inputCls } from '@/components/ui';

export default function ReceivePage() {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The note is encrypted here; only ciphertext reaches the server, the key stays in the #fragment.
      const enc = note.trim() ? await encryptDetails(note.trim()) : null;
      const r = await post<{ id: string; share_path: string }>('/v1/requests', {
        wallet: 'merchant',
        amount_zec: amount.trim(),
        ...(enc ? { details_ciphertext: enc.ciphertext } : {}),
      });
      setLink({ id: r.id, url: `${window.location.origin}${r.share_path}${enc ? `#k=${enc.key}` : ''}` });
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle title="Receive" sub="Each request gets a fresh shielded-only address and a unique memo reference. It is PAID only when the amount arrives with enough confirmations." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="New payment request">
          <form onSubmit={create} className="space-y-4">
            <Field label="Amount (ZEC)">
              <input className={`${inputCls} num`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.002" required disabled={!!link} />
            </Field>
            <Field label="Private note (optional)" hint="Encrypted in this browser. The server never sees it; only people with the full link can read it.">
              <textarea className={`${inputCls} h-20`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} disabled={!!link} />
            </Field>
            <ErrorNote error={error} />
            {!link && (
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create request'}
              </Button>
            )}
          </form>
        </Card>
        {link && (
          <Card title="Share this link with the payer">
            <p className="break-all rounded-md border border-line bg-bg p-3 font-mono text-xs">{link.url}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="ghost"
                onClick={async () => {
                  await navigator.clipboard.writeText(link.url);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <a href={link.url} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3.5 py-2 text-sm hover:bg-raised">
                Open pay page
              </a>
              <Link href="/requests" className="rounded-lg border border-line px-3.5 py-2 text-sm hover:bg-raised">
                Track status
              </Link>
            </div>
            <p className="mt-3 text-xs text-muted">The part after # is the decryption key for the note. Browsers do not send it to the server.</p>
          </Card>
        )}
      </div>
    </>
  );
}
