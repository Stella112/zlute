#!/usr/bin/env node
/**
 * Regtest commerce evidence: the real API code (buildApp, commerce routes, executeAction,
 * LuteGuard) against a regtest sidecar, with a throwaway DB. The fixture `funder` wallet plays the
 * customer and pays the checkout's ZIP-321 request (owner-approved with the DISPOSABLE regtest
 * key); the order becomes PAID, a signed receipt is issued and verified, a tampered copy fails,
 * and the owner refunds part of it to another wallet (`recipient`), which verifies it.
 * Env: SIDECAR_URL, SIDECAR_SECRET_FILE, OWNER_BIN, OWNER_KEY, ZEBRA_URL, ZEBRA_AUTH, REFUND_TO
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { buildApp } from '../dist/app.js';
import { createUser } from '../dist/auth.js';
import { FieldCipher } from '../dist/crypto.js';
import { schemaSql } from '../dist/db/migrate.js';
import { PgActionStore } from '../dist/db/store.js';
import { HttpSidecarClient } from '../dist/sidecar.js';

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};
const now = () => Math.floor(Date.now() / 1000);
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const log = (step, data) => console.log(`== ${new Date().toISOString()} ${step}${data === undefined ? '' : `\n${JSON.stringify(data)}`}`);
const sign = (view) =>
  execFileSync(env('OWNER_BIN'), ['sign', '--key', env('OWNER_KEY'), '--unattended-regtest'], { input: JSON.stringify({ proposal_hash: view.proposal_hash, summary: view.summary }), encoding: 'utf8' }).trim();

async function mine(n) {
  const res = await fetch(env('ZEBRA_URL'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(env('ZEBRA_AUTH')).toString('base64')}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'generate', params: [n], id: 1 }),
  });
  if (!res.ok) throw new Error(`generate failed (${res.status})`);
  await sleep(5);
}

const pg = new PGlite();
await pg.exec(schemaSql());
const db = drizzle(pg);
const cipher = FieldCipher.fromHex(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'));
const store = new PgActionStore(db, cipher, now);
const sidecar = new HttpSidecarClient(env('SIDECAR_URL'), Buffer.from(readFileSync(env('SIDECAR_SECRET_FILE'), 'utf8').trim(), 'hex'));
const app = await buildApp({ db, store, sidecar, requestSidecar: sidecar, cipher, network: 'regtest', now, secureCookies: false, appOrigin: 'http://127.0.0.1' });
const pw = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url');
await createUser(db, 'regtest-merchant', pw, 'owner', now());
const cookie = String((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'regtest-merchant', password: pw } })).headers['set-cookie']).split(';')[0];
const call = async (method, url, payload, headers = {}) => (await app.inject({ method, url, payload, headers: { cookie, ...headers } })).json();
const pub = async (method, url, payload) => (await app.inject({ method, url, payload })).json();

log('regtest commerce run: merchant wallet `merchant`, customer `funder`, refund to `recipient`');
const o = await call('POST', '/v1/commerce/orders', { item: 'Regtest T-shirt', amount_zec: '0.002' });
log('checkout created', { order_id: o.id, amount_zat: o.amount_zat, status: o.status });
const requestId = o.share_path.slice(3);
const pr = await pub('GET', `/v1/public/requests/${requestId}`);
// The customer's wallet reads the ZIP-321 URI (address, amount, memo) exactly as Zodl would.
const [address, query = ''] = pr.zip321_uri.replace(/^zcash:/, '').split('?');
const params = new URLSearchParams(query);
const memo = Buffer.from(params.get('memo').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
log('customer reads the ZIP-321 request', { amount: params.get('amount'), memo });

await sidecar.sync('funder');
const p = await sidecar.propose('funder', { to: address, amount_zat: 200000n, memo });
if (!p.ok) throw new Error(`customer propose failed: ${p.code}`);
const ap = await sidecar.approve('funder', p.value.summary.proposal_id, sign(p.value));
if (!ap.ok) throw new Error(`customer approve failed: ${ap.code}`);
const ex = await sidecar.execute('funder', p.value.summary.proposal_id);
log('customer paid the checkout', ex.ok ? { txid: ex.value.txid, status: ex.value.status } : { refused: ex.code });
log('before mining: public check', await pub('POST', `/v1/public/requests/${requestId}/check`));
await mine(1);
const chk = await pub('POST', `/v1/public/requests/${requestId}/check`);
log('after 1 block: public check (PAID needs 1 confirmation on regtest)', chk);
const rc = await pub('GET', `/v1/public/receipts/${chk.receipt_id}`);
log('signed receipt (no address, no item text)', rc);
log('U10 verify genuine receipt', await pub('POST', '/v1/public/receipts/verify', { receipt: rc.receipt, signature: rc.signature }));
log('U10 verify tampered receipt (paid_zat raised)', await pub('POST', '/v1/public/receipts/verify', { receipt: { ...rc.receipt, paid_zat: '2000000' }, signature: rc.signature }));

await mine(3);
log('refund over the paid amount', await call('POST', `/v1/commerce/orders/${o.id}/refunds`, { to: env('REFUND_TO'), amount_zec: '0.0021' }, { 'idempotency-key': 'regtest-refund-big' }));
const rf = await call('POST', `/v1/commerce/orders/${o.id}/refunds`, { to: env('REFUND_TO'), amount_zec: '0.0015' }, { 'idempotency-key': 'regtest-refund-1' });
log('refund 150,000 zat: LuteGuard then owner signature', { state: rf.result.state, proposal_hash: rf.result.proposal_hash });
const au = await call('POST', `/v1/actions/${rf.action_id}/authorize`, { signature: sign(rf.result) });
log('refund authorized', au.result);
await mine(1);
const v = await call('POST', `/v1/commerce/orders/${o.id}/refresh`);
log('order after refund', { status: v.status, received_zat: v.received_zat, refunded_zat: v.refunded_zat, refundable_zat: v.refundable_zat, refunds: v.refunds });
log('txids', { payment: ex.ok ? ex.value.txid : null, refund: au.result.txid });
if (chk.status !== 'PAID' || !chk.receipt_id || au.result.state !== 'SUBMITTED' || v.refunds[0]?.state !== 'CONFIRMED') process.exit(1);
