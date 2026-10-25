import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AmountError, executeAction, IdempotencyMismatch, parseZec, type ActionRecord, type SidecarClient } from '@lute/core';
import type { Network, Principal } from '@lute/luteguard';
import { login, logout, SESSION_COOKIE, SESSION_TTL_S, sessionUser, type SessionUser } from './auth.js';
import { opaqueId, type FieldCipher } from './crypto.js';
import { registerRequestRoutes } from './requests.js';
import { registerStreamRoutes } from './streams.js';
import type { RequestSidecar } from './sidecar.js';
import { PgActionStore, type Db } from './db/store.js';

export interface AppDeps {
  db: Db;
  store: PgActionStore;
  sidecar: SidecarClient;
  requestSidecar: RequestSidecar;
  cipher: FieldCipher;
  /** Minimum stream settlement (zat); mandate default 100_000. */
  minPayoutZat?: bigint;
  network: Network;
  now: () => number;
  /** Secure cookies need HTTPS; tests run over plain inject. */
  secureCookies: boolean;
  /** Exact allowed browser origin for CORS-sensitive routes. */
  appOrigin: string;
}

const ACTION_TTL_S = 15 * 60;
const OPAQUE_REF = /^[A-Za-z0-9_-]{8,64}$/;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** What callers may see of an action: no recipient address, no memo text (U3/U4). */
function publicView(a: ActionRecord) {
  return {
    id: a.id,
    type: a.type,
    network: a.network,
    state: a.state,
    amount_zat: a.amount_zat.toString(),
    txid: a.txid ?? null,
    broadcast_ambiguous: a.broadcast_ambiguous ?? false,
    proposal_hash: a.proposal_hash ?? null,
    reject_reason: a.reject_reason ?? null,
    expires_at: a.expires_at,
  };
}

const SendBody = z.object({
  wallet: z.string().regex(/^[a-z0-9-]{1,32}$/),
  to: z.string().min(1).max(512),
  amount_zec: z.string().max(32),
  memo_ref: z.string().regex(OPAQUE_REF).optional(),
}).strict();

const AuthorizeBody = z.object({ signature: z.string().regex(/^[0-9a-f]{128}$/) }).strict();
const LoginBody = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) }).strict();

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  // Request logging is minimal and never includes bodies (MetadataPolicy).
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });

  const user = async (req: FastifyRequest): Promise<SessionUser | null> =>
    sessionUser(deps.db, parseCookies(req.headers.cookie)[SESSION_COOKIE], deps.now());

  /** Same 404 for "does not exist" and "not yours" (U6). */
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'NOT_FOUND' });

  const sameOrigin = (req: FastifyRequest) => {
    const o = req.headers.origin;
    return o === undefined || o === deps.appOrigin;
  };

  app.addHook('onRequest', async (req, reply) => {
    // State-changing requests from a browser must come from the app origin (CSRF defense in
    // addition to SameSite=Strict cookies).
    if (req.method !== 'GET' && !sameOrigin(req)) return reply.code(403).send({ error: 'BAD_ORIGIN' });
  });

  registerRequestRoutes(app, { db: deps.db, cipher: deps.cipher, sidecar: deps.requestSidecar, network: deps.network, now: deps.now, user });
  registerStreamRoutes(app, {
    db: deps.db,
    store: deps.store,
    cipher: deps.cipher,
    sidecar: deps.sidecar,
    requestSidecar: deps.requestSidecar,
    network: deps.network,
    now: deps.now,
    user,
    minPayoutZat: deps.minPayoutZat ?? 100_000n,
  });

  app.get('/v1/health', async () => ({ ok: true, network: deps.network }));

  app.post('/v1/auth/login', async (req, reply) => {
    const body = LoginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    const r = await login(deps.db, body.data.username, body.data.password, deps.now());
    if (!r) return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    const secure = deps.secureCookies ? '; Secure' : '';
    reply.header('set-cookie', `${SESSION_COOKIE}=${r.token}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_S}`);
    return { user: { username: r.user.username, role: r.user.role } };
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    await logout(deps.db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    reply.header('set-cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return { ok: true };
  });

  /** Owner sends from a Lute-operated wallet. Requires an Idempotency-Key header. */
  app.post('/v1/actions/send', async (req, reply) => {
    const u = await user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (u.role !== 'owner') return notFound(reply);
    const idem = req.headers['idempotency-key'];
    if (typeof idem !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(idem)) return reply.code(400).send({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    const body = SendBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    let amount: bigint;
    try {
      amount = parseZec(body.data.amount_zec);
    } catch (e) {
      if (e instanceof AmountError) return reply.code(400).send({ error: 'BAD_AMOUNT' });
      throw e;
    }

    const existing = await deps.store.findByIdempotency(u.id, idem);
    const action =
      existing ??
      (await deps.store.create(
        {
          id: opaqueId(),
          type: 'SEND',
          network: deps.network,
          state: 'CREATED',
          amount_zat: amount,
          wallet: body.data.wallet,
          recipient_address: body.data.to,
          ...(body.data.memo_ref ? { memo: { kind: 'lute_ref' as const, ref: body.data.memo_ref }, memo_text: `LUTE:${body.data.memo_ref}` } : {}),
          idempotency_key: idem,
          expires_at: deps.now() + ACTION_TTL_S,
        },
        u.id,
      ));
    const principal: Principal = { kind: 'owner', id: u.id, authenticated: true };
    const result = await executeAction(
      { store: deps.store, sidecar: deps.sidecar, configured_network: deps.network, now: deps.now, newId: opaqueId },
      { actionId: action.id, principal, caller: 'api', idempotencyKey: idem },
    );
    return { action_id: action.id, result };
  });

  /** The owner submits the signature made with tools/lute-owner over `sign_message`. */
  app.post<{ Params: { id: string } }>('/v1/actions/:id/authorize', async (req, reply) => {
    const u = await user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const a = await deps.store.getForUser(req.params.id, u.id);
    if (!a || u.role !== 'owner') return notFound(reply);
    const body = AuthorizeBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    try {
      const result = await executeAction(
        { store: deps.store, sidecar: deps.sidecar, configured_network: deps.network, now: deps.now, newId: opaqueId },
        {
          actionId: a.id,
          principal: { kind: 'owner', id: u.id, authenticated: true },
          caller: 'api',
          idempotencyKey: a.idempotency_key,
          ownerSignature: body.data.signature,
        },
      );
      return { action_id: a.id, result };
    } catch (e) {
      if (e instanceof IdempotencyMismatch) return reply.code(409).send({ error: 'IDEMPOTENCY_MISMATCH' });
      throw e;
    }
  });

  app.get<{ Params: { id: string } }>('/v1/actions/:id', async (req, reply) => {
    const u = await user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const a = await deps.store.getForUser(req.params.id, u.id);
    if (!a) return notFound(reply);
    return publicView(a);
  });

  /** Privacy Center feed: recent LuteGuard decisions (reason codes only). Owner only. */
  app.get('/v1/privacy/decisions', async (req, reply) => {
    const u = await user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (u.role !== 'owner') return notFound(reply);
    const rows = await deps.store.recentDecisions(50);
    return {
      decisions: rows.map((d) => ({
        decision_id: d.decision_id,
        action_id: d.action_id,
        policy_version: d.policy_version,
        outcome: d.outcome,
        checks: d.checks,
        evaluated_at: d.evaluated_at,
      })),
    };
  });

  app.setErrorHandler((err: { statusCode?: number; code?: string; name?: string; stack?: string }, req, reply) => {
    // Never echo internal details (they may contain addresses) (U4). Client errors raised by
    // Fastify itself (415, 400, 413) keep their status and expose only their code.
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status < 500) return reply.code(status).send({ error: err.code ?? 'BAD_REQUEST' });
    // Log only the error class/code, route and code locations: never the message.
    const frames = (err.stack ?? '').split('\n').slice(1, 6).map((l) => (l.match(/\(?([^()\s]+:\d+:\d+)\)?$/) ?? [])[1]).filter(Boolean);
    console.error(JSON.stringify({ level: 'error', route: req.routeOptions.url, name: err.name, code: err.code, frames }));
    return reply.code(500).send({ error: 'INTERNAL' });
  });

  return app;
}
