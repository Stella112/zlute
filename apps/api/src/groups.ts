/**
 * Groups (mandate §19.4): a shared bill split into one payment request per member. Each member
 * gets their own link (fresh address, own memo), so members never see each other's payments; the
 * organizer sees who has paid. Shares are exact integers: the remainder goes 1 zat at a time to
 * the first members, so shares always add up to the total.
 */
import { asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AmountError, parseZec } from '@lute/core';
import type { Network } from '@lute/luteguard';
import { walletOf, type SessionUser } from './auth.js';
import { opaqueId, type FieldCipher } from './crypto.js';
import { groupMembers, paymentGroups, paymentRequests } from './db/schema.js';
import type { Db } from './db/store.js';
import { createRequest, refreshRequest } from './requests.js';
import type { RequestSidecar } from './sidecar.js';

export interface GroupDeps {
  db: Db;
  cipher: FieldCipher;
  requestSidecar: RequestSidecar;
  network: Network;
  now: () => number;
  user: (req: FastifyRequest) => Promise<SessionUser | null>;
}

const ID = /^[A-Za-z0-9_-]{22}$/;

/** Exact split: every share differs by at most 1 zat and the shares sum to the total. */
export function splitShares(total: bigint, n: number): bigint[] {
  const base = total / BigInt(n);
  const rem = Number(total % BigInt(n));
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1n : 0n));
}

const GroupBody = z.object({ title: z.string().min(1).max(80), total_zec: z.string().max(32), members: z.array(z.string().min(1).max(60)).min(2).max(20), ttl_s: z.number().int().min(60).max(7 * 86400).optional() }).strict();

export function registerGroupRoutes(app: FastifyInstance, d: GroupDeps): void {
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'NOT_FOUND' });
  const reqDeps = { db: d.db, cipher: d.cipher, sidecar: d.requestSidecar, network: d.network, now: d.now };
  const titleAad = (id: string) => `lute-group|${id}|title`;
  const memberAad = (id: string, i: number) => `lute-group|${id}|member|${i}`;

  async function view(g: typeof paymentGroups.$inferSelect) {
    const ms = await d.db.select().from(groupMembers).where(eq(groupMembers.group_id, g.id)).orderBy(asc(groupMembers.idx));
    const members = await Promise.all(
      ms.map(async (m) => {
        const r = (await d.db.select().from(paymentRequests).where(eq(paymentRequests.id, m.request_id)).limit(1))[0]!;
        return { idx: m.idx, label: d.cipher.decrypt(m.label_enc, memberAad(g.id, m.idx)), share_zat: m.share_zat.toString(), status: r.status, received_zat: r.received_zat.toString(), share_path: `/r/${r.id}` };
      }),
    );
    const paid = members.filter((m) => m.status === 'PAID');
    return {
      id: g.id,
      title: d.cipher.decrypt(g.title_enc, titleAad(g.id)),
      total_zat: g.total_zat.toString(),
      collected_zat: paid.reduce((a, m) => a + BigInt(m.received_zat), 0n).toString(),
      paid_members: paid.length,
      members,
      created_at: g.created_at,
    };
  }

  app.post('/v1/groups', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const b = GroupBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
    let total: bigint;
    try {
      total = parseZec(b.data.total_zec);
    } catch (e) {
      if (e instanceof AmountError) return reply.code(400).send({ error: 'BAD_AMOUNT' });
      throw e;
    }
    if (total < BigInt(b.data.members.length)) return reply.code(400).send({ error: 'BAD_AMOUNT' });
    const id = opaqueId();
    await d.db.insert(paymentGroups).values({ id, owner_user_id: u.id, title_enc: d.cipher.encrypt(b.data.title, titleAad(id)), total_zat: total, created_at: d.now() });
    const shares = splitShares(total, b.data.members.length);
    for (const [i, label] of b.data.members.entries()) {
      const r = await createRequest(reqDeps, u.id, walletOf(u, 'merchant'), shares[i]!, b.data.ttl_s ? { ttl_s: b.data.ttl_s } : {});
      await d.db.insert(groupMembers).values({ group_id: id, idx: i, label_enc: d.cipher.encrypt(label, memberAad(id, i)), share_zat: shares[i]!, request_id: r.id });
    }
    return view((await d.db.select().from(paymentGroups).where(eq(paymentGroups.id, id)).limit(1))[0]!);
  });

  app.get('/v1/groups', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const rows = await d.db.select().from(paymentGroups).where(eq(paymentGroups.owner_user_id, u.id)).orderBy(desc(paymentGroups.created_at)).limit(50);
    return { groups: await Promise.all(rows.map(view)) };
  });

  app.post<{ Params: { id: string } }>('/v1/groups/:id/refresh', async (req, reply) => {
    const u = await d.user(req);
    if (!u) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (!ID.test(req.params.id)) return notFound(reply);
    const g = (await d.db.select().from(paymentGroups).where(eq(paymentGroups.id, req.params.id)).limit(1))[0];
    if (!g || g.owner_user_id !== u.id) return notFound(reply);
    for (const m of await d.db.select().from(groupMembers).where(eq(groupMembers.group_id, g.id))) await refreshRequest(reqDeps, m.request_id);
    return view(g);
  });
}
