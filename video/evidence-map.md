# Evidence map: what each shot shows

Every shot in `final-video.mp4` carries a label for the kind of proof it is:

| Label | Meaning |
|---|---|
| **MAINNET** | A real Zcash mainnet transaction, or a decision recorded on the live service |
| **REGTEST** | Proven end to end on a local regtest chain, not yet on mainnet |
| **LIVE PRODUCT** | A real screen or component of uselute.xyz / the repo, captured 28 Oct 2026 |
| **DIAGRAM** | An illustration, not a recording |
| **TESTS** | Automated test results (`evidence/results.json`) |

Evidence IDs refer to [`docs/PRIVACY-EVIDENCE.md`](../docs/PRIVACY-EVIDENCE.md).

| Time | Shot | Source | Label | Evidence |
|---|---|---|---|---|
| 0:05–0:15 | Dashboard, recent activity with agent payments (Confirming, Blocked) | Real screen of the owner's mainnet account (`app-home.png`) | MAINNET | The agent run below |
| 0:15–0:20 | Request paid, 0.0004 ZEC, confirmed | The owner's own screenshot of a paid request page, 28 Oct | MAINNET | Request flow: E-004, E-005 |
| 0:20–0:31 | Lute MCP server and its 10 tools | Tool names from `apps/mcp/src` | LIVE PRODUCT | MCP suite 7/7 |
| 0:31–0:52 | Agent run via MCP: status, session, quote, extract, reuse 409, settle | Replay of the real transcript of the run on 28 Oct 13:46 UTC | MAINNET | tx `ac68ee91…a6d5`, mined 3533628, `SHIELDED_SINGLE_POOL`; E-018 |
| 0:31–0:52 | Mandate: payee, ≤10,000 zat per payment, 30,000 budget, expiry | Values of the real owner-signed grant | MAINNET | Grant expired 28 Oct 14:06 UTC |
| 0:52–1:05 | 11 metered calls, settlement of 11,000 zat REJECTED `OVER_GRANT_PER_TX`; verify: #1 paid, #2 rejected | Same real run (transcript files 07–09) | MAINNET | DENY 28 Oct 13:49:33 UTC; E-011, E-015 |
| 1:05–1:13 | Agents page: metered services, HTTP 402 option, grants | Real screen | LIVE PRODUCT | E-010 (regtest), E-011 / E-018 (mainnet) |
| 1:13–1:26 | Accrual counter | Illustration, sped up 60× | DIAGRAM | n/a |
| 1:13–1:26 | Streams page, stream paid out 0.0003 ZEC | Real screen | MAINNET | E-008 |
| 1:26–1:36 | Subscriptions page | Real screen | REGTEST | E-013 (subscription lifecycle on regtest; invoices are ordinary shielded requests) |
| 1:36–1:44 | Payroll run CONFIRMED + payslip Paid and signed | Real screens | MAINNET | E-020, tx `26c815f9…a9be` |
| 1:44–1:50 | 277 tests, 11/11 mainnet txs single-pool, evidence page | Real evidence page + results | TESTS + MAINNET | `evidence/results.json` at 69a5866; E-014, E-017, E-020 + agent run |

## Not claimed

- Subscriptions and checkout have no mainnet proof yet. Subscriptions are labelled REGTEST.
- Selling an API over HTTP 402 is shown as a product screen, not as a recorded mainnet sale.
- The stream counter is an illustration; the stream payout itself is mainnet (E-008).
- The agent wallet is operator-custodied. Browser signing applies to new user accounts (E-016, E-017).
- External review: none yet (self-review only).
