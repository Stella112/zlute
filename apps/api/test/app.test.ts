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
import { redact } from '../src/log.js';

const NOW = 1_800_000_000;
const ORIGIN = 'https://lute.example';
const RECIPIENT = 'uregtest1secretrecipientaddress';
const PW = 'correct horse battery staple';

class FakeSidecar implements SidecarClient {
  inspection: RecipientInspection = { verdict: 'ALLOWED', kind: 'unified', has_orchard: true, has_sapling: true, has_transparent: false, payable_pools: ['ironwood', 'sapling'] };
  approveOk = true;
  calls: string[] = [];
  async inspect() {
    this.calls.push('inspect');
    return this.inspection;
  }
  async propose(_w: string, r: { amount_zat: bigint }): Promise<SidecarResult<ProposalView>> {
    this.calls.push('propose');
    const s: SidecarProposalSummary = {
      proposal_id: 'p1', account: 'a', network: 'regtest', recipient: RECIPIENT, recipient_pool: 'ironwood',
      amount_zat: Number(r.amount_zat), fee_zat: 10000, input_pools: ['ironwood'], output_pools: ['ironwood'],
      change_pools: ['ironwood'], policy: 'LUTE_STRICT/D-002', memo_hash: '', created_at: NOW, expires_at: NOW + 300,
    };
    const h = canonicalHash(s);
    return { ok: true, value: { proposal_hash: h, sign_message: `lute-approve-v1|regtest|${h}`, summary: s } };
  }
  async approve(): Promise<SidecarResult<true>> {
    this.calls.push('approve');
    return this.approveOk ? { ok: true, value: true } : { ok: false, code: 'APPROVAL_SIGNATURE_INVALID' };
  }
  async execute(): Promise<SidecarResult<ExecuteOutcome>> {
    this.calls.push('execute');
    return { ok: true, value: { proposal_hash: 'h', status: 'submitted', txid: 'abcd', broadcast: 'accepted' } };
  }
}

async function setup() {
  const pg = new PGlite();
  await pg.exec(schemaSql());
  const db = drizzle(pg);
  const store = new PgActionStore(db, FieldCipher.fromHex('11'.repeat(32)), () => NOW);
  const sidecar = new FakeSidecar();
  await createUser(db, 'maris', PW, 'owner', NOW);
  await createUser(db, 'mallory', PW, 'owner', NOW);
  await createUser(db, 'carol', PW, 'user', NOW);
  const app = await buildApp({ db, store, sidecar, network: 'regtest', now: () => NOW, secureCookies: true, appOrigin: ORIGIN });
  const loginAs = async (username: string) => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, password: PW }, headers: { origin: ORIGIN } });
    expect(r.statusCode).toBe(200);
    const c = String(r.headers['set-cookie']);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Strict');
    return c.split(';')[0]!;
  };
  return { app, pg, store, sidecar, loginAs };
}

const send = (cookie: string, idem = 'idem-0001', payload: object = { wallet: 'payout', to: RECIPIENT, amount_zec: '0.01', memo_ref: 'Ab3_x-9Zq1' }) => ({
  method: 'POST' as const,
  url: '/v1/actions/send',
  payload,
  headers: { cookie, origin: ORIGIN, 'idempotency-key': idem },
});

describe('API', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
  });

  it('rejects bad credentials with the same error for unknown users', async () => {
    const a = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'maris', password: 'wrong-password!!' } });
    const b = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'nobody', password: 'wrong-password!!' } });
    expect(a.statusCode).toBe(401);
    expect(b.json()).toEqual(a.json());
  });

  it('owner send → AWAITING_AUTHORIZATION → authorize → SUBMITTED, end to end through executeAction', async () => {
    const cookie = await t.loginAs('maris');
    const r1 = await t.app.inject(send(cookie));
    expect(r1.statusCode).toBe(200);
    const { action_id, result } = r1.json();
    expect(result.state).toBe('AWAITING_AUTHORIZATION');
    const r2 = await t.app.inject({ method: 'POST', url: `/v1/actions/${action_id}/authorize`, payload: { signature: 'a'.repeat(128) }, headers: { cookie, origin: ORIGIN } });
    expect(r2.json().result).toEqual({ state: 'SUBMITTED', txid: 'abcd', ambiguous: false });
    const view = (await t.app.inject({ method: 'GET', url: `/v1/actions/${action_id}`, headers: { cookie } })).json();
    expect(view.state).toBe('SUBMITTED');
    expect(t.sidecar.calls).toEqual(['inspect', 'propose', 'approve', 'execute']);
  });

  it('F3: the same Idempotency-Key never creates a second action or a second proposal', async () => {
    const cookie = await t.loginAs('maris');
    const a = (await t.app.inject(send(cookie))).json();
    const b = (await t.app.inject(send(cookie))).json();
    expect(b.action_id).toBe(a.action_id);
    expect(t.sidecar.calls.filter((c) => c === 'propose')).toHaveLength(1);
  });

  it('U3: responses never contain the recipient address or memo text', async () => {
    const cookie = await t.loginAs('maris');
    const r = await t.app.inject(send(cookie));
    const view = await t.app.inject({ method: 'GET', url: `/v1/actions/${r.json().action_id}`, headers: { cookie } });
    expect(view.body).not.toContain(RECIPIENT);
    expect(view.body).not.toContain('LUTE:');
  });

  it('stores the recipient and memo encrypted at rest', async () => {
    const cookie = await t.loginAs('maris');
    await t.app.inject(send(cookie));
    const rows = await t.pg.query<{ recipient_address_enc: string; memo_text_enc: string }>('SELECT recipient_address_enc, memo_text_enc FROM actions');
    expect(rows.rows[0]!.recipient_address_enc).toMatch(/^v1:/);
    expect(JSON.stringify(rows.rows)).not.toContain(RECIPIENT);
    expect(JSON.stringify(rows.rows)).not.toContain('Ab3_x-9Zq1');
  });

  it('U6: another user gets 404 for an action that is not theirs, and cannot authorize it', async () => {
    const maris = await t.loginAs('maris');
    const id = (await t.app.inject(send(maris))).json().action_id;
    const mallory = await t.loginAs('mallory');
    const view = await t.app.inject({ method: 'GET', url: `/v1/actions/${id}`, headers: { cookie: mallory } });
    expect(view.statusCode).toBe(404);
    const auth = await t.app.inject({ method: 'POST', url: `/v1/actions/${id}/authorize`, payload: { signature: 'a'.repeat(128) }, headers: { cookie: mallory, origin: ORIGIN } });
    expect(auth.statusCode).toBe(404);
    expect(t.sidecar.calls).not.toContain('approve');
  });

  it('U7: unauthenticated requests get nothing', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/v1/actions/x' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/v1/privacy/decisions' })).statusCode).toBe(401);
  });

  it('a non-owner role cannot send', async () => {
    const carol = await t.loginAs('carol');
    expect((await t.app.inject(send(carol))).statusCode).toBe(404);
  });

  it('rejects cross-origin state-changing requests (CSRF)', async () => {
    const cookie = await t.loginAs('maris');
    const r = await t.app.inject({ ...send(cookie), headers: { cookie, origin: 'https://evil.example', 'idempotency-key': 'idem-0001' } });
    expect(r.statusCode).toBe(403);
  });

  it('F2: rejects amounts with more than 8 decimals and requires an idempotency key', async () => {
    const cookie = await t.loginAs('maris');
    expect((await t.app.inject(send(cookie, 'idem-0002', { wallet: 'payout', to: RECIPIENT, amount_zec: '0.000000001' }))).json()).toEqual({ error: 'BAD_AMOUNT' });
    const r = await t.app.inject({ ...send(cookie), headers: { cookie, origin: ORIGIN } });
    expect(r.json()).toEqual({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('W1 through the API: a transparent recipient is rejected and recorded as a DENY decision', async () => {
    t.sidecar.inspection = { ...t.sidecar.inspection, verdict: 'DENIED_TRANSPARENT', payable_pools: [] };
    const cookie = await t.loginAs('maris');
    const r = (await t.app.inject(send(cookie))).json();
    expect(r.result.state).toBe('REJECTED');
    const d = (await t.app.inject({ method: 'GET', url: '/v1/privacy/decisions', headers: { cookie } })).json();
    expect(d.decisions[0].outcome).toBe('DENY');
    expect(JSON.stringify(d)).not.toContain(RECIPIENT);
    expect(t.sidecar.calls).toEqual(['inspect']);
  });

  it('a forged approval keeps the action awaiting and never executes', async () => {
    const cookie = await t.loginAs('maris');
    const id = (await t.app.inject(send(cookie))).json().action_id;
    t.sidecar.approveOk = false;
    const r = await t.app.inject({ method: 'POST', url: `/v1/actions/${id}/authorize`, payload: { signature: 'b'.repeat(128) }, headers: { cookie, origin: ORIGIN } });
    expect(r.json().result).toEqual({ state: 'REJECTED', reasons: ['APPROVAL_SIGNATURE_INVALID'] });
    expect(t.sidecar.calls).not.toContain('execute');
  });

  it('U4: internal errors are generic', async () => {
    t.sidecar.inspect = async () => {
      throw new Error(`boom with ${RECIPIENT}`);
    };
    const cookie = await t.loginAs('maris');
    const r = await t.app.inject(send(cookie));
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain(RECIPIENT);
  });
});

describe('U9 logger redaction', () => {
  it('drops sensitive keys at any depth and buckets amounts', () => {
    const out = redact({ action: { to: RECIPIENT, memo: 'LUTE:x', amount_zat: 1_000_000n, nested: [{ ufvk: 'uview1…', seed: 'x' }] }, state: 'SUBMITTED' });
    const s = JSON.stringify(out);
    expect(s).not.toContain(RECIPIENT);
    expect(s).not.toContain('LUTE:');
    expect(s).not.toContain('uview');
    expect(s).not.toContain('1000000');
    expect(s).toContain('amount_zat_bucket');
    expect(s).toContain('SUBMITTED');
  });
});
