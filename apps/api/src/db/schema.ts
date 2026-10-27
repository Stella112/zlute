/** Drizzle mirror of schema.sql (the SQL file is authoritative). */
import { bigint, bigserial, boolean, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  wallet_prefix: text('wallet_prefix'),
  owner_pub: text('owner_pub'),
  browser_signed: boolean('browser_signed').notNull().default(false),
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
  grant_id: text('grant_id'),
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

export const paymentRequests = pgTable('payment_requests', {
  id: text('id').primaryKey(),
  owner_user_id: text('owner_user_id').notNull(),
  wallet: text('wallet').notNull(),
  network: text('network').notNull(),
  amount_zat: bigint('amount_zat', { mode: 'bigint' }).notNull(),
  address_enc: text('address_enc').notNull(),
  zip321_enc: text('zip321_enc').notNull(),
  details_ciphertext: text('details_ciphertext'),
  status: text('status').notNull(),
  received_zat: bigint('received_zat', { mode: 'bigint' }).notNull().default(0n),
  seen_zat: bigint('seen_zat', { mode: 'bigint' }).notNull().default(0n),
  matched_by: text('matched_by'),
  txids: jsonb('txids').notNull().default([]),
  expires_at: bigint('expires_at', { mode: 'number' }).notNull(),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
  updated_at: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const streamAgreements = pgTable('stream_agreements', {
  id: text('id').primaryKey(),
  owner_user_id: text('owner_user_id').notNull(),
  wallet: text('wallet').notNull(),
  network: text('network').notNull(),
  recipient_address_enc: text('recipient_address_enc').notNull(),
  total_zat: bigint('total_zat', { mode: 'bigint' }).notNull(),
  start_ts: bigint('start_ts', { mode: 'number' }).notNull(),
  end_ts: bigint('end_ts', { mode: 'number' }).notNull(),
  events: jsonb('events').notNull().default([]),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
  updated_at: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const streamSettlements = pgTable('stream_settlements', {
  stream_id: text('stream_id').notNull(),
  seq: integer('seq').notNull(),
  action_id: text('action_id').notNull(),
  amount_zat: bigint('amount_zat', { mode: 'bigint' }).notNull(),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const meterServices = pgTable('meter_services', {
  id: text('id').primaryKey(),
  owner_user_id: text('owner_user_id').notNull(),
  name: text('name').notNull(),
  wallet: text('wallet').notNull(),
  address_enc: text('address_enc').notNull(),
  price_per_call_zat: bigint('price_per_call_zat', { mode: 'bigint' }).notNull(),
  credit_limit_zat: bigint('credit_limit_zat', { mode: 'bigint' }).notNull(),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const agentGrants = pgTable('agent_grants', {
  id: text('id').primaryKey(),
  owner_user_id: text('owner_user_id').notNull(),
  agent_name: text('agent_name').notNull(),
  wallet: text('wallet').notNull(),
  network: text('network').notNull(),
  service_id: text('service_id').notNull(),
  mandate_id: text('mandate_id').notNull(),
  mandate_hash: text('mandate_hash').notNull(),
  cap_per_tx_zat: bigint('cap_per_tx_zat', { mode: 'bigint' }).notNull(),
  cap_total_zat: bigint('cap_total_zat', { mode: 'bigint' }).notNull(),
  expires_at: bigint('expires_at', { mode: 'number' }).notNull(),
  revoked_at: bigint('revoked_at', { mode: 'number' }),
  token_hash: text('token_hash').notNull(),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const meterSessions = pgTable('meter_sessions', {
  id: text('id').primaryKey(),
  grant_id: text('grant_id').notNull(),
  service_id: text('service_id').notNull(),
  calls: integer('calls').notNull().default(0),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
  updated_at: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const meterQuotes = pgTable('meter_quotes', {
  id: text('id').primaryKey(),
  session_id: text('session_id').notNull(),
  service_id: text('service_id').notNull(),
  pages: integer('pages').notNull(),
  amount_zat: bigint('amount_zat', { mode: 'bigint' }).notNull(),
  request_hash: text('request_hash').notNull(),
  expires_at: bigint('expires_at', { mode: 'number' }).notNull(),
  used_at: bigint('used_at', { mode: 'number' }),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const meterSettlements = pgTable('meter_settlements', {
  session_id: text('session_id').notNull(),
  seq: integer('seq').notNull(),
  action_id: text('action_id').notNull(),
  amount_zat: bigint('amount_zat', { mode: 'bigint' }).notNull(),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const signingKeys = pgTable('signing_keys', {
  id: text('id').primaryKey(),
  purpose: text('purpose').notNull(),
  public_key: text('public_key').notNull(),
  private_key_enc: text('private_key_enc').notNull(),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const orders = pgTable('orders', {
  id: text('id').primaryKey(),
  owner_user_id: text('owner_user_id').notNull(),
  request_id: text('request_id').notNull(),
  item_enc: text('item_enc').notNull(),
  amount_zat: bigint('amount_zat', { mode: 'bigint' }).notNull(),
  receipt_id: text('receipt_id'),
  receipt_json: text('receipt_json'),
  receipt_sig: text('receipt_sig'),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const orderRefunds = pgTable('order_refunds', {
  order_id: text('order_id').notNull(),
  seq: integer('seq').notNull(),
  action_id: text('action_id').notNull(),
  amount_zat: bigint('amount_zat', { mode: 'bigint' }).notNull(),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const subscriptionPlans = pgTable('subscription_plans', {
  id: text('id').primaryKey(),
  owner_user_id: text('owner_user_id').notNull(),
  name_enc: text('name_enc').notNull(),
  amount_zat: bigint('amount_zat', { mode: 'bigint' }).notNull(),
  period_s: bigint('period_s', { mode: 'number' }).notNull(),
  grace_s: bigint('grace_s', { mode: 'number' }).notNull(),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey(),
  plan_id: text('plan_id').notNull(),
  owner_user_id: text('owner_user_id').notNull(),
  label_enc: text('label_enc').notNull(),
  start_ts: bigint('start_ts', { mode: 'number' }).notNull(),
  cancelled_at: bigint('cancelled_at', { mode: 'number' }),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const subscriptionInvoices = pgTable('subscription_invoices', {
  subscription_id: text('subscription_id').notNull(),
  period_no: integer('period_no').notNull(),
  request_id: text('request_id').notNull(),
  period_start: bigint('period_start', { mode: 'number' }).notNull(),
  period_end: bigint('period_end', { mode: 'number' }).notNull(),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const paymentGroups = pgTable('payment_groups', {
  id: text('id').primaryKey(),
  owner_user_id: text('owner_user_id').notNull(),
  title_enc: text('title_enc').notNull(),
  total_zat: bigint('total_zat', { mode: 'bigint' }).notNull(),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export const groupMembers = pgTable('group_members', {
  group_id: text('group_id').notNull(),
  idx: integer('idx').notNull(),
  label_enc: text('label_enc').notNull(),
  share_zat: bigint('share_zat', { mode: 'bigint' }).notNull(),
  request_id: text('request_id').notNull(),
});
