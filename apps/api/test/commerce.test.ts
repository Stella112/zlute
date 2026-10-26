import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalHash, type RecipientInspection, type SidecarProposalSummary } from '@lute/luteguard';
import type { ExecuteOutcome, ProposalView, SidecarClient, SidecarResult } from '@lute/core';
import { buildApp } from '../src/app.js';
import { itemCommitment } from '../src/commerce.js';
import { createUser } from '../src/auth.js';
import { FieldCipher } from '../src/crypto.js';
import { schemaSql } from '../src/db/migrate.js';
import { PgActionStore } from '../src/db/store.js';
import type { RequestCheck, RequestSidecar, TxStatus } from '../src/sidecar.js';

const T0 = 1_800_000_000;
const PW = 'correct horse battery staple';
const REQ_ADDR = 'uregtest1merchantrequestaddress';
const CUSTOMER = 'uregtest1customerrefundaddress';
const ITEM = 'Lute T-shirt, size M';

class FakeSidecar implements SidecarClient {
  proposed: { to: string; amount: bigint }[] = [];
  async inspect(): Promise<RecipientInspection> {
    return { verdict: 'ALLOWED', kind: 'unified', has_orchard: true, has_sapling: true, has_transparent: false, payable_pools: ['ironwood'] };
  }
  async propose(_w: string, r: { to: string; amount_zat: bigint }): Promise<SidecarResult<ProposalView>> {
    this.proposed.push({ to: r.to, amount: r.amount_zat });
    const s: SidecarProposalSummary = {
      proposal_id: `p${this.proposed.length}`,
      account: 'a',
      network: 'regtest',
      recipient: r.to,
      recipient_pool: 'ironwood',
      amount_zat: Number(r.amount_zat),
      fee_zat: 10000,
      input_pools: ['ironwood'],
      output_pools: ['ironwood'],
      change_pools: ['ironwood'],
      policy: 'LUTE_STRICT/D-002',
      memo_hash: 'x',
      created_at: T0,
      expires_at: T0 + 300,
    };
    const h = canonicalHash(s);
    return { ok: true, value: { proposal_hash: h, sign_message: `lute-approve-v1|regtest|${h}`, summary: s } };
  }
  async approve(): Promise<SidecarResult<true>> {
    return { ok: true, value: true };
  }
  async execute(): Promise<SidecarResult<ExecuteOutcome>> {
    return { ok: true, value: { proposal_hash: 'h', status: 'submitted', txid: 'ef'.repeat(32), broadcast: 'accepted' } };
  }
  async executeMandate(): Promise<SidecarResult<ExecuteOutcome>> {
    return { ok: false, code: 'NO_MANDATE' };
  }
}

class FakeReq implements RequestSidecar {
  check: RequestCheck = { status: 'UNPAID', matched_by: null, requested_zat: 0, received_confirmed_zat: 0, received_pending_zat: 0, overpaid_zat: 0, txids: [] };
  async balance() {
    return { chain_tip_height: 1, fully_scanned_height: 1, ironwood: { spendable_zat: 0, total_zat: 0 }, orchard: { spendable_zat: 0, total_zat: 0 }, sapling: { spendable_zat: 0, total_zat: 0 }, transparent_total_zat: 0 };
  }
  async newAddress() {
    return REQ_ADDR;
  }
  async buildZip321() {
    return `zcash:${REQ_ADDR}?amount=0.002`;
  }
  async sync() {}
  async checkRequest(): Promise<RequestCheck> {
    return this.check;
  }
  async txStatus(_w: string, txid: string): Promise<TxStatus> {
    return { txid, known: true, mined_height: 5, confirmations: 1, expired_unmined: false };
  }
}

async function setup() {
  const pg = new PGlite();
  await pg.exec(schemaSql());
  const db = drizzle(pg);
  const cipher = FieldCipher.fromHex('44'.repeat(32));
  const store = new PgActionStore(db, cipher, () => T0);
  const sidecar = new FakeSidecar();
  const req = new FakeReq();
  await createUser(db, 'maris', PW, 'owner', T0);
  await createUser(db, 'mallory', PW, 'owner', T0);
  const app = await buildApp({ db, store, sidecar, requestSidecar: req, cipher, network: 'regtest', now: () => T0, secureCookies: false, appOrigin: 'https://x' });
  const login = async (u: string) => String((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: u, password: PW } })).headers['set-cookie']).split(';')[0]!;
  return { app, pg, sidecar, req, cookie: await login('maris'), login };
}

describe('commerce: checkout, signed receipts, refunds (§19.3, U10)', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  const as = (method: 'GET' | 'POST', url: string, payload?: object, headers: Record<string, string> = {}) =>
    t.app.inject({ method, url, payload, headers: { cookie: t.cookie, ...headers } });
  const paid = () => {
    t.req.check = { status: 'PAID', matched_by: 'address_and_memo', requested_zat: 200000, received_confirmed_zat: 200000, received_pending_zat: 0, overpaid_zat: 0, txids: ['aa'.repeat(32)] };
  };

  beforeEach(async () => {
    t = await setup();
  });

  it('an order is a payment request; no receipt until it is PAID', async () => {
    const o = (await as('POST', '/v1/commerce/orders', { item: ITEM, amount_zec: '0.002' })).json();
    expect(o).toMatchObject({ item: ITEM, amount_zat: '200000', status: 'UNPAID', receipt_id: null });
    expect(o.share_path).toMatch(/^\/r\/[A-Za-z0-9_-]{22}$/);
    expect((await as('POST', `/v1/commerce/orders/${o.id}/refresh`)).json().receipt_id).toBeNull();
  });

  it('U10: the receipt verifies; a tampered receipt does not; it carries no address or item text', async () => {
    const o = (await as('POST', '/v1/commerce/orders', { item: ITEM, amount_zec: '0.002' })).json();
    paid();
    const requestId = o.share_path.slice(3);
    const check = (await t.app.inject({ method: 'POST', url: `/v1/public/requests/${requestId}/check` })).json();
    expect(check.status).toBe('PAID');
    const pub = await t.app.inject({ method: 'GET', url: `/v1/public/receipts/${check.receipt_id}` });
    const { receipt, signature } = pub.json();
    expect(receipt).toMatchObject({ version: 'lute-receipt-v2', order_id: o.id, amount_zat: '200000', paid_zat: '200000', txids: ['aa'.repeat(32)] });
    expect(pub.body).not.toContain(REQ_ADDR);
    expect(pub.body).not.toContain(ITEM);
    // The item hash is salted: guessing the item text does not match it; the merchant's salt does.
    expect(receipt.item_hash).not.toBe(createHash('sha256').update(ITEM).digest('hex'));
    const salt = (await as('POST', `/v1/commerce/orders/${o.id}/refresh`)).json().item_salt;
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(itemCommitment(salt, ITEM)).toBe(receipt.item_hash);
    expect(pub.body).not.toContain(salt);
    const ok = await t.app.inject({ method: 'POST', url: '/v1/public/receipts/verify', payload: { receipt, signature } });
    expect(ok.json().valid).toBe(true);
    const forged = await t.app.inject({ method: 'POST', url: '/v1/public/receipts/verify', payload: { receipt: { ...receipt, paid_zat: '2000000' }, signature } });
    expect(forged.json().valid).toBe(false);
    // Issued once: refreshing again keeps the same receipt.
    expect((await as('POST', `/v1/commerce/orders/${o.id}/refresh`)).json().receipt_id).toBe(check.receipt_id);
  });

  it('refunds: only after payment, never more than was paid, owner-approved through LuteGuard', async () => {
    const o = (await as('POST', '/v1/commerce/orders', { item: ITEM, amount_zec: '0.002' })).json();
    expect((await as('POST', `/v1/commerce/orders/${o.id}/refunds`, { to: CUSTOMER, amount_zec: '0.001' }, { 'idempotency-key': 'refund-early' })).json()).toEqual({ error: 'ORDER_NOT_PAID' });
    paid();
    await as('POST', `/v1/commerce/orders/${o.id}/refresh`);
    expect((await as('POST', `/v1/commerce/orders/${o.id}/refunds`, { to: CUSTOMER, amount_zec: '0.0021' }, { 'idempotency-key': 'refund-big1' })).json()).toMatchObject({ error: 'OVER_REFUNDABLE', refundable_zat: '200000' });
    const r = (await as('POST', `/v1/commerce/orders/${o.id}/refunds`, { to: CUSTOMER, amount_zec: '0.0015' }, { 'idempotency-key': 'refund-0001' })).json();
    expect(r.result.state).toBe('AWAITING_AUTHORIZATION');
    expect(t.sidecar.proposed).toEqual([{ to: CUSTOMER, amount: 150000n }]);
    const a = (await as('POST', `/v1/actions/${r.action_id}/authorize`, { signature: 'a'.repeat(128) })).json();
    expect(a.result.state).toBe('SUBMITTED');
    const v = (await as('POST', `/v1/commerce/orders/${o.id}/refresh`)).json();
    expect(v).toMatchObject({ refunded_zat: '150000', refundable_zat: '50000' });
    expect(v.refunds[0].state).toBe('CONFIRMED');
    // A second refund may only take what is left.
    expect((await as('POST', `/v1/commerce/orders/${o.id}/refunds`, { to: CUSTOMER, amount_zec: '0.0006' }, { 'idempotency-key': 'refund-0002' })).json().error).toBe('OVER_REFUNDABLE');
    // The refund address is stored encrypted and never listed.
    expect((await as('GET', '/v1/commerce/orders')).body).not.toContain(CUSTOMER);
  });

  it('other users get 404; unknown receipts are 404', async () => {
    const o = (await as('POST', '/v1/commerce/orders', { item: ITEM, amount_zec: '0.002' })).json();
    const mallory = await t.login('mallory');
    expect((await t.app.inject({ method: 'POST', url: `/v1/commerce/orders/${o.id}/refresh`, headers: { cookie: mallory } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/v1/commerce/orders/${o.id}/refunds`, payload: { to: CUSTOMER, amount_zec: '0.001' }, headers: { cookie: mallory, 'idempotency-key': 'refund-mall' } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/v1/public/receipts/${'A'.repeat(22)}` })).statusCode).toBe(404);
  });
});
