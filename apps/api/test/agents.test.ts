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
  delayMs = 0;
  async inspect() {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
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
  /** Simulated wallet latency, so concurrent settlements overlap inside executeAction (R1). */
  delayMs = 0;
  async sync() {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
  }
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
  return { app, sidecar, req, cookie, pg };
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

  it('document extraction: fields out, charged per page, budget and batching shown, text never stored', async () => {
    const { g } = await grant();
    const s = (await asAgent(g.token, 'POST', '/v1/meter/sessions')).json();
    const INVOICE = ['ACME Design Ltd', 'Invoice #INV-2041', 'Date: 2026-10-14', 'Bill to: ops@example.org', 'Logo design .... $1,200.00', 'Hosting 3 months 0.4 ZEC', 'Total due: $1,350.00', 'Pay at https://pay.example.org/inv-2041'].join('\n');
    const r = await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/extract`, { text: INVOICE });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.result).toMatchObject({ title: 'ACME Design Ltd', invoice_number: 'INV-2041', dates: ['2026-10-14'], emails: ['ops@example.org'], urls: ['https://pay.example.org/inv-2041'], total: { value: '1350.00', currency: 'USD' } });
    expect(b.result.amounts).toContainEqual({ value: '0.4', currency: 'ZEC', label: 'Hosting 3 months' });
    expect(b.charge).toEqual({ pages: 1, price_per_page_zat: '1500', charged_zat: '1500' });
    expect(b.session).toMatchObject({ due_zat: '1500', credit_limit_zat: '30000' });
    expect(b.budget).toMatchObject({ remaining_zat: '25000', per_payment_cap_zat: '15000', due_is_payable: true });
    expect(b.settlement).toMatchObject({ batched: true, network_fee_zat: '10000' });
    // 5,001 characters = 3 pages.
    const big = (await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/extract`, { text: 'x'.repeat(5001) })).json();
    expect(big.charge).toMatchObject({ pages: 3, charged_zat: '4500' });
    // Past the credit limit: refused with the reason and what it would cost; nothing charged.
    const huge = await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/extract`, { text: 'y'.repeat(40000) });
    expect(huge.statusCode).toBe(402);
    expect(huge.json()).toMatchObject({ error: 'PAYMENT_REQUIRED', would_charge_zat: '30000', due_zat: '6000' });
    expect(huge.json().reason).toMatch(/credit limit/);
    expect((await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/extract`, { text: '' })).statusCode).toBe(400);
    // The document text is nowhere in the database.
    const dump = JSON.stringify((await t.pg.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows);
    for (const { table_name } of JSON.parse(dump) as { table_name: string }[]) {
      const rows = JSON.stringify((await t.pg.query(`SELECT * FROM "${table_name}"`)).rows);
      expect(rows).not.toContain('INV-2041');
      expect(rows).not.toContain('ops@example.org');
    }
  });

  it('one-time quotes: bound to price, service, session and the exact text; single use; expire', async () => {
    const { g } = await grant();
    const s = (await asAgent(g.token, 'POST', '/v1/meter/sessions')).json();
    const other = (await asAgent(g.token, 'POST', '/v1/meter/sessions')).json();
    const DOC = 'Invoice #Q-1 total $10';
    const q = (await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/quote`, { text: DOC })).json();
    expect(q).toMatchObject({ pages: 1, amount_zat: '1500', expires_at: T0 + 120 });
    expect(q.quote_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // A different document, another session, or an unknown quote: refused, nothing charged.
    expect((await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/extract`, { text: `${DOC}!`, quote_id: q.quote_id })).json().error).toBe('QUOTE_MISMATCH');
    expect((await asAgent(g.token, 'POST', `/v1/meter/sessions/${other.id}/extract`, { text: DOC, quote_id: q.quote_id })).json().error).toBe('UNKNOWN_QUOTE');
    // Two calls racing on one quote: exactly one is served and charged.
    const rs = await Promise.all([1, 2].map(() => asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/extract`, { text: DOC, quote_id: q.quote_id })));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const ok = rs.find((r) => r.statusCode === 200)!.json();
    expect(ok.charge).toMatchObject({ charged_zat: '1500', quote: 'honoured' });
    expect(rs.find((r) => r.statusCode === 409)!.json().error).toBe('QUOTE_ALREADY_USED');
    expect((await asAgent(g.token, 'GET', `/v1/meter/sessions/${s.id}`)).json().usage_zat).toBe('1500');
    // Expired.
    const q2 = (await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/quote`, { text: DOC })).json();
    clock = T0 + 121;
    expect((await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/extract`, { text: DOC, quote_id: q2.quote_id })).json().error).toBe('QUOTE_EXPIRED');
    clock = T0;
    // The quote stores a hash, never the text.
    const rows = JSON.stringify((await t.pg.query('SELECT * FROM meter_quotes')).rows);
    expect(rows).not.toContain('Invoice #Q-1');
  });

  // ---- R: payment restrictions (docs/PRIVACY-EVIDENCE.md E-015) ----

  const executes = () => t.sidecar.calls.filter((c) => c.startsWith('execute')).length;

  it('R1: simultaneous settlements of one session pay the usage once', async () => {
    const { g } = await grant();
    const s = (await asAgent(g.token, 'POST', '/v1/meter/sessions')).json();
    for (let i = 0; i < 4; i++) await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/call`);
    t.req.delayMs = t.sidecar.delayMs = 30;
    const rs = await Promise.all(['race-aaaa1', 'race-bbbb2', 'race-cccc3'].map((k) => asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/settle`, {}, { 'idempotency-key': k })));
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.statusCode === 409).map((r) => r.json().error)).toEqual(['NOTHING_DUE', 'NOTHING_DUE']);
    expect(executes()).toBe(1);
    expect((await asAgent(g.token, 'GET', '/v1/agent/me')).json()).toMatchObject({ spent_zat: '6000' });
  });

  it('R1: simultaneous settlements of two sessions cannot together exceed the budget', async () => {
    const { g } = await grant(); // 15,000 per payment, 25,000 total
    const a = (await asAgent(g.token, 'POST', '/v1/meter/sessions')).json();
    const b = (await asAgent(g.token, 'POST', '/v1/meter/sessions')).json();
    for (let i = 0; i < 10; i++) {
      await asAgent(g.token, 'POST', `/v1/meter/sessions/${a.id}/call`);
      await asAgent(g.token, 'POST', `/v1/meter/sessions/${b.id}/call`);
    }
    t.req.delayMs = t.sidecar.delayMs = 30;
    const [ra, rb] = await Promise.all([a, b].map((x, i) => asAgent(g.token, 'POST', `/v1/meter/sessions/${x.id}/settle`, {}, { 'idempotency-key': `two-sess-${i}` })));
    const states = [ra!.json().result.state, rb!.json().result.state].sort();
    expect(states).toEqual(['REJECTED', 'SUBMITTED']);
    expect([ra!.json(), rb!.json()].find((r) => r.result.state === 'REJECTED').result.reasons).toContain('OVER_GRANT_TOTAL');
    expect(executes()).toBe(1);
    expect((await asAgent(g.token, 'GET', '/v1/agent/me')).json()).toMatchObject({ spent_zat: '15000', remaining_zat: '10000' });
  });

  it('R2: a retried settlement cannot charge twice, with the same or a new idempotency key', async () => {
    const { g } = await grant();
    const s = (await asAgent(g.token, 'POST', '/v1/meter/sessions')).json();
    for (let i = 0; i < 4; i++) await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/call`);
    const first = (await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/settle`, {}, { 'idempotency-key': 'retry-0001' })).json();
    const same = (await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/settle`, {}, { 'idempotency-key': 'retry-0001' })).json();
    const fresh = await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/settle`, {}, { 'idempotency-key': 'retry-0002' });
    expect(same.action_id).toBe(first.action_id);
    expect(fresh.statusCode).toBe(409);
    expect(fresh.json()).toEqual({ error: 'NOTHING_DUE' });
    expect(executes()).toBe(1);
  });

  it('R3: a changed recipient is rejected (agent-supplied address ignored; mandate for another address refused)', async () => {
    const { svc, draft, g } = await grant();
    const s = (await asAgent(g.token, 'POST', '/v1/meter/sessions')).json();
    for (let i = 0; i < 2; i++) await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/call`);
    await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/settle`, { to: 'uregtest1attacker', recipient: 'uregtest1attacker' }, { 'idempotency-key': 'recip-0001' });
    expect(t.sidecar.proposedTo).toEqual([SERVICE_ADDR]);
    const swapped = await owner('POST', '/v1/agent/grants', { agent_name: 'x', service_id: svc.id, mandate: { ...draft.mandate, mandate_id: 'e'.repeat(32), allowed_recipients: ['uregtest1attacker'] }, signature: 'a'.repeat(128) });
    expect(swapped.json()).toEqual({ error: 'MANDATE_DOES_NOT_MATCH_SERVICE' });
  });

  it('R4: an expired or a revoked grant pays nothing', async () => {
    const { g } = await grant();
    const s = (await asAgent(g.token, 'POST', '/v1/meter/sessions')).json();
    for (let i = 0; i < 2; i++) await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/call`);
    clock = T0 + 25 * 3600; // the grant (24 h) has expired
    const r = await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/settle`, {}, { 'idempotency-key': 'expired-01' });
    expect(r.statusCode === 401 || r.json().result.reasons.includes('GRANT_EXPIRED')).toBe(true);
    clock = T0;
    const { g: g2 } = await grant();
    const s2 = (await asAgent(g2.token, 'POST', '/v1/meter/sessions')).json();
    for (let i = 0; i < 2; i++) await asAgent(g2.token, 'POST', `/v1/meter/sessions/${s2.id}/call`);
    await owner('POST', `/v1/agent/grants/${g2.grant_id}/revoke`);
    const r2 = await asAgent(g2.token, 'POST', `/v1/meter/sessions/${s2.id}/settle`, {}, { 'idempotency-key': 'revoked-01' });
    expect(r2.statusCode === 401 || r2.json().result.reasons.includes('GRANT_REVOKED')).toBe(true);
    expect(executes()).toBe(0);
  });

  it('R5: an owner payout without an approval never executes', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/v1/actions/send', headers: { cookie: t.cookie, 'idempotency-key': 'noapproval-01' }, payload: { wallet: 'payout', to: SERVICE_ADDR, amount_zec: '0.0001' } });
    expect(r.json().result.state).toBe('AWAITING_AUTHORIZATION');
    const bad = await t.app.inject({ method: 'POST', url: `/v1/actions/${r.json().action_id}/authorize`, headers: { cookie: t.cookie }, payload: {} });
    expect(bad.statusCode).toBe(400);
    expect(t.sidecar.calls).not.toContain('approve');
    expect(t.sidecar.calls).not.toContain('execute');
  });

  it('R6: a transparent destination is rejected before any proposal', async () => {
    const { g } = await grant();
    const s = (await asAgent(g.token, 'POST', '/v1/meter/sessions')).json();
    for (let i = 0; i < 2; i++) await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/call`);
    t.sidecar.inspection = { ...t.sidecar.inspection, verdict: 'DENIED_TRANSPARENT', has_transparent: true, payable_pools: [] };
    const r = (await asAgent(g.token, 'POST', `/v1/meter/sessions/${s.id}/settle`, {}, { 'idempotency-key': 'transp-001' })).json();
    expect(r.result.state).toBe('REJECTED');
    expect(t.sidecar.proposedTo).toEqual([]);
    expect(executes()).toBe(0);
  });
});
