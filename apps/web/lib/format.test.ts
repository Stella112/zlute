import { describe, expect, it } from 'vitest';
import { explorer, short, zec } from './format';

describe('web formatting', () => {
  it('formats zatoshi exactly with bigint (no floating point)', () => {
    expect(zec(30000)).toBe('0.00030000');
    expect(zec('2100000000000000')).toBe('21000000.00000000');
    expect(zec(1n, 8)).toBe('0.00000001');
    expect(zec(-15250)).toBe('-0.00015250');
  });

  it('shortens long ids and never links a txid to a third-party explorer', () => {
    expect(short('a'.repeat(64), 4)).toBe('aaaa…aaaa');
    expect(explorer('ab', 'regtest')).toBeNull();
    expect(explorer('ab', 'main')).toBeNull();
  });
});

import { ago, zecShort } from './format';

describe('consumer formatting', () => {
  it('drops trailing zeros but stays exact', () => {
    expect(zecShort(10000)).toBe('0.0001');
    expect(zecShort(150000000)).toBe('1.5');
    expect(zecShort(0)).toBe('0');
    expect(zecShort(1)).toBe('0.00000001');
  });
  it('relative times', () => {
    const now = 1_800_000_000_000;
    expect(ago(1_800_000_000 - 30, now)).toBe('just now');
    expect(ago(1_800_000_000 - 600, now)).toBe('10 min ago');
    expect(ago(1_800_000_000 - 7200, now)).toBe('2 h ago');
  });
});
