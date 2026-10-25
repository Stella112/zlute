#!/usr/bin/env node
/**
 * Regtest stream evidence (S12, S14, F6): the real API code (buildApp, executeAction, LuteGuard,
 * HttpSidecarClient) against a regtest sidecar, with a throwaway in-memory database. Settlements
 * are signed with the DISPOSABLE regtest owner key (lute-owner --unattended-regtest, which refuses
 * any non-regtest proposal) and confirmed by mining blocks.
 * Run by infrastructure/z3/streams-regtest.sh on the VPS; never against mainnet.
 * Env: SIDECAR_URL, SIDECAR_SECRET_FILE, OWNER_BIN, OWNER_KEY, RECIPIENT, ZEBRA_URL, ZEBRA_AUTH
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
const app = await buildApp({ db, store, sidecar, requestSidecar: sidecar, cipher, network: 'regtest', now, secureCookies: false, appOrigin: 'http://127.0.0.1', minPayoutZat: 100_000n });
const pw = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url');
await createUser(db, 'regtest-owner', pw, 'owner', now());
const cookie = String((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'regtest-owner', password: pw } })).headers['set-cookie']).split(';')[0];
const call = async (method, url, payload, headers = {}) => {
  const r = await app.inject({ method, url, payload, headers: { cookie, ...headers } });
  return r.json();
};
const view = async (id) => {
  const v = await call('GET', `/v1/streams/${id}`);
  return { status: v.status, accrued: v.accrued_zat, pending: v.pending_zat, confirmed_paid: v.confirmed_paid_zat, outstanding: v.outstanding_zat, settlements: v.settlements.map((s) => ({ seq: s.seq, amount: s.amount_zat, state: s.state, txid: s.txid })) };
};

async function settle(id, n) {
  await sidecar.sync('funder');
  const r = await call('POST', `/v1/streams/${id}/settle`, {}, { 'idempotency-key': `regtest-settle-${n}-${now()}` });
  log(`settlement ${n}: executeAction result`, { state: r.result.state, proposal_hash: r.result.proposal_hash, reasons: r.result.reasons ?? r.result.reason });
  if (r.result.state !== 'AWAITING_AUTHORIZATION') throw new Error('settlement not awaiting authorization');
  const sig = execFileSync(env('OWNER_BIN'), ['sign', '--key', env('OWNER_KEY'), '--unattended-regtest'], {
    input: JSON.stringify({ proposal_hash: r.result.proposal_hash, summary: r.result.summary }),
    encoding: 'utf8',
  }).trim();
  const a = await call('POST', `/v1/actions/${r.action_id}/authorize`, { signature: sig });
  log(`settlement ${n}: authorized`, a.result);
  return a.result.txid;
}

const RECIPIENT = env('RECIPIENT');
log('regtest stream run: network regtest, wallet funder, sidecar ' + env('SIDECAR_URL'));
const s = await call('POST', '/v1/streams', { wallet: 'funder', to: RECIPIENT, total_zec: '0.01', duration_s: 60 });
if (!s.id) throw new Error(`create failed: ${JSON.stringify(s)}`);
log('S12 stream created (1,000,000 zat over 60 s)', { id: s.id, rate_zat_per_s: s.rate_zat_per_s, contracted: s.contracted_zat });

for (let i = 0; i < 3; i++) {
  await sleep(10);
  log('accrual (server clock)', await view(s.id));
}
const tx1 = await settle(s.id, 1);
log('F6 after broadcast, before mining: pending, not paid', await view(s.id));
await mine(1);
await call('POST', `/v1/streams/${s.id}/refresh`);
log('after 1 block + refresh: settlement 1 confirmed (regtest min conf 1)', await view(s.id));

// Change from settlement 1 must confirm before it can be spent again.
await mine(3);
while (now() < s.end_ts + 1) await sleep(2);
log('stream ended', await view(s.id));
const tx2 = await settle(s.id, 2);
await mine(1);
await call('POST', `/v1/streams/${s.id}/refresh`);
const final = await view(s.id);
log('S14 final: paid = contracted, outstanding 0', final);
log('txids', { settlement_1: tx1, settlement_2: tx2 });
if (final.confirmed_paid !== '1000000' || final.outstanding !== '0') process.exit(1);
