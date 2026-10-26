/**
 * Streams (mandate §19.5). Payer-controlled, NOT trustless: accrual is accounting, and each
 * settlement is an owner-approved shielded payout through executeAction (STREAM_SETTLEMENT).
 * Payouts stop if the payer stops authorizing. Fields are kept separate (S12): contracted,
 * accrued, pending (settlements in flight), confirmed paid, outstanding.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { accrued, AmountError, due, executeAction, parseZec, ratePerSecond, type ActionState, type SidecarClient, type StreamEvent } from '@lute/core';
import type { Network } from '@lute/luteguard';
import type { SessionUser } from './auth.js';
import { opaqueId, type FieldCipher } from './crypto.js';
import { actions, streamAgreements, streamSettlements } from './db/schema.js';
import type { Db, PgActionStore } from './db/store.js';
import { minConf } from './requests.js';
import type { RequestSidecar } from './sidecar.js';

export interface StreamDeps {
  db: Db;
  store: PgActionStore;
  cipher: FieldCipher;
  sidecar: SidecarClient;
  requestSidecar: RequestSidecar;
  network: Network;
  now: () => number;
  user: (req: FastifyRequest) => Promise<SessionUser | null>;
  /** Minimum settlement amount (mandate default 100_000 zat; lower for demos via LUTE_MIN_PAYOUT_ZAT). */
  minPayoutZat: bigint;
}

const ID = /^[A-Za-z0-9_-]{22}$/;
const PENDING: ReadonlySet<ActionState> = new Set(['CREATED', 'VALIDATING', 'AWAITING_AUTHORIZATION', 'AUTHORIZED', 'PREPARING', 'SUBMITTED', 'PENDING_CONFIRMATION']);
const PAID: ReadonlySet<ActionState> = new Set(['CONFIRMED', 'RECONCILED']);

const CreateBody = z
  .object({
    wallet: z.string().regex(/^[a-z0-9-]{1,32}$/).default('payout'),
    to: z.string().min(1).max(512),
    total_zec: z.string().max(32),
    duration_s: z.number().int().min(60).max(366 * 86_400),
    start_in_s: z.number().int().min(0).max(30 * 86_400).default(0),
  })
  .strict();

export function registerStreamRoutes(app: FastifyInstance, d: StreamDeps): void {
  const aad = (id: string) => `lute-stream|${id}|recipient`;
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'NOT_FOUND' });

  async function load(req: FastifyRequest<{ Params: { id: string } }>) {
    const u = await d.user(req);
    if (!u) return { u: null, s: null };
    if (!ID.test(req.params.id)) return { u, s: null };
    const s = (await d.db.select().from(streamAgreements).where(and(eq(streamAgreements.id, req.params.id), eq(streamAgreements.owner_user_id, u.id))).limit(1))[0];
    return { u, s: s ?? null };
  }

  async function view(s: typeof streamAgreements.$inferSelect) {
    const now = d.now();
    const terms = { total_zat: s.total_zat, start_ts: s.start_ts, end_ts: s.end_ts, events: s.events as StreamEvent[] };
    const settlements = await d.db.select().from(streamSettlements).where(eq(streamSettlements.stream_id, s.id)).orderBy(asc(streamSettlements.seq));
    const states = settlements.length
      ? await d.db.select({ id: actions.id, state: actions.state, txid: actions.txid }).from(actions).where(inArray(actions.id, settlements.map((x) => x.action_id)))
      : [];
    const byId = new Map(states.map((a) => [a.id, a]));
    let pending = 0n;
    let confirmed = 0n;
    const rows = settlements.map((x) => {
      const a = byId.get(x.action_id);
      const st = (a?.state ?? 'FAILED') as ActionState;
      if (PENDING.has(st)) pending += x.amount_zat;
      if (PAID.has(st)) confirmed += x.amount_zat;
      return { seq: x.seq, action_id: x.action_id, amount_zat: x.amount_zat.toString(), state: st, txid: a?.txid ?? null };
    });
    const acc = accrued(terms, now);
    const ev = s.events as StreamEvent[];
    const status = ev.some((e) => e.kind === 'cancel')
      ? 'CANCELLED'
      : now < s.start_ts
        ? 'SCHEDULED'
        : now >= s.end_ts
          ? 'ENDED'
          : ev.length && ev[ev.length - 1]!.kind === 'pause'
            ? 'PAUSED'
            : 'ACTIVE';
    return {
      id: s.id,
      status,
      server_time: now,
      start_ts: s.start_ts,
      end_ts: s.end_ts,
      rate_zat_per_s: ratePerSecond(terms).toString(),
      contracted_zat: s.total_zat.toString(),
      accrued_zat: acc.toString(),
      pending_zat: pending.toString(),
      confirmed_paid_zat: confirmed.toString(),
      outstanding_zat: due(acc, confirmed, pending).toString(),
      labels: { accrued: 'Earned (accounting), not wallet funds', model: 'Payer-controlled. Not trustless. Payouts stop if the payer stops authorizing.' },
      settlements: rows,
    };
  }

  app.post('/v1/streams', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (u.role !== 'owner') return notFound(reply);
    const body = CreateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    let total: bigint;
    try {
      total = parseZec(body.data.total_zec);
    } catch (e) {
      if (e instanceof AmountError) return reply.code(400).send({ error: 'BAD_AMOUNT' });
      throw e;
    }
    if (total <= 0n) return reply.code(400).send({ error: 'BAD_AMOUNT' });
    // The recipient must be payable under LUTE_STRICT before an agreement is even recorded.
    const insp = await d.sidecar.inspect(body.data.to);
    if (insp.verdict !== 'ALLOWED') return reply.code(403).send({ error: `RECIPIENT_${insp.verdict}` });
    const id = opaqueId();
    const now = d.now();
    const start = now + body.data.start_in_s;
    await d.db.insert(streamAgreements).values({
      id,
      owner_user_id: u.id,
      wallet: body.data.wallet,
      network: d.network,
      recipient_address_enc: d.cipher.encrypt(body.data.to, aad(id)),
      total_zat: total,
      start_ts: start,
      end_ts: start + body.data.duration_s,
      events: [],
      created_at: now,
      updated_at: now,
    });
    const s = (await d.db.select().from(streamAgreements).where(eq(streamAgreements.id, id)).limit(1))[0]!;
    return view(s);
  });

  app.get('/v1/streams', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const rows = await d.db.select().from(streamAgreements).where(eq(streamAgreements.owner_user_id, u.id)).orderBy(desc(streamAgreements.created_at)).limit(50);
    return { streams: await Promise.all(rows.map(view)) };
  });

  app.get<{ Params: { id: string } }>('/v1/streams/:id', async (req, reply) => {
    const { u, s } = await load(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (!s) return notFound(reply);
    return view(s);
  });

  for (const kind of ['pause', 'resume', 'cancel'] as const) {
    app.post<{ Params: { id: string } }>(`/v1/streams/:id/${kind}`, async (req, reply) => {
      const { u, s } = await load(req);
      if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
      if (!s) return notFound(reply);
      const events = [...(s.events as StreamEvent[]), { kind, at: d.now() }];
      try {
        accrued({ total_zat: s.total_zat, start_ts: s.start_ts, end_ts: s.end_ts, events }, d.now());
      } catch {
        return reply.code(409).send({ error: 'INVALID_STREAM_EVENT' });
      }
      await d.db.update(streamAgreements).set({ events, updated_at: d.now() }).where(eq(streamAgreements.id, s.id));
      const fresh = (await d.db.select().from(streamAgreements).where(eq(streamAgreements.id, s.id)).limit(1))[0]!;
      return view(fresh);
    });
  }

  /** Creates a STREAM_SETTLEMENT for what is due now; the owner then authorizes it like any spend. */
  app.post<{ Params: { id: string } }>('/v1/streams/:id/settle', async (req, reply) => {
    const { u, s } = await load(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (!s) return notFound(reply);
    const idem = req.headers['idempotency-key'];
    if (typeof idem !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(idem)) return reply.code(400).send({ error: 'IDEMPOTENCY_KEY_REQUIRED' });

    let action = await d.store.findByIdempotency(u.id, idem);
    if (!action) {
      const v = await view(s);
      const amount = BigInt(v.outstanding_zat);
      if (amount <= 0n) return reply.code(409).send({ error: 'NOTHING_DUE' });
      if (amount < d.minPayoutZat) return reply.code(409).send({ error: 'BELOW_MIN_PAYOUT', min_payout_zat: d.minPayoutZat.toString() });
      const seq = v.settlements.length + 1;
      const ref = opaqueId();
      action = await d.store.create(
        {
          id: opaqueId(),
          type: 'STREAM_SETTLEMENT',
          network: d.network,
          state: 'CREATED',
          amount_zat: amount,
          wallet: s.wallet,
          recipient_address: d.cipher.decrypt(s.recipient_address_enc, aad(s.id)),
          recipient_ref: s.id,
          memo: { kind: 'lute_ref', ref },
          memo_text: `LUTE:${ref}`,
          idempotency_key: idem,
          expires_at: d.now() + 15 * 60,
        },
        u.id,
      );
      // Unique (stream_id, seq) and unique action_id: a concurrent duplicate fails here (S10).
      await d.db.insert(streamSettlements).values({ stream_id: s.id, seq, action_id: action.id, amount_zat: amount, created_at: d.now() });
    }
    // The wallet must know the current tip before a proposal is built: its expiry height is
    // derived from it, and a stale tip yields a transaction that is already expired.
    if (action.state === 'CREATED') await d.requestSidecar.sync(s.wallet);
    const result = await executeAction(
      { store: d.store, sidecar: d.sidecar, configured_network: d.network, now: d.now, newId: opaqueId },
      { actionId: action.id, principal: { kind: 'owner', id: u.id, authenticated: true }, caller: 'api', idempotencyKey: idem },
    );
    return { action_id: action.id, result };
  });

  /** Moves submitted settlements to CONFIRMED once mined with enough confirmations (F6). */
  app.post<{ Params: { id: string } }>('/v1/streams/:id/refresh', async (req, reply) => {
    const { u, s } = await load(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (!s) return notFound(reply);
    await d.requestSidecar.sync(s.wallet);
    const v = await view(s);
    for (const row of v.settlements) {
      if (!row.txid || (row.state !== 'SUBMITTED' && row.state !== 'PENDING_CONFIRMATION')) continue;
      const st = await d.requestSidecar.txStatus(s.wallet, row.txid);
      if (st.expired_unmined && st.mined_height === null) {
        // Can never confirm: no longer pending, so the amount becomes due again (never "paid").
        await d.store.transition(row.action_id, row.state, 'FAILED', 'system', { reject_reason: 'EXPIRED_UNMINED' });
        continue;
      }
      if (row.state === 'SUBMITTED' && st.mined_height !== null) {
        await d.store.transition(row.action_id, 'SUBMITTED', 'PENDING_CONFIRMATION', 'system');
        row.state = 'PENDING_CONFIRMATION';
      }
      if (row.state === 'PENDING_CONFIRMATION' && st.confirmations >= minConf(d.network)) {
        await d.store.transition(row.action_id, 'PENDING_CONFIRMATION', 'CONFIRMED', 'system');
      }
    }
    const fresh = (await d.db.select().from(streamAgreements).where(eq(streamAgreements.id, s.id)).limit(1))[0]!;
    return view(fresh);
  });
}
