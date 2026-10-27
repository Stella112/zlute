/**
 * Agents and metered billing (mandate §19.6, §19.8, §13.3).
 *
 * - The owner registers a metered service (an operator-run demo API that receives into a fixed
 *   `merchant` address; payments are matched by memo).
 * - The owner drafts a mandate for the `agent` wallet bounded to that service's address, signs it
 *   on their own machine (`lute-owner sign-mandate`), and registers it. The SIDECAR verifies the
 *   signature and bounds and loads it; only then does the API create a grant and a one-time token.
 * - The agent (MCP or SDK) authenticates with that token, uses the metered API, and settles what
 *   it owes. Settlements go through executeAction: LuteGuard checks the grant (op, per-tx cap,
 *   remaining budget, recipient, expiry), then the sidecar re-checks the mandate atomically.
 *   Recipients are resolved server-side from the grant's service, never from agent input (A8).
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AmountError, executeAction, parseZec, type ActionState, type SidecarClient } from '@lute/core';
import type { AgentGrant, Caller, Network, Principal } from '@lute/luteguard';
import { walletOf, type SessionUser } from './auth.js';
import { opaqueId, type FieldCipher } from './crypto.js';
import { MAX_CHARS, extract, pagesOf } from './extract.js';
import { actions, agentGrants, meterQuotes, meterServices, meterSessions, meterSettlements } from './db/schema.js';
import type { Db, PgActionStore } from './db/store.js';
import { minConf } from './requests.js';
import type { MandateSidecar, RequestSidecar } from './sidecar.js';

export interface AgentDeps {
  db: Db;
  store: PgActionStore;
  cipher: FieldCipher;
  sidecar: SidecarClient;
  requestSidecar: RequestSidecar;
  mandates: MandateSidecar;
  network: Network;
  now: () => number;
  user: (req: FastifyRequest) => Promise<SessionUser | null>;
}

const ID = /^[A-Za-z0-9_-]{22}$/;
const NOT_SPENT: ActionState[] = ['REJECTED', 'FAILED', 'EXPIRED', 'CANCELLED'];
const PENDING: ReadonlySet<string> = new Set(['CREATED', 'VALIDATING', 'AWAITING_AUTHORIZATION', 'AUTHORIZED', 'PREPARING', 'SUBMITTED', 'PENDING_CONFIRMATION']);
const PAID: ReadonlySet<string> = new Set(['CONFIRMED', 'RECONCILED']);

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Sorted-key compact JSON (what lute-owner and the sidecar hash). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

const ExtractBody = z.object({ text: z.string().min(1).max(MAX_CHARS), quote_id: z.string().regex(/^[A-Za-z0-9_-]{22}$/).optional() }).strict();
const QuoteBody = z.object({ text: z.string().min(1).max(MAX_CHARS) }).strict();
/** A quote is valid for two minutes and for one call. */
const QUOTE_TTL_S = 120;
const requestHash = (text: string) => createHash('sha256').update(`lute-extract-request-v1|${text}`, 'utf8').digest('hex');
const ServiceBody = z.object({ name: z.string().min(1).max(64), price_per_call_zat: z.number().int().min(1).max(2_000_000), credit_limit_zat: z.number().int().min(1).max(2_000_000) }).strict();
const DraftBody = z.object({ service_id: z.string().regex(ID), max_tx_zec: z.string().max(32), total_zec: z.string().max(32), ttl_hours: z.number().int().min(1).max(48) }).strict();
const MandateShape = z
  .object({
    mandate_id: z.string().regex(/^[0-9a-f]{32}$/),
    network: z.string(),
    wallet: z.string(),
    purpose: z.string(),
    max_tx_zat: z.number().int().positive(),
    total_zat: z.number().int().positive(),
    allowed_recipients: z.array(z.string()).min(1).max(16),
    expires_at: z.number().int().positive(),
    nonce: z.string().min(1).max(64),
  })
  .strict();
const GrantBody = z.object({ agent_name: z.string().regex(/^[A-Za-z0-9 _.-]{1,48}$/), service_id: z.string().regex(ID), mandate: MandateShape, signature: z.string().regex(/^[0-9a-f]{128}$/) }).strict();

export function registerAgentRoutes(app: FastifyInstance, d: AgentDeps): void {
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'NOT_FOUND' });
  const svcAad = (id: string) => `lute-meter-service|${id}|address`;
  let lastServiceSync = 0;
  // Settlements for one grant run one at a time: "what is due" and "what is left of the budget"
  // are read and acted on without another settlement interleaving (R1). The sidecar's mandate
  // reservation is atomic as well, so a second API process could not overspend either.
  const settling = new Map<string, Promise<unknown>>();
  function serialized<T>(key: string, f: () => Promise<T>): Promise<T> {
    const prev = settling.get(key) ?? Promise.resolve();
    const run = prev.then(f, f);
    const tail = run.catch(() => undefined);
    settling.set(key, tail);
    void tail.then(() => {
      if (settling.get(key) === tail) settling.delete(key);
    });
    return run;
  }

  async function owner(req: FastifyRequest) {
    const u = await d.user(req);
    return u?.role === 'owner' ? u : null;
  }

  /** Agent auth: `Authorization: Bearer lute_agent_…`. Owner cookies are not accepted here. */
  async function agent(req: FastifyRequest) {
    const h = req.headers.authorization;
    if (typeof h !== 'string' || !h.startsWith('Bearer lute_agent_')) return null;
    const rows = await d.db.select().from(agentGrants).where(eq(agentGrants.token_hash, sha256(h.slice(7)))).limit(1);
    return rows[0] ?? null;
  }

  async function spent(grantId: string): Promise<bigint> {
    const r = await d.db
      .select({ s: sql<string>`COALESCE(SUM(${actions.amount_zat}), 0)` })
      .from(actions)
      .where(and(eq(actions.grant_id, grantId), notInArray(actions.state, NOT_SPENT)));
    return BigInt(r[0]?.s ?? 0);
  }

  async function service(id: string) {
    return (await d.db.select().from(meterServices).where(eq(meterServices.id, id)).limit(1))[0] ?? null;
  }

  async function grantView(g: typeof agentGrants.$inferSelect) {
    const s = await spent(g.id);
    const svc = await service(g.service_id);
    const m = await d.mandates.mandateStatus(g.wallet, g.mandate_id).catch(() => null);
    return {
      grant_id: g.id,
      agent_name: g.agent_name,
      network: g.network,
      wallet: g.wallet,
      service: svc ? { id: svc.id, name: svc.name, price_per_call_zat: svc.price_per_call_zat.toString(), credit_limit_zat: svc.credit_limit_zat.toString() } : null,
      cap_per_tx_zat: g.cap_per_tx_zat.toString(),
      cap_total_zat: g.cap_total_zat.toString(),
      spent_zat: s.toString(),
      remaining_zat: (g.cap_total_zat > s ? g.cap_total_zat - s : 0n).toString(),
      expires_at: g.expires_at,
      revoked: g.revoked_at !== null,
      mandate: { id: g.mandate_id, hash: g.mandate_hash, sidecar: m && m.ok ? { committed_zat: m.value.committed_zat, remaining_zat: m.value.remaining_zat } : null },
    };
  }

  // ---------------- owner ----------------

  app.post('/v1/meter/services', async (req, reply) => {
    const u = await owner(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const b = ServiceBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    const id = opaqueId();
    const address = await d.requestSidecar.newAddress(walletOf(u, 'merchant'));
    await d.db.insert(meterServices).values({
      id,
      owner_user_id: u.id,
      name: b.data.name,
      wallet: walletOf(u, 'merchant'),
      address_enc: d.cipher.encrypt(address, svcAad(id)),
      price_per_call_zat: BigInt(b.data.price_per_call_zat),
      credit_limit_zat: BigInt(b.data.credit_limit_zat),
      created_at: d.now(),
    });
    return { id, name: b.data.name, price_per_call_zat: String(b.data.price_per_call_zat), credit_limit_zat: String(b.data.credit_limit_zat) };
  });

  app.get('/v1/meter/services', async (req, reply) => {
    const u = await owner(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const rows = await d.db.select().from(meterServices).where(eq(meterServices.owner_user_id, u.id)).orderBy(desc(meterServices.created_at));
    return { services: rows.map((s) => ({ id: s.id, name: s.name, price_per_call_zat: s.price_per_call_zat.toString(), credit_limit_zat: s.credit_limit_zat.toString(), created_at: s.created_at })) };
  });

  /** Builds the exact mandate the owner will review and sign with `lute-owner sign-mandate`. */
  app.post('/v1/agent/mandates/draft', async (req, reply) => {
    const u = await owner(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const b = DraftBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    const svc = await service(b.data.service_id);
    if (!svc || svc.owner_user_id !== u.id) return notFound(reply);
    let maxTx: bigint;
    let total: bigint;
    try {
      maxTx = parseZec(b.data.max_tx_zec);
      total = parseZec(b.data.total_zec);
    } catch (e) {
      if (e instanceof AmountError) return reply.code(400).send({ error: 'BAD_AMOUNT' });
      throw e;
    }
    const mandate = {
      allowed_recipients: [d.cipher.decrypt(svc.address_enc, svcAad(svc.id))],
      expires_at: d.now() + b.data.ttl_hours * 3600,
      mandate_id: randomBytes(16).toString('hex'),
      max_tx_zat: Number(maxTx),
      network: d.network,
      nonce: randomBytes(8).toString('hex'),
      purpose: 'agent',
      total_zat: Number(total),
      wallet: walletOf(u, 'agent'),
    };
    return { mandate, mandate_hash: sha256(canonical(mandate)) };
  });

  /** Registers a signed mandate: the sidecar verifies and loads it, then a grant + token is issued. */
  app.post('/v1/agent/grants', async (req, reply) => {
    const u = await owner(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const b = GrantBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    const svc = await service(b.data.service_id);
    if (!svc || svc.owner_user_id !== u.id) return notFound(reply);
    const m = b.data.mandate;
    const svcAddress = d.cipher.decrypt(svc.address_enc, svcAad(svc.id));
    // The grant may only pay this service: the mandate must be bound to exactly its address.
    if (m.wallet !== walletOf(u, 'agent') || m.network !== d.network || m.allowed_recipients.length !== 1 || m.allowed_recipients[0] !== svcAddress) {
      return reply.code(400).send({ error: 'MANDATE_DOES_NOT_MATCH_SERVICE' });
    }
    const loaded = await d.mandates.loadMandate(walletOf(u, 'agent'), canonical(m), b.data.signature);
    if (!loaded.ok) return reply.code(403).send({ error: loaded.code });
    const token = `lute_agent_${randomBytes(32).toString('base64url')}`;
    const id = opaqueId();
    await d.db.insert(agentGrants).values({
      id,
      owner_user_id: u.id,
      agent_name: b.data.agent_name,
      wallet: walletOf(u, 'agent'),
      network: d.network,
      service_id: svc.id,
      mandate_id: m.mandate_id,
      mandate_hash: loaded.value.mandate_hash,
      cap_per_tx_zat: BigInt(m.max_tx_zat),
      cap_total_zat: BigInt(m.total_zat),
      expires_at: m.expires_at,
      revoked_at: null,
      token_hash: sha256(token),
      created_at: d.now(),
    });
    const g = (await d.db.select().from(agentGrants).where(eq(agentGrants.id, id)).limit(1))[0]!;
    reply.header('cache-control', 'no-store');
    return { ...(await grantView(g)), token, token_note: 'Shown once. Lute stores only its hash.' };
  });

  app.get('/v1/agent/grants', async (req, reply) => {
    const u = await owner(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const rows = await d.db.select().from(agentGrants).where(eq(agentGrants.owner_user_id, u.id)).orderBy(desc(agentGrants.created_at));
    return { grants: await Promise.all(rows.map(grantView)) };
  });

  app.post<{ Params: { id: string } }>('/v1/agent/grants/:id/revoke', async (req, reply) => {
    const u = await owner(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const g = (await d.db.select().from(agentGrants).where(and(eq(agentGrants.id, req.params.id), eq(agentGrants.owner_user_id, u.id))).limit(1))[0];
    if (!g) return notFound(reply);
    await d.db.update(agentGrants).set({ revoked_at: d.now() }).where(eq(agentGrants.id, g.id));
    return grantView({ ...g, revoked_at: d.now() });
  });

  // ---------------- agent ----------------

  app.get('/v1/agent/me', async (req, reply) => {
    const g = await agent(req);
    if (!g) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    return grantView(g);
  });

  async function session(g: typeof agentGrants.$inferSelect, id: string) {
    if (!ID.test(id)) return null;
    return (await d.db.select().from(meterSessions).where(and(eq(meterSessions.id, id), eq(meterSessions.grant_id, g.id))).limit(1))[0] ?? null;
  }

  async function sessionView(s: typeof meterSessions.$inferSelect) {
    const svc = (await service(s.service_id))!;
    const rows = await d.db.select().from(meterSettlements).where(eq(meterSettlements.session_id, s.id)).orderBy(asc(meterSettlements.seq));
    const states = rows.length ? await d.db.select({ id: actions.id, state: actions.state, txid: actions.txid, reject_reason: actions.reject_reason }).from(actions).where(inArray(actions.id, rows.map((r) => r.action_id))) : [];
    const byId = new Map(states.map((a) => [a.id, a]));
    let pending = 0n;
    let paid = 0n;
    const settlements = rows.map((r) => {
      const a = byId.get(r.action_id);
      const st = a?.state ?? 'FAILED';
      if (PENDING.has(st)) pending += r.amount_zat;
      if (PAID.has(st)) paid += r.amount_zat;
      return { seq: r.seq, action_id: r.action_id, amount_zat: r.amount_zat.toString(), state: st, txid: a?.txid ?? null, reason: a?.reject_reason ?? null };
    });
    const usage = BigInt(s.calls) * svc.price_per_call_zat;
    const due = usage - paid - pending;
    return {
      id: s.id,
      service: { id: svc.id, name: svc.name, price_per_call_zat: svc.price_per_call_zat.toString(), credit_limit_zat: svc.credit_limit_zat.toString() },
      calls: s.calls,
      usage_zat: usage.toString(),
      pending_zat: pending.toString(),
      paid_zat: paid.toString(),
      due_zat: (due > 0n ? due : 0n).toString(),
      settlements,
    };
  }

  app.post('/v1/meter/sessions', async (req, reply) => {
    const g = await agent(req);
    if (!g) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const id = opaqueId();
    await d.db.insert(meterSessions).values({ id, grant_id: g.id, service_id: g.service_id, calls: 0, created_at: d.now(), updated_at: d.now() });
    return sessionView((await d.db.select().from(meterSessions).where(eq(meterSessions.id, id)).limit(1))[0]!);
  });

  app.get<{ Params: { id: string } }>('/v1/meter/sessions/:id', async (req, reply) => {
    const g = await agent(req);
    if (!g) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const s = await session(g, req.params.id);
    return s ? sessionView(s) : notFound(reply);
  });

  /**
   * The metered demo API: one call returns the current Zcash chain tip as seen by Lute's light
   * client, and costs `price_per_call_zat`. Over the credit limit it answers 402 until paid.
   */
  app.post<{ Params: { id: string } }>('/v1/meter/sessions/:id/call', async (req, reply) => {
    const g = await agent(req);
    if (!g) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const s = await session(g, req.params.id);
    if (!s) return notFound(reply);
    const v = await sessionView(s);
    const svc = (await service(s.service_id))!;
    if (BigInt(v.due_zat) + svc.price_per_call_zat > svc.credit_limit_zat) {
      return reply.code(402).send({ error: 'PAYMENT_REQUIRED', due_zat: v.due_zat, credit_limit_zat: v.service.credit_limit_zat });
    }
    // Keep the answer current: the service wallet syncs at most once a minute.
    if (d.now() - lastServiceSync >= 60) {
      await d.requestSidecar.sync(svc.wallet).catch(() => undefined);
      lastServiceSync = d.now();
    }
    const b = await d.requestSidecar.balance(svc.wallet);
    await d.db.update(meterSessions).set({ calls: sql`${meterSessions.calls} + 1`, updated_at: d.now() }).where(eq(meterSessions.id, s.id));
    return {
      call: s.calls + 1,
      charged_zat: svc.price_per_call_zat.toString(),
      result: { network: d.network, chain_tip_height: b.chain_tip_height, observed_at: d.now() },
      ...(await billing(g, s.id)),
    };
  });

  /**
   * What the agent is told after each charge: usage and what is due on the session, what is left of
   * its budget, and how payment happens (batched, one shielded payment per settlement, with the
   * network fee paid by the agent wallet on top of the budgeted amount).
   */
  async function billing(g: typeof agentGrants.$inferSelect, sessionId: string) {
    const s = (await d.db.select().from(meterSessions).where(eq(meterSessions.id, sessionId)).limit(1))[0]!;
    const v = await sessionView(s);
    const remaining = g.cap_total_zat - (await spent(g.id));
    const due = BigInt(v.due_zat);
    return {
      session: { usage_zat: v.usage_zat, due_zat: v.due_zat, paid_zat: v.paid_zat, pending_zat: v.pending_zat, credit_limit_zat: v.service.credit_limit_zat },
      budget: {
        remaining_zat: (remaining > 0n ? remaining : 0n).toString(),
        per_payment_cap_zat: g.cap_per_tx_zat.toString(),
        due_is_payable: due <= remaining && due <= g.cap_per_tx_zat,
        ...(due > remaining ? { note: 'What is due exceeds the remaining budget: a settlement will be refused (OVER_GRANT_TOTAL).' } : due > g.cap_per_tx_zat ? { note: 'What is due exceeds the per-payment cap: a settlement will be refused (OVER_GRANT_PER_TX).' } : {}),
      },
      settlement: {
        batched: true,
        how: 'Charges accrue on the session. One shielded Zcash payment settles everything due, when you call lute_propose_settlement or when the credit limit is reached (402).',
        network_fee_zat: '10000',
        network_fee_note: 'ZIP-317 fee per settlement, paid by the agent wallet in addition to the budgeted amount.',
      },
    };
  }

  /**
   * Metered document extraction: text in, structured fields out, charged per page (2,000
   * characters) at the service's price. The text is used in memory only: never stored, never
   * logged, and only its size reaches the database (as billed pages).
   */
  /**
   * One-time quote for an extraction: binds the price, the service, this session and the exact
   * document (by hash; the text is not stored). Valid for one call within two minutes.
   */
  app.post<{ Params: { id: string } }>('/v1/meter/sessions/:id/quote', async (req, reply) => {
    const g = await agent(req);
    if (!g) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const s = await session(g, req.params.id);
    if (!s) return notFound(reply);
    const body = QuoteBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'BAD_REQUEST', reason: `Send {"text": "..."} with 1 to ${MAX_CHARS} characters.` });
    const svc = (await service(s.service_id))!;
    const pages = pagesOf(body.data.text);
    const amount = BigInt(pages) * svc.price_per_call_zat;
    const id = opaqueId();
    const expires_at = d.now() + QUOTE_TTL_S;
    await d.db.insert(meterQuotes).values({ id, session_id: s.id, service_id: svc.id, pages, amount_zat: amount, request_hash: requestHash(body.data.text), expires_at, created_at: d.now() });
    return {
      quote_id: id,
      service: svc.name,
      pages,
      price_per_page_zat: svc.price_per_call_zat.toString(),
      amount_zat: amount.toString(),
      expires_at,
      binds: 'this session, this service, this price and this exact text; one use',
      ...(await billing(g, s.id)),
    };
  });

  app.post<{ Params: { id: string } }>('/v1/meter/sessions/:id/extract', async (req, reply) => {
    const g = await agent(req);
    if (!g) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const s = await session(g, req.params.id);
    if (!s) return notFound(reply);
    const body = ExtractBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'BAD_REQUEST', reason: `Send {"text": "..."} with 1 to ${MAX_CHARS} characters.` });
    const svc = (await service(s.service_id))!;
    let pages = pagesOf(body.data.text);
    let charge = BigInt(pages) * svc.price_per_call_zat;
    let quoteId: string | null = null;
    if (body.data.quote_id) {
      const q = (await d.db.select().from(meterQuotes).where(and(eq(meterQuotes.id, body.data.quote_id), eq(meterQuotes.session_id, s.id))).limit(1))[0];
      if (!q) return reply.code(404).send({ error: 'UNKNOWN_QUOTE' });
      if (q.used_at !== null) return reply.code(409).send({ error: 'QUOTE_ALREADY_USED' });
      if (d.now() >= q.expires_at) return reply.code(410).send({ error: 'QUOTE_EXPIRED', reason: 'Ask for a new quote.' });
      if (q.service_id !== svc.id || q.request_hash !== requestHash(body.data.text)) {
        return reply.code(409).send({ error: 'QUOTE_MISMATCH', reason: 'The quote was for a different document or service.' });
      }
      pages = q.pages;
      charge = q.amount_zat;
      quoteId = q.id;
    }
    const v = await sessionView(s);
    if (BigInt(v.due_zat) + charge > svc.credit_limit_zat) {
      return reply.code(402).send({
        error: 'PAYMENT_REQUIRED',
        reason: `This document (${pages} page${pages === 1 ? '' : 's'}) would take the unpaid amount past the credit limit. Settle what is due first.`,
        would_charge_zat: charge.toString(),
        due_zat: v.due_zat,
        credit_limit_zat: v.service.credit_limit_zat,
      });
    }
    if (quoteId) {
      // Consume the quote atomically: of two calls racing on one quote, only one is served.
      const used = await d.db.update(meterQuotes).set({ used_at: d.now() }).where(and(eq(meterQuotes.id, quoteId), isNull(meterQuotes.used_at))).returning({ id: meterQuotes.id });
      if (used.length === 0) return reply.code(409).send({ error: 'QUOTE_ALREADY_USED' });
    }
    const result = extract(body.data.text);
    await d.db.update(meterSessions).set({ calls: sql`${meterSessions.calls} + ${pages}`, updated_at: d.now() }).where(eq(meterSessions.id, s.id));
    return {
      result,
      charge: { pages, price_per_page_zat: svc.price_per_call_zat.toString(), charged_zat: charge.toString(), ...(quoteId ? { quote: 'honoured' } : {}) },
      ...(await billing(g, s.id)),
    };
  });

  /** Pays what the session owes, from the agent wallet, under the grant and its mandate. */
  app.post<{ Params: { id: string } }>('/v1/meter/sessions/:id/settle', async (req, reply) => {
    const g = await agent(req);
    if (!g) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const s = await session(g, req.params.id);
    if (!s) return notFound(reply);
    const idem = req.headers['idempotency-key'];
    if (typeof idem !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(idem)) return reply.code(400).send({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    const caller: Caller = req.headers['x-lute-caller'] === 'mcp' ? 'mcp' : 'sdk';
    return serialized(g.id, () => settle(g, s, idem, caller, reply));
  });

  async function settle(g: typeof agentGrants.$inferSelect, s: typeof meterSessions.$inferSelect, idem: string, caller: Caller, reply: FastifyReply) {
    // Re-read the grant inside the lock: a revocation that landed while waiting applies.
    g = (await d.db.select().from(agentGrants).where(eq(agentGrants.id, g.id)).limit(1))[0]!;
    s = (await d.db.select().from(meterSessions).where(eq(meterSessions.id, s.id)).limit(1))[0]!;
    let action = await d.store.findByIdempotency(g.owner_user_id, `agent:${g.id}:${idem}`);
    if (!action) {
      const v = await sessionView(s);
      const amount = BigInt(v.due_zat);
      if (amount <= 0n) return reply.code(409).send({ error: 'NOTHING_DUE' });
      const svc = (await service(s.service_id))!;
      const ref = opaqueId();
      action = await d.store.create(
        {
          id: opaqueId(),
          type: 'METER_SETTLEMENT',
          network: d.network,
          state: 'CREATED',
          amount_zat: amount,
          wallet: g.wallet,
          // Resolved server-side from the grant's service; the agent supplies no address (A8).
          recipient_address: d.cipher.decrypt(svc.address_enc, svcAad(svc.id)),
          recipient_ref: svc.id,
          memo: { kind: 'lute_ref', ref },
          memo_text: `LUTE:${ref}`,
          idempotency_key: `agent:${g.id}:${idem}`,
          expires_at: d.now() + 15 * 60,
        },
        g.owner_user_id,
        g.id,
      );
      await d.db.insert(meterSettlements).values({ session_id: s.id, seq: v.settlements.length + 1, action_id: action.id, amount_zat: amount, created_at: d.now() });
    }
    // The spent total excludes this action itself (it is the one being checked).
    const spentOthers = (await spent(g.id)) - (action.state === 'CREATED' ? action.amount_zat : 0n);
    const grant: AgentGrant = {
      grant_id: g.id,
      allowed_ops: ['METER_SETTLEMENT'],
      cap_total_zat: g.cap_total_zat,
      cap_per_tx_zat: g.cap_per_tx_zat,
      spent_zat: spentOthers,
      allowed_recipients: [g.service_id],
      expires_at: g.expires_at,
      ...(g.revoked_at !== null ? { revoked_at: g.revoked_at } : {}),
      mandate_id: g.mandate_id,
    };
    const principal: Principal = { kind: 'agent', id: g.id, authenticated: true, grant };
    // The wallet must know the current tip before a proposal is built: its expiry height is
    // derived from it, and a stale tip yields a transaction that is already expired.
    if (action.state === 'CREATED') await d.requestSidecar.sync(g.wallet);
    const result = await executeAction(
      { store: d.store, sidecar: d.sidecar, configured_network: d.network, now: d.now, newId: opaqueId },
      { actionId: action.id, principal, caller, idempotencyKey: action.idempotency_key },
    );
    return { action_id: action.id, result };
  }

  /** Moves submitted settlements to CONFIRMED once mined with enough confirmations. */
  app.post<{ Params: { id: string } }>('/v1/meter/sessions/:id/refresh', async (req, reply) => {
    const g = await agent(req);
    if (!g) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const s = await session(g, req.params.id);
    if (!s) return notFound(reply);
    await d.requestSidecar.sync(g.wallet);
    const v = await sessionView(s);
    for (const row of v.settlements) {
      if (!row.txid || (row.state !== 'SUBMITTED' && row.state !== 'PENDING_CONFIRMATION')) continue;
      const st = await d.requestSidecar.txStatus(g.wallet, row.txid);
      if (st.expired_unmined && st.mined_height === null) {
        await d.store.transition(row.action_id, row.state as ActionState, 'FAILED', 'system', { reject_reason: 'EXPIRED_UNMINED' });
        continue;
      }
      let state = row.state as ActionState;
      if (state === 'SUBMITTED' && st.mined_height !== null) {
        await d.store.transition(row.action_id, 'SUBMITTED', 'PENDING_CONFIRMATION', 'system');
        state = 'PENDING_CONFIRMATION';
      }
      if (state === 'PENDING_CONFIRMATION' && st.confirmations >= minConf(d.network)) {
        await d.store.transition(row.action_id, 'PENDING_CONFIRMATION', 'CONFIRMED', 'system');
      }
    }
    return sessionView(s);
  });
}
