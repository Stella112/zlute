/** Drizzle mirror of schema.sql (the SQL file is authoritative). */
import { bigint, bigserial, boolean, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  role: text('role').notNull(),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const sessions = pgTable('sessions', {
  token_hash: text('token_hash').primaryKey(),
  user_id: text('user_id').notNull(),
  expires_at: bigint('expires_at', { mode: 'number' }).notNull(),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const actions = pgTable('actions', {
  id: text('id').primaryKey(),
  owner_user_id: text('owner_user_id').notNull(),
  type: text('type').notNull(),
  network: text('network').notNull(),
  state: text('state').notNull(),
  amount_zat: bigint('amount_zat', { mode: 'bigint' }).notNull(),
  wallet: text('wallet'),
  recipient_address_enc: text('recipient_address_enc'),
  recipient_ref: text('recipient_ref'),
  memo_kind: text('memo_kind'),
  memo_ref: text('memo_ref'),
  memo_text_enc: text('memo_text_enc'),
  idempotency_key: text('idempotency_key').notNull(),
  expires_at: bigint('expires_at', { mode: 'number' }).notNull(),
  proposal_id: text('proposal_id'),
  proposal_hash: text('proposal_hash'),
  txid: text('txid'),
  broadcast_ambiguous: boolean('broadcast_ambiguous').notNull().default(false),
  last_decision_id: text('last_decision_id'),
  reject_reason: text('reject_reason'),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
  updated_at: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const actionTransitions = pgTable('action_transitions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  action_id: text('action_id').notNull(),
  from_state: text('from_state').notNull(),
  to_state: text('to_state').notNull(),
  actor: text('actor').notNull(),
  at: bigint('at', { mode: 'number' }).notNull(),
});

export const privacyDecisions = pgTable('privacy_decisions', {
  decision_id: text('decision_id').primaryKey(),
  action_id: text('action_id').notNull(),
  policy_version: text('policy_version').notNull(),
  outcome: text('outcome').notNull(),
  checks: jsonb('checks').notNull(),
  params_hash: text('params_hash').notNull(),
  evaluated_at: bigint('evaluated_at', { mode: 'number' }).notNull(),
});
