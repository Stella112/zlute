/** Action state machine (mandate §17). Illegal transitions throw. */

export type ActionState =
  | 'CREATED'
  | 'VALIDATING'
  | 'AWAITING_AUTHORIZATION'
  | 'AUTHORIZED'
  | 'PREPARING'
  | 'SUBMITTED'
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'RECONCILED'
  | 'REJECTED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

export const TERMINAL: ReadonlySet<ActionState> = new Set(['RECONCILED', 'REJECTED', 'FAILED', 'EXPIRED', 'CANCELLED']);

const NEXT: Record<ActionState, readonly ActionState[]> = {
  CREATED: ['VALIDATING', 'EXPIRED', 'CANCELLED'],
  VALIDATING: ['AWAITING_AUTHORIZATION', 'REJECTED', 'FAILED', 'EXPIRED'],
  AWAITING_AUTHORIZATION: ['AUTHORIZED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  AUTHORIZED: ['PREPARING', 'EXPIRED', 'CANCELLED'],
  // PREPARING → SUBMITTED also covers an *ambiguous* broadcast (never assumed to have failed).
  PREPARING: ['SUBMITTED', 'FAILED'],
  SUBMITTED: ['PENDING_CONFIRMATION', 'FAILED'],
  PENDING_CONFIRMATION: ['CONFIRMED', 'FAILED'],
  CONFIRMED: ['RECONCILED'],
  RECONCILED: [],
  REJECTED: [],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export class IllegalTransition extends Error {
  constructor(
    readonly from: ActionState,
    readonly to: ActionState,
  ) {
    super(`illegal action transition ${from} -> ${to}`);
  }
}

export function assertTransition(from: ActionState, to: ActionState): void {
  if (!NEXT[from].includes(to)) throw new IllegalTransition(from, to);
}

export function canTransition(from: ActionState, to: ActionState): boolean {
  return NEXT[from].includes(to);
}
