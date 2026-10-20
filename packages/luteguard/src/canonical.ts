import { createHash } from 'node:crypto';

/**
 * Canonical JSON identical to the sidecar's (`serde_json::Value` objects are BTreeMap-backed, so
 * keys are sorted by byte order; output is compact). Only plain JSON values are accepted.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error('canonicalJson: only safe integers are supported');
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (Buffer.compare(Buffer.from(a), Buffer.from(b))));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new Error(`canonicalJson: unsupported type ${typeof value}`);
}

export function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
