# Storyboard

1920×1080, 30 fps, 119 s. The cut leads with agents: MCP, paid APIs, streams and subscriptions. Scenes are in `src/scenes2.tsx` (Proof and EndCard in `src/scenes.tsx`), timing in `src/Root.tsx`, exact voice lines in [narration.md](narration.md).

| Time | Scene | On screen | Voice (gist) |
|---|---|---|---|
| 0:00–0:05 | Opening | Lute mark, "PRIVATE MONEY. PROGRAMMABLE PAYMENTS." Agents · APIs · Streams · Subscriptions | Zcash makes money private. Lute makes it programmable. |
| 0:05–0:15 | Dashboard | Real mainnet account; camera moves from balance to Recent activity: AI agent payment Confirming, AI agent payment Blocked | Live on mainnet, every payment shielded, including the agent's payments and the one refused |
| 0:15–0:20 | Get paid | Real paid request: 0.0004 ZEC, "Payment received and confirmed" | Getting paid is one link |
| 0:20–0:31 | MCP server | Claude → Lute MCP server → LuteGuard → shielded Zcash; the 10 MCP tools listed | Lute runs as an MCP server; agents get ten tools to pay for APIs by themselves |
| 0:31–0:52 | Real agent run | Owner-signed mandate; terminal replays the real run: wallet status, metered session, one-time quote, extraction, quote reuse 409, settlement SUBMITTED, tx `ac68ee91…a6d5` mined 3533628; LuteGuard ALLOW | Checks budget, opens a session, quote works once, extracts, settles with one shielded payment; nobody clicked approve |
| 0:52–1:05 | Pay per call, then the limit | Meter counts 11 real metered calls to 11,000 zat past the 10,000 limit; settlement REJECTED `OVER_GRANT_PER_TX`; verify shows #1 paid, #2 rejected with no tx | Every call adds 1,000 zat; at 11,000 it is refused before a transaction is built |
| 1:05–1:13 | Sell an API | Real Agents page: metered service setup, HTTP 402 option, active grant spent 0.00008 of 0.0003 | Any business can sell its API per call, paid privately over HTTP 402 |
| 1:13–1:26 | Streams | Live accrual counter (sped up, labelled DIAGRAM) + real Streams page, a stream paid out 0.0003 ZEC | Paid by the second; money moves only in approved, shielded payouts; paid out on mainnet |
| 1:26–1:36 | Subscriptions | Real Subscriptions page: plan, subscriber, due invoice, Cancel | A fresh shielded invoice each period; no auto-debit |
| 1:36–1:44 | Payroll | Real payroll run CONFIRMED + real payslip, Paid and signed | A team paid in one transaction, private payslips |
| 1:44–1:50 | Proof | 277 tests, 11/11 mainnet txs single-pool, evidence page | Every claim links to its evidence |
| 1:50–1:57 | Close | "Programmable privacy for people, businesses and AI agents." uselute.xyz · github.com/Stella112/zlute | Lute. Programmable privacy… |
| 1:57–1:59 | End card | Lute mark, ZECATHON 2026 · SHIELDED PAYMENTS | (music out) |
