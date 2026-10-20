# Decisions

## D-001 — 2026-10-20 — Pin librustzcash crate set from crates.io as of 2026-10-14
Versions in `docs/CAPABILITIES.md`. They are the first set that knows NU6.3 / Ironwood. Compatibility is confirmed only when the sidecar compiles.

## D-002 — 2026-10-20 — "Single shielded pool" means Ironwood for Orchard-receiver payments; Orchard inputs are denied for payments
**Evidence:** C-003, C-004, C-006. After NU6.3, a payment to a UA's Orchard receiver lands in the Ironwood pool. Spending an Orchard note to make that payment is an Orchard→Ironwood pool crossing, which reveals the crossing value (ZIP-318 relies on denominations to blend those values).

**Decision (more private, more conservative; mandate §9):**
- Lute-operated accounts are created with birthdays after NU6.3 activation, so value they receive via the Orchard receiver is held in Ironwood.
- TransactionPolicy and the sidecar treat the allowed pool set as one of `{Ironwood, Sapling}` per transaction. Inputs, outputs and change must all be in that one pool.
- Any proposal with Orchard inputs is DENIED as a payment. Orchard→Ironwood migration (ZIP-318) is not a Lute feature; if a Lute account ever holds Orchard funds, they are left alone and reported.
- A Sapling-only recipient paid from Ironwood funds is a cross-pool spend and is DENIED (W6).

This refines mandate §18 "single shielded pool" and §19.1 "Orchard and/or Sapling receivers" for the NU6.3 era. Mandate text is unchanged in intent.

## D-003 — 2026-10-20 — Repository initialized at `C:\zecathon` for P0 only
Mandate §12 says the repo lives on the WSL filesystem. WSL here is Debian with ~2 GB RAM, no Node or Rust, and its VHD shares the 7.5 GB free on C:. Docs-only P0 work is done in `C:\zecathon`; the repo moves (`git clone`) once Q-001 is answered. No code depends on the location yet.

## D-005 — 2026-10-20 — Owner decision: host Lute on the shared VPS (38.49.209.149)
Maris chose the existing shared VPS for long-term hosting through judging, over Lightsail (credit budget) and over the local machine (7.5 GB free disk, no Docker). Supersedes mandate §12 (WSL2 dev machine) and §15 (local primary demo) for hosting.
- **Isolation:** everything is prefixed `zlute-`, binds to `127.0.0.1`, has hard memory/CPU caps, and touches no other tenant.
- **Custody disclosure (README + UI):** the `merchant`, `payout` and `agent` hot accounts live on a rented server that also runs other projects, all as root. The hosting provider and any compromise of a co-tenant could reach those keys. Mitigation: ≤ 0.1 ZEC per hot account (§13.1), and the owner approval key never leaves Maris's laptop.
- The sidecar is never exposed publicly; approvals happen over SSH from the owner's machine.

## D-006 — 2026-10-20 — Compile Rust in GitHub Actions, not on the VPS
The VPS has 2 vCPU and about 3.6 GB free RAM. A librustzcash build needs 4–6 GB and would push co-tenants into swap. CI builds a release binary (x86_64-unknown-linux-gnu, Ubuntu 24.04 runner to match the VPS glibc) and the VPS downloads it. The repo is private (`Stella112/zlute`) until the owner makes it public at P8.

## D-007 — 2026-10-20 — Regtest funding without Zallet (fallback for B-005)
Zallet beta.1 hangs on account RPCs here. Regtest funds come instead from Zebra mining coinbase to a Lute-controlled **fixture** account (the regtest `ZEBRA_MINING__MINER_ADDRESS` set to that account's shielded UA, if Zebra 6.2.3 accepts one; otherwise a transparent fixture address shielded by the fixture wallet). Every such fund is labeled a fixture, never a Lute payment. The "independent second wallet" for tests becomes a second, separately keyed sidecar wallet; Zallet independence is listed as a limitation unless B-005 is resolved.

## D-008 — 2026-10-20 — Spec vs mandate differences (mandate governs HOW)
1. **Wallet operations (spec §3.1, §17.4 "Zallet for relevant wallet operations", `FullPrivacy`):** Lute's own Rust sidecar on librustzcash does wallet operations (mandate §10). Zallet is regtest-only (and currently blocked, B-005). The sidecar enforces a FullPrivacy-equivalent rule itself (zero transparent, one shielded pool; D-002), because `zcash_client_backend` has no such policy type (C-012).
2. **Custody (spec §5.4 prefers non-custodial):** customers always pay from their own wallets (non-custodial). The `merchant`, `payout` and `agent` accounts are operator-held on the VPS (D-005); the UI and README say so and never call those accounts non-custodial.
3. **Meter billing models (spec §10.1 lists six):** the hackathon build implements per-request and per-second (mandate §19.6). Per-minute is per-second with a different unit; per-token, per-compute-unit and per-session are ROADMAP unless time allows.
4. **Mobile interfaces (spec §3.3):** a responsive web app only; no native mobile app.
5. **Agent payments:** the spec lists ten MCP tools; the mandate adds `lute_pay_request` (grant-limited). It ships only if test group A passes.

## D-009 — 2026-10-20 — Approvals are owner-key signatures, checked inside the sidecar
Mandate §13.3 describes the interactive approval as the owner typing `approve <hash8>` into the sidecar CLI. On the shared VPS, agents also have shell access, so a typed approval there would be forgeable by an agent. Decision (more conservative, same intent):
- The owner runs `tools/lute-owner` on **her own machine**. `sign` reads the proposal JSON, **recomputes the proposal hash itself**, shows the decoded payment, requires the typed `approve <hash8>`, and outputs an Ed25519 signature over `lute-approve-v1|<network>|<proposal_hash>`.
- The sidecar stores only the owner **public** key (`/opt/zlute/owner.pub`) and verifies with `verify_strict`. Approvals are one-use, bound to the hash and network, and consumed atomically with the budget reservation (control DB, `BEGIN IMMEDIATE`).
- `--unattended-regtest` skips the typed confirmation only for `regtest` summaries with a disposable regtest key (automated evidence runs).
- Residual risk (THREAT-MODEL): root on the VPS can replace `owner.pub`. Mitigation: the sidecar logs the owner key fingerprint on every execution; hot-wallet balances stay ≤ 0.1 ZEC.
- New dependency: `ed25519-dalek` 2.x (BSD-3-Clause), the mature 2.x line of the standard Rust Ed25519 crate. `sha2` 0.10, `hex` 0.4 and `prost` 0.14 were already in the tree via librustzcash.
- `wallet send` (no approval) is now refused on every network except regtest.

## D-010 — 2026-10-20 — Owner key registered
Maris generated the owner key on her own machine with `lute-owner init` (Windows build from CI run 39502798819, `lute-owner.exe` sha256 a884ef7d…55e6). The private key file stays on her machine; no agent read it.
- Owner public key: `32d83d54774894739ad3a1163632df37fd035598f0c09e0057a05e25b4725244`
- Registered on the VPS as `/opt/zlute/owner.pub` (mode 0444); file sha256 `1da296dc0872777939426300eee4e42502242e97315f88c501b130ade9b3f9c4`.
- Any change to that file must be treated as an incident (D-009 residual risk). Regtest evidence runs use a separate disposable key under `/opt/zlute/regtest-owner/`.

## D-011 — 2026-10-20 — API stack dependencies and a TLS fix
- `apps/api`: `fastify` 5.12 (MIT), `zod` 4.6 (MIT), `drizzle-orm` 0.45 (Apache-2.0), `pg` 8.23 (MIT), `@node-rs/argon2` 2.2 (MIT; prebuilt argon2id, no native toolchain needed). These are the mandate's stack (§12).
- Test-only: `@electric-sql/pglite` 0.5 (Apache-2.0), embedded Postgres so API/DB tests run locally and in CI without Docker. Production uses Postgres 16 via `pg`.
- Workspace dev tools pinned at the root: `typescript` 7.0.2, `vitest` 5.0.5, `@types/node` 26.6.5. TS 7 does not auto-include `@types`, so `tsconfig.base.json` lists `"types": ["node"]`.
- Field encryption at rest uses `node:crypto` AES-256-GCM (allowed by §19.11); no libsodium dependency.
- **TLS fix (sidecar):** rustls 0.23 was compiled with no crypto provider, so the first TLS connection (`server-info https://zec.rocks:443` on the VPS) panicked. Enabled exactly one provider (`ring`, already in the tree) and install it at startup; a regression test asserts a provider is available.

## D-004 — 2026-10-20 — Node version
Installed Node is v26.4.0. The mandate asks for an LTS. Pin via `.nvmrc`/`engines` once the build host is fixed; if v26 is not LTS on the build date, use the current LTS line.
