# Custody models in Zcash payment products and their privacy effects

Researched 2026-10-26. Many primary pages (ZecHub wiki articles) render client-side and could not be read, and several facts come from secondary sources (newsletters, exchange blogs). Each section marks which is which.

## 1. Self-custodial mobile/desktop wallets: where are seeds and spend keys held, and what do they disclose to servers?

### Takeaway
The mainstream shielded wallets (Zodl, formerly Zashi; YWallet/Zkool; Zingo; Nighthawk; Unstoppable; Edge) are non-custodial light clients. The seed stays on the device, and the device downloads compact blocks from a lightwalletd-style server and trial-decrypts them locally. The server therefore cannot learn which outputs belong to the user from block sync. It does see the sync start height, any specific full-transaction fetches, the IP address (unless Tor is used) and the submitted transactions.

### Cited Findings
- Zashi was renamed Zodl in February 2026 (announced 16 Feb 2026 on X), after the wallet team left Electric Coin Co and formed Zcash Open Development Lab (ZODL). Users did not need to move funds or change recovery phrases. Sources: [Forklog](https://forklog.com/en/news/zcash-developers-establish-new-entity-and-rebrand-wallet), [Bitcoinist](https://bitcoinist.com/zashi-becomes-zodl-zcash-wallet/amp/)
- Light-client privacy model (ZIP 307):
  - The client trial-decrypts compact-block outputs locally against its incoming viewing keys. The compact block stream "leaks no information about which transactions the light client is interested in."
  - Each sync reveals the height the client last synced to, which the ZIP calls "an information leak under our security model". The proposed bucketing mitigation "has not been implemented."
  - Fetching a specific full transaction (GetTransaction) reveals interest in that transaction, and clients "MUST convey to the user" that this reduces privacy.
  - Unlinkability of connections holds only if network privacy such as Tor is assumed.
  - The ZIP "does not address how to spend notes privately", so transaction submission is not covered.
  - Source: [ZIP 307](https://zips.z.cash/zip-0307)
- Nighthawk (F-Droid listing) is shielded by default and auto-shields transparent funds. It "requires trust in the lightwalletd server for displaying accurate transaction information". The servers are not operated by Nighthawk, and the privacy of communication and broadcasting "cannot be guaranteed." — [F-Droid Nighthawk](https://f-droid.org/en/packages/com.nighthawkapps.wallet.android/)
- Edge: Coin Bureau's 2026 comparison lists it as a non-custodial mobile wallet with shielded support (Orchard, Sapling and Unified Addresses). An older Edge press release announced full shielded ZEC support. Sources: [Coin Bureau](https://www.coinbureau.com/analysis/best-zcash-wallets), [Newswire](https://www.newswire.com/news/edge-adds-support-for-shielded-zcash-21604304)
- Unstoppable Wallet: its store listings say it supports Zcash "in an SPV manner" and is among the few wallets that can make fully shielded transactions. Tor support is listed as partial. These are vendor claims. — [App Store](https://apps.apple.com//app/id1447619907), [F-Droid](https://f-droid.org/zh_Hans/packages/io.horizontalsystems.bankwallet)
- YWallet (hhanh00/zwallet) is a shielded wallet with Unified Addresses for mobile and desktop. Its successor, Zkool (hhanh00/zkool2), is a multi-account wallet. Its developer says Zkool's shielded features match YWallet's. Unlike Zashi and Zingo, it does not force auto-shielding and uses address rotation instead. Sources: [zwallet repo](https://github.com/hhanh00/zwallet/), [zkool2 repo](https://github.com/hhanh00/zkool2), [Coin Bureau](https://www.coinbureau.com/analysis/best-zcash-wallets)
- Zingo requires transparent funds to be shielded before they can be spent. — [Coin Bureau](https://www.coinbureau.com/analysis/best-zcash-wallets)
- YWallet and Zingo can export a viewing key. The BTCPay Zcash plugin docs tell merchants to use them for that purpose (see section 2). — [btcpayserver-zcash-plugin installation doc](https://github.com/btcpay-zcash/btcpayserver-zcash-plugin/blob/master/docs/installation.md)

### Inferences
- In all of these wallets the spend authority (seed, then ZIP 32 spending keys) never leaves the device. The lightwalletd operator is a privacy adversary, not a custodian. It sees metadata (IP, timing, sync height, broadcast transactions, explicit transaction fetches) but not note ownership.
- A wallet's server-side disclosure depends on which lightwalletd it uses and whether Tor is on. That is a configurable dimension, not a property of the custody model.

### Gaps
- I could not read each wallet's current docs on its default lightwalletd endpoints, Tor defaults or seed-encryption details. The ZecHub wallets page renders client-side.
- Nighthawk's current maintenance status as of late 2026 is unconfirmed. The F-Droid listing does not say it was discontinued.

## 2. Merchant processors: custodial vs non-custodial, shielded vs transparent

### Takeaway
Two processors are shielded-first and non-custodial: the BTCPay Server Zcash plugin (self-hosted) and CipherPay (hosted or self-hostable). ZGo is also listed as shielded. BTCPay explicitly works from a merchant-exported viewing key (a "view-only" wallet), so the payment server never holds spend keys. NOWPayments, Plisio and Binance Pay are listed as transparent-only.

### Cited Findings
- ZecHub's processor table:

  | Processor | Pools | Custody |
  |---|---|---|
  | CipherPay | Shielded (Orchard via Unified Addresses) | Non-custodial |
  | BTCPay Server | Shielded only (Sapling, Orchard, Unified Addresses), self-hosted | Not stated |
  | ZGo | Shielded (Sapling and Orchard); "directly from your customer to you" | Not stated |
  | Flexa | Customer spends shielded; receiving side "not documented" | Not stated |
  | NOWPayments | Transparent | Not stated |
  | Plisio | Transparent ("not documented") | Not stated |
  | Binance Pay | Transparent; shielded deposits rejected | Not stated |

  The table does not list CoinGate. — [ZecHub payment processors](https://zechub.wiki/payment-processors)
- BTCPay Zcash plugin (github.com/btcpay-zcash/btcpayserver-zcash-plugin):
  - The setup section is titled "Setup Your (View-Only) Zcash Wallet". It tells merchants to "Use a mobile or desktop wallet such as YWallet or Zingo, that supports a Viewing Key export."
  - Configuration takes a daemon RPC URI, a wallet RPC URI and a wallet directory. A full-node option runs zebra plus lightwalletd.
  - Warning from the repo: "This plugin shares a single Zcash wallet across all the stores in the BTCPayServer instance."
  - Sources: [repo README](https://github.com/btcpay-zcash/btcpayserver-zcash-plugin), [installation doc](https://github.com/btcpay-zcash/btcpayserver-zcash-plugin/blob/master/docs/installation.md)
- The BTCPay Plugin Builder lists "ZCash support plugin" v1.0.3.0, which requires BTCPayServer >= 2.1.0. — [Plugin Builder](https://plugin-builder.btcpayserver.org/public/plugins/zcash-plugin)
- Earlier history: a ZecHub newsletter reported a $21,000 grant to 1337bytes to fix, update and document the BTCPay plugin for Sapling. — [ZecHub Shielded News Vol.39](https://zechub.substack.com/p/zcash-shielded-news-vol38)
- CipherPay (atmospherelabs-dev/cipherpay-api):
  - Self-described as a "non-custodial" shielded Zcash payment gateway. It is built on CipherScan APIs and needs no full node.
  - It does Orchard and Sapling trial decryption, detects payments in the mempool, offers hosted checkout and subscriptions, and supports an HTTP 402 (x402) flow. It is self-hostable.
  - The default fee is 1% on confirmed payments.
  - The WooCommerce plugin FAQ says CipherPay "never holds your funds", and payments go directly to the merchant's shielded address.
  - Sources: [cipherpay-api mirror](https://ithub.global.ssl.fastly.net/atmospherelabs-dev/cipherpay-api), [WordPress plugin](https://zh-hk.wordpress.org/plugins/?p=296812)
- NOWPayments' Zcash page claims "Non-custodial: you are in control" and calls Zcash payments "secure and transparent", with no mention of z-addresses. ZecHub classifies it as transparent. — [NOWPayments](https://nowpayments.io/supported-coins/zcash-payments), [ZecHub](https://zechub.wiki/payment-processors)
- The NymVPN integration was reported to use Sapling viewing keys on the merchant side. It can detect that a valid payment arrived without publicly revealing the sender or the amount. This is secondary search-summary info. — [ZecHub BTCPay guide](https://zechub.wiki/guides/btcpay-zcash)

### Inferences
- With BTCPay's view-only model, a full compromise of the BTCPay host exposes the merchant's incoming payment history (amounts, memos and, with a full viewing key, possibly outgoing activity). It does not expose funds.
- The single shared wallet across stores means every store on one instance shares one viewing key. Each store can therefore observe the others' payments, and the operator sees all of them.
- CipherPay's design (trial decryption server-side, non-custodial) implies the merchant gives it a viewing key. I could not confirm whether that is a UFVK or a UIVK (see Gaps).
- Transparent-only gateways (NOWPayments, Plisio, Binance Pay) offer Bitcoin-like on-chain privacy. Their custody claims are irrelevant to shielded privacy.

### Gaps
- I could not confirm from source whether the BTCPay plugin takes a Sapling extended full viewing key, a UFVK or a UIVK. I also could not identify which wallet daemon sits behind the "wallet RPC URI", or whether Orchard is supported in the plugin code (only ZecHub says so).
- CipherPay's exact key type is unverified, and so is whether its hosted service (not self-hosted) retains viewing keys.
- CoinGate: I found no source on its current Zcash support or pool type. Not researched further.
- ZGo's custody and key model is not documented beyond the ZecHub one-liner.

## 3. Viewing-key-only setups: UFVK vs UIVK, what the operator sees, and why it cannot spend

### Takeaway
A UFVK reveals all activity, incoming and outgoing (and transparent activity if it has a transparent component). A UIVK reveals only incoming payments to external addresses, not change or outgoing details. Neither contains spend-authorizing key material, so a server holding either can receive and verify shielded payments but cannot spend.

### Cited Findings
- ZIP 316 on full viewing keys:
  - An FVK "is intended to give access to view all transactions to and from the address".
  - A UFVK can yield a UIVK.
  - The outgoing viewing key, derived from the FVK, allows "recovering the sent note plaintext, including destination address, amount, and memo".
  - UFVKs with a transparent component "allow observation of transaction activity across all pools, including transparent."
  - Source: [ZIP 316](https://zips.z.cash/zip-0316)
- ZIP 316 on incoming viewing keys:
  - An IVK is "intended to give access only to view incoming payments (as opposed to change)."
  - A holder of the external IVK cannot derive the internal IVK or any outgoing viewing key components.
  - Source: [ZIP 316](https://zips.z.cash/zip-0316)
- ZIP 316 shows viewing keys are derived without spending keys. For example, internal transparent keys can be derived "without having the external spending key." — [ZIP 316](https://zips.z.cash/zip-0316)
- Light clients trial-decrypt with incoming viewing keys, so incoming detection needs only an IVK. — [ZIP 307](https://zips.z.cash/zip-0307)
- Analogous design (Penumbra, which derives from Sapling): the full viewing key "represents all capability except for spend authorization", including viewing incoming and outgoing transactions. It contains a nullifier key. This is a sister protocol, not the Zcash spec. — [Penumbra protocol docs](https://protocol.penumbra.zone/main/addresses_keys.html)
- Tooling: the zecscope-scanner crate scans compact blocks with a UFVK to find incoming Sapling and Orchard payments. — [docs.rs zecscope-scanner](https://docs.rs/zecscope-scanner)
- Ledger's Zcash Signer Kit can export a UFVK (the default export mode) or a raw Orchard FVK from a hardware device. This makes "hardware wallet holds spend key, server holds FVK" achievable. — [Ledger Zcash Signer Kit](https://developers.ledger.com/docs/device-interaction/dmk-ts/references/signers/zcash.md)
- October 2026 proposal (Zakura): give each published address its own one-time incoming viewing key. A future quantum attacker could then link payments only per address. This is proposed, not shipped. — [Decrypt](https://decrypt.co/381257/zcash-developer-zakura-proposes-fix-to-stop-quantum-computers-linking-shielded-swaps), [Crowdfund Insider](https://www.crowdfundinsider.com/2026/10/319461-zcash-devs-share-one-time-viewing-key-fix-to-protect-zec-swaps-from-future-quantum-threats/)

### Inferences
- **Incoming notes and memos.** Decrypting a note gives the full note plaintext, including the memo. The general protocol knowledge here is consistent with ZIP 307 trial decryption, but ZIP 316 does not spell out memos for incoming notes. So a UIVK holder sees amounts and memos of incoming payments. That is enough for invoice matching via a memo or a per-invoice diversified address.
- **Spent status.** A Sapling or Orchard FVK includes the nullifier-deriving key, so a UFVK holder can tell when received notes are spent. A UIVK holder cannot. I am inferring this from protocol structure and the Penumbra analogy, and did not verify it in the Zcash spec text this session.
- **Least privilege.** A receive-and-verify-only merchant server needs only a UIVK, or the Sapling/Orchard IVK. A UFVK over-discloses the merchant's outgoing spending and change. Giving a server the UFVK is the common pattern (BTCPay's "viewing key", scanners using UFVK), but it is not the minimal one.
- **Fresh address per invoice.** Unified Addresses derived at different diversifier indices from one UIVK let a server issue a fresh address per invoice without spend keys.

### Gaps
- I could not fetch the protocol-spec sections that state which key components each viewing key contains (ak, nk, ovk, ivk). The nullifier and spent-status claims above are inferences.
- The ZecHub viewing-keys page did not render.

## 4. Hardware wallets and PCZT: separating transaction building from signing

### Takeaway
PCZT (ZIP 374, Draft) is designed exactly for a split where one party (for example a server or phone) creates and constructs a transaction and a separate holder of spend-authorizing keys (for example a hardware wallet) signs it. Zodl (formerly Zashi) with Keystone is the shipped example. A server could act as Creator/Constructor/Prover with only an FVK while the client signs. The cost is that whoever handles the PCZT learns far more than the final transaction reveals.

### Cited Findings
- ZIP 374 basics:
  - Draft, Revision 0, created 2024-12-09. PCZT v1 covers v5 transactions, and v2 covers v5 and v6.
  - Roles: Creator, Constructor, IO Finalizer, Updater (adds key paths, full viewing keys, witnesses, anchors), Prover, Signer, Combiner, Redactor, Spend Finalizer and Transaction Extractor.
  - The format "must not require spending key material to be present." Signers can be offline or hardware devices.
  - For v6 transactions, signatures can be made before anchors, witnesses or proofs exist.
  - Source: [ZIP 374](https://zips.z.cash/zip-0374)
- ZIP 374, what the signer needs and what it checks:
  - It needs the spend-authorization randomizers (alpha), value-commitment openings (rcv) to check amounts, each output's user_address, the ock value to verify out_ciphertext, derivation paths and the transparent sighash types.
  - It must reject PCZTs containing dummy_ask or dummy_sk.
  - Source: [ZIP 374](https://zips.z.cash/zip-0374)
- ZIP 374 privacy warnings:
  - A PCZT can contain counterparty addresses, values, note randomness, FVKs, ZIP 32 paths and ock.
  - Anyone receiving it learns everything present at that stage, so use the Redactor to strip unneeded fields.
  - Delegating proving reveals the private note data to the prover, though not spending authority.
  - Long-lived PCZTs should be protected like a wallet's note database.
  - The final on-chain transaction carries none of this extra information.
  - Source: [ZIP 374](https://zips.z.cash/zip-0374)
- The `pczt` Rust crate in librustzcash implements this. Its roles are modelled on BIP 174 and BIP 370 plus Zcash-specific roles. — [docs.rs pczt](https://docs.rs/pczt/)
- Keystone with Zashi (now Zodl):
  - ECC announced the integration at the end of 2024 as a shielded-storage milestone. Users make shielded transactions with keys on the Keystone.
  - Zodl support says the Keystone must run the "Cypherpunk" firmware edition (only that edition supports shielded ZEC) and that Keystone Pro 3 is supported.
  - Cypherpunk firmware V-2.2.6 added passphrase wallets for Zcash (date not established).
  - Sources: [ZecHub Shielded News Vol.2](https://zechub.substack.com/p/zcash-shielded-news-volume-2), [Zodl support: Connecting a Keystone wallet](https://support.zodl.com/article/33-connecting-a-keystone-wallet), [TradingView/Coindar](https://pl.tradingview.com/news/coindar%3A2373108e5094b%3A0-keystone-expands-zcash-support-with-passphrase-wallets)
- Least Authority completed a security audit of Keystone for Zcash on 2025-03-20. — [Least Authority](https://leastauthority.com/blog/audit-of-keystone-hardware-wallet-for-zcash/)
- Ledger: a Zcash Signer Kit exists with UFVK and Orchard FVK export. A 2026 guide says the shielded Zcash app runs on some Ledger models and not others. Sources: [Ledger docs](https://developers.ledger.com/docs/device-interaction/dmk-ts/references/signers/zcash.md), [BloFin Academy](https://blofin.com/academy/education/zcash/zcash-hardware-wallet-support), [Zondax blog](https://zondax.ch/blog/zondax-hw-wallet-support-from-zero-to-hero)
- Trezor states that shielded transactions are not compatible with Zcash on Trezor devices. — [Trezor](https://trezor.io/coins/detail/zcash)

### Inferences
- **Server builds, client signs.** This is feasible with PCZT. The server holds a UFVK (needed as Updater/Prover to know notes, witnesses and anchors), constructs and proves, then sends the PCZT to the client or hardware device. The client verifies the outputs and change, signs with ask, and the server extracts and broadcasts. The server never gets spend authority.
- **What that server sees.** It necessarily sees full note data for the transactions it builds. Its privacy exposure equals that of a UFVK holder plus the recipients of outgoing payments.
- **v6 ordering.** "Sign before proofs" for v6 makes asynchronous approval flows easier: sign an intent, then prove and broadcast later. This is a design property, not a product I verified.

### Gaps
- I did not verify whether Ledger's shielded (Orchard) signing is in a production Ledger Live flow or only via third-party wallets as of late 2026.
- I did not verify which wallets besides Zodl consume PCZTs (for example Zkool or YWallet with Keystone).

## 5. 2025–2026 developments relevant to splitting custody (NU6.x, NU7, Ironwood, FROST)

### Takeaway
FROST threshold signing for shielded Zcash exists as Zcash Foundation libraries and reference tools (frostd server and frost-client), with limited wallet adoption (Zkool is reported to support it). Ironwood is a mid-2026 plan for a new Orchard-like shielded pool with a Turnstile migration from Orchard. NU7 (shorter blocks, per-block shielded caps, Sprout disabled) targets a November 2026 mainnet. I found no source on "NU6.1", and NU6.3 is not documented in what I found.

### Cited Findings
- FROST:
  - The Zcash Foundation finished the FROST reference implementation (frost-core plus ciphersuites) and built frostd (a coordination server) and frost-client (a CLI reference for wallet developers).
  - Messages through frostd are end-to-end encrypted, so the server need not be trusted. ZF offered to host a frostd server.
  - FROST v2.1.0 shipped in Q1 2025. Final audit recommendations and a frost-tools audit were in Q2 2025. A security fix landed on 28 Aug 2025.
  - Key-generation details were finalized in mid-2025 while their interaction with a quantum-resilience proposal was examined.
  - These are secondary newsletter sources. — [ZecHub Vol.32](https://zechub.substack.com/p/zcash-shielded-news-vol32), [Vol.30](https://zechub.substack.com/p/zcash-shielded-news-vol30), [Vol.46](https://zechub.substack.com/p/zcash-shielded-news-vol46), [Vol.41](https://zechub.substack.com/p/zcash-shielded-news-vol41)
- A community note says the Zkool wallet supports shielded multisig via FROST. — [ZecHub Vol.5](https://zechub.substack.com/p/zcash-shielded-news-vol5-9a8)
- Native (transparent P2SH) Zcash multisig cannot handle shielded transactions. A December 2025 hackathon project (Asigna) started a FROST-based shielded wallet that was not production-ready. — [Devfolio Asigna](https://devfolio.co/projects/asigna-76b5)
- Ironwood:
  - On 6 June 2026 a group (ZODL, Zcash Foundation, Shielded Labs, Tachyon, Valar Group) outlined Ironwood, a new upgrade with a new shielded pool built on the Orchard design. The target was late July 2026, "dependent on testing and ecosystem coordination."
  - After activation, Orchard would stop accepting new deposits and internal transfers. Funds would leave Orchard "only via the Turnstile migration path" through "a verifiable accounting gate".
  - Wallets could keep using existing Orchard receiving addresses.
  - The source assigns no NU number.
  - This is a secondary source (OneKey blog citing KuCoin).
  - Source: [OneKey](https://onekey.so/blog/ecosystem/zcash-targets-a-late-july-ironwood-upgrade-a-new-shielded-pool-and-stronger-verifiability-of-total-zec-supply-20260607044958/)
- Orchard soundness issue and NU6.2: a critical soundness issue in the Orchard action circuit was privately disclosed, mitigated by an emergency soft fork, and remediated by NU6.2, which re-enabled Orchard. The primary reference is the Zcash Forum post "Zebra 4.5.3 and 5.0.0 emergency soft fork and NU6.2 activation", which I have not read directly. — [OneKey](https://onekey.so/blog/ecosystem/zcash-targets-a-late-july-ironwood-upgrade-a-new-shielded-pool-and-stronger-verifiability-of-total-zec-supply-20260607044958/)
- NU7:
  - Mainnet target is 5 Nov 2026, with the activation height decided around 20 Oct 2026. Testnet activated in early October 2026 (sources differ: 4 Oct vs about 6 Oct, height 4,465,026).
  - Block time drops from 75 s to 25 s, with ZIP 218 adjusting rewards.
  - Per-block caps: 330 "Orchard or Ironwood actions", 300 Sapling inputs and outputs, and a shared budget of 330.
  - ZIP 2003 stops Sprout spends.
  - Sources: [KuCoin](https://www.kucoin.com/news/flash/zcash-plans-to-launch-nu7-network-upgrade-in-november), [Crowdfund Insider](https://www.crowdfundinsider.com/?p=315795), [Cointelegraph](https://cointelegraph.com/news/zcash-nu7-upgrade-sprout-funds-unspendable)

### Inferences
- **Mentioning both pools.** The NU7 caps mention "Orchard or Ironwood actions". That suggests Ironwood either activated before NU7 or ships with it, but I could not confirm Ironwood's actual activation date or NU number.
- **Ironwood and viewing keys.** Because Ironwood keeps Orchard receiving addresses, Orchard-derived viewing keys plausibly continue to work for receive detection. This is unverified, and ZIP or wallet SDK changes for Ironwood scanning should be checked.
- **FROST for merchants.** FROST (RedPallas/RedJubjub ciphersuites) splits the spend-authorization key ask across t-of-n parties while the FVK can be shared. That allows "server watches and co-signs, but cannot spend alone" designs. Combined with PCZT, a server could build the transaction and hold one FROST share, while a client holds another.
- **Practical gap.** Production wallet support for FROST is thin (Zkool is the only one reported). Hardware wallet plus FROST combinations are not documented in what I found.

### Gaps
- I found no source for "NU6.1" or "NU6.3". I also found no primary ZIP number or activation height for Ironwood.
- I could not confirm whether Ironwood changes key derivation, viewing-key formats or PCZT versions.
- The FROST status comes from newsletters. Zcash Foundation primary posts and repository release notes were not read.
