'use client';

import { useState } from 'react';
import { ApiError, post, type ActionResponse, type ExecuteResult, type ProposalSummary } from '@/lib/api';
import { zec, zat, when, short } from '@/lib/format';
import { Button, ErrorNote, Txid, inputCls } from './ui';

const SIGN_CMD =
  '$OutputEncoding = New-Object System.Text.UTF8Encoding $false; Get-Clipboard | & "$HOME\\lute-owner\\lute-owner.exe" sign --key "$HOME\\lute-owner\\owner.key" | Set-Clipboard';

/**
 * Owner approval of the sidecar's exact proposal (D-009). The browser never holds the owner key:
 * the proposal is copied to the owner's own machine, signed there by lute-owner after a typed
 * confirmation, and only the signature comes back.
 */
export function AuthorizePanel({ actionId, result, network, onDone }: { actionId: string; result: Extract<ExecuteResult, { state: 'AWAITING_AUTHORIZATION' }>; network: string; onDone?: (r: ExecuteResult) => void }) {
  const s: ProposalSummary = result.summary;
  const payload = JSON.stringify({ proposal_hash: result.proposal_hash, summary: s });
  const [sig, setSig] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [final, setFinal] = useState<ExecuteResult | null>(null);

  async function authorize() {
    setBusy(true);
    setError(null);
    try {
      const r = await post<ActionResponse>(`/v1/actions/${actionId}/authorize`, { signature: sig.trim() });
      setFinal(r.result);
      onDone?.(r.result);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  if (final) {
    return (
      <div className="rounded-lg border border-line bg-raised p-4 text-sm">
        {final.state === 'SUBMITTED' && 'txid' in final && final.txid ? (
          <p>
            Broadcast. txid <Txid txid={final.txid} network={network} />. It counts as paid only after confirmations.
          </p>
        ) : (
          <p className="text-bad">
            {final.state}
            {'reasons' in final && final.reasons ? `: ${final.reasons.join(', ')}` : ''}
            {'reason' in final && final.reason ? `: ${final.reason}` : ''}
          </p>
        )}
      </div>
    );
  }

  const rows: [string, React.ReactNode][] = [
    ['Network', s.network],
    ['Amount', `${zec(s.amount_zat)} ZEC (${zat(s.amount_zat)} zat)`],
    ['Fee (ZIP-317, from the library)', `${zec(s.fee_zat)} ZEC`],
    ['Recipient', <span className="font-mono text-xs">{short(s.recipient, 12)}</span>],
    ['Pools: in / out / change', `${s.input_pools.join(',')} / ${s.output_pools.join(',')} / ${s.change_pools.join(',')}`],
    ['Policy', s.policy],
    ['Expires', when(s.expires_at)],
    ['Proposal hash', <span className="font-mono text-xs">{result.proposal_hash}</span>],
  ];

  return (
    <div className="space-y-4 rounded-lg border border-warn/40 bg-warn/5 p-4">
      <div>
        <p className="text-sm font-medium text-warn">LuteGuard: ALLOW. Awaiting your signature.</p>
        <p className="mt-1 text-xs text-muted">LuteGuard evaluated this exact proposal. Nothing is signed or sent until you approve it on your own machine.</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="num break-all">{v}</dd>
          </div>
        ))}
      </dl>
      <ol className="list-decimal space-y-3 pl-5 text-sm">
        <li>
          <Button
            variant="ghost"
            onClick={async () => {
              await navigator.clipboard.writeText(payload);
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy proposal'}
          </Button>
        </li>
        <li>
          In PowerShell on your laptop, run this and type the <code>approve …</code> line it asks for. It puts the signature on your clipboard.
          <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-bg p-2 font-mono text-xs">{SIGN_CMD}</pre>
        </li>
        <li>
          Paste the signature:
          <input className={`${inputCls} mt-2 font-mono`} value={sig} onChange={(e) => setSig(e.target.value)} placeholder="128 hex characters" spellCheck={false} />
        </li>
      </ol>
      <ErrorNote error={error} />
      <Button disabled={busy || !/^[0-9a-f]{128}$/.test(sig.trim())} onClick={authorize}>
        {busy ? 'Submitting…' : 'Authorize and send'}
      </Button>
    </div>
  );
}
