/**
 * Recoverable operations: an action left AUTHORIZED or PREPARING by a crash or restart (the API
 * died between the owner's approval and recording the result) is settled from the wallet sidecar's
 * own record of the spend, never by retrying it:
 * - submitted / ambiguous: the transaction was built and broadcast (or may have been) -> SUBMITTED
 *   with its txid, so confirmation tracking continues and nothing is paid twice;
 * - released / none: nothing was sent -> FAILED (RECOVERED_NOT_SENT); a new payment is a new action;
 * - reserved: the sidecar itself has not finished; left alone and reported.
 */
import { and, inArray, lt } from 'drizzle-orm';
import type { ActionState, SidecarResult } from '@lute/core';
import { actions } from './db/schema.js';
import type { Db, PgActionStore } from './db/store.js';

export interface SpendStatusSidecar {
  spendStatus(wallet: string, proposalId: string): Promise<SidecarResult<{ status: string; txid: string | null }>>;
}

export interface Recovered {
  action_id: string;
  from: ActionState;
  to: ActionState | 'UNCHANGED';
  spend: string;
}

/** Actions untouched for this long while AUTHORIZED/PREPARING are considered interrupted. */
export const INTERRUPTED_AFTER_S = 120;

export async function recoverInFlight(d: { db: Db; store: PgActionStore; sidecar: SpendStatusSidecar; now: () => number }): Promise<Recovered[]> {
  const stuck = await d.db
    .select({ id: actions.id, state: actions.state, wallet: actions.wallet, proposal_id: actions.proposal_id })
    .from(actions)
    .where(and(inArray(actions.state, ['AUTHORIZED', 'PREPARING']), lt(actions.updated_at, d.now() - INTERRUPTED_AFTER_S)));
  const out: Recovered[] = [];
  for (const a of stuck) {
    const from = a.state as ActionState;
    if (!a.wallet || !a.proposal_id) continue;
    let spend: string;
    let txid: string | null = null;
    try {
      const r = await d.sidecar.spendStatus(a.wallet, a.proposal_id);
      if (r.ok) {
        spend = r.value.status;
        txid = r.value.txid;
      } else if (r.code === 'UNKNOWN_PROPOSAL') spend = 'none';
      else continue;
    } catch {
      continue; // sidecar unreachable: try again on the next sweep
    }
    if (spend === 'reserved') {
      out.push({ action_id: a.id, from, to: 'UNCHANGED', spend });
      continue;
    }
    if (from === 'AUTHORIZED') await d.store.transition(a.id, 'AUTHORIZED', 'PREPARING', 'system');
    if ((spend === 'submitted' || spend === 'ambiguous') && txid) {
      await d.store.transition(a.id, 'PREPARING', 'SUBMITTED', 'system', { txid, broadcast_ambiguous: spend === 'ambiguous' });
      out.push({ action_id: a.id, from, to: 'SUBMITTED', spend });
    } else {
      await d.store.transition(a.id, 'PREPARING', 'FAILED', 'system', { reject_reason: 'RECOVERED_NOT_SENT' });
      out.push({ action_id: a.id, from, to: 'FAILED', spend });
    }
  }
  return out;
}
