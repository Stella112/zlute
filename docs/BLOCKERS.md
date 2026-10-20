# Blockers

## B-001 — Free disk space: 7.5 GB on C: — OPEN, owner action
**Tried:** measured with `Get-PSDrive C`. The WSL VHD is on C: too, so WSL does not help.
**Needed:** roughly 10–18 GB (estimate in `docs/ENVIRONMENT.md`) for Docker, Z3 images, the Rust build and node_modules. Recommend freeing **≥ 25 GB**, or pointing Docker's data and the repo at another drive.
**Blocks:** P1a (Z3 regtest), building the sidecar, Postgres.

## B-002 — Docker Desktop not installed — OPEN, owner action
**Tried:** `docker` not found on Windows or in WSL.
**Needed:** Docker Desktop with WSL2 integration and Compose ≥ 2.24.4 (Z3 requirement). Software installation on the owner's machine; not done by the agent.
**Blocks:** P1a, Postgres, docker-compose stack.

## B-003 — gitleaks not installed — OPEN, minor
**Needed:** gitleaks binary for the pre-commit hook. Can be installed by the agent once disk space allows (small binary); listed so it is not forgotten.

## B-004 — `docs/LUTE_SPEC.md` (product spec) not present — OPEN, owner action
The working directory was empty at start. The mandate references the spec as the WHAT. Building proceeds from the mandate alone until it arrives.
