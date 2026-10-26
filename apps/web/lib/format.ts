/** Exact zatoshi → ZEC formatting with bigint (no floating point on money). */
export function zec(zat: string | number | bigint, digits = 8): string {
  const v = BigInt(zat);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / 100_000_000n;
  const frac = (a % 100_000_000n).toString().padStart(8, '0').slice(0, digits);
  return `${neg ? '-' : ''}${whole.toString()}${digits > 0 ? `.${frac}` : ''}`;
}

export const zat = (v: string | number | bigint) => BigInt(v).toLocaleString('en-US');

export function when(unix: number): string {
  return new Date(unix * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export const short = (s: string, n = 8) => (s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

/** Block explorer link (a plain link: the page itself never contacts third parties, U5). */
export function explorer(txid: string, network: string): string | null {
  if (network === 'main') return `https://blockchair.com/zcash/transaction/${txid}`;
  return null;
}

/** Consumer-facing ZEC amount: exact, without trailing zeros (0.0001, 1.5, 0). */
export function zecShort(zat: string | number | bigint): string {
  const s = zec(zat);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", or a date. */
export function ago(unix: number, nowMs: number = Date.now()): string {
  const s = Math.max(0, Math.floor(nowMs / 1000) - unix);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86400) return 'yesterday';
  return new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Parses a typed ZEC amount into zatoshi without floating point; null if not a valid amount. */
export function parseZecInput(s: string): bigint | null {
  const m = /^(\d{0,12})(?:\.(\d{0,8}))?$/.exec(s.trim());
  if (!m || (m[1] === '' && !m[2])) return null;
  return BigInt(m[1] || '0') * 100_000_000n + BigInt((m[2] ?? '').padEnd(8, '0') || '0');
}
