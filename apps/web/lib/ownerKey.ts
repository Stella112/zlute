/**
 * The user's approval key, generated and kept in this browser (Ed25519, WebCrypto, IndexedDB).
 * It plays the role of tools/lute-owner for self-serve accounts: the wallet sidecar only accepts
 * spends from a user's wallets signed by this key. The browser recomputes every hash it signs
 * from the details it shows; it never signs a hash supplied by the server.
 */

const DB = 'lute-keys';
const STORE = 'keys';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function put(name: string, value: unknown): Promise<void> {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getItem<T>(name: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(name);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const slot = (username: string) => `owner:${username}`;

interface Stored {
  privateKey: CryptoKey;
  publicHex: string;
}

export function keySupported(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof indexedDB !== 'undefined';
}

/** Creates a new key for `username` (replacing none: refuses if one exists). Returns the public key. */
export async function createKey(username: string): Promise<string> {
  if (await getItem<Stored>(slot(username))) throw new Error('KEY_EXISTS');
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicHex = hex(await crypto.subtle.exportKey('raw', kp.publicKey));
  await put(slot(username), { privateKey: kp.privateKey, publicHex } satisfies Stored);
  return publicHex;
}

export async function publicKey(username: string): Promise<string | null> {
  return (await getItem<Stored>(slot(username)))?.publicHex ?? null;
}

export async function signText(username: string, text: string): Promise<string> {
  const k = await getItem<Stored>(slot(username));
  if (!k) throw new Error('NO_KEY_IN_THIS_BROWSER');
  return hex(await crypto.subtle.sign({ name: 'Ed25519' }, k.privateKey, new TextEncoder().encode(text)));
}

/** Backup file: the private key (PKCS#8) and public key. Anyone holding it can approve spends. */
export async function exportBackup(username: string): Promise<string> {
  const k = await getItem<Stored>(slot(username));
  if (!k) throw new Error('NO_KEY_IN_THIS_BROWSER');
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', k.privateKey));
  return JSON.stringify({ lute_owner_key: 1, username, public_key: k.publicHex, pkcs8: btoa(String.fromCharCode(...pkcs8)) }, null, 1);
}

export async function importBackup(username: string, json: string, expectedPublicHex: string | null): Promise<void> {
  const b = JSON.parse(json) as { lute_owner_key?: number; public_key?: string; pkcs8?: string };
  if (b.lute_owner_key !== 1 || !b.pkcs8 || !b.public_key) throw new Error('NOT_A_LUTE_KEY_BACKUP');
  if (expectedPublicHex && b.public_key !== expectedPublicHex) throw new Error('BACKUP_IS_FOR_ANOTHER_ACCOUNT');
  const der = Uint8Array.from(atob(b.pkcs8), (c) => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, true, ['sign']);
  await put(slot(username), { privateKey, publicHex: b.public_key } satisfies Stored);
}

/** Sorted-key compact JSON: the same canonical form the sidecar and lute-owner hash. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
