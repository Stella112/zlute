#!/usr/bin/env node
/**
 * `pnpm test:evidence`: runs every test suite and writes evidence/results.json, the only input of
 * the Privacy Center's computed status (mandate §19.10, §23). Nothing here is hand-written:
 * - TS suites: vitest JSON reporter (luteguard, core, api).
 * - Rust suites: `cargo test --locked` output (sidecar, lute-owner). With --rust-from-ci, the
 *   `cargo test` lines of the latest successful CI run of that workflow are used instead, and the
 *   run id and commit are recorded as the source. A suite that cannot run is recorded as missing
 *   (never as passed).
 * - Evidence rows: parsed from docs/PRIVACY-EVIDENCE.md (txids only from the Artifact column).
 * - Findings: docs/FINDINGS.json if present (external review); otherwise none and reviewed=false.
 * Usage: node tools/evidence/collect.mjs [--skip-rust | --rust-from-ci]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const skipRust = process.argv.includes('--skip-rust');
const rustFromCi = process.argv.includes('--rust-from-ci');
const REPO = 'Stella112/zlute';
const tmp = mkdtempSync(join(tmpdir(), 'lute-evidence-'));
const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');

const suites = [];
const tests = [];

function vitest(name, dir) {
  const out = join(tmp, `${name}.json`);
  // Explicit timeouts: in-memory Postgres setup per test is slow under load (defaults are 5 s / 10 s).
  spawnSync('pnpm', ['exec', 'vitest', 'run', '--reporter=json', '--testTimeout=120000', '--hookTimeout=120000', `--outputFile=${out}`], { cwd: join(ROOT, dir), stdio: 'inherit', shell: true });
  if (!existsSync(out)) {
    suites.push({ name, passed: 0, failed: 0, skipped: 0, missing: true });
    return;
  }
  const j = JSON.parse(readFileSync(out, 'utf8'));
  for (const f of j.testResults ?? []) {
    for (const a of f.assertionResults ?? []) {
      const status = a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped';
      tests.push({ suite: name, file: rel(f.name), name: a.fullName ?? a.title, status });
    }
    // A file that failed to load has no assertions: count it as a failure, never as nothing.
    if ((f.assertionResults ?? []).length === 0 && f.status === 'failed') tests.push({ suite: name, file: rel(f.name), name: '(file failed to load)', status: 'failed' });
  }
  summarize(name);
}

function cargo(name, dir, workflow) {
  if (skipRust) return suites.push({ name, passed: 0, failed: 0, skipped: 0, missing: true });
  let r;
  let source = 'local';
  if (rustFromCi) {
    const [run] = JSON.parse(execFileSync('gh', ['run', 'list', '-R', REPO, '-w', workflow, '-s', 'success', '-L', '1', '--json', 'databaseId,headSha'], { encoding: 'utf8' }));
    if (!run) return suites.push({ name, passed: 0, failed: 0, skipped: 0, missing: true });
    const log = execFileSync('gh', ['run', 'view', String(run.databaseId), '-R', REPO, '--log'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    // Lines look like "<job>\t<step>\t<timestamp> test x ... ok": keep the cargo part only.
    r = { status: 0, stdout: log.split('\n').map((l) => l.replace(/^.*?\d{4}-\d\d-\d\dT[\d:.]+Z /, '')).join('\n'), stderr: '' };
    source = `ci run ${run.databaseId} @ ${run.headSha.slice(0, 7)}`;
  } else {
    r = spawnSync('cargo', ['test', '--locked'], { cwd: join(ROOT, dir), encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  }
  const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const re = /^test (\S+) \.\.\. (ok|FAILED|ignored)/gm;
  let m;
  let n = 0;
  while ((m = re.exec(text))) {
    n++;
    tests.push({ suite: name, file: `${dir}::${m[1].split('::').slice(0, -1).join('::')}`, name: m[1], status: m[2] === 'ok' ? 'passed' : m[2] === 'FAILED' ? 'failed' : 'skipped' });
  }
  if (n === 0) {
    // Did not build or run: recorded as missing (and as a failure if cargo itself failed).
    if (r.status !== 0) tests.push({ suite: name, file: dir, name: '(cargo test did not run)', status: 'failed' });
    suites.push({ name, passed: 0, failed: r.status !== 0 ? 1 : 0, skipped: 0, missing: true, source });
    return;
  }
  summarize(name, source);
}

function summarize(name, source = 'local') {
  const own = tests.filter((t) => t.suite === name);
  suites.push({ name, source, passed: own.filter((t) => t.status === 'passed').length, failed: own.filter((t) => t.status === 'failed').length, skipped: own.filter((t) => t.status === 'skipped').length });
}

function evidenceRows() {
  const md = readFileSync(join(ROOT, 'docs/PRIVACY-EVIDENCE.md'), 'utf8');
  const rows = [];
  for (const line of md.split(/\r?\n/)) {
    if (!/^\| E-\d+/.test(line)) continue;
    const c = line.split(' | ').map((s) => s.replace(/^\|\s*|\s*\|$/g, '').trim());
    if (c.length < 13) continue;
    const envText = c[3].toLowerCase();
    const env = envText.includes('mainnet') ? 'mainnet' : envText.includes('regtest') ? 'regtest' : envText.includes('ci') ? 'ci' : 'other';
    rows.push({
      id: c[0],
      env,
      claim: c[1].replaceAll('**', ''),
      txids: [...new Set(c[9].match(/\b[0-9a-f]{64}\b/g) ?? [])],
      limits: c[11].replaceAll('**', ''),
    });
  }
  return rows;
}

execFileSync('pnpm', ['-r', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
vitest('luteguard', 'packages/luteguard');
vitest('core', 'packages/core');
vitest('api', 'apps/api');
vitest('mcp', 'apps/mcp');
vitest('web', 'apps/web');
cargo('sidecar', 'services/wallet-sidecar', 'wallet-sidecar');
cargo('lute-owner', 'tools/lute-owner', 'lute-owner');

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const dirty = git('status', '--porcelain').split('\n').filter((l) => l && !l.endsWith('evidence/results.json')).length > 0;
const findingsFile = join(ROOT, 'docs/FINDINGS.json');
const findings = existsSync(findingsFile) ? JSON.parse(readFileSync(findingsFile, 'utf8')) : [];

const results = {
  schema: 'lute-results/1',
  generated_at: new Date().toISOString(),
  commit: git('rev-parse', 'HEAD'),
  dirty,
  suites,
  tests,
  evidence: evidenceRows(),
  findings,
  reviewed: existsSync(findingsFile),
};
writeFileSync(join(ROOT, 'evidence/results.json'), `${JSON.stringify(results, null, 1)}\n`);
console.log(`evidence/results.json: ${suites.map((s) => `${s.name} ${s.passed}/${s.passed + s.failed}${s.missing ? ' (missing)' : ''}`).join(', ')}; ${results.evidence.length} evidence rows; commit ${results.commit.slice(0, 7)}${dirty ? ' (dirty)' : ''}`);
