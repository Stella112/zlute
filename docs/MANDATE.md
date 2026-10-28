# Lute v3 — Final Canonical Engineering Mandate

> Saved verbatim in substance from the owner's message of 2026-10-20 so that every session and agent can read it. The owner (Maris, GitHub: Stella112) is the only one who may change it.

**Privacy-First Programmable Payments on Zcash · lead engineer + independent reviewer · ZECATHON 2026**

| | |
|---|---|
| Version | 3.0, final canonical. Supersedes v1.0 and v2.0. |
| Written | 2026-10-20 |
| Owner / decision maker | Maris (GitHub: Stella112) |
| Track | Shielded Payments |
| Network for the demo | **Zcash mainnet** (owner decision) |
| Development and adversarial test network | **Z3 regtest** |
| Deadline | **2026-10-28 23:59 UTC = 2026-10-29 00:59 WAT**. Internal target: **submitted by 2026-10-28 20:00 WAT**. |
| Product definition (WHAT) | `docs/LUTE_SPEC.md`, the owner's full product specification |
| This document (HOW) | Governs how Lute is built, verified and released. If it conflicts with the spec on *how*, this document wins. Log the conflict in `docs/DECISIONS.md`. |
| Status at start | New implementation. Nothing is assumed complete. |

> **The single most important rule: Lute's privacy claims must never exceed what its implementation and actual evidence establish.**

> Project-specific refinements made after this mandate are recorded in `docs/DECISIONS.md` (notably D-002: NU6.3 / Ironwood pool rule; D-005: hosting on the shared VPS).

---

# PART I — MISSION AND PRINCIPLES

## 1. Mission

Build LUTE: a privacy-first programmable payments platform on Zcash in which every financial operation flows through **one Action engine** and **one mandatory, fail-closed privacy and authorization gate (LuteGuard)**. All modules in §16 are in scope. Each module ships **enabled** only when it is proven with real evidence. Otherwise it is honestly marked PARTIAL, BLOCKED or ROADMAP, and its execution paths are disabled.

**What a judge must see:** real shielded **mainnet** ZEC payments; per-second stream accrual with a real shielded payout; an AI agent paying a metered service inside an enforced budget; LuteGuard **blocking** an unsafe operation; and a Privacy Center whose results come from real test runs.

## 2. Priority order (never reverse it to hit a milestone)
1. Privacy and confidentiality
2. Fund safety
3. Correct Zcash protocol integration
4. Real shielded transactions
5. Financial integrity
6. Authorization and access control
7. Reproducible tests
8. End-to-end functionality
9. Developer integrations (SDK, MCP)
10. User experience
11. Additional features
12. Visual polish

When functionality and privacy conflict, keep privacy. When ambition and correctness conflict, keep correctness. When the deadline and security conflict, **disable the unsafe module**. Never fake completion.

## 3. Concepts that must never be confused (state these in `docs/ARCHITECTURE.md`)
- A shielded payment is not complete application anonymity.
- A public light-wallet server does **not** give the same privacy as a self-operated full node.
- Confidential-intent execution is not private source-chain settlement.
- Streaming accrual is not enforceable streaming. Scheduled payouts are not trustless.
- A proposal is not an executed payment. Submitted is not confirmed. Confirmed is not "satisfies this invoice".
- A merchant receipt is a signed attestation, not a zero-knowledge proof.
- A spending-policy check is not native cryptographic enforcement.
- Database encryption is not end-to-end encryption.
- A passing test is not proof of universal security.
- Regtest proof is not mainnet proof, and mainnet proof is not production readiness.

---

# PART II — ANTI-HALLUCINATION, SCOPE AND SAFETY MANDATE

## 4. Never invent capabilities
Never invent: RPC methods, crate functions or exports, CLI flags, package names or versions, endpoints, config keys, transaction formats, viewing-key capabilities, network-upgrade behavior, fee values, cross-chain routes, cryptographic primitives, balances, txids, confirmations, test results, audits, API responses, deployed services, or hackathon requirements.

Before using an external capability: read the official docs **and** the installed version's source or docs.rs page. Then run a minimal isolated test. Put the reference (URL or `crate::path@version`) in a code comment above each Zcash-related call.

**Capability ledger** (`docs/CAPABILITIES.md`). Every external capability gets one status:
- **DOCUMENTED:** official documentation supports it
- **PROVEN:** exercised in this project with inspectable evidence
- **UNVERIFIED:** plausible, not established
- **BLOCKED:** a required condition fails or is unavailable
- **UNSUPPORTED:** the selected implementation does not provide it

DOCUMENTED is never reported as PROVEN. An UNVERIFIED dependency never becomes an implementation requirement without a ledger entry.

If something cannot be verified: record it in `docs/BLOCKERS.md` (what was tried, what is needed), stop that path, and continue with the next unblocked task. **Do not guess. Do not "temporarily mock it as real".**

## 5. No fictional product behavior
Never show or record: hardcoded live balances, fake txids, fabricated histories, pretend settlements or payouts, fictional merchant activity, fake privacy results, static success messages posing as execution, or fixtures presented as real transactions. Fixtures are allowed only in clearly labeled automated tests (`tests/fixtures/`, `__mocks__/`). The UI must have truthful **empty, disconnected, pending, failed, unavailable and signer-offline** states.

Fees are never hardcoded. Use the library's ZIP-317 implementation. (A Zebra docs page lists `MARGINAL_FEE = 1_000` zatoshis per logical action, which differs from older figures. Let the library decide.)

## 6. No scope expansion
Do not add: tokens, NFTs, trading or speculation, yield, smart contracts, other chains (beyond the gated cross-chain research), chatbots unrelated to financial execution, social feeds, custom bridges or liquidity contracts, novel cryptography, third-party analytics, or extra external providers. Prefer the simpler design when it meets the security and product requirements. Do not refactor working, tested code for style. New dependencies are justified in `docs/DECISIONS.md` (name, version, license, reason).

## 7. No security shortcuts
Never disable or bypass: authentication, authorization, LuteGuard, spending caps, receiver validation, privacy policy, transaction binding, replay protection, settlement verification, or access-control tests. A failing check is a defect to fix, not an obstacle.

## 8. Owner-only actions
Agents must never, without Maris's explicit authorization:
- broadcast any **mainnet** transaction (see §13 for the only authorization forms)
- import real seed phrases, or move real funds
- change spending caps
- expose any wallet or signer interface to the internet
- provision paid infrastructure
- make the repository public
- submit the hackathon entry
- publish logs that contain financial data

Regtest with disposable credentials is always allowed.

## 9. No routine clarifying questions
Do not reopen architectural decisions in Part III. Continue through stages without routine questions. Escalate to Maris (`docs/QUESTIONS.md`) only when a choice affects **money, privacy guarantees, or scope**. Otherwise choose the more private and more conservative option and log it in `docs/DECISIONS.md`.

---

# PART III — FINAL ARCHITECTURAL DECISIONS

These are final unless implementation evidence proves one impossible. If so, record the evidence in `docs/DECISIONS.md` and apply the stated fallback.

## 10. Wallet architecture
1. **Primary mainnet integration:** a Rust **wallet sidecar** (`services/wallet-sidecar`) built on pinned current `librustzcash` crates: `zcash_client_backend`, `zcash_client_sqlite`, `zcash_address`, `zcash_protocol`, `zip321`, `pczt` (if needed), `zcash_keys`. Only this component holds keys or signs.
2. **Sync backend:** a verified light-wallet server (lightwalletd-compatible gRPC) over **TLS with certificate verification**. Candidate: zec.rocks (zcash-devtool uses server alias `zecrocks`). Read the exact mainnet host:port from zcash-devtool's source or zec.rocks documentation; do not guess it. **No full mainnet node is required** (Z3 lists about 300 GB and a 24–72 h first sync).
3. **Network upgrade support:** verify the current active network upgrade (NU6.3, which the official site calls "the tenth major network upgrade for Zcash"; check whether it is the upgrade also referred to as "Ironwood", and its activation status) and confirm the pinned crates support receiving, spending, scanning, sync and transaction construction under it. Unsupported means BLOCKED, and the build stops until it is resolved.
4. **Customers** pay from their own user-controlled shielded wallet (Zodl) via ZIP-321 links or QR codes. Lute never touches payer keys.
5. **Lute-operated accounts** (in sidecar, isolated, encrypted at rest):
   - `merchant` receive and verify account(s)
   - `payout` hot account (stream settlements, refunds)
   - `agent` hot account (AgentGrant-limited)

   Each lives in **its own wallet database file and its own key file**. One wallet process with several accounts must not be described as multi-user non-custodial. Disclose operator custody of `payout` and `agent` in the UI and README.
6. **Regtest:** Z3 (Zebra + Zallet + optional Zaino) is the controlled dev and adversarial-test environment. The sidecar syncs from **Z3's Zaino** (gRPC `localhost:28137`, `--profile indexer`). Zallet in Z3 is used **only** as the regtest funding source and as an independent second wallet for tests. Verify the sidecar can run with regtest or local network parameters in the pinned crates. If it cannot, record it as BLOCKED and use Zallet RPC-based regtest tests for policy logic only.
7. **zcash-devtool** is **reference code** for how to use the crates. It is **not** an authorized live-money fallback. It may be used on regtest and for read-only mainnet comparison. Using it to sign mainnet transactions requires a new written owner decision.
8. **Fallback if the sidecar cannot sign on mainnet by the P1 deadline (§24):** escalate to Maris with the evidence. Do not switch to another signer silently.

## 11. Light-server privacy analysis (mandatory, `docs/PRIVACY.md` section "Sync backend")
Investigate in the pinned crates' source, then document as found:
- IP address and sync-timing metadata visible to the server
- Full-transaction lookups (whether fetching full transactions or memos by txid reveals which transactions belong to the wallet)
- Broadcast correlation (the server sees the IP that submits a transaction)
- Wallet birthday and sync-range patterns
- What the server cannot see (trial decryption is local; keys never leave the sidecar)
- Transport security (TLS, certificate validation)
- Tor: whether the pinned crates offer Tor support, how to enable it, and its limits. Enable it if it works within the timeline; otherwise list it as a limitation.
- Mitigations considered and adopted

Never write that the light-server setup equals full-node privacy.

## 12. Repository, stack and package architecture (final)
**Development machine:** Windows with **WSL2 (Ubuntu)**. All builds, Docker and scripts run inside WSL2. The repo lives on the WSL filesystem, not `/mnt/c`, for performance. *(Superseded for hosting by D-005: shared VPS + CI builds.)*

**Stack (pin every version in lockfiles):** Node.js LTS, pnpm workspaces, TypeScript strict, Rust stable (or the toolchain librustzcash requires), Docker Desktop with WSL2 integration, Docker Compose ≥ 2.24.4 (Z3 requirement), **PostgreSQL 16**, **Drizzle ORM** (one ORM only), **Fastify** + **Zod**, **Next.js (App Router) + React + Tailwind CSS**, **Vitest**, **Playwright**, `cargo test`, ESLint + Prettier, `cargo fmt` + `clippy`, **gitleaks** pre-commit.

```
lute/
  services/wallet-sidecar/   Rust. Keys, signing, sync, address inspection, ZIP-321, proposals, caps, approvals.
  packages/core/             TS. Domain types, Action state machine, accounting (bigint zatoshi),
                             modules/{send,requests,commerce,groups,streams,meter,subscriptions,crosschain}
  packages/luteguard/        TS. Policy engine (pure, deterministic). Separate package for ownership clarity.
  packages/sdk/              TS SDK over apps/api.
  apps/api/                  TS Fastify API + workers + Postgres access. The only caller of the sidecar.
  apps/web/                  Next.js dashboard, pay pages, Privacy Center.
  apps/mcp/                  MCP server (stdio), calls apps/api only.
  infrastructure/            docker-compose (postgres, api, web), Z3 integration notes, env templates.
  tests/                     unit/ integration/ e2e/ privacy/ fixtures/
  evidence/                  results.json (generated), tx/ (mainnet/regtest records, no secrets)
  docs/                      see §14
```
Do not create empty packages for appearance.

## 13. Financial authorization architecture (sidecar-enforced)
Spending authority exists **only** in the sidecar. Its rules are enforced there **independently** of the API and LuteGuard (defense in depth).

**13.1 Caps** (sidecar config file, owner-only. Changing them requires the owner key, §13.3):
- `max_tx_zat = 2_000_000` (0.02 ZEC)
- `daily_cap_zat = 5_000_000` (0.05 ZEC) per spending account
- warn if any hot account holds > 10_000_000 zat (0.1 ZEC)

**13.2 Proposal binding.** Execution is always two-step: `propose → approve → execute`. A proposal records: proposal_id, account/wallet id, network, recipient receiver (pool and encoded receiver), amount_zat, fee_zat, input pools, output pools (including change), privacy policy, memo hash, created_at, expires_at (TTL 5 min). `proposal_hash = SHA-256(canonical CBOR or canonical JSON of all fields)`.

**13.3 Approvals: authenticated, unforgeable, one-use.**
- The **owner key** is an Ed25519 keypair generated locally by Maris (`lute-sidecar owner init`). The private key stays on her machine, outside the repo and outside agent reach. It is separate from wallet keys.
- **Interactive owner approval (default for every mainnet broadcast):** the sidecar CLI shows the decoded proposal (truncated recipient, amount, fee, pools, policy, network, expiry). Maris types `approve <first 8 chars of proposal_hash>`. The sidecar records a one-use approval bound to `proposal_hash`.
- **Owner-signed mandate (the only form of automated mainnet spending):** a JSON mandate `{mandate_id, account, purpose: stream|refund|agent, max_tx_zat, total_zat, allowed_recipients?, expires_at, nonce}` signed with the owner key and loaded into the sidecar. Automated spends (stream payouts, refunds, agent payments) must cite a mandate. **No mandate means no automated spending.** Mandates cannot exceed §13.1 caps. Default expiry ≤ 48 h. There is no "unrestricted autopay" mode at all.
- **One-use and atomic:** each execute consumes its approval or reserves budget from its mandate inside a **single SQLite transaction in the sidecar's own control DB** (`reserve → sign → broadcast → settle-or-release`). Approval and nonce ids are unique and can never be reused. An ambiguous broadcast result (timeout) keeps the reservation and is reconciled by txid lookup. **Never blindly retry.**
- The sidecar re-checks, at execute: proposal not expired; hash matches; zero transparent inputs and outputs; single shielded pool (no cross-pool reveal); network as configured; caps and mandate remaining; approval unused.

**13.4 Who can call what.** The sidecar API accepts only requests from `apps/api`, authenticated with a per-install secret plus request signing (HMAC over method, path, body hash and timestamp, ±60 s, nonce cache). SDK, MCP, web and workers have no route to the sidecar. They all go through `apps/api` → `packages/core.executeAction()` → LuteGuard → sidecar.

## 14. Required documentation (keep accurate, update at milestones)
`README.md`, `docs/ARCHITECTURE.md`, `docs/ENVIRONMENT.md`, `docs/CAPABILITIES.md`, `docs/THREAT-MODEL.md`, `docs/PRIVACY.md`, `docs/PRIVACY-MATRIX.md`, `docs/PRIVACY-EVIDENCE.md`, `docs/FEATURE-STATUS.md`, `docs/BUILD-STATUS.md`, `docs/TASKS.md`, `docs/DECISIONS.md`, `docs/BLOCKERS.md`, `docs/QUESTIONS.md`, `docs/API.md` (contracts the reviewer builds against), `docs/ZCASH-INTEGRATION.md`, `docs/CROSSCHAIN-RESEARCH.md`, `docs/SDK.md`, `docs/MCP.md`, `docs/DEMO.md`, `docs/SUBMISSION.md`, `docs/reviews/` (the reviewer findings), `docs/AGENT-ROLES.md` (copy of Part V).

## 15. Local versus hosted architecture (decided)
- **Primary demo (and the video): everything runs locally** in WSL2. web (`localhost:3000`), api (`localhost:4000`), postgres, and sidecar (`127.0.0.1` only) via docker compose and a local sidecar binary. This is the configuration the evidence and the video come from. *(Owner changed hosting to the shared VPS; see D-005.)*
- **Optional hosted read-path (only after the freeze, only if time allows):** web and API deployed to a host Maris chooses (no paid infra without her approval). The local sidecar is **never** exposed. It connects **outbound only** to the hosted API over TLS WebSocket, authenticates with an Ed25519 signer key registered in the API, and pulls signing work. Every message is signed and carries a nonce and timestamp. The sidecar re-verifies every proposal and applies §13 locally (owner approval prompts still appear on Maris's machine). When the signer is not connected, the hosted UI shows **"Signer offline: payments unavailable"**. No tunnels (ngrok and the like), no port forwarding, no public RPC.
- If the hosted path is not completed and tested, it is not mentioned as working.

---

# PART IV — THE PRODUCT MODULES (HOW)

## 16. Scope (all preserved)
Send and Receive · Payment Requests and QR · Actions · Commerce and Refunds · Groups · Per-second Streams · Metered Billing · Subscriptions · Cross-Chain route research · LuteGuard · SDK · MCP · Privacy Center · Professional Dashboard. All share one execution engine and one privacy policy.

## 17. Action engine (`packages/core`)
**States:** `CREATED → VALIDATING → AWAITING_AUTHORIZATION → AUTHORIZED → PREPARING → SUBMITTED → PENDING_CONFIRMATION → CONFIRMED → RECONCILED`, terminal: `REJECTED | FAILED | EXPIRED | CANCELLED`. Typed state machine. Illegal transitions throw. Every transition is persisted with timestamp and actor (`user | merchant | owner | agent:<grantId> | scheduler | system`) inside a DB transaction.

**Types:** `SEND, REQUEST, CHECKOUT, REFUND, GROUP_CONTRIBUTION, STREAM_CREATE, STREAM_SETTLEMENT, METER_SESSION, METER_SETTLEMENT, SUBSCRIPTION_RENEWAL, AGENT_PAYMENT, CROSSCHAIN_FUNDING`.

**Action fields:** opaque id (128-bit random, base64url), type, version, network, privacy policy (`LUTE_STRICT`), asset (ZEC), amount_zat or pricing model, recipient constraints, authorization requirements, expires_at, idempotency key, state, settlement refs (txids), confirmation policy.

**Idempotency keys (DB unique constraints):**
- stream: `agreement_id + settlement_seq`
- subscription: `subscription_id + period_index`
- refund: `original_payment_id + refund_seq`
- meter: `session_id + event_seq` (usage) and `session_id + settlement_seq`
- checkout: `invoice_id + attempt`
- send: client-supplied UUID

A timeout never means "did not happen".

**One entry point:** `executeAction(actionId, principal, idempotencyKey)` is the only function that can lead to a sidecar `execute`. Every caller uses it: web, API, SDK, MCP, scheduler, workers.

## 18. LuteGuard (`packages/luteguard`)
Pure, deterministic, typed. `evaluate(ctx) → Decision {decision_id, action_id, policy_version, outcome: ALLOW|DENY, checks:[{policy, check, outcome, reason_code, explanation}], params_hash, evaluated_at, evidence_ref}`. Decisions are stored and shown in the Privacy Center. Audit records exclude amounts, addresses, memos and personal data (store hashes or ids only).

**Policies and required checks**
- **TransactionPolicy:** network matches; recipient inspected **by the sidecar** (`zcash_address`; never parse Zcash addresses in TypeScript); allowed recipient kinds: UA with an Orchard or Sapling receiver, or a Sapling address. Reject: transparent (P2PKH/P2SH), **TEX (ZIP-320)**, invalid, or wrong-network addresses. A UA that also has a transparent receiver is allowed **only** if the proposal pays the shielded receiver. The proposal must have zero transparent inputs and outputs and a single shielded pool for inputs, outputs and change (equivalent to `FullPrivacy`: "only allow fully-shielded transactions (involving a single shielded value pool)"). amount > 0. fee from the library. `params_hash == proposal_hash`. *(Refined for NU6.3 by D-002.)*
- **MetadataPolicy:** URLs carry only opaque ids plus a fragment key (§19.2); memos carry only `LUTE:<opaqueRef>` unless the user typed a memo themselves; no sensitive fields in logs, errors, notifications, browser storage, or telemetry. A logger wrapper drops the keys `memo, address, ua, email, name, description, note, ufvk, ivk, seed, key, amount` (amount is replaced by a bucket in non-audit logs).
- **DisclosurePolicy:** record-level access (owner, merchant, organizer, participant, subscriber, agent). Unauthorized access returns **404**. Viewing-key scope: account-wide viewing capability is never described as per-invoice.
- **AuthorizationPolicy:** authenticated principal; operation allowed; recipient allowed; per-action and total budget; expiry; revocation; owner approval or mandate required for mainnet spend.
- **AgreementPolicy:** stream rate, timeline and budget; pause and cancel; subscription period; meter price version and cap.
- **SettlementPolicy:** idempotency; replay; pending handling; confirmations ≥ `LUTE_MIN_CONF` (default 3 on mainnet, 1 on regtest); refund ≤ refundable; no SUBMITTED→PAID without confirmation evidence.
- **IntegrationPolicy:** caller ∈ {web, api, sdk, mcp, scheduler, worker}; all go through `executeAction()`; cross-chain adapter disabled unless the route is classified `STRICT_PRIVATE_VERIFIED`.

**Fail closed:** any check returning UNKNOWN / UNSUPPORTED / UNVERIFIED / FAILED means DENY. Missing data is never permission. Never downgrade.

**Binding:** if destination, amount, source account, fee, pools, policy or network changes after evaluation, re-propose and re-evaluate.

## 19. Module specifications

### 19.1 Send and Receive (permanent first-class features)
- **Receive:** fresh **shielded-only** UA per request (Orchard and/or Sapling receivers, **never** a transparent receiver). Note: Zallet's `z_getaddressforaccount` default includes a P2PKH receiver. The sidecar must request receiver types explicitly. QR, copy, incoming list, confirmations, balances per pool.
- **Send** (from Lute-operated accounts): recipient entry or QR → sidecar inspect → amount (decimal ZEC input converted exactly to zatoshi; reject more than 8 decimals) → proposal → LuteGuard decision shown → owner approval or mandate → broadcast → confirmations → activity. External wallets send to Lute via §19.2.

### 19.2 Payment requests, links and QR
- Request = opaque id + per-request 256-bit key K. Private details (label, description, merchant line items) are encrypted **in the browser** with K (XChaCha20-Poly1305, libsodium). The server stores only ciphertext.
- Share link: `https://<host>/r/<opaqueId>#k=<base64url(K)>`. The fragment never reaches the server (Playwright test U2).
- ZIP-321 URI built in the sidecar with the `zip321` crate (`POST /v1/zip321/build`): `zcash:<shielded UA>?amount=<ZEC>&memo=<base64url "LUTE:<opaqueRef>">`. The ZIP-321 URI exposes address, amount and memo to anyone who sees it. It is shown only on the pay page after decryption, never put in a public URL.
- **Verification:** a received note to that request's unique address **and** memo `LUTE:<opaqueRef>` (or address-only if the memo is absent; record which), value ≥ amount, confirmations ≥ min. Overpayment is recorded. Underpayment stays PENDING with the received amount. Parse and validation tests cover invalid encodings, precision, conflicting parameters, unsupported required parameters, and memo size (512 bytes).

### 19.3 Commerce, receipts and refunds
- Invoice = request + `merchant_id`, total_zat, expires_at.
- Receipt: `{invoice_ref, amount_zat, txid, confirmations, paid_at, refund_eligible}` signed with the merchant's Ed25519 key. It is delivered encrypted with the same fragment-key method. UI wording: "Merchant-signed attestation, not a zero-knowledge proof."
- Refund: the customer submits the receipt plus a fresh shielded UA. LuteGuard checks the signature, refundable remainder, shielded address, and no duplicate. The refund is a **new** shielded payment from `payout` (owner approval or refund mandate), linked to the invoice. It is never "reversed".

### 19.4 Groups
Organizer sets target_zat, N slots, expiry and recipient account. Each slot gets its own request (own address, own opaqueRef). Visibility: organizer sees per-slot status and amount; participant sees own slot plus total progress; public sees nothing. UI discloses: "The organizer can see each contribution." No organizer-blind claims.

### 19.5 Streams (core differentiator)
- Agreement: payer = `payout` account, recipient shielded UA, `total_zat`, `start_ts`, `end_ts` (server-authoritative unix seconds), `settlement_interval_s` (default 3600, demo 120), pause and cancel log, `mandate_id`.
- **Accrual (bigint, deterministic):** `active_elapsed = Σ active intervals clamped to [start,end]`, `accrued = floor(total_zat * active_elapsed / (end - start))`. It is always ≤ total_zat and monotonic. The remainder is paid at the end, so the final accrued amount equals total_zat exactly.
- Fields kept separate: contracted total, accrued, authorized, pending, confirmed paid, outstanding, wallet-spendable (never mixed).
- Settlement worker: `due = accrued − confirmed − pending`. If `due ≥ LUTE_MIN_PAYOUT_ZAT` (default 100_000), create a `STREAM_SETTLEMENT` Action via `executeAction()` under the stream's mandate. Restart-safe via the idempotency key. Insufficient funds or an expired mandate → state `OWED`, never `PAID`.
- The UI counter is visualization only, labeled "Earned (accounting), not wallet funds".
- README: "Payer-controlled. Not trustless. Payouts stop if the payer stops authorizing." Payment-channel research is ROADMAP only and lives in a separate doc. No channel cryptography ships.

### 19.6 Metered billing
- Two modes for the hackathon: **per-request** (event-based) and **per-second** (time-based).
- Provider registers a service (`unit_price_zat`, `price_version`) and receives an HMAC secret.
- Session: the customer chooses `cap_zat` and `expires_at` and **prepays the cap** to the provider's receive account through a §19.2 request (a real shielded payment). The session becomes ACTIVE only after verification. At session end, the unused balance is refunded via §19.3 refund logic (non-custodial for the customer, no auto-debit).
- Usage events: `{session_id, event_seq (monotonic), units, ts, price_version}` + header `X-Lute-Signature: HMAC-SHA256(secret, canonical_json)`. Reject: bad signature, duplicate or out-of-order event_seq, ts outside ±300 s, price_version mismatch, or a charge over cap. At cap, the session stops.
- Demo service in `apps/api`: `/demo-service/*`, a "paid AI-style API" charging per call. It must not store request bodies.
- Store minimal usage: counts and totals, not contents.

### 19.7 Subscriptions
Plan: `price_zat`, `period_s`. Each period generates a renewal request (§19.2). The entitlement is active until `paid_period_end`. Each period requires customer payment. UI: "You approve each renewal." No auto-debit, no custodial autopay.

### 19.8 Agent payments, SDK and MCP
- **AgentGrant** (DB): `{grant_id, agent_name, allowed_ops[], cap_total_zat, cap_per_tx_zat, allowed_recipients[]?, expires_at, revoked_at, spent_zat, mandate_id}`. Created by the owner in the UI and backed by an owner-signed sidecar mandate (§13.3). Budget reservation is atomic in both the API DB and the sidecar.
- **MCP** (stdio, `@modelcontextprotocol/sdk`). Exact tool names, each backed by real functionality or absent: `lute_get_wallet_status`, `lute_create_payment_request`, `lute_get_action_status`, `lute_create_stream_proposal`, `lute_get_stream_earnings`, `lute_create_meter_session`, `lute_get_meter_session`, `lute_propose_settlement`, `lute_verify_settlement`, `lute_privacy_check`, `lute_pay_request` (pays a Lute request from the `agent` account within an active grant). Read-only and proposals are the default. Authenticates with a grant-scoped token. Tool responses never contain keys, viewing keys, other users' data, or raw memos. Defend against prompt injection (tool parameters are validated by Zod; recipients are resolved server-side from the request id, never taken from free text).
- **SDK** namespaces, only where backed: `payments, requests, actions, commerce, groups, streams, meter, subscriptions, settlements, privacy`. `crosschain` exposes classification only. Typed I/O, explicit network, structured errors, idempotency, no embedded secrets. **SDK acceptance:** an example app in `packages/sdk/examples/` creates a real request, checks privacy, coordinates execution, retrieves status, verifies settlement, and gets a correct DENY for an unsafe operation. It also reads a stream's separate accrued and settled balances.

### 19.9 Cross-chain (research-gated)
- **Route classifier** (always built, in LuteGuard). Classes can combine: `STRICT_PRIVATE_VERIFIED, INTERMEDIATE_CONFIDENTIAL_ONLY, PUBLIC_SOURCE_EXPOSURE, PUBLIC_DESTINATION_EXPOSURE, TRANSPARENT_ZCASH_HOP, PROVIDER_VISIBLE, UNKNOWN, UNSUPPORTED`.
- **Probe** NEAR Intents (1Click API) and NEAR Confidential Intents docs: supported assets, ZEC support, deposit and withdrawal address types, custody, solver and provider visibility, quotes, refunds, failure recovery. Record raw non-secret findings in `docs/CROSSCHAIN-RESEARCH.md`. If auth (JWT or API key) is required and unavailable, that's BLOCKED.
- Execution is enabled only for a route classified `STRICT_PRIVATE_VERIFIED` with tests passing. A route with a public source chain is never "fully private". Expected honest outcome: execution disabled, classifier shown working in the Privacy Center. No custom bridge, no fabricated quotes.

### 19.10 Dashboard and Privacy Center
- **Design:** near-black background, accent violet `#7835FF`, dark neutral surfaces, subtle borders, clean sans serif, restrained motion, accessible contrast. Fonts are bundled locally (no external font CDN). No fake stats, no neon.
- **Navigation (desktop):** Overview, Send, Receive, Requests, Streams, Meter, Subscriptions, Groups, Commerce, Actions, Cross-Chain, Activity, Developers, Privacy Center, Settings. **Mobile:** Home, Send, Receive, Activity, More.
- **Overview:** wallet card (confirmed balance, pending, signer and wallet connection, network, privacy status) with buttons **Send | Receive | Request | Start Stream**; summary cards (stream earnings, active meter sessions, subscriptions, recent activity); panels (active streams, obligations, invoices, collections, privacy verification). Only real data, with truthful empty states.
- **Privacy Center:** reads `evidence/results.json` (generated by `pnpm test:evidence`) and stored LuteGuard decisions and the reviewer findings. Shows per-module status computed by §23, policy version, last run (commit and time), recent DENY decisions with reason codes, open findings, disabled capabilities, and known limitations. No results means **UNTESTED**. Never hardcoded.
- **Unfinished or unsafe modules:** execution disabled (feature flag `LUTE_FEATURE_<NAME>=false`), routes return 404 or 503, SDK and MCP methods absent, UI clearly marked "Not available in this build".

### 19.11 Data model and storage (Postgres via Drizzle)
Entities (create only as modules are built): `users, sessions, wallet_connections, actions, action_transitions, payment_requests, settlements, invoices, receipts, refunds, group_collections, contributions, stream_agreements, stream_checkpoints, meter_services, meter_sessions, meter_usage_events, subscription_plans, subscription_periods, agent_grants, privacy_decisions, crosschain_routes, evidence_runs`. All money columns are `bigint` zatoshi with `CHECK (>= 0)`. Financial state changes happen in DB transactions with unique constraints for idempotency. Sensitive fields that must be stored are encrypted with AES-256-GCM or XChaCha20-Poly1305 (libsodium), with keys from env or a local key file and unique nonces. Docs must say this is encryption at rest, not end-to-end. No seeds or keys in Postgres ever.

**Auth:** local accounts (username + password hashed with argon2id) for the owner and demo personas (customer, merchant, freelancer, organizer), with server sessions (HTTP-only, Secure, SameSite=Strict cookies). Access control is enforced in the API **and** the data-access layer. CORS is restricted to the app origin. Rate-limit financial routes.

---

# PART V — ROLES AND COLLABORATION

## 20. Lead Engineer and Integration Owner
**Owns:** environment audit, repo initialization, `services/wallet-sidecar`, `packages/core`, `packages/luteguard`, `apps/api` (including workers), DB schema, Z3 regtest integration, mainnet sync, `docs/API.md` contracts, BUILD-STATUS, CAPABILITIES, DECISIONS, PRIVACY-EVIDENCE, phase gates, final integration, and release prep.

**Rules:** at the start of each session read `docs/BUILD-STATUS.md`, `docs/BLOCKERS.md`, `docs/QUESTIONS.md` and the newest `docs/reviews/` file; check §27 resources before any new integration; verify before integrating; small testable slices; write the acceptance test with the feature; run tests after each meaningful change; keep previously passing flows green; commit logical milestones on `claude/<task-id>`; never report completion because code compiles; respond to the reviewer findings with real fixes plus regression tests, or a documented rebuttal; request the reviewer review before enabling any new financial execution path.

## 21. The reviewer — Independent Security and Correctness Engineer, plus Bounded Implementer
The reviewer is not the lead engineer's approver. **Its job is to falsify Lute's claims.**

**Review scope:** Zcash (receiver parsing and selection, transparent receiver handling, pool selection, FullPrivacy-equivalent enforcement, proposal binding, approvals and mandates, key isolation, viewing-key exposure, settlement verification, replay); privacy (URLs, network metadata including the light server, DB exposure, logs and telemetry, memos, group membership, subscription correlation, stream visibility, merchant data, cross-chain exposure); financial correctness (accrual, caps, metering, settlement accounting, cancellation, expiry, races, DB consistency, duplicates, failed or ambiguous broadcasts, refund abuse); app security (authn, authz, IDOR, MCP authorization, prompt injection via tools, SSRF, input validation, dependencies, cross-tenant leakage, secrets).

**Finding format** (`docs/reviews/YYYY-MM-DD-<slice>.md`, one section per finding): Severity (CRITICAL / HIGH / MEDIUM / LOW / INFO), component, file:function or line, exact failure condition, reproduction steps, observed evidence, financial or privacy consequence, proposed correction, regression test id. **CRITICAL and HIGH findings on enabled financial paths block release** until fixed and re-verified by the reviewer.

**Implements (against `docs/API.md` only):** `apps/web` pages and components; `packages/sdk` typings, docs and examples; `apps/mcp` tool definitions and Zod schemas; the adversarial suite in `tests/privacy/`. If a contract is missing, request it in `docs/QUESTIONS.md`. Never invent endpoints.

**Must not:** edit `services/wallet-sidecar/**`, `packages/luteguard/**`, accounting math, caps, mandates or approval code (propose a patch in a review file instead); run anything that signs or broadcasts; touch key or wallet files; hardcode Privacy Center results.

## 22. Collaboration mechanics
- **Worktrees or branches:** `dev/<task-id>`, `review/<task-id>`. Merge to `main` only with tests green and, for financial paths, a the reviewer review with no open CRITICAL or HIGH findings.
- **File ownership:**
  | Path | Owner | Other agent |
  |---|---|---|
  | services/wallet-sidecar, packages/luteguard, packages/core, apps/api, infrastructure | The lead engineer | review and tests |
  | apps/web, apps/mcp, packages/sdk (types, docs, examples), tests/privacy | The reviewer | The lead engineer may fix integration bugs, logged |
  | docs/* | The lead engineer | The reviewer appends with a `[review]` prefix; owns docs/reviews |
- Tasks live in `docs/TASKS.md` with id (`P1-03`), owner, status, and acceptance test id.
- Neither agent silently overrides the other's unresolved findings.
- **If the reviewer is unavailable:** the lead engineer does a separately documented adversarial pass per phase, labeled "self-review (not independent)".

## 23. Feature status (computed, never chosen)
- **PROVEN:** all of the module's tests pass in the latest `evidence/results.json` **and** (if it moves money) regtest evidence **and** at least one mainnet txid in `docs/PRIVACY-EVIDENCE.md`, with no open CRITICAL or HIGH finding.
- **PARTIAL:** some tests pass, or regtest-only, or no mainnet evidence.
- **BLOCKED:** any privacy or security test fails, or a required capability is unavailable. Execution is disabled.
- **ROADMAP:** not implemented and unreachable via any route, SDK method or MCP tool.
- **UNTESTED:** no run yet.

Only PROVEN may be presented as working.

---

# PART VI — SEQUENCE, GATES AND TESTS

## 24. Phases, gates and stop triggers (times WAT)

| Phase | Window | Build | Gate (all true, with evidence) |
|---|---|---|---|
| **P0 Environment and sources** | Oct 20 → Oct 21 12:00 | Environment audit → `docs/ENVIRONMENT.md` (OS, WSL, Docker, CPU, RAM, free disk, Node, pnpm, git, Rust, network; never print secret values). Source verification → `docs/CAPABILITIES.md` (crates and versions, NU6.3 support, light-server endpoint, ZIP-321, Tor). Repo init, gitignore, gitleaks, CI script. | Environment documented; capability ledger populated; repo builds; gitleaks clean |
| **P1a Regtest spike** | Oct 21 | Z3 up (`./scripts/regtest-init.sh`, `docker compose --env-file .env.regtest up -d`, `--profile indexer up -d zaino`); `rpc.discover` on Zallet recorded; fund via regtest mechanism (coinbase → `z_shieldcoinbase`, which is a labeled **fixture**, not a Lute payment); sidecar syncs from Zaino; isolated payer and recipient wallets | Real regtest shielded send → recipient sees the correct amount and memo; transparent recipient DENY (LuteGuard and sidecar); TEX DENY; cross-pool DENY; mutation-after-approval DENY; caps DENY; ZIP-321 build and parse tests pass |
| **P1b Mainnet spike** | Oct 21 → Oct 22 12:00 | Sidecar syncs mainnet over TLS from the verified light server; owner key init; owner funds `merchant` and `payout` with ≤ 0.1 ZEC total | Zodl → Lute request paid and **verified by memo and amount** (txid recorded); Lute `payout` → external shielded address after LuteGuard ALLOW **and** interactive owner approval (txid recorded); t-address send DENIED on mainnet config |
| **P2 Engine and Commerce** | Oct 22 → Oct 23 | Action engine, LuteGuard (all policies), encrypted links, checkout, receipts, refunds, confirmation tracking, Privacy Center v1, logger redaction, `docs/API.md` v1 | Mainnet invoice → pay → receipt → refund; W and U test groups pass; the reviewer review with no open CRITICAL or HIGH |
| **P3 Programmable** | Oct 23 → Oct 25 | Streams + worker + mandates; meter (both modes) + demo service + prepay and refund | ≥1 mainnet stream payout under a mandate; ≥1 mainnet meter session (prepay → usage → remainder refund); S and M groups pass |
| **P4 Workflows** | Oct 25 | Subscriptions, Groups | G group passes, or the module is marked PARTIAL/ROADMAP and disabled |
| **P5 SDK and MCP** | Oct 25 → Oct 26 | SDK + example, MCP server, AgentGrants | Mainnet agent payment within a grant (txid); over-cap, expired, wrong-recipient attempts DENY; A group passes |
| **P6 Cross-chain research** | Oct 26 | Classifier + probe + report | X group passes; honest route status |
| **FREEZE** | **Oct 26 23:59** | No new features | — |
| **P7 Harden** | Oct 27 | Full `pnpm test:evidence`, the reviewer final review, fix CRITICAL/HIGH, docs complete, optional hosted read-path (§15) | Every enabled module PROVEN or disabled |
| **P8 Package and submit** | Oct 28 | Video, README, make repo public (owner), submission form (owner) | §31 checklist complete; **submitted by 20:00 WAT** |

**Stop and pivot triggers**
- P1a not passed by **Oct 21 23:59** → stop all other work; the lead engineer and the reviewer both debug the Zcash path; log the root cause.
- Sidecar cannot do a mainnet send by **Oct 22 18:00** → escalate to Maris with evidence (§10.8). Continue regtest-proven work in the meantime.
- P2 not passed by **Oct 24 12:00** → P3 builds Streams only; Meter, Subscriptions and Groups become ROADMAP.
- Any leak found in an enabled module → disable it immediately and mark it BLOCKED until fixed and re-tested.
- Cross-chain never blocks submission of the proven core.

## 25. Test strategy
Layers: unit (domain logic), integration (API + DB + sidecar on regtest), **real Zcash regtest tests** (never replaced by mocks), mainnet evidence runs (owner-approved, minimal), e2e (Playwright), privacy, authorization, replay, regression. `pnpm test:evidence` runs all automated layers and writes `evidence/results.json` = `{commit, ran_at, env, tests:[{id, group, module, tier, result, duration_ms, evidence_ref}]}`.

**Tier 1 = must pass before any module is enabled. Tier 2 = must pass for PROVEN.**

**W: Wallet and transaction privacy (Tier 1)**
W1 transparent recipient DENY (LuteGuard **and** sidecar with a forged ALLOW) · W2 TEX DENY · W3 UA with a transparent receiver pays only the shielded receiver, zero transparent outputs · W4 shielded-only receive-address generation (no P2PKH) · W5 transparent input DENY · W6 cross-pool DENY · W7 weaker policy rejected · W8 mutation after approval DENY (hash mismatch) · W9 wrong network DENY · W10 invalid or oversized memo rejected · W11 fee from library, change in the same shielded pool · W12 expired proposal DENY · W13 approval reuse DENY · W14 per-tx and daily cap DENY (core + sidecar) · W15 concurrent spends cannot exceed mandate (atomic reservation) · W16 ambiguous broadcast → no blind retry, reconciled by txid · W17 real regtest shielded send and receive with recipient confirmation (Tier 1 evidence) · W18 real mainnet send and receive (Tier 2 evidence)

**U: Metadata and application privacy (Tier 1)**
U1 no memo, address, amount or label in server logs after the e2e run (log scan) · U2 share URL path and query contain only the opaque id; the fragment key never reaches the server (Playwright network) · U3 no keys or viewing keys in any API response · U4 no confidential data in errors · U5 no third-party network requests from the web app · U6 cross-user and cross-tenant access → 404 · U7 unauthenticated endpoints expose nothing sensitive · U8 no unapproved viewing-key export path exists · U9 the logger wrapper drops sensitive fields · U10 receipt signature verifies; a tampered receipt fails · U11 link previews (OG tags) contain no request details · U12 the sidecar is not reachable except from the API (bind and auth test)

**F: Financial correctness (Tier 1)**
F1 integer-only money paths (lint rule: no `Number` arithmetic on `_zat` fields) · F2 decimal → zatoshi conversion exact; reject more than 8 decimals and negatives · F3 no duplicate payout (idempotency) · F4 no duplicate invoice settlement · F5 refund ≤ refundable; replayed refund DENY · F6 no SUBMITTED→PAID without confirmations · F7 correct recovery after API, worker and sidecar restart · F8 expiry and cancellation transitions are correct

**S: Streams (Tier 2)**
S1 0-second accrual = 0 · S2 1-second accrual correct · S3 long duration (30 days) correct · S4 never > total (property test, 10k cases) · S5 monotonic · S6 remainder: final accrued = total exactly · S7 pause and resume · S8 cancel freezes · S9 expiry · S10 duplicate settlement request → single payout · S11 insufficient funds or expired mandate → OWED · S12 accrued and paid kept separate in API and UI · S13 client clock change has no effect · S14 real payout confirmed (regtest Tier 1, mainnet Tier 2)

**M: Meter (Tier 2)**
M1 valid signed event accepted · M2 forged signature rejected · M3 duplicate seq rejected · M4 out-of-order seq rejected · M5 stale ts rejected · M6 cap exhaustion stops the session · M7 session expiry · M8 price_version mismatch rejected · M9 usage records contain no request contents · M10 prepay verified before activation; remainder refund amount correct · M11 real settlement

**G: Groups and subscriptions (Tier 2)**
G1 participant cannot read others' contributions · G2 public page reveals no participant data · G3 renewal not active before verified payment · G4 no duplicate billing period · G5 cancellation and expiry · G6 subscription history isolated per customer

**A: SDK, MCP and agents (Tier 1 for any enabled agent path)**
A1 no grant → DENY · A2 over cap_per_tx → DENY · A3 over cap_total → DENY · A4 expired or revoked grant → DENY · A5 wrong recipient → DENY · A6 MCP cannot reach the sidecar · A7 every entry point (web, api, sdk, mcp, scheduler, worker) denies the same unsafe action (parameterized) · A8 prompt-injection payload in tool parameters cannot change the recipient or amount · A9 no secrets or viewing keys in tool responses · A10 legitimate authorized agent payment succeeds (regtest; mainnet Tier 2) · A11 SDK example app passes §19.8 acceptance

**X: Cross-chain (Tier 1 for the classifier)**
X1 transparent Zcash hop → TRANSPARENT_ZCASH_HOP and execution disabled · X2 public source chain → PUBLIC_SOURCE_EXPOSURE, never strict-private · X3 unknown route → UNKNOWN and disabled · X4 multiple classes combine correctly · X5 no execution endpoint is reachable with the flag off · X6 no fabricated quote or settlement in any code path (test that the adapter requires live responses)

## 26. Threat model (`docs/THREAT-MODEL.md`, written in P0–P1 before financial execution)
**Assets:** sender, recipient, amount, balances, relationships, salary agreements, contractor rates, group membership, subscription history, API usage, metering data, memos, invoices, refunds, wallet credentials, viewing keys, owner key, authorization records.

**Observers (analyze each):** public Zcash chain observer; Zcash network observer; **light-wallet server operator**; Lute application operator; DB administrator; payer; recipient; merchant; group organizer; group member; API service provider; SDK app operator; AI agent; MCP server operator; external RPC or indexer provider; cross-chain solver; bridge operator; confidential-intent operator; unauthorized third party.

**Per feature, in `docs/PRIVACY-MATRIX.md`:** data generated, stored and transmitted; who can observe it; legitimate disclosure; prohibited disclosure; retention; trust assumptions; mitigations; residual risks.

**Claims are scoped:** "Observer X cannot learn Y under assumption Z." Never claim total anonymity, hidden IPs by default, invisible transaction existence, zero provider visibility, untraceable cross-chain activity, no timing correlation, or formal proof of application privacy.

---

# PART VII — RESOURCES, EVIDENCE, DEMO AND SUBMISSION

## 27. Official and verified resources
**Organizer-listed:**
- ZECATHON: https://thezecathon.com/ (rules behind sign-in; the owner confirms eligibility, Nigeria payout and extra fields)
- Zcash developer docs: https://zcash.readthedocs.io/en/latest/
- ZIPs: https://zips.z.cash/ (ZIP-316 Unified Addresses, ZIP-317 fees, ZIP-320 TEX, **ZIP-321 payment requests: https://zips.z.cash/zip-0321**)
- librustzcash: https://github.com/zcash/librustzcash
- Zebra: https://github.com/ZcashFoundation/zebra (lightwalletd notes: https://zebra.zfnd.org/user/lightwalletd.html)
- ZODL (payer wallet; Android and Swift light-client SDKs as reference): https://github.com/zodl-inc
- NEAR Intents: https://docs.near-intents.org/

**Verified additional (check versions at P0):**
- Crate docs: https://docs.rs/zcash_client_backend, https://docs.rs/zcash_client_sqlite, https://docs.rs/zcash_address, https://docs.rs/zip321 (v0.9.0 seen: `TransactionRequest`, `Payment`, `memo_to_base64`, `memo_from_base64`)
- zcash-devtool (reference only; "DO NOT USE THIS IN PRODUCTION"): https://github.com/zcash/zcash-devtool, walkthrough: https://github.com/zcash/zcash-devtool/blob/main/doc/walkthrough.md
- Zallet (beta; regtest funding and second wallet only): https://github.com/zcash/zallet, RPC reference: https://zcash.github.io/zallet/rpc/index.html (lists `rpc.discover`, `z_sendmany` and `pczt_*` with `privacy_policy` defaulting to `FullPrivacy`; `z_getaddressforaccount` defaults include a P2PKH receiver)
- zcashd `z_sendmany` privacy policy definitions: https://zcash.github.io/rpc/z_sendmany.html
- Z3: https://github.com/ZcashFoundation/z3, regtest: https://github.com/ZcashFoundation/z3/blob/main/docs/regtest.md (Zebra RPC :29232, Zallet RPC :50232, rpc-router :8181, Zaino gRPC :28137)
- Zaino: https://github.com/zingolabs/zaino (v2 listed https://github.com/zcashfoundation/zaino; verify which is canonical)
- zec.rocks (public light servers): https://github.com/zecrocks
- NU6.3: https://z.cash/upgrade/nu6-3/
- Zcash integration tests: https://github.com/zcash/integration-tests
- NEAR Confidential Intents: https://www.near.org/blog/announcing-general-availability-of-confidential-intents
- MCP: https://modelcontextprotocol.io/, TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- libsodium docs: https://doc.libsodium.org/

**Prior art (do not copy; only for originality positioning):** Privacy Bridge https://github.com/collinsville22/privacybridge, BTCPay Zcash plugin (zechub.wiki guide), zcash-mcp (ZAP1 attestation, no spending) https://glama.ai/mcp/servers/Frontier-Compute/zcash-mcp.

## 28. Evidence system
`docs/PRIVACY-EVIDENCE.md`, one row per material claim: claim · threat-model ref · environment (regtest or mainnet) · policy · test id · command · expected · actual · artifact (txid, log excerpt with secrets removed, results.json ref) · commit · residual limits · reviewer status (the reviewer reviewed / self-review / unreviewed).

Mainnet txids are recorded from the sidecar's broadcast log, never typed by hand. No secrets in evidence.

## 29. Error recovery
Capture the exact error → identify the component → read the docs and source → state one root-cause hypothesis → smallest fix → rerun the failing test → rerun the regressions → record it in BUILD-STATUS. Never rewrite unrelated code, suppress failures, weaken LuteGuard, swap in mock transactions, or claim an unexecuted test passed.

## 30. Demo (video ≤ 2 minutes, recorded locally on mainnet)
1. Merchant creates a request → Zodl scans the QR and pays → Lute shows the verified payment and confirmations.
2. A stream accrues per second → a shielded payout confirms → accrued and paid are shown separately.
3. An AI agent (MCP) pays the metered demo API inside its grant → a real txid.
4. The agent tries to exceed its cap → **DENY** with a reason.
5. Sending to a transparent address → **LuteGuard DENY** (and sidecar refusal).
6. Privacy Center: real test results, open findings, limitations, the light-server disclosure, cross-chain route classified honestly.

Narration answers: what is shielded on-chain; what the payer, recipient, merchant and Lute server know; what the light server sees; can an agent access keys (no); can the SDK bypass checks (no); what happens when privacy can't be kept (fail closed); remaining limitations.

**Never show** seeds, viewing keys, the owner key, or full addresses tied to a real person. Use "Earned (accounting)" wording. No "100% untraceable".

## 31. Final release checklist
- [ ] Repo builds reproducibly from a clean clone inside WSL2 (documented steps)
- [ ] Z3 regtest works; W17 passes
- [ ] Mainnet send and receive proven (W18) with txids
- [ ] Transparent, TEX, cross-pool and mutated executions rejected (LuteGuard + sidecar)
- [ ] LuteGuard is mandatory; SDK and MCP cannot bypass it (A7)
- [ ] Exact integer accounting; deterministic stream accrual; ≥1 real stream payout
- [ ] Meter flow proven, or honestly disabled
- [ ] Approvals one-use; mandates bounded; caps enforced in the sidecar
- [ ] No secrets in repo (gitleaks), logs or evidence
- [ ] No fictional data anywhere in the UI
- [ ] Every enabled module PROVEN; others disabled and labeled
- [ ] No open CRITICAL or HIGH findings on enabled paths
- [ ] Light-server privacy analysis and all limitations documented
- [ ] README: pitch, PROVEN list with txids, PARTIAL/BLOCKED/ROADMAP list, custody disclosure, setup, architecture diagram, limitations, attributions (librustzcash crates, zip321, Z3, zcash-devtool as reference, Zodl, MCP SDK)
- [ ] MIT license; code written during the build window; no reused product code
- [ ] Video ≤ 2 min
- [ ] Owner: eligibility confirmed, shielded payout address entered, repo made public, submitted by **Oct 28 20:00 WAT**

## 32. Progress report format (after every phase and every session, appended to `docs/BUILD-STATUS.md`)
```
## <YYYY-MM-DD HH:MM WAT> — <agent> — <phase>
IMPLEMENTED: <code completed>
VERIFIED: <executed functionality + evidence refs/txids>
TEST RESULTS: <passing / failing / not run, by id>
PRIVACY STATUS: <policy compliance, known limitations>
REVIEW FINDINGS: <open by severity, or "not reviewed">
BLOCKERS: <id → what is needed, from whom>
NEXT ACTIONS: <task ids>
REPOSITORY STATE: <branch, commit, changed components>
MODULE STATUS: send=? requests=? commerce=? refunds=? groups=? streams=? meter=? subs=? sdk=? mcp=? crosschain=? privacy-center=?
```
This file must let either agent resume accurately after a context reset.

---

# PART VIII — START INSTRUCTION FOR THE BUILD AGENTS

**Lead engineer: begin now with P0.** Do the environment audit (`docs/ENVIRONMENT.md`), then source verification (`docs/CAPABILITIES.md`), then repo initialization, then the P1a regtest spike, then the P1b mainnet spike (stopping for owner funding and approval). **Do not begin with dashboard design, branding or landing pages.**

**Reviewer: begin with** reading this mandate and `docs/LUTE_SPEC.md`, then draft `docs/THREAT-MODEL.md` observer tables and the Tier 1 test skeletons (W, U, F, A, X) against interfaces as the lead engineer publishes them. Review every the lead engineer slice that touches money or privacy.

**The required first proof:** real shielded send → real shielded receive → recipient verification → LuteGuard and sidecar rejection of an unsafe transaction, first on regtest, then on mainnet with owner approval.

The target is not the longest feature list. It is a functional, defensible privacy-first payment platform on Zcash whose every claim is backed by evidence.

**LUTE: Private money. Programmable payments.**

*End of v3 mandate.*
