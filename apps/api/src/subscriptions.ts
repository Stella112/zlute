/**
 * Subscriptions (mandate §19.7). A plan bills every `period_s` with a fresh payment request
 * (invoice) per subscriber. Lute never pulls funds: shielded Zcash has no auto-debit, so the
 * subscriber pays each invoice from their own wallet. Status is computed, never set by hand:
 *   ACTIVE   the current period's invoice is PAID
 *   DUE      it is unpaid and the period started less than `grace_s` ago
 *   LAPSED   it is unpaid past the grace window
 *   CANCELLED by the merchant
 * Invoices are created lazily when a period starts (on read).
 */
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AmountError, parseZec } from '@lute/core';
import type { Network } from '@lute/luteguard';
import { walletForUserId, type SessionUser } from './auth.js';
import { opaqueId, type FieldCipher } from './crypto.js';
import { paymentRequests, subscriptionInvoices, subscriptionPlans, subscriptions } from './db/schema.js';
import type { Db } from './db/store.js';
import { createRequest, refreshRequest } from './requests.js';
import type { RequestSidecar } from './sidecar.js';

export interface SubscriptionDeps {
  db: Db;
  cipher: FieldCipher;
  requestSidecar: RequestSidecar;
  network: Network;
  now: () => number;
  user: (req: FastifyRequest) => Promise<SessionUser | null>;
}

const ID = /^[A-Za-z0-9_-]{22}$/;

export type SubStatus = 'ACTIVE' | 'DUE' | 'LAPSED' | 'CANCELLED';

/** Pure status rule (tested): current period index, paid or not, grace. */
export function subscriptionStatus(p: { start_ts: number; period_s: number; grace_s: number; cancelled_at: number | null }, now: number, currentPaid: boolean): { status: SubStatus; period_no: number; period_start: number; period_end: number } {
  const period_no = Math.max(0, Math.floor((now - p.start_ts) / p.period_s));
  const period_start = p.start_ts + period_no * p.period_s;
  const period_end = period_start + p.period_s;
  if (p.cancelled_at !== null) return { status: 'CANCELLED', period_no, period_start, period_end };
  if (currentPaid) return { status: 'ACTIVE', period_no, period_start, period_end };
  return { status: now < period_start + p.grace_s ? 'DUE' : 'LAPSED', period_no, period_start, period_end };
}

const PlanBody = z.object({ name: z.string().min(1).max(80), amount_zec: z.string().max(32), period_s: z.number().int().min(60).max(366 * 86400), grace_s: z.number().int().min(0).max(30 * 86400) }).strict();
const SubBody = z.object({ plan_id: z.string().regex(ID), subscriber: z.string().min(1).max(80) }).strict();

export function registerSubscriptionRoutes(app: FastifyInstance, d: SubscriptionDeps): void {
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'NOT_FOUND' });
  const reqDeps = { db: d.db, cipher: d.cipher, sidecar: d.requestSidecar, network: d.network, now: d.now };
  const planAad = (id: string) => `lute-plan|${id}|name`;
  const subAad = (id: string) => `lute-subscription|${id}|label`;

  async function plan(id: string) {
    return (await d.db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, id)).limit(1))[0] ?? null;
  }

  /** Ensures the current period has an invoice; optionally re-checks it with the sidecar. */
  async function current(s: typeof subscriptions.$inferSelect, recheck: boolean) {
    const p = (await plan(s.plan_id))!;
    const base = subscriptionStatus({ start_ts: s.start_ts, period_s: p.period_s, grace_s: p.grace_s, cancelled_at: s.cancelled_at }, d.now(), false);
    let inv = (await d.db.select().from(subscriptionInvoices).where(and(eq(subscriptionInvoices.subscription_id, s.id), eq(subscriptionInvoices.period_no, base.period_no))).limit(1))[0];
    if (!inv && s.cancelled_at === null) {
      const r = await createRequest(reqDeps, s.owner_user_id, await walletForUserId(d.db, s.owner_user_id, 'merchant'), p.amount_zat, { ttl_s: Math.max(60, base.period_end - d.now() + p.grace_s) });
      await d.db.insert(subscriptionInvoices).values({ subscription_id: s.id, period_no: base.period_no, request_id: r.id, period_start: base.period_start, period_end: base.period_end, created_at: d.now() }).onConflictDoNothing();
      inv = (await d.db.select().from(subscriptionInvoices).where(and(eq(subscriptionInvoices.subscription_id, s.id), eq(subscriptionInvoices.period_no, base.period_no))).limit(1))[0];
    }
    let req = inv ? (await d.db.select().from(paymentRequests).where(eq(paymentRequests.id, inv.request_id)).limit(1))[0] : undefined;
    if (inv && recheck && req && req.status !== 'PAID') req = (await refreshRequest(reqDeps, inv.request_id)) ?? req;
    const st = subscriptionStatus({ start_ts: s.start_ts, period_s: p.period_s, grace_s: p.grace_s, cancelled_at: s.cancelled_at }, d.now(), req?.status === 'PAID');
    const invoices = await d.db.select().from(subscriptionInvoices).where(eq(subscriptionInvoices.subscription_id, s.id)).orderBy(desc(subscriptionInvoices.period_no));
    return { p, st, inv, req, invoices };
  }

  async function ownerView(s: typeof subscriptions.$inferSelect, recheck = false) {
    const { p, st, req, invoices } = await current(s, recheck);
    return {
      id: s.id,
      subscriber: d.cipher.decrypt(s.label_enc, subAad(s.id)),
      plan: { id: p.id, name: d.cipher.decrypt(p.name_enc, planAad(p.id)), amount_zat: p.amount_zat.toString(), period_s: p.period_s, grace_s: p.grace_s },
      status: st.status,
      period_no: st.period_no,
      period_end: st.period_end,
      current_invoice: req ? { request_id: req.id, status: req.status, txids: req.txids, share_path: `/r/${req.id}` } : null,
      invoices: invoices.length,
      share_path: `/s/${s.id}`,
    };
  }

  app.post('/v1/subscriptions/plans', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (u.role === 'user') return notFound(reply);
    const b = PlanBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    let amount: bigint;
    try {
      amount = parseZec(b.data.amount_zec);
    } catch (e) {
      if (e instanceof AmountError) return reply.code(400).send({ error: 'BAD_AMOUNT' });
      throw e;
    }
    if (amount <= 0n) return reply.code(400).send({ error: 'BAD_AMOUNT' });
    const id = opaqueId();
    await d.db.insert(subscriptionPlans).values({ id, owner_user_id: u.id, name_enc: d.cipher.encrypt(b.data.name, planAad(id)), amount_zat: amount, period_s: b.data.period_s, grace_s: b.data.grace_s, created_at: d.now() });
    return { id, name: b.data.name, amount_zat: amount.toString(), period_s: b.data.period_s, grace_s: b.data.grace_s };
  });

  app.get('/v1/subscriptions/plans', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const rows = await d.db.select().from(subscriptionPlans).where(eq(subscriptionPlans.owner_user_id, u.id)).orderBy(desc(subscriptionPlans.created_at));
    return { plans: rows.map((p) => ({ id: p.id, name: d.cipher.decrypt(p.name_enc, planAad(p.id)), amount_zat: p.amount_zat.toString(), period_s: p.period_s, grace_s: p.grace_s })) };
  });

  app.post('/v1/subscriptions', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (u.role === 'user') return notFound(reply);
    const b = SubBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    const p = await plan(b.data.plan_id);
    if (!p || p.owner_user_id !== u.id) return notFound(reply);
    const id = opaqueId();
    await d.db.insert(subscriptions).values({ id, plan_id: p.id, owner_user_id: u.id, label_enc: d.cipher.encrypt(b.data.subscriber, subAad(id)), start_ts: d.now(), cancelled_at: null, created_at: d.now() });
    return ownerView((await d.db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1))[0]!);
  });

  app.get('/v1/subscriptions', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const rows = await d.db.select().from(subscriptions).where(eq(subscriptions.owner_user_id, u.id)).orderBy(desc(subscriptions.created_at)).limit(100);
    return { subscriptions: await Promise.all(rows.map((s) => ownerView(s))) };
  });

  async function owned(req: FastifyRequest<{ Params: { id: string } }>) {
    const u = await d.user(req);
    if (!u || !ID.test(req.params.id)) return { u, s: null };
    const s = (await d.db.select().from(subscriptions).where(and(eq(subscriptions.id, req.params.id), eq(subscriptions.owner_user_id, u.id))).limit(1))[0];
    return { u, s: s ?? null };
  }

  app.post<{ Params: { id: string } }>('/v1/subscriptions/:id/refresh', async (req, reply) => {
    const { u, s } = await owned(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    return s ? ownerView(s, true) : notFound(reply);
  });

  app.post<{ Params: { id: string } }>('/v1/subscriptions/:id/cancel', async (req, reply) => {
    const { u, s } = await owned(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (!s) return notFound(reply);
    await d.db.update(subscriptions).set({ cancelled_at: d.now() }).where(eq(subscriptions.id, s.id));
    return ownerView({ ...s, cancelled_at: d.now() });
  });

  /** Subscriber page data (capability = the subscription id). No merchant identity. */
  app.post<{ Params: { id: string } }>('/v1/public/subscriptions/:id', async (req, reply) => {
    if (!ID.test(req.params.id)) return notFound(reply);
    const s = (await d.db.select().from(subscriptions).where(eq(subscriptions.id, req.params.id)).limit(1))[0];
    if (!s) return notFound(reply);
    const { p, st, req: r } = await current(s, true);
    reply.header('cache-control', 'no-store');
    return {
      plan: { name: d.cipher.decrypt(p.name_enc, planAad(p.id)), amount_zat: p.amount_zat.toString(), period_s: p.period_s },
      status: st.status,
      period_no: st.period_no,
      period_end: st.period_end,
      pay_path: r && r.status !== 'PAID' && st.status !== 'CANCELLED' ? `/r/${r.id}` : null,
    };
  });
}
