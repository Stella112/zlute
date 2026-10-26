/**
 * Payment requests (mandate §19.2).
 * - Owner/merchant creates a request: the sidecar issues a fresh shielded-only address; the
 *   opaque id doubles as the memo reference (LUTE:<id>); the ZIP-321 URI is built by the sidecar.
 * - Private details are encrypted in the browser with a key that only lives in the share link's
 *   #fragment (`/r/<id>#k=…`); the server stores ciphertext only.
 * - Status comes from the sidecar's request check; never PAID without enough confirmations.
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AmountError, parseZec } from '@lute/core';
import type { Network } from '@lute/luteguard';
import { walletOf, type SessionUser } from './auth.js';
import { opaqueId, type FieldCipher } from './crypto.js';
import { paymentRequests } from './db/schema.js';
import type { Db } from './db/store.js';
import type { RequestSidecar } from './sidecar.js';

export interface RequestDeps {
  db: Db;
  cipher: FieldCipher;
  sidecar: RequestSidecar;
  network: Network;
  now: () => number;
  user: (req: import('fastify').FastifyRequest) => Promise<SessionUser | null>;
}

const MAX_TTL_S = 7 * 24 * 3600;
const DEFAULT_TTL_S = 24 * 3600;

const CreateBody = z
  .object({
    wallet: z.enum(['merchant', 'payout', 'agent']).default('merchant'),
    amount_zec: z.string().max(32),
    /** base64url ciphertext produced in the browser; never decrypted server-side. */
    details_ciphertext: z.string().regex(/^[A-Za-z0-9_-]{16,11000}$/).optional(),
    ttl_s: z.number().int().min(60).max(MAX_TTL_S).optional(),
  })
  .strict();

const ID = /^[A-Za-z0-9_-]{22}$/;

export function minConf(network: Network): number {
  return network === 'main' ? 3 : 1;
}

const aad = (id: string, f: string) => `lute-request|${id}|${f}`;

/** Creates a payment request: fresh shielded-only address, ZIP-321 URI, opaque id = memo ref. */
export async function createRequest(
  d: Pick<RequestDeps, 'db' | 'cipher' | 'sidecar' | 'network' | 'now'>,
  ownerUserId: string,
  wallet: string,
  amount: bigint,
  opts: { details_ciphertext?: string; ttl_s?: number } = {},
): Promise<{ id: string; share_path: string; expires_at: number }> {
  const id = opaqueId();
  const address = await d.sidecar.newAddress(wallet);
  const uri = await d.sidecar.buildZip321(address, amount, id);
  const now = d.now();
  const expires_at = now + (opts.ttl_s ?? DEFAULT_TTL_S);
  await d.db.insert(paymentRequests).values({
    id,
    owner_user_id: ownerUserId,
    wallet,
    network: d.network,
    amount_zat: amount,
    address_enc: d.cipher.encrypt(address, aad(id, 'address')),
    zip321_enc: d.cipher.encrypt(uri, aad(id, 'zip321')),
    details_ciphertext: opts.details_ciphertext ?? null,
    status: 'UNPAID',
    expires_at,
    created_at: now,
    updated_at: now,
  });
  // The client appends #k=<base64url key> itself; the key never reaches the server (U2).
  return { id, share_path: `/r/${id}`, expires_at };
}

/**
 * What the payer and owner see: PARTIAL when less than the amount has arrived (even unconfirmed),
 * CONFIRMING when the full amount is seen but not yet confirmed.
 */
export type RequestProgress = 'OPEN' | 'PARTIAL' | 'CONFIRMING' | 'PAID' | 'EXPIRED';
export function requestProgress(r: { status: string; amount_zat: bigint; seen_zat: bigint }): RequestProgress {
  if (r.status === 'PAID') return 'PAID';
  if (r.status === 'PENDING') return r.seen_zat < r.amount_zat ? 'PARTIAL' : 'CONFIRMING';
  return r.status === 'EXPIRED' ? 'EXPIRED' : 'OPEN';
}

/** Re-checks an unpaid request with the sidecar (sync + check) and stores the result. */
export async function refreshRequest(d: Pick<RequestDeps, 'db' | 'cipher' | 'sidecar' | 'network' | 'now'>, id: string) {
  const r = (await d.db.select().from(paymentRequests).where(eq(paymentRequests.id, id)).limit(1))[0];
  if (!r) return null;
  if (r.status !== 'PAID') {
    await d.sidecar.sync(r.wallet);
    const c = await d.sidecar.checkRequest(r.wallet, {
      address: d.cipher.decrypt(r.address_enc, aad(r.id, 'address')),
      amount_zat: r.amount_zat,
      opaque_ref: r.id,
      min_conf: minConf(d.network),
    });
    // An expired, still-unpaid request becomes EXPIRED; anything received is still reported.
    const status = c.status === 'UNPAID' && d.now() >= r.expires_at ? 'EXPIRED' : c.status;
    await d.db
      .update(paymentRequests)
      .set({ status, received_zat: BigInt(c.received_confirmed_zat), seen_zat: BigInt(c.received_confirmed_zat) + BigInt(c.received_pending_zat), matched_by: c.matched_by, txids: c.txids, updated_at: d.now() })
      .where(eq(paymentRequests.id, r.id));
  }
  return (await d.db.select().from(paymentRequests).where(eq(paymentRequests.id, r.id)).limit(1))[0]!;
}

export function registerRequestRoutes(app: FastifyInstance, d: RequestDeps): void {
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'NOT_FOUND' });

  app.post('/v1/requests', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (u.role !== 'owner' && u.role !== 'merchant') return notFound(reply);
    const body = CreateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    let amount: bigint;
    try {
      amount = parseZec(body.data.amount_zec);
    } catch (e) {
      if (e instanceof AmountError) return reply.code(400).send({ error: 'BAD_AMOUNT' });
      throw e;
    }
    if (amount <= 0n) return reply.code(400).send({ error: 'BAD_AMOUNT' });

    return createRequest(d, u.id, walletOf(u, body.data.wallet), amount, {
      ...(body.data.details_ciphertext ? { details_ciphertext: body.data.details_ciphertext } : {}),
      ...(body.data.ttl_s ? { ttl_s: body.data.ttl_s } : {}),
    });
  });

  /** Owner view: refreshes status from the sidecar (sync + check). */
  app.post<{ Params: { id: string } }>('/v1/requests/:id/refresh', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (!ID.test(req.params.id)) return notFound(reply);
    const rows = await d.db
      .select()
      .from(paymentRequests)
      .where(and(eq(paymentRequests.id, req.params.id), eq(paymentRequests.owner_user_id, u.id)))
      .limit(1);
    const r = rows[0];
    if (!r) return notFound(reply);
    const fresh = (await refreshRequest(d, r.id))!;
    return {
      id: fresh.id,
      status: fresh.status,
      amount_zat: fresh.amount_zat.toString(),
      received_zat: fresh.received_zat.toString(),
      seen_zat: fresh.seen_zat.toString(),
      progress: requestProgress(fresh),
      matched_by: fresh.matched_by,
      txids: fresh.txids,
      min_confirmations: minConf(d.network),
      expires_at: fresh.expires_at,
    };
  });

  /**
   * Pay page data. The 128-bit id is the capability: holders of the link learn the payment
   * instructions (address, amount, memo via the ZIP-321 URI). Descriptive details stay encrypted
   * with the fragment key. No owner identity is returned.
   */
  app.get<{ Params: { id: string } }>('/v1/public/requests/:id', async (req, reply) => {
    if (!ID.test(req.params.id)) return notFound(reply);
    const r = (await d.db.select().from(paymentRequests).where(eq(paymentRequests.id, req.params.id)).limit(1))[0];
    if (!r) return notFound(reply);
    const open = r.status !== 'PAID' && r.status !== 'EXPIRED' && d.now() < r.expires_at;
    reply.header('cache-control', 'no-store');
    reply.header('referrer-policy', 'no-referrer');
    return {
      status: open ? 'OPEN' : r.status === 'PAID' ? 'PAID' : 'CLOSED',
      amount_zat: r.amount_zat.toString(),
      zip321_uri: open ? d.cipher.decrypt(r.zip321_enc, aad(r.id, 'zip321')) : null,
      details_ciphertext: r.details_ciphertext,
      expires_at: r.expires_at,
    };
  });
}
