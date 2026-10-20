/**
 * Logger redaction (MetadataPolicy, test U9). Drops sensitive keys at any depth before anything
 * is logged; `amount*` keys are replaced by a bucket. Use `redact()` on every object passed to a
 * logger. Fastify request bodies are never logged.
 */
import { amountBucket } from '@lute/core';

const DROP = new Set(['memo', 'address', 'ua', 'email', 'name', 'description', 'note', 'ufvk', 'ivk', 'seed', 'key', 'to', 'recipient', 'recipient_address', 'memo_text', 'signature', 'password', 'cookie', 'authorization', 'uri']);

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lk = k.toLowerCase();
      if (DROP.has(lk) || lk.endsWith('_enc') || lk.includes('secret') || lk.includes('password')) continue;
      if (lk.startsWith('amount')) {
        out[`${k}_bucket`] = typeof v === 'bigint' ? amountBucket(v) : typeof v === 'number' ? amountBucket(BigInt(Math.trunc(v))) : '[redacted]';
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}
