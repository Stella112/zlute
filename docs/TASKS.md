# Tasks

| ID | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| P0-01 | Environment audit | Claude | done | docs/ENVIRONMENT.md |
| P0-02 | Capability ledger (crates, NU6.3, light server, Tor) | Claude | done (DOCUMENTED; network checks pending) | docs/CAPABILITIES.md |
| P0-03 | Repo init, private GitHub repo, gitleaks in CI | Claude | done | CI `gitleaks` job |
| P0-04 | Hosting decision + VPS cleanup | Claude/owner | done | D-005, ENVIRONMENT.md |
| P1a-01 | Sidecar address inspection | Claude | done | W1, W2, W3 (address part), W9 unit tests |
| P1a-02 | Sidecar compiles in CI with pinned crates; release artifact | Claude | done | CI `test-and-build` |
| P1a-03 | Z3 regtest stack on VPS (`zlute-` prefix, memory-capped) | Claude | done (Zaino 0.10.2) | Zebra + Zallet + Zaino up; `rpc.discover` recorded |
| P1a-04 | Sidecar regtest sync from Zaino; network params for regtest | Claude | done | C-014 PROVEN |
| P1a-05 | ZIP-321 build/parse | Claude | todo | W10 + §19.2 parse tests |
| P1a-06 | Proposal building + single-pool / zero-transparent enforcement | Claude | done (unit + regtest) | W5, W6, W7, W11 |
| P1a-07 | Proposal hash binding, approvals, caps | Claude | todo | W8, W12, W13, W14 |
| P1a-08 | Real regtest shielded send + receive | Claude | done (E-002) | W17 |
| P1b-01 | zec.rocks TLS + GetLightdInfo (chain at NU6.3) | Claude | todo | C-011 PROVEN |
| P1b-02 | Owner key init, mainnet sync, funding (owner) | Owner + Claude | todo | — |
