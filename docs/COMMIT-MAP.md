# Commit map

The repository history was rewritten on 2026-10-28 before it was made public: only commit
messages changed (co-author trailers removed); every file is identical (the final tree hash is the same).
Evidence written earlier cites the old hashes; this table maps each old hash to the published one.

| Old | Published | Subject |
|---|---|---|
| `b42e084` | `41930d1` | core: neutral review wording |
| `bd7577a` | `34ee79b` | README rewritten for the public repo; neutral authorship in docs |
| `02e9fc7` | `dad63ae` | evidence: results.json at 69a5866 (277 tests pass, 20 evidence rows); build status |
| `69a5866` | `8d2d1ae` | research: Zcash payment privacy architecture (report and notes behind the non-custodial de |
| `71315af` | `cee6fba` | evidence collector: explicit vitest timeouts (slow in-memory Postgres setup under load cau |
| `01c7dc2` | `f04761f` | demo script: non-custodial sign-up, payroll, agent quotes |
| `d9582cd` | `70194fb` | crosscheck: precise custody wording (Lute holds no key that can move your money; agent bud |
| `34cc624` | `d1102f9` | evidence E-020: mainnet BatchPay payroll (two people, one shielded transaction, payslip me |
| `0bd7deb` | `12df582` | evidence E-019: BatchPay on regtest (one transaction, three recipients, tampered line refu |
| `2017459` | `6f1fce5` | payroll (6-10): BatchPay (one shielded transaction, up to 10 people, every line approved,  |
| `09b6fb3` | `b831ddb` | BatchPay core: one shielded transaction paying up to 10 recipients (sidecar propose_batch, |
| `1c65aad` | `8936b75` | agents pay APIs beyond your own account: (C) listed services of other Lute accounts can be |
| `9fe5784` | `9b0d146` | evidence E-018: mainnet agent pays for document extraction via MCP with a one-time quote;  |
| `fce5dca` | `f179f24` | recoverable operations: recovery sweep at start and every 5 min settles actions interrupte |
| `d6b0a04` | `ef980a7` | PactPay-inspired improvements: one-time quotes for metered extraction (bound to price, ser |
| `3909390` | `681fcd2` | evidence E-017: first mainnet browser-signed (non-custodial) payout, single Ironwood pool, |
| `a228082` | `4e27e46` | custody claims match the shipped non-custodial accounts: FAQ, pillar and hero line; CUSTOD |
| `ae2cbc2` | `1f3aef6` | deploy: copy apps/web/public (WebAssembly signer) into the standalone web build |
| `3edfd76` | `3cc7d0f` | web: WebAssembly signer package (CI run 40413282413: lute_signer_bg.wasm sha256 e1211f5b…) |
| `0c0c78d` | `3416f5f` | pnpm lockfile for @scure/bip39; regtest end-to-end script for browser-signed payouts |
| `699f3a6` | `1c2bd25` | non-custodial: web signs payouts in the browser (24-word BIP-39 recovery phrase kept in th |
| `337528d` | `a07cca7` | non-custodial payouts, API and core: sign-up with browser-derived viewing keys (merchant/p |
| `c49849f` | `00d233a` | sidecar: browser-signed (non-custodial) wallets: view-only wallet from a browser-derived U |
| `7a344d2` | `0656ba2` | lute-signer: browser signer for non-custodial payouts (derive UFVK from a browser-held see |
| `2eb7bd0` | `b4f3f42` | evidence: results.json at 417f8fa (264 tests pass, 15 evidence rows); build status |
| `417f8fa` | `fc17c05` | evidence E-015 (restrictions R1-R6, CI 40400288981); meter and agents modules link E-015;  |
| `1e98c0b` | `587798a` | metered document extraction: POST /v1/meter/sessions/:id/extract and MCP lute_extract_docu |
| `62522dc` | `102d51c` | restrictions: settlements serialized per grant (re-read grant and session inside the lock) |
| `0eb3961` | `f16384c` | custody trace and honest claims: docs/CUSTODY.md (custodial, software-enforced approvals,  |
| `b92312f` | `0847e5c` | web: strike through only money that never moved; waiting requests carry no sign |
| `4de1366` | `9615154` | evidence: results.json after the full-app test pass |
| `4c5abcf` | `f0df7b1` | full-app test pass fixes: balances and sends refresh from the chain (throttled), expired a |
| `db85596` | `ef67910` | sidecar: wallet inspect-tx (any txid: transparent in/out, sprout, sapling, orchard, ironwo |
| `7362476` | `fcac086` | product copy: drop demo disclaimers and the sign-up checkbox; state custody plainly (held  |
| `638bf2c` | `330f79a` | docs page: decode headings in the contents list; mobile layout (contents hidden, guide tab |
| `a0d75e1` | `bea0831` | web: private-banking aesthetic (Cormorant display serif for headlines, balances and monogr |
| `2ad9094` | `2907e7f` | private paid APIs: leak trace (URLs, 402s, facilitator, light server, logs, DB, chain, rec |
| `919e02d` | `144b7a5` | web: silver-and-black theme with light, dark and system modes (no-flash boot script, toggl |
| `f34b3b0` | `51c65a7` | web: consumer redesign — welcome page, grouped navigation with icons (Money / Business / A |
| `769a01c` | `7deb1e6` | pay page QR: 4-module quiet zone (QR spec), error correction L (larger modules for the 240 |
| `f8c800c` | `df302cf` | new accounts: first sync starts at sign-up; balance syncs a never-synced wallet once; over |
| `b09c891` | `a748001` | infra: sidecar unit enables wallet creation (keys dir writable, zec.rocks for new wallets) |
| `8e03b9f` | `30b0e16` | web: sign-up with a browser-held Ed25519 approval key (hash recomputed in the browser, typ |
| `24badac` | `12eeb74` | api: self-serve sign-up (own merchant/payout/agent wallets bound to the browser-generated  |
| `194a1fd` | `b7c3db6` | sidecar: wallet creation over the API (own sealed seed + kek file, enabled only with --key |
| `3fa7d31` | `205674a` | evidence: results.json after E-013 |
| `f5db6c0` | `d99284d` | evidence E-013: regtest subscriptions (ACTIVE/DUE/LAPSED) and groups (2 of 3 paid) with re |
| `f510d7b` | `3ffdffa` | regtest evidence script for subscriptions (ACTIVE -> DUE -> LAPSED with real payments) and |
| `9f884e3` | `1b7e816` | evidence: results.json for 515eb7d (247 tests; commerce PARTIAL until mainnet) |
| `515eb7d` | `b6f4f98` | web: Subscriptions (plans, subscribers, subscriber link) and Groups (split, per-member lin |
| `fcd1741` | `1f3397a` | api: subscriptions (plans, per-period invoices, computed ACTIVE/DUE/LAPSED/CANCELLED, subs |
| `32b6af9` | `5e770ef` | commerce: sync the merchant wallet before checking refund confirmations |
| `90cb4dd` | `2dba946` | web: Commerce page (orders, checkout links, receipts, refunds with owner signing), public  |
| `e0e785c` | `c48a625` | api: commerce — checkout orders on payment requests, Ed25519-signed receipts (separate key |
| `e366918` | `ae80829` | evidence: results.json for ad91af5 (236 tests; meter and agents PROVEN) |
| `ad91af5` | `750efa2` | evidence E-011: mainnet AI agent (MCP) pays the metered API under an owner-signed mandate; |
| `d2ccacb` | `38a9ff2` | executeAction: agent grant checks run before the wallet builds a proposal (mainnet: an ove |
| `11c5d24` | `2e92b2f` | web: sign via tools/lute-sign.ps1 (start it, then copy) |
| `b6b1a4d` | `2bcbd82` | api: sync the spending wallet before building a proposal (a stale tip gave an already-expi |
| `9bfc919` | `a67290c` | tools: lute-sign.ps1 waits for a newly copied proposal/mandate and signs it via a file (no |
| `4779458` | `08291dc` | lute-owner: ignore a UTF-8 BOM on piped JSON (Windows PowerShell 5.1); web shows the sign  |
| `079997c` | `557388d` | tools: lute-web.ps1 (reconnecting SSH tunnel to the dashboard; used by the MCP server too) |
| `bf077e1` | `3e88e7e` | evidence: results.json for af0701c (233 tests pass; meter and agents PARTIAL: no mainnet t |
| `af0701c` | `7233a9d` | infra: mainnet-init creates the agent wallet (own sealed seed and key file) |
| `88dba98` | `6e6c390` | web: Agents page (metered services, mandate draft, owner signs with lute-owner sign-mandat |
| `ed38ebe` | `294569c` | regtest agent evidence script (A2/A3/A5/A7/A10): mandate signed with the disposable regtes |
| `6ed2e95` | `16a647f` | apps/mcp: Lute MCP server (stdio) with six backed tools; only opaque session ids as input  |
| `015ea91` | `679dfb4` | sidecar: clippy type_complexity in mandate tests |
| `8cd7db0` | `08625f5` | api: agents and metered billing — meter services, owner-drafted mandates (sidecar verifies |
| `c1fb2da` | `fe58b22` | sidecar: clippy (fn pointers in mandate bound tests); core: executeAction runs agent spend |
| `62ad249` | `2eebbff` | lute-owner: tidy sign-mandate prompts |
| `5145123` | `a0471cc` | sidecar: owner-signed agent mandates (§13.3): verify (signature, wallet, network, caps, ≤4 |
| `cc39bc7` | `e559822` | README (pitch, PROVEN list with txids, status table, custody disclosure, architecture, set |
| `519cd5d` | `2c38a82` | evidence: results.json for 5c467c3 (streams PROVEN) |
| `5c467c3` | `fe6599f` | evidence E-009: regtest streams through the real API code; streams module links E-008 + E- |
| `72d1e01` | `7113894` | regtest stream evidence script: real API code against a regtest sidecar, disposable regtes |
| `51b23d6` | `4c7750e` | web: tables scroll instead of wrapping on mobile; settle disabled when nothing is outstand |
| `6441a3a` | `070062e` | evidence: results.json for 8fd4d57 (207 tests pass) |
| `8fd4d57` | `ea63d9a` | evidence: E-001 limitation updated (LuteGuard layer now built) |
| `638a217` | `708425e` | apps/web: Next.js dashboard (overview, send with owner signing via clipboard, receive/requ |
| `15c4a1e` | `ab0d97f` | api: dashboard feeds (me, actions, requests, streams list, wallet balance) and /v1/privacy |
| `1c141a5` | `906f2f4` | Privacy Center data: computed feature status (packages/core status.ts, §23) and pnpm test: |
| `c2aea19` | `3b6cfe6` | docs: build status 2026-10-25 (mainnet gate, streams) |
| `ee513cc` | `4147e59` | evidence E-008: final refresh, 30000/30000 confirmed paid |
| `84a21a5` | `04d2c39` | evidence E-008: mainnet stream with owner-approved settlements; failed settlement never co |
| `9a7a76f` | `1c5dbe5` | executeAction: a sidecar error before authorization fails the action (was stuck VALIDATING |
| `7d83dec` | `bb5e7b4` | api: Fastify client errors (415 etc.) keep their status; 500s log class/code/route/frames  |
| `b28ef8f` | `7c08be9` | evidence E-007: regtest approvals run 3 (W8, W12, W13, W14a/b, no-approval, forged key) |
| `d030781` | `5731464` | tools: lute-pay.ps1 stream mode (create, watch accrual, owner-approved settlements, refres |
| `346473b` | `975dadb` | infra: deploy-api recreates the API container so it runs the new build |
| `23dd06c` | `794ee12` | P3: streams API (create, accrual view, pause/resume/cancel, owner-approved settlement via  |
| `324976c` | `411b459` | sidecar: tx status (mined height, confirmations, expired) from the wallet DB; API + CLI |
| `155dbb6` | `8ffcea2` | evidence E-006: mainnet payment through the full API path; LuteGuard ALLOW recorded before |
| `9e6303e` | `340672f` | tools: lute-pay.ps1 sends the session cookie via a WebRequestSession (PS 5.1 drops Cookie  |
| `fbef540` | `2ce54bf` | tools: lute-pay.ps1 owner helper (SSH tunnel, password stays local, API send -> LuteGuard  |
| `1dba976` | `674f704` | P3: stream accrual in core (bigint, deterministic, pause/resume/cancel) + S1-S9, S13 tests |
| `e8e53f3` | `ce8c7d6` | evidence: mainnet payout confirmed at height 3530286 (3 conf); balances reconcile |
| `e4925ec` | `ca8c2d1` | P1b: first mainnet evidence — Zodl pays a Lute request (verified by address+memo, 3+ conf) |
| `4fc1e93` | `5269472` | tools: luteguard-check runs LuteGuard on an exact sidecar proposal (P1b, pre-API) |
| `805f991` | `4e49222` | docs: I-001 impact line updated after repair |
| `27b2167` | `1bb7b4f` | I-001 follow-up: disk watchdog for Lute workloads; Everpiece test indexer repaired |
| `b99c95f` | `e0a5697` | infra: log cap on Z3 cookie-permissions helper too (I-001) |
| `39ad65e` | `e83fd0a` | P1b: mainnet wallets created and synced over TLS; zec.rocks at NU6.3 proven (C-011b, C-020 |
| `c0bc1af` | `1db7dc6` | docs: fix BLOCKERS layout |
| `222f589` | `fa45351` | incident I-001: runaway regtest Zallet log filled the shared VPS disk; fixed |
| `cc2540c` | `f7a478d` | P2: payment requests in the API (§19.2) |
| `bac5147` | `c323855` | docs: threat model (mandate §26) before the first mainnet spend |
| `0eac18a` | `0e8e133` | infra: API + Postgres 16 compose (capped, loopback), API deploy script, sidecar systemd un |
| `e4979de` | `1f7362d` | sidecar: incoming payments per request address + request check (§19.2) |
| `51be0e1` | `1cdf478` | sidecar: cargo fmt |
| `5fd9499` | `80a46c4` | docs: build status at session pause |
| `39b78aa` | `81aff77` | infra: mainnet wallet init script (new sealed wallets, no funds moved) |
| `a0774dd` | `dca60f1` | P2: apps/api (Fastify + Drizzle + Postgres) wired to executeAction; sidecar TLS provider f |
| `1ef354a` | `4e82243` | P2: packages/core Action engine with executeAction(); LuteGuard mandate rule on all networ |
| `2aef2df` | `27b14e1` | sidecar api: box large error response (clippy result_large_err); docs/API.md sidecar contr |
| `d1cd597` | `68d50c3` | sidecar: authenticated loopback HTTP API for apps/api (mandate §13.4, U12) |
| `c1f785d` | `6d7d41f` | sidecar: control-DB precheck before decoding a stored proposal; owner key registered (D-01 |
| `eb512a1` | `b91fb42` | P2: LuteGuard policy engine (packages/luteguard) + TS workspace |
| `54e2ae4` | `42b0eba` | P1b prep: sealed seeds (XChaCha20-Poly1305, key file outside wallet dir); server-info |
| `4abc5cc` | `281bce9` | docs: light-server privacy analysis (mandate §11); deploy-from-ci script |
| `349e23f` | `232fcf2` | P1a-05: ZIP-321 build/parse with Lute rules (W10, §19.2) |
| `f9e4e17` | `c0f4ee9` | sidecar tests: fn pointers instead of boxed closures (clippy type_complexity); approvals e |
| `580ddfa` | `52cea8a` | P1a-07: proposal hash binding, owner-signed one-use approvals, caps |
| `888d53a` | `d591961` | P1a: W17 passed on regtest (real shielded send + recipient verify) |
| `a63800b` | `613fea3` | sidecar: read Orchard/Ironwood decrypted note value from (Note, ValuePool) |
| `53a3948` | `a89b2cc` | sidecar: fix decrypt imports and error type inference; gitleaks false positive |
| `8354f21` | `7e9f13b` | P1a-06: shielded send with sidecar single-pool policy; recipient verify |
| `5f61779` | `3cf2ff2` | P1a-04 proven: regtest sync from Zaino, Ironwood fixture funding |
| `6581dd1` | `30ab191` | sidecar: enable uuid serde; record Zebra Ironwood coinbase capability (C-018) |
| `60850e8` | `9812c2d` | P1a-04: sidecar regtest wallets (init, sync, shielded address, balance) |
| `4bdaa18` | `fa194e5` | docs: Zodl 3.17.1 supports Ironwood (C-016); Move to Ironwood before P1b |
| `18f4b2b` | `697deaa` | docs: mark Q-001 answered |
| `c7baabb` | `0362b29` | docs: add owner product spec (LUTE_SPEC.md); log spec/mandate differences (D-008) |
| `ed5bc12` | `e42aa6a` | docs: P1a progress, Zallet blocker B-005, regtest funding fallback D-007 |
| `dc1cc83` | `59957af` | sidecar tests: require Sapling receivers explicitly in fixtures |
| `a4ab3b0` | `cf348bd` | sidecar: fix clippy clone-on-copy; add Z3 regtest overlay for VPS |
| `78a9cae` | `32fc08d` | sidecar: cargo fmt |
| `f431752` | `e93eed0` | P1a: sidecar address inspection (W1, W2, W3-address, W9) + CI build |
| `fa03656` | `7a8fb4e` | P0: mandate, environment audit, capability ledger, decisions, blockers |
