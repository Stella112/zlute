/** Exact money handling (mandate §19.1, test F2). Zatoshi are bigint everywhere. */

export const ZAT_PER_ZEC = 100_000_000n;
/** Total ZEC supply cap, 21,000,000 ZEC, in zatoshi. */
export const MAX_MONEY_ZAT = 21_000_000n * ZAT_PER_ZEC;

export class AmountError extends Error {}

/** Parses a decimal ZEC string exactly into zatoshi. Rejects > 8 decimals, negatives, junk. */
export function parseZec(input: string): bigint {
  const s = input.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new AmountError('amount must be a non-negative decimal number');
  const whole = m[1]!;
  const frac = m[2] ?? '';
  if (frac.length > 8) throw new AmountError('amount has more than 8 decimal places');
  const zat = BigInt(whole) * ZAT_PER_ZEC + BigInt(frac.padEnd(8, '0') || '0');
  if (zat > MAX_MONEY_ZAT) throw new AmountError('amount exceeds the maximum ZEC supply');
  return zat;
}

/** Formats zatoshi as a decimal ZEC string with exactly 8 decimals. */
export function formatZec(zat: bigint): string {
  if (zat < 0n) throw new AmountError('negative amount');
  const whole = zat / ZAT_PER_ZEC;
  const frac = (zat % ZAT_PER_ZEC).toString().padStart(8, '0');
  return `${whole}.${frac}`;
}

/** Amount bucket for non-audit logs (MetadataPolicy): never the exact amount. */
export function amountBucket(zat: bigint): string {
  if (zat <= 0n) return '0';
  if (zat < 100_000n) return '<0.001';
  if (zat < 1_000_000n) return '<0.01';
  if (zat < 10_000_000n) return '<0.1';
  if (zat < ZAT_PER_ZEC) return '<1';
  return '>=1';
}
