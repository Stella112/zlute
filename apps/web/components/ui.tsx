import type { ModuleStatus } from '@/lib/api';
import { explorer, short } from '@/lib/format';

export function Card({ title, action, children, className = '' }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-medium text-muted">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </header>
  );
}

const STATUS_STYLE: Record<string, string> = {
  PROVEN: 'text-ok border-ok/40 bg-ok/10',
  PARTIAL: 'text-warn border-warn/40 bg-warn/10',
  BLOCKED: 'text-bad border-bad/40 bg-bad/10',
  ROADMAP: 'text-muted border-line bg-raised',
  UNTESTED: 'text-muted border-line bg-raised',
};

export function StatusBadge({ status }: { status: ModuleStatus | string }) {
  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${STATUS_STYLE[status] ?? STATUS_STYLE.UNTESTED}`}>{status}</span>;
}

const STATE_STYLE: Record<string, string> = {
  CONFIRMED: 'text-ok',
  RECONCILED: 'text-ok',
  SUBMITTED: 'text-accent',
  PENDING_CONFIRMATION: 'text-accent',
  AWAITING_AUTHORIZATION: 'text-warn',
  REJECTED: 'text-bad',
  FAILED: 'text-bad',
  EXPIRED: 'text-muted',
  PAID: 'text-ok',
  UNPAID: 'text-muted',
  PENDING: 'text-accent',
};

export function State({ s }: { s: string }) {
  return <span className={`text-xs font-medium ${STATE_STYLE[s] ?? 'text-muted'}`}>{s.replaceAll('_', ' ').toLowerCase()}</span>;
}

export function Txid({ txid, network }: { txid: string; network: string }) {
  const href = explorer(txid, network);
  const label = <span className="font-mono text-xs">{short(txid, 8)}</span>;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline" title={txid}>
      {label}
    </a>
  ) : (
    <span title={txid}>{label}</span>
  );
}

export function Button({ children, variant = 'primary', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const v =
    variant === 'primary'
      ? 'bg-accent text-white hover:bg-accent/90 disabled:bg-accent/40'
      : variant === 'danger'
        ? 'border border-bad/50 text-bad hover:bg-bad/10'
        : 'border border-line text-text hover:bg-raised';
  return (
    <button {...p} className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${v} ${p.className ?? ''}`}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none placeholder:text-muted/60 focus:border-accent';

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>;
}
