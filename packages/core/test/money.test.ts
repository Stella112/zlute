import { describe, expect, it } from 'vitest';
import { AmountError, amountBucket, formatZec, MAX_MONEY_ZAT, parseZec } from '../src/money.js';
import { assertTransition, canTransition, IllegalTransition } from '../src/state.js';

describe('F2 exact decimal → zatoshi', () => {
  it.each([
    ['0', 0n],
    ['1', 100_000_000n],
    ['0.00000001', 1n],
    ['0.02', 2_000_000n],
    ['12.3456789', 1_234_567_890n],
    ['21000000', MAX_MONEY_ZAT],
  ])('%s → %s', (s, z) => {
    expect(parseZec(s)).toBe(z);
  });

  it.each(['0.000000001', '-1', '1e8', '1.', '.5', 'abc', '', '1,5', '21000000.00000001'])('rejects %s', (s) => {
    expect(() => parseZec(s)).toThrow(AmountError);
  });

  it('round-trips through formatZec', () => {
    for (const z of [0n, 1n, 99_999_999n, 100_000_000n, 1_234_567_890n]) {
      expect(parseZec(formatZec(z))).toBe(z);
    }
  });

  it('buckets amounts for non-audit logs', () => {
    expect(amountBucket(1_000_000n)).toBe('<0.1');
    expect(amountBucket(150_000_000n)).toBe('>=1');
  });
});

describe('Action state machine', () => {
  it('allows the happy path', () => {
    const path = ['CREATED', 'VALIDATING', 'AWAITING_AUTHORIZATION', 'AUTHORIZED', 'PREPARING', 'SUBMITTED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'RECONCILED'] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
  });

  it('F6 cannot jump from SUBMITTED to CONFIRMED without PENDING_CONFIRMATION', () => {
    expect(() => assertTransition('SUBMITTED', 'CONFIRMED')).toThrow(IllegalTransition);
  });

  it('terminal states have no exits and cannot be skipped into execution', () => {
    expect(() => assertTransition('REJECTED', 'AUTHORIZED')).toThrow(IllegalTransition);
    expect(() => assertTransition('CREATED', 'PREPARING')).toThrow(IllegalTransition);
    expect(() => assertTransition('EXPIRED', 'VALIDATING')).toThrow(IllegalTransition);
  });
});
