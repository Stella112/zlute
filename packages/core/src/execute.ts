import { canonicalHash, evaluate, type Caller, type Decision, type EvaluationContext, type MemoSpec, type Network, type Principal, type RecipientInspection, type SidecarProposalSummary, type ActionType, SPEND_ACTIONS } from '@lute/luteguard';
import type { ActionState } from './state.js';

/** An Action as persisted. Sensitive fields (recipient address, memo text) live only in the
 * store's encrypted columns and are never logged. */
export interface ActionRecord {
  id: string;
  type: ActionType;
  network: Network;
  state: ActionState;
  amount_zat: bigint;
  /** Lute-operated wallet that pays (spends only), e.g. "payout". */
  wallet?: string;
  /** Recipient address, resolved server-side (never taken from free text supplied by an agent). */
  recipient_address?: string;
  recipient_ref?: string;
  memo?: MemoSpec;
  /** Memo text sent on-chain (e.g. "LUTE:<ref>"), consistent with `memo`. */
  memo_text?: string;
  idempotency_key: string;
  expires_at: number;
  proposal_id?: string;
  proposal_hash?: string;
  txid?: string;
  broadcast_ambiguous?: boolean;
  last_decision_id?: string;
  reject_reason?: string;
}

export type Actor = 'user' | 'merchant' | 'owner' | `agent:${string}` | 'scheduler' | 'system';

export interface ActionStore {
  get(id: string): Promise<ActionRecord | undefined>;
  /** Atomic compare-and-set: applies `patch` and moves `from` → `to` only if the stored state is
   * still `from`; records the transition (timestamp, actor) in the same DB transaction.
   * Throws `ConcurrentModification` otherwise. Implementations call `assertTransition`. */
  transition(id: string, from: ActionState, to: ActionState, actor: Actor, patch?: Partial<ActionRecord>): Promise<ActionRecord>;
  saveDecision(d: Decision): Promise<void>;
}

export interface ProposalView {
  proposal_hash: string;
  sign_message: string;
  summary: SidecarProposalSummary;
}

export type SidecarResult<T> = { ok: true; value: T } | { ok: false; code: string };

export interface ExecuteOutcome {
  proposal_hash: string;
  status: 'submitted' | 'released' | 'ambiguous';
  txid: string | null;
  broadcast: 'accepted' | 'rejected' | 'ambiguous' | null;
}

/** The only route to the sidecar (docs/API.md §1). */
export interface SidecarClient {
  inspect(address: string): Promise<RecipientInspection>;
  propose(wallet: string, req: { to: string; amount_zat: bigint; memo?: string }): Promise<SidecarResult<ProposalView>>;
  approve(wallet: string, proposalId: string, signature: string): Promise<SidecarResult<true>>;
  execute(wallet: string, proposalId: string): Promise<SidecarResult<ExecuteOutcome>>;
}

export interface EngineDeps {
  store: ActionStore;
  sidecar: SidecarClient;
  configured_network: Network;
  now: () => number;
  newId: () => string;
}

export interface ExecuteRequest {
  actionId: string;
  principal: Principal;
  caller: Caller;
  idempotencyKey: string;
  /** Owner Ed25519 signature over the proposal's sign_message (from tools/lute-owner). */
  ownerSignature?: string;
}

export type ExecuteResult =
  | { state: 'REJECTED'; reasons: string[]; decision_id?: string }
  | { state: 'AWAITING_AUTHORIZATION'; proposal_hash: string; sign_message: string; summary: SidecarProposalSummary }
  | { state: 'SUBMITTED'; txid: string | null; ambiguous: boolean }
  | { state: 'FAILED'; reason: string }
  | { state: ActionState; unchanged: true };

export class IdempotencyMismatch extends Error {
  constructor() {
    super('idempotency key does not match this action');
  }
}

function actorOf(p: Principal): Actor {
  if (p.kind === 'agent') return `agent:${p.grant?.grant_id ?? p.id}`;
  return p.kind;
}

/** Spends are authorized by the owner's approval in the sidecar (D-009); automated spends
 * require a mandate, which this build does not implement, so they fail closed. */
function authorizationFor(p: Principal): EvaluationContext['spend_authorization'] {
  return p.kind === 'owner' ? 'owner_approval' : null;
}

/**
 * The single entry point that can lead to a sidecar execute (mandate §17). Every caller (web,
 * api, sdk, mcp, scheduler, worker) uses it. LuteGuard runs on the exact proposal the sidecar
 * built; the sidecar independently re-checks policy, approval, hash binding and caps.
 */
export async function executeAction(deps: EngineDeps, req: ExecuteRequest): Promise<ExecuteResult> {
  const { store, sidecar } = deps;
  const action = await store.get(req.actionId);
  if (!action) throw new Error('unknown action');
  if (action.idempotency_key !== req.idempotencyKey) throw new IdempotencyMismatch();
  const actor = actorOf(req.principal);

  if (!SPEND_ACTIONS.has(action.type)) {
    return { state: 'FAILED', reason: 'NOT_A_SPEND_ACTION' };
  }

  if (action.state === 'CREATED') {
    if (deps.now() >= action.expires_at) {
      await store.transition(action.id, 'CREATED', 'EXPIRED', actor);
      return { state: 'FAILED', reason: 'ACTION_EXPIRED' };
    }
    let a = await store.transition(action.id, 'CREATED', 'VALIDATING', actor);
    if (!a.wallet || !a.recipient_address) {
      await store.transition(a.id, 'VALIDATING', 'REJECTED', actor, { reject_reason: 'MISSING_PARAMETERS' });
      return { state: 'REJECTED', reasons: ['MISSING_PARAMETERS'] };
    }
    const recipient = await sidecar.inspect(a.recipient_address);
    let proposal: ProposalView | undefined;
    if (recipient.verdict === 'ALLOWED') {
      const p = await sidecar.propose(a.wallet, {
        to: a.recipient_address,
        amount_zat: a.amount_zat,
        ...(a.memo_text !== undefined ? { memo: a.memo_text } : {}),
      });
      if (!p.ok) {
        await store.transition(a.id, 'VALIDATING', 'REJECTED', actor, { reject_reason: p.code });
        return { state: 'REJECTED', reasons: [p.code] };
      }
      proposal = p.value;
    }
    const ctx: EvaluationContext = {
      action: {
        id: a.id,
        type: a.type,
        network: a.network,
        amount_zat: a.amount_zat,
        idempotency_key: a.idempotency_key,
        expires_at: a.expires_at,
        ...(a.memo ? { memo: a.memo } : {}),
        ...(a.recipient_ref ? { recipient_ref: a.recipient_ref } : {}),
      },
      configured_network: deps.configured_network,
      caller: req.caller,
      via_execute_action: true,
      principal: req.principal,
      recipient,
      ...(proposal ? { proposal: { summary: proposal.summary, proposal_hash: proposal.proposal_hash, fee_source: 'library' as const } } : {}),
      spend_authorization: authorizationFor(req.principal),
    };
    const decision = evaluate(ctx, { now: deps.now, newId: deps.newId });
    await store.saveDecision(decision);
    if (decision.outcome === 'DENY' || !proposal) {
      const reasons = decision.checks.filter((c) => c.outcome !== 'PASS').map((c) => c.reason_code);
      await store.transition(a.id, 'VALIDATING', 'REJECTED', actor, { last_decision_id: decision.decision_id, reject_reason: reasons.join(',') });
      return { state: 'REJECTED', reasons, decision_id: decision.decision_id };
    }
    // The hash LuteGuard evaluated must be the one the sidecar binds approvals to.
    if (canonicalHash(proposal.summary) !== proposal.proposal_hash) {
      await store.transition(a.id, 'VALIDATING', 'REJECTED', actor, { reject_reason: 'PROPOSAL_HASH_MISMATCH' });
      return { state: 'REJECTED', reasons: ['PROPOSAL_HASH_MISMATCH'] };
    }
    a = await store.transition(a.id, 'VALIDATING', 'AWAITING_AUTHORIZATION', actor, {
      proposal_id: proposal.summary.proposal_id,
      proposal_hash: proposal.proposal_hash,
      last_decision_id: decision.decision_id,
    });
    if (!req.ownerSignature) {
      return { state: 'AWAITING_AUTHORIZATION', proposal_hash: proposal.proposal_hash, sign_message: proposal.sign_message, summary: proposal.summary };
    }
    return authorizeAndExecute(deps, a, req.ownerSignature, actor);
  }

  if (action.state === 'AWAITING_AUTHORIZATION') {
    if (!req.ownerSignature) return { state: action.state, unchanged: true };
    return authorizeAndExecute(deps, action, req.ownerSignature, actor);
  }

  // Idempotent replay of an action already past authorization (or terminal): no side effects.
  return { state: action.state, unchanged: true };
}

async function authorizeAndExecute(deps: EngineDeps, a: ActionRecord, signature: string, actor: Actor): Promise<ExecuteResult> {
  const { store, sidecar } = deps;
  if (!a.wallet || !a.proposal_id) throw new Error('awaiting action without proposal');
  if (deps.now() >= a.expires_at) {
    await store.transition(a.id, 'AWAITING_AUTHORIZATION', 'EXPIRED', actor);
    return { state: 'FAILED', reason: 'ACTION_EXPIRED' };
  }
  const ap = await sidecar.approve(a.wallet, a.proposal_id, signature);
  if (!ap.ok) {
    // A bad signature leaves the action awaiting a valid one; expiry still applies.
    return { state: 'REJECTED', reasons: [ap.code] };
  }
  await store.transition(a.id, 'AWAITING_AUTHORIZATION', 'AUTHORIZED', actor);
  await store.transition(a.id, 'AUTHORIZED', 'PREPARING', actor);
  const ex = await sidecar.execute(a.wallet, a.proposal_id);
  if (!ex.ok) {
    await store.transition(a.id, 'PREPARING', 'FAILED', actor, { reject_reason: ex.code });
    return { state: 'FAILED', reason: ex.code };
  }
  const o = ex.value;
  if (o.status === 'released') {
    await store.transition(a.id, 'PREPARING', 'FAILED', actor, { reject_reason: 'BROADCAST_REJECTED' });
    return { state: 'FAILED', reason: 'BROADCAST_REJECTED' };
  }
  const ambiguous = o.status === 'ambiguous';
  await store.transition(a.id, 'PREPARING', 'SUBMITTED', actor, {
    ...(o.txid ? { txid: o.txid } : {}),
    broadcast_ambiguous: ambiguous,
  });
  return { state: 'SUBMITTED', txid: o.txid, ambiguous };
}
