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
import type { MandateSidecar, MandateStatus, RequestCheck, RequestSidecar, TxStatus } from '../src/sidecar.js';

const T0 = 1_800_000_000;
const SERVICE_ADDR = 'uregtest1meterservice';
const PW = 'correct horse battery staple';
let clock = T0;

class FakeSidecar implements SidecarClient {
  inspection: RecipientInspection = { verdict: 'ALLOWED', kind: 'unified', has_orchard: true, has_sapling: true, has_transparent: false, payable_pools: ['ironwood'] };
  proposedTo: string[] = [];
  calls: string[] = [];
  mandateResult: SidecarResult<ExecuteOutcome> | null = null;
  async inspect() {
    return this.inspection;
  }
  async propose(_w: string, r: { to: string; amount_zat: bigint }): Promise<SidecarResult<ProposalView>> {
    this.proposedTo.push(r.to);
    const s: SidecarProposalSummary = {
      proposal_id: `p${this.proposedTo.length}`,
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
      created_at: clock,
      expires_at: clock + 300,
    };
    const h = canonicalHash(s);
    return { ok: true, value: { proposal_hash: h, sign_message: `lute-approve-v1|regtest|${h}`, summary: s } };
  }
  async approve(): Promise<SidecarResult<true>> {
    this.calls.push('approve');
    return { ok: true, value: true };
  }
  async execute(): Promise<SidecarResult<ExecuteOutcome>> {
    this.calls.push('execute');
    return { ok: true, value: { proposal_hash: 'h', status: 'submitted', txid: 'tx', broadcast: 'accepted' } };
  }
  async executeMandate(_w: string, _p: string, m: string): Promise<SidecarResult<ExecuteOutcome>> {
    this.calls.push(`executeMandate:${m}`);
    return this.mandateResult ?? { ok: true, value: { proposal_hash: 'h', status: 'submitted', txid: `${'cd'.repeat(31)}${String(this.calls.length).padStart(2, '0')}`, broadcast: 'accepted' } };
  }
}

class FakeReq implements RequestSidecar, MandateSidecar {
  loaded: { json: string; sig: string }[] = [];
  refuse: string | null = null;
  async balance() {
    return { chain_tip_height: 3_530_600, fully_scanned_height: 3_530_600, ironwood: { spendable_zat: 0, total_zat: 0 }, orchard: { spendable_zat: 0, total_zat: 0 }, sapling: { spendable_zat: 0, total_zat: 0 }, transparent_total_zat: 0 };
  }
  async newAddress() {
    return SERVICE_ADDR;
  }
  async buildZip321() {
    return 'zcash:x';
  }
  async sync() {}
  async checkRequest(): Promise<RequestCheck> {
    throw new Error('unused');
  }
  async txStatus(_w: string, txid: string): Promise<TxStatus> {
    return { txid, known: true, mined_height: 10, confirmations: 1, expired_unmined: false };
  }
  async loadMandate(_w: string, json: string, sig: string): Promise<SidecarResult<MandateStatus>> {
    if (this.refuse) return { ok: false, code: this.refuse };
    this.loaded.push({ json, sig });
    const m = JSON.parse(json);
    return { ok: true, value: { mandate_id: m.mandate_id, mandate_hash: 'mh', max_tx_zat: m.max_tx_zat, total_zat: m.total_zat, committed_zat: 0, remaining_zat: m.total_zat, expires_at: m.expires_at, allowed_recipients: 1 } };
  }
  async mandateStatus(): Promise<SidecarResult<MandateStatus>> {
    return { ok: false, code: 'UNKNOWN_MANDATE' };
  }
}

async function setup() {
  clock = T0;
  const pg = new PGlite();
  await pg.exec(schemaSql());
  const db = drizzle(pg);
  const cipher = FieldCipher.fromHex('33'.repeat(32));
  const store = new PgActionStore(db, cipher, () => clock);
  const sidecar = new FakeSidecar();
  const req = new FakeReq();
  await createUser(db, 'maris', PW, 'owner', T0);
  const app = await buildApp({ db, store, sidecar, requestSidecar: req, mandates: req, cipher, network: 'regtest', now: () => clock, secureCookies: false, appOrigin: 'https://x' });
  const cookie = String((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'maris', password: PW } })).headers['set-cookie']).split(';')[0]!;
  return { app, sidecar, req, cookie };
}

describe('agents and metered billing (A group, §19.6/§19.8)', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  const owner = (method: 'GET' | 'POST', url: string, payload?: object) => t.app.inject({ method, url, payload, headers: { cookie: t.cookie } });
  const asAgent = (token: string, method: 'GET' | 'POST', url: string, payload?: object, extra: Record<string, string> = {}) =>
    t.app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}`, 'x-lute-caller': 'mcp', ...extra } });

  async function grant(over: { max_tx_zec?: string; total_zec?: string } = {}) {
    const svc = (await owner('POST', '/v1/meter/services', { name: 'Chain tip API', price_per_call_zat: 1500, credit_limit_zat: 30000 })).json();
    const draft = (await owner('POST', '/v1/agent/mandates/draft', { service_id: svc.id, max_tx_zec: over.max_tx_zec ?? '0.00015', total_zec: over.total_zec ?? '0.00025', ttl_hours: 24 })).json();
    const g = (await owner('POST', '/v1/agent/grants', { agent_name: 'demo agent', service_id: svc.id, mandate: draft.mandate, signature: 'a'.repeat(128) })).json();
    return { svc, draft, g };
  }

  beforeEach(async () => {
    t = await setup();
  });

  it('the mandate draft is bound to the service address and the agent wallet; the token is shown once', async () => {
    const { draft, g } = await grant();
    expect(draft.mandate).toMatchObject({ wallet: 'agent', purpose: 'agent', network: 'regtest', allowed_recipients: [SERVICE_ADDR], max_tx_zat: 15000, total_zat: 25000 });
    expect(g.token).toMatch(/^lute_agent_/);
    expect(t.req.loaded).toHaveLength(1);
    const list = (await owner('GET', '/v1/agent/grants')).json();
    expect(JSON.stringify(list)).not.toContain(g.token);
    expect(JSON.stringify(list)).not.toContain(SERVICE_ADDR);
  });

  it('a mandate for another recipient, or one the sidecar refuses, creates no grant', async () => {
    const { svc, draft } = await grant();
    const wrong = { ...draft.mandate, allowed_recipients: ['uregtest1attacker'] };
    expect((await owner('POST', '/v1/agent/grants', { agent_name: 'x', service_id: svc.id, mandate: wrong, signature: 'a'.repeat(128) })).json()).toEqual({ error: 'MANDATE_DOES_NOT_MATCH_SERVICE' });
    t.req.refuse = 'MANDATE_SIGNATURE_INVALID';
    const r = await owner('POST', '/v1/agent/grants', { agent_name: 'x', service_id: svc.id, mandate: { ...draft.mandate, mandate_id: 'f'.repeat(32) }, signature: 'b'.repeat(128) });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ error: 'MANDATE_SIGNATURE_INVALID' });
  });

  it('agent tokens and owner sessions are separate (no cross use)', async () => {
    const { g } = await grant();
    expect((await t.app.inject({ method: 'GET', url: '/v1/agent/me', headers: { cookie: t.cookie } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/v1/agent/grants', headers: { authorization: `Bearer ${g.token}` } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/v1/actions', headers: { authorization: `Bearer ${g.token}` } })).statusCode).toBe(401);
    expect((await asAgent('lute_agent_wrong', 'GET', '/v1/agent/me')).statusCode).toBe(401);
  });

  it('A10: inside its grant the agent pays the metered API under the mandate (no owner signature); A3: then it is denied', async () => {
    const { g } = await grant();
    const s = (await asAgent(g.token, 'POST', '/v1/meter/sessions')).json();
    for (let i = 0; i < 10; i++) expect((await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/call`)).json().result.chain_tip_height).toBe(3_530_600);
    // A8: the agent cannot steer the recipient; whatever it sends, the service address is paid.
    const r1 = (await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/settle`, { to: 'uregtest1attacker' }, { 'idempotency-key': 'settle-0001' })).json();
    expect(r1.result).toMatchObject({ state: 'SUBMITTED', ambiguous: false });
    expect(t.sidecar.proposedTo).toEqual([SERVICE_ADDR]);
    expect(t.sidecar.calls).toEqual([`executeMandate:${(await asAgent(g.token, 'GET', '/v1/agent/me')).json().mandate.id}`]);
    expect((await asAgent(g.token, 'GET', '/v1/agent/me')).json()).toMatchObject({ spent_zat: '15000', remaining_zat: '10000' });
    // 10 more calls = 15,000 more: over the 25,000 total -> LuteGuard DENY before the sidecar.
    for (let i = 0; i < 10; i++) await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/call`);
    const r2 = (await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/settle`, {}, { 'idempotency-key': 'settle-0002' })).json();
    expect(r2.result.state).toBe('REJECTED');
    expect(r2.result.reasons).toContain('OVER_GRANT_TOTAL');
    expect(t.sidecar.calls.filter((c) => c.startsWith('execute'))).toHaveLength(1);
    expect(t.sidecar.calls).not.toContain('approve');
  });

  it('the metered API answers 402 once the unpaid usage reaches the credit limit', async () => {
    const { g } = await grant();
    const s = (await asAgent(g.token, 'POST', '/v1/meter/sessions')).json();
    for (let i = 0; i < 20; i++) await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/call`);
    const r = await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/call`);
    expect(r.statusCode).toBe(402);
    expect(r.json()).toMatchObject({ error: 'PAYMENT_REQUIRED', due_zat: '30000' });
  });

  it('A2: a single payment over the per-tx cap is denied; A4: a revoked grant pays nothing', async () => {
    const { g } = await grant();
    const s = (await asAgent(g.token, 'POST', '/v1/meter/sessions')).json();
    for (let i = 0; i < 11; i++) await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/call`); // 16,500 > 15,000
    const r = (await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/settle`, {}, { 'idempotency-key': 'settle-big1' })).json();
    expect(r.result.reasons).toContain('OVER_GRANT_PER_TX');
    await owner('POST', `/v1/agent/grants/${g.grant_id}/revoke`);
    const r2 = (await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/settle`, {}, { 'idempotency-key': 'settle-rev1' })).json();
    expect(r2.result.reasons).toContain('GRANT_REVOKED');
    expect(t.sidecar.calls.some((c) => c.startsWith('execute'))).toBe(false);
  });

  it('a settlement confirms on refresh, and a repeated idempotency key never pays twice', async () => {
    const { g } = await grant();
    const s = (await asAgent(g.token, 'POST', '/v1/meter/sessions')).json();
    for (let i = 0; i < 4; i++) await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/call`);
    const a = (await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/settle`, {}, { 'idempotency-key': 'settle-same' })).json();
    const b = (await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/settle`, {}, { 'idempotency-key': 'settle-same' })).json();
    expect(b.action_id).toBe(a.action_id);
    expect(t.sidecar.calls.filter((c) => c.startsWith('executeMandate'))).toHaveLength(1);
    const v = (await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/refresh`)).json();
    expect(v).toMatchObject({ usage_zat: '6000', paid_zat: '6000', due_zat: '0' });
    expect(v.settlements[0].state).toBe('CONFIRMED');
  });
});
