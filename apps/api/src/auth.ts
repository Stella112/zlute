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
}

export async function createUser(db: Db, username: string, password: string, role: Role, now: number): Promise<string> {
  if (password.length < 12) throw new Error('password must be at least 12 characters');
  const id = opaqueId();
  // argon2id (the @node-rs/argon2 default algorithm).
  await db.insert(users).values({ id, username, password_hash: await hash(password), role, created_at: now });
  return id;
}

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
  return { token, user: { id: u.id, username: u.username, role: u.role as Role } };
}

export async function sessionUser(db: Db, token: string | undefined, now: number): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await db.select().from(sessions).where(eq(sessions.token_hash, sha256Hex(token))).limit(1);
  const s = rows[0];
  if (!s || s.expires_at <= now) return null;
  const us = await db.select().from(users).where(eq(users.id, s.user_id)).limit(1);
  const u = us[0];
  return u ? { id: u.id, username: u.username, role: u.role as Role } : null;
}

export async function logout(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.delete(sessions).where(eq(sessions.token_hash, sha256Hex(token)));
}
