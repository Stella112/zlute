# API contracts

Codex and `apps/*` build against these contracts only. Never invent endpoints; request missing ones in `docs/QUESTIONS.md`.

## 1. Sidecar API (internal; only `apps/api` may call it)

Source: `services/wallet-sidecar/src/api.rs`. Started with:

```
lute-sidecar serve --listen 127.0.0.1:<port> --wallets <dir> --network <main|test|regtest> \
  --secret-file <hex secret file> [--owner-pub /opt/zlute/owner.pub]
```

- Binds **loopback only**; any other address is refused at startup (U12).
- One sidecar process serves the wallets of **one network**. A wallet on another network answers `404 UNKNOWN_WALLET`.
- Wallet names: `^[a-z0-9-]{1,32}$` (e.g. `merchant`, `payout`, `agent`).

### Authentication (every request)

| Header | Value |
|---|---|
| `X-Lute-Timestamp` | Unix seconds; must be within ±60 s of the sidecar clock |
| `X-Lute-Nonce` | 16–64 chars `[A-Za-z0-9_-]`, unique per request (replays rejected) |
| `X-Lute-Signature` | `hex(HMAC-SHA256(secret, S))` |

`S = METHOD + "\n" + PATH_AND_QUERY + "\n" + hex(SHA-256(raw body bytes)) + "\n" + TIMESTAMP + "\n" + NONCE` (empty body hashes the empty string).

Any authentication failure answers `401 {"error":"UNAUTHENTICATED"}` with no further detail. Bodies are limited to 64 KiB.

### Errors

`{"error": "<REASON_CODE>"}`. Responses never contain addresses, memos or keys in errors.

| Status | Codes |
|---|---|
| 403 | Recipient: `DENIED_TRANSPARENT`, `DENIED_TEX`, `DENIED_SPROUT`, `DENIED_NO_SHIELDED_RECEIVER`, `DENIED_WRONG_NETWORK`, `DENIED_INVALID`. Policy: `MULTI_STEP_PROPOSAL`, `TRANSPARENT_INPUT`, `TRANSPARENT_OUTPUT`, `ORCHARD_INVOLVED`, `CROSS_POOL`, `NO_SHIELDED_POOL`. Execution/approval: `UNKNOWN_PROPOSAL`, `PROPOSAL_EXPIRED`, `HASH_MISMATCH`, `NO_APPROVAL`, `APPROVAL_ALREADY_USED`, `APPROVAL_SIGNATURE_INVALID`, `ALREADY_EXECUTED`, `OVER_PER_TX_CAP`, `OVER_DAILY_CAP`. ZIP-321: `{"error":{...RequestError}}` |
| 404 | `UNKNOWN_WALLET`, `UNKNOWN_PROPOSAL` |
| 500 | `SIDECAR_ERROR` (details are not returned; they may contain addresses) |

### Endpoints

| Method & path | Body | 200 response |
|---|---|---|
| `POST /v1/inspect` | `{"address": string}` | `Inspection`: `{verdict, kind, has_orchard, has_sapling, has_transparent, payable_pools: ("ironwood"\|"sapling")[]}` |
| `POST /v1/zip321/build` | `{"address", "amount_zat": u64, "opaque_ref": 8–64 base64url}` | `{"uri": "zcash:…?amount=…&memo=…"}` (the URI exposes address, amount and memo: never put it in a public URL) |
| `POST /v1/wallets/{w}/address` | — | `{"address": string}`: next unused **shielded-only** UA (Orchard + Sapling receivers, no transparent; W4) |
| `GET /v1/wallets/{w}/balance` | — | `Balances`: `{chain_tip_height, fully_scanned_height, ironwood:{spendable_zat,total_zat}, orchard:{…}, sapling:{…}, transparent_total_zat}` |
| `POST /v1/wallets/{w}/sync` | — | `Balances` after syncing |
| `POST /v1/wallets/{w}/verify` | `{"txid": hex}` | `{txid, mined_height: u32\|null, confirmations, received: [{pool, value_zat, memo_text}]}` (only outputs this wallet received) |
| `POST /v1/wallets/{w}/requests/check` | `{"address", "amount_zat", "opaque_ref", "min_conf"}` | `RequestCheck`: `{status: "UNPAID"\|"PENDING"\|"PAID", matched_by: "address_and_memo"\|"address_only"\|null, requested_zat, received_confirmed_zat, received_pending_zat, overpaid_zat, txids}`. Only non-change outputs received at that exact address count. The memo is read by fetching each transaction (GetTransaction; see PRIVACY.md). Call `sync` first. |
| `POST /v1/wallets/{w}/proposals` | `{"to", "amount_zat": u64, "memo"?: string}` | `ProposalView`: `{proposal_hash, sign_message, summary: ProposalSummary}` |
| `GET /v1/wallets/{w}/proposals/{id}` | — | `ProposalView` |
| `POST /v1/wallets/{w}/proposals/{id}/approve` | `{"signature": hex}` (owner Ed25519 over `sign_message`) | `{"approved": true}` |
| `POST /v1/wallets/{w}/proposals/{id}/execute` | — | `{proposal_hash, status: "submitted"\|"released"\|"ambiguous", txid, broadcast: "accepted"\|"rejected"\|"ambiguous"\|null, detail}` |

`ProposalSummary` (hashed with canonical JSON, i.e. sorted keys and compact, SHA-256; identical in `packages/luteguard` `canonicalHash`):
`{proposal_id, account, network, recipient, recipient_pool, amount_zat, fee_zat, input_pools, output_pools, change_pools, policy: "LUTE_STRICT/D-002", memo_hash, created_at, expires_at}`.

Semantics that callers must respect:
- `submitted` means the light server **accepted** the transaction. It is not confirmed. Confirmation comes from `verify` (recipient side) or the payer wallet's sync.
- `ambiguous` means **do not retry**. The budget stays reserved; reconcile by txid.
- Caps (sidecar-enforced regardless of caller): 2,000,000 zat per transaction, 5,000,000 zat per UTC day per wallet. Proposal TTL is 300 s.
- An approval is one-use and bound to `(network, proposal_hash)`.
