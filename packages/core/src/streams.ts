/**
 * Stream accrual (mandate §19.5). Deterministic, integer-only, server-authoritative time.
 *   active_elapsed = Σ active intervals clamped to [start, end]
 *   accrued        = floor(total_zat × active_elapsed / (end − start))
 * Always ≤ total, monotonic in `now`, and equal to total once the whole duration has been active.
 * A cancelled stream stops accruing at its cancellation time. The UI counter is visualization only
 * ("Earned (accounting), not wallet funds").
 */

export type StreamEvent = { kind: 'pause' | 'resume' | 'cancel'; at: number };

export interface StreamTerms {
  total_zat: bigint;
  start_ts: number;
  end_ts: number;
  /** Ordered by `at`; validated by `validateEvents`. */
  events: StreamEvent[];
}

export class StreamError extends Error {}

export function validateTerms(t: StreamTerms): void {
  if (t.total_zat <= 0n) throw new StreamError('total must be positive');
  if (!Number.isSafeInteger(t.start_ts) || !Number.isSafeInteger(t.end_ts)) throw new StreamError('timestamps must be integers');
  if (t.end_ts <= t.start_ts) throw new StreamError('end must be after start');
  validateEvents(t.events);
}

/** Events must be time-ordered; pause/resume alternate starting with pause; nothing after cancel. */
export function validateEvents(events: StreamEvent[]): void {
  let paused = false;
  let cancelled = false;
  let last = -Infinity;
  for (const e of events) {
    if (!Number.isSafeInteger(e.at)) throw new StreamError('event time must be an integer');
    if (e.at < last) throw new StreamError('events out of order');
    if (cancelled) throw new StreamError('no events after cancel');
    if (e.kind === 'pause') {
      if (paused) throw new StreamError('already paused');
      paused = true;
    } else if (e.kind === 'resume') {
      if (!paused) throw new StreamError('not paused');
      paused = false;
    } else {
      cancelled = true;
    }
    last = e.at;
  }
}

/** Seconds the stream was active within [start, min(now, end)]. */
export function activeElapsed(t: StreamTerms, now: number): number {
  const hi = Math.min(now, t.end_ts);
  if (hi <= t.start_ts) return 0;
  let elapsed = 0;
  let runningSince: number | null = t.start_ts;
  for (const e of t.events) {
    const at = Math.min(Math.max(e.at, t.start_ts), hi);
    if (e.kind === 'pause' || e.kind === 'cancel') {
      if (runningSince !== null) {
        elapsed += Math.max(0, at - runningSince);
        runningSince = null;
      }
      if (e.kind === 'cancel') return elapsed;
    } else if (runningSince === null) {
      runningSince = at;
    }
  }
  if (runningSince !== null) elapsed += Math.max(0, hi - runningSince);
  return elapsed;
}

export function accrued(t: StreamTerms, now: number): bigint {
  validateTerms(t);
  const duration = BigInt(t.end_ts - t.start_ts);
  const active = BigInt(activeElapsed(t, now));
  const a = (t.total_zat * active) / duration;
  return a > t.total_zat ? t.total_zat : a;
}

/** Amount due for settlement now: accrued − confirmed − pending (never negative). */
export function due(accruedZat: bigint, confirmedZat: bigint, pendingZat: bigint): bigint {
  const d = accruedZat - confirmedZat - pendingZat;
  return d > 0n ? d : 0n;
}

/** Per-second rate in zatoshi for display (rounded down); accounting uses `accrued`. */
export function ratePerSecond(t: StreamTerms): bigint {
  return t.total_zat / BigInt(t.end_ts - t.start_ts);
}
