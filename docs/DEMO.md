# Demo script (about 5 minutes)

One journey: **Ada** runs a small design studio. She gets paid privately, pays her team in one
shielded payment, and lets her bookkeeping agent pay for document extraction inside a budget.
Everything is on **Zcash mainnet** at https://uselute.xyz. Record at 1080p, browser at 100 % zoom.

Before recording: Zodl on a phone with about 0.01 ZEC; the owner account (maris) with a funded agent
wallet and a registered grant; Claude Code connected to the Lute MCP server (docs/USER-GUIDE.md §4);
a short invoice text ready to paste.

## 1. What Lute is (0:00 to 0:30)

- Open https://uselute.xyz. Hero: *"Receive payments, collect subscriptions and pay for services with
  shielded Zcash. Payment details stay off the public blockchain."*
- Point at the line under the buttons: *"Non-custodial: your keys stay in your browser."*
- Scroll to **Privacy → Who can see what** for two seconds: the honest table of what the chain, the
  light server, payers and the Lute operator can and cannot see.

## 2. Sign up: your keys stay in your browser (0:30 to 1:15)

- **Get started** → create an account. Say: "The browser just made a 24-word recovery phrase. Lute
  received only viewing keys: it can show my payments but holds no key that can move my money."
- Go to **Request**: the backup screen asks you to save the backup first. Download it; say "this
  restores my wallet in Zodl, even without Lute."

## 3. Get paid (1:15 to 2:00)

- **Request** `0.0005` ZEC with a note → scan the QR with Zodl and pay.
- The page goes **Confirming**, then **Paid** (cut the wait).
- **Pay** `0.0002` back to Zodl: the fee preview shows the network fee and total; **Confirm and
  pay** says *"Signing in this browser…"*. Say: "The server built the transaction; my browser
  checked it pays exactly what I see, then signed it." (E-017)

## 4. Payroll in one shielded payment (2:00 to 3:00)

- Switch to the owner account. **Payroll → New payroll**: two people, addresses and amounts.
- **Review payroll**: the approval lists both people. Approve (the laptop tool shows
  *"BATCH: 2 payments in one transaction"*).
- Say: "One transaction, one fee. Each person sees only their own pay." Open one **private payslip
  link**: only that person's line. (E-020)

## 5. An AI agent pays for an API inside a budget (3:00 to 4:15)

- **AI agents**: show the grant: per payment, total, one payee, expiry.
- In Claude Code: *"Use the Lute tools. Check your budget, open a session, get a quote for this
  invoice and extract its fields, then pay what you owe."*
- Show `lute_quote_document` (price, expiry, "one use"), the extraction (invoice number, amounts,
  total), then the settlement **SUBMITTED** without any owner signature. Reusing the quote is refused.
- *"Do it again ten times and pay."* → **REJECTED `OVER_GRANT_PER_TX`** before anything is built.
  (E-018)

## 6. Proof (4:15 to 4:50)

- **Docs → Evidence**: each claim with its test or mainnet transaction. Click **E-014**: every mainnet
  transaction Lute made is `SHIELDED_SINGLE_POOL`. Open one txid on the explorer: no visible amount
  or addresses.

## 7. Close (4:50 to 5:00)

"Shielded payments, payroll and agent payments on Zcash, with keys in the user's browser and every
claim backed by evidence."
