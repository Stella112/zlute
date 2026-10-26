'use client';

import { useEffect, useState } from 'react';
import { ApiError, get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { useMe } from '@/components/AppShell';
import { canonical, sha256Hex, signText } from '@/lib/ownerKey';
import { zec, zat, when } from '@/lib/format';
import { Button, Card, Empty, ErrorNote, Field, PageTitle, StatusBadge, inputCls } from '@/components/ui';

interface Service {
  id: string;
  name: string;
  price_per_call_zat: string;
  credit_limit_zat: string;
}
interface Grant {
  grant_id: string;
  agent_name: string;
  service: Service | null;
  cap_per_tx_zat: string;
  cap_total_zat: string;
  spent_zat: string;
  remaining_zat: string;
  expires_at: number;
  revoked: boolean;
  mandate: { id: string; hash: string; sidecar: { committed_zat: number; remaining_zat: number } | null };
  token?: string;
}
interface Mandate {
  mandate_id: string;
  network: string;
  wallet: string;
  purpose: string;
  max_tx_zat: number;
  total_zat: number;
  allowed_recipients: string[];
  expires_at: number;
  nonce: string;
}

const SIGN_MANDATE_CMD =
  'powershell -ExecutionPolicy Bypass -File C:\\zecathon\\tools\\lute-sign.ps1 -Mandate';

/** Self-serve accounts sign the mandate with the key held in this browser (hash recomputed here). */
function BrowserMandateSign({ username, mandate, onSigned }: { username: string; mandate: Mandate; onSigned: (sig: string) => void }) {
  const [hash, setHash] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    void sha256Hex(canonical(mandate)).then(setHash);
  }, [mandate]);
  if (!hash) return null;
  const expected = `approve mandate ${hash.slice(0, 8)}`;
  return (
    <div className="space-y-2">
      <p>
        Type <code>{expected}</code> to sign this mandate with the key held in this browser:
      </p>
      <input className={`${inputCls} font-mono`} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={expected} spellCheck={false} />
      <ErrorNote error={error} />
      <Button
        variant="ghost"
        disabled={done || typed.trim() !== expected}
        onClick={async () => {
          try {
            onSigned(await signText(username, `lute-mandate-v1|${mandate.network}|${hash}`));
            setDone(true);
          } catch (e) {
            setError(e instanceof Error && e.message === 'NO_KEY_IN_THIS_BROWSER' ? 'This browser does not hold your key. Restore your key backup in Settings.' : 'Signing failed');
          }
        }}
      >
        {done ? 'Signed' : 'Sign mandate'}
      </Button>
    </div>
  );
}

function NewService({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('Chain tip API');
  const [price, setPrice] = useState('1000');
  const [limit, setLimit] = useState('15000');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await post('/v1/meter/services', { name, price_per_call_zat: Number(price), credit_limit_zat: Number(limit) });
          onDone();
        } catch (err) {
          setError(err instanceof ApiError ? err.code : 'Request failed');
        }
      }}
    >
      <Field label="Service name">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Price per call (zat)">
        <input className={`${inputCls} num`} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" required />
      </Field>
      <Field label="Credit limit (zat)">
        <input className={`${inputCls} num`} value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" required />
      </Field>
      <Button type="submit">Add service</Button>
      <div className="sm:col-span-4">
        <ErrorNote error={error} />
      </div>
    </form>
  );
}

function NewGrant({ services, onDone }: { services: Service[]; onDone: () => void }) {
  const me = useMe()!;
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [agentName, setAgentName] = useState('Claude agent');
  const [maxTx, setMaxTx] = useState('0.00015');
  const [total, setTotal] = useState('0.0002');
  const [hours, setHours] = useState('24');
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [sig, setSig] = useState('');
  const [copied, setCopied] = useState(false);
  const [created, setCreated] = useState<Grant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (created?.token) {
    const mcp = `claude mcp add lute --env LUTE_AGENT_TOKEN=${created.token} --env LUTE_API_URL=http://127.0.0.1:48300 -- node C:\\zecathon\\apps\\mcp\\dist\\server.js`;
    return (
      <div className="space-y-3 rounded-lg border border-ok/40 bg-ok/5 p-4 text-sm">
        <p className="font-medium text-ok">Grant active. The sidecar verified your signature and loaded the mandate.</p>
        <p>Agent token (shown once; Lute keeps only its hash):</p>
        <pre className="overflow-x-auto rounded-md border border-line bg-bg p-2 font-mono text-xs">{created.token}</pre>
        <p>Connect an MCP client (Claude Code) on this laptop:</p>
        <pre className="overflow-x-auto rounded-md border border-line bg-bg p-2 font-mono text-xs">{mcp}</pre>
        <Button variant="ghost" onClick={() => navigator.clipboard.writeText(mcp)}>
          Copy MCP command
        </Button>
        <Button
          className="ml-2"
          onClick={() => {
            setCreated(null);
            onDone();
          }}
        >
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!mandate ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              const r = await post<{ mandate: Mandate }>('/v1/agent/mandates/draft', { service_id: serviceId, max_tx_zec: maxTx.trim(), total_zec: total.trim(), ttl_hours: Number(hours) });
              setMandate(r.mandate);
            } catch (err) {
              setError(err instanceof ApiError ? err.code : 'Request failed');
            }
          }}
        >
          <Field label="Metered service it may pay">
            <select className={inputCls} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({zat(s.price_per_call_zat)} zat/call)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Agent name">
            <input className={inputCls} value={agentName} onChange={(e) => setAgentName(e.target.value)} required />
          </Field>
          <Field label="Max per payment (ZEC)" hint="≤ 0.02 ZEC (sidecar cap)">
            <input className={`${inputCls} num`} value={maxTx} onChange={(e) => setMaxTx(e.target.value)} required />
          </Field>
          <Field label="Total budget (ZEC)" hint="≤ 0.05 ZEC (daily cap)">
            <input className={`${inputCls} num`} value={total} onChange={(e) => setTotal(e.target.value)} required />
          </Field>
          <Field label="Valid for (hours)" hint="≤ 48">
            <input className={`${inputCls} num`} value={hours} onChange={(e) => setHours(e.target.value)} required />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={!serviceId}>
              Draft mandate
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4 rounded-lg border border-warn/40 bg-warn/5 p-4 text-sm">
          <p className="font-medium text-warn">Review and sign this mandate on your laptop.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">Network / wallet</dt>
            <dd>
              {mandate.network} / {mandate.wallet}
            </dd>
            <dt className="text-muted">Per payment</dt>
            <dd className="num">up to {zec(mandate.max_tx_zat)} ZEC</dd>
            <dt className="text-muted">Total budget</dt>
            <dd className="num">{zec(mandate.total_zat)} ZEC</dd>
            <dt className="text-muted">May pay only</dt>
            <dd>the service&apos;s address (1 recipient)</dd>
            <dt className="text-muted">Expires</dt>
            <dd>{when(mandate.expires_at)}</dd>
          </dl>
          <p className="text-xs text-muted">Payments inside these bounds will not ask you again. Anything outside them is refused by LuteGuard and by the sidecar.</p>
          {me.self_serve ? (
            <BrowserMandateSign username={me.username} mandate={mandate} onSigned={setSig} />
          ) : (
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              <Button
                variant="ghost"
                onClick={async () => {
                  await navigator.clipboard.writeText(JSON.stringify(mandate));
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy mandate'}
              </Button>
            </li>
            <li>
              In PowerShell, start this first (it waits for the copy, so click Copy mandate after it says Waiting), then type the <code>approve mandate …</code> line it asks for:
              <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-bg p-2 font-mono text-xs">{SIGN_MANDATE_CMD}</pre>
            </li>
            <li>
              Paste the signature:
              <input className={`${inputCls} mt-2 font-mono`} value={sig} onChange={(e) => setSig(e.target.value)} placeholder="128 hex characters" spellCheck={false} />
            </li>
          </ol>
          )}
          <div className="flex gap-2">
            <Button
              disabled={busy || !/^[0-9a-f]{128}$/.test(sig.trim())}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  setCreated(await post<Grant>('/v1/agent/grants', { agent_name: agentName, service_id: serviceId, mandate, signature: sig.trim() }));
                } catch (err) {
                  setError(err instanceof ApiError ? err.code : 'Request failed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Loading into the sidecar…' : 'Register grant'}
            </Button>
            <Button variant="ghost" onClick={() => setMandate(null)}>
              Back
            </Button>
          </div>
        </div>
      )}
      <ErrorNote error={error} />
      <p className="text-xs text-muted">Network: {me.network}. Agent spends come from the operator-custodied `agent` wallet.</p>
    </div>
  );
}

/** Funds the agent wallet: a payment link into it, paid from Zodl or from Pay. */
function FundAgent() {
  const [amount, setAmount] = useState('0.0004');
  const [link, setLink] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void get<{ ironwood: { spendable_zat: number; total_zat: number } }>('/v1/wallets/agent/balance')
      .then((b) => setBalance(zec(b.ironwood.total_zat)))
      .catch(() => setBalance(null));
  }, [link]);
  return (
    <Card title="Agent wallet" className="mb-6" action={balance !== null ? <span className="num text-sm text-muted">{balance} ZEC</span> : undefined}>
      <p className="mb-3 text-sm text-muted">Agent payments come from this wallet only. Fund it with a payment link, paid from Zodl or from Pay.</p>
      {link ? (
        <p className="break-all rounded-xl bg-raised p-3 text-sm">
          <a href={link} target="_blank" rel="noreferrer" className="underline">
            {link}
          </a>
        </p>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              const r = await post<{ share_path: string }>('/v1/requests', { wallet: 'agent', amount_zec: amount.trim() });
              setLink(`${window.location.origin}${r.share_path}`);
            } catch (err) {
              setError(err instanceof ApiError ? err.code : 'Request failed');
            }
          }}
        >
          <Field label="Amount (ZEC)">
            <input className={`${inputCls} num w-40`} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Button type="submit">Create funding link</Button>
        </form>
      )}
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>
    </Card>
  );
}

export default function AgentsPage() {
  const services = useLoad(() => get<{ services: Service[] }>('/v1/meter/services'));
  const grants = useLoad(() => get<{ grants: Grant[] }>('/v1/agent/grants'));
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <PageTitle title="AI agents" sub="Give an AI agent a budget you sign once. It can pay for a service by itself, and anything over the budget is refused." />
      <FundAgent />
      <Card title="Metered services" className="mb-6">
        {(services.data?.services ?? []).length > 0 && (
          <ul className="mb-4 divide-y divide-line text-sm">
            {services.data!.services.map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{s.name}</span>
                <span className="num text-muted">
                  {zat(s.price_per_call_zat)} zat/call · credit limit {zat(s.credit_limit_zat)} zat
                </span>
              </li>
            ))}
          </ul>
        )}
        <NewService onDone={() => void services.reload()} />
        <p className="mt-3 text-xs text-muted">The demo service is run by the operator and receives into the `merchant` wallet; payments are matched by memo.</p>
      </Card>

      <Card title="New agent grant" className="mb-6">
        {(services.data?.services ?? []).length === 0 ? <Empty>Add a metered service first.</Empty> : <NewGrant services={services.data!.services} onDone={() => void grants.reload()} />}
      </Card>

      <Card title="Grants">
        <ErrorNote error={error} />
        {(grants.data?.grants ?? []).length === 0 ? (
          <Empty>No agent grants.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {grants.data!.grants.map((g) => {
              const active = !g.revoked && g.expires_at * 1000 > Date.now();
              return (
                <li key={g.grant_id} className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <p>
                      {g.agent_name} <span className="text-muted">→ {g.service?.name ?? 'service'}</span>
                    </p>
                    <p className="num text-xs text-muted">
                      spent {zec(g.spent_zat)} / {zec(g.cap_total_zat)} ZEC · up to {zec(g.cap_per_tx_zat)} per payment · sidecar remaining{' '}
                      {g.mandate.sidecar ? zec(g.mandate.sidecar.remaining_zat) : '—'} · expires {when(g.expires_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={active ? 'ACTIVE' : g.revoked ? 'REVOKED' : 'EXPIRED'} />
                    {active && (
                      <Button
                        variant="danger"
                        onClick={async () => {
                          try {
                            await post(`/v1/agent/grants/${g.grant_id}/revoke`);
                            await grants.reload();
                          } catch {
                            setError('Could not revoke.');
                          }
                        }}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
