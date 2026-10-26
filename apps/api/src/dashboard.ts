/**
 * Read-only dashboard feeds (mandate §19.10): who am I, activity, requests, wallet balance, and the
 * Privacy Center status. Nothing here returns addresses, memo text or keys (U3). Status is
 * computed from evidence/results.json and stored LuteGuard decisions (§23), never hardcoded.
 */
import { readFile } from 'node:fs/promises';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { computeStatus, type Results } from '@lute/core';
import { POLICY_VERSION, type Network } from '@lute/luteguard';
import { WALLET_ROLES, walletOf, type SessionUser, type WalletRole } from './auth.js';
import { actions, paymentRequests, privacyDecisions } from './db/schema.js';
import type { Db } from './db/store.js';
import type { RequestSidecar } from './sidecar.js';
import type { PgActionStore } from './db/store.js';
import type { ActionState } from '@lute/core';

export interface DashboardDeps {
  db: Db;
  sidecar: RequestSidecar;
  network: Network;
  user: (req: FastifyRequest) => Promise<SessionUser | null>;
  /** Path of evidence/results.json; a missing or unreadable file means every module is UNTESTED. */
  resultsFile: string;
  /** Moves broadcast payments to confirmed when they are listed. */
  store?: PgActionStore;
  now?: () => number;
}

const SYNC_EVERY_S = 60;
const MIN_CONF_MAIN = 3;


export async function loadResults(path: string): Promise<Results | null> {
  try {
    const r = JSON.parse(await readFile(path, 'utf8')) as Results;
    return r.schema === 'lute-results/1' ? r : null;
  } catch {
    return null;
  }
}

export function registerDashboardRoutes(app: FastifyInstance, d: DashboardDeps): void {
  const now = d.now ?? (() => Math.floor(Date.now() / 1000));
  const lastSync = new Map<string, number>();
  /** Syncs a wallet with the network at most once a minute, so balances and statuses are current. */
  async function fresh(w: string) {
    if (now() - (lastSync.get(w) ?? 0) < SYNC_EVERY_S) return;
    lastSync.set(w, now());
    await d.sidecar.sync(w).catch(() => undefined);
  }

  const owner = async (req: FastifyRequest) => {
    const u = await d.user(req);
    return u && u.role === 'owner' ? u : u ? 'forbidden' : null;
  };

  app.get('/v1/me', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    return { username: u.username, role: u.role, network: d.network, owner_pub: u.owner_pub, self_serve: u.wallet_prefix !== null };
  });

  app.get('/v1/actions', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    let rows = await d.db.select().from(actions).where(eq(actions.owner_user_id, u.id)).orderBy(desc(actions.created_at)).limit(100);
    // Payments in flight move to confirmed here (their own wallet DB; no extra server query).
    const inFlight = rows.filter((a) => a.txid && a.wallet && (a.state === 'SUBMITTED' || a.state === 'PENDING_CONFIRMATION'));
    if (d.store && inFlight.length) {
      for (const w of new Set(inFlight.map((a) => a.wallet!))) await fresh(w);
      for (const a of inFlight) {
        const st = await d.sidecar.txStatus(a.wallet!, a.txid!).catch(() => null);
        if (!st) continue;
        let state = a.state as ActionState;
        if (st.expired_unmined && st.mined_height === null) {
          await d.store.transition(a.id, state, 'FAILED', 'system', { reject_reason: 'EXPIRED_UNMINED' }).catch(() => undefined);
          continue;
        }
        if (state === 'SUBMITTED' && st.mined_height !== null) {
          await d.store.transition(a.id, 'SUBMITTED', 'PENDING_CONFIRMATION', 'system').catch(() => undefined);
          state = 'PENDING_CONFIRMATION';
        }
        if (state === 'PENDING_CONFIRMATION' && st.confirmations >= (d.network === 'main' ? MIN_CONF_MAIN : 1)) {
          await d.store.transition(a.id, 'PENDING_CONFIRMATION', 'CONFIRMED', 'system').catch(() => undefined);
        }
      }
      rows = await d.db.select().from(actions).where(eq(actions.owner_user_id, u.id)).orderBy(desc(actions.created_at)).limit(100);
    }
    return {
      actions: rows.map((a) => ({
        id: a.id,
        type: a.type,
        network: a.network,
        state: a.state,
        amount_zat: a.amount_zat.toString(),
        txid: a.txid,
        reject_reason: a.reject_reason,
        expires_at: a.expires_at,
        created_at: a.created_at,
        updated_at: a.updated_at,
      })),
    };
  });

  app.get('/v1/requests', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const rows = await d.db.select().from(paymentRequests).where(eq(paymentRequests.owner_user_id, u.id)).orderBy(desc(paymentRequests.created_at)).limit(100);
    return {
      requests: rows.map((r) => ({
        id: r.id,
        status: r.status,
        amount_zat: r.amount_zat.toString(),
        received_zat: r.received_zat.toString(),
        matched_by: r.matched_by,
        txids: r.txids,
        expires_at: r.expires_at,
        created_at: r.created_at,
      })),
    };
  });

  app.get<{ Params: { w: string } }>('/v1/wallets/:w/balance', async (req, reply) => {
    const u = await owner(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (u === 'forbidden' || !(WALLET_ROLES as readonly string[]).includes(req.params.w)) return reply.code(404).send({ error: 'NOT_FOUND' });
    const w = walletOf(u, req.params.w as WalletRole);
    await fresh(w);
    try {
      return await d.sidecar.balance(w);
    } catch {
      // A wallet that has never synced has no balance yet: sync it once and retry.
      await d.sidecar.sync(w);
      return d.sidecar.balance(w);
    }
  });

  app.get('/v1/privacy/status', async (req, reply) => {
    const u = await owner(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (u === 'forbidden') return reply.code(404).send({ error: 'NOT_FOUND' });
    const results = await loadResults(d.resultsFile);
    const recent = await d.db.select().from(privacyDecisions).orderBy(desc(privacyDecisions.evaluated_at)).limit(200);
    const denies = await d.db
      .select()
      .from(privacyDecisions)
      .where(and(eq(privacyDecisions.outcome, 'DENY')))
      .orderBy(desc(privacyDecisions.evaluated_at))
      .limit(20);
    const nonPass = (checks: unknown) =>
      ((checks as { outcome: string; reason_code: string; policy?: string }[]) ?? []).filter((c) => c.outcome !== 'PASS').map((c) => ({ policy: c.policy ?? null, reason_code: c.reason_code }));
    return {
      network: d.network,
      policy_version: POLICY_VERSION,
      run: results ? { generated_at: results.generated_at, commit: results.commit, dirty: results.dirty, suites: results.suites, reviewed: results.reviewed } : null,
      modules: computeStatus(results),
      evidence: results?.evidence ?? [],
      findings: results?.findings ?? [],
      decisions: {
        total: recent.length,
        allow: recent.filter((x) => x.outcome === 'ALLOW').length,
        deny: recent.filter((x) => x.outcome === 'DENY').length,
        recent_denies: denies.map((x) => ({ decision_id: x.decision_id, action_id: x.action_id, policy_version: x.policy_version, evaluated_at: x.evaluated_at, reasons: nonPass(x.checks) })),
      },
    };
  });
}
