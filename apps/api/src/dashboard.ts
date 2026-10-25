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
import type { SessionUser } from './auth.js';
import { actions, paymentRequests, privacyDecisions } from './db/schema.js';
import type { Db } from './db/store.js';
import type { RequestSidecar } from './sidecar.js';

export interface DashboardDeps {
  db: Db;
  sidecar: RequestSidecar;
  network: Network;
  user: (req: FastifyRequest) => Promise<SessionUser | null>;
  /** Path of evidence/results.json; a missing or unreadable file means every module is UNTESTED. */
  resultsFile: string;
}

const WALLETS = new Set(['payout', 'merchant']);

export async function loadResults(path: string): Promise<Results | null> {
  try {
    const r = JSON.parse(await readFile(path, 'utf8')) as Results;
    return r.schema === 'lute-results/1' ? r : null;
  } catch {
    return null;
  }
}

export function registerDashboardRoutes(app: FastifyInstance, d: DashboardDeps): void {
  const owner = async (req: FastifyRequest) => {
    const u = await d.user(req);
    return u && u.role === 'owner' ? u : u ? 'forbidden' : null;
  };

  app.get('/v1/me', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    return { username: u.username, role: u.role, network: d.network };
  });

  app.get('/v1/actions', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const rows = await d.db.select().from(actions).where(eq(actions.owner_user_id, u.id)).orderBy(desc(actions.created_at)).limit(100);
    return {
      actions: rows.map((a) => ({
        id: a.id,
        type: a.type,
        network: a.network,
        state: a.state,
        amount_zat: a.amount_zat.toString(),
        txid: a.txid,
        reject_reason: a.reject_reason,
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
    if (u === 'forbidden' || !WALLETS.has(req.params.w)) return reply.code(404).send({ error: 'NOT_FOUND' });
    return d.sidecar.balance(req.params.w);
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
