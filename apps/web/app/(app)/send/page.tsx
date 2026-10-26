'use client';

import { useState } from 'react';
import { ApiError, idemKey, post, type ActionResponse } from '@/lib/api';
import { useMe } from '@/components/AppShell';
import { AuthorizePanel } from '@/components/AuthorizePanel';
import { Button, Card, ErrorNote, Field, PageTitle, inputCls } from '@/components/ui';

const REJECT_TEXT: Record<string, string> = {
  RECIPIENT_DENIED_TRANSPARENT: 'Transparent addresses are refused: the payment would be public.',
  RECIPIENT_DENIED_TEX: 'TEX addresses are refused (transparent-only).',
  RECIPIENT_DENIED_SPROUT: 'Sprout addresses are refused.',
  RECIPIENT_DENIED_NO_SHIELDED_RECEIVER: 'This address has no shielded receiver.',
  RECIPIENT_DENIED_WRONG_NETWORK: 'This address is for a different network.',
  RECIPIENT_DENIED_INVALID: 'Not a valid Zcash address.',
  TRANSPARENT_INVOLVED: 'The proposal touches the transparent pool.',
  CROSS_POOL: 'The proposal would cross pools (amounts become visible at the pool boundary).',
  ORCHARD_INVOLVED: 'Orchard inputs are not used under the single-pool rule.',
  INSUFFICIENT_SPENDABLE_FUNDS: 'Not enough confirmed funds yet (recent change needs a few confirmations).',
  OVER_PER_TX_CAP: 'Over the per-transaction cap (0.02 ZEC).',
  OVER_DAILY_CAP: 'Over the daily cap (0.05 ZEC).',
  SIDECAR_UNAVAILABLE: 'The wallet service did not answer; nothing was signed.',
};

export default function SendPage() {
  const me = useMe()!;
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [wallet, setWallet] = useState<'payout' | 'merchant'>('payout');
  const [key] = useState(() => idemKey('web-send'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<ActionResponse | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setRes(await post<ActionResponse>('/v1/actions/send', { wallet, to: to.trim(), amount_zec: amount.trim() }, { 'idempotency-key': key }));
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  const r = res?.result;
  const reasons = r && 'reasons' in r && r.reasons ? r.reasons : r && 'reason' in r && r.reason ? [r.reason] : [];

  return (
    <>
      <PageTitle title="Send" sub="Shielded only. One pool per transaction (Ironwood or Sapling), never transparent. LuteGuard checks the exact proposal before you sign." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card title="New payment">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Recipient (shielded or unified address)">
              <textarea className={`${inputCls} h-24 font-mono text-xs`} value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} required disabled={!!res} />
            </Field>
            <Field label="From wallet" hint="Payments you receive land in merchant; payout is for payouts you fund.">
              <select className={inputCls} value={wallet} onChange={(e) => setWallet(e.target.value as 'payout' | 'merchant')} disabled={!!res}>
                <option value="payout">payout</option>
                <option value="merchant">merchant</option>
              </select>
            </Field>
            <Field label="Amount (ZEC)" hint={`Network: ${me.network}. Caps: 0.02 ZEC per transaction, 0.05 ZEC per day.`}>
              <input className={`${inputCls} num`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0002" required disabled={!!res} />
            </Field>
            <ErrorNote error={error} />
            {!res && (
              <Button type="submit" disabled={busy}>
                {busy ? 'Building proposal…' : 'Review payment'}
              </Button>
            )}
          </form>
        </Card>
        <div>
          {res && r?.state === 'AWAITING_AUTHORIZATION' && 'summary' in r && (
            <AuthorizePanel actionId={res.action_id} result={r} network={me.network} />
          )}
          {res && (r?.state === 'REJECTED' || r?.state === 'FAILED') && (
            <Card title="Refused before anything was signed">
              <ul className="space-y-1 text-sm">
                {reasons.map((c) => (
                  <li key={c}>
                    <span className="font-mono text-xs text-bad">{c}</span> {REJECT_TEXT[c] ? <span className="text-muted">— {REJECT_TEXT[c]}</span> : null}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">The decision is stored with its reason codes and shown in the Privacy Center.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
