import { describe, expect, it } from 'vitest';
import { classifyRoute, routeExecutionAllowed, type RouteFacts } from '../src/crosschain.js';

const strict: RouteFacts = {
  supported: true,
  source_chain_public: false,
  destination: 'zcash_shielded',
  transparent_zcash_hop: false,
  intermediate_confidential: true,
  provider_visible: false,
  verified_by_tests: true,
};

describe('cross-chain route classifier (X group)', () => {
  it('only a fully verified private route is STRICT_PRIVATE_VERIFIED', () => {
    const c = classifyRoute(strict);
    expect(c).toEqual(['STRICT_PRIVATE_VERIFIED']);
    expect(routeExecutionAllowed(c)).toBe(true);
  });

  it('X1 transparent Zcash hop disables execution', () => {
    const c = classifyRoute({ ...strict, transparent_zcash_hop: true });
    expect(c).toContain('TRANSPARENT_ZCASH_HOP');
    expect(routeExecutionAllowed(c)).toBe(false);
  });

  it('X2 a public source chain is never strict-private, even ending in shielded ZEC', () => {
    const c = classifyRoute({ ...strict, source_chain_public: true });
    expect(c).toContain('PUBLIC_SOURCE_EXPOSURE');
    expect(c).not.toContain('STRICT_PRIVATE_VERIFIED');
    expect(routeExecutionAllowed(c)).toBe(false);
  });

  it('X3 unknown facts classify as UNKNOWN and disable execution', () => {
    const c = classifyRoute({ ...strict, provider_visible: undefined });
    expect(c).toContain('UNKNOWN');
    expect(routeExecutionAllowed(c)).toBe(false);
    expect(classifyRoute({ ...strict, verified_by_tests: false })).toEqual(['UNKNOWN']);
  });

  it('X4 classes combine', () => {
    const c = classifyRoute({
      ...strict,
      source_chain_public: true,
      provider_visible: true,
      destination: 'zcash_transparent',
    });
    expect(c).toEqual([
      'INTERMEDIATE_CONFIDENTIAL_ONLY',
      'PROVIDER_VISIBLE',
      'PUBLIC_DESTINATION_EXPOSURE',
      'PUBLIC_SOURCE_EXPOSURE',
      'TRANSPARENT_ZCASH_HOP',
    ]);
  });

  it('unsupported routes are UNSUPPORTED', () => {
    expect(classifyRoute({ ...strict, supported: false })).toEqual(['UNSUPPORTED']);
  });
});
