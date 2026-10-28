# Zcash merchant invoice flows and AI-agent payments: custody and privacy (as of late Oct 2026)

Method note: 15 tool calls (ZIP pages, GitHub READMEs and grant issues, forum and search snippets). Facts drawn only from search-result summaries, not from fetching the page, are marked "(snippet)". Project READMEs are self-reported and I did not audit any code.

## ZIP-321 payment URIs, per-invoice addresses, matching, confirmations

### Takeaway
ZIP-321 (Active) is the standard `zcash:` request format. It supports several recipients in one URI via indexed params and base64url memos, and memos to transparent addresses are invalid. Current merchant practice gives each invoice its own diversified shielded-only Unified Address from a viewing key and matches payments by diversifier index, not memo. Confirmation depth follows ZIP-315 (3 trusted / 10 untrusted). Mempool sightings are shown as hints only.

### Cited Findings
- ZIP-321 is "Active" (Standards/Wallet, created 2020-08-28; authors Nuttycombe and Hopwood). Params: `address` (or the URI path), `amount` (decimal ZEC, at most 8 decimals), `memo` (base64url without padding, at most 512 bytes), `message`, `label`, `req-asset` (custom asset, needs an Orchard-capable UA). A parser that sees an unknown `req-` param must reject the whole URI. Unknown params without the prefix are ignored — [ZIP-321](https://zips.z.cash/zip-0321)
- Multiple recipients: suffix `.N` (1–9999, no leading zero) groups params by payment. Indices need not be sequential. Each index needs its own address, and implementations should build one transaction paying all of them — [ZIP-321](https://zips.z.cash/zip-0321)
- A memo attached to a transparent address makes the URI invalid. Sprout addresses must not be supported. Percent-encoding is not allowed in addresses or amounts — [ZIP-321](https://zips.z.cash/zip-0321)
- ZIP-315 (still Draft) recommends 3 confirmations for trusted TXOs and 10 for untrusted ones. It also says a UA must use the same diversifier index for every receiver, and that wallets rotating addresses must avoid leaking links between them — [ZIP-315](https://zips.z.cash/zip-0315)
- ZIP-315 says not to shield UTXOs from different transparent receivers in one transaction and not to put internal receivers in UAs. It also says "A wallet MUST NOT send funds to a transparent address unless all of the source funds come from shielded pools" — [ZIP-315](https://zips.z.cash/zip-0315)
- ZecCheckout (written during ZECATHON, after 2026-09-28; testnet-tested prototype) gives each invoice a diversified UA with Orchard and Sapling receivers only, never transparent. It matches by the diversifier index recovered from the decrypted note, not by memo; the optional memo carries only order_id and is not used for matching. It never calls `GetTransaction`, so lightwalletd does not learn which transactions belong to the merchant — [ZecCheckout README](https://github.com/samizdatproject/zeccheckout)
- ZecCheckout defaults to 3 confirmations and recommends 10 or more on mainnet for large amounts. A mempool sighting is a best-effort hint that never changes invoice status. A public lightwalletd held only 4 of the 18 mempool transactions a node had in one sample. Statuses: underpaid, detected (fewer than N confirmations), paid (final). Overpayment counts as paid, late payments to expired invoices are credited, and Sapling and Orchard partial payments accumulate — [ZecCheckout README](https://github.com/samizdatproject/zeccheckout)
- ZecCheckout says NU6.3 activated on mainnet at height 3,428,143 and that invoice payments arrive as Ironwood outputs — [ZecCheckout README](https://github.com/samizdatproject/zeccheckout) (project-reported, not independently checked)
- weave-zec design: import the UFVK or UIVK with `import_account_ufvk` into a watch-only `zcash_client_sqlite` account, call `get_next_available_address` with a shielded-only request for each invoice, and map diversifier index to invoice. ZCG rejected it on 2026-03-20 "due to solutions already existing in the ecosystem" — [forum](https://forum.zcashcommunity.com/t/grant-application-weave-zec-non-custodial-shielded-merchant-payments-for-zcash/54993)
- CipherPay advertises "Per-invoice diversified addresses (no address reuse, ever)", with real-time mempool detection plus block confirmation (snippet) — [CipherPay forum thread](https://forum.zcashcommunity.com/t/cipherpay-yes-another-zcash-payment-processor-sorry-live/54830)

### Inferences
- Matching by address (diversifier index) is stronger than matching by memo. It works even when the payer's wallet drops or edits the memo, and it avoids a memo nonce that the customer can see and copy. Memo nonces are still the norm in x402-style flows (Kage), where one recipient address is reused.
- A UA built for an invoice should drop the transparent receiver, so that any ZIP-321 wallet must pay into a shielded pool.
- A reasonable default is 3 confirmations, configurable up to 10 for large amounts, with mempool detection shown only in the UI.

### Gaps
- I could not confirm which wallets fully parse ZIP-321 multi-recipient URIs and memos (Zodl, YWallet, Zingo, Edge). There is no authoritative support matrix.
- ZIP-321 has no standard field for an expiry or invoice ID, and no `req-` extension for one appeared in my sources.

## ZIP-317 fees and their privacy implications

### Takeaway
Fee = 5,000 zat × max(2, logical actions), so a minimal shielded payment costs 10,000 zat (0.0001 ZEC). Because the fee is a deterministic function of public data, every wallet using it pays the same for the same transaction shape, and deviating from it fingerprints the wallet.

### Cited Findings
- Marginal fee is 5,000 zatoshis and grace actions are 2. Logical actions are counted per pool: transparent is max(ceil(in bytes/150), ceil(out bytes/34)), Sapling is max(spends, outputs), Orchard is actions, and Ironwood is actions (Revision 1, for NU6.3, Draft). Revision 2 (Draft, depends on ZIP-248) would charge memo chunks beyond 2 free — [ZIP-317](https://zips.z.cash/zip-0317)
- The minimal transaction (1 input padded to 2, 1 output plus change) is 2 logical actions, or 10,000 zat — [ZIP-317](https://zips.z.cash/zip-0317)
- Privacy rules in the ZIP: the fee must be computable from public data only, padding is not penalized, wallets should pay the conventional fee, and "non-standard fees may reveal specific users, wallets, or wallet versions" — [ZIP-317](https://zips.z.cash/zip-0317)

### Inferences
- For merchants: consolidating many small invoice notes in one spend costs more (one action per note) and reveals the note count via the action count. Sweeping per invoice links nothing extra but costs more fees overall. A hosted app should use the wallet library's default ZIP-317 fee rather than a custom one.
- For metered or agent micropayments, 0.0001 ZEC per on-chain transaction sets a floor. Batching or prepaid tabs (Kage tabs, CipherPay prepaid sessions) are the way around it.
- If Revision 2 ships, long memos (several chunks) will cost extra, which favors short memos or none.

### Gaps
- I did not establish whether Revision 1 or 2 is final or deployed as of Oct 2026. Both are marked Draft on the ZIP page.

## Shielded merchant tools in practice

### Takeaway
The most mature non-custodial option is CipherPay (Atmosphere Labs): live on mainnet, viewing-key based, with WooCommerce and Shopify plugins, subscriptions (beta) and an x402 package. It is hosted, so the operator sees incoming payments unless the merchant self-hosts. The BTCPay Zcash plugin works, but its own docs say little about how it works. Several ZECATHON and grant-stage projects reuse the viewing-key plus diversified-address pattern.

### Cited Findings
- CipherPay requires the merchant's viewing key, which "means the server can see your incoming payments, which invoices got paid, how much, when". It is self-hostable from a single binary for merchants who want zero hosted visibility (snippet) — [CipherPay forum](https://forum.zcashcommunity.com/t/cipherpay-yes-another-zcash-payment-processor-sorry-live/54830); [retroactive grant](https://forum.zcashcommunity.com/t/retroactive-grant-application-cipherpay/55612)
- CipherPay subscriptions are beta and API-only: daily, weekly, monthly or yearly, with draft invoices created before each period, no subscription dashboard, and manual dunning (snippet) — [CipherPay forum](https://forum.zcashcommunity.com/t/cipherpay-yes-another-zcash-payment-processor-sorry-live/54830)
- CipherPay offers scoped "restricted" API keys (`cpay_rk_`) that can create invoices and verify payments but cannot manage keys or settings, positioned for AI agents (snippet) — [CipherPay forum](https://forum.zcashcommunity.com/t/cipherpay-yes-another-zcash-payment-processor-sorry-live/54830)
- The CipherPay for WooCommerce plugin is on wordpress.org. It never takes custody, pays to the merchant's own shielded address, detects via mempool scanning, updates orders by webhook, and prices in store fiat converted to ZEC (snippet) — [wordpress.org](https://vi.wordpress.org/plugins/cipherpay-for-woocommerce/)
- A ZCG member pointed to CipherPay on 2026-03-17 as an existing mainnet processor (listed by ZecHub on Mar 9) with a dashboard, hosted checkout, Shopify, subscriptions and x402 — [weave-zec thread](https://forum.zcashcommunity.com/t/grant-application-weave-zec-non-custodial-shielded-merchant-payments-for-zcash/54993)
- The BTCPay Zcash plugin (btcpay-zcash org, MIT, .NET 8, 40 commits, no releases) runs Zebra and lightwalletd with daemon and wallet RPC URIs. It warns that it "shares a single Zcash wallet across all the stores in the BTCPayServer instance", so it is unsafe on a shared instance — [repo](https://github.com/btcpay-zcash/btcpayserver-zcash-plugin). The Tor Project referenced it as a working option for accepting shielded ZEC — [Tor GitLab](https://gitlab.torproject.org/tpo/tpa/team/-/issues/42236). NymVPN and Meile reportedly use it (snippet, unverified)
- ZecHub has a BTCPay Zcash guide, but the page body would not render when I fetched it — [ZecHub](https://zechub.wiki/guides/btcpayserver-zcash-plugin)
- ZecCheckout signs webhooks with HMAC-SHA256 over "t."+raw body, uses a 5-minute replay window, event_id for idempotency and a seq ordering field, and delivers from a SQLite outbox with 12 retries. Payloads contain no addresses, txids or memos. The server holds a UFVK and refuses seeds and spending keys. It notes that a UFVK sees incoming and outgoing activity, that lightwalletd sees IP and poll timing, and that it does not verify PoW or commitment roots (a malicious lightwalletd could fake "paid"). It recommends `access_log off` at the proxy — [ZecCheckout](https://github.com/samizdatproject/zeccheckout)
- Zodl (formerly Zashi) pays merchants through Flexa, and Zodl CrossPay lets merchants receive their preferred asset (snippet) — [Cunicula](https://cunicula.com/en/articles/spend-zec-at-merchants-zashi-flexa); [Zodl](https://zodl.com/)
- ROZO Merchant POS (grant application, Jul–Sep 2026 timeline) would start with transparent ZEC for speed, which commenters flagged as against the shielded goal (snippet) — [forum](https://forum.zcashcommunity.com/t/rozo-merchant-pos-fast-zcash-payments-for-merchants-irl-grant-application/56374/1)
- ZEC Order Pay (ZCG #481) proposes marketplace checkout, refunds and creator payouts on CipherPay or zcash-walletd backends (snippet) — [ZCG #481](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/481)
- ZECATHON 2026 projects include ZecCheckout (above), "ZecPay", a non-custodial ZIP-321 invoicing tool on shielded UAs (snippet), and zecathon-shielded-payments (snippet; not inspected) — [repo](https://github.com/Askar12325/zecathon-shielded-payments)

### Inferences
- The ecosystem has settled on viewing-key custody, with the hosted operator seeing the merchant's incoming flows (like an xpub in BTCPay). Self-hosting is the answer for merchants who want no operator visibility. A hosted app should disclose this plainly and should prefer a UIVK over a UFVK when it only needs to detect payments, since a UIVK hides the merchant's outgoing spends.
- An unverified lightwalletd is a trust point for "paid" status. Running your own Zebra and lightwalletd, or checking against several servers, reduces it.

### Gaps
- I could not confirm the BTCPay plugin's address-per-invoice strategy, key type or confirmation settings (the docs/installation.md was not fetched).
- I could not obtain CipherPay's official docs. Its claims come from forum and search snippets about six months old.

## AI agent payments on Zcash (x402, MCP, spending limits)

### Takeaway
Upstream x402 (coinbase) has no Zcash scheme. Zcash x402 support comes from third parties: CipherPay's `@cipherpay/x402` (middleware with trial-decryption verification) and Kage/zec-shielded-x402 (testnet, viewing-key facilitator, memo nonce, spend guard). Agent-wallet grant proposals with mandates and limits (Shielded x402, ZAgentPay) were declined or closed in Sep–Oct 2026. The common custody pattern is a local agent seed, a merchant facilitator holding only a viewing key, and spend policy enforced outside the LLM.

### Cited Findings
- x402 flow (current coinbase repo): the server sends 402 with a base64 `PAYMENT-REQUIRED` header, the client retries with `PAYMENT-SIGNATURE`, the server verifies locally or via facilitator `/verify` and `/settle`, and returns `PAYMENT-RESPONSE`. Schemes are exact, upto and batch-settlement (EVM). SDKs cover EVM, SVM, AVM, Aptos, Stellar, Hedera and others, and Zcash and privacy are not mentioned. Each (scheme, network) pair must be explicitly supported — [coinbase/x402](https://github.com/coinbase/x402)
- Kage (zec-shielded-x402, MIT): uses x402 v1 wire format (`X-PAYMENT`) with a `zcash-shielded` scheme. It is testnet-only and refuses mainnet. The agent holds its own seed, and the merchant facilitator holds only a UIVK. Verification trial-decrypts the transaction from lightwalletd and checks the memo against the challenge nonce, the receiver, the amount and the expiry. The facilitator returns an ed25519-signed receipt, burns each nonce once (SQLite), and returns an empty `payer`. Default is 1 confirmation, with `settlement_pending` before that. "Tabs" sell several blind-RSA (RFC 9474) tokens per payment for unlinkable later requests. It reports 10 testnet payments on 2026-10-20 to 22, two of them initiated by an LLM over MCP — [repo](https://github.com/nickthelegend/zec-shielded-x402)
- Kage spendguard: a deny-by-default host allowlist, a per-UTC-day cap, an approval threshold (always declined over MCP), refusal of plain HTTP to non-loopback hosts, and a ledger sealed with XChaCha20-Poly1305. Known leaks: IP, lightwalletd lookups, timing — [repo](https://github.com/nickthelegend/zec-shielded-x402)
- `@cipherpay/x402` (v0.6.0, MIT): 402 paywall middleware for shielded ZEC. The client pays, retries with proof, and CipherPay verifies by trial decryption. It advertises x402 v2, MPP, prepaid sessions and `/.well-known/payment` discovery (snippet) — [jsDelivr](https://www.jsdelivr.com/package/npm/@cipherpay/x402)
- Shielded x402 grant (ZCG #445): a spec and facilitator using "viewing keys / memo-field proofs", plus a spendguard with per-transaction and daily caps, allow and deny lists, approval thresholds and an audit log decryptable by viewing key. Key management was out of scope. It asked for $42k and was declined 2026-09-28 with no reason given — [ZCG #445](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/445)
- ZAgentPay (ZCG #466, opened 2026-10-04): an MCP server around a local Orchard light wallet. "Spending keys never enter the model context". Signed JSON mandates set a budget, per-payment cap, expiry and rate limit, with an allowlist of UAs, human approval above a threshold, a hash-chained audit log, and a viewing key for an auditor. It was closed "Did Not Follow Process" on 2026-10-07 — [ZCG #466](https://github.com/ZcashCommunityGrants/zcashcommunitygrants/issues/466)
- Other MCP servers: decentrathai zcash-mcp-server (tools create_shielded_address, get_balance, send_private_payment; maturity unknown) (snippet) — [Glama](https://glama.ai/mcp/servers/decentrathai/zcash-mcp-server). Frontier Compute zcash-mcp is "attestation layer, not a wallet" (ZAP1 receipts) — [repo](https://github.com/frontier-compute/zcash-mcp). There is also a forum grant application for a Zcash MCP server with PCZT hardware signing — [forum](https://forum.zcashcommunity.com/t/grant-application-zcash-mcp-server-for-ai-agent-integration/55756)
- x402_treazury (Mike Perry) funds rotating USDC x402 wallets from a Zcash treasury. Its authors say the funding path via NEAR swaps and Base is public, and that it reduces linkability rather than making payments invisible (snippet) — [repo](https://github.com/mikeperry-tor/x402_treazury)
- A grant application proposes Zcash support in the Open Wallet Standard, so agent frameworks (MCP, A2A, x402) can hold shielded ZEC (snippet) — [forum](https://forum.zcashcommunity.com/t/grant-application-zcash-integration-for-the-open-wallet-standard-ows/55126); a separate x402-compatible ZEC settlement bridge application also exists — [forum](https://forum.zcashcommunity.com/t/grant-application-x402-compatible-payment-bridge-for-private-zec-settlement/54644)

### Inferences
- The architecture the community keeps converging on: the agent never sees keys, a policy engine outside the model enforces budget, per-payment cap, expiry, allowlist and human approval, and verification uses viewing keys only. A hosted agent wallet departs from the "local keys" norm and needs explicit custodial disclosure.
- Agent history privacy has two sides. On-chain, shielded transactions hide it. Off-chain, whoever runs the policy engine, audit log and lightwalletd sees everything. Kage's blind-token tabs are the only design I found that hides per-request linkage from the merchant.
- The 0.0001 ZEC fee plus about 75-second block times make per-call on-chain settlement poor for micropayments. Prepaid sessions, tabs or batching are needed.

### Gaps
- No mainnet production shielded x402 deployment was independently confirmed. CipherPay's mainnet x402 claim is from snippets.
- I could not verify z402 (mentioned in a comparison table) or any hosted, custodial Zcash agent wallet with limits.

## Comparable private-payment products and operator trust

### Takeaway
Monero merchant tools use the same view-key plus per-invoice-subaddress pattern (BTCPay Monero plugin, AcceptXMR). Railgun and Aztec show that operator and relayer roles, plus user behavior, are where privacy leaks, rather than the cryptography.

### Cited Findings
- The BTCPay Monero support is now a community plugin (btcpay-monero), and a July 2026 guide says it no longer needs uploaded view-only wallet files (snippet) — [sethforprivacy](https://sethforprivacy.com/guides/accepting-monero-via-btcpay-server/). The original CCS design imported a view key and generated a subaddress per invoice — [CCS MR 63](https://repo.getmonero.org/monero-project/ccs-proposals/-/merge_requests/63)
- AcceptXMR generates subaddresses from the private view key and primary address and needs no hot wallet — [docs.rs](https://docs.rs/acceptxmr). The xmr-pay PHP package "never asks for or holds a spend key" (snippet) — [packagist](https://packagist.org/packages/slowbeardigger/xmr-pay). I could not reach MoneroPay's own docs
- A Railgun measurement study (2026) found self-broadcast withdrawals linkable via gas payer. Of 6,856 self-broadcast withdrawals, 1,049 gas-payer addresses were also depositors. 124 relayer-like addresses served 89.12% of relayed volume — [arXiv 2606.25926](https://arxiv.org/pdf/2606.25926)
- Railgun's DAO can arbitrarily change protocol logic, according to L2BEAT's privacy risk profile (snippet) — [L2BEAT](https://l2beat.com/privacy/projects/railgun)
- Aztec encrypts transactions before the mempool, so sequencers do not see contents. It plans a decentralized sequencer set and an L1 forced-inclusion escape hatch (snippet) — [IPTF Aztec](https://iptf.ethereum.org/vendors/aztec/); [Aztec blog](https://aztec.network/blog/who-controls-your-privacy-off-switch)

### Inferences
- Lessons for a hosted Zcash app: (1) hold the minimum key (UIVK rather than UFVK rather than spend key) and offer self-hosting; (2) keep metadata (IP logs, webhook payloads, txids in the database) to a minimum, since that is where measured leaks come from; (3) do not rely on a single lightwalletd or relayer; (4) state plainly who can see what, as Railgun and Aztec analyses do for relayers and sequencers.

### Gaps
- I did not find a Monero or Railgun hosted merchant product that publishes a formal operator-visibility statement to compare with.
