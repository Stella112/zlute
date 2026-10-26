'use client';

import { useState } from 'react';
import { ApiError, post, type ActionResponse, type ExecuteResult, type ProposalSummary } from '@/lib/api';
import { explorer, short, when, zecShort } from '@/lib/format';
import { canonical, sha256Hex, signText, walletSeedHex } from '@/lib/ownerKey';
import { signPayment, type SpendAuthSig } from '@/lib/signer';
import { useMe } from './AppShell';
import { Icon } from './icons';
import { ErrorNote, inputCls } from './ui';

const SIGN_CMD = 'powershell -ExecutionPolicy Bypass -File C:\\zecathon\\tools\\lute-sign.ps1';

/**
 * Owner approval of the sidecar's exact proposal (D-009).
 * - Self-serve accounts: the key lives in this browser. The browser recomputes the proposal hash
 *   from the details shown (it never signs a hash supplied by the server) and signs after a typed
 *   confirmation.
 * - Install owner: the proposal is copied to the owner's machine and signed there by lute-owner.
 */
export function AuthorizePanel({ actionId, result, network, onDone }: { actionId: string; result: Extract<ExecuteResult, { state: 'AWAITING_AUTHORIZATION' }>; network: string; onDone?: (r: ExecuteResult) => void }) {
  const s: ProposalSummary = result.summary;
  const me = useMe();
  const code = result.proposal_hash.slice(0, 8);
  const [typed, setTyped] = useState('');
  const [sig, setSig] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [final, setFinal] = useState<ExecuteResult | null>(null);

  async function authorize(signature: string, spendAuthSigs?: SpendAuthSig[]) {
    setBusy(true);
    setError(null);
    try {
      const r = await post<ActionResponse>(`/v1/actions/${actionId}/authorize`, { signature, ...(spendAuthSigs ? { spend_auth_sigs: spendAuthSigs } : {}) });
      setFinal(r.result);
      onDone?.(r.result);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  if (final) {
    const ok = final.state === 'SUBMITTED' && 'txid' in final && final.txid;
    const link = ok ? explorer(final.txid as string, network) : null;
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-center">
        <div className={`mx-auto mb-4 grid h-20 w-20 place-items-center rounded-full ${ok ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad'}`}>
          <Icon name={ok ? 'check' : 'shield'} className="h-10 w-10" />
        </div>
        <p className="font-display text-2xl">{ok ? 'Sent' : 'Not sent'}</p>
        <p className="font-display num mt-1 text-4xl">{zecShort(s.amount_zat)} ZEC</p>
        {ok ? (
          <p className="mt-2 text-sm text-muted">Confirming on the Zcash network (about 5 minutes).</p>
        ) : (
          <p className="mt-2 text-sm text-bad">{'reason' in final && final.reason ? final.reason : 'reasons' in final && final.reasons ? final.reasons.join(', ') : final.state}</p>
        )}
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm text-accent">
            View on explorer
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <p className="text-center text-sm text-muted">Confirm payment</p>
      <p className="font-display num mt-1 text-center text-6xl">
        {zecShort(s.amount_zat)} <span className="text-2xl font-normal text-muted">ZEC</span>
      </p>
      <dl className="mt-6 divide-y divide-line rounded-2xl bg-raised px-4 text-sm">
        <div className="flex justify-between py-3">
          <dt className="text-muted">To</dt>
          <dd className="font-mono text-xs">{short(s.recipient, 10)}</dd>
        </div>
        <div className="flex justify-between py-3">
          <dt className="text-muted">Network fee</dt>
          <dd className="num">{zecShort(s.fee_zat)} ZEC</dd>
        </div>
        <div className="flex justify-between py-3 font-medium">
          <dt>Total</dt>
          <dd className="num">{zecShort(s.amount_zat + s.fee_zat)} ZEC</dd>
        </div>
      </dl>
      <p className="mt-3 flex items-center gap-2 text-xs text-ok">
        <Icon name="shield" className="h-4 w-4" /> Checked by LuteGuard: one shielded pool, no transparent parts.
      </p>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer select-none">Details</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>Pool</dt>
          <dd>
            {s.input_pools.join(',')} → {s.output_pools.join(',')} (change {s.change_pools.join(',')})
          </dd>
          <dt>Policy</dt>
          <dd>{s.policy}</dd>
          <dt>Expires</dt>
          <dd>{when(s.expires_at)}</dd>
          <dt>Proposal</dt>
          <dd className="break-all font-mono">{result.proposal_hash}</dd>
        </dl>
      </details>

      {me?.self_serve ? (
        <div className="mt-6 space-y-3">
          <label className="block text-sm">
            Type <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-accent">approve {code}</span> to confirm
            <input
              className={`${inputCls} mt-2 rounded-xl py-3 font-mono`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={`approve ${code}`}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </label>
          <ErrorNote error={error} />
          <button
            className="w-full rounded-xl bg-accent py-4 text-base font-medium text-on-accent disabled:bg-accent/40"
            disabled={busy || typed.trim().toLowerCase() !== `approve ${code}`}
            onClick={async () => {
              setError(null);
              try {
                // Recompute the hash from what is shown; never sign a server-supplied hash.
                const h = await sha256Hex(canonical(s));
                if (h !== result.proposal_hash) throw new Error('The payment details do not match; nothing was signed.');
                let spendSigs: SpendAuthSig[] | undefined;
                if (me.browser_signed) {
                  // Non-custodial: sign the transaction itself here, after checking on the
                  // transaction (not on the server's word) that it pays exactly what is shown.
                  setBusy(true);
                  const pz = await post<{ pczt_hex: string; proposal_hash: string }>(`/v1/actions/${actionId}/pczt`);
                  if (pz.proposal_hash !== h) throw new Error('The prepared transaction does not match; nothing was signed.');
                  spendSigs = await signPayment(await walletSeedHex(me.username), s.network, pz.pczt_hex, s);
                }
                await authorize(await signText(me.username, `lute-approve-v1|${s.network}|${h}`), spendSigs);
              } catch (e) {
                setBusy(false);
                setError(
                  e instanceof ApiError
                    ? e.code
                    : e instanceof Error
                      ? e.message === 'NO_KEY_IN_THIS_BROWSER' || e.message === 'NO_WALLET_PHRASE_IN_THIS_BROWSER'
                        ? 'This browser does not hold your keys. Restore your backup in Settings.'
                        : e.message
                      : 'Signing failed',
                );
              }
            }}
          >
            {busy ? (me.browser_signed ? 'Signing in this browser…' : 'Sending…') : 'Confirm and pay'}
          </button>
          {me.browser_signed && <p className="text-center text-xs text-muted">Signed in this browser. Lute cannot move your money without it.</p>}
        </div>
      ) : (
        <div className="mt-6 space-y-3 text-sm">
          <p className="text-muted">Approve with the owner key on your laptop:</p>
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              In PowerShell, start:
              <pre className="mt-1 overflow-x-auto rounded-lg bg-bg p-2 font-mono text-xs">{SIGN_CMD}</pre>
            </li>
            <li>
              When it says Waiting,{' '}
              <button
                className="text-accent underline"
                onClick={async () => {
                  await navigator.clipboard.writeText(JSON.stringify({ proposal_hash: result.proposal_hash, summary: s }));
                  setCopied(true);
                }}
              >
                {copied ? 'copied' : 'copy the payment'}
              </button>
              , then type <code>approve {code}</code> there.
            </li>
            <li>
              Paste the signature:
              <input className={`${inputCls} mt-2 font-mono`} value={sig} onChange={(e) => setSig(e.target.value)} placeholder="128 hex characters" spellCheck={false} />
            </li>
          </ol>
          <ErrorNote error={error} />
          <button className="w-full rounded-xl bg-accent py-4 text-base font-medium text-on-accent disabled:bg-accent/40" disabled={busy || !/^[0-9a-f]{128}$/.test(sig.trim())} onClick={() => authorize(sig.trim())}>
            {busy ? 'Sending…' : 'Confirm and pay'}
          </button>
        </div>
      )}
    </div>
  );
}
