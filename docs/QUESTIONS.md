# Questions for Maris

## Q-001 — 2026-10-20 — Build host (ANSWERED: shared VPS + CI builds, D-005/D-006)
The machine has 7.5 GB free disk, no Docker, and a Debian (not Ubuntu) WSL2 with ~2 GB RAM. Options:
1. Free ≥ 25 GB on C:, install Docker Desktop (WSL2 backend), raise WSL memory to ~6 GB in `%UserProfile%\.wslconfig`, install Ubuntu or approve Debian.
2. Same, but put Docker data and the repo on another drive, if one exists.
3. Build and run the sidecar natively on Windows (Rust 1.96 is already installed there, with 7.7 GB RAM) and use Docker only for Z3 and Postgres.

Recommendation: option 1 or 2, and approve Debian 13 instead of Ubuntu (nothing in the stack needs Ubuntu specifically).

## Q-002 — 2026-10-20 — Product spec (ANSWERED: docs/LUTE_SPEC.md added)
Please add `docs/LUTE_SPEC.md`.

## Q-003 — 2026-10-20 — Zodl and NU6.3 (ANSWERED: Zodl Android 3.17.1 (3155) supports Ironwood; owner to finish "Move to Ironwood" before P1b, C-016a)
Please confirm your Zodl version can send after NU6.3 (Ironwood). Lute's receive addresses will be shielded UAs whose Orchard receiver is paid in the Ironwood pool (D-002).
