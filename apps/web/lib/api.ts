/** Same-origin calls to the Lute API (proxied by next.config.ts). The cookie is HttpOnly. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? `HTTP_${res.status}`);
  return json as T;
}

export const get = <T>(path: string) => call<T>('GET', path);
export const post = <T>(path: string, body?: unknown, headers?: Record<string, string>) => call<T>('POST', path, body, headers);
export const idemKey = (prefix: string) => `${prefix}-${crypto.randomUUID().replaceAll('-', '')}`;

// ---- response types (docs/API.md; only fields the UI uses) ----

export interface Me {
  username: string;
  role: 'owner' | 'merchant' | 'user';
  network: 'main' | 'test' | 'regtest';
  /** Self-serve accounts approve with a key held in their browser. */
  owner_pub: string | null;
  self_serve: boolean;
  /** Non-custodial: payouts are signed in this browser; Lute holds viewing keys only. */
  browser_signed?: boolean;
}

export interface PoolBalance {
  spendable_zat: number;
  total_zat: number;
}
export interface Balance {
  chain_tip_height: number;
  fully_scanned_height: number;
  ironwood: PoolBalance;
  orchard: PoolBalance;
  sapling: PoolBalance;
  transparent_total_zat: number;
}

export interface ActionRow {
  id: string;
  type: string;
  network: string;
  state: string;
  amount_zat: string;
  txid: string | null;
  reject_reason: string | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

export interface ProposalSummary {
  proposal_id: string;
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
}

export type ExecuteResult =
  | { state: 'AWAITING_AUTHORIZATION'; proposal_hash: string; sign_message: string; summary: ProposalSummary }
  | { state: 'REJECTED'; reasons: string[]; decision_id?: string }
  | { state: 'FAILED'; reason: string }
  | { state: 'SUBMITTED'; txid: string; ambiguous: boolean }
  | { state: string; unchanged?: boolean; txid?: string; reasons?: string[]; reason?: string };

export interface ActionResponse {
  action_id: string;
  result: ExecuteResult;
}

export interface Settlement {
  seq: number;
  action_id: string;
  amount_zat: string;
  state: string;
  txid: string | null;
}
export interface Stream {
  id: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'CANCELLED';
  server_time: number;
  start_ts: number;
  end_ts: number;
  rate_zat_per_s: string;
  contracted_zat: string;
  accrued_zat: string;
  pending_zat: string;
  confirmed_paid_zat: string;
  outstanding_zat: string;
  labels: { accrued: string; model: string };
  settlements: Settlement[];
}

export interface RequestRow {
  id: string;
  status: 'UNPAID' | 'PENDING' | 'PAID' | 'EXPIRED';
  amount_zat: string;
  received_zat: string;
  seen_zat: string;
  progress: 'OPEN' | 'PARTIAL' | 'CONFIRMING' | 'PAID' | 'EXPIRED';
  matched_by: string | null;
  txids: string[];
  expires_at: number;
  created_at: number;
}

export type ModuleStatus = 'PROVEN' | 'PARTIAL' | 'BLOCKED' | 'ROADMAP' | 'UNTESTED';
export interface ModuleReport {
  key: string;
  label: string;
  status: ModuleStatus;
  reasons: string[];
  tests: { passed: number; failed: number; skipped: number };
  failing: string[];
  evidence: { id: string; env: string; txids: string[] }[];
}
export interface PrivacyStatus {
  network: string;
  policy_version: string;
  run: { generated_at: string; commit: string; dirty: boolean; reviewed: boolean; suites: { name: string; passed: number; failed: number; skipped: number; missing?: boolean; source?: string }[] } | null;
  modules: ModuleReport[];
  evidence: { id: string; env: string; claim: string; txids: string[]; limits: string }[];
  findings: { id: string; severity: string; module: string; status: string; title: string }[];
  decisions: { total: number; allow: number; deny: number; recent_denies: { decision_id: string; action_id: string; policy_version: string; evaluated_at: number; reasons: { policy: string | null; reason_code: string }[] }[] };
}
