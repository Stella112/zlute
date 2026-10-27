'use client';

import { useState } from 'react';
import { ApiError, get, idemKey, post, type ExecuteResult } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { zecShort } from '@/lib/format';
import { AuthorizePanel } from '@/components/AuthorizePanel';
import { useMe } from '@/components/AppShell';
import { Button, Card, Empty, ErrorNote, Field, PageTitle, StatusBadge, inputCls } from '@/components/ui';

interface Line {
  label: string;
  to: string;
  amount_zec: string;
}
interface Run {
  id: string;
  name: string;
  source: string;
  action_id: string;
  state: string;
  reason: string | null;
  total_zat: string;
  created_at: number;
  items: { label: string | null; amount_zat: string; payslip: string; from_stream: boolean }[];
}
interface Template {
  id: string;
  name: string;
  wallet: string;
  lines: { label: string; amount_zat: string }[];
  total_zat: string;
}
interface Stream {
  id: string;
  status: string;
  outstanding_zat: string;
}
type Awaiting = { actionId: string; result: Extract<ExecuteResult, { state: 'AWAITING_AUTHORIZATION' }> };

const blank = (): Line => ({ label: '', to: '', amount_zec: '' });
/** ZIP-317: 5,000 zat per logical action; a batch has one output per person plus change. */
const feeEstimate = (n: number) => 5000 * Math.max(2, n + 1);

function toZat(v: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(v.trim());
  return m ? BigInt(m[1]!) * 100_000_000n + BigInt((m[2] ?? '').padEnd(8, '0')) : 0n;
}

export default function PayrollPage() {
  const me = useMe();
  const [awaiting, setAwaiting] = useState<Awaiting | null>(null);
  const runs = useLoad(() => get<{ role: string; runs: Run[] }>('/v1/payroll/runs'));
  const templates = useLoad(() => get<{ templates: Template[] }>('/v1/payroll/templates'));
  const reload = () => {
    void runs.reload();
    void templates.reload();
  };
  const onResult = (r: { action_id: string; result: ExecuteResult }) => {
    if (r.result.state === 'AWAITING_AUTHORIZATION' && 'summary' in r.result) setAwaiting({ actionId: r.action_id, result: r.result as Awaiting['result'] });
    reload();
  };

  if (awaiting) {
    return (
      <div className="mx-auto max-w-md">
        <AuthorizePanel
          actionId={awaiting.actionId}
          result={awaiting.result}
          network={me?.network ?? 'main'}
          onDone={() => {
            reload();
          }}
        />
        <Button variant="ghost" className="mt-4 w-full" onClick={() => setAwaiting(null)}>
          Back to payroll
        </Button>
      </div>
    );
  }

  return (
    <>
      <PageTitle title="Payroll" sub="Pay your team in one shielded payment: one approval, one network fee, and each person sees only their own pay." />
      <NewRun onResult={onResult} />
      <FromStreams onResult={onResult} />
      <Card title="Saved payrolls" className="mb-6">
        {(templates.data?.templates ?? []).length === 0 ? (
          <Empty>Save a payroll as a template to run it again next month. Each run still needs your approval.</Empty>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {templates.data!.templates.map((t) => (
              <TemplateRow key={t.id} t={t} onResult={onResult} />
            ))}
          </ul>
        )}
      </Card>
      <Card title="Payroll runs" className="mb-6">
        {(runs.data?.runs ?? []).length === 0 ? (
          <Empty>{runs.error ? `Unavailable (${runs.error})` : 'No payroll runs yet.'}</Empty>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {runs.data!.runs.map((r) => (
              <RunRow key={r.id} r={r} onApprove={(a) => setAwaiting(a)} />
            ))}
          </ul>
        )}
      </Card>
      <Team />
    </>
  );
}

function NewRun({ onResult }: { onResult: (r: { action_id: string; result: ExecuteResult }) => void }) {
  const [name, setName] = useState('October payroll');
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = lines.filter((l) => l.label && l.to && l.amount_zec);
  const total = filled.reduce((a, l) => a + toZat(l.amount_zec), 0n);
  const set = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <Card title="New payroll" className="mb-6">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const items = filled.map((l) => ({ label: l.label.trim(), to: l.to.trim(), amount_zec: l.amount_zec.trim() }));
            if (save) await post('/v1/payroll/templates', { name, items });
            onResult(await post('/v1/payroll/runs', { name, items }, { 'idempotency-key': idemKey('payroll') }));
          } catch (err) {
            setError(err instanceof ApiError ? err.code : 'Request failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_8rem]">
            <input className={inputCls} placeholder="Name or role" value={l.label} onChange={(e) => set(i, 'label', e.target.value)} />
            <input className={`${inputCls} font-mono text-xs`} placeholder="Shielded address (u1… or zs1…)" value={l.to} onChange={(e) => set(i, 'to', e.target.value)} spellCheck={false} />
            <input className={`${inputCls} num`} placeholder="ZEC" value={l.amount_zec} onChange={(e) => set(i, 'amount_zec', e.target.value)} inputMode="decimal" />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {lines.length < 10 && (
            <Button type="button" variant="ghost" onClick={() => setLines([...lines, blank()])}>
              Add person
            </Button>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Save as a template
          </label>
        </div>
        {filled.length > 0 && (
          <p className="text-sm text-muted">
            {filled.length} {filled.length === 1 ? 'person' : 'people'}, total <span className="num text-text">{zecShort(total)} ZEC</span> + network fee about{' '}
            <span className="num">{zecShort(feeEstimate(filled.length))} ZEC</span> for the whole batch (exact fee shown before you approve). Up to 10 people per payment.
          </p>
        )}
        <ErrorNote error={error} />
        <Button type="submit" disabled={busy || filled.length === 0}>
          {busy ? 'Checking every payment…' : 'Review payroll'}
        </Button>
      </form>
    </Card>
  );
}

function FromStreams({ onResult }: { onResult: (r: { action_id: string; result: ExecuteResult }) => void }) {
  const streams = useLoad(() => get<{ streams: Stream[] }>('/v1/streams'));
  const due = (streams.data?.streams ?? []).filter((s) => BigInt(s.outstanding_zat) > 0n);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  if (due.length === 0) return null;
  return (
    <Card title="Pay what your streams owe" className="mb-6">
      <p className="mb-3 text-sm text-muted">Earnings that streams have accrued, paid together in one shielded payment. Each stream records its share.</p>
      <ul className="mb-3 space-y-1 text-sm">
        {due.map((s) => (
          <li key={s.id}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
              <span className="font-mono text-xs">{s.id.slice(0, 10)}…</span> owes <span className="num">{zecShort(s.outstanding_zat)} ZEC</span>
            </label>
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
      <Button
        disabled={picked.length === 0}
        onClick={async () => {
          setError(null);
          try {
            onResult(await post('/v1/payroll/from-streams', { stream_ids: picked }, { 'idempotency-key': idemKey('streams-payroll') }));
          } catch (err) {
            setError(err instanceof ApiError ? err.code : 'Request failed');
          }
        }}
      >
        Review stream payroll
      </Button>
    </Card>
  );
}

function TemplateRow({ t, onResult }: { t: Template; onResult: (r: { action_id: string; result: ExecuteResult }) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span>
        {t.name} <span className="text-muted">· {t.lines.length} people · {zecShort(t.total_zat)} ZEC</span>
      </span>
      <span className="flex items-center gap-2">
        <ErrorNote error={error} />
        <Button
          variant="ghost"
          onClick={async () => {
            setError(null);
            try {
              onResult(await post(`/v1/payroll/templates/${t.id}/run`, {}, { 'idempotency-key': idemKey('tpl-run') }));
            } catch (err) {
              setError(err instanceof ApiError ? err.code : 'Request failed');
            }
          }}
        >
          Run again
        </Button>
      </span>
    </li>
  );
}

function RunRow({ r, onApprove }: { r: Run; onApprove: (a: Awaiting) => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {r.name} <span className="text-muted">· {zecShort(r.total_zat)} ZEC · {r.items.length} people</span>
        </span>
        <span className="flex items-center gap-2">
          <StatusBadge status={r.state} />
          {r.state === 'AWAITING_AUTHORIZATION' && (
            <Button
              variant="ghost"
              onClick={async () => {
                setError(null);
                try {
                  const a = await get<{ action_id: string; result: Awaiting['result'] }>(`/v1/payroll/runs/${r.id}/approval`);
                  onApprove({ actionId: a.action_id, result: a.result });
                } catch (err) {
                  setError(err instanceof ApiError ? err.code : 'Request failed');
                }
              }}
            >
              Approve
            </Button>
          )}
        </span>
      </div>
      <ErrorNote error={error} />
      <ul className="mt-2 space-y-1 text-xs text-muted">
        {r.items.map((it) => (
          <li key={it.payslip} className="flex flex-wrap justify-between gap-2">
            <span>
              {it.label} · <span className="num">{zecShort(it.amount_zat)} ZEC</span>
            </span>
            <button
              className="text-accent underline"
              onClick={async () => {
                await navigator.clipboard.writeText(`${window.location.origin}${it.payslip}`);
                setCopied(it.payslip);
              }}
            >
              {copied === it.payslip ? 'Payslip link copied' : 'Copy private payslip link'}
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}

function Team() {
  const team = useLoad(() => get<{ members: { username: string; role: string }[]; teams: { owner: string; role: string }[] }>('/v1/payroll/members'));
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'admin' | 'operator'>('operator');
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Team">
      <p className="mb-3 text-sm text-muted">
        You approve and sign every payroll. An <b>admin</b> can prepare payrolls and edit saved ones; an <b>operator</b> can only run saved payrolls. Neither can approve, sign or change who
        gets paid without you seeing it at approval.
      </p>
      <form
        className="mb-3 grid gap-2 sm:grid-cols-[1fr_10rem_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await post('/v1/payroll/members', { username: username.trim().toLowerCase(), role });
            setUsername('');
            void team.reload();
          } catch (err) {
            setError(err instanceof ApiError ? (err.code === 'NOT_FOUND' ? 'No Lute account with that username.' : err.code) : 'Request failed');
          }
        }}
      >
        <input className={inputCls} placeholder="Their Lute username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'operator')}>
          <option value="operator">Operator</option>
          <option value="admin">Admin</option>
        </select>
        <Button type="submit" disabled={!username.trim()}>
          Add
        </Button>
      </form>
      <ErrorNote error={error} />
      <ul className="space-y-1 text-sm">
        {(team.data?.members ?? []).map((m) => (
          <li key={m.username}>
            {m.username} · <span className="text-muted">{m.role}</span>
          </li>
        ))}
        {(team.data?.teams ?? []).map((m) => (
          <li key={m.owner} className="text-muted">
            You are {m.role} for {m.owner}&apos;s payroll.
          </li>
        ))}
      </ul>
    </Card>
  );
}
