# Build status

## 2026-10-20 23:55 WAT — Claude Code — P1a gate work + P2 started (session paused: usage limit)
IMPLEMENTED: sidecar approvals (owner-signed, one-use, caps, TTL, control DB precheck), ZIP-321 build/parse, sealed seeds (key file outside the wallet dir), server-info, authenticated loopback HTTP API (HMAC), rustls ring provider fix; tools/lute-owner (Win/Linux); packages/luteguard (50 tests), packages/core executeAction (39 tests), apps/api Fastify+Drizzle+Postgres (17 tests on PGlite); docs PRIVACY.md (light server), API.md (sidecar contract).
VERIFIED: approvals run 1 on regtest (evidence/regtest/approvals-run1-2026-10-20.log): W14a, NO_APPROVAL, forged approval rejected, approved payment broadcast + recipient verified (txid f3b8fe3c…34f6), W8 HASH_MISMATCH, W12 PROPOSAL_EXPIRED. W13 and W14b were not demonstrated in run 1 (wrong denial reason / stale proposals); fixed in code, rerun pending. Owner key registered (D-010).
NOT DONE / IN FLIGHT:
- Approvals run 2 did not execute (script had CRLF on the VPS). Rerun: `bash /opt/zlute/infra/approvals-evidence.sh > /opt/zlute/logs/approvals-run2.log` after re-uploading the LF script.
- Background job: deploy of the TLS-fixed sidecar (commit before "infra: mainnet wallet init") + `mainnet-init.sh` (creates mainnet merchant/payout wallets, sealed seeds, syncs zec.rocks). Check /opt/zlute/logs/mainnet-init.log; C-011b depends on its server-info output.
- Never chain deploy | tail: use the fail-fast form (deploy output captured, `|| exit`).
NEXT ACTIONS: confirm mainnet-init; record C-011b; give owner the payout/merchant addresses for funding (≤ 0.1 ZEC); first mainnet send via API + owner signature (W18); deploy apps/api + Postgres 16 on the VPS (zlute- prefix, capped); requests/checkout module.
MODULE STATUS: send=PARTIAL(regtest) requests=UNTESTED commerce=UNTESTED refunds=UNTESTED groups=UNTESTED streams=UNTESTED meter=UNTESTED subs=UNTESTED sdk=UNTESTED mcp=UNTESTED crosschain=PARTIAL(classifier only) privacy-center=UNTESTED

## 2026-10-20 22:30 WAT — Claude Code — P1a: W17 passed on regtest
IMPLEMENTED: sidecar wallets (init/sync/address/balance), single-pool policy (policy.rs), send (inspect → propose → policy → prove/sign → broadcast once), verify (decrypt with own UFVK), fetch-params; fixture funding via Zebra Ironwood coinbase (D-007); W17 evidence script.
VERIFIED: E-001 (W1 sidecar denial), E-002 (W17: txid 735aa8d2…68c9, Ironwood, recipient sees 1,000,000 zat + memo LUTE:w17 at height 143), E-003 (CI 39499446178 green). Zaino 0.10.2 needed for Ironwood (C-019).
TEST RESULTS: pass W1(sidecar), W2, W3(address), W5, W6, W9 (unit), W17 (regtest). Not run: W7, W8, W10–W16, W18, all U/F/S/M/G/A/X.
PRIVACY STATUS: single-pool + zero-transparent enforced in the sidecar. Known leaks to the light server not yet documented in PRIVACY.md: birthday height (GetTreeState), txid interest (GetTransaction in verify), IP/timing.
CODEX FINDINGS: not reviewed.
BLOCKERS: B-005 Zallet (fallback D-007 in use). Owner's network is weak: long SSH sessions drop, so VPS work runs as detached jobs with logs under /opt/zlute/logs.
NEXT ACTIONS: P1a-07 proposal hash binding + one-use approvals + caps (W8, W12–W14) and sidecar control DB; P1a-05 ZIP-321 build/parse; PRIVACY.md light-server section; then P1b mainnet (encrypted key storage, owner key).
REPOSITORY STATE: branch claude/p1a-sidecar; evidence/regtest/w17-2026-10-20.log.
MODULE STATUS: send=PARTIAL(regtest) requests=UNTESTED commerce=UNTESTED refunds=UNTESTED groups=UNTESTED streams=UNTESTED meter=UNTESTED subs=UNTESTED sdk=UNTESTED mcp=UNTESTED crosschain=UNTESTED privacy-center=UNTESTED

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
