# Blockers

## I-001 (INCIDENT) — 2026-10-20/21 — Lute's regtest Zallet filled the shared VPS disk — RESOLVED
**What happened:** `zlute-z3-zallet-1` (Zallet `v0.1.0-beta.1`, regtest only) logged a mempool-stream error (`zaino_state … StatusError { server_status: Closing }`) in a tight loop from about 2026-10-20 evening. Docker's default `json-file` log driver has no size limit; the log reached **333 GB** and the VPS root filesystem hit **100%** (484 GB). Lute's memory caps did not cover disk.
**Impact:** every tenant on the shared VPS ran with a full disk for roughly 13 hours. Detected 2026-10-21 12:35 UTC when a Lute deploy failed with "No space left on device". After recovery: all pm2 apps and Everpiece's sites were fine, except the **Everpiece test indexer stack** (`everpiece-indexer-hasura` unhealthy, HTTP 500), repaired with the owner's OK (see "Co-tenant repair" below).
**Fix (12:37 UTC):** stopped and removed the Zallet container, truncated its log (regtest error lines only) → 311 GB free. Zallet is now in a `never` profile (Lute does not use it, D-007). **Every Lute container now has `json-file` max-size 10m × 3** (regtest overlay and the API/Postgres compose).
**Prevention:** log caps are mandatory for any Lute container; a disk-usage check is part of every VPS status check. **Disk watchdog** (owner-approved 2026-10-21): `/etc/cron.d/zlute-disk-watchdog` runs `/opt/zlute/infra/zlute-disk-watchdog.sh` every 5 minutes; at >= 90% root-disk use it stops only `zlute-*` containers and `zlute-*` systemd units and logs to `/opt/zlute/logs/watchdog.log` (capped at 1 MB). Stop path tested on a throwaway `zlute-watchdog-test` container (PASS).
**Co-tenant repair (owner-approved 2026-10-21 13:46 UTC):** `everpiece-indexer-db` and `everpiece-indexer` had exited at 23:33 UTC during the full disk (Docker's `ps` showed a stale "Up"), so `everpiece-indexer-hasura` could not resolve `indexer-db`. Started the DB (Postgres crash recovery: "redo done … ready to accept connections"), then the indexer; Hasura `/healthz` 200; all Everpiece containers healthy and running; both sites 200. Everpiece mainnet indexer was never affected.

## B-005 — Zallet `z_getnewaccount` hangs on regtest — OPEN (not needed: D-007; Zallet disabled after I-001)
**Tried (2026-10-20, Z3 e84ce9f, `zodlinc/zallet:v0.1.0-beta.1`):** `rpc.discover` works (35 methods). `z_getnewaccount []` → `-32602 Invalid params: No more params`. `z_getnewaccount ["lute-p1a-test", "<seedfp>"]` → no response (30 s timeout); later calls also timed out. Minutes later the VPS stopped answering SSH and HTTPS from this machine for ~4 minutes. Afterwards load was 0.54, no OOM kills, no SSH bans, Everpiece sites 200 again; most likely a network-path blip, not established. After a Zallet container restart, `rpc.discover` answers but `z_listaccounts` still hangs (> 15 s). Time-boxed; see D-007.
**Impact:** Zallet is only the regtest funding source and second wallet. Fallback under evaluation: mine regtest coinbase directly to a Lute-controlled fixture account, labeled as a fixture.


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

## B-004 — `docs/LUTE_SPEC.md` (product spec) not present — CLOSED 2026-10-20 (owner provided it; differences logged in D-008)
The working directory was empty at start. The mandate references the spec as the WHAT. Building proceeds from the mandate alone until it arrives.
