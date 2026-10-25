/**
 * Payment-request details are encrypted in the browser (AES-256-GCM, WebCrypto). The key lives
 * only in the share link's #fragment, which browsers never send to the server (U2).
 */

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

export async function encryptDetails(text: string): Promise<{ ciphertext: string; key: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(text)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return { ciphertext: b64url(out), key: b64url(raw) };
}

export async function decryptDetails(ciphertext: string, key: string): Promise<string> {
  const data = unb64url(ciphertext);
  const k = await crypto.subtle.importKey('raw', unb64url(key), 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, k, data.slice(12));
  return new TextDecoder().decode(pt);
}
