# Network and on-chain metadata leaks around shielded Zcash payments, and mitigations

Research date: 2026-10-26. Context: NU6.3 "Ironwood" activated 2026-07-28 and sealed the Orchard pool, so there is a live Orchard to Ironwood turnstile migration. Items dated before 2025 are marked [older].

## 1. Light-client leaks: what lightwalletd / Zaino servers learn

### Takeaway
A light wallet's server never sees viewing keys, but it does see the client IP, the timing of each request, sync-start heights (which give away birthday and last-sync history), any full-transaction (GetTransaction) fetches, and every broadcast. The protocol spec treats network privacy (Tor) as an assumption, not a feature, and its own height-bucketing mitigation is still only proposed.

### Cited Findings
- ZIP 307 (Light Client Protocol) states its security goal as "payment detection privacy": the proxy should not learn which transactions are addressed to a wallet. It assumes the node and proxy are "honest but curious" and that network privacy such as Tor is in place. It does not address spending privately. — [ZIP 307](https://zips.z.cash/zip-0307)
- ZIP 307 calls the start height of each sync "an information leak under our security model (assuming network privacy)", so block-range requests expose sync history. Rounding the start height down to a bucket of size N is proposed but not implemented. — [ZIP 307](https://zips.z.cash/zip-0307)
- ZIP 307 says that when a client fetches full transactions, it SHOULD also fetch decoys and SHOULD download every transaction in a block it fetches from. The client MUST tell the user that fetching full transactions reduces privacy. Compact-block scanning itself "leaks no information" about which transactions are of interest. — [ZIP 307](https://zips.z.cash/zip-0307)
- ZIP 307 does not cover the client IP, request timing, broadcasting, or transparent-address queries. — [ZIP 307](https://zips.z.cash/zip-0307)
- [older] Defuse (Taylor Hornby) analysis: if IP addresses map to identities, lightwalletd knows who each request comes from. Tor (hard on mobile) or a non-logging CDN are partial fixes. Wallets that do not validate headers and proof of work also let a malicious server lie about chain state. — [Defuse PDF](https://defuse.ca/downloads/Fixing%20Privacy%20Problems%20in%20the%20Zcash%20Light%20Wallet%20Protocol.pdf); [Defuse: faster and more private light wallets](https://defuse.ca/zecsec/making-zcash-light-wallets-faster-and-more-private.htm)
- [older] zecwallet-light-cli README: the server can learn which blocks contain your shielded transactions, plus metadata such as the IP. Transparent addresses get no privacy, because t-address balance and history queries (for example GetTaddressTxids) are plain lookups. — [zecwallet-light-cli](https://github.com/aarnott/zecwallet-light-cli)
- Nym's wallet threat model treats the server as the primary adversary. Unprotected, the server sees the "Real client IP", "Every request and every broadcast", and "All request timing and content". A broadcast from a home IP attributes the transaction directly, and grouped transactions can "sum to a starting balance". The model recommends IP, timing and block-height obfuscation, including out-of-order block requests and buffering. — [Nym docs: wallet threat model](https://nym.com/docs/network/threat-model/examples/wallet)
- Nym's Zcash SDK guide lists baseline hygiene: randomize request times, obfuscate the starting block height (the birthday), and do not broadcast a transaction as soon as the wallet reaches chain tip. — [zcash-sdk.nym.com](https://zcash-sdk.nym.com/)
- Zaino is a Rust indexer by Zingo Labs that aims to replace lightwalletd. — [ZecHub: Zingo Labs](https://zechub.wiki/zcash-organizations/zingo-labs)

### Inferences
- Swapping lightwalletd for Zaino changes the server software, not the trust model. Both serve the same gRPC light-client protocol, so the same metadata reaches whoever runs the server.
- Two other operations leak the transaction of interest outright unless mitigated with decoys or whole-block fetches: GetTransaction fetches (for memos and enhancement) and mempool streaming (watching for incoming unconfirmed transactions).
- Combining the sync-start height (birthday or last sync), the IP and the broadcast time gives a stable per-wallet fingerprint, even over Tor, unless circuits are rotated per request.

### Gaps
- I found no published third-party audit that quantifies lightwalletd or Zaino logging or metadata retention.
- I did not verify in Zaino's code or docs how it handles mempool streaming or GetTransaction privacy.
- I did not confirm whether Zodl or Zingo implement the ZIP 307 decoy and whole-block fetch recommendations.

## 2. Mitigations: Tor, Nym, self-hosting, private retrieval

### Takeaway
As of October 2026, Zodl (formerly Zashi) offers opt-in "Beta" Tor for sends, transaction retrieval, exchange-rate lookups and third-party APIs. Nym's mixnet went live on 2026-09-24 in Zingo and Zkool, but not in Zodl. Running your own Zebra plus Zaino or lightwalletd removes the third-party server, but your own node still talks to the P2P network. Private information retrieval for transactions is not deployed.

### Cited Findings
- Zashi was rebranded Zodl in February 2026 after its team left Electric Coin Company to form ZODL. The team called it "Same team. Same wallet." — [Zodl blog](https://zodl.com/zashi-is-becoming-zodl/); [crypto.news](https://crypto.news/zcash-wallet-zashi-rebrands-zodl-team-split-2026/); [Keystone on X](https://x.com/KeystoneWallet/status/2028440195025015111)
- Zodl's Tor setting is under '...' > More > Advanced Features > Beta: Tor Protection. When on, it routes exchange-rate fetches, transaction sending, transaction data retrieval and third-party API calls through Tor. Turning Tor off disables currency conversion automatically. Tor slows sync, especially after long gaps. The support article does not say whether compact-block sync goes over Tor. — [Zodl support: Enabling Tor protection](https://support.zodl.com/article/17-enabling-tor-protection)
- Without the protection, ZEC-USD rates come from CoinMarketCap, which sees the user's IP. Zashi 2.4.9 added a Tor option in the Restore flow and removed the Coinbase integration over privacy risk. — [Zodl support: Currency conversion](https://support.zodl.com/article/27-enabling-currency-conversion); [Zcash Shielded News vol.46](https://zechub.substack.com/p/zcash-shielded-news-vol46)
- [older] In February 2024, Zcash Community Grants gave Nym $150k to integrate its mixnet into ECC light-client libraries as an opt-in for wallets. — [The Block](https://www.theblock.co/post/277290/nym-receives-150000-grant-to-integrate-its-mixnet-with-zcash); [Nym blog](https://www.nym.com/blog/nym-begins-integration-for-complete-privacy-protection-on-zcash-ecosystem)
- On 2026-09-24, Nym said it had completed the grant and that the mixnet is live in Zingo! (native, with an on/off switch) and Zkool (any RPC node over the mixnet via a toggle). Zodl is described as "in conversation", not live. nym-smolmix carries HTTP(S) and gRPC, and lightwalletd can be hosted as a mixnet service. Nym published no speed data, says sync is heavy and mixnet speed and reliability still need work, and promises a follow-up post. — [Nym: mixnet now live in Zcash wallets](https://nym.com/blog/nym-mixnet-zcash-wallets)
- Nym's own 2026 roadmap says the mixnet is "simply too slow for everyday usage" and that it aims to speed it up. — [Nym roadmap 2026](https://nym.com/blog/nym-roadmap-2026)
- Nym's threat-model docs say compact-block sync over the mixnet is "very slow (5-hop + mixing delays)" and that bulk sync is a poor fit for the mixnet. With a fixed exit, requests stay linkable at the destination, so the exit must be rotated per request. — [Nym docs](https://nym.com/docs/network/threat-model/examples/wallet)
- ZIP 318 (draft) requires wallets that comply with it to offer Tor and, where available, Nym for migration broadcasts. Where neither is available, they should suggest a trusted VPN. Tor is not required when the user runs a private lightwalletd. Broadcasting through a different server than the one used for sync "may further reduce correlation". — [ZIP 318](https://zips.z.cash/zip-0318)
- zcash_client_backend has a Tor support module for wallets. — [docs.rs zcash_client_backend](https://docs.rs/zcash_client_backend/)
- Zcash docs: Zcash does not obfuscate IP addresses. A node that first broadcasts a transaction may be identified as its origin, and advanced users can run Tor. — [Zcash docs: Privacy best practices](https://zcash.readthedocs.io/en/latest/rtd_pages/privacy_recommendations_best_practices.html)
- Ywallet and Zingo let users set a custom server URL, which is the standard way to point a wallet at your own lightwalletd or Zaino. — [ZecHub: lightwallet nodes](https://zechub.wiki/zcash-tech/lightwallet-nodes)
- [older] Defuse proposed splitting detection across two servers ("1-of-2" trust) as a step toward private retrieval. — [Defuse](https://defuse.ca/zecsec/making-zcash-light-wallets-faster-and-more-private.htm)

### Inferences
- Self-hosting moves the problem rather than removing it. Your Zebra node's P2P traffic can still reveal broadcast origin unless it is run over Tor, or unless the transaction is relayed through a different path.
- For a payments product, the defensible stance is opt-in, best-effort network privacy. Mixnet sync costs too much for routine use today. A practical pattern is to broadcast over Tor or Nym and sync over a self-hosted or trusted server.

### Gaps
- I found no source confirming PIR or oblivious message retrieval (OMR) for Zcash transactions in production. These look like research only.
- I could not verify Ywallet's built-in Tor support, Zingo's Tor support, or any public lightwalletd or Zaino .onion endpoints.
- No independent measurements of Zcash-over-Nym anonymity or latency are published yet.

## 3. On-chain leaks that remain for shielded transactions

### Takeaway
A fully shielded transaction still exposes its block time, fee, per-pool action and spend/output counts, expiry height, anchor, and value balance. That means amounts are exposed whenever value crosses a pool boundary (transparent to shielded, or the Orchard to Ironwood turnstile). The Ironwood turnstile currently exposes every migration amount, and ZIP 318 tries to blunt this with denominations and random timing.

### Cited Findings
- Fees: ZIP-317 sets conventional_fee = 5000 zatoshi x max(2, logical_actions). Orchard and Ironwood contribute nActions, Sapling contributes max(spends, outputs), and transparent contributes size-based counts. A draft Revision 2 charges for memo chunks beyond 2 free ones. The ZIP warns that non-standard fees "may reveal specific users or wallets or wallet versions", and padding up to two actions is free. — [ZIP 317](https://zips.z.cash/zip-0317)
- Zcash docs: fees are public, so let a privacy-focused wallet choose the fee rather than setting it by hand. — [Zcash docs](https://zcash.readthedocs.io/en/latest/rtd_pages/privacy_recommendations_best_practices.html)
- Expiry: the default expiry delta is 20 blocks before Blossom and 40 after. ZIP 218 recommends 120 blocks at NU7, and `-txexpirydelta` overrides the default. ZIP 203 has no privacy discussion, but a non-default expiry is a wallet fingerprint, which is why ZIP 318 standardizes migration expiry to a 30-day boundary plus 60 days. — [ZIP 203](https://zips.z.cash/zip-0203); [ZIP 318](https://zips.z.cash/zip-0318)
- Ironwood turnstile: NU6.3 activated 2026-07-28 at block 3,428,143 after a soundness bug, found 2026-05-29, that could have allowed undetectable counterfeiting in Orchard. Funds leaving Orchard must pass the turnstile. — [z.cash NU6.3](https://z.cash/upgrade/nu6-3/); [CryptoTimes](https://www.cryptotimes.io/2026/07/28/zcash-activates-ironwood-nu6-3-to-boost-shielded-security-zec-slides/)
- The net amount crossing pools is public in the value-balance fields, along with block height, while addresses and notes stay shielded. A testnet scan showed odd amounts (for example 0.37663757 TAZ) are traceable across the turnstile. — [zecstats Ironwood tracker](https://zecstats.org/ironwood); [ZIP 318](https://zips.z.cash/zip-0318); [Zodl: Migrating to Ironwood](https://support.zodl.com/article/62-migrating-to-ironwood-self-migration)
- ZIP 318 (Draft, created 2026-06-16) splits balances into canonical 1/2/5 x 10^k denominations from 0.01 to 10,000 ZEC. Each transaction has one Orchard spend padded to two actions, one Ironwood output, no transparent parts, and the canonical fee. Delays are exponential with a mean of 66 blocks (about 82 minutes) and a cap of 576 blocks. Anchors sit on shared roughly 3-hour boundaries. Sync and broadcast must not happen in the same background session. — [ZIP 318](https://zips.z.cash/zip-0318)
- ZIP 318 lists its own residual leaks: rarity of large denominations; the aggregate value per anchor cohort; part count and duration hinting at magnitude; whales choosing a single transfer; and anchor-implied scan time. It states it does not claim to be provably leak-free. — [ZIP 318](https://zips.z.cash/zip-0318)
- Zodl recommends its migration tool over self-migration. A single full-balance transfer publishes your Orchard balance as one figure, the most identifying number you could put on chain. — [Zodl support](https://support.zodl.com/article/62-migrating-to-ironwood-self-migration)
- Migration status: about 88-89.5% of sealed Orchard value had migrated by September 2026 (zecstats: 89.5%, 380K ZEC left in Orchard, as of Sept 29). Trackers disagree because they measure different quantities. — [zecstats](https://zecstats.org/ironwood); [KuCoin](https://www.kucoin.com/blog/tr-zcash-q3-2026-ironwood-migration-zec-1000-rally)
- Nym argues that network privacy is needed so the broadcasting IP is not tied to a public migration amount. — [Nym blog](https://nym.com/blog/nym-mixnet-zcash-wallets)
- Transparent boundaries: in t-to-z (shielding), the sender and amount are visible. Mixed transactions expose their transparent components in full, and privacy applies only to the shielded parts. — [Fireblocks](https://support.fireblocks.io/hc/en-us/articles/26026114047900-Zcash-ZEC-transactions-on-Fireblocks)
- Shielding and deshielding reveal amounts and timing that can be correlated with exchange withdrawals and similar events. — [Nym: Is Zcash anonymous?](https://nym.com/blog/is-zcash-anonymous)
- [older] Dust and fingerprinting: Biryukov, Feher and Vitto (CCS 2019) fingerprint shielded transactions, introduce the active "Danaan-gift" attack (sending tagged small amounts to a victim's shielded address and watching for them when they leave) and dust attacks, and analyze subliminal channels. — [orbilu (paper record)](https://orbilu.uni.lu/handle/10993/41278); [PDF](https://orbilu.uni.lu/bitstream/10993/41278/1/Post_sapling_ZC_paper.pdf)
- ZIP 318's "targeted tagging adversary" is the same attack class, and its defense is quantization to canonical denominations so received values differ from migrated ones. — [ZIP 318](https://zips.z.cash/zip-0318)
- Memos and txids: Zcash docs warn against leaking txids, amounts or counterparty info, or sharing viewing keys without understanding the consequences, and against reusing one shielded address across contexts. — [Zcash docs](https://zcash.readthedocs.io/en/latest/rtd_pages/privacy_recommendations_best_practices.html)

### Inferences
- Watch the count of Orchard or Ironwood actions in particular. With padding to 2, small payments look alike, but large many-note consolidations stand out.
- A memo is encrypted, but the recipient (or anyone given a viewing key or payment disclosure) reads it in full. A merchant memo or invoice ID therefore links the payment to off-chain records at the counterparty.
- A receipt or txid published anywhere links that on-chain transaction (time, fee, action count) to the context it appears in.

### Gaps
- I found no published measurement of how distinguishable Zcash wallets are by action-count, expiry or anchor patterns in 2025-2026.

## 4. Academic and industry studies

### Takeaway
The empirical literature is mostly from 2017 to 2020. Its consistent finding is that deanonymization comes from use patterns at the transparent boundary (round trips, miners and founders, quick deshielding) and from side channels, not from breaking the cryptography. Fully shielded z-to-z use was then too rare for the heuristics to apply. I found no major 2024-2026 peer-reviewed study.

### Cited Findings
- [older] Kappos, Yousaf, Maller and Meiklejohn, "An Empirical Analysis of Anonymity in Zcash" (USENIX Security 2018): Zcash can be used privately, but simple heuristics based on usage patterns "shrink its anonymity set considerably". Their slides report that the heuristics deanonymized 69.1% of transactions interacting with the shielded pool. z-to-z transactions were under 1% of all transactions, with no obvious attack on them. The heuristics relied on founder and miner behavior and on "round-trip" amounts going into and out of the pool. — [USENIX page](https://www.usenix.org/conference/usenixsecurity18/presentation/kappos); [slides](https://www.usenix.net/sites/default/files/conference/protected-files/security18_slides_kappos.pdf)
- [older] Quesnelle (2017, arXiv:1712.01210): most coins sent to shielded addresses were later sent back to transparent addresses, which hurts linkability. — [arXiv](https://arxiv.org/abs/1712.01210)
- [older] Biryukov, Feher and Vitto (CCS 2019): fingerprinting of shielded transactions, the Danaan-gift and dust attacks, and subliminal channels (see section 3). — [orbilu](https://orbilu.uni.lu/handle/10993/41278)
- [older] Tramer, Boneh and Paterson, "Remote Side-Channel Attacks on Anonymous Transactions" (USENIX Security 2020): remote timing and traffic attacks let an active adversary identify the payee in Zcash and Monero, for example by timing a user's P2P node. Zcash proof-generation time depended on secret data such as the amount. The issues were disclosed and patched. — [USENIX](https://www.usenix.org/conference/usenixsecurity20/presentation/tramer); [ePrint 2020/220](https://eprint.iacr.org/2020/220)
- [older] "Attacking Zcash For Fun And Profit" (ePrint 2020/627) is a non-peer-reviewed whitepaper by Hush developers, who have a competing project, so weigh it accordingly. It describes linkability attacks and argues that fully shielded transactions still leak substantial metadata. — [ePrint 2020/627](https://eprint.iacr.org/2020/627)
- A coinbase consensus rule required mining rewards to go to a shielded address, and these coins were typically forwarded to t-addresses soon after, which is one of the patterns that makes clustering possible. — [ePrint 2020/627](https://eprint.iacr.org/2020/627)

### Inferences
- The 2018 to 2020 numbers come from a Sprout-era chain dominated by transparent use. They should not be presented as current rates for Orchard or Ironwood users, but the attack classes (round trips, timing, tagging, side channels) still apply.

### Gaps
- My searches found no 2024-2026 peer-reviewed measurement study of Orchard or Ironwood linkability. Absence in search results is not proof that none exists.

## 5. Is "100% privacy" defensible? What precise claims do serious projects make?

### Takeaway
No. The primary sources scope their claims carefully: shielded transactions hide sender, receiver, amount and memo on-chain, while metadata is reduced but not eliminated. Even ZIP 318 says it is not provably leak-free. The one absolute claim found, Nym's "impossible", is marketing with no published supporting data.

### Cited Findings
- Zcash docs: partial and fully shielded transactions "greatly reduce linkability" but do not eliminate metadata leakage, and Zcash does not obfuscate IP addresses. — [Zcash docs](https://zcash.readthedocs.io/en/latest/rtd_pages/privacy_recommendations_best_practices.html)
- The ZIP 307 goal is limited to "payment detection privacy", assumes Tor-level network privacy, and calls the sync-height leak an information leak. — [ZIP 307](https://zips.z.cash/zip-0307)
- ZIP 318 says it does not claim to be provably leak-free. It requires a disclaimer that broadcasting IPs can be correlated with pool-crossing events, and states "The user MAY proceed without Tor, Nym, or a VPN; the choice is the user's." — [ZIP 318](https://zips.z.cash/zip-0318)
- Fireblocks: the privacy guarantee applies only to shielded components. — [Fireblocks](https://support.fireblocks.io/hc/en-us/articles/26026114047900-Zcash-ZEC-transactions-on-Fireblocks)
- Zodl labels Tor as "Beta" and opt-in. Third-party descriptions say Zodl's strongest privacy applies only to shielded funds. — [Zodl support](https://support.zodl.com/article/17-enabling-tor-protection); [Reclaim The Net](https://reclaimthenet.org/recommended-tool/zodl)
- Counter-example: Nym claims its mixnet can "make network metadata analysis impossible even for an adversary watching the whole network", but publishes no supporting measurements and defers anonymity analysis to a later post. A Privacy Guides community thread scrutinizes Nym's "guaranteed" privacy claims. — [Nym blog](https://nym.com/blog/nym-mixnet-zcash-wallets); [Privacy Guides forum](https://discuss.privacyguides.net/t/analysis-of-nym-vpn-and-its-guaranteed-privacy-update-29-07-26/38170)
- The NU6.3 soundness bug (counterfeiting risk in Orchard) shows that even the cryptographic layer has had serious flaws. — [z.cash NU6.3](https://z.cash/upgrade/nu6-3/)

### Inferences
- A defensible claim for a Zcash payment product looks like this: "Shielded payments hide sender, recipient, amount and memo from the public chain. Timing, fees, transaction shape and any amount crossing between pools stay public. The server your wallet uses can see your IP and activity unless you use Tor or Nym or run your own server. A custodial operator sees everything it processes."
- Avoid "100% private", "untraceable" and "anonymous". Prefer "on-chain confidentiality for shielded payments" plus an explicit list of what stays visible.

### Gaps
- I found no formal regulator or industry standard for wording privacy claims specific to Zcash.
