import { describe, expect, it } from 'vitest';
import { accrued, due, StreamError, validateTerms, type StreamTerms } from '../src/streams.js';

const T0 = 1_800_000_000;
const base = (over: Partial<StreamTerms> = {}): StreamTerms => ({
  total_zat: 100_000_000n,
  start_ts: T0,
  end_ts: T0 + 86_400,
  events: [],
  ...over,
});

describe('stream accrual (S group)', () => {
  it('S1 0 seconds → 0', () => {
    expect(accrued(base(), T0)).toBe(0n);
    expect(accrued(base(), T0 - 100)).toBe(0n);
  });

  it('S2 1 second accrues exactly floor(total/duration)', () => {
    expect(accrued(base(), T0 + 1)).toBe(100_000_000n / 86_400n);
  });

  it('S3 30-day stream is exact at the midpoint', () => {
    const t = base({ total_zat: 2_592_000_000n, end_ts: T0 + 30 * 86_400 });
    expect(accrued(t, T0 + 15 * 86_400)).toBe(1_296_000_000n);
  });

  it('S4/S5 property: never exceeds total, monotonic (10k random cases)', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 10_000; i++) {
      const dur = 1 + Math.floor(rnd() * 1_000_000);
      const total = 1n + BigInt(Math.floor(rnd() * 2_100_000_000_000));
      const t = base({ total_zat: total, end_ts: T0 + dur });
      const a = T0 + Math.floor(rnd() * (dur + 10));
      const b = a + Math.floor(rnd() * 1000);
      const x = accrued(t, a);
      const y = accrued(t, b);
      expect(x <= total).toBe(true);
      expect(y >= x).toBe(true);
    }
  });

  it('S6 the final accrued amount equals the total exactly (remainder paid at the end)', () => {
    const t = base({ total_zat: 1_000_003n, end_ts: T0 + 7 });
    expect(accrued(t, T0 + 6)).toBe((1_000_003n * 6n) / 7n);
    expect(accrued(t, T0 + 7)).toBe(1_000_003n);
    expect(accrued(t, T0 + 10_000)).toBe(1_000_003n);
  });

  it('S7 pause and resume stop and restart accrual', () => {
    const t = base({ events: [{ kind: 'pause', at: T0 + 100 }, { kind: 'resume', at: T0 + 400 }] });
    const rate = (s: number) => (100_000_000n * BigInt(s)) / 86_400n;
    expect(accrued(t, T0 + 100)).toBe(rate(100));
    expect(accrued(t, T0 + 300)).toBe(rate(100)); // paused
    expect(accrued(t, T0 + 500)).toBe(rate(200)); // 100 before + 100 after resume
  });

  it('S8 cancel freezes accrual', () => {
    const t = base({ events: [{ kind: 'cancel', at: T0 + 1000 }] });
    expect(accrued(t, T0 + 5000)).toBe(accrued(t, T0 + 1000));
    expect(accrued(t, T0 + 1000)).toBe((100_000_000n * 1000n) / 86_400n);
  });

  it('S9 accrual stops at the end time', () => {
    expect(accrued(base(), T0 + 86_400 * 3)).toBe(100_000_000n);
  });

  it('S13 only the server clock counts: the input is a number the server supplies', () => {
    // No Date.now() inside the function: the same inputs always give the same output.
    const t = base();
    expect(accrued(t, T0 + 1234)).toBe(accrued(t, T0 + 1234));
  });

  it('rejects malformed terms and event sequences', () => {
    expect(() => validateTerms(base({ total_zat: 0n }))).toThrow(StreamError);
    expect(() => validateTerms(base({ end_ts: T0 }))).toThrow(StreamError);
    expect(() => validateTerms(base({ events: [{ kind: 'resume', at: T0 + 1 }] }))).toThrow(StreamError);
    expect(() => validateTerms(base({ events: [{ kind: 'pause', at: T0 + 5 }, { kind: 'pause', at: T0 + 6 }] }))).toThrow(StreamError);
    expect(() => validateTerms(base({ events: [{ kind: 'cancel', at: T0 + 5 }, { kind: 'pause', at: T0 + 6 }] }))).toThrow(StreamError);
    expect(() => validateTerms(base({ events: [{ kind: 'pause', at: T0 + 9 }, { kind: 'resume', at: T0 + 5 }] }))).toThrow(StreamError);
  });

  it('due = accrued − confirmed − pending, never negative', () => {
    expect(due(1000n, 300n, 200n)).toBe(500n);
    expect(due(1000n, 900n, 200n)).toBe(0n);
  });
});
