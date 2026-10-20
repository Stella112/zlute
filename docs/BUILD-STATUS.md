# Build status

## 2026-10-20 17:00 WAT — Claude Code — P0 complete, P1a in progress
IMPLEMENTED:
- docs: MANDATE (saved copy), ENVIRONMENT (local + VPS), CAPABILITIES, DECISIONS D-001..D-007, BLOCKERS, QUESTIONS, TASKS.
- Private repo https://github.com/Stella112/zlute (main + claude/p1a-sidecar).
- services/wallet-sidecar: recipient inspection (`inspect`), CLI `lute-sidecar inspect <net> <addr>`.
- CI (.github/workflows/sidecar.yml): fmt, clippy -D warnings, tests, release build artifact, gitleaks.
- infrastructure/z3: overlay (127.0.0.1 binds, memory/CPU caps, no rpc-router) + setup script.
- VPS: old Lute deployments removed (backup on owner PC); Z3 regtest running as `zlute-z3` in /opt/zlute.
VERIFIED:
- CI run 39449754399 green: 11/11 sidecar tests, gitleaks clean.
- Regtest: Zebra 6.2.3 at height 2, NU6.3 active (branch 37a5165b = zcash_protocol BranchId::Nu6_3), Zaino gRPC listening, all ports 127.0.0.1 only, stack ~42 MB RAM.
- zec.rocks TLS valid (C-011a).
- Release binary on VPS: /opt/zlute/bin/lute-sidecar sha256 a37d739f…ace7b.
TEST RESULTS: W1 pass, W2 pass, W3 (address part) pass, W9 pass. Everything else not run.
PRIVACY STATUS: D-002 single-pool rule (Ironwood or Sapling) encoded in inspection. Light-server analysis not started.
CODEX FINDINGS: not reviewed (Codex not engaged yet).
BLOCKERS: B-004 spec missing (owner); B-005 Zallet account RPCs hang (fallback D-007).
NEXT ACTIONS: P1a-04 sidecar wallet DB + sync from Zaino on regtest; fixture funding via mined coinbase (D-007); P1a-05 ZIP-321; P1a-06/07 proposals, binding, caps; P1a-08 W17.
REPOSITORY STATE: branch claude/p1a-sidecar, pushed.
MODULE STATUS: send=UNTESTED requests=UNTESTED commerce=UNTESTED refunds=UNTESTED groups=UNTESTED streams=UNTESTED meter=UNTESTED subs=UNTESTED sdk=UNTESTED mcp=UNTESTED crosschain=UNTESTED privacy-center=UNTESTED
