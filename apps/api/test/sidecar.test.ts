import { describe, expect, it } from 'vitest';
import { HttpSidecarClient, hmacHex, signingString } from '../src/sidecar.js';

describe('sidecar HMAC client', () => {
  // Same vector as services/wallet-sidecar/src/api.rs `cross_language_hmac_vector`.
  it('matches the sidecar signature vector', () => {
    expect(hmacHex(Buffer.from('0123456789abcdef0123456789abcdef'), signingString('POST', '/v1/inspect', '{}', '1000', 'nonce-aaaaaaaaaaaa'))).toBe(
      '269ee4330764a125fb41e5be9669614be2393f422e8bd8dc64e4835715d7bf07',
    );
  });

  it('refuses a non-loopback sidecar URL (U12)', () => {
    expect(() => new HttpSidecarClient('http://10.0.0.5:48100', Buffer.alloc(32))).toThrow();
    expect(() => new HttpSidecarClient('https://example.com', Buffer.alloc(32))).toThrow();
  });

  it('sends a fresh nonce and a verifiable signature on every request', async () => {
    const secret = Buffer.from('a'.repeat(64), 'hex');
    const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: String(init.body ?? '') });
      return new Response(JSON.stringify({ verdict: 'ALLOWED', kind: 'unified', has_orchard: true, has_sapling: true, has_transparent: false, payable_pools: ['ironwood'] }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new HttpSidecarClient('http://127.0.0.1:48100', secret, fakeFetch, () => 1234);
    await c.inspect('u1x');
    await c.inspect('u1x');
    const [a, b] = seen;
    expect(a!.headers['x-lute-nonce']).not.toBe(b!.headers['x-lute-nonce']);
    const expected = hmacHex(secret, signingString('POST', '/v1/inspect', a!.body, '1234', a!.headers['x-lute-nonce']!));
    expect(a!.headers['x-lute-signature']).toBe(expected);
  });
});
