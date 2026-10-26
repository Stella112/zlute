'use client';

import { useState } from 'react';
import { ApiError, get, idemKey, post, type ActionResponse, type Balance } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { parseZecInput, zecShort } from '@/lib/format';
import { useMe } from '@/components/AppShell';
import { AuthorizePanel } from '@/components/AuthorizePanel';
import { Icon } from '@/components/icons';

const BLOCKED: Record<string, string> = {
  RECIPIENT_DENIED_TRANSPARENT: 'That is a transparent address. Paying it would make the payment public, so Lute blocked it. Ask for a shielded (u1… or zs1…) address.',
  RECIPIENT_DENIED_TEX: 'That is a transparent-only (TEX) address. Lute only makes shielded payments.',
  RECIPIENT_DENIED_SPROUT: 'Sprout addresses are no longer supported.',
  RECIPIENT_DENIED_NO_SHIELDED_RECEIVER: 'That address has no shielded part, so the payment would be public.',
  RECIPIENT_DENIED_WRONG_NETWORK: 'That address is for a different Zcash network.',
  RECIPIENT_DENIED_INVALID: 'That is not a valid Zcash address.',
  CROSS_POOL: 'This payment would cross pools and reveal its amount, so Lute blocked it.',
  TRANSPARENT_INVOLVED: 'This payment would touch the public pool, so Lute blocked it.',
  INSUFFICIENT_SPENDABLE_FUNDS: 'Not enough available yet. Recent payments need a few minutes to confirm.',
  OVER_PER_TX_CAP: 'That is above the 0.02 ZEC limit per payment.',
  OVER_DAILY_CAP: 'That would pass the 0.05 ZEC daily limit.',
  SIDECAR_UNAVAILABLE: 'The wallet service is busy. Nothing was sent; try again in a moment.',
};

const avail = (b: Balance | null) => (b ? BigInt(b.ironwood.spendable_zat + b.sapling.spendable_zat + b.orchard.spendable_zat) : 0n);

export default function PayPage() {
  const me = useMe()!;
  const payout = useLoad(() => get<Balance>('/v1/wallets/payout/balance'));
  const merchant = useLoad(() => get<Balance>('/v1/wallets/merchant/balance'));
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [key] = useState(() => idemKey('web-send'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<ActionResponse | null>(null);

  // Pay from whichever wallet can cover it (payout first, then received payments).
  const want = parseZecInput(amount);
  const wallet: 'payout' | 'merchant' = want !== null && avail(payout.data) >= want ? 'payout' : avail(merchant.data) > avail(payout.data) ? 'merchant' : 'payout';
  const total = avail(payout.data) + avail(merchant.data);

  async function review(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<ActionResponse>('/v1/actions/send', { wallet, to: to.trim(), amount_zec: amount.trim() }, { 'idempotency-key': key });
      const result = r.result;
      if (result.state === 'AWAITING_AUTHORIZATION') setRes(r);
      else {
        const codes = 'reasons' in result && result.reasons ? result.reasons : 'reason' in result && result.reason ? [result.reason] : [result.state];
        setError(codes.map((c) => BLOCKED[c] ?? c).join(' '));
      }
    } catch (err) {
      setError(err instanceof ApiError ? (err.code === 'BAD_AMOUNT' || err.code === 'BAD_REQUEST' ? 'Check the amount and the address.' : (BLOCKED[err.code] ?? err.code)) : 'Something went wrong. Nothing was sent.');
    } finally {
      setBusy(false);
    }
  }

  if (res && res.result.state === 'AWAITING_AUTHORIZATION' && 'summary' in res.result) {
    return (
      <div className="mx-auto max-w-md">
        <AuthorizePanel actionId={res.action_id} result={res.result} network={me.network} />
      </div>
    );
  }

  return (
    <form onSubmit={review} className="mx-auto max-w-md">
      <h1 className="text-center text-2xl font-semibold tracking-tight">Pay</h1>
      <p className="mt-1 text-center text-sm text-muted">{payout.loading ? 'Checking your balance…' : `${zecShort(total)} ZEC available`}</p>
      <input
        className="num mt-10 w-full bg-transparent text-center text-6xl font-semibold tracking-tight outline-none placeholder:text-muted/40"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        inputMode="decimal"
        placeholder="0"
        autoFocus
        required
      />
      <p className="mt-1 text-center text-lg text-muted">ZEC</p>
      <label className="mt-8 block">
        <span className="mb-2 block text-sm text-muted">To</span>
        <textarea
          className="h-24 w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 font-mono text-xs outline-none placeholder:font-sans placeholder:text-sm placeholder:text-muted/60 focus:border-accent"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Paste a shielded Zcash address (u1… or zs1…)"
          spellCheck={false}
          required
        />
      </label>
      {error && (
        <div className="mt-4 flex gap-3 rounded-2xl border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
          <Icon name="shield" className="h-5 w-5 shrink-0" />
          <p>{error}</p>
        </div>
      )}
      <button type="submit" disabled={busy || !amount || !to.trim()} className="mt-6 w-full rounded-2xl bg-accent py-4 text-base font-medium text-on-accent disabled:bg-accent/40">
        {busy ? 'Checking privacy…' : 'Review'}
      </button>
      <p className="mt-4 text-center text-xs text-muted">Every payment is checked by LuteGuard and must be shielded. Limits: 0.02 ZEC per payment, 0.05 ZEC per day.</p>
    </form>
  );
}
