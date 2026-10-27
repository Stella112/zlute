import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AmountError, executeAction, IdempotencyMismatch, parseZec, type ActionRecord, type ProposalView, type SidecarClient, type SidecarResult } from '@lute/core';
import type { Network, Principal } from '@lute/luteguard';
import { createUser, login, logout, SESSION_COOKIE, SESSION_TTL_S, sessionUser, WALLET_ROLES, walletOf, type SessionUser } from './auth.js';
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { users } from './db/schema.js';
import { opaqueId, type FieldCipher } from './crypto.js';
import { registerAgentRoutes } from './agents.js';
import { registerPayrollRoutes } from './payroll.js';
import { registerCommerceRoutes } from './commerce.js';
import { registerGroupRoutes } from './groups.js';
import { registerSubscriptionRoutes } from './subscriptions.js';
import { registerDashboardRoutes } from './dashboard.js';
import { registerRequestRoutes } from './requests.js';
import { registerStreamRoutes } from './streams.js';
import type { MandateSidecar, PcztView, RequestSidecar, WalletAdmin } from './sidecar.js';
import { PgActionStore, type Db } from './db/store.js';
import { clientIp, LIMITS, RateLimiter } from './ratelimit.js';

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
  /** evidence/results.json (Privacy Center input). */
  resultsFile?: string;
  /** Agent mandates. Without it, agent and meter routes do not exist (fail closed). */
  mandates?: MandateSidecar;
  /** Self-serve sign-up (own wallets per user). Without it, sign-up does not exist. */
  walletAdmin?: WalletAdmin;
  /** Payroll: re-reads a stored proposal for approving a run prepared earlier. */
  proposals?: { showProposal(wallet: string, proposalId: string): Promise<SidecarResult<ProposalView>> };
  /** Browser-signed wallets: builds the unsigned transaction the browser signs. */
  pczt?: { preparePczt(wallet: string, proposalId: string): Promise<SidecarResult<PcztView>> };
  /** Most accounts the install accepts through sign-up. */
  maxUsers?: number;
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
  wallet: z.enum(['merchant', 'payout', 'agent']),
  to: z.string().min(1).max(512),
  amount_zec: z.string().max(32),
  memo_ref: z.string().regex(OPAQUE_REF).optional(),
}).strict();

const AuthorizeBody = z
  .object({
    signature: z.string().regex(/^[0-9a-f]{128}$/),
    /** Browser-signed wallets: spend-authorization signatures over the prepared transaction. */
    spend_auth_sigs: z.array(z.object({ index: z.number().int().min(0).max(1000), sig: z.string().regex(/^[0-9a-f]{128}$/) }).strict()).min(1).max(50).optional(),
  })
  .strict();
const LoginBody = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) }).strict();
const SignupBody = z
  .object({
    username: z.string().regex(/^[a-z0-9_]{3,32}$/),
    password: z.string().min(12).max(256),
    /** Ed25519 public key generated in the user's browser; it approves this user's spends. */
    owner_pub: z.string().regex(/^[0-9a-f]{64}$/),
    /**
     * Non-custodial sign-up: viewing keys derived from a seed that stays in the browser. The
     * merchant and payout wallets are then created without any seed on the server.
     */
    ufvks: z.object({ merchant: z.string().min(20).max(1024), payout: z.string().min(20).max(1024) }).strict().optional(),
  })
  .strict();

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  // Request logging is minimal and never includes bodies (MetadataPolicy).
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });

  const user = async (req: FastifyRequest): Promise<SessionUser | null> =>
    sessionUser(deps.db, parseCookies(req.headers.cookie)[SESSION_COOKIE], deps.now());

  /** Same 404 for "does not exist" and "not yours" (U6). */
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'NOT_FOUND' });

  // LUTE_APP_ORIGIN may list several origins (public site + the owner's SSH-tunnel origin).
  const origins = new Set(deps.appOrigin.split(',').map((o) => o.trim()).filter(Boolean));
  const sameOrigin = (req: FastifyRequest) => {
    const o = req.headers.origin;
    return o === undefined || origins.has(o);
  };
  const limiter = new RateLimiter(deps.now);

  app.addHook('onRequest', async (req, reply) => {
    // State-changing requests from a browser must come from the app origin (CSRF defense in
    // addition to SameSite=Strict cookies).
    if (req.method !== 'GET' && !sameOrigin(req)) return reply.code(403).send({ error: 'BAD_ORIGIN' });
    const ip = clientIp(req);
    const kind = req.url.startsWith('/v1/auth/') ? 'auth' : req.method === 'GET' ? 'read' : 'write';
    if (!limiter.take(`${kind}|${ip}`, LIMITS[kind])) {
      reply.header('retry-after', String(LIMITS[kind].windowS));
      return reply.code(429).send({ error: 'RATE_LIMITED' });
    }
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

  registerDashboardRoutes(app, { db: deps.db, sidecar: deps.requestSidecar, network: deps.network, user, resultsFile: deps.resultsFile ?? 'evidence/results.json', store: deps.store, now: deps.now });

  registerPayrollRoutes(app, {
    db: deps.db,
    store: deps.store,
    cipher: deps.cipher,
    sidecar: deps.sidecar,
    ...(deps.proposals ? { proposals: deps.proposals } : {}),
    sync: (w) => deps.requestSidecar.sync(w),
    network: deps.network,
    now: deps.now,
    user,
  });
  registerCommerceRoutes(app, { db: deps.db, store: deps.store, cipher: deps.cipher, sidecar: deps.sidecar, requestSidecar: deps.requestSidecar, network: deps.network, now: deps.now, user });

  registerSubscriptionRoutes(app, { db: deps.db, cipher: deps.cipher, requestSidecar: deps.requestSidecar, network: deps.network, now: deps.now, user });
  registerGroupRoutes(app, { db: deps.db, cipher: deps.cipher, requestSidecar: deps.requestSidecar, network: deps.network, now: deps.now, user });

  if (deps.mandates) {
    registerAgentRoutes(app, { db: deps.db, store: deps.store, cipher: deps.cipher, sidecar: deps.sidecar, requestSidecar: deps.requestSidecar, mandates: deps.mandates, network: deps.network, now: deps.now, user });
  }

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

  /**
   * Self-serve sign-up: the sidecar creates the user's own merchant, payout and agent wallets
   * (own sealed seeds and key files) bound to the approval key their browser generated. Only then
   * is the account created. Hosted demo: these wallets are operator-custodied hot wallets.
   */
  app.post('/v1/auth/signup', async (req, reply) => {
    if (!deps.walletAdmin) return reply.code(404).send({ error: 'SIGNUP_DISABLED' });
    const body = SignupBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    if (!limiter.take('signup|global', { max: 30, windowS: 3600 })) return reply.code(429).send({ error: 'RATE_LIMITED' });
    const count = Number((await deps.db.select({ n: sql<string>`count(*)` }).from(users))[0]?.n ?? 0);
    if (count >= (deps.maxUsers ?? 500)) return reply.code(403).send({ error: 'SIGNUPS_CLOSED' });
    if ((await deps.db.select({ id: users.id }).from(users).where(eq(users.username, body.data.username)).limit(1)).length) {
      return reply.code(409).send({ error: 'USERNAME_TAKEN' });
    }
    const prefix = `u${randomBytes(5).toString('hex')}`;
    const ufvks = body.data.ufvks;
    for (const role of WALLET_ROLES) {
      // The agent wallet stays Lute-held: an agent pays unattended, inside a signed budget.
      const ufvk = ufvks && role !== 'agent' ? ufvks[role] : undefined;
      const r = await deps.walletAdmin.createWallet(walletOf({ wallet_prefix: prefix }, role), body.data.owner_pub, ufvk);
      if (!r.ok) return reply.code(r.code === 'BAD_VIEWING_KEY' ? 400 : 503).send({ error: r.code === 'BAD_VIEWING_KEY' ? 'BAD_VIEWING_KEY' : 'WALLET_CREATION_FAILED' });
    }
    await createUser(deps.db, body.data.username, body.data.password, 'owner', deps.now(), { wallet_prefix: prefix, owner_pub: body.data.owner_pub, browser_signed: !!ufvks });
    // Start the new wallets' first sync in the background so the dashboard has balances to show.
    for (const role of WALLET_ROLES) void deps.requestSidecar.sync(walletOf({ wallet_prefix: prefix }, role)).catch(() => undefined);
    const r = await login(deps.db, body.data.username, body.data.password, deps.now());
    const secure = deps.secureCookies ? '; Secure' : '';
    reply.header('set-cookie', `${SESSION_COOKIE}=${r!.token}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_S}`);
    return { user: { username: r!.user.username, role: r!.user.role } };
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
          wallet: walletOf(u, body.data.wallet),
          recipient_address: body.data.to,
          ...(body.data.memo_ref ? { memo: { kind: 'lute_ref' as const, ref: body.data.memo_ref }, memo_text: `LUTE:${body.data.memo_ref}` } : {}),
          idempotency_key: idem,
          expires_at: deps.now() + ACTION_TTL_S,
        },
        u.id,
      ));
    // The wallet must know the current tip before a proposal is built: its expiry height is
    // derived from it, and a stale tip yields a transaction that is already expired.
    // An address LuteGuard will refuse needs no wallet sync: refuse it immediately.
    const payable = action.state === 'CREATED' && (await deps.sidecar.inspect(body.data.to).catch(() => null))?.verdict === 'ALLOWED';
    if (payable) {
      await deps.requestSidecar.sync(walletOf(u, body.data.wallet));
    }
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
          ...(body.data.spend_auth_sigs ? { spendAuthSigs: body.data.spend_auth_sigs } : {}),
        },
      );
      return { action_id: a.id, result };
    } catch (e) {
      if (e instanceof IdempotencyMismatch) return reply.code(409).send({ error: 'IDEMPOTENCY_MISMATCH' });
      throw e;
    }
  });

  /**
   * Browser-signed wallets: the proved, unsigned transaction for an action awaiting approval. The
   * browser checks it pays exactly what the summary says, then signs it (services/lute-signer).
   */
  app.post<{ Params: { id: string } }>('/v1/actions/:id/pczt', async (req, reply) => {
    const u = await user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const a = await deps.store.getForUser(req.params.id, u.id);
    if (!a || u.role !== 'owner') return notFound(reply);
    if (a.state !== 'AWAITING_AUTHORIZATION' || !a.wallet || !a.proposal_id) return reply.code(409).send({ error: 'NOT_AWAITING_AUTHORIZATION' });
    if (!deps.pczt) return reply.code(404).send({ error: 'BROWSER_SIGNING_UNAVAILABLE' });
    const r = await deps.pczt.preparePczt(a.wallet, a.proposal_id);
    if (!r.ok) return reply.code(r.code === 'NOT_BROWSER_SIGNED' ? 409 : 403).send({ error: r.code });
    // The transaction must be the one LuteGuard checked and the owner is approving.
    if (r.value.proposal_hash !== a.proposal_hash) return reply.code(409).send({ error: 'PROPOSAL_HASH_MISMATCH' });
    return r.value;
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

  // Nothing the API returns may be kept by a browser, proxy or CDN cache (balances, payment state).
  app.addHook('onSend', async (_req, reply, payload) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
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
