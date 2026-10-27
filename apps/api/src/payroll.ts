/**
 * Payroll (BatchPay and friends):
 * - (6) BatchPay: up to 10 people paid in ONE shielded transaction (one approval, one ZIP-317
 *   fee, each recipient sees only their own payment). Action type BATCH_PAYOUT through
 *   `executeAction`: LuteGuard checks every line, the sidecar re-checks policy and caps, the owner
 *   approves the exact batch (every line is in the approved hash).
 * - (7) Streams to payroll: the outstanding earnings of several streams paid in one batch; each
 *   stream records its share, so stream accounting stays exact.
 * - (8) Private payslips: each person gets a capability link (a 128-bit id, also sent to them in
 *   their payment's memo) showing only their own line and its status; signed once paid.
 * - (9) Templates: saved payroll plans; running one always builds a fresh proposal, fresh LuteGuard
 *   checks and needs a fresh owner approval.
 * - (10) Roles: the owner signs; an admin may prepare runs and edit templates; an operator may only
 *   run saved templates. Neither can approve or sign.
 */
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AmountError, executeAction, parseZec, type ActionState, type ProposalView, type SidecarClient, type SidecarResult } from '@lute/core';
import type { Network } from '@lute/luteguard';
import { walletOf, type SessionUser } from './auth.js';
import { opaqueId, type FieldCipher } from './crypto.js';
import { actions, payrollItems, payrollMembers, payrollRuns, payrollTemplates, signingKeys, streamAgreements, streamSettlements, users } from './db/schema.js';
import type { Db, PgActionStore } from './db/store.js';
import { streamRecipient, streamView } from './streams.js';

export interface PayrollDeps {
  db: Db;
  store: PgActionStore;
  cipher: FieldCipher;
  sidecar: SidecarClient;
  /** Re-reads a stored proposal (for approving a run prepared earlier, e.g. by an operator). */
  proposals?: { showProposal(wallet: string, proposalId: string): Promise<SidecarResult<ProposalView>> };
  sync?: (wallet: string) => Promise<void>;
  network: Network;
  now: () => number;
  user: (req: FastifyRequest) => Promise<SessionUser | null>;
}

type Role = 'owner' | 'admin' | 'operator';
const MAX_LINES = 10;
const ID = /^[A-Za-z0-9_-]{22}$/;
const PAID = new Set<ActionState>(['CONFIRMED', 'RECONCILED']);
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const Line = z.object({ label: z.string().min(1).max(64), to: z.string().min(10).max(512), amount_zec: z.string().max(32) }).strict();
const RunBody = z.object({ owner: z.string().max(32).optional(), name: z.string().min(1).max(64), wallet: z.enum(['payout', 'merchant']).default('payout'), items: z.array(Line).min(1).max(MAX_LINES) }).strict();
const TemplateBody = z.object({ owner: z.string().max(32).optional(), name: z.string().min(1).max(64), wallet: z.enum(['payout', 'merchant']).default('payout'), items: z.array(Line).min(1).max(MAX_LINES) }).strict();
const TemplateRunBody = z.object({ owner: z.string().max(32).optional() }).strict();
const StreamsBody = z.object({ name: z.string().min(1).max(64).default('Stream payouts'), stream_ids: z.array(z.string().regex(ID)).min(1).max(MAX_LINES) }).strict();
const MemberBody = z.object({ username: z.string().regex(/^[a-z0-9_]{3,32}$/), role: z.enum(['admin', 'operator']) }).strict();

interface Item {
  label: string;
  to: string;
  amount_zat: bigint;
  stream_id?: string;
}

export function registerPayrollRoutes(app: FastifyInstance, d: PayrollDeps): void {
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'NOT_FOUND' });
  const labelAad = (run: string, idx: number) => `lute-payroll|${run}|${idx}|label`;
  const tplAad = (id: string) => `lute-payroll-template|${id}|items`;

  /** Whose payroll the caller acts on, and in which role (`owner` username for team members). */
  async function acting(req: FastifyRequest, ownerName?: string): Promise<{ u: SessionUser; owner: typeof users.$inferSelect; role: Role } | null> {
    const u = await d.user(req);
    if (!u) return null;
    if (!ownerName || ownerName === u.username) {
      if (u.role !== 'owner') return null;
      const owner = (await d.db.select().from(users).where(eq(users.id, u.id)).limit(1))[0]!;
      return { u, owner, role: 'owner' };
    }
    const owner = (await d.db.select().from(users).where(eq(users.username, ownerName)).limit(1))[0];
    if (!owner) return null;
    const m = (await d.db.select().from(payrollMembers).where(and(eq(payrollMembers.owner_user_id, owner.id), eq(payrollMembers.member_user_id, u.id))).limit(1))[0];
    return m ? { u, owner, role: m.role as Role } : null;
  }

  function parseItems(items: z.infer<typeof Line>[]): Item[] | string {
    const out: Item[] = [];
    for (const it of items) {
      try {
        const a = parseZec(it.amount_zec);
        if (a <= 0n) return 'BAD_AMOUNT';
        out.push({ label: it.label, to: it.to.trim(), amount_zat: a });
      } catch (e) {
        if (e instanceof AmountError) return 'BAD_AMOUNT';
        throw e;
      }
    }
    return out;
  }

  /** Creates the batch action and the run, then lets LuteGuard and the sidecar check it. */
  async function createRun(owner: typeof users.$inferSelect, createdBy: string, name: string, role: 'payout' | 'merchant', items: Item[], idem: string, source: 'manual' | 'template' | 'streams', templateId?: string) {
    const wallet = walletOf({ wallet_prefix: owner.wallet_prefix }, role);
    const key = `payroll:${idem}`;
    let action = await d.store.findByIdempotency(owner.id, key);
    let runId: string;
    if (action) {
      runId = (await d.db.select({ id: payrollRuns.id }).from(payrollRuns).where(eq(payrollRuns.action_id, action.id)).limit(1))[0]!.id;
    } else {
      runId = opaqueId();
      const receipts = items.map(() => opaqueId());
      const total = items.reduce((a, it) => a + it.amount_zat, 0n);
      action = await d.store.create(
        {
          id: opaqueId(),
          type: 'BATCH_PAYOUT',
          network: d.network,
          state: 'CREATED',
          amount_zat: total,
          wallet,
          recipient_ref: runId,
          // Each person's memo carries their payslip id: only they can read it (shielded memo).
          payments: items.map((it, i) => ({ to: it.to, amount_zat: it.amount_zat, memo_text: `LUTE:${receipts[i]}` })),
          idempotency_key: key,
          expires_at: d.now() + 15 * 60,
        },
        owner.id,
      );
      await d.db.insert(payrollRuns).values({ id: runId, owner_user_id: owner.id, action_id: action.id, name, source, template_id: templateId ?? null, created_by_user_id: createdBy, created_at: d.now() });
      await d.db.insert(payrollItems).values(
        items.map((it, i) => ({ run_id: runId, idx: i, label_enc: d.cipher.encrypt(it.label, labelAad(runId, i)), amount_zat: it.amount_zat, receipt_id: receipts[i]!, stream_id: it.stream_id ?? null })),
      );
      for (const it of items) {
        if (!it.stream_id) continue;
        const seq = (await d.db.select({ seq: streamSettlements.seq }).from(streamSettlements).where(eq(streamSettlements.stream_id, it.stream_id))).length + 1;
        await d.db.insert(streamSettlements).values({ stream_id: it.stream_id, seq, action_id: action.id, amount_zat: it.amount_zat, created_at: d.now() });
      }
    }
    if (action.state === 'CREATED' && d.sync) await d.sync(wallet).catch(() => undefined);
    const result = await executeAction(
      { store: d.store, sidecar: d.sidecar, configured_network: d.network, now: d.now, newId: opaqueId },
      { actionId: action.id, principal: { kind: 'owner', id: owner.id, authenticated: true }, caller: 'api', idempotencyKey: key },
    );
    return { run_id: runId, action_id: action.id, result };
  }

  async function runView(r: typeof payrollRuns.$inferSelect, withLabels: boolean) {
    const items = await d.db.select().from(payrollItems).where(eq(payrollItems.run_id, r.id));
    const a = (await d.db.select({ state: actions.state, txid: actions.txid, amount: actions.amount_zat, reason: actions.reject_reason }).from(actions).where(eq(actions.id, r.action_id)).limit(1))[0];
    return {
      id: r.id,
      name: r.name,
      source: r.source,
      action_id: r.action_id,
      state: a?.state ?? 'FAILED',
      reason: a?.reason ?? null,
      txid: a?.txid ?? null,
      total_zat: (a?.amount ?? 0n).toString(),
      created_at: r.created_at,
      items: items
        .sort((x, y) => x.idx - y.idx)
        .map((it) => ({
          label: withLabels ? d.cipher.decrypt(it.label_enc, labelAad(r.id, it.idx)) : null,
          amount_zat: it.amount_zat.toString(),
          payslip: `/payslip/${it.receipt_id}`,
          from_stream: it.stream_id !== null,
        })),
    };
  }

  const idemOf = (req: FastifyRequest) => {
    const k = req.headers['idempotency-key'];
    return typeof k === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(k) ? k : null;
  };

  // (6) BatchPay: a run with explicit lines (owner or admin).
  app.post('/v1/payroll/runs', async (req, reply) => {
    const b = RunBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    const ctx = await acting(req, b.data.owner);
    if (!ctx) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (ctx.role === 'operator') return reply.code(403).send({ error: 'OPERATORS_RUN_TEMPLATES_ONLY' });
    const idem = idemOf(req);
    if (!idem) return reply.code(400).send({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    const items = parseItems(b.data.items);
    if (typeof items === 'string') return reply.code(400).send({ error: items });
    return createRun(ctx.owner, ctx.u.id, b.data.name, b.data.wallet, items, idem, 'manual');
  });

  app.get<{ Querystring: { owner?: string } }>('/v1/payroll/runs', async (req, reply) => {
    const ctx = await acting(req, req.query.owner);
    if (!ctx) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const rows = await d.db.select().from(payrollRuns).where(eq(payrollRuns.owner_user_id, ctx.owner.id)).orderBy(desc(payrollRuns.created_at)).limit(50);
    return { role: ctx.role, runs: await Promise.all(rows.map((r) => runView(r, true))) };
  });

  /** The exact batch to approve (owner only): for runs prepared earlier or by a team member. */
  app.get<{ Params: { id: string } }>('/v1/payroll/runs/:id/approval', async (req, reply) => {
    const ctx = await acting(req);
    if (!ctx || ctx.role !== 'owner') return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (!ID.test(req.params.id)) return notFound(reply);
    const r = (await d.db.select().from(payrollRuns).where(and(eq(payrollRuns.id, req.params.id), eq(payrollRuns.owner_user_id, ctx.owner.id))).limit(1))[0];
    if (!r) return notFound(reply);
    const a = await d.store.get(r.action_id);
    if (!a || a.state !== 'AWAITING_AUTHORIZATION' || !a.wallet || !a.proposal_id || !d.proposals) return reply.code(409).send({ error: 'NOT_AWAITING_AUTHORIZATION' });
    const v = await d.proposals.showProposal(a.wallet, a.proposal_id);
    if (!v.ok || v.value.proposal_hash !== a.proposal_hash) return reply.code(409).send({ error: 'PROPOSAL_UNAVAILABLE' });
    return { action_id: a.id, result: { state: 'AWAITING_AUTHORIZATION', proposal_hash: v.value.proposal_hash, sign_message: v.value.sign_message, summary: v.value.summary } };
  });

  // (7) Streams to payroll: what each selected stream owes, paid in one batch.
  app.post('/v1/payroll/from-streams', async (req, reply) => {
    const ctx = await acting(req);
    if (!ctx) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const b = StreamsBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    const idem = idemOf(req);
    if (!idem) return reply.code(400).send({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    const prior = await d.store.findByIdempotency(ctx.owner.id, `payroll:${idem}`);
    let items: Item[] = [];
    let walletRole: 'payout' | 'merchant' = 'payout';
    if (!prior) {
      const streams = await d.db.select().from(streamAgreements).where(and(eq(streamAgreements.owner_user_id, ctx.owner.id), inArray(streamAgreements.id, b.data.stream_ids)));
      if (streams.length !== new Set(b.data.stream_ids).size) return notFound(reply);
      const wallets = new Set(streams.map((s) => s.wallet));
      if (wallets.size !== 1) return reply.code(400).send({ error: 'STREAMS_FROM_DIFFERENT_WALLETS' });
      walletRole = [...wallets][0]!.endsWith('merchant') ? 'merchant' : 'payout';
      for (const s of streams) {
        const v = await streamView(d, s);
        if (BigInt(v.outstanding_zat) > 0n) items.push({ label: `Stream ${s.id.slice(0, 6)}`, to: streamRecipient(d, s), amount_zat: BigInt(v.outstanding_zat), stream_id: s.id });
      }
      if (items.length === 0) return reply.code(409).send({ error: 'NOTHING_DUE' });
    }
    return createRun(ctx.owner, ctx.u.id, b.data.name, walletRole, items, idem, 'streams');
  });

  // (9) Templates.
  app.post('/v1/payroll/templates', async (req, reply) => {
    const b = TemplateBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    const ctx = await acting(req, b.data.owner);
    if (!ctx) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (ctx.role === 'operator') return reply.code(403).send({ error: 'OPERATORS_CANNOT_EDIT_TEMPLATES' });
    const items = parseItems(b.data.items);
    if (typeof items === 'string') return reply.code(400).send({ error: items });
    const id = opaqueId();
    await d.db.insert(payrollTemplates).values({
      id,
      owner_user_id: ctx.owner.id,
      name: b.data.name,
      wallet: b.data.wallet,
      items_enc: d.cipher.encrypt(JSON.stringify(items.map((it) => ({ label: it.label, to: it.to, amount_zat: it.amount_zat.toString() }))), tplAad(id)),
      created_at: d.now(),
    });
    return { id, name: b.data.name, lines: items.length, total_zat: items.reduce((a, it) => a + it.amount_zat, 0n).toString() };
  });

  app.get<{ Querystring: { owner?: string } }>('/v1/payroll/templates', async (req, reply) => {
    const ctx = await acting(req, req.query.owner);
    if (!ctx) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const rows = await d.db.select().from(payrollTemplates).where(eq(payrollTemplates.owner_user_id, ctx.owner.id)).orderBy(desc(payrollTemplates.created_at));
    return {
      templates: rows.map((t) => {
        const items = JSON.parse(d.cipher.decrypt(t.items_enc, tplAad(t.id))) as { label: string; amount_zat: string }[];
        return { id: t.id, name: t.name, wallet: t.wallet, lines: items.map((it) => ({ label: it.label, amount_zat: it.amount_zat })), total_zat: items.reduce((a, it) => a + BigInt(it.amount_zat), 0n).toString() };
      }),
    };
  });

  /** Runs a saved plan: fresh proposal, fresh LuteGuard checks, fresh owner approval (any role). */
  app.post<{ Params: { id: string } }>('/v1/payroll/templates/:id/run', async (req, reply) => {
    const b = TemplateRunBody.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    const ctx = await acting(req, b.data.owner);
    if (!ctx) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (!ID.test(req.params.id)) return notFound(reply);
    const t = (await d.db.select().from(payrollTemplates).where(and(eq(payrollTemplates.id, req.params.id), eq(payrollTemplates.owner_user_id, ctx.owner.id))).limit(1))[0];
    if (!t) return notFound(reply);
    const idem = idemOf(req);
    if (!idem) return reply.code(400).send({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    const items = (JSON.parse(d.cipher.decrypt(t.items_enc, tplAad(t.id))) as { label: string; to: string; amount_zat: string }[]).map((it) => ({ label: it.label, to: it.to, amount_zat: BigInt(it.amount_zat) }));
    return createRun(ctx.owner, ctx.u.id, t.name, t.wallet as 'payout' | 'merchant', items, idem, 'template', t.id);
  });

  // (10) Team: the owner adds admins (prepare and edit) and operators (run templates only).
  app.post('/v1/payroll/members', async (req, reply) => {
    const ctx = await acting(req);
    if (!ctx || ctx.role !== 'owner') return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const b = MemberBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    const m = (await d.db.select().from(users).where(eq(users.username, b.data.username)).limit(1))[0];
    if (!m || m.id === ctx.owner.id) return notFound(reply);
    await d.db
      .insert(payrollMembers)
      .values({ owner_user_id: ctx.owner.id, member_user_id: m.id, role: b.data.role, created_at: d.now() })
      .onConflictDoUpdate({ target: [payrollMembers.owner_user_id, payrollMembers.member_user_id], set: { role: b.data.role } });
    return { username: m.username, role: b.data.role };
  });

  app.get('/v1/payroll/members', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const mine = await d.db.select({ username: users.username, role: payrollMembers.role }).from(payrollMembers).innerJoin(users, eq(users.id, payrollMembers.member_user_id)).where(eq(payrollMembers.owner_user_id, u.id));
    const teams = await d.db.select({ owner: users.username, role: payrollMembers.role }).from(payrollMembers).innerJoin(users, eq(users.id, payrollMembers.owner_user_id)).where(eq(payrollMembers.member_user_id, u.id));
    return { members: mine, teams };
  });

  app.post<{ Params: { username: string } }>('/v1/payroll/members/:username/remove', async (req, reply) => {
    const ctx = await acting(req);
    if (!ctx || ctx.role !== 'owner') return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const m = (await d.db.select().from(users).where(eq(users.username, req.params.username)).limit(1))[0];
    if (!m) return notFound(reply);
    await d.db.delete(payrollMembers).where(and(eq(payrollMembers.owner_user_id, ctx.owner.id), eq(payrollMembers.member_user_id, m.id)));
    return { removed: m.username };
  });

  // (8) Private payslips: one person's line, by its unguessable id; signed once paid.
  async function receiptSigner() {
    let row = (await d.db.select().from(signingKeys).where(eq(signingKeys.purpose, 'receipt')).limit(1))[0];
    if (!row) {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const id = opaqueId();
      await d.db
        .insert(signingKeys)
        .values({
          id,
          purpose: 'receipt',
          public_key: (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(SPKI_ED25519_PREFIX.length).toString('hex'),
          private_key_enc: d.cipher.encrypt((privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64'), `lute-signing-key|${id}`),
          created_at: d.now(),
        })
        .onConflictDoNothing();
      row = (await d.db.select().from(signingKeys).where(eq(signingKeys.purpose, 'receipt')).limit(1))[0]!;
    }
    const k = row;
    const priv = createPrivateKey({ key: Buffer.from(d.cipher.decrypt(k.private_key_enc, `lute-signing-key|${k.id}`), 'base64'), format: 'der', type: 'pkcs8' });
    return { key_id: k.id, public_key: k.public_key, sign: (m: Buffer) => sign(null, m, priv).toString('hex') };
  }

  app.get<{ Params: { id: string } }>('/v1/public/payslips/:id', async (req, reply) => {
    if (!ID.test(req.params.id)) return notFound(reply);
    const it = (await d.db.select().from(payrollItems).where(eq(payrollItems.receipt_id, req.params.id)).limit(1))[0];
    if (!it) return notFound(reply);
    const r = (await d.db.select().from(payrollRuns).where(eq(payrollRuns.id, it.run_id)).limit(1))[0]!;
    const a = (await d.db.select({ state: actions.state, txid: actions.txid, updated_at: actions.updated_at }).from(actions).where(eq(actions.id, r.action_id)).limit(1))[0];
    const state = (a?.state ?? 'FAILED') as ActionState;
    reply.header('cache-control', 'no-store');
    reply.header('referrer-policy', 'no-referrer');
    const payslip = {
      version: 'lute-payslip-v1',
      payslip_id: it.receipt_id,
      label: d.cipher.decrypt(it.label_enc, labelAad(r.id, it.idx)),
      amount_zat: it.amount_zat.toString(),
      network: d.network,
      status: PAID.has(state) ? 'PAID' : state === 'SUBMITTED' || state === 'PENDING_CONFIRMATION' ? 'CONFIRMING' : state === 'AWAITING_AUTHORIZATION' || state === 'CREATED' || state === 'VALIDATING' ? 'AWAITING_APPROVAL' : 'NOT_PAID',
      txid: a?.txid ?? null,
    };
    if (payslip.status !== 'PAID') return { payslip };
    const k = await receiptSigner();
    const hash = createHash('sha256').update(canonical(payslip)).digest('hex');
    return { payslip, signature: k.sign(Buffer.from(`lute-payslip-v1|${hash}`, 'utf8')), public_key: k.public_key, key_id: k.key_id };
  });
}

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
