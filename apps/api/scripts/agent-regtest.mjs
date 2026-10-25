#!/usr/bin/env node
/**
 * Regtest agent evidence (A2, A3, A5, A7, A10): the real API code (buildApp, agent routes,
 * executeAction, LuteGuard, HttpSidecarClient) against a regtest sidecar, with a throwaway DB.
 * The mandate is signed with the DISPOSABLE regtest owner key (lute-owner sign-mandate
 * --unattended-regtest, refused for any other network). Confirmations come from mined blocks.
 * Run by infrastructure/z3/agent-regtest.sh on the VPS; never against mainnet.
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
const app = await buildApp({ db, store, sidecar, requestSidecar: sidecar, mandates: sidecar, cipher, network: 'regtest', now, secureCookies: false, appOrigin: 'http://127.0.0.1' });
const pw = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url');
await createUser(db, 'regtest-owner', pw, 'owner', now());
const cookie = String((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'regtest-owner', password: pw } })).headers['set-cookie']).split(';')[0];
const owner = async (method, url, payload) => (await app.inject({ method, url, payload, headers: { cookie } })).json();
let token = '';
const agent = async (method, url, headers = {}) => {
  const r = await app.inject({ method, url, payload: method === 'POST' ? {} : undefined, headers: { authorization: `Bearer ${token}`, 'x-lute-caller': 'mcp', ...headers } });
  return { status: r.statusCode, body: r.json() };
};

log('regtest agent run: wallets agent (payer) and merchant (metered service), sidecar ' + env('SIDECAR_URL'));
const svc = await owner('POST', '/v1/meter/services', { name: 'Chain tip API (demo)', price_per_call_zat: 15000, credit_limit_zat: 300000 });
log('metered service registered (price 15,000 zat/call, credit limit 300,000)', { id: svc.id });

const draft = await owner('POST', '/v1/agent/mandates/draft', { service_id: svc.id, max_tx_zec: '0.0015', total_zec: '0.0025', ttl_hours: 2 });
const sig = execFileSync(env('OWNER_BIN'), ['sign-mandate', '--key', env('OWNER_KEY'), '--unattended-regtest'], { input: JSON.stringify(draft.mandate), encoding: 'utf8' }).trim();
const g = await owner('POST', '/v1/agent/grants', { agent_name: 'regtest agent', service_id: svc.id, mandate: draft.mandate, signature: sig });
if (!g.token) throw new Error(`grant failed: ${JSON.stringify(g)}`);
token = g.token;
log('owner-signed mandate loaded by the sidecar; grant issued (token not logged)', { grant_id: g.grant_id, mandate_id: g.mandate.id, mandate_hash: g.mandate.hash, cap_per_tx_zat: g.cap_per_tx_zat, cap_total_zat: g.cap_total_zat });

const s = (await agent('POST', '/v1/meter/sessions')).body;
for (let i = 1; i <= 10; i++) {
  const c = await agent('POST', `/v1/meter/sessions/${s.id}/call`);
  if (i === 1 || i === 10) log(`metered call ${i}`, c.body);
}
await sidecar.sync('agent');
const r1 = await agent('POST', `/v1/meter/sessions/${s.id}/settle`, { 'idempotency-key': 'regtest-settle-1' });
log('A10 settlement 1 (150,000 zat = 10 calls) under the mandate, no owner signature', r1.body);
const tx1 = r1.body.result?.txid;
await mine(1);
log('after 1 block + refresh', (await agent('POST', `/v1/meter/sessions/${s.id}/refresh`)).body);
log('grant budget', (await agent('GET', '/v1/agent/me')).body);

await mine(3); // change confirms
await sidecar.sync('agent');
for (let i = 11; i <= 20; i++) await agent('POST', `/v1/meter/sessions/${s.id}/call`);
const r2 = await agent('POST', `/v1/meter/sessions/${s.id}/settle`, { 'idempotency-key': 'regtest-settle-2' });
log('A3 settlement 2 (150,000 more; total would be 300,000 > 250,000): LuteGuard', r2.body);

// A7 defense in depth: bypass the API and LuteGuard entirely and ask the sidecar directly.
const svcAddr = draft.mandate.allowed_recipients[0];
const over = await sidecar.propose('agent', { to: svcAddr, amount_zat: 150000n, memo: 'LUTE:bypass-test' });
const ex1 = over.ok ? await sidecar.executeMandate('agent', over.value.summary.proposal_id, g.mandate.id) : over;
log('A7 bypass: sidecar execute-mandate over the remaining budget', ex1.ok ? ex1.value : { refused: ex1.code });
const recipientAddr = (await sidecar.newAddress('recipient'));
const other = await sidecar.propose('agent', { to: recipientAddr, amount_zat: 10000n });
const ex2 = other.ok ? await sidecar.executeMandate('agent', other.value.summary.proposal_id, g.mandate.id) : other;
log('A5 bypass: sidecar execute-mandate to a recipient not in the mandate', ex2.ok ? ex2.value : { refused: ex2.code });
const small = await sidecar.propose('agent', { to: svcAddr, amount_zat: 10000n });
const ex3 = small.ok ? await sidecar.execute('agent', small.value.summary.proposal_id) : small;
log('bypass: plain execute without owner approval', ex3.ok ? ex3.value : { refused: ex3.code });
log('sidecar mandate status', await sidecar.mandateStatus('agent', g.mandate.id));
log('txids', { settlement_1: tx1 });
if (r1.body.result?.state !== 'SUBMITTED' || r2.body.result?.state !== 'REJECTED' || ex1.ok || ex2.ok || ex3.ok) process.exit(1);
