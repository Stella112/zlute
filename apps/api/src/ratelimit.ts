/**
 * Fixed-window, in-memory rate limits per client IP (the app is public at uselute.xyz). The client
 * IP is the first X-Forwarded-For hop set by the reverse proxy (Caddy → web → API, all loopback),
 * else the socket address. Auth endpoints are the tightest (password guessing, account creation).
 */
import type { FastifyRequest } from 'fastify';

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  windowS: number;
}

export const LIMITS = {
  auth: { max: 10, windowS: 60 },
  write: { max: 120, windowS: 60 },
  read: { max: 600, windowS: 60 },
} satisfies Record<string, Limit>;

export function clientIp(req: FastifyRequest): string {
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return first || req.ip;
}

export class RateLimiter {
  private readonly hits = new Map<string, { start: number; n: number }>();
  constructor(private readonly now: () => number) {}

  /** True if allowed; counts the request. */
  take(key: string, l: Limit): boolean {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || t - h.start >= l.windowS) {
      this.hits.set(key, { start: t, n: 1 });
      if (this.hits.size > 50_000) this.prune(t);
      return true;
    }
    h.n++;
    return h.n <= l.max;
  }

  private prune(t: number) {
    for (const [k, h] of this.hits) if (t - h.start >= 3600) this.hits.delete(k);
  }
}
