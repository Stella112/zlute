import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalJson } from '../src/canonical.js';

describe('canonical JSON', () => {
  it('sorts keys and emits compact JSON', () => {
    expect(canonicalJson({ b: 1, a: 'x', c: [2, { z: true, y: null }] })).toBe(
      '{"a":"x","b":1,"c":[2,{"y":null,"z":true}]}',
    );
  });

  it('rejects unsafe numbers instead of silently rounding', () => {
    expect(() => canonicalJson({ v: 2 ** 53 })).toThrow();
    expect(() => canonicalJson({ v: 1.5 })).toThrow();
  });

  // Same vector as services/wallet-sidecar/src/approval.rs `cross_language_hash_vector`.
  it('matches the sidecar hash for the shared vector', () => {
    const s = {
      proposal_id: 'p1',
      account: 'a1',
      network: 'regtest',
      recipient: 'uregtest1xyz',
      recipient_pool: 'ironwood',
      amount_zat: 1000000,
      fee_zat: 10000,
      input_pools: ['ironwood'],
      output_pools: ['ironwood'],
      change_pools: ['ironwood'],
      policy: 'LUTE_STRICT/D-002',
      memo_hash: '',
      created_at: 100,
      expires_at: 400,
    };
    expect(canonicalHash(s)).toBe('e1b7850e9c88374a4dac6d6d38e857175a73a4965efe48e9f797ed379c05a6bd');
  });
});
