import type { NextConfig } from 'next';

// The browser only ever talks to this origin. /v1/* is proxied to the loopback API, so the
// session cookie stays HttpOnly + SameSite=Strict and the API's Origin check still applies.
const api = process.env.LUTE_API_URL ?? 'http://127.0.0.1:48200';

const csp = [
  "default-src 'self'",
  // 'wasm-unsafe-eval': the payment signer is WebAssembly served from this origin (/lute-signer/).
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Payments sync the wallet and create a zero-knowledge proof before answering (10-60 s on the
  // VPS); the default 30 s proxy timeout turned a successful payment into a 500 for the caller.
  experimental: { proxyTimeout: 180_000 },
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${api}/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // U5: no third-party requests; U11/U2: no referrer leaks of pay links.
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Browsers only ever reach Lute over HTTPS (Caddy redirects plain HTTP).
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
        ],
      },
    ];
  },
};

export default config;
