# Threat model

Mandate §26. Written before the first mainnet spend. Claims are scoped: **"observer X cannot learn Y under assumption Z"**. Nothing here claims total anonymity, hidden IPs by default, invisible transaction existence, zero provider visibility, no timing correlation, or a formal proof of application privacy.

Status legend for each control: **enforced** (in code, tested), **planned** (not built), **limitation** (accepted, disclosed).

## System as built today (2026-10-21)

- **Sidecar** (Rust, librustzcash) on a shared VPS: the only component with wallet keys. Seeds sealed with XChaCha20-Poly1305 under per-wallet key files outside the wallet directories (root-only).
- **API** (`apps/api`, Fastify) and Postgres 16 on the same VPS. The API calls the sidecar over loopback with HMAC-authenticated requests.
- **Owner approval key** (Ed25519) on the owner's laptop only. The sidecar holds only the public key (D-009, D-010).
- **Light server:** zec.rocks (mainnet, TLS); Zaino (regtest, loopback).
- **Payers** use their own wallets (Zodl).

## Assets

| Asset | Where it lives | Protection |
|---|---|---|
| Wallet seeds / spending keys (merchant, payout, agent) | VPS, sealed `seed.enc` + `/opt/zlute/keys/*.kek` (0400) | Encrypted at rest; root on the VPS can read the key files (**limitation**: shared host, D-005) |
| Viewing keys (UFVK) | Derived inside the sidecar; never exported | No export path exists (U8, **enforced** by absence; test pending) |
| Owner approval key | Owner's laptop only | Never on the VPS; agents never read it (D-010) |
| Sidecar API secret | `/opt/zlute/keys/api.secret` | Root-only; loopback-only API |
| Recipient addresses, memos of Lute Actions | Postgres `*_enc` columns | AES-256-GCM at rest with `LUTE_DATA_KEY` (**not end-to-end**: the API process can decrypt) |
| Amounts, relationships, salary/contractor rates, group membership, subscription history, API usage, meter data, invoices, refunds | Postgres (amounts in clear for accounting) | Record-level access (404 for non-owners, U6); never in logs (U1/U9) |
| Authorization records (approvals, mandates, decisions) | Sidecar control DB; Postgres `privacy_decisions` (reason codes only) | One-use approvals; decisions carry no amounts or addresses |

## Observers

| Observer | Can learn | Cannot learn (assumptions) | Controls |
|---|---|---|---|
| Public Zcash chain observer | That shielded transactions exist; their timing, fee and size; pool-crossing values (none in Lute: single-pool rule) | Sender, recipient, amount, memo of a single-pool shielded payment (Zcash shielded protocol soundness; NU6.3 Ironwood) | Single shielded pool, zero transparent (D-002, **enforced** in sidecar + LuteGuard) |
| Zcash network observer | IPs relaying transactions, timing | Shielded contents | **limitation:** no Tor yet (PRIVACY.md) |
| **Light-wallet server operator** (zec.rocks) | VPS IP, sync timing, wallet birthdays, scan ranges, txids Lute looks up (`verify`/request checks), txids Lute submits | Which outputs belong to Lute beyond what it is told; keys; shielded amounts and memos (trial decryption is local) | Whole-range scanning; TLS; no transparent queries; **limitation** documented in PRIVACY.md |
| Lute application operator (= the owner) | Everything in the API DB and the sidecar | — | Custody disclosed (operator holds merchant/payout/agent keys) |
| DB administrator / DB dump | Actions' types, states, amounts, txids, timings | Recipient addresses and memos (encrypted) unless they also hold `LUTE_DATA_KEY` | Field encryption at rest |
| VPS co-tenants / hosting provider (root) | Potentially everything on the box, including key files | The owner approval key (not on the box) | Hot-wallet balance ≤ 0.1 ZEC; owner approval needed for every spend; caps 0.02/tx and 0.05/day in the sidecar (**limitation**, D-005) |
| Payer | What they paid, the request's address, amount and memo | Other requests' data (unique address and opaque ref per request) | Fresh address per request (W4) |
| Recipient (of a Lute payout) | Amount received, memo, that it came from a Lute wallet | Lute's other payments | Shielded outputs |
| Merchant | Their own invoices and receipts | Other merchants' data | Record-level access (planned for merchant role) |
| Group organizer / member | (planned) organizer sees contributions; members see own slot + total | — | Disclosed in UI (planned) |
| API service provider (meter) | Usage it delivered | Customer identity beyond the session | Minimal usage records (planned) |
| SDK app operator / AI agent / MCP operator | Only what its grant-scoped token returns | Keys, viewing keys, other users' data, memos | No route to the sidecar; grant caps; mandate required for automated spends (**enforced** in LuteGuard; MCP planned) |
| Cross-chain solver / bridge / confidential-intent operator | (not integrated) | — | Classifier only; execution disabled unless STRICT_PRIVATE_VERIFIED |
| Unauthorized third party | Nothing via the API (401/404) | — | Sessions (HttpOnly, Secure, SameSite=Strict), origin check, HMAC to the sidecar, loopback binds |

## Main attack paths and current answers

1. **Agent or co-tenant tries to spend.** Needs an approval signed by the owner key, which is not on the VPS. Every execute requires it. Caps hold even with a valid approval. A tampered `owner.pub` is the residual risk; its hash is recorded in D-010.
2. **Payment silently made less private** (transparent output, cross-pool, Orchard crossing). Denied twice: by LuteGuard before proposal approval, and by the sidecar before signing (W1–W7).
3. **Proposal swapped after approval.** The hash binds approvals; the sidecar re-derives the summary from the stored proposal at execute (W8, regtest evidence).
4. **Replay.** One-use approvals (W13); idempotency keys (F3); HMAC nonce cache (sidecar API).
5. **Ambiguous broadcast leads to double pay.** Never retried; the budget stays reserved (W16).
6. **Data leak through API, logs or errors.** Public views omit addresses and memos (U3); errors are generic (U4); logs are redacted (U9).
7. **Light-server surveillance.** Accepted and documented; Tor planned.

## Open items before claiming PROVEN for any module
- Independent review (not yet engaged; self-review only).
- U1 (log scan after e2e), U2 (fragment key never sent), U5 (no third-party requests), U8 (no viewing-key export path), U10/U11: need the web app.
- PRIVACY-MATRIX.md per feature, as modules are built.
