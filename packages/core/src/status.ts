/**
 * Feature status (mandate §23): computed from `evidence/results.json`, never chosen.
 * - PROVEN: every matching test passes, and (if the module moves money) there is regtest evidence
 *   and at least one mainnet txid, and no open CRITICAL/HIGH finding.
 * - PARTIAL: tests pass but evidence is missing, or execution is disabled.
 * - BLOCKED: a matching test fails.
 * - ROADMAP: not implemented and unreachable.
 * - UNTESTED: no matching test in the latest run.
 * The registry below only says which tests and evidence rows belong to a module.
 */

export type ModuleStatus = 'PROVEN' | 'PARTIAL' | 'BLOCKED' | 'ROADMAP' | 'UNTESTED';

export interface TestResult {
  suite: string;
  /** Repo-relative path of the test file (Rust: the module path). */
  file: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
}

export interface EvidenceRow {
  id: string;
  env: 'mainnet' | 'regtest' | 'ci' | 'other';
  claim: string;
  txids: string[];
  limits: string;
}

export interface Finding {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  module: string;
  status: 'open' | 'fixed';
  title: string;
}

export interface Results {
  schema: 'lute-results/1';
  generated_at: string;
  commit: string;
  dirty: boolean;
  suites: { name: string; passed: number; failed: number; skipped: number }[];
  tests: TestResult[];
  evidence: EvidenceRow[];
  findings: Finding[];
  /** Whether an external (Codex) review has been run at all. */
  reviewed: boolean;
}

export interface TestSelector {
  suite: string;
  /** Matches the test file path. */
  file?: RegExp;
  /** Matches the full test name. */
  name?: RegExp;
}

export interface ModuleDef {
  key: string;
  label: string;
  implemented: boolean;
  moves_money: boolean;
  /** Implemented, but execution is switched off in this build (e.g. cross-chain). */
  execution_disabled?: string;
  tests: TestSelector[];
  /** Evidence rows (docs/PRIVACY-EVIDENCE.md ids) that demonstrate this module. */
  evidence: string[];
}

export const MODULES: readonly ModuleDef[] = [
  {
    key: 'send',
    label: 'Send (owner-approved shielded payouts)',
    implemented: true,
    moves_money: true,
    tests: [
      { suite: 'core', file: /execute\.test/ },
      { suite: 'luteguard', file: /evaluate\.test|canonical\.test/ },
      { suite: 'api', file: /app\.test/, name: /^API / },
      { suite: 'sidecar' },
    ],
    evidence: ['E-001', 'E-002', 'E-005', 'E-006', 'E-007'],
  },
  {
    key: 'requests',
    label: 'Receive and payment requests',
    implemented: true,
    moves_money: false,
    tests: [{ suite: 'api', file: /app\.test/, name: /payment requests/ }],
    evidence: ['E-004'],
  },
  {
    key: 'streams',
    label: 'Per-second streams',
    implemented: true,
    moves_money: true,
    tests: [
      { suite: 'core', file: /streams\.test/ },
      { suite: 'api', file: /streams\.test/ },
    ],
    evidence: ['E-008', 'E-009'],
  },
  {
    key: 'luteguard',
    label: 'LuteGuard policy engine',
    implemented: true,
    moves_money: false,
    tests: [{ suite: 'luteguard' }],
    evidence: ['E-006'],
  },
  {
    key: 'privacy-center',
    label: 'Privacy Center (computed status)',
    implemented: true,
    moves_money: false,
    tests: [{ suite: 'core', file: /status\.test/ }],
    evidence: [],
  },
  {
    key: 'crosschain',
    label: 'Cross-chain route classification',
    implemented: true,
    moves_money: false,
    execution_disabled: 'No route is classified STRICT_PRIVATE_VERIFIED; execution is off.',
    tests: [{ suite: 'luteguard', file: /crosschain\.test/ }],
    evidence: [],
  },
  { key: 'commerce', label: 'Commerce, receipts and refunds', implemented: false, moves_money: true, tests: [], evidence: [] },
  { key: 'groups', label: 'Groups', implemented: false, moves_money: true, tests: [], evidence: [] },
  {
    key: 'meter',
    label: 'Metered billing (agent pays per call)',
    implemented: true,
    moves_money: true,
    tests: [{ suite: 'api', file: /agents\.test/ }],
    evidence: ['E-010'],
  },
  { key: 'subscriptions', label: 'Subscriptions', implemented: false, moves_money: true, tests: [], evidence: [] },
  {
    key: 'agents',
    label: 'Agent mandates and MCP',
    implemented: true,
    moves_money: true,
    tests: [
      { suite: 'core', file: /execute\.test/, name: /for agents/ },
      { suite: 'api', file: /agents\.test/ },
      { suite: 'sidecar', name: /mandate/ },
      { suite: 'mcp' },
    ],
    evidence: ['E-010'],
  },
];

export interface ModuleReport {
  key: string;
  label: string;
  status: ModuleStatus;
  reasons: string[];
  tests: { passed: number; failed: number; skipped: number };
  failing: string[];
  evidence: { id: string; env: EvidenceRow['env']; txids: string[] }[];
}

const matches = (t: TestResult, s: TestSelector) =>
  t.suite === s.suite && (!s.file || s.file.test(t.file)) && (!s.name || s.name.test(t.name));

export function moduleStatus(m: ModuleDef, r: Results | null): ModuleReport {
  const base = { key: m.key, label: m.label };
  if (!m.implemented) {
    return { ...base, status: 'ROADMAP', reasons: ['Not available in this build'], tests: { passed: 0, failed: 0, skipped: 0 }, failing: [], evidence: [] };
  }
  if (!r) return { ...base, status: 'UNTESTED', reasons: ['No results file'], tests: { passed: 0, failed: 0, skipped: 0 }, failing: [], evidence: [] };

  const tests = r.tests.filter((t) => m.tests.some((s) => matches(t, s)));
  const count = (st: TestResult['status']) => tests.filter((t) => t.status === st).length;
  const summary = { passed: count('passed'), failed: count('failed'), skipped: count('skipped') };
  const failing = tests.filter((t) => t.status === 'failed').map((t) => `${t.suite}: ${t.name}`);
  const evidence = r.evidence.filter((e) => m.evidence.includes(e.id)).map((e) => ({ id: e.id, env: e.env, txids: e.txids }));

  if (summary.passed + summary.failed === 0) return { ...base, status: 'UNTESTED', reasons: ['No matching test in the latest run'], tests: summary, failing, evidence };
  if (summary.failed > 0) return { ...base, status: 'BLOCKED', reasons: [`${summary.failed} failing test(s)`], tests: summary, failing, evidence };

  const reasons: string[] = [];
  for (const s of m.tests) {
    if (!r.tests.some((t) => matches(t, s))) reasons.push(`No ${s.suite} test results`);
  }
  if (m.execution_disabled) reasons.push(m.execution_disabled);
  if (m.moves_money) {
    if (!evidence.some((e) => e.env === 'regtest')) reasons.push('No regtest evidence');
    if (!evidence.some((e) => e.env === 'mainnet' && e.txids.length > 0)) reasons.push('No mainnet txid');
  }
  const open = r.findings.filter((f) => f.module === m.key && f.status === 'open' && (f.severity === 'CRITICAL' || f.severity === 'HIGH'));
  if (open.length) reasons.push(`${open.length} open CRITICAL/HIGH finding(s)`);
  return { ...base, status: reasons.length ? 'PARTIAL' : 'PROVEN', reasons, tests: summary, failing, evidence };
}

export function computeStatus(r: Results | null, modules: readonly ModuleDef[] = MODULES): ModuleReport[] {
  return modules.map((m) => moduleStatus(m, r));
}
