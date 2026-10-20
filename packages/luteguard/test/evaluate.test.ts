import { describe, expect, it } from 'vitest';
import { canonicalHash } from '../src/canonical.js';
import { evaluate } from '../src/evaluate.js';
import {
  CALLERS,
  type Decision,
  type EvaluationContext,
  type RecipientInspection,
  type SidecarProposalSummary,
} from '../src/types.js';

const NOW = 1_800_000_000;
const deps = { now: () => NOW, newId: () => 'decision-1' };

const allowedRecipient: RecipientInspection = {
  verdict: 'ALLOWED',
  kind: 'unified',
  has_orchard: true,
  has_sapling: true,
  has_transparent: false,
  payable_pools: ['ironwood', 'sapling'],
};

function summary(over: Partial<SidecarProposalSummary> = {}): SidecarProposalSummary {
  return {
    proposal_id: 'p1',
    account: 'acct',
    network: 'main',
    recipient: 'u1recipient',
    recipient_pool: 'ironwood',
    amount_zat: 1_000_000,
    fee_zat: 10_000,
    input_pools: ['ironwood'],
    output_pools: ['ironwood'],
    change_pools: ['ironwood'],
    policy: 'LUTE_STRICT/D-002',
    memo_hash: '',
    created_at: NOW - 10,
    expires_at: NOW + 290,
    ...over,
  };
}

/** A fully valid owner SEND on mainnet with owner approval. */
function sendCtx(over: Partial<EvaluationContext> = {}, s = summary()): EvaluationContext {
  return {
    action: {
      id: 'act-1',
      type: 'SEND',
      network: 'main',
      amount_zat: 1_000_000n,
      idempotency_key: 'idem-1',
      expires_at: NOW + 300,
    },
    configured_network: 'main',
    caller: 'api',
    via_execute_action: true,
    principal: { kind: 'owner', id: 'owner', authenticated: true },
    recipient: allowedRecipient,
    proposal: { summary: s, proposal_hash: canonicalHash(s), fee_source: 'library' },
    spend_authorization: 'owner_approval',
    ...over,
  };
}

function failed(d: Decision): string[] {
  return d.checks.filter((c) => c.outcome !== 'PASS').map((c) => c.reason_code);
}

describe('LuteGuard: valid baseline', () => {
  it('allows a fully valid owner-approved shielded send', () => {
    const d = evaluate(sendCtx(), deps);
    expect(failed(d)).toEqual([]);
    expect(d.outcome).toBe('ALLOW');
    expect(d.params_hash).toBe(canonicalHash(summary()));
  });
});

describe('TransactionPolicy (W group, LuteGuard layer)', () => {
  it('W1 denies a transparent recipient', () => {
    const d = evaluate(sendCtx({ recipient: { ...allowedRecipient, verdict: 'DENIED_TRANSPARENT', payable_pools: [] } }), deps);
    expect(d.outcome).toBe('DENY');
    expect(failed(d)).toContain('RECIPIENT_DENIED_TRANSPARENT');
  });

  it('W2 denies a TEX recipient', () => {
    const d = evaluate(sendCtx({ recipient: { ...allowedRecipient, verdict: 'DENIED_TEX', payable_pools: [] } }), deps);
    expect(failed(d)).toContain('RECIPIENT_DENIED_TEX');
  });

  it('W3 denies a proposal that pays a transparent receiver of a UA', () => {
    const s = summary({ output_pools: ['transparent', 'ironwood'], recipient_pool: 'transparent' });
    const d = evaluate(sendCtx({ recipient: { ...allowedRecipient, has_transparent: true } }, s), deps);
    expect(failed(d)).toEqual(expect.arrayContaining(['TRANSPARENT_INVOLVED', 'RECIPIENT_POOL_MISMATCH']));
  });

  it('W5 denies transparent inputs', () => {
    const d = evaluate(sendCtx({}, summary({ input_pools: ['transparent', 'ironwood'] })), deps);
    expect(failed(d)).toContain('TRANSPARENT_INVOLVED');
  });

  it('W6 denies cross-pool proposals', () => {
    const d = evaluate(sendCtx({}, summary({ input_pools: ['sapling'], output_pools: ['ironwood'] })), deps);
    expect(failed(d)).toContain('CROSS_POOL');
  });

  it('D-002 denies Orchard involvement', () => {
    const d = evaluate(sendCtx({}, summary({ input_pools: ['orchard'] })), deps);
    expect(failed(d)).toContain('ORCHARD_INVOLVED');
  });

  it('W7 denies a weaker privacy policy', () => {
    const d = evaluate(sendCtx({}, summary({ policy: 'AllowRevealedAmounts' })), deps);
    expect(failed(d)).toContain('WEAKER_POLICY');
  });

  it('W8 denies parameters changed after hashing', () => {
    const s = summary();
    const hash = canonicalHash(s);
    const mutated = { ...s, recipient: 'u1attacker' };
    const d = evaluate(sendCtx({ proposal: { summary: mutated, proposal_hash: hash, fee_source: 'library' } }), deps);
    expect(failed(d)).toContain('PROPOSAL_HASH_MISMATCH');
  });

  it('W9 denies a wrong network (action and proposal)', () => {
    const d = evaluate(sendCtx({ configured_network: 'regtest' }), deps);
    expect(failed(d)).toEqual(expect.arrayContaining(['WRONG_NETWORK', 'PROPOSAL_WRONG_NETWORK']));
  });

  it('W11 denies a fee that did not come from the library', () => {
    const s = summary();
    const d = evaluate(sendCtx({ proposal: { summary: s, proposal_hash: canonicalHash(s), fee_source: 'other' } }), deps);
    expect(failed(d)).toContain('FEE_NOT_FROM_LIBRARY');
  });

  it('denies when the proposal amount differs from the action amount', () => {
    const d = evaluate(sendCtx({}, summary({ amount_zat: 999 })), deps);
    expect(failed(d)).toContain('AMOUNT_MISMATCH');
  });

  it('denies zero amounts', () => {
    const ctx = sendCtx();
    ctx.action.amount_zat = 0n;
    expect(failed(evaluate(ctx, deps))).toContain('NON_POSITIVE_AMOUNT');
  });
});

describe('fail closed', () => {
  it('missing recipient inspection is UNKNOWN and denies', () => {
    const { recipient: _omit, ...rest } = sendCtx();
    const d = evaluate(rest as EvaluationContext, deps);
    expect(d.outcome).toBe('DENY');
    expect(d.checks.find((c) => c.check === 'recipient_inspected')?.outcome).toBe('UNKNOWN');
  });

  it('a spend without a proposal is UNKNOWN and denies', () => {
    const { proposal: _omit, ...rest } = sendCtx();
    const d = evaluate(rest as EvaluationContext, deps);
    expect(d.outcome).toBe('DENY');
    expect(failed(d)).toContain('NO_PROPOSAL');
  });

  it('mainnet spend without owner approval or mandate denies', () => {
    expect(failed(evaluate(sendCtx({ spend_authorization: null }), deps))).toContain('NO_OWNER_AUTHORIZATION');
  });

  it('expired action denies', () => {
    const ctx = sendCtx();
    ctx.action.expires_at = NOW;
    expect(failed(evaluate(ctx, deps))).toContain('ACTION_EXPIRED');
  });

  it('missing idempotency key denies', () => {
    const ctx = sendCtx();
    delete ctx.action.idempotency_key;
    expect(failed(evaluate(ctx, deps))).toContain('NO_IDEMPOTENCY_KEY');
  });
});

describe('MetadataPolicy', () => {
  it('accepts an opaque LUTE reference memo', () => {
    const ctx = sendCtx();
    ctx.action.memo = { kind: 'lute_ref', ref: 'Ab3_x-9Zq1' };
    expect(evaluate(ctx, deps).outcome).toBe('ALLOW');
  });

  it('rejects a non-opaque LUTE reference', () => {
    const ctx = sendCtx();
    ctx.action.memo = { kind: 'lute_ref', ref: 'alice@example.com' };
    expect(failed(evaluate(ctx, deps))).toContain('MEMO_NOT_OPAQUE');
  });

  it('allows free-text memos only on sends typed by a person', () => {
    const ctx = agentCtx();
    ctx.action.memo = { kind: 'user_typed' };
    expect(failed(evaluate(ctx, deps))).toContain('MEMO_NOT_ALLOWED');
  });

  it('audit checks never contain the amount or the recipient address', () => {
    const d = evaluate(sendCtx({ recipient: { ...allowedRecipient, verdict: 'DENIED_TRANSPARENT', payable_pools: [] } }), deps);
    const text = JSON.stringify(d.checks);
    expect(text).not.toContain('1000000');
    expect(text).not.toContain('u1recipient');
  });
});

function agentCtx(): EvaluationContext {
  const s = summary({ amount_zat: 50_000 });
  const ctx = sendCtx({
    principal: {
      kind: 'agent',
      id: 'agent-1',
      authenticated: true,
      grant: {
        grant_id: 'g1',
        allowed_ops: ['AGENT_PAYMENT'],
        cap_total_zat: 200_000n,
        cap_per_tx_zat: 100_000n,
        spent_zat: 0n,
        allowed_recipients: ['req-1'],
        expires_at: NOW + 3600,
        mandate_id: 'm1',
      },
    },
    spend_authorization: 'mandate',
    caller: 'mcp',
  }, s);
  ctx.action.type = 'AGENT_PAYMENT';
  ctx.action.amount_zat = 50_000n;
  ctx.action.recipient_ref = 'req-1';
  return ctx;
}

describe('AuthorizationPolicy: agents (A group)', () => {
  it('A10 baseline: a payment inside the grant is allowed', () => {
    expect(failed(evaluate(agentCtx(), deps))).toEqual([]);
  });

  it('A1 no grant denies', () => {
    const ctx = agentCtx();
    delete ctx.principal.grant;
    expect(failed(evaluate(ctx, deps))).toContain('NO_GRANT');
  });

  it('A2 over per-tx cap denies', () => {
    const ctx = agentCtx();
    ctx.principal.grant!.cap_per_tx_zat = 49_999n;
    expect(failed(evaluate(ctx, deps))).toContain('OVER_GRANT_PER_TX');
  });

  it('A3 over total cap denies', () => {
    const ctx = agentCtx();
    ctx.principal.grant!.spent_zat = 160_000n;
    expect(failed(evaluate(ctx, deps))).toContain('OVER_GRANT_TOTAL');
  });

  it('A4 expired or revoked grant denies', () => {
    const expired = agentCtx();
    expired.principal.grant!.expires_at = NOW;
    expect(failed(evaluate(expired, deps))).toContain('GRANT_EXPIRED');
    const revoked = agentCtx();
    revoked.principal.grant!.revoked_at = NOW - 1;
    expect(failed(evaluate(revoked, deps))).toContain('GRANT_REVOKED');
  });

  it('A5 wrong recipient denies', () => {
    const ctx = agentCtx();
    ctx.action.recipient_ref = 'req-attacker';
    expect(failed(evaluate(ctx, deps))).toContain('RECIPIENT_NOT_GRANTED');
  });

  it('automated mainnet spend without a mandate denies', () => {
    const ctx = agentCtx();
    ctx.spend_authorization = 'owner_approval';
    expect(failed(evaluate(ctx, deps))).toContain('NO_MANDATE');
  });

  it('automated spend without a mandate denies on regtest too', () => {
    const ctx = agentCtx();
    ctx.configured_network = 'regtest';
    ctx.action.network = 'regtest';
    ctx.proposal!.summary.network = 'regtest';
    ctx.proposal!.proposal_hash = canonicalHash(ctx.proposal!.summary);
    ctx.spend_authorization = null;
    expect(failed(evaluate(ctx, deps))).toEqual(['NO_MANDATE']);
  });

  it('an operation outside the grant denies', () => {
    const ctx = agentCtx();
    ctx.action.type = 'REFUND';
    expect(failed(evaluate(ctx, deps))).toContain('OP_NOT_GRANTED');
  });
});

describe('IntegrationPolicy (A7)', () => {
  it.each(CALLERS)('caller %s gets the same DENY for the same unsafe action', (caller) => {
    const d = evaluate(
      sendCtx({ caller, recipient: { ...allowedRecipient, verdict: 'DENIED_TRANSPARENT', payable_pools: [] } }),
      deps,
    );
    expect(d.outcome).toBe('DENY');
    expect(failed(d)).toContain('RECIPIENT_DENIED_TRANSPARENT');
  });

  it('an unknown caller denies', () => {
    expect(failed(evaluate(sendCtx({ caller: 'cli-backdoor' }), deps))).toContain('UNKNOWN_CALLER');
  });

  it('evaluation outside executeAction() denies', () => {
    expect(failed(evaluate(sendCtx({ via_execute_action: false }), deps))).toContain('BYPASS_ATTEMPT');
  });
});

describe('roles', () => {
  it('an unauthenticated principal denies', () => {
    expect(failed(evaluate(sendCtx({ principal: { kind: 'owner', id: 'x', authenticated: false } }), deps))).toContain('UNAUTHENTICATED');
  });

  it('a plain user cannot SEND from Lute accounts', () => {
    expect(failed(evaluate(sendCtx({ principal: { kind: 'user', id: 'u', authenticated: true } }), deps))).toContain('OP_NOT_ALLOWED');
  });
});
