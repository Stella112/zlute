# Lute audit, 28 October 2026

A full pass over the live service (https://uselute.xyz, Zcash mainnet), the repository and the test suites, looking for privacy leaks, errors and usability problems. Self-audit: run by the team, not an independent reviewer.

**Verdict:** no privacy leak found. One undocumented metadata exposure (block-explorer links) was found and removed. Every test suite passes. Two usability problems were found and fixed. Remaining limits are listed at the end, as they are on the Privacy page.

## Summary

| Area | Result |
|---|---|
| On-chain privacy | **16/16** mainnet transactions fully shielded in one pool, nothing transparent ([E-021](docs/PRIVACY-EVIDENCE.md)) |
| Public pages and API | Capability links only (128-bit ids); no owner identity returned; unknown ids are 404 |
| Browser | No third-party requests on any page; `no-referrer`; strict CSP; no block-explorer links |
| Server logs | No addresses, memos or payment links in 72 h of API, web and wallet logs; no HTTP access log |
| Database | Addresses and memo text encrypted; LuteGuard decisions hold reason codes only |
| Repository | No tokens, keys or recovery phrases; one full Lute receive address in an evidence file (below) |
| Authentication | Session cookie `HttpOnly; Secure; SameSite=Strict`; origin check; login rate limit; unique usernames |
| Dependencies | `pnpm audit --prod`: no known vulnerabilities |
| Tests | 277 pass: luteguard 50, core 64, api 75, mcp 7, web 5, sidecar 70, lute-owner 6 |
| Live site | 13 public pages × desktop and mobile: all 200, no page errors, no horizontal overflow, 0 broken internal links |

## 1. Privacy

### 1.1 On chain
Every transaction id Lute knows (all `actions.txid` and `payment_requests.txids` rows, plus the two pre-database mainnet transactions) was inspected with `lute-sidecar wallet inspect-tx`. Results: [evidence/mainnet/e021-onchain-audit-2026-10-28.txt](evidence/mainnet/e021-onchain-audit-2026-10-28.txt).

- 16/16 `SHIELDED_SINGLE_POOL`: 0 transparent inputs, 0 transparent outputs, 0 Sprout, 0 Sapling, 0 Orchard; 2 to 4 Ironwood actions each.
- Only the network fee leaves the shielded pool (10,000 to 20,000 zat).
- Includes the AI agent's MCP settlement (`ac68ee91…a6d5`), the BatchPay payroll (`26c815f9…a9be`, 3 actions), the browser-signed payout (`e8f1de04…887a`) and paid payment requests.

### 1.2 Public pages and endpoints
Endpoints reachable without login: `/v1/public/requests/:id`, `…/requests/:id/check`, `…/receipts/:id`, `…/receipts/verify`, `…/receipt-key`, `…/payslips/:id`, `…/subscriptions/:id`.

- Each requires a 128-bit random id (the link is the capability). Malformed or unknown ids return 404 without detail.
- None returns the owner's identity. Request descriptions are encrypted with a key held in the link's `#fragment`, which browsers never send to the server.
- Pay, payslip and subscription responses set `cache-control: no-store` and `referrer-policy: no-referrer`.
- A payslip shows only that person's line (label, amount, network, txid, signature). Receipts carry no address and no item text (the item is a salted commitment in v2).

### 1.3 Browser
- Crawl of every public page on desktop and mobile: **zero requests to any other origin**.
- Headers on every page: `Content-Security-Policy` with `connect-src 'self'`, `font-src 'self'`, `img-src 'self' data:`, `frame-ancestors 'none'`; `Referrer-Policy: no-referrer`; `X-Content-Type-Options: nosniff`.
- **Finding P-1 (fixed):** the app and the evidence page linked transactions to blockchair.com. Opening one tells that site the visitor's IP address and which transaction they care about. Not a leak by Lute, but undocumented. **Fix:** no block-explorer links anywhere (`apps/web/lib/format.ts`, docs renderer); the Activity page explains why; a test checks it.

### 1.4 Server
- `docker logs` of `zlute-api` and `zlute-web` and the sidecar journal (72 h): no unified/Sapling addresses, no `LUTE:` memo refs, no request URLs.
- The shared Caddy has no `log` directive for uselute.xyz: no HTTP access log, so payment-link paths are not recorded.
- Database (schema review): `recipient_address_enc`, `memo_text_enc`, labels and plan names are AES-256-GCM ciphertext; `recipient_ref` and `memo_ref` are opaque ids; LuteGuard `checks` store reason codes, not addresses. An earlier full dump search found 0 plaintext note matches (E-014).

### 1.5 Repository
`git grep` for full unified/Sapling/transparent addresses, agent tokens, private keys and data keys:
- No tokens, keys or recovery phrases.
- **Finding P-2 (accepted):** `evidence/mainnet/p1b-request.txt` contains one full mainnet receive address (a Lute request address from the first mainnet test). A shielded address reveals no balance or history; removing it would need another history rewrite. Left as is.
- The transparent address in `services/wallet-sidecar/src/inspect.rs` is a test vector.
- Demo-video screenshots showing an unpaid request's QR code are excluded from the repository.

## 2. Security

| Check | Result |
|---|---|
| Unauthenticated access to private endpoints (`/v1/requests`, `/v1/streams`, `/v1/subscriptions`, `/v1/payroll/members`, `/v1/me`) | 401 |
| Login from another origin | `BAD_ORIGIN` |
| Login rate limit | 8 attempts, then 429 |
| Malformed JSON | 400 with a code, no stack trace |
| Session cookie | `HttpOnly; Secure; SameSite=Strict` |
| HTTP | 308 redirect to HTTPS |
| HSTS | **Finding S-1 (fixed):** not sent; `Strict-Transport-Security: max-age=31536000` added |
| Usernames | `UNIQUE` in the database plus a check at sign-up; `[a-z0-9_]{3,32}` only, so no case or look-alike collisions |
| Agent tokens | Scoped to one grant and one payee; revocable; expired or replayed approvals pay nothing (E-015) |
| Dependencies | `pnpm audit --prod`: no known vulnerabilities |

## 3. Errors and tests

| Suite | Result |
|---|---|
| Type check (all workspaces) | pass |
| luteguard | 50/50 |
| core | 64/64 |
| api | 75/75 (run one file at a time; in parallel the in-memory Postgres instances run out of WebAssembly memory on a laptop, not in CI) |
| mcp | 7/7 |
| web | 5/5 |
| sidecar (Rust, CI run 40538668499 @ 2017459) | 70/70 |
| lute-owner (Rust, CI run 40536099107 @ 09b6fb3) | 6/6 |
| Production web build | pass |
| CI on the deployed commit | green |

Live health: `/v1/health` → `{"ok":true,"network":"main"}`; `/login` → 200.

## 4. Usability

Crawl of 13 public pages (landing, sign-in, sign-up, payer preview, docs, pay/payslip/receipt/subscription pages with unknown ids) at 1440×900 and 375×812:
- every page 200, no JavaScript errors, no horizontal overflow on mobile;
- 15 internal links, 0 broken;
- unknown payment ids show a clear "No such payslip / receipt / subscription" message;
- the landing page and docs follow the system theme, with a manual switch.

Findings:
- **U-1 (fixed):** the dashboard balance waited for a full wallet sync before answering, so after a restart it could show "…" for a long time. The balance now answers from the last synced state immediately and syncs in the background (`apps/api/src/dashboard.ts`).
- **U-2 (fixed):** landing-page sections were hidden until JavaScript loaded, so a slow connection saw an empty page. Content is now visible by default; only sections below the fold animate in.
- **U-3 (fixed):** signed-in users had no way back to the public site from the app. The logo in the app now links to the landing page.
- **U-4 (note):** the signed-in app's home lives at `/`; visitors who are not signed in see the landing page.

## 5. Known limits (unchanged, documented)

- **Operator visibility:** hosted Lute sees payment activity through viewing keys (amounts, timing, wallet history). New accounts are non-custodial (browser-signed); the AI-agent wallet and accounts created before 27 Oct 2026 are custodial ([docs/CUSTODY.md](docs/CUSTODY.md)).
- **Network metadata:** the light-wallet server (zec.rocks) sees the server's IP and timing, never keys, amounts or memos; `inspect-tx` asks it for specific txids ([docs/PRIVATE-PAID-APIS.md](docs/PRIVATE-PAID-APIS.md)).
- **Batch size:** a BatchPay transaction reveals its number of outputs, not who or how much.
- **Usernames:** adding an unknown username to a payroll team says it does not exist, which confirms which usernames exist. No payment data is involved.
- **Regtest only:** checkout, receipts, refunds and subscriptions are proven on regtest (E-012, E-013), not yet on mainnet.
- **Review:** self-review only; no external audit yet.

## 6. Not covered

- Creating a new account on production (the operator does not create accounts on the live service); sign-up is covered by the API tests and E-016/E-017.
- A fresh agent payment after 14:06 UTC today (the mandate expired; a new one needs the owner's signature).
- Timing and traffic analysis beyond what is listed above.
