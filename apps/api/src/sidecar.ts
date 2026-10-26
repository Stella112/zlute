/**
 * HMAC-authenticated client for the sidecar API (docs/API.md §1). apps/api is the only caller.
 * Signing string: METHOD\nPATH\nhex(sha256(body))\nTS\nNONCE, HMAC-SHA256 with the shared secret.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { ExecuteOutcome, ProposalView, SidecarClient, SidecarResult } from '@lute/core';
import type { RecipientInspection } from '@lute/luteguard';

export function signingString(method: string, path: string, body: string, ts: string, nonce: string): string {
  const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
  return `${method}\n${path}\n${bodyHash}\n${ts}\n${nonce}`;
}

export function hmacHex(secret: Buffer, s: string): string {
  return createHmac('sha256', secret).update(s, 'utf8').digest('hex');
}

export class SidecarError extends Error {}

export interface RequestCheck {
  status: 'UNPAID' | 'PENDING' | 'PAID';
  matched_by: 'address_and_memo' | 'address_only' | null;
  requested_zat: number;
  received_confirmed_zat: number;
  received_pending_zat: number;
  overpaid_zat: number;
  txids: string[];
}

export interface TxStatus {
  txid: string;
  known: boolean;
  mined_height: number | null;
  confirmations: number;
  expired_unmined: boolean;
}

/** Sidecar calls used by payment requests and streams (docs/API.md §1). */
export interface PoolBalance {
  spendable_zat: number;
  total_zat: number;
}

export interface WalletBalance {
  chain_tip_height: number;
  fully_scanned_height: number;
  ironwood: PoolBalance;
  orchard: PoolBalance;
  sapling: PoolBalance;
  transparent_total_zat: number;
}

export interface MandateStatus {
  mandate_id: string;
  mandate_hash: string;
  max_tx_zat: number;
  total_zat: number;
  committed_zat: number;
  remaining_zat: number;
  expires_at: number;
  allowed_recipients: number;
}

/** Creates a user's wallet bound to their approval key (self-serve sign-up). */
export interface WalletAdmin {
  createWallet(name: string, ownerPub: string): Promise<SidecarResult<{ name: string }>>;
}

/** Sidecar calls for loading and inspecting agent mandates. */
export interface MandateSidecar {
  loadMandate(wallet: string, mandateJson: string, signature: string): Promise<SidecarResult<MandateStatus>>;
  mandateStatus(wallet: string, mandateId: string): Promise<SidecarResult<MandateStatus>>;
}

export interface RequestSidecar {
  balance(wallet: string): Promise<WalletBalance>;
  txStatus(wallet: string, txid: string): Promise<TxStatus>;
  newAddress(wallet: string): Promise<string>;
  buildZip321(address: string, amount_zat: bigint, opaque_ref: string): Promise<string>;
  sync(wallet: string): Promise<void>;
  checkRequest(wallet: string, req: { address: string; amount_zat: bigint; opaque_ref: string; min_conf: number }): Promise<RequestCheck>;
}

export class HttpSidecarClient implements SidecarClient, RequestSidecar, MandateSidecar, WalletAdmin {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: Buffer,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    const host = new URL(baseUrl).hostname;
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
      throw new Error('the sidecar must be reached over loopback only');
    }
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    const raw = body === undefined ? '' : JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? Number(v) : v));
    const ts = String(this.now());
    const nonce = randomBytes(16).toString('base64url');
    const res = await this.fetchImpl(this.baseUrl + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-lute-timestamp': ts,
        'x-lute-nonce': nonce,
        'x-lute-signature': hmacHex(this.secret, signingString(method, path, raw, ts, nonce)),
      },
      ...(method === 'POST' ? { body: raw } : {}),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  private result<T>(r: { status: number; json: unknown }): SidecarResult<T> {
    if (r.status === 200) return { ok: true, value: r.json as T };
    const err = (r.json as { error?: unknown }).error;
    if (r.status === 401) throw new SidecarError('sidecar rejected our authentication');
    if (r.status >= 500) throw new SidecarError('sidecar error');
    return { ok: false, code: typeof err === 'string' ? err : 'SIDECAR_DENIED' };
  }

  async inspect(address: string): Promise<RecipientInspection> {
    const r = await this.call('POST', '/v1/inspect', { address });
    if (r.status !== 200) throw new SidecarError(`inspect failed (${r.status})`);
    return r.json as RecipientInspection;
  }

  async propose(wallet: string, req: { to: string; amount_zat: bigint; memo?: string }): Promise<SidecarResult<ProposalView>> {
    return this.result(await this.call('POST', `/v1/wallets/${encodeURIComponent(wallet)}/proposals`, req));
  }

  async approve(wallet: string, proposalId: string, signature: string): Promise<SidecarResult<true>> {
    const r = this.result<{ approved: boolean }>(
      await this.call('POST', `/v1/wallets/${encodeURIComponent(wallet)}/proposals/${encodeURIComponent(proposalId)}/approve`, { signature }),
    );
    return r.ok ? { ok: true, value: true } : r;
  }

  async execute(wallet: string, proposalId: string): Promise<SidecarResult<ExecuteOutcome>> {
    return this.result(await this.call('POST', `/v1/wallets/${encodeURIComponent(wallet)}/proposals/${encodeURIComponent(proposalId)}/execute`));
  }

  async executeMandate(wallet: string, proposalId: string, mandateId: string): Promise<SidecarResult<ExecuteOutcome>> {
    return this.result(
      await this.call('POST', `/v1/wallets/${encodeURIComponent(wallet)}/proposals/${encodeURIComponent(proposalId)}/execute-mandate`, { mandate_id: mandateId }),
    );
  }

  /** The sidecar verifies the owner's signature, wallet, network and §13.1 bounds itself. */
  async loadMandate(wallet: string, mandateJson: string, signature: string): Promise<SidecarResult<MandateStatus>> {
    return this.result(await this.call('POST', `/v1/wallets/${encodeURIComponent(wallet)}/mandates`, { mandate_json: mandateJson, signature }));
  }

  async mandateStatus(wallet: string, mandateId: string): Promise<SidecarResult<MandateStatus>> {
    return this.result(await this.call('GET', `/v1/wallets/${encodeURIComponent(wallet)}/mandates/${encodeURIComponent(mandateId)}`));
  }

  async createWallet(name: string, ownerPub: string): Promise<SidecarResult<{ name: string }>> {
    return this.result(await this.call('POST', '/v1/wallets', { name, owner_pub: ownerPub }));
  }

  async newAddress(wallet: string): Promise<string> {
    const r = await this.call('POST', `/v1/wallets/${encodeURIComponent(wallet)}/address`);
    if (r.status !== 200) throw new SidecarError(`address failed (${r.status})`);
    return (r.json as { address: string }).address;
  }

  async buildZip321(address: string, amount_zat: bigint, opaque_ref: string): Promise<string> {
    const r = await this.call('POST', '/v1/zip321/build', { address, amount_zat, opaque_ref });
    if (r.status !== 200) throw new SidecarError(`zip321 failed (${r.status})`);
    return (r.json as { uri: string }).uri;
  }

  async balance(wallet: string): Promise<WalletBalance> {
    const r = await this.call('GET', `/v1/wallets/${encodeURIComponent(wallet)}/balance`);
    if (r.status !== 200) throw new SidecarError(`balance failed (${r.status})`);
    return r.json as WalletBalance;
  }

  async sync(wallet: string): Promise<void> {
    const r = await this.call('POST', `/v1/wallets/${encodeURIComponent(wallet)}/sync`);
    if (r.status !== 200) throw new SidecarError(`sync failed (${r.status})`);
  }

  async checkRequest(wallet: string, req: { address: string; amount_zat: bigint; opaque_ref: string; min_conf: number }): Promise<RequestCheck> {
    const r = await this.call('POST', `/v1/wallets/${encodeURIComponent(wallet)}/requests/check`, req);
    if (r.status !== 200) throw new SidecarError(`request check failed (${r.status})`);
    return r.json as RequestCheck;
  }

  async txStatus(wallet: string, txid: string): Promise<TxStatus> {
    if (!/^[0-9a-f]{64}$/.test(txid)) throw new SidecarError('invalid txid');
    const r = await this.call('GET', `/v1/wallets/${encodeURIComponent(wallet)}/tx/${txid}`);
    if (r.status !== 200) throw new SidecarError(`tx status failed (${r.status})`);
    return r.json as TxStatus;
  }
}
