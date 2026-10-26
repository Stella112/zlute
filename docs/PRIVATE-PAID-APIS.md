# Private paid APIs through MCP: what actually stays private

**Claim we want to be able to make:** an AI agent can pay for an API call by call, through MCP,
and neither the payment nor the request metadata becomes visible to anyone who does not need it.

Paying in shielded ZEC is necessary but nowhere near sufficient. A paid API call creates records in
at least nine places besides the blockchain. This document traces each one through Lute's
implementation (commit references are to this repo), says what is protected, and says plainly what
still leaks. Evidence: E-010 (regtest), E-011 (mainnet).

## 1. Why "x402 next to Zcash" is not enough

x402-style payments work like this: the API answers `402 Payment Required` with payment
requirements (amount, asset, network, pay-to address, the resource URL, a description); the client
pays and retries with a payment header; a *facilitator* service verifies and settles the payment
for the API. Swapping the asset for shielded ZEC hides the on-chain transfer, but everything around
it can still leak:

| Channel | What leaks if you only change the asset |
|---|---|
| **Resource URL** | The paid URL (often with query parameters: the search term, the document id, the prompt) is in the 402 response, the payment header, the facilitator's records and every HTTP log on the way. |
| **402 response** | Amount, pay-to address and resource travel in clear HTTP headers/bodies; a reused pay-to address links every client of the API. |
| **Facilitator** | A third party sees payer, payee, amount, resource and time for every call: it is a complete usage ledger, whatever the chain hides. With Zcash it would also need a viewing key or txid lookups to verify. |
| **Server and proxy logs** | Access logs keep URL, client IP, timing and often headers (including payment headers) indefinitely. |
| **Receipts** | Receipts that repeat the resource, amount, payer and txid become a portable record of what the agent bought. |
| **Agent history** | Everything a tool returns is copied into the agent's conversation, which the AI provider stores: amounts, URLs, txids, account ids. |
| **Light-wallet server** | Verifying a payment by asking a public server for a specific transaction tells that server which transaction you care about, and from which IP. |
| **Timing** | Call times and payment times correlate; whoever sees both can link a payment to a request even when the payment itself is shielded. |
| **Credentials** | A long-lived API key or payment key in the agent's environment can be read by anything that reads the agent's context or config. |

## 2. What Lute does instead

```
agent (MCP client) ──stdio──> lute MCP server ──HTTPS, bearer token──> Lute API
                                                       │ executeAction → LuteGuard (grant checks first)
                                                       └──HMAC, loopback──> wallet sidecar (mandate checks, signs, broadcasts)
```

- **No facilitator.** Lute's own wallet sidecar builds, signs and broadcasts the payment and checks
  confirmations from its own wallet database (`Wallet::tx_status`, `services/wallet-sidecar/src/wallet/incoming.rs`):
  no third party learns about the call, and no per-transaction query goes to the light server.
- **No address or amount in any URL.** Agent routes carry only random 128-bit ids
  (`/v1/meter/sessions/<id>/call`). The 402 body carries the amount due and the credit limit, never
  a pay-to address: the recipient is resolved on the server from the agent's grant
  (`apps/api/src/agents.ts`), so the agent never handles an address and prompt-injected text cannot
  redirect a payment (test A8).
- **One budget, signed once.** The owner signs a mandate (wallet, per-payment cap, total, one allowed
  recipient, ≤ 48 h). The sidecar re-checks it atomically on every spend, even if the API is bypassed
  (`OVER_MANDATE_TOTAL`, `RECIPIENT_NOT_IN_MANDATE`, `NO_APPROVAL` in E-010).
- **Shielded, single pool, opaque memo.** Each settlement is an Ironwood-only transaction with a
  random `LUTE:<ref>` memo. On chain: no sender, recipient or amount; the memo is visible only to the
  recipient and carries no meaning outside Lute.

## 3. Leak trace, channel by channel

| Channel | What Lute does | What still leaks | Status |
|---|---|---|---|
| **URLs** | Only opaque ids in paths; no query strings with content; pay-to address never in a URL. | The session id is in the URL (it is a capability, not identity). | Protected |
| **402 / responses** | 402 body: `due_zat`, `credit_limit_zat`. All API responses are `Cache-Control: no-store` (apps/api/src/app.ts). | The amount owed, to the agent (it must know it). | Protected |
| **Facilitator** | None: Lute verifies with its own wallet DB. | — | Protected |
| **Light-wallet server** | Agent payments are confirmed from the sidecar's own DB during regular syncs; no `GetTransaction` for them. | Regular sync reveals the wallet's IP, timing and birthday height to zec.rocks (docs/PRIVACY.md). Payment *requests* from wallets (not agents) still use `GetTransaction` to read memos. | Partial |
| **Logs** | uselute.xyz has no access log in Caddy; the web and API servers log no requests; the API logs only error class and code location, never messages (U4). Container logs are size-capped. | The OS and the hosting provider see connection metadata (IP, timing, sizes). | Protected (app) |
| **Database** | Recipients, memos and notes are encrypted at rest (AES-256-GCM); agent tokens are stored as hashes. | The operator's database still records which grant made which call and when, and amounts (needed for budgets). | Partial |
| **On chain** | Shielded Ironwood-only, zero transparent, no cross-pool reveal (LuteGuard + sidecar). | That a shielded transaction occurred, when, and its fee. | Protected |
| **Receipts** | Metered calls produce no receipts. (Checkout receipts carry amounts, txids and only a *hash* of the item.) | The agent's own session view lists its settlements. | Protected |
| **Agent history** | MCP tools take only a session id as input and return only what the next step needs: status, amounts, budget, the session id. Grant, mandate, service and action ids and txids are withheld (`apps/mcp/src/tools.ts`, test "withholds linking identifiers"). `LUTE_MCP_VERBOSE=1` opts back in. | Amounts and call counts go into the conversation the AI provider stores. Use a local model to avoid that. | Partial |
| **Credentials** | The agent token is grant-scoped, shown once, stored by Lute only as a hash, revocable; it can only pay one recipient inside the signed budget. | It sits in the MCP client's config file on the agent's machine. Anyone who reads it can spend the remaining budget until it is revoked or the mandate expires. | Partial |
| **Timing** | — | The Lute operator (and the service) can correlate call times with settlement times. Settlements are batched by the credit limit, which blurs per-call timing on chain. | Leaks to operator |
| **The service** | The service learns usage (calls, timing) and payments, not who the agent's owner is. | In this build the demo service is run by the Lute operator, so service and operator are the same party. | Leaks to operator |

## 4. Who learns what (paid API call through Lute's MCP)

| Party | Learns |
|---|---|
| Public chain observer | A shielded transaction happened, and its fee. |
| Light-wallet server (zec.rocks) | The Lute server's IP and sync timing. Not the agent, not the amount, not the API call. |
| AI provider (agent conversation) | That the agent used a metered API, how many calls, amounts and budget. No addresses, no linking ids, no keys. |
| The paid service | The calls (it serves them) and that they were paid. |
| Lute operator | Everything about the grant: calls, timing, amounts, budget. This is the honest centre of trust in the hosted version. |
| Other parties (other Lute users, network observers without the above access) | Nothing from Lute's outputs that we have found; the residual network metadata in §3 still applies. |

## 5. Verdict

- **Proven:** the payment is private on chain; there is no facilitator; no URL, log or receipt carries
  the payment or the request content; the agent cannot redirect or exceed a payment; tool output is
  minimized (E-010, E-011, the tests named above).
- **Not yet private:** from the **Lute operator** (who runs the hosted API, and here also the demo
  service) and from the **AI provider** (amounts and call counts in the agent's history). The claim
  "private paid APIs" therefore holds against the chain, network observers, other users and third
  parties; it does not hold against the operator of the hosted instance.

## 6. What would close the remaining gaps

1. **Self-host** the API and sidecar (removes the operator) and sync from a self-run Zebra + Zaino
   (removes the light server).
2. **Separate the service from the payer's Lute**: the service runs its own Lute, and receives with a
   fresh address per session, so the payer's operator never sees what is served.
3. **Local agent** (a local model or a client that does not retain tool output) for the agent history.
4. **Network privacy** for the agent and for sync (Tor or a mixnet) against timing and IP correlation.
5. **Short-lived tokens** derived per session from the mandate, so a leaked config cannot spend the
   whole remaining budget.
