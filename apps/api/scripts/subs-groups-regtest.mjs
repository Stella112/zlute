#!/usr/bin/env node
/**
 * Regtest evidence for subscriptions and groups: the real API code against a regtest sidecar,
 * with a throwaway DB. The fixture `funder` wallet plays the subscriber / group members and pays
 * the ZIP-321 invoices (owner-approved with the DISPOSABLE regtest key).
 * - Subscription: plan of 120 s with 40 s grace. Period 1 invoice paid -> ACTIVE. Period 2 starts
 *   unpaid -> DUE (in grace) -> LAPSED (after grace).
 * - Group: 0.003 ZEC split 3 ways; 2 members pay -> organizer sees 2/3 paid, 0.002 collected.
 * Env: SIDECAR_URL, SIDECAR_SECRET_FILE, OWNER_BIN, OWNER_KEY, ZEBRA_URL, ZEBRA_AUTH
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
const call = async (method, url, payload) => (await app.inject({ method, url, payload, headers: { cookie } })).json();
const pub = async (method, url, payload) => (await app.inject({ method, url, payload })).json();

/** The payer's wallet reads a request's ZIP-321 URI and pays it (exactly what Zodl does). */
async function payRequest(requestId) {
  const pr = await pub('GET', `/v1/public/requests/${requestId}`);
  const [address, query = ''] = pr.zip321_uri.replace(/^zcash:/, '').split('?');
  const params = new URLSearchParams(query);
  const memo = Buffer.from(params.get('memo').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  await sidecar.sync('funder');
  const p = await sidecar.propose('funder', { to: address, amount_zat: BigInt(pr.amount_zat), memo });
  if (!p.ok) throw new Error(`propose failed: ${p.code}`);
  const sig = execFileSync(env('OWNER_BIN'), ['sign', '--key', env('OWNER_KEY'), '--unattended-regtest'], { input: JSON.stringify({ proposal_hash: p.value.proposal_hash, summary: p.value.summary }), encoding: 'utf8' }).trim();
  const ap = await sidecar.approve('funder', p.value.summary.proposal_id, sig);
  if (!ap.ok) throw new Error(`approve failed: ${ap.code}`);
  const ex = await sidecar.execute('funder', p.value.summary.proposal_id);
  if (!ex.ok) throw new Error(`execute failed: ${ex.code}`);
  return { txid: ex.value.txid, amount_zat: pr.amount_zat, memo };
}

// ---------------- subscription ----------------
log('regtest subscriptions + groups run (payer = fixture funder, merchant wallet receives)');
const plan = await call('POST', '/v1/subscriptions/plans', { name: 'Regtest Pro', amount_zec: '0.001', period_s: 120, grace_s: 40 });
const sub = await call('POST', '/v1/subscriptions', { plan_id: plan.id, subscriber: 'regtest subscriber' });
log('plan 0.001 ZEC / 120 s (grace 40 s); subscriber added', { status: sub.status, period: sub.period_no + 1 });
let page = await pub('POST', `/v1/public/subscriptions/${sub.id}`);
log('subscriber page (no merchant identity)', page);
const p1 = await payRequest(page.pay_path.slice(3));
log('subscriber pays period 1 invoice', p1);
await mine(1);
page = await pub('POST', `/v1/public/subscriptions/${sub.id}`);
log('after 1 block: subscriber page', page);
const subTx = p1.txid;
const periodEnd = page.period_end;
while (now() < periodEnd + 2) await sleep(2);
page = await pub('POST', `/v1/public/subscriptions/${sub.id}`);
log('period 2 started, unpaid: DUE (inside 40 s grace), new invoice', { status: page.status, period: page.period_no + 1, has_new_invoice: page.pay_path !== null });
while (now() < periodEnd + 42) await sleep(2);
const owner = await call('POST', `/v1/subscriptions/${sub.id}/refresh`);
log('after grace: owner view', { status: owner.status, period: owner.period_no + 1, invoices: owner.invoices });

// ---------------- group ----------------
const g = await call('POST', '/v1/groups', { title: 'Regtest dinner', total_zec: '0.003', members: ['A', 'B', 'C'] });
log('group 0.003 ZEC split 3 ways (one request per member)', { shares: g.members.map((m) => m.share_zat) });
const gA = await payRequest(g.members[0].share_path.slice(3));
const gB = await payRequest(g.members[1].share_path.slice(3));
log('members A and B pay their own links', { a: gA.txid, b: gB.txid });
await mine(1);
const gv = await call('POST', `/v1/groups/${g.id}/refresh`);
log('organizer view after 1 block', { paid_members: gv.paid_members, collected_zat: gv.collected_zat, statuses: gv.members.map((m) => m.status) });
log('txids', { subscription_period_1: subTx, group_a: gA.txid, group_b: gB.txid });
const ok = owner.status === 'LAPSED' && gv.paid_members === 2 && gv.collected_zat === '200000';
if (!ok) process.exit(1);
