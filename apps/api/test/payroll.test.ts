import { createHash, createPublicKey, verify } from 'node:crypto';
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
const PW = 'correct horse battery staple';
const ADDR = (n: number) => `uregtest1payee${String(n).padStart(3, '0')}`;
let clock = T0;

type Line = { to: string; amount_zat: bigint; memo?: string };

class FakeSidecar implements SidecarClient {
  transparent = new Set<string>();
  proposed: Line[][] = [];
  calls: string[] = [];
  stored = new Map<string, ProposalView>();
  async inspect(a: string): Promise<RecipientInspection> {
    return this.transparent.has(a)
      ? { verdict: 'DENIED_TRANSPARENT', kind: 'transparent', has_orchard: false, has_sapling: false, has_transparent: true, payable_pools: [] }
      : { verdict: 'ALLOWED', kind: 'unified', has_orchard: true, has_sapling: true, has_transparent: false, payable_pools: ['ironwood'] };
  }
  async propose(_w: string, r: Parameters<SidecarClient['propose']>[1]): Promise<SidecarResult<ProposalView>> {
    const lines: Line[] = 'payments' in r ? r.payments : [r];
    this.proposed.push(lines);
    const total = lines.reduce((a, l) => a + Number(l.amount_zat), 0);
    const s: SidecarProposalSummary = {
      proposal_id: `p${this.proposed.length}`,
      account: 'a',
      network: 'regtest',
      recipient: lines.length > 1 ? 'batch' : lines[0]!.to,
      recipient_pool: 'ironwood',
      amount_zat: total,
      fee_zat: 5000 * Math.max(2, lines.length + 1),
      input_pools: ['ironwood'],
      output_pools: ['ironwood'],
      change_pools: ['ironwood'],
      policy: 'LUTE_STRICT/D-002',
      memo_hash: '',
      created_at: clock,
      expires_at: clock + 300,
      ...(lines.length > 1 ? { payments: lines.map((l) => ({ recipient: l.to, recipient_pool: 'ironwood', amount_zat: Number(l.amount_zat), memo_hash: 'h' })) } : {}),
    };
    const h = canonicalHash(s);
    const v = { proposal_hash: h, sign_message: `lute-approve-v1|regtest|${h}`, summary: s };
    this.stored.set(s.proposal_id, v);
    return { ok: true, value: v };
  }
  async approve(): Promise<SidecarResult<true>> {
    this.calls.push('approve');
    return { ok: true, value: true };
  }
  async execute(): Promise<SidecarResult<ExecuteOutcome>> {
    this.calls.push('execute');
    return { ok: true, value: { proposal_hash: 'h', status: 'submitted', txid: 'ab'.repeat(32), broadcast: 'accepted' } };
  }
  async executeMandate(): Promise<SidecarResult<ExecuteOutcome>> {
    return { ok: false, code: 'NO_MANDATE' };
  }
  async showProposal(_w: string, id: string): Promise<SidecarResult<ProposalView>> {
    const v = this.stored.get(id);
    return v ? { ok: true, value: v } : { ok: false, code: 'UNKNOWN_PROPOSAL' };
  }
}

class FakeReq implements RequestSidecar {
  async balance() {
    return { chain_tip_height: 1, fully_scanned_height: 1, ironwood: { spendable_zat: 0, total_zat: 0 }, orchard: { spendable_zat: 0, total_zat: 0 }, sapling: { spendable_zat: 0, total_zat: 0 }, transparent_total_zat: 0 };
  }
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
    return { txid, known: true, mined_height: 10, confirmations: 3, expired_unmined: false };
  }
}

async function setup() {
  clock = T0;
  const pg = new PGlite();
  await pg.exec(schemaSql());
  const db = drizzle(pg);
  const store = new PgActionStore(db, FieldCipher.fromHex('55'.repeat(32)), () => clock);
  const sidecar = new FakeSidecar();
  for (const n of ['boss', 'olga', 'adam']) await createUser(db, n, PW, 'owner', T0);
  const app = await buildApp({ db, store, sidecar, requestSidecar: new FakeReq(), proposals: sidecar, cipher: FieldCipher.fromHex('55'.repeat(32)), network: 'regtest', now: () => clock, secureCookies: false, appOrigin: 'https://x', minPayoutZat: 1n });
  const login = async (u: string) => String((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: u, password: PW } })).headers['set-cookie']).split(';')[0]!;
  return { app, pg, store, sidecar, boss: await login('boss'), olga: await login('olga'), adam: await login('adam') };
}

describe('payroll: BatchPay, payslips, templates, streams, roles', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  const as = (cookie: string, method: 'GET' | 'POST', url: string, payload?: object, idem?: string) =>
    t.app.inject({ method, url, payload, headers: { cookie, ...(idem ? { 'idempotency-key': idem } : {}) } });
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Person ${i + 1}`, to: ADDR(i), amount_zec: `0.000${i + 1}` }));

  beforeEach(async () => {
    t = await setup();
  });

  it('(6) BatchPay: one transaction, every line in the approved summary, each person with their own memo; nothing readable at rest', async () => {
    const r = (await as(t.boss, 'POST', '/v1/payroll/runs', { name: 'October', items: items(3) }, 'run-oct-0001')).json();
    expect(r.result.state).toBe('AWAITING_AUTHORIZATION');
    expect(t.sidecar.proposed).toHaveLength(1);
    const lines = t.sidecar.proposed[0]!;
    expect(lines.map((l) => [l.to, l.amount_zat])).toEqual([
      [ADDR(0), 10000n],
      [ADDR(1), 20000n],
      [ADDR(2), 30000n],
    ]);
    expect(new Set(lines.map((l) => l.memo)).size).toBe(3);
    expect(r.result.summary).toMatchObject({ recipient: 'batch', amount_zat: 60000 });
    expect(r.result.summary.payments).toHaveLength(3);
    // Same idempotency key: same run, no second proposal.
    expect((await as(t.boss, 'POST', '/v1/payroll/runs', { name: 'October', items: items(3) }, 'run-oct-0001')).json().run_id).toBe(r.run_id);
    expect(t.sidecar.proposed).toHaveLength(1);
    const dump = JSON.stringify((await t.pg.query('SELECT * FROM actions')).rows) + JSON.stringify((await t.pg.query('SELECT * FROM payroll_items')).rows);
    expect(dump).not.toContain(ADDR(1));
    expect(dump).not.toContain('Person 2');
    const a = (await as(t.boss, 'POST', `/v1/actions/${r.action_id}/authorize`, { signature: 'a'.repeat(128) })).json();
    expect(a.result.state).toBe('SUBMITTED');
  });

  it('(8) payslips: each shows only its own line; signed once the batch is confirmed', async () => {
    const r = (await as(t.boss, 'POST', '/v1/payroll/runs', { name: 'October', items: items(2) }, 'run-oct-0002')).json();
    const runs = (await as(t.boss, 'GET', '/v1/payroll/runs')).json().runs;
    const slips = runs[0].items.map((x: { payslip: string }) => x.payslip.split('/').pop());
    const p0 = (await t.app.inject({ method: 'GET', url: `/v1/public/payslips/${slips[0]}` })).json();
    expect(p0.payslip).toMatchObject({ label: 'Person 1', amount_zat: '10000', status: 'AWAITING_APPROVAL' });
    expect(JSON.stringify(p0)).not.toContain('Person 2');
    await as(t.boss, 'POST', `/v1/actions/${r.action_id}/authorize`, { signature: 'a'.repeat(128) });
    expect((await t.app.inject({ method: 'GET', url: `/v1/public/payslips/${slips[1]}` })).json().payslip.status).toBe('CONFIRMING');
    await t.store.transition(r.action_id, 'SUBMITTED', 'PENDING_CONFIRMATION', 'system');
    await t.store.transition(r.action_id, 'PENDING_CONFIRMATION', 'CONFIRMED', 'system');
    const paid = (await t.app.inject({ method: 'GET', url: `/v1/public/payslips/${slips[1]}` })).json();
    expect(paid.payslip).toMatchObject({ label: 'Person 2', amount_zat: '20000', status: 'PAID', txid: 'ab'.repeat(32) });
    const canonical = (v: Record<string, unknown>) => `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(v[k])}`).join(',')}}`;
    const msg = Buffer.from(`lute-payslip-v1|${createHash('sha256').update(canonical(paid.payslip)).digest('hex')}`);
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(paid.public_key, 'hex')]), format: 'der', type: 'spki' });
    expect(verify(null, msg, key, Buffer.from(paid.signature, 'hex'))).toBe(true);
    expect((await t.app.inject({ method: 'GET', url: '/v1/public/payslips/AAAAAAAAAAAAAAAAAAAAAA' })).statusCode).toBe(404);
  });

  it('LuteGuard checks every line: a transparent recipient anywhere in the batch rejects the whole run; at most 10 lines', async () => {
    t.sidecar.transparent.add(ADDR(1));
    const r = (await as(t.boss, 'POST', '/v1/payroll/runs', { name: 'Bad', items: items(3) }, 'run-bad-0001')).json();
    expect(r.result.state).toBe('REJECTED');
    expect(r.result.reasons.join(',')).toContain('RECIPIENT_DENIED_TRANSPARENT');
    expect(t.sidecar.proposed).toHaveLength(0);
    expect((await as(t.boss, 'POST', '/v1/payroll/runs', { name: 'Big', items: items(11).map((x) => ({ ...x, amount_zec: '0.0001' })) }, 'run-big-0001')).statusCode).toBe(400);
  });

  it('(9) templates: each run is a fresh proposal needing a fresh approval', async () => {
    const tpl = (await as(t.boss, 'POST', '/v1/payroll/templates', { name: 'Monthly', items: items(2) })).json();
    expect(tpl).toMatchObject({ lines: 2, total_zat: '30000' });
    const a = (await as(t.boss, 'POST', `/v1/payroll/templates/${tpl.id}/run`, {}, 'tpl-run-0001')).json();
    const b = (await as(t.boss, 'POST', `/v1/payroll/templates/${tpl.id}/run`, {}, 'tpl-run-0002')).json();
    expect(a.action_id).not.toBe(b.action_id);
    expect([a.result.state, b.result.state]).toEqual(['AWAITING_AUTHORIZATION', 'AWAITING_AUTHORIZATION']);
    expect(t.sidecar.proposed).toHaveLength(2);
    const list = (await as(t.boss, 'GET', '/v1/payroll/templates')).json().templates;
    expect(JSON.stringify(list)).not.toContain(ADDR(0)); // addresses are not listed back
  });

  it('(10) roles: an operator runs saved templates only; an admin prepares; only the owner approves', async () => {
    expect((await as(t.boss, 'POST', '/v1/payroll/members', { username: 'olga', role: 'operator' })).json()).toEqual({ username: 'olga', role: 'operator' });
    await as(t.boss, 'POST', '/v1/payroll/members', { username: 'adam', role: 'admin' });
    const tpl = (await as(t.boss, 'POST', '/v1/payroll/templates', { name: 'Monthly', items: items(2) })).json();
    // Operator: no new lines, no template edits; can run a template prepared by the owner.
    expect((await as(t.olga, 'POST', '/v1/payroll/runs', { owner: 'boss', name: 'x', items: items(1) }, 'olga-run-001')).json().error).toBe('OPERATORS_RUN_TEMPLATES_ONLY');
    expect((await as(t.olga, 'POST', '/v1/payroll/templates', { owner: 'boss', name: 'x', items: items(1) })).json().error).toBe('OPERATORS_CANNOT_EDIT_TEMPLATES');
    const run = (await as(t.olga, 'POST', `/v1/payroll/templates/${tpl.id}/run`, { owner: 'boss' }, 'olga-tpl-001')).json();
    expect(run.result.state).toBe('AWAITING_AUTHORIZATION');
    // The operator cannot approve: the action is the owner's.
    expect((await as(t.olga, 'POST', `/v1/actions/${run.action_id}/authorize`, { signature: 'a'.repeat(128) })).statusCode).toBe(404);
    expect(t.sidecar.calls).not.toContain('approve');
    // Admin prepares a manual run for the owner.
    expect((await as(t.adam, 'POST', '/v1/payroll/runs', { owner: 'boss', name: 'Bonus', items: items(1) }, 'adam-run-001')).json().result.state).toBe('AWAITING_AUTHORIZATION');
    // Strangers get nothing.
    expect((await as(t.adam, 'GET', '/v1/payroll/runs?owner=olga')).statusCode).toBe(401);
    // The owner fetches the exact batch to approve, then approves it.
    const ap = (await as(t.boss, 'GET', `/v1/payroll/runs/${run.run_id}/approval`)).json();
    expect(ap.result.summary.payments).toHaveLength(2);
    expect((await as(t.boss, 'POST', `/v1/actions/${run.action_id}/authorize`, { signature: 'a'.repeat(128) })).json().result.state).toBe('SUBMITTED');
    expect((await as(t.boss, 'GET', '/v1/payroll/members')).json().members).toHaveLength(2);
  });

  it('(7) streams to payroll: what each stream owes, in one batch; each stream records its share', async () => {
    const mk = async (n: number) => (await as(t.boss, 'POST', '/v1/streams', { to: ADDR(n), total_zec: '0.006', duration_s: 600 })).json();
    const s1 = await mk(1);
    const s2 = await mk(2);
    clock = T0 + 300; // half way: 0.003 each
    const r = (await as(t.boss, 'POST', '/v1/payroll/from-streams', { stream_ids: [s1.id, s2.id] }, 'streams-0001')).json();
    expect(r.result.state).toBe('AWAITING_AUTHORIZATION');
    expect(t.sidecar.proposed[0]!.map((l) => [l.to, l.amount_zat])).toEqual([
      [ADDR(1), 300000n],
      [ADDR(2), 300000n],
    ]);
    const v1 = (await as(t.boss, 'GET', `/v1/streams/${s1.id}`)).json();
    expect(v1).toMatchObject({ pending_zat: '300000', outstanding_zat: '0' });
    // Nothing more is due right away: a second run finds nothing.
    expect((await as(t.boss, 'POST', '/v1/payroll/from-streams', { stream_ids: [s1.id, s2.id] }, 'streams-0002')).json().error).toBe('NOTHING_DUE');
  });
});
