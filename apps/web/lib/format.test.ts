import { describe, expect, it } from 'vitest';
import { explorer, short, zec } from './format';

describe('web formatting', () => {
  it('formats zatoshi exactly with bigint (no floating point)', () => {
    expect(zec(30000)).toBe('0.00030000');
    expect(zec('2100000000000000')).toBe('21000000.00000000');
    expect(zec(1n, 8)).toBe('0.00000001');
    expect(zec(-15250)).toBe('-0.00015250');
  });

  it('shortens long ids and links only mainnet txids', () => {
    expect(short('a'.repeat(64), 4)).toBe('aaaa…aaaa');
    expect(explorer('ab', 'regtest')).toBeNull();
    expect(explorer('ab', 'main')).toContain('/ab');
  });
});
