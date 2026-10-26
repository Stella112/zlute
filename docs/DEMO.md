# Demo script (about 5 minutes)

One journey, one person: **Ada**, a freelance designer, gets paid privately, sells a logo pack,
and lets her bookkeeping agent pay for document extraction inside a budget. Everything is on
**Zcash mainnet** at https://uselute.xyz. Record at 1080p; keep the browser at 100 % zoom.

Before recording: an account with its key backup saved; Zodl on a phone with about 0.01 ZEC; the
agent wallet funded (0.0004 ZEC is enough) and a grant registered (per payment 0.00015, total 0.00025,
24 h); Claude Code connected to the Lute MCP server (docs/USER-GUIDE.md §4). Three short invoice
texts ready to paste.

## 1. What Lute is (0:00 to 0:30)

- Open https://uselute.xyz. Read the hero: *"Receive payments, collect subscriptions and pay for
  services with shielded Zcash. Payment details stay off the public blockchain."*
- Scroll to the FAQ, open **Who holds the money?**: Lute is custodial, payouts need your approval key
  or a budget you signed, keep working balances only. Say: "We state custody plainly; the full trace
  is in the Custody doc." (Click Docs → Custody for two seconds.)

## 2. Get paid (0:30 to 1:40)

- Sign in. **Receive** → amount `0.0015`, note `Logo, invoice 12` → **Create**.
- Point at the link: the note is encrypted in the `#` part of the link; the server never sees it.
- Scan the QR with Zodl on the phone and send. The page goes **Confirming** (full amount seen),
  then **Paid** after 3 confirmations (cut the wait in editing).
- **Activity**: the payment shows as Paid, `+0.0015`.

## 3. Sell something, with a receipt (1:40 to 2:30)

- **Checkout** → item `Logo pack`, `0.001` → share link → pay from Zodl.
- Once Paid, open **View receipt**: "Signature valid". Read the disclosure line: the receipt shows the
  amount and transaction id to whoever holds the link; the item is a salted hash, so it cannot be
  guessed from the receipt.

## 4. An AI agent pays for a service inside a budget (2:30 to 4:00)

- **AI agents**: show the grant: per payment 0.00015, total 0.00025, one allowed recipient, expiry.
  Say: "The agent never holds an address or a key; it can only pay this service, up to this budget."
- Switch to Claude Code. Prompt:
  > Use the Lute tools. Check your budget, open a metered session, and extract the fields from these
  > three invoices: (paste). Then pay what you owe and tell me what is left.
- Show one `lute_extract_document` result: the extracted fields, then `charge` (pages, price),
  `budget.remaining_zat`, `settlement.batched: true` and `network_fee_zat: 10000`. Say: "Three
  documents, one shielded payment, one network fee."
- The agent settles: state **SUBMITTED** under the mandate, no owner signature needed.
- Prompt: "Extract these again and pay." The settlement is refused: **REJECTED `OVER_GRANT_TOTAL`**,
  before the wallet builds anything.

## 5. Proof (4:00 to 4:45)

- **Privacy** page: module statuses computed from test runs (`evidence/results.json`, tied to the
  commit). Click **E-014**: every mainnet transaction Lute made or received is
  `SHIELDED_SINGLE_POOL` (no transparent inputs or outputs, one pool).
- Click a mainnet txid: the explorer shows a shielded transaction with no visible amount or
  addresses.
- Docs → Evidence → **E-015**: the restriction tests (simultaneous settlements, retries, changed
  recipient, expired or revoked grant, missing approval, transparent address).

## 6. Close (4:45 to 5:00)

"Shielded payments protect the details from public blockchain observers. Hosted Lute sees the
activity it needs to operate, and it says so. Approvals and budgets are enforced on every payout, and
every claim links to its evidence."
