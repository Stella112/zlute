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
