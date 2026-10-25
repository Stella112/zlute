import { describe, expect, it } from 'vitest';
import { canonicalHash, CALLERS, type Decision, type Principal, type RecipientInspection, type SidecarProposalSummary } from '@lute/luteguard';
import {
  executeAction,
  IdempotencyMismatch,
  type ActionRecord,
  type ActionStore,
  type EngineDeps,
  type ExecuteOutcome,
  type ProposalView,
  type SidecarClient,
  type SidecarResult,
} from '../src/execute.js';
import { assertTransition, type ActionState } from '../src/state.js';

const NOW = 1_800_000_000;
const OWNER: Principal = { kind: 'owner', id: 'maris', authenticated: true };

class MemStore implements ActionStore {
  actions = new Map<string, ActionRecord>();
  decisions: Decision[] = [];
  transitions: Array<{ id: string; from: ActionState; to: ActionState; actor: string }> = [];
  async get(id: string) {
    const a = this.actions.get(id);
    return a ? { ...a } : undefined;
  }
  async transition(id: string, from: ActionState, to: ActionState, actor: string, patch: Partial<ActionRecord> = {}) {
    const a = this.actions.get(id);
    if (!a || a.state !== from) throw new Error('ConcurrentModification');
    assertTransition(from, to);
    const next = { ...a, ...patch, state: to };
    this.actions.set(id, next);
    this.transitions.push({ id, from, to, actor });
    return { ...next };
  }
  async saveDecision(d: Decision) {
    this.decisions.push(d);
  }
}

const shielded: RecipientInspection = {
  verdict: 'ALLOWED',
  kind: 'unified',
  has_orchard: true,
  has_sapling: true,
  has_transparent: false,
  payable_pools: ['ironwood', 'sapling'],
};

function summaryFor(amount: number, over: Partial<SidecarProposalSummary> = {}): SidecarProposalSummary {
  return {
    proposal_id: 'prop-1',
    account: 'acct',
    network: 'regtest',
    recipient: 'uregtest1recipient',
    recipient_pool: 'ironwood',
    amount_zat: amount,
    fee_zat: 10_000,
    input_pools: ['ironwood'],
    output_pools: ['ironwood'],
    change_pools: ['ironwood'],
    policy: 'LUTE_STRICT/D-002',
    memo_hash: '',
    created_at: NOW,
    expires_at: NOW + 300,
    ...over,
  };
}

class FakeSidecar implements SidecarClient {
  inspection: RecipientInspection = shielded;
  summaryOver: Partial<SidecarProposalSummary> = {};
  proposeResult?: SidecarResult<ProposalView>;
  approveResult: SidecarResult<true> = { ok: true, value: true };
  executeResult: SidecarResult<ExecuteOutcome> = {
    ok: true,
    value: { proposal_hash: 'h', status: 'submitted', txid: 'tx-1', broadcast: 'accepted' },
  };
  calls: string[] = [];
  async inspect() {
    this.calls.push('inspect');
    return this.inspection;
  }
  async propose(_w: string, req: { amount_zat: bigint }): Promise<SidecarResult<ProposalView>> {
    this.calls.push('propose');
    if (this.proposeResult) return this.proposeResult;
    const s = summaryFor(Number(req.amount_zat), this.summaryOver);
    const h = canonicalHash(s);
    return { ok: true, value: { proposal_hash: h, sign_message: `lute-approve-v1|regtest|${h}`, summary: s } };
  }
  async approve() {
    this.calls.push('approve');
    return this.approveResult;
  }
  async execute() {
    this.calls.push('execute');
    return this.executeResult;
  }
}

function setup(over: Partial<ActionRecord> = {}) {
  const store = new MemStore();
  const sidecar = new FakeSidecar();
  const a: ActionRecord = {
    id: 'act-1',
    type: 'SEND',
    network: 'regtest',
    state: 'CREATED',
    amount_zat: 1_000_000n,
    wallet: 'payout',
    recipient_address: 'uregtest1recipient',
    idempotency_key: 'idem-1',
    expires_at: NOW + 600,
    ...over,
  };
  store.actions.set(a.id, a);
  let n = 0;
  const deps: EngineDeps = { store, sidecar, configured_network: 'regtest', now: () => NOW, newId: () => `id-${++n}` };
  return { store, sidecar, deps };
}

const req = (extra: object = {}) => ({ actionId: 'act-1', principal: OWNER, caller: 'api' as const, idempotencyKey: 'idem-1', ...extra });

describe('executeAction', () => {
  it('stops at AWAITING_AUTHORIZATION with the message the owner signs', async () => {
    const { deps, store, sidecar } = setup();
    const r = await executeAction(deps, req());
    expect(r.state).toBe('AWAITING_AUTHORIZATION');
    if (r.state !== 'AWAITING_AUTHORIZATION') throw new Error();
    expect(r.sign_message).toBe(`lute-approve-v1|regtest|${r.proposal_hash}`);
    expect(store.decisions[0]?.outcome).toBe('ALLOW');
    expect(sidecar.calls).toEqual(['inspect', 'propose']);
  });

  it('with the owner signature it approves, executes and records SUBMITTED + txid', async () => {
    const { deps, store, sidecar } = setup();
    await executeAction(deps, req());
    const r = await executeAction(deps, req({ ownerSignature: 'sig' }));
    expect(r).toEqual({ state: 'SUBMITTED', txid: 'tx-1', ambiguous: false });
    expect(store.actions.get('act-1')?.txid).toBe('tx-1');
    expect(sidecar.calls).toEqual(['inspect', 'propose', 'approve', 'execute']);
    expect(store.transitions.map((t) => t.to)).toEqual(['VALIDATING', 'AWAITING_AUTHORIZATION', 'AUTHORIZED', 'PREPARING', 'SUBMITTED']);
  });

  it('W1: a transparent recipient is REJECTED by LuteGuard and never proposed', async () => {
    const { deps, store, sidecar } = setup();
    sidecar.inspection = { ...shielded, verdict: 'DENIED_TRANSPARENT', payable_pools: [] };
    const r = await executeAction(deps, req({ ownerSignature: 'sig' }));
    expect(r.state).toBe('REJECTED');
    expect(sidecar.calls).toEqual(['inspect']);
    expect(store.actions.get('act-1')?.state).toBe('REJECTED');
  });

  it('a sidecar policy denial is REJECTED with its reason code', async () => {
    const { deps, sidecar } = setup();
    sidecar.proposeResult = { ok: false, code: 'CROSS_POOL' };
    expect(await executeAction(deps, req())).toEqual({ state: 'REJECTED', reasons: ['CROSS_POOL'] });
  });

  it('a sidecar that errors before authorization leaves the action FAILED, not stuck in VALIDATING', async () => {
    const { deps, store, sidecar } = setup();
    sidecar.propose = async () => {
      throw new Error('sidecar error');
    };
    expect(await executeAction(deps, req())).toEqual({ state: 'FAILED', reason: 'SIDECAR_UNAVAILABLE' });
    expect((await store.get('act-1'))?.state).toBe('FAILED');
    expect(sidecar.calls).not.toContain('execute');
  });

  it('W6 at the LuteGuard layer: a cross-pool proposal is rejected even if the sidecar built it', async () => {
    const { deps, sidecar } = setup();
    sidecar.summaryOver = { input_pools: ['sapling'], output_pools: ['ironwood'] };
    const r = await executeAction(deps, req());
    expect(r.state).toBe('REJECTED');
    if (r.state === 'REJECTED') expect(r.reasons).toContain('CROSS_POOL');
  });

  it('W8: a proposal whose amount differs from the action is rejected', async () => {
    const { deps, sidecar } = setup();
    sidecar.summaryOver = { amount_zat: 999 };
    const r = await executeAction(deps, req());
    if (r.state !== 'REJECTED') throw new Error(r.state);
    expect(r.reasons).toContain('AMOUNT_MISMATCH');
  });

  it('a bad owner signature leaves the action awaiting and never executes', async () => {
    const { deps, store, sidecar } = setup();
    await executeAction(deps, req());
    sidecar.approveResult = { ok: false, code: 'APPROVAL_SIGNATURE_INVALID' };
    expect(await executeAction(deps, req({ ownerSignature: 'forged' }))).toEqual({ state: 'REJECTED', reasons: ['APPROVAL_SIGNATURE_INVALID'] });
    expect(store.actions.get('act-1')?.state).toBe('AWAITING_AUTHORIZATION');
    expect(sidecar.calls).not.toContain('execute');
  });

  it('W16: an ambiguous broadcast is SUBMITTED and flagged, never FAILED or retried', async () => {
    const { deps, store, sidecar } = setup();
    sidecar.executeResult = { ok: true, value: { proposal_hash: 'h', status: 'ambiguous', txid: 'tx-amb', broadcast: 'ambiguous' } };
    await executeAction(deps, req());
    expect(await executeAction(deps, req({ ownerSignature: 'sig' }))).toEqual({ state: 'SUBMITTED', txid: 'tx-amb', ambiguous: true });
    expect(store.actions.get('act-1')?.broadcast_ambiguous).toBe(true);
    expect(sidecar.calls.filter((c) => c === 'execute')).toHaveLength(1);
  });

  it('a released (rejected) broadcast is FAILED', async () => {
    const { deps, sidecar } = setup();
    sidecar.executeResult = { ok: true, value: { proposal_hash: 'h', status: 'released', txid: 'tx-x', broadcast: 'rejected' } };
    await executeAction(deps, req());
    expect(await executeAction(deps, req({ ownerSignature: 'sig' }))).toEqual({ state: 'FAILED', reason: 'BROADCAST_REJECTED' });
  });

  it('F3: replaying a submitted action has no side effects', async () => {
    const { deps, sidecar } = setup();
    await executeAction(deps, req());
    await executeAction(deps, req({ ownerSignature: 'sig' }));
    const before = sidecar.calls.length;
    expect(await executeAction(deps, req({ ownerSignature: 'sig' }))).toEqual({ state: 'SUBMITTED', unchanged: true });
    expect(sidecar.calls.length).toBe(before);
  });

  it('a different idempotency key is refused', async () => {
    const { deps } = setup();
    await expect(executeAction(deps, req({ idempotencyKey: 'other' }))).rejects.toThrow(IdempotencyMismatch);
  });

  it('F8: an expired action moves to EXPIRED and is never proposed', async () => {
    const { deps, store, sidecar } = setup({ expires_at: NOW });
    expect(await executeAction(deps, req())).toEqual({ state: 'FAILED', reason: 'ACTION_EXPIRED' });
    expect(store.actions.get('act-1')?.state).toBe('EXPIRED');
    expect(sidecar.calls).toEqual([]);
  });

  it('automated principals cannot spend without a mandate (fail closed)', async () => {
    const { deps, sidecar } = setup();
    const agent: Principal = {
      kind: 'agent',
      id: 'bot',
      authenticated: true,
      grant: { grant_id: 'g', allowed_ops: ['SEND'], cap_total_zat: 10n ** 9n, cap_per_tx_zat: 10n ** 9n, spent_zat: 0n, expires_at: NOW + 10 },
    };
    // Regtest: AuthorizationPolicy's mainnet check does not apply, but agents may not SEND.
    const r = await executeAction(deps, req({ principal: agent, caller: 'mcp' }));
    expect(r.state).toBe('REJECTED');
    expect(sidecar.calls).not.toContain('execute');
  });

  it.each(CALLERS)('A7: caller %s gets the same rejection for a transparent recipient', async (caller) => {
    const { deps, sidecar } = setup();
    sidecar.inspection = { ...shielded, verdict: 'DENIED_TRANSPARENT', payable_pools: [] };
    const r = await executeAction(deps, req({ caller }));
    expect(r.state).toBe('REJECTED');
    if (r.state === 'REJECTED') expect(r.reasons).toContain('RECIPIENT_DENIED_TRANSPARENT');
  });
});
