import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import type { RequestCheck, RequestSidecar } from '../src/sidecar.js';

const NOW = 1_800_000_000;
const ORIGIN = 'https://lute.example';
const RECIPIENT = 'uregtest1secretrecipientaddress';
const RESULTS_FILE = join(mkdtempSync(join(tmpdir(), 'lute-results-')), 'results.json');
const PW = 'correct horse battery staple';

class FakeSidecar implements SidecarClient {
  inspection: RecipientInspection = { verdict: 'ALLOWED', kind: 'unified', has_orchard: true, has_sapling: true, has_transparent: false, payable_pools: ['ironwood', 'sapling'] };
  approveOk = true;
  calls: string[] = [];
  async inspect() {
    this.calls.push('inspect');
    return this.inspection;
  }
  proposeWallets: string[] = [];
  async propose(w: string, r: { amount_zat: bigint }): Promise<SidecarResult<ProposalView>> {
    this.calls.push('propose');
    this.proposeWallets.push(w);
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
  async executeMandate(): Promise<SidecarResult<ExecuteOutcome>> {
    return { ok: false, code: 'NO_MANDATE' };
  }
  async execute(): Promise<SidecarResult<ExecuteOutcome>> {
    this.calls.push('execute');
    return { ok: true, value: { proposal_hash: 'h', status: 'submitted', txid: 'abcd', broadcast: 'accepted' } };
  }
}

class FakeRequestSidecar implements RequestSidecar {
  async balance() {
    return { chain_tip_height: 10, fully_scanned_height: 10, ironwood: { spendable_zat: 60000, total_zat: 60000 }, orchard: { spendable_zat: 0, total_zat: 0 }, sapling: { spendable_zat: 0, total_zat: 0 }, transparent_total_zat: 0 };
  }
  check: RequestCheck = { status: 'UNPAID', matched_by: null, requested_zat: 0, received_confirmed_zat: 0, received_pending_zat: 0, overpaid_zat: 0, txids: [] };
  async newAddress() {
    return 'uregtest1freshrequestaddress';
  }
  async buildZip321(address: string, amount: bigint, ref: string) {
    return `zcash:${address}?amount=${amount}&memo=LUTE:${ref}`;
  }
  async sync() {}
  async checkRequest() {
    return this.check;
  }
  async txStatus(_w: string, txid: string) {
    return { txid, known: true, mined_height: null, confirmations: 0, expired_unmined: false };
  }
}

async function setup(opts: { signup?: boolean; maxUsers?: number } = {}) {
  const pg = new PGlite();
  await pg.exec(schemaSql());
  const db = drizzle(pg);
  const store = new PgActionStore(db, FieldCipher.fromHex('11'.repeat(32)), () => NOW);
  const sidecar = new FakeSidecar();
  await createUser(db, 'maris', PW, 'owner', NOW);
  await createUser(db, 'mallory', PW, 'owner', NOW);
  await createUser(db, 'carol', PW, 'user', NOW);
  const reqSidecar = new FakeRequestSidecar();
  const created: { name: string; ownerPub: string }[] = [];
  const walletAdmin = {
    createWallet: async (name: string, ownerPub: string) => {
      created.push({ name, ownerPub });
      return { ok: true as const, value: { name } };
    },
  };
  const app = await buildApp({ db, store, sidecar, requestSidecar: reqSidecar, cipher: FieldCipher.fromHex('11'.repeat(32)), network: 'regtest', now: () => NOW, secureCookies: true, appOrigin: `${ORIGIN}, http://127.0.0.1:48300`, resultsFile: RESULTS_FILE, ...(opts.signup ? { walletAdmin, maxUsers: opts.maxUsers ?? 500 } : {}) });
  const loginAs = async (username: string) => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, password: PW }, headers: { origin: ORIGIN } });
    expect(r.statusCode).toBe(200);
    const c = String(r.headers['set-cookie']);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Strict');
    return c.split(';')[0]!;
  };
  return { app, pg, store, sidecar, reqSidecar, loginAs, created };
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
    expect(t.sidecar.calls).toEqual(['inspect', 'inspect', 'propose', 'approve', 'execute']);
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
    expect(t.sidecar.calls).toEqual(['inspect', 'inspect']);
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
    // Before authorization, a sidecar error fails the action cleanly (code only, no details).
    const r = await t.app.inject(send(cookie));
    expect(r.json().result).toEqual({ state: 'FAILED', reason: 'SIDECAR_UNAVAILABLE' });
    expect(r.body).not.toContain(RECIPIENT);
    // Anywhere else an unexpected error is a generic 500.
    t.sidecar.inspect = async () => ({ verdict: 'ALLOWED', kind: 'unified', has_orchard: true, has_sapling: true, has_transparent: false, payable_pools: ['ironwood'] });
    const { action_id } = (await t.app.inject(send(cookie, 'pay-u4-second'))).json();
    t.sidecar.approve = async () => {
      throw new Error(`boom with ${RECIPIENT}`);
    };
    const r2 = await t.app.inject({ method: 'POST', url: `/v1/actions/${action_id}/authorize`, payload: { signature: 'a'.repeat(128) }, headers: { cookie, origin: ORIGIN } });
    expect(r2.statusCode).toBe(500);
    expect(r2.body).not.toContain(RECIPIENT);
  });
});

describe('public deployment guards', () => {
  it('password guessing is rate limited per client IP', async () => {
    const t = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'maris', password: 'wrong-password!!' }, headers: { 'x-forwarded-for': '203.0.113.7' } });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    // Another client is unaffected.
    const other = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'maris', password: PW }, headers: { 'x-forwarded-for': '198.51.100.9' } });
    expect(other.statusCode).toBe(200);
  });
});

describe('self-serve sign-up (public deployment)', () => {
  const KEY = 'ab'.repeat(32);
  const signup = (app: Awaited<ReturnType<typeof setup>>['app'], username = 'ada_lovelace', extra: object = {}) =>
    app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { username, password: 'a long enough password', owner_pub: KEY, ...extra }, headers: { origin: ORIGIN } });

  it("creates the user's own three wallets bound to their browser key, then signs them in", async () => {
    const t = await setup({ signup: true });
    const r = await signup(t.app);
    expect(r.statusCode).toBe(200);
    expect(t.created).toHaveLength(3);
    const prefix = t.created[0]!.name.split('-')[0]!;
    expect(prefix).toMatch(/^u[0-9a-f]{10}$/);
    expect(t.created.map((c) => c.name)).toEqual([`${prefix}-merchant`, `${prefix}-payout`, `${prefix}-agent`]);
    expect(t.created.every((c) => c.ownerPub === KEY)).toBe(true);
    const cookie = String(r.headers['set-cookie']).split(';')[0]!;
    const me = (await t.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).json();
    expect(me).toMatchObject({ username: 'ada_lovelace', owner_pub: KEY, self_serve: true });
    // Their spends come from their own wallets, never the install's.
    await t.app.inject({ method: 'POST', url: '/v1/actions/send', payload: { wallet: 'payout', to: RECIPIENT, amount_zec: '0.001' }, headers: { cookie, origin: ORIGIN, 'idempotency-key': 'signup-send-1' } });
    expect(t.sidecar.proposeWallets).toEqual([`${prefix}-payout`]);
  });

  it('existing accounts keep the install wallets; duplicate names, bad keys and a full install are refused', async () => {
    const t = await setup({ signup: true, maxUsers: 4 });
    const cookie = await t.loginAs('maris');
    await t.app.inject({ method: 'POST', url: '/v1/actions/send', payload: { wallet: 'payout', to: RECIPIENT, amount_zec: '0.001' }, headers: { cookie, origin: ORIGIN, 'idempotency-key': 'legacy-send-1' } });
    expect(t.sidecar.proposeWallets).toEqual(['payout']);
    expect((await signup(t.app, 'maris')).json()).toEqual({ error: 'USERNAME_TAKEN' });
    expect((await signup(t.app, 'bob', { owner_pub: 'zz' })).statusCode).toBe(400);
    expect((await signup(t.app, 'bob')).statusCode).toBe(200);
    expect((await signup(t.app, 'cyd')).json()).toEqual({ error: 'SIGNUPS_CLOSED' });
    // Another install-wallet name cannot be smuggled in: wallet is a role, not a name.
    const r = await t.app.inject({ method: 'POST', url: '/v1/actions/send', payload: { wallet: 'u0000000000-payout', to: RECIPIENT, amount_zec: '0.001' }, headers: { cookie, origin: ORIGIN, 'idempotency-key': 'smuggle-1' } });
    expect(r.statusCode).toBe(400);
  });

  it('is absent when sign-up is not enabled; the second configured origin is accepted', async () => {
    const t = await setup();
    expect((await signup(t.app)).statusCode).toBe(404);
    const r = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'maris', password: PW }, headers: { origin: 'http://127.0.0.1:48300' } });
    expect(r.statusCode).toBe(200);
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

describe('payment requests (§19.2)', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
  });

  const create = (cookie: string, payload: object = { amount_zec: '0.005', details_ciphertext: 'Q2lwaGVydGV4dEJsb2JfX19fX19fX18' }) => ({
    method: 'POST' as const,
    url: '/v1/requests',
    payload,
    headers: { cookie, origin: ORIGIN },
  });

  it('creates a request with an opaque id and a share path without the key', async () => {
    const cookie = await t.loginAs('maris');
    const r = (await t.app.inject(create(cookie))).json();
    expect(r.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(r.share_path).toBe(`/r/${r.id}`);
    expect(JSON.stringify(r)).not.toContain('uregtest1');
  });

  it('public view returns the payment instructions and the opaque ciphertext, nothing about the owner', async () => {
    const cookie = await t.loginAs('maris');
    const { id } = (await t.app.inject(create(cookie))).json();
    const pub = await t.app.inject({ method: 'GET', url: `/v1/public/requests/${id}` });
    const body = pub.json();
    expect(body.status).toBe('OPEN');
    expect(body.zip321_uri).toContain(`LUTE:${id}`);
    expect(body.details_ciphertext).toBe('Q2lwaGVydGV4dEJsb2JfX19fX19fX18');
    expect(pub.body).not.toContain('maris');
    expect(pub.headers['cache-control']).toBe('no-store');
    expect(pub.headers['referrer-policy']).toBe('no-referrer');
  });

  it('stores the address and URI encrypted at rest', async () => {
    const cookie = await t.loginAs('maris');
    await t.app.inject(create(cookie));
    const rows = await t.pg.query('SELECT address_enc, zip321_enc FROM payment_requests');
    expect(JSON.stringify(rows.rows)).not.toContain('uregtest1');
  });

  it('F6: a request is never PAID from pending (unconfirmed) funds', async () => {
    const cookie = await t.loginAs('maris');
    const { id } = (await t.app.inject(create(cookie))).json();
    t.reqSidecar.check = { status: 'PENDING', matched_by: 'address_and_memo', requested_zat: 500000, received_confirmed_zat: 0, received_pending_zat: 500000, overpaid_zat: 0, txids: ['aa'] };
    const r = (await t.app.inject({ method: 'POST', url: `/v1/requests/${id}/refresh`, headers: { cookie, origin: ORIGIN } })).json();
    expect(r).toMatchObject({ status: 'PENDING', progress: 'CONFIRMING', seen_zat: '500000', received_zat: '0' });
    // Less than the amount arrived (confirmed or not): partially paid, not "confirming".
    t.reqSidecar.check = { ...t.reqSidecar.check, received_confirmed_zat: 100000, received_pending_zat: 200000 };
    const part = (await t.app.inject({ method: 'POST', url: `/v1/requests/${id}/refresh`, headers: { cookie, origin: ORIGIN } })).json();
    expect(part).toMatchObject({ status: 'PENDING', progress: 'PARTIAL', received_zat: '100000', seen_zat: '300000' });
    expect((await t.app.inject({ method: 'POST', url: `/v1/public/requests/${id}/check` })).json()).toMatchObject({ progress: 'PARTIAL', amount_zat: '500000', seen_zat: '300000' });
    t.reqSidecar.check = { ...t.reqSidecar.check, status: 'PAID', received_confirmed_zat: 500000, received_pending_zat: 0 };
    const p = (await t.app.inject({ method: 'POST', url: `/v1/requests/${id}/refresh`, headers: { cookie, origin: ORIGIN } })).json();
    expect(p).toMatchObject({ status: 'PAID', progress: 'PAID', received_zat: '500000', matched_by: 'address_and_memo', txids: ['aa'] });
    // Once paid, the public page stops showing payment instructions.
    expect((await t.app.inject({ method: 'GET', url: `/v1/public/requests/${id}` })).json()).toMatchObject({ status: 'PAID', zip321_uri: null });
  });

  it('U6: another user cannot refresh someone else\'s request; unknown ids are 404', async () => {
    const maris = await t.loginAs('maris');
    const { id } = (await t.app.inject(create(maris))).json();
    const mallory = await t.loginAs('mallory');
    expect((await t.app.inject({ method: 'POST', url: `/v1/requests/${id}/refresh`, headers: { cookie: mallory, origin: ORIGIN } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/v1/public/requests/AAAAAAAAAAAAAAAAAAAAAA' })).statusCode).toBe(404);
  });

  it('a plain user cannot create requests; bad amounts are rejected', async () => {
    const carol = await t.loginAs('carol');
    expect((await t.app.inject(create(carol))).statusCode).toBe(404);
    const maris = await t.loginAs('maris');
    expect((await t.app.inject(create(maris, { amount_zec: '0' }))).json()).toEqual({ error: 'BAD_AMOUNT' });
    expect((await t.app.inject(create(maris, { amount_zec: '0.000000001' }))).json()).toEqual({ error: 'BAD_AMOUNT' });
  });
});

describe('dashboard feeds (§19.10)', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    t = await setup();
  });

  it("activity lists the owner's actions without recipient or memo (U3), and only theirs (U6)", async () => {
    const cookie = await t.loginAs('maris');
    await t.app.inject(send(cookie));
    const r = await t.app.inject({ method: 'GET', url: '/v1/actions', headers: { cookie } });
    expect(r.json().actions).toHaveLength(1);
    expect(r.body).not.toContain(RECIPIENT);
    expect(r.body).not.toContain('Ab3_x-9Zq1');
    const other = await t.app.inject({ method: 'GET', url: '/v1/actions', headers: { cookie: await t.loginAs('mallory') } });
    expect(other.json().actions).toHaveLength(0);
  });

  it('balance is owner-only and limited to Lute wallets', async () => {
    const cookie = await t.loginAs('maris');
    expect((await t.app.inject({ method: 'GET', url: '/v1/wallets/payout/balance', headers: { cookie } })).json().ironwood.spendable_zat).toBe(60000);
    expect((await t.app.inject({ method: 'GET', url: '/v1/wallets/funder/balance', headers: { cookie } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/v1/wallets/payout/balance', headers: { cookie: await t.loginAs('carol') } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/v1/wallets/payout/balance' })).statusCode).toBe(401);
  });

  it('Privacy Center status is computed: no results file means UNTESTED, never PROVEN', async () => {
    const cookie = await t.loginAs('maris');
    writeFileSync(RESULTS_FILE, 'not json');
    let s = (await t.app.inject({ method: 'GET', url: '/v1/privacy/status', headers: { cookie } })).json();
    expect(s.run).toBeNull();
    expect(s.modules.find((m: { key: string }) => m.key === 'send').status).toBe('UNTESTED');
    expect(s.modules.find((m: { key: string }) => m.key === 'groups').status).toBe('UNTESTED');
    writeFileSync(
      RESULTS_FILE,
      JSON.stringify({ schema: 'lute-results/1', generated_at: 'x', commit: 'c', dirty: false, suites: [], findings: [], reviewed: false, evidence: [], tests: [{ suite: 'luteguard', file: 'packages/luteguard/test/evaluate.test.ts', name: 'a', status: 'failed' }] }),
    );
    s = (await t.app.inject({ method: 'GET', url: '/v1/privacy/status', headers: { cookie } })).json();
    expect(s.modules.find((m: { key: string }) => m.key === 'luteguard').status).toBe('BLOCKED');
  });

  it('Privacy Center lists recent DENY decisions with reason codes only (W1 decision)', async () => {
    const cookie = await t.loginAs('maris');
    t.sidecar.inspection = { ...t.sidecar.inspection, verdict: 'DENIED_TRANSPARENT', has_transparent: true, payable_pools: [] };
    await t.app.inject(send(cookie, 'idem-deny1'));
    const r = await t.app.inject({ method: 'GET', url: '/v1/privacy/status', headers: { cookie } });
    const s = r.json();
    expect(s.decisions.deny).toBe(1);
    expect(s.decisions.recent_denies[0].reasons.length).toBeGreaterThan(0);
    expect(r.body).not.toContain(RECIPIENT);
  });
});
