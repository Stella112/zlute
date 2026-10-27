/** LuteGuard types (mandate §18). All money is bigint zatoshi. */

export type Network = 'main' | 'test' | 'regtest';
export type Caller = 'web' | 'api' | 'sdk' | 'mcp' | 'scheduler' | 'worker';
export const CALLERS: readonly Caller[] = ['web', 'api', 'sdk', 'mcp', 'scheduler', 'worker'];

export type ActionType =
  | 'SEND'
  | 'REQUEST'
  | 'CHECKOUT'
  | 'REFUND'
  | 'GROUP_CONTRIBUTION'
  | 'STREAM_CREATE'
  | 'STREAM_SETTLEMENT'
  | 'METER_SESSION'
  | 'METER_SETTLEMENT'
  | 'SUBSCRIPTION_RENEWAL'
  | 'BATCH_PAYOUT'
  | 'AGENT_PAYMENT'
  | 'CROSSCHAIN_FUNDING';

/** Actions that spend from a Lute-operated account (they need a sidecar proposal). */
export const SPEND_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  'SEND',
  'REFUND',
  'STREAM_SETTLEMENT',
  'BATCH_PAYOUT',
  'METER_SETTLEMENT',
  'AGENT_PAYMENT',
  'CROSSCHAIN_FUNDING',
]);

/** Verdicts produced by the sidecar's `inspect` (services/wallet-sidecar/src/inspect.rs). */
export type InspectionVerdict =
  | 'ALLOWED'
  | 'DENIED_TRANSPARENT'
  | 'DENIED_TEX'
  | 'DENIED_SPROUT'
  | 'DENIED_NO_SHIELDED_RECEIVER'
  | 'DENIED_WRONG_NETWORK'
  | 'DENIED_INVALID';

export interface RecipientInspection {
  verdict: InspectionVerdict;
  kind: string | null;
  has_orchard: boolean;
  has_sapling: boolean;
  has_transparent: boolean;
  payable_pools: Array<'ironwood' | 'sapling'>;
}

/** The sidecar's proposal summary (services/wallet-sidecar/src/approval.rs `ProposalSummary`). */
export interface SidecarProposalSummary {
  proposal_id: string;
  account: string;
  network: string;
  recipient: string;
  recipient_pool: string;
  amount_zat: number;
  fee_zat: number;
  input_pools: string[];
  output_pools: string[];
  change_pools: string[];
  policy: string;
  memo_hash: string;
  created_at: number;
  expires_at: number;
  /** Batch payouts only (absent for a single payment): one line per recipient. */
  payments?: { recipient: string; recipient_pool: string; amount_zat: number; memo_hash: string }[];
}

export interface ProposalFacts {
  summary: SidecarProposalSummary;
  /** Hash the sidecar reported for the summary. LuteGuard recomputes and compares. */
  proposal_hash: string;
  /** Fees must come from the library's ZIP-317 implementation, never hardcoded. */
  fee_source: 'library' | 'other';
}

export interface AgentGrant {
  grant_id: string;
  allowed_ops: ActionType[];
  cap_total_zat: bigint;
  cap_per_tx_zat: bigint;
  spent_zat: bigint;
  /** Opaque recipient references (e.g. request ids) the agent may pay; absent = any. */
  allowed_recipients?: string[];
  expires_at: number;
  revoked_at?: number;
  mandate_id?: string;
}

export interface Principal {
  kind: 'user' | 'merchant' | 'owner' | 'agent' | 'scheduler' | 'system';
  id: string;
  authenticated: boolean;
  grant?: AgentGrant;
}

/**
 * `invoice_ref`: the reference an external payee put in its own invoice (ZIP-321 memo), so it can
 * match the payment. Short and character-restricted, so an agent cannot use it as a free-text
 * channel.
 */
export type MemoSpec = { kind: 'lute_ref'; ref: string } | { kind: 'user_typed' } | { kind: 'invoice_ref'; ref: string };

export interface ActionFacts {
  id: string;
  type: ActionType;
  network: Network;
  amount_zat: bigint;
  memo?: MemoSpec;
  idempotency_key?: string;
  expires_at: number;
  /** Server-resolved opaque reference of the recipient (request id, agreement id, …). */
  recipient_ref?: string;
}

export interface EvaluationContext {
  action: ActionFacts;
  configured_network: Network;
  caller: Caller | string;
  /** True only when evaluation is invoked from `executeAction()` (IntegrationPolicy). */
  via_execute_action: boolean;
  principal: Principal;
  recipient?: RecipientInspection;
  /** Batch payouts: one inspection per payment line, in order. */
  recipients?: RecipientInspection[];
  proposal?: ProposalFacts;
  /** How a mainnet spend is authorized; null when it is not. */
  spend_authorization: 'owner_approval' | 'mandate' | null;
}

export type CheckOutcome = 'PASS' | 'FAIL' | 'UNKNOWN' | 'UNSUPPORTED' | 'UNVERIFIED';

export interface Check {
  policy:
    | 'TransactionPolicy'
    | 'MetadataPolicy'
    | 'AuthorizationPolicy'
    | 'SettlementPolicy'
    | 'IntegrationPolicy';
  check: string;
  outcome: CheckOutcome;
  /** Stable machine code; never contains amounts, addresses, memos or personal data. */
  reason_code: string;
  explanation: string;
}

export interface Decision {
  decision_id: string;
  action_id: string;
  policy_version: string;
  outcome: 'ALLOW' | 'DENY';
  checks: Check[];
  params_hash: string;
  evaluated_at: number;
  evidence_ref?: string;
}

export interface EvaluationDeps {
  now: () => number;
  newId: () => string;
}
