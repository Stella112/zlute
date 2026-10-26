/**
 * Commerce (mandate §19.3): checkout orders, signed receipts, refunds.
 *
 * - An order is a checkout backed by a payment request (fresh shielded-only address, memo ref,
 *   PAID only with enough confirmations). The item text is encrypted at rest.
 * - When an order is paid, Lute issues a receipt: canonical JSON signed with an Ed25519 receipt
 *   key (separate from wallet and owner keys). It carries amounts, txids and a hash of the item,
 *   never an address or the item text, so a customer can show it without revealing more (U10).
 * - A refund is an owner-approved shielded payout from the `merchant` wallet to an address the
 *   customer provides (a shielded payment does not reveal its sender), never more than was paid.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AmountError, executeAction, parseZec, type ActionState, type SidecarClient } from '@lute/core';
import type { Network } from '@lute/luteguard';
import { walletOf, type SessionUser } from './auth.js';
import { opaqueId, type FieldCipher } from './crypto.js';
import { actions, orderRefunds, orders, paymentRequests, signingKeys } from './db/schema.js';
import type { Db, PgActionStore } from './db/store.js';
import { createRequest, refreshRequest, requestProgress } from './requests.js';
import type { RequestSidecar } from './sidecar.js';

export interface CommerceDeps {
  db: Db;
  store: PgActionStore;
  cipher: FieldCipher;
  sidecar: SidecarClient;
  requestSidecar: RequestSidecar;
  network: Network;
  now: () => number;
  user: (req: FastifyRequest) => Promise<SessionUser | null>;
}

const ID = /^[A-Za-z0-9_-]{22}$/;
/** For the payer's page: how much has arrived (confirmed, and seen in total) against the amount. */
const progressOf = (r: typeof paymentRequests.$inferSelect) => ({
  progress: requestProgress(r),
  amount_zat: r.amount_zat.toString(),
  received_zat: r.received_zat.toString(),
  seen_zat: r.seen_zat.toString(),
});
const NOT_REFUNDED: ActionState[] = ['REJECTED', 'FAILED', 'EXPIRED', 'CANCELLED'];
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface Receipt {
  /** v1: item_hash = SHA-256(item), guessable for short items. v2: a salted commitment (itemCommitment). */
  version: 'lute-receipt-v1' | 'lute-receipt-v2';
  receipt_id: string;
  order_id: string;
  network: Network;
  amount_zat: string;
  paid_zat: string;
  txids: string[];
  item_hash: string;
  paid_at: number;
  key_id: string;
}

/** Sorted-key compact JSON. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * v2 item hash: SHA-256 over a secret salt and the item text, so nobody can test guesses against a
 * receipt. The merchant can reveal the salt (shown on its order view) to prove what was bought.
 */
export const itemCommitment = (saltHex: string, item: string) => createHash('sha256').update(`lute-item-v2|${saltHex}|${item}`, 'utf8').digest('hex');

const receiptMessage = (r: Receipt) => Buffer.from(`lute-receipt-v1|${createHash('sha256').update(canonical(r)).digest('hex')}`, 'utf8');

/** Verifies a receipt signature against a raw hex Ed25519 public key. */
export function verifyReceipt(r: Receipt, signatureHex: string, publicKeyHex: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, receiptMessage(r), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

const OrderBody = z.object({ item: z.string().min(1).max(200), amount_zec: z.string().max(32), ttl_s: z.number().int().min(60).max(7 * 86400).optional() }).strict();
const RefundBody = z.object({ to: z.string().min(1).max(512), amount_zec: z.string().max(32) }).strict();
const VerifyBody = z.object({ receipt: z.record(z.string(), z.unknown()), signature: z.string().regex(/^[0-9a-f]{128}$/) }).strict();

export function registerCommerceRoutes(app: FastifyInstance, d: CommerceDeps): void {
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'NOT_FOUND' });
  const itemAad = (id: string) => `lute-order|${id}|item`;
  const reqDeps = { db: d.db, cipher: d.cipher, sidecar: d.requestSidecar, network: d.network, now: d.now };

  /** The receipt signing key: created once, private half stored encrypted. */
  async function receiptKey(): Promise<{ id: string; publicHex: string; sign: (m: Buffer) => string }> {
    let row = (await d.db.select().from(signingKeys).where(eq(signingKeys.purpose, 'receipt')).limit(1))[0];
    if (!row) {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const pub = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(SPKI_ED25519_PREFIX.length).toString('hex');
      const id = opaqueId();
      const der = (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64');
      await d.db
        .insert(signingKeys)
        .values({ id, purpose: 'receipt', public_key: pub, private_key_enc: d.cipher.encrypt(der, `lute-signing-key|${id}`), created_at: d.now() })
        .onConflictDoNothing();
      row = (await d.db.select().from(signingKeys).where(eq(signingKeys.purpose, 'receipt')).limit(1))[0]!;
    }
    const k = row;
    const priv = createPrivateKey({ key: Buffer.from(d.cipher.decrypt(k.private_key_enc, `lute-signing-key|${k.id}`), 'base64'), format: 'der', type: 'pkcs8' });
    return { id: k.id, publicHex: k.public_key, sign: (m) => sign(null, m, priv).toString('hex') };
  }

  /** Per-order salt: derived from a deterministic Ed25519 signature, so it is secret and needs no storage. */
  const itemSalt = async (orderId: string) => createHash('sha256').update((await receiptKey()).sign(Buffer.from(`lute-item-salt|${orderId}`, 'utf8'))).digest('hex').slice(0, 32);

  /** Refreshes the order's request; issues the receipt the first time it is PAID. */
  async function sync(o: typeof orders.$inferSelect) {
    const r = await refreshRequest(reqDeps, o.request_id);
    if (r && r.status === 'PAID' && !o.receipt_json) {
      const key = await receiptKey();
      const receipt: Receipt = {
        version: 'lute-receipt-v2',
        receipt_id: opaqueId(),
        order_id: o.id,
        network: d.network,
        amount_zat: o.amount_zat.toString(),
        paid_zat: r.received_zat.toString(),
        txids: (r.txids as string[]) ?? [],
        item_hash: itemCommitment(await itemSalt(o.id), d.cipher.decrypt(o.item_enc, itemAad(o.id))),
        paid_at: d.now(),
        key_id: key.id,
      };
      const sig = key.sign(receiptMessage(receipt));
      await d.db.update(orders).set({ receipt_id: receipt.receipt_id, receipt_json: canonical(receipt), receipt_sig: sig }).where(eq(orders.id, o.id));
      o = { ...o, receipt_id: receipt.receipt_id, receipt_json: canonical(receipt), receipt_sig: sig };
    }
    return { o, r };
  }

  async function refunds(orderId: string) {
    const rows = await d.db.select().from(orderRefunds).where(eq(orderRefunds.order_id, orderId)).orderBy(asc(orderRefunds.seq));
    const st = rows.length ? await d.db.select({ id: actions.id, state: actions.state, txid: actions.txid, reject_reason: actions.reject_reason }).from(actions).where(inArray(actions.id, rows.map((x) => x.action_id))) : [];
    const byId = new Map(st.map((a) => [a.id, a]));
    return rows.map((x) => {
      const a = byId.get(x.action_id);
      return { seq: x.seq, action_id: x.action_id, amount_zat: x.amount_zat.toString(), state: (a?.state ?? 'FAILED') as ActionState, txid: a?.txid ?? null, reason: a?.reject_reason ?? null };
    });
  }

  async function view(o: typeof orders.$inferSelect, r?: typeof paymentRequests.$inferSelect | null) {
    const req = r ?? (await d.db.select().from(paymentRequests).where(eq(paymentRequests.id, o.request_id)).limit(1))[0]!;
    const rf = await refunds(o.id);
    const refunded = rf.filter((x) => !NOT_REFUNDED.includes(x.state)).reduce((a, x) => a + BigInt(x.amount_zat), 0n);
    const receipt = o.receipt_json ? (JSON.parse(o.receipt_json) as Receipt) : null;
    return {
      id: o.id,
      item: d.cipher.decrypt(o.item_enc, itemAad(o.id)),
      amount_zat: o.amount_zat.toString(),
      status: req.status,
      received_zat: req.received_zat.toString(),
      txids: req.txids,
      share_path: `/r/${req.id}`,
      expires_at: req.expires_at,
      receipt_id: receipt?.receipt_id ?? null,
      // Reveal this to a customer only to prove the item: SHA-256("lute-item-v2|<salt>|<item>") = item_hash.
      item_salt: receipt?.version === 'lute-receipt-v2' ? await itemSalt(o.id) : null,
      refunded_zat: refunded.toString(),
      refundable_zat: (req.status === 'PAID' ? req.received_zat - refunded : 0n).toString(),
      refunds: rf,
      created_at: o.created_at,
    };
  }

  async function ownedOrder(req: FastifyRequest<{ Params: { id: string } }>) {
    const u = await d.user(req);
    if (!u || u.role === 'user') return { u, o: null };
    if (!ID.test(req.params.id)) return { u, o: null };
    const o = (await d.db.select().from(orders).where(and(eq(orders.id, req.params.id), eq(orders.owner_user_id, u.id))).limit(1))[0];
    return { u, o: o ?? null };
  }

  app.post('/v1/commerce/orders', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (u.role !== 'owner' && u.role !== 'merchant') return notFound(reply);
    const b = OrderBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    let amount: bigint;
    try {
      amount = parseZec(b.data.amount_zec);
    } catch (e) {
      if (e instanceof AmountError) return reply.code(400).send({ error: 'BAD_AMOUNT' });
      throw e;
    }
    if (amount <= 0n) return reply.code(400).send({ error: 'BAD_AMOUNT' });
    const r = await createRequest(reqDeps, u.id, walletOf(u, 'merchant'), amount, b.data.ttl_s ? { ttl_s: b.data.ttl_s } : {});
    const id = opaqueId();
    await d.db.insert(orders).values({ id, owner_user_id: u.id, request_id: r.id, item_enc: d.cipher.encrypt(b.data.item, itemAad(id)), amount_zat: amount, created_at: d.now() });
    return view((await d.db.select().from(orders).where(eq(orders.id, id)).limit(1))[0]!);
  });

  app.get('/v1/commerce/orders', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const rows = await d.db.select().from(orders).where(eq(orders.owner_user_id, u.id)).orderBy(desc(orders.created_at)).limit(100);
    return { orders: await Promise.all(rows.map((o) => view(o))) };
  });

  app.post<{ Params: { id: string } }>('/v1/commerce/orders/:id/refresh', async (req, reply) => {
    const { u, o } = await ownedOrder(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (!o) return notFound(reply);
    const s = await sync(o);
    // Refund payouts move to CONFIRMED like any other payout (the wallet must see the new blocks).
    const open = (await refunds(o.id)).filter((rf) => rf.txid && (rf.state === 'SUBMITTED' || rf.state === 'PENDING_CONFIRMATION'));
    const wallet = walletOf(u, 'merchant');
    if (open.length > 0) await d.requestSidecar.sync(wallet);
    for (const rf of open) {
      if (!rf.txid || (rf.state !== 'SUBMITTED' && rf.state !== 'PENDING_CONFIRMATION')) continue;
      const st = await d.requestSidecar.txStatus(wallet, rf.txid);
      let state = rf.state;
      if (state === 'SUBMITTED' && st.mined_height !== null) {
        await d.store.transition(rf.action_id, 'SUBMITTED', 'PENDING_CONFIRMATION', 'system');
        state = 'PENDING_CONFIRMATION';
      }
      if (state === 'PENDING_CONFIRMATION' && st.confirmations >= (d.network === 'main' ? 3 : 1)) {
        await d.store.transition(rf.action_id, 'PENDING_CONFIRMATION', 'CONFIRMED', 'system');
      }
    }
    return view(s.o, s.r);
  });

  /** Owner-approved refund to an address the customer gave; at most what was paid. */
  app.post<{ Params: { id: string } }>('/v1/commerce/orders/:id/refunds', async (req, reply) => {
    const { u, o } = await ownedOrder(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (!o || u.role !== 'owner') return notFound(reply);
    const idem = req.headers['idempotency-key'];
    if (typeof idem !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(idem)) return reply.code(400).send({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    const b = RefundBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    let amount: bigint;
    try {
      amount = parseZec(b.data.amount_zec);
    } catch (e) {
      if (e instanceof AmountError) return reply.code(400).send({ error: 'BAD_AMOUNT' });
      throw e;
    }
    let action = await d.store.findByIdempotency(u.id, idem);
    if (!action) {
      const v = await view(o);
      if (v.status !== 'PAID') return reply.code(409).send({ error: 'ORDER_NOT_PAID' });
      if (amount <= 0n || amount > BigInt(v.refundable_zat)) return reply.code(409).send({ error: 'OVER_REFUNDABLE', refundable_zat: v.refundable_zat });
      const ref = opaqueId();
      action = await d.store.create(
        {
          id: opaqueId(),
          type: 'REFUND',
          network: d.network,
          state: 'CREATED',
          amount_zat: amount,
          wallet: walletOf(u, 'merchant'),
          recipient_address: b.data.to.trim(),
          recipient_ref: o.id,
          memo: { kind: 'lute_ref', ref },
          memo_text: `LUTE:${ref}`,
          idempotency_key: idem,
          expires_at: d.now() + 15 * 60,
        },
        u.id,
      );
      await d.db.insert(orderRefunds).values({ order_id: o.id, seq: v.refunds.length + 1, action_id: action.id, amount_zat: amount, created_at: d.now() });
    }
    // The wallet must know the current tip before a proposal is built (expiry height).
    if (action.state === 'CREATED') await d.requestSidecar.sync(walletOf(u, 'merchant'));
    const result = await executeAction(
      { store: d.store, sidecar: d.sidecar, configured_network: d.network, now: d.now, newId: opaqueId },
      { actionId: action.id, principal: { kind: 'owner', id: u.id, authenticated: true }, caller: 'api', idempotencyKey: idem },
    );
    return { action_id: action.id, result };
  });

  // ---------------- public (capability = the 128-bit request / receipt id) ----------------

  /** The pay page's "check payment" button: refreshes and, once paid, returns the receipt id. */
  app.post<{ Params: { id: string } }>('/v1/public/requests/:id/check', async (req, reply) => {
    if (!ID.test(req.params.id)) return notFound(reply);
    const o = (await d.db.select().from(orders).where(eq(orders.request_id, req.params.id)).limit(1))[0];
    reply.header('cache-control', 'no-store');
    if (!o) {
      const r = await refreshRequest(reqDeps, req.params.id);
      return r ? { status: r.status === 'PAID' ? 'PAID' : r.status === 'UNPAID' ? 'OPEN' : r.status, ...progressOf(r), receipt_id: null } : notFound(reply);
    }
    const s = await sync(o);
    const receipt = s.o.receipt_json ? (JSON.parse(s.o.receipt_json) as Receipt) : null;
    return { status: s.r?.status === 'PAID' ? 'PAID' : s.r?.status === 'UNPAID' ? 'OPEN' : s.r?.status, ...(s.r ? progressOf(s.r) : {}), receipt_id: receipt?.receipt_id ?? null };
  });

  app.get<{ Params: { id: string } }>('/v1/public/receipts/:id', async (req, reply) => {
    if (!ID.test(req.params.id)) return notFound(reply);
    const o = (await d.db.select().from(orders).where(eq(orders.receipt_id, req.params.id)).limit(1))[0];
    if (!o || !o.receipt_json || !o.receipt_sig) return notFound(reply);
    const key = await receiptKey();
    reply.header('cache-control', 'no-store');
    return { receipt: JSON.parse(o.receipt_json) as Receipt, signature: o.receipt_sig, public_key: key.publicHex, key_id: key.id };
  });

  app.post('/v1/public/receipts/verify', async (req, reply) => {
    const b = VerifyBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    const key = await receiptKey();
    return { valid: verifyReceipt(b.data.receipt as unknown as Receipt, b.data.signature, key.publicHex), public_key: key.publicHex };
  });

  app.get('/v1/public/receipt-key', async () => {
    const key = await receiptKey();
    return { key_id: key.id, public_key: key.publicHex, algorithm: 'ed25519', message: 'lute-receipt-v1|sha256(canonical receipt JSON)' };
  });
}
