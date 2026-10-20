import { canonicalHash } from './canonical.js';
import {
  CALLERS,
  SPEND_ACTIONS,
  type ActionType,
  type Check,
  type Decision,
  type EvaluationContext,
  type EvaluationDeps,
} from './types.js';

export const POLICY_VERSION = 'luteguard/1.0.0';
/** Must equal the sidecar's `approval::POLICY`. */
export const SIDECAR_POLICY = 'LUTE_STRICT/D-002';

const OPAQUE_REF = /^[A-Za-z0-9_-]{8,64}$/;

/** Operations each non-agent principal kind may request. Agents are limited by their grant. */
const ROLE_OPS: Record<Exclude<EvaluationContext['principal']['kind'], 'agent'>, ReadonlySet<ActionType>> = {
  owner: new Set<ActionType>([
    'SEND',
    'REQUEST',
    'CHECKOUT',
    'REFUND',
    'STREAM_CREATE',
    'STREAM_SETTLEMENT',
    'METER_SETTLEMENT',
    'SUBSCRIPTION_RENEWAL',
  ]),
  merchant: new Set<ActionType>(['REQUEST', 'CHECKOUT', 'REFUND', 'SUBSCRIPTION_RENEWAL']),
  user: new Set<ActionType>(['REQUEST', 'GROUP_CONTRIBUTION', 'METER_SESSION']),
  scheduler: new Set<ActionType>(['STREAM_SETTLEMENT', 'SUBSCRIPTION_RENEWAL', 'METER_SETTLEMENT']),
  system: new Set<ActionType>([]),
};

type Builder = (c: Omit<Check, 'policy'>) => void;

function collector(checks: Check[], policy: Check['policy']): Builder {
  return (c) => checks.push({ policy, ...c });
}

const pass = (check: string, explanation: string) =>
  ({ check, outcome: 'PASS', reason_code: 'OK', explanation }) as const;

function transactionPolicy(ctx: EvaluationContext, add: Builder): void {
  const { action } = ctx;
  add(
    action.network === ctx.configured_network
      ? pass('network_match', 'action network matches the configured network')
      : { check: 'network_match', outcome: 'FAIL', reason_code: 'WRONG_NETWORK', explanation: 'action network differs from the configured network' },
  );
  add(
    action.amount_zat > 0n
      ? pass('amount_positive', 'amount is positive')
      : { check: 'amount_positive', outcome: 'FAIL', reason_code: 'NON_POSITIVE_AMOUNT', explanation: 'amount must be greater than zero' },
  );

  const r = ctx.recipient;
  if (!r) {
    add({ check: 'recipient_inspected', outcome: 'UNKNOWN', reason_code: 'RECIPIENT_NOT_INSPECTED', explanation: 'the sidecar has not inspected the recipient' });
  } else if (r.verdict !== 'ALLOWED') {
    add({ check: 'recipient_allowed', outcome: 'FAIL', reason_code: `RECIPIENT_${r.verdict}`, explanation: 'recipient kind is not payable under LUTE_STRICT' });
  } else if (r.payable_pools.length === 0) {
    add({ check: 'recipient_allowed', outcome: 'FAIL', reason_code: 'RECIPIENT_NO_SHIELDED_POOL', explanation: 'recipient has no payable shielded pool' });
  } else {
    add(pass('recipient_allowed', 'recipient has a shielded receiver payable in a single pool'));
  }

  if (!SPEND_ACTIONS.has(action.type)) return;

  const p = ctx.proposal;
  if (!p) {
    add({ check: 'proposal_present', outcome: 'UNKNOWN', reason_code: 'NO_PROPOSAL', explanation: 'spend actions require a sidecar proposal' });
    return;
  }
  const s = p.summary;
  add(
    canonicalHash(s) === p.proposal_hash
      ? pass('params_hash_binding', 'proposal hash matches the inspected parameters')
      : { check: 'params_hash_binding', outcome: 'FAIL', reason_code: 'PROPOSAL_HASH_MISMATCH', explanation: 'proposal parameters changed after hashing' },
  );
  add(
    s.network === ctx.configured_network
      ? pass('proposal_network', 'proposal network matches')
      : { check: 'proposal_network', outcome: 'FAIL', reason_code: 'PROPOSAL_WRONG_NETWORK', explanation: 'proposal built for another network' },
  );
  add(
    s.policy === SIDECAR_POLICY
      ? pass('privacy_policy', 'proposal was built under LUTE_STRICT')
      : { check: 'privacy_policy', outcome: 'FAIL', reason_code: 'WEAKER_POLICY', explanation: 'proposal was built under a different privacy policy' },
  );
  const pools = new Set([...s.input_pools, ...s.output_pools, ...s.change_pools]);
  add(
    pools.has('transparent')
      ? { check: 'zero_transparent', outcome: 'FAIL', reason_code: 'TRANSPARENT_INVOLVED', explanation: 'proposal has transparent inputs, outputs or change' }
      : pass('zero_transparent', 'no transparent inputs, outputs or change'),
  );
  add(
    pools.has('orchard')
      ? { check: 'no_orchard_crossing', outcome: 'FAIL', reason_code: 'ORCHARD_INVOLVED', explanation: 'Orchard involvement is a value-revealing pool crossing after NU6.3 (D-002)' }
      : pass('no_orchard_crossing', 'no Orchard involvement'),
  );
  const shielded = [...pools].filter((x) => x === 'ironwood' || x === 'sapling');
  add(
    pools.size === 1 && shielded.length === 1
      ? pass('single_pool', 'inputs, outputs and change share one shielded pool')
      : { check: 'single_pool', outcome: 'FAIL', reason_code: 'CROSS_POOL', explanation: 'proposal does not stay within a single shielded pool' },
  );
  add(
    r && r.payable_pools.includes(s.recipient_pool as 'ironwood' | 'sapling')
      ? pass('recipient_pool', 'payment goes to a shielded receiver of the recipient')
      : { check: 'recipient_pool', outcome: 'FAIL', reason_code: 'RECIPIENT_POOL_MISMATCH', explanation: 'payment pool is not a payable shielded receiver of the recipient' },
  );
  add(
    BigInt(s.amount_zat) === action.amount_zat
      ? pass('amount_binding', 'proposal amount equals the action amount')
      : { check: 'amount_binding', outcome: 'FAIL', reason_code: 'AMOUNT_MISMATCH', explanation: 'proposal amount differs from the action amount' },
  );
  add(
    p.fee_source === 'library'
      ? pass('fee_from_library', 'fee computed by the library (ZIP-317)')
      : { check: 'fee_from_library', outcome: 'FAIL', reason_code: 'FEE_NOT_FROM_LIBRARY', explanation: 'fees must come from the library ZIP-317 implementation' },
  );
}

function metadataPolicy(ctx: EvaluationContext, add: Builder): void {
  const m = ctx.action.memo;
  if (!m) {
    add(pass('memo_format', 'no memo'));
  } else if (m.kind === 'lute_ref') {
    add(
      OPAQUE_REF.test(m.ref)
        ? pass('memo_format', 'memo is an opaque LUTE reference')
        : { check: 'memo_format', outcome: 'FAIL', reason_code: 'MEMO_NOT_OPAQUE', explanation: 'LUTE memo reference must be 8-64 base64url characters' },
    );
  } else {
    const typedByHuman = ctx.action.type === 'SEND' && (ctx.principal.kind === 'owner' || ctx.principal.kind === 'user');
    add(
      typedByHuman
        ? pass('memo_format', 'memo typed by the sender themselves')
        : { check: 'memo_format', outcome: 'FAIL', reason_code: 'MEMO_NOT_ALLOWED', explanation: 'free-text memos are only allowed for sends typed by a person' },
    );
  }
}

function authorizationPolicy(ctx: EvaluationContext, now: number, add: Builder): void {
  const { principal, action } = ctx;
  add(
    principal.authenticated
      ? pass('authenticated', 'principal is authenticated')
      : { check: 'authenticated', outcome: 'FAIL', reason_code: 'UNAUTHENTICATED', explanation: 'principal is not authenticated' },
  );
  add(
    now < action.expires_at
      ? pass('action_not_expired', 'action has not expired')
      : { check: 'action_not_expired', outcome: 'FAIL', reason_code: 'ACTION_EXPIRED', explanation: 'action has expired' },
  );

  if (principal.kind === 'agent') {
    const g = principal.grant;
    if (!g) {
      add({ check: 'agent_grant', outcome: 'FAIL', reason_code: 'NO_GRANT', explanation: 'agent has no grant' }); // A1
      return;
    }
    add(
      g.allowed_ops.includes(action.type)
        ? pass('operation_allowed', 'operation allowed by grant')
        : { check: 'operation_allowed', outcome: 'FAIL', reason_code: 'OP_NOT_GRANTED', explanation: 'operation not allowed by grant' },
    );
    add(
      g.revoked_at === undefined && now < g.expires_at
        ? pass('grant_active', 'grant is active')
        : { check: 'grant_active', outcome: 'FAIL', reason_code: g.revoked_at !== undefined ? 'GRANT_REVOKED' : 'GRANT_EXPIRED', explanation: 'grant is revoked or expired' }, // A4
    );
    add(
      action.amount_zat <= g.cap_per_tx_zat
        ? pass('grant_per_tx_cap', 'within per-transaction grant cap')
        : { check: 'grant_per_tx_cap', outcome: 'FAIL', reason_code: 'OVER_GRANT_PER_TX', explanation: 'amount exceeds the per-transaction grant cap' }, // A2
    );
    add(
      g.spent_zat + action.amount_zat <= g.cap_total_zat
        ? pass('grant_total_cap', 'within total grant budget')
        : { check: 'grant_total_cap', outcome: 'FAIL', reason_code: 'OVER_GRANT_TOTAL', explanation: 'amount exceeds the remaining grant budget' }, // A3
    );
    if (g.allowed_recipients) {
      add(
        action.recipient_ref !== undefined && g.allowed_recipients.includes(action.recipient_ref)
          ? pass('grant_recipient', 'recipient allowed by grant')
          : { check: 'grant_recipient', outcome: 'FAIL', reason_code: 'RECIPIENT_NOT_GRANTED', explanation: 'recipient not allowed by grant' }, // A5
      );
    }
  } else {
    add(
      ROLE_OPS[principal.kind].has(action.type)
        ? pass('operation_allowed', 'operation allowed for this role')
        : { check: 'operation_allowed', outcome: 'FAIL', reason_code: 'OP_NOT_ALLOWED', explanation: 'operation not allowed for this role' },
    );
  }

  if (SPEND_ACTIONS.has(action.type) && ctx.configured_network === 'main') {
    add(
      ctx.spend_authorization !== null
        ? pass('mainnet_spend_authorized', 'mainnet spend requires owner approval or mandate; present')
        : { check: 'mainnet_spend_authorized', outcome: 'FAIL', reason_code: 'NO_OWNER_AUTHORIZATION', explanation: 'mainnet spends require an owner approval or mandate' },
    );
  }
  // §13.3 "No mandate means no automated spending", on every network.
  if (SPEND_ACTIONS.has(action.type) && (principal.kind === 'agent' || principal.kind === 'scheduler')) {
    add(
      ctx.spend_authorization === 'mandate'
        ? pass('automated_spend_mandate', 'automated spend cites a mandate')
        : { check: 'automated_spend_mandate', outcome: 'FAIL', reason_code: 'NO_MANDATE', explanation: 'automated spends require an owner-signed mandate' },
    );
  }
}

function settlementPolicy(ctx: EvaluationContext, add: Builder): void {
  if (!SPEND_ACTIONS.has(ctx.action.type)) return;
  add(
    ctx.action.idempotency_key && ctx.action.idempotency_key.length > 0
      ? pass('idempotency_key', 'spend carries an idempotency key')
      : { check: 'idempotency_key', outcome: 'FAIL', reason_code: 'NO_IDEMPOTENCY_KEY', explanation: 'spends require an idempotency key' },
  );
}

function integrationPolicy(ctx: EvaluationContext, add: Builder): void {
  add(
    (CALLERS as readonly string[]).includes(ctx.caller)
      ? pass('caller_known', 'caller is a known Lute entry point')
      : { check: 'caller_known', outcome: 'FAIL', reason_code: 'UNKNOWN_CALLER', explanation: 'caller is not a known Lute entry point' },
  );
  add(
    ctx.via_execute_action
      ? pass('via_execute_action', 'evaluated inside executeAction()')
      : { check: 'via_execute_action', outcome: 'FAIL', reason_code: 'BYPASS_ATTEMPT', explanation: 'financial execution must go through executeAction()' },
  );
}

/**
 * Evaluates every applicable policy. Fail closed: the outcome is ALLOW only if every check is
 * PASS; UNKNOWN, UNSUPPORTED, UNVERIFIED and FAIL all deny. Never downgrades.
 */
export function evaluate(ctx: EvaluationContext, deps: EvaluationDeps): Decision {
  const now = deps.now();
  const checks: Check[] = [];
  transactionPolicy(ctx, collector(checks, 'TransactionPolicy'));
  metadataPolicy(ctx, collector(checks, 'MetadataPolicy'));
  authorizationPolicy(ctx, now, collector(checks, 'AuthorizationPolicy'));
  settlementPolicy(ctx, collector(checks, 'SettlementPolicy'));
  integrationPolicy(ctx, collector(checks, 'IntegrationPolicy'));

  const outcome = checks.length > 0 && checks.every((c) => c.outcome === 'PASS') ? 'ALLOW' : 'DENY';
  const params_hash =
    ctx.proposal?.proposal_hash ??
    canonicalHash({
      id: ctx.action.id,
      type: ctx.action.type,
      network: ctx.action.network,
      amount_zat: ctx.action.amount_zat.toString(),
      recipient_ref: ctx.action.recipient_ref ?? null,
      expires_at: ctx.action.expires_at,
    });
  return {
    decision_id: deps.newId(),
    action_id: ctx.action.id,
    policy_version: POLICY_VERSION,
    outcome,
    checks,
    params_hash,
    evaluated_at: now,
  };
}
