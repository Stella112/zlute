'use client';

import type { ActionRow, RequestRow } from '@/lib/api';
import { ago, explorer, zecShort } from '@/lib/format';
import { Icon } from './icons';

export interface ActivityItem {
  key: string;
  direction: 'in' | 'out';
  title: string;
  at: number;
  amount_zat: string;
  status: { label: string; tone: 'ok' | 'wait' | 'bad' | 'muted' };
  txid: string | null;
  href?: string;
}

const OUT_TITLE: Record<string, string> = {
  SEND: 'Payment sent',
  STREAM_SETTLEMENT: 'Stream payout',
  REFUND: 'Refund sent',
  METER_SETTLEMENT: 'AI agent payment',
};

function actionStatus(s: string, expiresAt: number): ActivityItem['status'] {
  if (s === 'CONFIRMED' || s === 'RECONCILED') return { label: 'Completed', tone: 'ok' };
  if (s === 'SUBMITTED' || s === 'PENDING_CONFIRMATION' || s === 'AUTHORIZED' || s === 'PREPARING') return { label: 'Confirming', tone: 'wait' };
  if (s === 'AWAITING_AUTHORIZATION' || s === 'CREATED' || s === 'VALIDATING') {
    // Never approved in time: nothing was sent.
    return expiresAt * 1000 < Date.now() ? { label: 'Expired', tone: 'muted' } : { label: 'Needs approval', tone: 'wait' };
  }
  if (s === 'REJECTED') return { label: 'Blocked', tone: 'bad' };
  return { label: s === 'EXPIRED' ? 'Expired' : 'Failed', tone: 'muted' };
}

function requestStatus(s: RequestRow['status']): ActivityItem['status'] {
  if (s === 'PAID') return { label: 'Received', tone: 'ok' };
  if (s === 'PENDING') return { label: 'Confirming', tone: 'wait' };
  if (s === 'UNPAID') return { label: 'Waiting', tone: 'muted' };
  return { label: 'Expired', tone: 'muted' };
}

export function buildActivity(actions: ActionRow[], requests: RequestRow[]): ActivityItem[] {
  const out: ActivityItem[] = actions.map((a) => ({
    key: `a-${a.id}`,
    direction: 'out',
    title: OUT_TITLE[a.type] ?? a.type.replaceAll('_', ' ').toLowerCase(),
    at: a.created_at,
    amount_zat: a.amount_zat,
    status: actionStatus(a.state, a.expires_at),
    txid: a.txid,
  }));
  const inn: ActivityItem[] = requests.map((r) => ({
    key: `r-${r.id}`,
    direction: 'in',
    title: r.status === 'PAID' ? 'Payment received' : 'Payment request',
    at: r.created_at,
    amount_zat: r.status === 'PAID' ? r.received_zat : r.amount_zat,
    status: requestStatus(r.status),
    txid: r.txids[0] ?? null,
    href: `/r/${r.id}`,
  }));
  return [...out, ...inn].sort((x, y) => y.at - x.at);
}

const TONE: Record<ActivityItem['status']['tone'], string> = {
  ok: 'bg-ok/12 text-ok',
  wait: 'bg-warn/12 text-warn',
  bad: 'bg-bad/12 text-bad',
  muted: 'bg-raised text-muted',
};

/** Money that never moved (blocked, failed, expired) is shown struck through, without a sign. */
const dead = (i: ActivityItem) => i.status.tone === 'bad' || i.status.label === 'Expired' || i.status.label === 'Failed';
/** Only completed or confirming movements carry +/−; a request still waiting has no sign yet. */
const sign = (i: ActivityItem) => (dead(i) || i.status.label === 'Waiting' ? '' : i.direction === 'in' ? '+' : '−');

export function ActivityList({ items, network, empty }: { items: ActivityItem[]; network: string; empty: React.ReactNode }) {
  if (items.length === 0) return <div className="py-10 text-center text-sm text-muted">{empty}</div>;
  return (
    <ul className="divide-y divide-line">
      {items.map((i) => {
        const link = i.txid ? explorer(i.txid, network) : null;
        const body = (
          <div className="flex items-center gap-3 py-3.5">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${i.direction === 'in' ? 'bg-ok/10 text-ok' : 'bg-accent-soft text-accent'}`}>
              <Icon name={i.direction === 'in' ? 'request' : 'pay'} className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px]">{i.title}</p>
              <p className="text-xs text-muted">{ago(i.at)}</p>
            </div>
            <div className="text-right">
              <p className={`num text-[15px] ${i.direction === 'in' && i.status.tone === 'ok' ? 'text-ok' : ''} ${dead(i) ? 'text-muted line-through decoration-1' : ''}`}>
                {sign(i)}
                {zecShort(i.amount_zat)} <span className="text-xs text-muted">ZEC</span>
              </p>
              <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[i.status.tone]}`}>{i.status.label}</span>
            </div>
          </div>
        );
        const href = link ?? i.href;
        return (
          <li key={i.key}>
            {href ? (
              <a href={href} target={link ? '_blank' : undefined} rel="noreferrer" className="block hover:opacity-90">
                {body}
              </a>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
