import { describe, expect, it } from 'vitest';
import { computeStatus, moduleStatus, type ModuleDef, type Results } from '../src/status.js';

const def: ModuleDef = { key: 'pay', label: 'Pay', implemented: true, moves_money: true, tests: [{ suite: 'core', file: /pay\.test/ }], evidence: ['E-1', 'E-2'] };

function results(over: Partial<Results> = {}): Results {
  return {
    schema: 'lute-results/1',
    generated_at: '2026-10-25T00:00:00Z',
    commit: 'abc',
    dirty: false,
    suites: [],
    tests: [
      { suite: 'core', file: 'packages/core/test/pay.test.ts', name: 'pays', status: 'passed' },
      { suite: 'core', file: 'packages/core/test/other.test.ts', name: 'other', status: 'failed' },
    ],
    evidence: [
      { id: 'E-1', env: 'regtest', claim: 'x', txids: ['aa'], limits: '' },
      { id: 'E-2', env: 'mainnet', claim: 'y', txids: ['bb'], limits: '' },
    ],
    findings: [],
    reviewed: false,
    ...over,
  };
}

describe('feature status (§23)', () => {
  it('PROVEN needs passing tests, regtest evidence and a mainnet txid', () => {
    expect(moduleStatus(def, results()).status).toBe('PROVEN');
  });

  it('no results file, or no matching test, is UNTESTED', () => {
    expect(moduleStatus(def, null).status).toBe('UNTESTED');
    expect(moduleStatus({ ...def, tests: [{ suite: 'none' }] }, results()).status).toBe('UNTESTED');
  });

  it('a failing matching test is BLOCKED (a failure elsewhere is not)', () => {
    const r = results();
    r.tests[0]!.status = 'failed';
    const m = moduleStatus(def, r);
    expect(m.status).toBe('BLOCKED');
    expect(m.failing).toEqual(['core: pays']);
  });

  it('missing regtest or mainnet evidence makes a money-moving module PARTIAL', () => {
    const noMain = moduleStatus(def, results({ evidence: [{ id: 'E-1', env: 'regtest', claim: '', txids: [], limits: '' }] }));
    expect(noMain).toMatchObject({ status: 'PARTIAL', reasons: ['No mainnet txid'] });
    const noReg = moduleStatus(def, results({ evidence: [{ id: 'E-2', env: 'mainnet', claim: '', txids: ['bb'], limits: '' }] }));
    expect(noReg).toMatchObject({ status: 'PARTIAL', reasons: ['No regtest evidence'] });
  });

  it('a selected suite with no results keeps it PARTIAL (a missing suite is not a pass)', () => {
    const m = moduleStatus({ ...def, tests: [...def.tests, { suite: 'sidecar' }] }, results());
    expect(m).toMatchObject({ status: 'PARTIAL', reasons: ['No sidecar test results'] });
  });

  it('an open HIGH finding or disabled execution keeps it PARTIAL', () => {
    const r = results({ findings: [{ id: 'F1', severity: 'HIGH', module: 'pay', status: 'open', title: 't' }] });
    expect(moduleStatus(def, r).status).toBe('PARTIAL');
    expect(moduleStatus({ ...def, execution_disabled: 'off' }, results()).status).toBe('PARTIAL');
  });

  it('unimplemented modules are ROADMAP whatever the results say', () => {
    expect(moduleStatus({ ...def, implemented: false }, results()).status).toBe('ROADMAP');
    expect(computeStatus(results()).find((m) => m.key === 'groups')?.status).toBe('ROADMAP');
  });
});
