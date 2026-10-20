/**
 * Field encryption at rest (mandate §19.11): AES-256-GCM via node:crypto, random 96-bit nonce per
 * value, key from LUTE_DATA_KEY (32 bytes hex). Encryption at rest, NOT end-to-end: the API
 * process can decrypt. Format: base64url(nonce ‖ tag ‖ ciphertext), prefixed "v1:".
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export class FieldCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('data key must be 32 bytes');
  }

  static fromHex(hex: string): FieldCipher {
    return new FieldCipher(Buffer.from(hex, 'hex'));
  }

  encrypt(plaintext: string, aad: string): string {
    const nonce = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, nonce);
    c.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
    return `v1:${Buffer.concat([nonce, c.getAuthTag(), ct]).toString('base64url')}`;
  }

  decrypt(value: string, aad: string): string {
    if (!value.startsWith('v1:')) throw new Error('unknown ciphertext format');
    const raw = Buffer.from(value.slice(3), 'base64url');
    const d = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  }
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** 128-bit random opaque id, base64url (mandate §17). */
export function opaqueId(): string {
  return randomBytes(16).toString('base64url');
}
