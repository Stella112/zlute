import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { sha256Hex, opaqueId } from './crypto.js';
import type { Db } from './db/store.js';
import { sessions, users } from './db/schema.js';

export const SESSION_COOKIE = 'lute_session';
export const SESSION_TTL_S = 12 * 3600;

export type Role = 'owner' | 'merchant' | 'user';
export interface SessionUser {
  id: string;
  username: string;
  role: Role;
  /** Self-serve accounts: prefix of their own wallets. Null: the install's wallets. */
  wallet_prefix: string | null;
  /** Self-serve accounts: their approval public key (hex). Null: the install's owner key. */
  owner_pub: string | null;
}

export type WalletRole = 'merchant' | 'payout' | 'agent';
export const WALLET_ROLES: readonly WalletRole[] = ['merchant', 'payout', 'agent'];

/** The sidecar wallet that plays `role` for this user. */
export function walletOf(u: Pick<SessionUser, 'wallet_prefix'>, role: WalletRole): string {
  return u.wallet_prefix ? `${u.wallet_prefix}-${role}` : role;
}

/** Same, for code that only has the user id (e.g. a subscription issuing its next invoice). */
export async function walletForUserId(db: Db, userId: string, role: WalletRole): Promise<string> {
  const u = (await db.select({ wallet_prefix: users.wallet_prefix }).from(users).where(eq(users.id, userId)).limit(1))[0];
  return walletOf({ wallet_prefix: u?.wallet_prefix ?? null }, role);
}

export async function createUser(
  db: Db,
  username: string,
  password: string,
  role: Role,
  now: number,
  opts: { wallet_prefix?: string; owner_pub?: string } = {},
): Promise<string> {
  if (password.length < 12) throw new Error('password must be at least 12 characters');
  const id = opaqueId();
  // argon2id (the @node-rs/argon2 default algorithm).
  await db.insert(users).values({ id, username, password_hash: await hash(password), role, created_at: now, wallet_prefix: opts.wallet_prefix ?? null, owner_pub: opts.owner_pub ?? null });
  return id;
}

const toSessionUser = (u: typeof users.$inferSelect): SessionUser => ({ id: u.id, username: u.username, role: u.role as Role, wallet_prefix: u.wallet_prefix, owner_pub: u.owner_pub });

/** Returns a session token on success. Same failure for unknown user and wrong password. */
export async function login(db: Db, username: string, password: string, now: number): Promise<{ token: string; user: SessionUser } | null> {
  const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
  const u = rows[0];
  if (!u) {
    // Spend comparable time on unknown users.
    await hash(password).catch(() => undefined);
    return null;
  }
  if (!(await verify(u.password_hash, password))) return null;
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ token_hash: sha256Hex(token), user_id: u.id, expires_at: now + SESSION_TTL_S, created_at: now });
  return { token, user: toSessionUser(u) };
}

export async function sessionUser(db: Db, token: string | undefined, now: number): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await db.select().from(sessions).where(eq(sessions.token_hash, sha256Hex(token))).limit(1);
  const s = rows[0];
  if (!s || s.expires_at <= now) return null;
  const us = await db.select().from(users).where(eq(users.id, s.user_id)).limit(1);
  const u = us[0];
  return u ? toSessionUser(u) : null;
}

export async function logout(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.delete(sessions).where(eq(sessions.token_hash, sha256Hex(token)));
}
