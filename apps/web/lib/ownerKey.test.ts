import { describe, expect, it } from 'vitest';
import { canonical, sha256Hex } from './ownerKey';

describe('browser approval key: canonical hashing', () => {
  it('matches the sidecar/lute-owner cross-language vector', async () => {
    // services/wallet-sidecar/src/approval.rs cross_language_hash_vector (keys deliberately unsorted)
    const summary = {
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
    expect(await sha256Hex(canonical(summary))).toBe('e1b7850e9c88374a4dac6d6d38e857175a73a4965efe48e9f797ed379c05a6bd');
  });
});
