# Lute user guide

Lute turns shielded Zcash into everyday payments: payment links, checkout with receipts,
subscriptions, split bills, per-second streams, and AI agents that pay for services inside a budget
you sign. Every payment is shielded: on the blockchain nobody can see who paid whom, or how much.

- **App:** https://uselute.xyz (Zcash mainnet)
- **Who needs an account:** only you, the person getting paid or paying out. Your payers need
  nothing but a Zcash wallet that supports shielded payments, such as Zodl.
- **Custody:** accounts created from 27 Oct 2026 are non-custodial: the recovery phrase stays in your browser and every payout is signed there ([Custody](https://github.com/Stella112/zlute/blob/main/docs/CUSTODY.md)). The AI-agent wallet, and accounts created earlier, are custodial: Your Lute wallets are held on Lute's server; Lute's software pays
  out only with your approval key or a budget you signed, but the operator of the server could bypass
  that, and the approval-key backup does not restore the wallet. Keep working balances only. Details:
  [Custody](https://github.com/Stella112/zlute/blob/main/docs/CUSTODY.md).
- **What Lute sees:** hosted Lute can see payment activity needed to operate the service. Shielded
  payments protect your transaction details from public blockchain observers.

---

## 1. Your account and your key

### Create an account
1. Open **uselute.xyz → Get started**.
2. Pick a username (3 to 32 lowercase letters, digits or `_`) and a password (12+ characters).
3. Your browser creates your **approval key**. Only its public half is sent to Lute.
4. Lute creates your own three wallets, each with its own sealed seed and bound to that key:

| Wallet | Used for |
|---|---|
| **merchant** | Receiving: payment requests, checkout, subscriptions, split bills |
| **payout** | Paying out: sends, stream payouts |
| **agent** | AI agent payments, only inside a mandate you sign |

5. **Download the key backup** when asked, and keep it private. Without your key nobody, including
   Lute, can move money out of your wallets; with the backup file, anyone can.

### Key backup and restore
**Settings → Approval key** shows whether this browser holds your key. Use **Download key backup**
to save it and **Restore from backup** on a new browser or after clearing site data.

### How a payment is approved
Every payment out shows a **Confirm payment** screen: amount, recipient, network fee, total.
Type the code shown (for example `approve 1a2b3c4d`) and press **Confirm and pay**. Your browser
recomputes the payment's fingerprint from what is on screen and signs that, never a value supplied by
the server. The wallet sidecar refuses any payment not signed by your key.

> The install owner account (the original operator) signs on a laptop with the `lute-owner` tool
> instead of the browser. See `tools/lute-sign.ps1`.

### Theme
Light, dark or system: use the switch in the sidebar, the **More** tab or the top of the website.

---

## 2. Getting paid

### Payment requests
1. **Request**, enter an amount, optionally **Add a private note**, then **Create request**.
2. Show the QR code or tap **Share link**.
3. The page updates by itself: **Waiting** → **Payment seen, confirming** → **Paid**.

What your payer sees (`uselute.xyz/r/…`): the amount, the note, a QR code, **Open in my wallet** and
**Copy payment details**. Their wallet fills in the amount and a memo (`LUTE:…`); the memo is how the
payment is matched, so they should keep it. A request is **Paid** only with 3 confirmations (about
4 minutes); a partial payment stays **Confirming** until the full amount arrives.

**The note is private:** it is encrypted in your browser and the key travels only in the link's
`#…` part, which browsers never send to a server.

### Checkout (sell with receipts and refunds)
1. **Checkout**, enter the item and price, **Create checkout**, then share the **Checkout link**.
2. When paid, the order shows **Receipt**. Your customer also gets **View receipt** on their pay page.
3. **Receipts** are signed by Lute and show the amount, the transaction and a fingerprint of the item,
   with no address or item text. Anyone with the link sees **Signature valid**; an edited receipt
   shows **INVALID**.
4. **Refund:** **Refund** on a paid order, paste the customer's refund address (a shielded payment
   does not reveal its sender, so the customer gives you one), enter an amount up to what was paid,
   then confirm.

### Subscriptions
1. **Subscriptions → New plan**: name, price, period (10 minutes for demos, 1 day, 1 week, 30 days).
2. **Add a subscriber** and **Copy subscriber link**; send it to them.
3. Each period the subscriber's page shows that period's invoice. Status updates itself:

| Status | Meaning |
|---|---|
| Active | This period is paid |
| Due | Unpaid, inside the grace window (a quarter of the period, at most 3 days) |
| Lapsed | Unpaid after the grace window |
| Cancelled | You cancelled it |

Lute never takes money automatically: shielded Zcash has no auto-debit, so subscribers pay each
invoice from their own wallet.

### Split a bill
1. **Split a bill**, enter what it is for, the total and the names, then **Split**.
2. Each person gets their own link for their share (exact; any remainder is 1 zatoshi to the first
   names). **Copy link** next to each name.
3. Members never see each other. You see who has **Paid** and the total collected.

---

## 3. Paying out

### Pay
1. **Pay**, enter the amount and paste a shielded address (`u1…` or `zs1…`), then **Review**.
2. LuteGuard checks the exact transaction: one shielded pool, nothing transparent, the fee from the
   Zcash library, the right network, your limits.
3. **Confirm payment**, type the code, **Confirm and pay**. You see **Sent**, then the payment
   confirms in about 5 minutes (**Activity**).

Lute pays from your **payout** wallet if it has enough, otherwise from **merchant**.

| If you see | Why |
|---|---|
| Transparent address blocked | A `t1…` address would make the payment public. Ask for a shielded address. |
| Not enough available yet | Money you just received or sent needs a few confirmations before it can be spent again. |
| Above the limit | 0.02 ZEC per payment, 0.05 ZEC per day per wallet. |

### Streams (pay by the second)
1. **Streams → Start stream**: recipient, total, duration.
2. Earnings build up every second (**Earned**). Press **Pay what is due** to pay out what is owed so
   far (you confirm it like any payment). **Paid** counts only confirmed payouts.
3. **Pause**, **Resume** or **Cancel** any time. Streams are payer-controlled, not trustless: payouts
   stop if the payer stops approving them.

---

## 4. AI agents and MCP

An agent can pay for a metered service on its own, inside a budget you sign once. It never holds an
address or a key and cannot pay anyone else.

The useful built-in service is **document extraction**: the agent sends the text of an invoice,
receipt or email and gets back the title, invoice number, dates, amounts with currencies, the total,
emails and links. It is charged per page (2,000 characters) at the service's price. Every response
shows the charge, what is due, the remaining budget and the network fee; payment is **batched**: one
shielded payment settles everything due, so a hundred pages cost one network fee, not a hundred. The
text is processed in memory and never stored (a test checks the database for it). The same service
also answers a one-unit "chain tip" call (the current Zcash block height).

### Set up a budget (in the app)
1. **AI agents → Metered services → Add service** (price per page or call, credit limit).
2. **Agent wallet → Create funding link**, then pay that link from Zodl (or from **Pay**). Agent
   payments come only from this wallet.
3. **New agent grant**: per-payment cap, total budget, hours (at most 48) → **Draft mandate**.
4. Type `approve mandate …` and **Sign mandate**, then **Register grant**. The wallet sidecar checks
   your signature, the limits and the single allowed recipient before accepting it.
5. Copy the **agent token** (shown once) and the MCP command. Revoke a grant any time on the same page.

### Connect an MCP client
The Lute MCP server runs on the agent's machine and talks only to the Lute API.

```bash
git clone https://github.com/Stella112/zlute && cd zlute
pnpm install && pnpm --filter @lute/mcp build
```

**Claude Desktop** (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "lute": {
      "command": "node",
      "args": ["/path/to/zlute/apps/mcp/dist/server.js"],
      "env": {
        "LUTE_AGENT_TOKEN": "lute_agent_…",
        "LUTE_API_URL": "https://uselute.xyz"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add lute --env LUTE_AGENT_TOKEN=lute_agent_… --env LUTE_API_URL=https://uselute.xyz -- node /path/to/zlute/apps/mcp/dist/server.js
```

Any MCP client that can start a stdio server works the same way.

### Tools

| Tool | Does |
|---|---|
| `lute_get_wallet_status` | Budget: per-payment cap, total, spent, remaining, expiry |
| `lute_create_meter_session` | Opens a usage session with the service |
| `lute_quote_document` | One-time quote: `{session_id, text}` → pages, price, total, expiry (2 min). Binds price, service, session and the exact text; nothing charged |
| `lute_extract_document` | Paid per page: `{session_id, text}` → extracted fields, the charge, what is due, remaining budget, network fee, how settlement is batched; `402 PAYMENT_REQUIRED` with the reason past the credit limit |
| `lute_call_metered_api` | One paid unit (chain tip); returns `402 PAYMENT_REQUIRED` at the credit limit |
| `lute_get_meter_session` | Calls, usage, pending and paid amounts, what is due |
| `lute_propose_settlement` | Pays what is due under the mandate; denied with a reason if over budget |
| `lute_verify_settlement` | Moves payments to confirmed once mined |

Tools take only a session id (and, for extraction, the document text) as input, never an address
or an amount, so text injected into a prompt or a document cannot change who is paid. What a
document can change is its own size, which is bounded by the credit limit and the signed budget. Tool output omits ids that would link the agent to its grant, mandate or transactions
(set `LUTE_MCP_VERBOSE=1` to include them).

**Try it:** "Use the Lute tools. Check your budget, open a metered session, and extract the fields
from these three invoices: … Then pay what you owe and tell me the remaining budget." The agent
pays inside the budget, then is refused with `OVER_GRANT_TOTAL` once a payment would exceed it.

What stays private, and what does not, is traced in [PRIVATE-PAID-APIS.md](PRIVATE-PAID-APIS.md).

---

### Agent keys are scoped and revocable

An agent token is a scoped API key: it can only pay the one service of its grant, within the
per-payment cap and total budget of the mandate you signed, until the expiry you chose. Lute stores
only its hash; you can revoke it at any time (**AI agents → grant → Revoke**), and the wallet
service refuses anything outside the signed mandate even if the API were bypassed (evidence E-010).

### If something crashes mid-payment

Every payment is an action with an idempotency key, recorded before anything is sent; a broadcast
is never retried automatically. If the server restarts between your approval and the result, a
recovery sweep (at start and every 5 minutes) asks the wallet service what actually happened: a
sent payment is marked sent with its transaction id, one that was never sent is marked failed
(`RECOVERED_NOT_SENT`), so nothing is paid twice.

## 5. The API

Base URL `https://uselute.xyz`. The app uses a session cookie; agents use
`Authorization: Bearer lute_agent_…`. Requests that change state need an `Idempotency-Key` header
where noted. Amounts are strings in ZEC on input (`"0.0001"`) and strings in zatoshi on output
(1 ZEC = 100,000,000 zatoshi). Errors are `{"error": "CODE"}`.

### Account
| Method and path | Purpose |
|---|---|
| `POST /v1/auth/signup` | `{username, password, owner_pub}`: creates your wallets |
| `POST /v1/auth/login`, `POST /v1/auth/logout` | Session |
| `GET /v1/me` | Username, network, whether you sign in the browser |
| `GET /v1/wallets/{wallet}/balance` | Balance (spendable and total); `{wallet}` is `merchant`, `payout` or `agent` |

### Getting paid
| Method and path | Purpose |
|---|---|
| `POST /v1/requests` | `{amount_zec, details_ciphertext?, ttl_s?}` → `{id, share_path}` |
| `GET /v1/requests`, `POST /v1/requests/{id}/refresh` | List; re-check one |
| `POST /v1/commerce/orders`, `GET /v1/commerce/orders` | `{item, amount_zec}` checkout orders |
| `POST /v1/commerce/orders/{id}/refresh` | Status; issues the receipt when paid |
| `POST /v1/commerce/orders/{id}/refunds` | `{to, amount_zec}` + Idempotency-Key → confirm like a payment |
| `POST /v1/subscriptions/plans`, `POST /v1/subscriptions` | Plans and subscribers |
| `POST /v1/subscriptions/{id}/refresh`, `/cancel` | Status; cancel |
| `POST /v1/groups`, `POST /v1/groups/{id}/refresh` | Split bills |

### Paying out
| Method and path | Purpose |
|---|---|
| `POST /v1/actions/send` | `{wallet, to, amount_zec}` + Idempotency-Key → `AWAITING_AUTHORIZATION` with the proposal |
| `POST /v1/actions/{id}/authorize` | `{signature}`: Ed25519 over `lute-approve-v1`, the network and the proposal hash, joined by a vertical bar (see below) |
| `POST /v1/streams`, `GET /v1/streams/{id}` | Streams |
| `POST /v1/streams/{id}/settle` (+ Idempotency-Key), `/refresh`, `/pause`, `/resume`, `/cancel` | Payouts and control |

The approval message is the UTF-8 string below; sign it with your Ed25519 approval key:

```
lute-approve-v1|<network>|<proposal hash>
```

### Agents
| Method and path | Purpose |
|---|---|
| `POST /v1/meter/services`, `POST /v1/agent/mandates/draft`, `POST /v1/agent/grants` | Owner: service, mandate, grant |
| `POST /v1/agent/grants/{id}/revoke` | Owner: revoke |
| `GET /v1/agent/me` | Agent: budget |
| `POST /v1/meter/sessions`, `POST /v1/meter/sessions/{id}/call` | Agent: session, paid call |
| `POST /v1/meter/sessions/{id}/quote` | Agent: `{text}` → one-time quote (single use, 2 min) |
| `POST /v1/meter/sessions/{id}/extract` | Agent: `{text, quote_id?}` → extraction, charged per page (exactly the quoted amount with a quote) |
| `POST /v1/meter/sessions/{id}/settle` (+ Idempotency-Key), `/refresh` | Agent: pay, confirm |

### Public (no login)
| Method and path | Purpose |
|---|---|
| `GET /v1/public/requests/{id}` | Pay page data |
| `POST /v1/public/requests/{id}/check` | Re-check; returns the receipt id once paid |
| `GET /v1/public/receipts/{id}`, `POST /v1/public/receipts/verify` | Receipt and signature check |
| `POST /v1/public/subscriptions/{id}` | Subscriber page data |

---

## 6. Limits, fees and custody

- **Limits:** 0.02 ZEC per payment and 0.05 ZEC per day per wallet; agent mandates at most 48 hours.
- **Fees:** Lute adds none. The Zcash network fee is about 0.0001 ZEC per payment.
- **Custody:** your Lute wallets are held on Lute's servers, each with its own sealed key. Payments
  out need your approval key (or a mandate you signed). Your payers always pay from their own
  wallets. Businesses that want full self-custody can run Lute on their own server.
- **Privacy:** the **Privacy** page shows which features are proven by real test runs and mainnet
  transactions, and every known limit (for example, the light-wallet server sees the server's IP and
  sync timing).

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| Zodl will not read the QR from a screenshot | Scan the code on another screen with the camera, use **Open in my wallet**, or crop the screenshot to the code. |
| "This browser does not hold your key" | **Settings → Restore from backup**. |
| "Not enough available yet" | Wait a few minutes: new funds and change need confirmations. |
| A payment request stays "Waiting" | The payer must keep the memo their wallet fills in; check the amount was paid in full. |
| "Too many attempts" | Wait a minute; sign-in is rate-limited per device. |
