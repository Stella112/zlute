# Environment audit (P0)

Audited 2026-10-20 by Claude Code. No secret values recorded.

## Host (Windows)

| Item | Found | Mandate requirement | Status |
|---|---|---|---|
| OS | Windows 11 Pro 10.0.26300 | Windows + WSL2 | OK |
| CPU | Intel i5-1135G7, 4 cores / 8 threads | — | OK |
| RAM | 7.7 GB total | — | Tight for Rust + Docker + Postgres + Next.js at once |
| Free disk (C:) | **7.5 GB** | Docker images, Rust `target/`, node_modules, Postgres | **BLOCKER B-001** |
| git | 2.53.0 | — | OK |
| Node.js | v26.4.0 | Node LTS | Check: v26 may not yet be LTS (see D-004) |
| pnpm | 10.34.6 | — | OK |
| Rust | rustc / cargo 1.96.0, rustup 1.29.0 | stable | OK |
| Docker / Compose | **not installed** | Docker Desktop + Compose ≥ 2.24.4 (Z3) | **BLOCKER B-002** |
| gitleaks | not installed | pre-commit | B-003 |
| PostgreSQL client | not installed | Postgres 16 (planned in Docker) | depends on B-002 |

## WSL2

| Item | Found | Mandate | Status |
|---|---|---|---|
| Distro | **Debian 13 (trixie)**, WSL2 kernel 5.15.146.1, stopped by default | Ubuntu | Deviation, see Q-001 |
| WSL memory | ~2 GB visible, 4 vCPU | — | Too small to compile librustzcash comfortably |
| WSL disk | VHD reports 952 GB free, but it is a sparse VHDX stored on C:, which has 7.5 GB free | — | Real limit is C: free space |
| Tools in WSL | git 2.47.3, gcc 14.2, protoc 3.21.12, pkg-config 1.8.1 | — | No node, no Rust, no Docker |

## Rough disk budget (estimates, not measured)

| Component | Estimate |
|---|---|
| Docker Desktop + WSL data | 3–5 GB |
| Z3 images (Zebra, Zallet, Zaino) + regtest chain | 2–4 GB |
| Rust `target/` for the sidecar (librustzcash, orchard, sqlite, tonic), debug | 3–6 GB |
| node_modules (Next.js, Playwright browsers) | 1.5–2.5 GB |
| Postgres image + data | ~0.5 GB |
| **Total** | **~10–18 GB**, against 7.5 GB free |

These are estimates; replace with measured values once the build runs.

## Candidate host: shared VPS `hbar-vps` (38.49.209.149), inspected 2026-10-20 (read-only)

| Item | Found |
|---|---|
| OS / virt | Ubuntu 24.04.4 LTS, KVM |
| CPU | **2 vCPU** (AMD EPYC 7551P) |
| RAM | 7.9 GB total, **~3.6 GB available**; swap 4 GB with 3.1 GB in use |
| Disk | 484 GB, 302 GB free |
| Load | ~0.55 (mostly idle) |
| Docker | 29.8.0, Compose v5.5.1 (meets Z3's ≥ 2.24.4) |
| Node | v22.23.1; no Rust toolchain |
| Existing tenants | 12 containers (Everpiece test + mainnet indexers, an older unrelated "lute-release-*" / "lute-db-*" deployment, blink-postgres) and 13 pm2 apps; Caddy on :80/:443 (admin 127.0.0.1:2019) |
| Port 3000 | taken; Lute must use other ports |

**2026-10-20 cleanup (owner-authorized):** the old web Lute (82 containers, `/opt/lute-*`, volume, network, image, `uselute.xyz` Caddy block) and the Canton Lute files in `/home/lute` were deleted after a backup to the owner's PC (`C:\Users\Admin\lute-old-backup\`). The `lute` Linux account (uid 1000) was kept empty because Everpiece containers run as uid 1000. Afterwards: 312 GB disk free, ~3.6 GB RAM available, 8 containers + 12 pm2 apps healthy. ~20 GB of unused Docker build cache remains (prune not run).

Conclusions: runtime fits with memory caps; compiling the sidecar on this host does not (2 vCPU, ~3.6 GB). Container/volume names must not start with `lute-` (collision with the older deployment); use the prefix `zlute-`.

## Network

- crates.io reachable (crate metadata and sources downloaded for verification).
- zec.rocks: TLS reachability **not yet tested** (tool permission check failed; retry in P1b).
