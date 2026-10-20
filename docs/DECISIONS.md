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

## D-004 — 2026-10-20 — Node version
Installed Node is v26.4.0. The mandate asks for an LTS. Pin via `.nvmrc`/`engines` once the build host is fixed; if v26 is not LTS on the build date, use the current LTS line.
