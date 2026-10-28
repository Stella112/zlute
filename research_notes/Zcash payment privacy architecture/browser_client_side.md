# Client-side Zcash transaction construction in browsers (as of 2026-10-26)

Scope: can a browser hold Zcash spending keys and build/prove shielded transactions today; libraries, maturity, performance, pool support, privacy against the sync server, key storage, hybrid PCZT designs, and integration effort for a team with a Rust sidecar on zcash_client_backend/zcash_client_sqlite.

Important context for this period: Orchard had a circuit soundness bug (found late May 2026). Orchard was disabled by an emergency soft fork on 2 June 2026 and a corrected circuit followed. On 28 July 2026 (NU6.3, height 3,428,143) the new **Ironwood** shielded pool activated. Ironwood reuses the fixed Orchard circuit and Halo 2. Orchard is now withdraw-only through a turnstile ([The Block](https://theblock.co/post/409934/zcash-ironwood-upgrade-launching-new-shielded-pool-after-orchard-vulnerability); [ZODL](https://zodl.com/ironwood-a-new-shielded-pool-for-zcash/)). Any browser option must therefore support NU6.3 and Ironwood to be useful for new shielded payments.

## ChainSafe WebZjs: status, pools, performance, sync, license, maintenance

### Takeaway
WebZjs is the only real browser Zcash wallet library. It is a WASM build of a forked librustzcash with in-memory wallet state, synced through a gRPC-web proxy to lightwalletd. It is dual MIT/Apache-2.0 and is explicitly marked unaudited (the Snap built on it was audited). Its latest public commits (April 2026) pin a ChainSafe fork of librustzcash at NU6.1. I found no evidence that it supports NU6.3 or Ironwood, so it is probably not usable for new shielded spends after 28 July 2026 without fork work.

### Cited Findings
- WebZjs is a JS/TS library for browser Zcash wallets and plugins. Its README says it is "under development", unreviewed and unaudited, with no guarantees. It is dual-licensed Apache-2.0/MIT. — [GitHub ChainSafe/WebZjs](https://github.com/ChainSafe/WebZjs)
- Sync goes through a gRPC-web proxy to lightwalletd. An unproxied URL such as https://zec.rocks "will NOT work". ChainSafe hosts a proxy, and you can self-host one with docker-compose. Sync runs in a web worker. Call `initThreadPool` with `navigator.hardwareConcurrency` threads. Init functions may run only once per page load, and WASM instantiation can fail (the fix is to refresh). — [GitHub ChainSafe/WebZjs](https://github.com/ChainSafe/WebZjs)
- Workspace crates are `webzjs-common`, `webzjs-keys`, `webzjs-requests` and `webzjs-wallet`. The Zcash crates come from the git fork `ChainSafe/librustzcash-nu61`, branch `feat/snap-nu61`:
  - `zcash_client_backend`: features `sync`, `lightwalletd-tonic`, `orchard`
  - `zcash_client_memory`: features `orchard`, `transparent-inputs`
  - `pczt`: features `orchard`, `sapling`, `transparent`
  - `zcash_keys`
  - `zcash_client_sqlite`
  - `sapling-crypto` 0.6 from crates.io

  The Orchard feature is therefore compiled in. — [WebZjs Cargo.toml](https://raw.githubusercontent.com/ChainSafe/WebZjs/main/Cargo.toml)
- Recent commits, newest first (none mention Ironwood, NU6.3, Orchard or PCZT):
  - 16 Apr 2026: regex form validation
  - 14 Apr 2026: "moving back to fork references of librustzcash"
  - Feb 2026: several "fix/update-fix-NU6" PRs, including lazy-loading the WASM and Netlify cache/multithread settings
  - 6 Feb 2026: snap bumped to 0.3.0
  - 20 Jan 2026: "Initial nu61 upgrade"
  - 7 Jan 2026: "fixes for handling NU6 network upgrade"

  — [WebZjs commits](https://github.com/ChainSafe/WebZjs/commits/main)
- History, from ChainSafe's blog (21 Jul 2025):
  - Summer 2024: feasibility study funded by Zcash Community Grants.
  - Sept 2024: first shielded transaction made entirely in a browser, using a WebZjs prototype.
  - Oct 2024: WebZjs ready for wallet development.
  - March 2025: ZconVI demo.
  - May 2025: Hacken audit completed and the Snap made public.

  The blog lists WebZjs as able to "Generate and verify zk-SNARKs", "Build and sign shielded transactions" and "Interface with Sapling". Only Sapling key management is mentioned for the Snap, and the blog gives no proving times or memory figures. — [ChainSafe blog](https://blog.chainsafe.io/zcash-in-the-browser-bringing-shielded-zec-to-metamask/)
- ChainSafe design notes (undated, roughly 2024):
  - Proof generation takes "roughly a few seconds per transaction".
  - Sync can take "several minutes or potentially hours in extreme cases".
  - Wallet state lives in memory and serializes to a Uint8Array.
  - IndexedDB is per-origin, so each dApp would need its own sync. Snap storage is up to 100 MB per Snap.
  - Orchard and Sapling are both mentioned, with Unified Spending Keys.
  - At the time, transaction creation required the USK or seed in the browser.
  - PCZTs were described as future work that would let proving run in the browser while authorization happens in the Snap or a hardware wallet.
  - The approach was described as "explicitly not for production".

  — [HackMD WebZjs design notes](https://hackmd.io/@wollum/BJaqaB81kl)
- ChainSafe runs gRPC-web proxies at zcash-mainnet.chainsafe.dev and zcash-testnet.chainsafe.dev. — [HackMD WebZjs design notes](https://hackmd.io/@wollum/BJaqaB81kl)

### Inferences
- NU6.3 changed the transaction rules: Ironwood actions, and fees counted per Orchard spend or output (zcash_client_backend 0.24.0, Aug 2026). WebZjs pins a NU6.1-era fork, so it likely cannot build valid post-NU6.3 Ironwood transactions until ChainSafe rebases. Treat this as likely but unverified: I could not find a release note saying so.
- "A few seconds per transaction" is an early, unbenchmarked claim. It was probably measured for Sapling using the multi-threaded WASM build.

### Gaps
- No published benchmark of WebZjs proving time or memory (Sapling or Orchard) on real devices.
- No statement on whether any WebZjs or Snap build supports Ironwood. The repo shows no commits after 16 Apr 2026.
- No published release tags. The Releases section on GitHub is empty.

## Other browser/JS options: MetaMask Snap, web wallets, librustzcash in wasm32, Halo 2 in WASM, parameter sizes

### Takeaway
Besides WebZjs, the browser options are the ChainSafe MetaMask Zcash Snap (built on WebZjs, audited by Hacken, Sapling-focused) and its demo web wallet at webzjs.chainsafe.dev. Sapling proving needs about 51.5 MB of Groth16 parameters. Orchard and Ironwood (Halo 2) need no downloaded parameters, but I found no public browser timing or memory numbers for them.

### Cited Findings
- The Zcash Snap for MetaMask is audited by Hacken and listed in the MetaMask Snaps Directory. It was jointly funded by the MetaMask Grants DAO and Zcash Community Grants and supports "fully shielded send and receive" with Sapling key management. — [ChainSafe blog](https://blog.chainsafe.io/zcash-in-the-browser-bringing-shielded-zec-to-metamask/); [ZecHub MetaMask snap guide](https://zechub.wiki/using-zcash/metamask-snap)
- Earlier project updates advised against keeping significant funds in the demo wallet. — summarized via [ZecHub newsletters](https://zechub.substack.com/p/zcash-shielded-news-vol41) (secondary source)
- The Sapling Groth16 parameters are `sapling-spend.params` (47,958,396 bytes) and `sapling-output.params` (3,592,860 bytes), about 51.5 MB in total, served from https://download.z.cash/downloads. — [librustzcash zcash_proofs/src/lib.rs](https://raw.githubusercontent.com/zcash/librustzcash/main/zcash_proofs/src/lib.rs)
- WebZjs added "lazy load to prevent instant downloads of wasm on page load" (Feb 2026), which suggests the WASM and parameter payload is heavy. — [WebZjs commits](https://github.com/ChainSafe/WebZjs/commits/main)
- Halo 2 browser builds use Rayon via wasm-bindgen-rayon for threads. That source is Axiom's halo2-wasm, not Zcash Orchard. — [halo2-wasm](https://rust-digger.code-maven.com/crates/halo2-wasm)
- The `zcash_client_backend` `lightwalletd-tonic` feature stopped working on `wasm32-wasi` in 0.13.0 (Aug 2024) because of an upstream tonic issue. WebZjs works around this with its own fork and gRPC-web. — [zcash_client_backend CHANGELOG](https://raw.githubusercontent.com/zcash/librustzcash/main/zcash_client_backend/CHANGELOG.md)
- A Ledger Zcash signer kit (TS) exists. The device exports a UFVK or Orchard FVK and returns per-action Orchard spendAuthSigs. The host builds the PCZT and computes the binding signature. — [Ledger Zcash signer kit](https://developers.ledger.com/docs/device-interaction/dmk-ts/references/signers/zcash)

### Inferences
- Multi-threaded WASM, which depends on wasm-bindgen-rayon and SharedArrayBuffer, typically requires cross-origin isolation (COOP/COEP headers) on the hosting page. Plan for this if you embed WebZjs. WebZjs's "netlify settings to cache and multithread" commit is consistent with that. This is a general WASM requirement, not something documented by WebZjs.
- Orchard and Ironwood proving builds a large proving key in memory at runtime, so expect a one-time key-build cost plus several seconds of proving per transaction on desktop, and worse on mobile. This is unverified.

### Gaps
- No Zcash-specific measured Orchard or Ironwood Halo 2 proving time or peak memory in WASM.
- I found no other maintained browser Zcash wallet besides WebZjs and the Snap. Zingo, Zashi/ZODL and YWallet are native apps.

## Can a browser wallet sync from lightwalletd or Zaino without exposing viewing keys? What does the server learn?

### Takeaway
Yes. With lightwalletd (or Zaino), viewing keys never leave the client. The server streams compact blocks and the client trial-decrypts locally. The server still learns the client's IP, sync timing and range, any specific transaction or block fetches (for example, full transactions fetched to read memos), and the transactions the client broadcasts. In a browser, the gRPC-web proxy is an additional party that sees the same metadata.

### Cited Findings
- Light-client server leak: "While all the keys and transaction detection happens on the client, the server can learn what blocks contain your shielded transactions. The server also learns other metadata about you like your ip address". Transparent addresses offer no privacy. — [zecwallet-light-cli README](https://github.com/boyfromcave/zecwallet-light-cli)
- Nym's threat model treats lightwalletd as the primary adversary. It streams compact blocks and relays the wallet's transactions, so it can link transactions to a user. — [Nym docs](https://nym.com/docs/network/threat-model/examples/wallet)
- Browser WebZjs must use a gRPC-web proxy in front of lightwalletd (a ChainSafe-hosted or self-hosted proxy). — [WebZjs README](https://github.com/ChainSafe/WebZjs)
- lightwalletd v0.4.0 was tagged around Dec 2025, adding optional transparent data in compact blocks. Zaino is being aligned with Zebra and Zallet under an OpenRPC spec and is named as part of future work to reduce light-wallet trust. — [Arborist Call #115 summary](https://zechub.substack.com/p/arborist-call-115-12112025-zcash)

### Inferences
- If the same operator runs the web app, the gRPC-web proxy and lightwalletd, that operator can correlate a browser session (cookies, account) with its sync pattern and broadcast transactions. Viewing keys remain hidden, but metadata linkage is strong. Self-hosting the proxy does not fix this. Tor or Nym, or a third-party lightwalletd, reduce it.

### Gaps
- No authoritative doc found listing exactly which lightwalletd RPCs leak which data (GetTransaction by txid, GetTaddressTxids, mempool streams).
- Not confirmed whether Zaino exposes a gRPC-web endpoint natively.

## Storing spending keys in browsers: options, risks, mitigations

### Takeaway
A browser can hold Zcash keys only as raw bytes in JS or WASM memory, persisted (ideally encrypted under a passphrase-derived key) in IndexedDB or similar. WebCrypto non-extractable keys cannot hold Jubjub or Pallas keys or perform RedJubjub/RedPallas signing. The dominant risk is the host serving malicious JS, which defeats any purely in-page custody. Isolation (MetaMask Snap sandbox, extension, hardware wallet) is the real mitigation.

### Cited Findings
- WebZjs leaves persistence to the consumer: it serializes in-memory state to bytes. IndexedDB is per-origin, and Snap storage is 100 MB per Snap. The only creation path in that design needed the USK or seed in the browser, which "would need a thorough audit". — [HackMD WebZjs design notes](https://hackmd.io/@wollum/BJaqaB81kl)
- The Snap model (key in the MetaMask Snap sandbox, audited by Hacken) is ChainSafe's answer to keeping keys away from page JS. — [ChainSafe blog](https://blog.chainsafe.io/zcash-in-the-browser-bringing-shielded-zec-to-metamask/)

### Inferences
- WebCrypto supports only standard algorithms (ECDSA/ECDH on NIST curves, Ed25519/X25519, AES, HMAC, PBKDF2/HKDF). It has no Jubjub, Pallas or RedDSA support. The most it can do is wrap a raw Zcash key as an AES-GCM-encrypted blob under a non-extractable key, and the plaintext key must still enter JS/WASM memory to sign. This is general platform knowledge; I found no source specific to Zcash.
- Risks for a web app holding keys in-page:
  - A compromised or coerced host serves JS that exfiltrates the key. This undermines any "non-custodial" claim unless the code is pinned, for example via Subresource Integrity, IPFS or an extension.
  - XSS and supply-chain dependencies.
  - Browser storage eviction leading to fund loss without a backup.
- Mitigations:
  - Signing in an extension or Snap, or on a hardware wallet (Keystone or Ledger via PCZT).
  - Reproducible or pinned front-end builds and a strict CSP.
  - Encrypting the key at rest under the user's passphrase.
  - Mandatory seed backup.

### Gaps
- No published Zcash guidance specific to browser key storage.

## Hybrid "server proposes, browser or device signs" via PCZT

### Takeaway
Yes, this is possible with current librustzcash.
- `zcash_client_backend::data_api::wallet::create_pczt_from_proposal` (present since 0.16.0, Dec 2024; latest 0.25.0, 21 Oct 2026) lets a server-side wallet that holds only a UFVK create a PCZT.
- The `pczt` crate (0.10.0) Signer needs only the spend authorizing key `ask` per spend (Sapling, Orchard and, now, Ironwood), or an externally produced RedJubjub/RedPallas signature.
- Proving does not need `ask`:
  - Orchard and Ironwood proofs need only the FVK plus randomness.
  - Sapling proofs need the proof generation key (ak, nsk). That gives proving capability but not spend authority.

So the side holding the viewing key and the side holding `ask` can be split: the server (or browser) proves, and the device or browser signs. This is the model Keystone and Ledger use.

### Cited Findings
- `pczt` 0.10.0 features include `prover`, `signer`, `io-finalizer`, `spend-finalizer`, `tx-extractor` and `zcp-builder`, with default features `std`, `orchard` and `sapling`. Roles: creator, io_finalizer, verifier, updater, redactor, prover, signer, low_level_signer, combiner, spend_finalizer and tx_extractor. The Constructor role has no implementation in the crate. — [pczt Cargo.toml](https://raw.githubusercontent.com/zcash/librustzcash/main/pczt/Cargo.toml); [pczt roles.rs](https://raw.githubusercontent.com/zcash/librustzcash/main/pczt/src/roles.rs)
- The Signer methods are:
  - `sign_sapling(rng, index, ask: &sapling::keys::SpendAuthorizingKey)`
  - `sign_orchard(rng, index, ask: &orchard::keys::SpendAuthorizingKey)`
  - `sign_ironwood(rng, index, ask: &orchard::keys::SpendAuthorizingKey)`
  - `apply_sapling_signature` and `apply_orchard_signature` for externally produced signatures
  - `sign_transparent(index, sk)` and `append_transparent_signature`

  A Sapling spend must already have `proof_generation_key` set, and Orchard and Ironwood spends must have `fvk` set. The default `SighashPolicy::ALL_ONLY` prevents signing transactions the signer did not review. — [pczt signer/mod.rs](https://raw.githubusercontent.com/zcash/librustzcash/main/pczt/src/roles/signer/mod.rs); [pczt roles.rs](https://raw.githubusercontent.com/zcash/librustzcash/main/pczt/src/roles.rs)
- `zcash_client_backend` CHANGELOG:
  - 0.16.0 (2024-12-16): added `create_pczt_from_proposal` and `extract_and_store_transaction_from_pczt`.
  - 0.24.0 (2026-08-18): added signer-view redaction helpers, an Orchard padding argument, Ironwood pool support, and NU6.3 fee rules.
  - 0.25.0 (2026-10-21): both functions take `clock` and `rng` and enforce recipient address expiry; `pczt` 0.10.0.

  — [zcash_client_backend CHANGELOG](https://raw.githubusercontent.com/zcash/librustzcash/main/zcash_client_backend/CHANGELOG.md)
- Sapling deliberately separates the spend authorizing key (ask) from the proof authorizing key (nsk). This lets a trusted device keep ask while a more powerful but less trusted machine holds nsk and proves. Prototypes include str4d's proof delegation work and a Trezor demo at Zcon3. — [Daira Emma Hopwood, HackMD](https://hackmd.io/vcJ20aZSTwWZLzUGjo8UpQ); [Octez Sapling docs](https://octez.tezos.com/docs/alpha/sapling.html)
- Ledger flow: the device exports a UFVK or Orchard FVK and returns only spendAuthSigs. The host builds the PCZT and computes the binding signature from bsk = sum of rcv. — [Ledger Zcash signer kit](https://developers.ledger.com/docs/device-interaction/dmk-ts/references/signers/zcash)
- Sapling and Orchard crate releases around Dec 2025 enabled "external PCZT signing" for constrained environments. Core libraries support disconnecting and reconnecting Keystone accounts. — [Arborist Call #115](https://zechub.substack.com/p/arborist-call-115-12112025-zcash)
- The Keystone hardware wallet (Zcash) was audited by Least Authority (final report 20 Mar 2025). — [Least Authority](https://leastauthority.com/zcg-keystone-hardware-wallet-final-audit-report)
- PCZTs separate construction from signing, using a propose, prove, sign, combine, finalize workflow. Proving can run in parallel with signing. — [pcztkit (Devfolio)](https://devfolio.co/projects/pcztkit-289b) (hackathon project; secondary)

### Inferences
Feasible architecture for a Rust-sidecar app:
1. The sidecar holds the UFVK only (zcash_client_sqlite), proposes the transaction and calls `create_pczt_from_proposal`.
2. The sidecar runs the Prover. Orchard and Ironwood need only the FVK. Sapling needs the proof generation key, which leaks no spend authority.
3. The sidecar applies signer-view redaction and ships the PCZT to the browser.
4. The browser loads only a small WASM signer (pczt `signer` feature plus the key derivation it needs) holding `ask`. It verifies the outputs it is signing, then calls `sign_ironwood`/`sign_sapling` and returns the PCZT.
5. The sidecar combines, runs the Spend Finalizer and TX Extractor, broadcasts, and stores the result with `extract_and_store_transaction_from_pczt`.

Properties of this design:
- The browser avoids sync, Halo 2 proving and the 51.5 MB Sapling parameters.
- The server sees the viewing key, so it is not private from the operator. It does make the server non-custodial for spend authority.

Caveats:
- The browser signer must independently check what it signs (recipient, amount, fee), or a malicious server can get it to authorize arbitrary spends. The SighashPolicy::ALL_ONLY default and redaction helpers help, but the UI must show decoded outputs.
- The host still serves the signer JS. Pin it, or move it into an extension, Snap or hardware wallet.
- Signing and proving do not need to be on the same side. Only `ask` must stay with the signer.

### Gaps
- Not verified whether the `pczt` signer builds cleanly to wasm32-unknown-unknown at 0.10.0. It likely does, since WebZjs already compiles pczt, but at an older version.
- ZIP number: the brief mentions "ZIP-374". I did not confirm a ZIP number for the PCZT format, so cite the `pczt` crate instead.
- Not verified whether Keystone or Zashi/ZODL firmware already supports `sign_ironwood`.

## Realistic integration effort for a team with a Rust sidecar (zcash_client_backend/zcash_client_sqlite)

### Takeaway
Two paths:
- **Full in-browser wallet via WebZjs:** high effort and high risk right now. It needs a NU6.3/Ironwood rebase of a ChainSafe fork, a gRPC-web proxy, COOP/COEP headers, multi-minute sync, and custom key-persistence UX. It is unaudited except for the Snap.
- **Hybrid "sidecar builds and proves, browser signs" PCZT flow:** moderate effort, roughly a few engineer-weeks. It uses mainline librustzcash APIs that the sidecar already depends on (0.24/0.25 have Ironwood and PCZT). The new work is a small wasm signer, a PCZT transport, review UI and security hardening.

### Cited Findings
- The sidecar's existing crates already expose the PCZT path: `create_pczt_from_proposal` and `extract_and_store_transaction_from_pczt` (0.16.0 onward, with Ironwood in 0.24.0 and 0.25.0 on 2026-10-21). — [zcash_client_backend CHANGELOG](https://raw.githubusercontent.com/zcash/librustzcash/main/zcash_client_backend/CHANGELOG.md)
- WebZjs depends on a fork (`ChainSafe/librustzcash-nu61`), and in Apr 2026 it moved "back to fork references of librustzcash". — [WebZjs Cargo.toml](https://raw.githubusercontent.com/ChainSafe/WebZjs/main/Cargo.toml); [WebZjs commits](https://github.com/ChainSafe/WebZjs/commits/main)
- WebZjs stores wallet state in memory and serializes it, so a sidecar SQLite DB and a browser in-memory DB would be two separate wallets needing reconciliation. — [HackMD WebZjs design notes](https://hackmd.io/@wollum/BJaqaB81kl)

### Inferences
Effort estimates (my judgment, not sourced):
- **Hybrid PCZT:**
  - 1–2 weeks for a wasm32 signer crate (pczt `signer` plus `zcash_keys`/ZIP-32 derivation from seed to `ask`, built with wasm-bindgen).
  - About 1 week for sidecar endpoints (propose to PCZT, prove, accept the signed PCZT, then finalize, extract and broadcast).
  - About 1 week for the browser review UI, encrypted key storage and backup.
  - Plus an external review.

  Note that the sidecar would then hold UFVKs, not USKs. That changes the custody claim from "custodial" to "operator sees everything but cannot spend".
- **Full WebZjs:** weeks to months, dominated by the NU6.3/Ironwood port and sync UX. The result is less private from the operator only if the operator still runs the proxy and lightwalletd.
- Whichever path you choose, Ironwood is now the only pool open for new shielded activity, so any chosen library must be on the NU6.3-capable librustzcash releases (Aug 2026 or later).

### Gaps
- No public case study of a production web app using a server-prover with a browser-signer PCZT split.
- No information on ChainSafe's funding status or roadmap for WebZjs after April 2026.
