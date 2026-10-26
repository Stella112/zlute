import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ExecuteOutcome, ProposalView, SidecarClient, SidecarResult } from '@lute/core';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/auth.js';
import { FieldCipher } from '../src/crypto.js';
import { schemaSql } from '../src/db/migrate.js';
import { PgActionStore } from '../src/db/store.js';
import { splitShares } from '../src/groups.js';
import type { RequestCheck, RequestSidecar, TxStatus } from '../src/sidecar.js';
import { subscriptionStatus } from '../src/subscriptions.js';

const T0 = 1_800_000_000;
const PW = 'correct horse battery staple';
let clock = T0;

const unused = async (): Promise<never> => {
  throw new Error('unused');
};
const sidecar: SidecarClient = {
  inspect: unused,
  propose: unused as () => Promise<SidecarResult<ProposalView>>,
  approve: unused,
  execute: unused as () => Promise<SidecarResult<ExecuteOutcome>>,
  executeMandate: unused as () => Promise<SidecarResult<ExecuteOutcome>>,
};

class FakeReq implements RequestSidecar {
  addresses = 0;
  paid = new Set<string>();
  async balance() {
    return { chain_tip_height: 1, fully_scanned_height: 1, ironwood: { spendable_zat: 0, total_zat: 0 }, orchard: { spendable_zat: 0, total_zat: 0 }, sapling: { spendable_zat: 0, total_zat: 0 }, transparent_total_zat: 0 };
  }
  async newAddress() {
    return `uregtest1addr${++this.addresses}`;
  }
  async buildZip321(a: string) {
    return `zcash:${a}`;
  }
  async sync() {}
  async checkRequest(_w: string, r: { opaque_ref: string; amount_zat: bigint }): Promise<RequestCheck> {
    const p = this.paid.has(r.opaque_ref);
    return { status: p ? 'PAID' : 'UNPAID', matched_by: p ? 'address_and_memo' : null, requested_zat: Number(r.amount_zat), received_confirmed_zat: p ? Number(r.amount_zat) : 0, received_pending_zat: 0, overpaid_zat: 0, txids: p ? ['bb'.repeat(32)] : [] };
  }
  async txStatus(_w: string, txid: string): Promise<TxStatus> {
    return { txid, known: true, mined_height: 1, confirmations: 1, expired_unmined: false };
  }
}

async function setup() {
  clock = T0;
  const pg = new PGlite();
  await pg.exec(schemaSql());
  const db = drizzle(pg);
  const cipher = FieldCipher.fromHex('55'.repeat(32));
  const store = new PgActionStore(db, cipher, () => clock);
  const req = new FakeReq();
  await createUser(db, 'maris', PW, 'owner', T0);
  await createUser(db, 'mallory', PW, 'owner', T0);
  const app = await buildApp({ db, store, sidecar, requestSidecar: req, cipher, network: 'regtest', now: () => clock, secureCookies: false, appOrigin: 'https://x' });
  const login = async (u: string) => String((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: u, password: PW } })).headers['set-cookie']).split(';')[0]!;
  return { app, req, cookie: await login('maris'), login };
}

describe('subscriptions (§19.7)', () => {
  it('status rule: ACTIVE when the period is paid, DUE inside grace, LAPSED after, CANCELLED wins', () => {
    const p = { start_ts: 1000, period_s: 100, grace_s: 30, cancelled_at: null };
    expect(subscriptionStatus(p, 1010, true)).toMatchObject({ status: 'ACTIVE', period_no: 0, period_end: 1100 });
    expect(subscriptionStatus(p, 1110, false)).toMatchObject({ status: 'DUE', period_no: 1, period_start: 1100 });
    expect(subscriptionStatus(p, 1131, false)).toMatchObject({ status: 'LAPSED', period_no: 1 });
    expect(subscriptionStatus({ ...p, cancelled_at: 1050 }, 1010, true).status).toBe('CANCELLED');
  });

  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
  });
  const as = (method: 'GET' | 'POST', url: string, payload?: object) => t.app.inject({ method, url, payload, headers: { cookie: t.cookie } });

  it('each period gets its own invoice; paying it makes the subscription ACTIVE until the period ends', async () => {
    const plan = (await as('POST', '/v1/subscriptions/plans', { name: 'Pro', amount_zec: '0.001', period_s: 3600, grace_s: 600 })).json();
    const s = (await as('POST', '/v1/subscriptions', { plan_id: plan.id, subscriber: 'Ada' })).json();
    expect(s).toMatchObject({ status: 'DUE', period_no: 0, subscriber: 'Ada' });
    const first = s.current_invoice.request_id;
    t.req.paid.add(first);
    expect((await as('POST', `/v1/subscriptions/${s.id}/refresh`)).json().status).toBe('ACTIVE');
    // Next period: a new invoice, DUE in grace, LAPSED after it.
    clock = T0 + 3600 + 10;
    const v = (await as('POST', `/v1/subscriptions/${s.id}/refresh`)).json();
    expect(v).toMatchObject({ status: 'DUE', period_no: 1, invoices: 2 });
    expect(v.current_invoice.request_id).not.toBe(first);
    clock = T0 + 3600 + 601;
    expect((await as('POST', `/v1/subscriptions/${s.id}/refresh`)).json().status).toBe('LAPSED');
  });

  it('the subscriber page shows status and the invoice to pay, nothing about the merchant; cancel stops billing', async () => {
    const plan = (await as('POST', '/v1/subscriptions/plans', { name: 'Pro', amount_zec: '0.001', period_s: 3600, grace_s: 600 })).json();
    const s = (await as('POST', '/v1/subscriptions', { plan_id: plan.id, subscriber: 'Ada' })).json();
    const pub = await t.app.inject({ method: 'POST', url: `/v1/public/subscriptions/${s.id}` });
    expect(pub.json()).toMatchObject({ status: 'DUE', plan: { name: 'Pro', amount_zat: '100000' } });
    expect(pub.json().pay_path).toMatch(/^\/r\//);
    expect(pub.body).not.toContain('Ada');
    expect(pub.body).not.toContain('maris');
    await as('POST', `/v1/subscriptions/${s.id}/cancel`);
    expect((await t.app.inject({ method: 'POST', url: `/v1/public/subscriptions/${s.id}` })).json()).toMatchObject({ status: 'CANCELLED', pay_path: null });
    const mallory = await t.login('mallory');
    expect((await t.app.inject({ method: 'POST', url: `/v1/subscriptions/${s.id}/refresh`, headers: { cookie: mallory } })).statusCode).toBe(404);
  });
});

describe('groups (§19.4)', () => {
  it('splits exactly: shares differ by at most 1 zat and sum to the total', () => {
    expect(splitShares(100n, 3)).toEqual([34n, 33n, 33n]);
    for (const [total, n] of [[1_000_001n, 7], [3n, 3], [999_999_999n, 20]] as const) {
      const s = splitShares(total, n);
      expect(s.reduce((a, b) => a + b, 0n)).toBe(total);
      expect(Number(s[0]! - s[s.length - 1]!)).toBeLessThanOrEqual(1);
    }
  });

  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
  });
  const as = (method: 'GET' | 'POST', url: string, payload?: object) => t.app.inject({ method, url, payload, headers: { cookie: t.cookie } });

  it('one request per member with its own address; the organizer sees who paid', async () => {
    const g = (await as('POST', '/v1/groups', { title: 'Dinner', total_zec: '0.003', members: ['Ada', 'Bo', 'Cy'] })).json();
    expect(g.members.map((m: { share_zat: string }) => m.share_zat)).toEqual(['100000', '100000', '100000']);
    expect(new Set(g.members.map((m: { share_path: string }) => m.share_path)).size).toBe(3);
    expect(t.req.addresses).toBe(3);
    t.req.paid.add(g.members[1].share_path.slice(3));
    const v = (await as('POST', `/v1/groups/${g.id}/refresh`)).json();
    expect(v).toMatchObject({ paid_members: 1, collected_zat: '100000' });
    expect(v.members.map((m: { status: string }) => m.status)).toEqual(['UNPAID', 'PAID', 'UNPAID']);
    // A member's pay page shows only their own share.
    const pub = await t.app.inject({ method: 'GET', url: `/v1/public/requests/${g.members[0].share_path.slice(3)}` });
    expect(pub.json().amount_zat).toBe('100000');
    expect(pub.body).not.toContain('Bo');
    const mallory = await t.login('mallory');
    expect((await t.app.inject({ method: 'POST', url: `/v1/groups/${g.id}/refresh`, headers: { cookie: mallory } })).statusCode).toBe(404);
  });
});
