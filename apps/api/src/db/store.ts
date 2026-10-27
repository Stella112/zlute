import { and, desc, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { assertTransition, type ActionRecord, type ActionState, type ActionStore, type Actor } from '@lute/core';
import type { Decision, MemoSpec } from '@lute/luteguard';
import type { FieldCipher } from '../crypto.js';
import { actions, actionTransitions, privacyDecisions } from './schema.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, any, any>;

export class ConcurrentModification extends Error {
  constructor() {
    super('action state changed concurrently');
  }
}

type Row = typeof actions.$inferSelect;

/** Fields the engine may patch during transitions; everything else is immutable after creation. */
const PATCHABLE = ['proposal_id', 'proposal_hash', 'txid', 'broadcast_ambiguous', 'last_decision_id', 'reject_reason'] as const;

export class PgActionStore implements ActionStore {
  constructor(
    private readonly db: Db,
    private readonly cipher: FieldCipher,
    private readonly now: () => number,
  ) {}

  private aad(id: string, field: string): string {
    return `lute-action|${id}|${field}`;
  }

  private toRecord(r: Row): ActionRecord {
    const rec: ActionRecord = {
      id: r.id,
      type: r.type as ActionRecord['type'],
      network: r.network as ActionRecord['network'],
      state: r.state as ActionState,
      amount_zat: r.amount_zat,
      idempotency_key: r.idempotency_key,
      expires_at: r.expires_at,
      broadcast_ambiguous: r.broadcast_ambiguous,
    };
    if (r.wallet) rec.wallet = r.wallet;
    if (r.recipient_address_enc) rec.recipient_address = this.cipher.decrypt(r.recipient_address_enc, this.aad(r.id, 'recipient'));
    if (r.recipient_ref) rec.recipient_ref = r.recipient_ref;
    if (r.memo_kind === 'lute_ref' && r.memo_ref) rec.memo = { kind: 'lute_ref', ref: r.memo_ref };
    if (r.memo_kind === 'user_typed') rec.memo = { kind: 'user_typed' };
    if (r.memo_kind === 'invoice_ref' && r.memo_ref) rec.memo = { kind: 'invoice_ref', ref: r.memo_ref };
    if (r.memo_text_enc) rec.memo_text = this.cipher.decrypt(r.memo_text_enc, this.aad(r.id, 'memo'));
    if (r.payments_enc) {
      const lines = JSON.parse(this.cipher.decrypt(r.payments_enc, this.aad(r.id, 'payments'))) as { to: string; amount_zat: string; memo_text?: string }[];
      rec.payments = lines.map((l) => ({ to: l.to, amount_zat: BigInt(l.amount_zat), ...(l.memo_text !== undefined ? { memo_text: l.memo_text } : {}) }));
    }
    if (r.proposal_id) rec.proposal_id = r.proposal_id;
    if (r.proposal_hash) rec.proposal_hash = r.proposal_hash;
    if (r.txid) rec.txid = r.txid;
    if (r.last_decision_id) rec.last_decision_id = r.last_decision_id;
    if (r.reject_reason) rec.reject_reason = r.reject_reason;
    return rec;
  }

  /** `grantId` marks an agent spend (budget accounting); owner actions have none. */
  async create(a: ActionRecord, ownerUserId: string, grantId?: string): Promise<ActionRecord> {
    const now = this.now();
    const memo: MemoSpec | undefined = a.memo;
    await this.db.insert(actions).values({
      id: a.id,
      owner_user_id: ownerUserId,
      type: a.type,
      network: a.network,
      state: 'CREATED',
      amount_zat: a.amount_zat,
      wallet: a.wallet ?? null,
      recipient_address_enc: a.recipient_address ? this.cipher.encrypt(a.recipient_address, this.aad(a.id, 'recipient')) : null,
      recipient_ref: a.recipient_ref ?? null,
      memo_kind: memo?.kind ?? null,
      memo_ref: memo?.kind === 'lute_ref' || memo?.kind === 'invoice_ref' ? memo.ref : null,
      memo_text_enc: a.memo_text ? this.cipher.encrypt(a.memo_text, this.aad(a.id, 'memo')) : null,
      // BatchPay lines (recipients, amounts, memos) are encrypted at rest like a single recipient.
      payments_enc: a.payments?.length
        ? this.cipher.encrypt(JSON.stringify(a.payments.map((l) => ({ to: l.to, amount_zat: l.amount_zat.toString(), ...(l.memo_text !== undefined ? { memo_text: l.memo_text } : {}) }))), this.aad(a.id, 'payments'))
        : null,
      idempotency_key: a.idempotency_key,
      expires_at: a.expires_at,
      grant_id: grantId ?? null,
      created_at: now,
      updated_at: now,
    });
    return (await this.get(a.id))!;
  }

  async get(id: string): Promise<ActionRecord | undefined> {
    const rows = await this.db.select().from(actions).where(eq(actions.id, id)).limit(1);
    return rows[0] ? this.toRecord(rows[0]) : undefined;
  }

  /** Record-level access (DisclosurePolicy): only the owning user sees the action. */
  async getForUser(id: string, userId: string): Promise<ActionRecord | undefined> {
    const rows = await this.db
      .select()
      .from(actions)
      .where(and(eq(actions.id, id), eq(actions.owner_user_id, userId)))
      .limit(1);
    return rows[0] ? this.toRecord(rows[0]) : undefined;
  }

  async findByIdempotency(userId: string, key: string): Promise<ActionRecord | undefined> {
    const rows = await this.db
      .select()
      .from(actions)
      .where(and(eq(actions.owner_user_id, userId), eq(actions.idempotency_key, key)))
      .limit(1);
    return rows[0] ? this.toRecord(rows[0]) : undefined;
  }

  async transition(id: string, from: ActionState, to: ActionState, actor: Actor, patch: Partial<ActionRecord> = {}): Promise<ActionRecord> {
    assertTransition(from, to);
    const set: Partial<Row> = { state: to, updated_at: this.now() };
    for (const k of PATCHABLE) {
      if (patch[k] !== undefined) (set as Record<string, unknown>)[k] = patch[k];
    }
    for (const k of Object.keys(patch)) {
      if (!(PATCHABLE as readonly string[]).includes(k)) throw new Error(`field ${k} is immutable`);
    }
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(actions)
        .set(set)
        .where(and(eq(actions.id, id), eq(actions.state, from)))
        .returning();
      if (!rows[0]) throw new ConcurrentModification();
      await tx.insert(actionTransitions).values({ action_id: id, from_state: from, to_state: to, actor, at: this.now() });
      return this.toRecord(rows[0]);
    });
  }

  async saveDecision(d: Decision): Promise<void> {
    await this.db.insert(privacyDecisions).values({
      decision_id: d.decision_id,
      action_id: d.action_id,
      policy_version: d.policy_version,
      outcome: d.outcome,
      checks: d.checks,
      params_hash: d.params_hash,
      evaluated_at: d.evaluated_at,
    });
  }

  async recentDecisions(limit: number) {
    return this.db.select().from(privacyDecisions).orderBy(desc(privacyDecisions.evaluated_at)).limit(limit);
  }
}
