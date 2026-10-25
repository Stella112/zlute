import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalHash, type RecipientInspection, type SidecarProposalSummary } from '@lute/luteguard';
import type { ExecuteOutcome, ProposalView, SidecarClient, SidecarResult } from '@lute/core';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/auth.js';
import { FieldCipher } from '../src/crypto.js';
import { schemaSql } from '../src/db/migrate.js';
import { PgActionStore } from '../src/db/store.js';
import type { RequestCheck, RequestSidecar, TxStatus } from '../src/sidecar.js';

const T0 = 1_800_000_000;
const RECIPIENT = 'uregtest1streamrecipient';
const PW = 'correct horse battery staple';
let clock = T0;

class FakeSidecar implements SidecarClient {
  inspection: RecipientInspection = { verdict: 'ALLOWED', kind: 'unified', has_orchard: true, has_sapling: true, has_transparent: false, payable_pools: ['ironwood', 'sapling'] };
  proposed: bigint[] = [];
  executed = 0;
  async inspect() {
    return this.inspection;
  }
  async propose(_w: string, r: { amount_zat: bigint }): Promise<SidecarResult<ProposalView>> {
    this.proposed.push(r.amount_zat);
    const s: SidecarProposalSummary = {
      proposal_id: `p${this.proposed.length}`,
      account: 'a',
      network: 'regtest',
      recipient: RECIPIENT,
      recipient_pool: 'ironwood',
      amount_zat: Number(r.amount_zat),
      fee_zat: 10000,
      input_pools: ['ironwood'],
      output_pools: ['ironwood'],
      change_pools: ['ironwood'],
      policy: 'LUTE_STRICT/D-002',
      memo_hash: 'x',
      created_at: clock,
      expires_at: clock + 300,
    };
    const h = canonicalHash(s);
    return { ok: true, value: { proposal_hash: h, sign_message: `lute-approve-v1|regtest|${h}`, summary: s } };
  }
  async approve(): Promise<SidecarResult<true>> {
    return { ok: true, value: true };
  }
  async execute(): Promise<SidecarResult<ExecuteOutcome>> {
    this.executed++;
    return { ok: true, value: { proposal_hash: 'h', status: 'submitted', txid: `${'ab'.repeat(31)}${String(this.executed).padStart(2, '0')}`, broadcast: 'accepted' } };
  }
}

class FakeReq implements RequestSidecar {
  tx: Partial<TxStatus> = { mined_height: null, confirmations: 0, expired_unmined: false };
  async newAddress() {
    return 'uregtest1x';
  }
  async buildZip321() {
    return 'zcash:x';
  }
  async sync() {}
  async checkRequest(): Promise<RequestCheck> {
    throw new Error('unused');
  }
  async txStatus(_w: string, txid: string): Promise<TxStatus> {
    return { txid, known: true, mined_height: null, confirmations: 0, expired_unmined: false, ...this.tx } as TxStatus;
  }
}

async function setup() {
  clock = T0;
  const pg = new PGlite();
  await pg.exec(schemaSql());
  const db = drizzle(pg);
  const cipher = FieldCipher.fromHex('22'.repeat(32));
  const store = new PgActionStore(db, cipher, () => clock);
  const sidecar = new FakeSidecar();
  const req = new FakeReq();
  await createUser(db, 'maris', PW, 'owner', T0);
  await createUser(db, 'mallory', PW, 'owner', T0);
  const app = await buildApp({ db, store, sidecar, requestSidecar: req, cipher, network: 'regtest', now: () => clock, secureCookies: false, appOrigin: 'https://x', minPayoutZat: 1_000n });
  const login = async (u: string) =>
    String((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: u, password: PW } })).headers['set-cookie']).split(';')[0]!;
  return { app, pg, sidecar, req, login };
}

describe('streams API (S group)', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let cookie: string;
  const create = (body: object = { to: RECIPIENT, total_zec: '0.001', duration_s: 100 }) =>
    t.app.inject({ method: 'POST', url: '/v1/streams', payload: body, headers: { cookie } });
  const get = (id: string) => t.app.inject({ method: 'GET', url: `/v1/streams/${id}`, headers: { cookie } });
  const settle = (id: string, key: string) => t.app.inject({ method: 'POST', url: `/v1/streams/${id}/settle`, headers: { cookie, 'idempotency-key': key } });
  const authorize = (actionId: string) =>
    t.app.inject({ method: 'POST', url: `/v1/actions/${actionId}/authorize`, payload: { signature: 'a'.repeat(128) }, headers: { cookie } });
  const refresh = (id: string) => t.app.inject({ method: 'POST', url: `/v1/streams/${id}/refresh`, headers: { cookie } });

  beforeEach(async () => {
    t = await setup();
    cookie = await t.login('maris');
  });

  it('accrues per second on the server clock, with accrued and paid kept separate (S12)', async () => {
    const s = (await create()).json();
    expect(s.status).toBe('ACTIVE');
    clock = T0 + 25;
    const v = (await get(s.id)).json();
    expect(v).toMatchObject({ contracted_zat: '100000', accrued_zat: '25000', pending_zat: '0', confirmed_paid_zat: '0', outstanding_zat: '25000' });
    expect(v.labels.accrued).toBe('Earned (accounting), not wallet funds');
    expect(JSON.stringify(v)).not.toContain(RECIPIENT);
  });

  it('settle, authorize, mined, confirmed: paid only after confirmations (F6, S14 path)', async () => {
    const s = (await create()).json();
    clock = T0 + 40;
    const r = (await settle(s.id, 'settle-0001')).json();
    expect(r.result.state).toBe('AWAITING_AUTHORIZATION');
    expect(t.sidecar.proposed).toEqual([40_000n]);
    expect((await authorize(r.action_id)).json().result.state).toBe('SUBMITTED');
    let v = (await get(s.id)).json();
    expect(v).toMatchObject({ pending_zat: '40000', confirmed_paid_zat: '0' });
    t.req.tx = { mined_height: 10, confirmations: 0 };
    v = (await refresh(s.id)).json();
    expect(v.settlements[0].state).toBe('PENDING_CONFIRMATION');
    expect(v.confirmed_paid_zat).toBe('0');
    t.req.tx = { mined_height: 10, confirmations: 1 };
    v = (await refresh(s.id)).json();
    expect(v).toMatchObject({ pending_zat: '0', confirmed_paid_zat: '40000', outstanding_zat: '0' });
  });

  it('S10: a duplicate settle request never creates a second payout', async () => {
    const s = (await create()).json();
    clock = T0 + 30;
    const a = (await settle(s.id, 'settle-dup1')).json();
    const b = (await settle(s.id, 'settle-dup1')).json();
    expect(b.action_id).toBe(a.action_id);
    expect(t.sidecar.proposed).toHaveLength(1);
    // With the first settlement still pending, a new request settles only what is newly due.
    clock = T0 + 50;
    await settle(s.id, 'settle-dup2');
    expect(t.sidecar.proposed).toEqual([30_000n, 20_000n]);
  });

  it('S6: a settlement after the end pays exactly the contracted total', async () => {
    const s = (await create({ to: RECIPIENT, total_zec: '0.00100003', duration_s: 70 })).json();
    clock = T0 + 1000;
    await settle(s.id, 'settle-full');
    expect(t.sidecar.proposed).toEqual([100_003n]);
  });

  it('S7/S8: pause stops accrual, resume restarts it, cancel freezes it', async () => {
    const s = (await create()).json();
    clock = T0 + 10;
    await t.app.inject({ method: 'POST', url: `/v1/streams/${s.id}/pause`, headers: { cookie } });
    clock = T0 + 60;
    expect((await get(s.id)).json()).toMatchObject({ status: 'PAUSED', accrued_zat: '10000' });
    await t.app.inject({ method: 'POST', url: `/v1/streams/${s.id}/resume`, headers: { cookie } });
    clock = T0 + 70;
    expect((await get(s.id)).json().accrued_zat).toBe('20000');
    await t.app.inject({ method: 'POST', url: `/v1/streams/${s.id}/cancel`, headers: { cookie } });
    clock = T0 + 99;
    expect((await get(s.id)).json()).toMatchObject({ status: 'CANCELLED', accrued_zat: '20000' });
    expect((await t.app.inject({ method: 'POST', url: `/v1/streams/${s.id}/resume`, headers: { cookie } })).statusCode).toBe(409);
  });

  it('an expired unmined settlement stops counting as pending: due again, never paid', async () => {
    const s = (await create()).json();
    clock = T0 + 20;
    const r = (await settle(s.id, 'settle-exp1')).json();
    await authorize(r.action_id);
    t.req.tx = { mined_height: null, confirmations: 0, expired_unmined: true };
    const v = (await refresh(s.id)).json();
    expect(v.settlements[0].state).toBe('FAILED');
    expect(v).toMatchObject({ pending_zat: '0', confirmed_paid_zat: '0', outstanding_zat: '20000' });
  });

  it('a body-less POST with a form content type is a 415, not a 500 (PowerShell 5.1 default)', async () => {
    const s = (await create()).json();
    const r = await t.app.inject({ method: 'POST', url: `/v1/streams/${s.id}/settle`, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': 'settle-form' }, payload: '' });
    expect(r.statusCode).toBe(415);
    expect(r.json()).toEqual({ error: 'FST_ERR_CTP_INVALID_MEDIA_TYPE' });
  });

  it('refuses transparent recipients, nothing-due settlements, and other users (U6)', async () => {
    t.sidecar.inspection = { ...t.sidecar.inspection, verdict: 'DENIED_TRANSPARENT', payable_pools: [] };
    expect((await create()).json()).toEqual({ error: 'RECIPIENT_DENIED_TRANSPARENT' });
    t.sidecar.inspection = { ...t.sidecar.inspection, verdict: 'ALLOWED', payable_pools: ['ironwood'] };
    const s = (await create()).json();
    expect((await settle(s.id, 'settle-none')).json()).toEqual({ error: 'NOTHING_DUE' });
    const mallory = await t.login('mallory');
    expect((await t.app.inject({ method: 'GET', url: `/v1/streams/${s.id}`, headers: { cookie: mallory } })).statusCode).toBe(404);
  });
});
