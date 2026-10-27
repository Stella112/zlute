/**
 * Lute API process. Configuration (environment):
 *   LUTE_NETWORK              main | test | regtest
 *   DATABASE_URL              postgres://… (Postgres 16)
 *   LUTE_DATA_KEY             32-byte hex key for field encryption at rest
 *   LUTE_SIDECAR_URL          http://127.0.0.1:<port>  (loopback only)
 *   LUTE_SIDECAR_SECRET_FILE  file holding the shared HMAC secret (hex)
 *   LUTE_API_HOST / LUTE_API_PORT   default 127.0.0.1 / 48200
 *   LUTE_APP_ORIGIN           exact browser origin allowed for state-changing requests
 *   LUTE_SECURE_COOKIES       "true" behind HTTPS (default true)
 * One-off: `node dist/server.js create-user <username> <role>` reads the password from stdin.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Network } from '@lute/luteguard';
import { recoverInFlight } from './recovery.js';
import { buildApp } from './app.js';
import { createUser, type Role } from './auth.js';
import { FieldCipher } from './crypto.js';
import { fileURLToPath } from 'node:url';
import { schemaSql } from './db/migrate.js';
import { PgActionStore } from './db/store.js';
import { HttpSidecarClient } from './sidecar.js';

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`missing environment variable ${name}`);
  return v;
}

const now = () => Math.floor(Date.now() / 1000);

async function main(): Promise<void> {
  const network = env('LUTE_NETWORK') as Network;
  if (!['main', 'test', 'regtest'].includes(network)) throw new Error('LUTE_NETWORK must be main, test or regtest');
  const pool = new pg.Pool({ connectionString: env('DATABASE_URL'), max: 5 });
  await pool.query(schemaSql());
  const db = drizzle(pool);

  if (process.argv[2] === 'create-user') {
    const [, , , username, role] = process.argv;
    if (!username || !['owner', 'merchant', 'user'].includes(role ?? '')) throw new Error('usage: create-user <username> <owner|merchant|user>');
    const password = readFileSync(0, 'utf8').trim();
    await createUser(db, username, password, role as Role, now());
    console.log(`created ${role} ${username}`);
    await pool.end();
    return;
  }

  const cipher = FieldCipher.fromHex(env('LUTE_DATA_KEY'));
  const store = new PgActionStore(db, cipher, now);
  const secret = Buffer.from(readFileSync(env('LUTE_SIDECAR_SECRET_FILE'), 'utf8').trim(), 'hex');
  const sidecar = new HttpSidecarClient(env('LUTE_SIDECAR_URL'), secret);
  const app = await buildApp({
    db,
    store,
    sidecar,
    requestSidecar: sidecar,
    mandates: sidecar,
    ...(env('LUTE_SIGNUP', 'false') === 'true' ? { walletAdmin: sidecar, maxUsers: Number(env('LUTE_MAX_USERS', '500')) } : {}),
    pczt: sidecar,
    proposals: sidecar,
    cipher,
    minPayoutZat: BigInt(env('LUTE_MIN_PAYOUT_ZAT', '100000')),
    network,
    now,
    secureCookies: env('LUTE_SECURE_COOKIES', 'true') === 'true',
    appOrigin: env('LUTE_APP_ORIGIN'),
    resultsFile: env('LUTE_RESULTS_FILE', fileURLToPath(new URL('../../../evidence/results.json', import.meta.url))),
  });
  const host = env('LUTE_API_HOST', '127.0.0.1');
  await app.listen({ host, port: Number(env('LUTE_API_PORT', '48200')) });
  console.log(`lute api listening on ${host} (${network})`);

  // Recoverable operations: settle actions interrupted by a crash or restart, now and every 5 min.
  const sweep = () =>
    recoverInFlight({ db, store, sidecar, now })
      .then((r) => {
        if (r.length) console.log(`recovery: ${r.map((x) => `${x.from}->${x.to} (${x.spend})`).join(', ')}`);
      })
      .catch(() => console.error('recovery sweep failed'));
  void sweep();
  setInterval(() => void sweep(), 5 * 60 * 1000).unref();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'fatal error');
  process.exit(1);
});
