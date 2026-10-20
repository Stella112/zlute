# Capability ledger

Statuses: DOCUMENTED · PROVEN · UNVERIFIED · BLOCKED · UNSUPPORTED. DOCUMENTED is never reported as PROVEN.

Source-verified on 2026-10-20 by downloading the crate archives from crates.io and reading the source.

## Pinned crate versions (latest stable on crates.io, all published 2026-10-14)

| Crate | Version |
|---|---|
| zcash_client_backend | 0.24.0 |
| zcash_client_sqlite | 0.22.0 |
| zcash_address | 0.13.0 |
| zcash_protocol | 0.10.6 |
| zcash_keys | 0.16.1 |
| zcash_primitives | 0.30.1 |
| zcash_proofs | 0.30.0 |
| zip321 | 0.9.0 |
| pczt | 0.9.3 |

Not yet compiled together. Compatibility of this set is UNVERIFIED until `cargo build` succeeds.

## Ledger

| ID | Capability | Status | Evidence / reference |
|---|---|---|---|
| C-001 | NU6.3 ("Ironwood") known to crates, mainnet activation height 3,428,143 | DOCUMENTED | `zcash_protocol@0.10.6` `src/consensus.rs:502` (`NetworkUpgrade::Nu6_3 => Some(BlockHeight(3_428_143))`); doc comment "The Ironwood / NU6.3 network upgrade". Testnet height 4,134,000 (line 537). |
| C-002 | NU6.3 is active on mainnet (activated 2026-07-28) | DOCUMENTED | Secondary sources via search (z.cash/upgrade/nu6-3 page, ZF engineering update). The z.cash page did not render for direct reading. Confirm via light-server `GetLightdInfo` in P1b. |
| C-003 | NU6.3 introduces a new shielded pool, **Ironwood** | DOCUMENTED | `zcash_protocol@0.10.6` `src/lib.rs:38` `enum ShieldedPool { Sapling, Orchard, Ironwood }` |
| C-004 | Orchard turnstile: after NU6.3 no payment may add value to the Orchard pool; payments to Orchard receivers are delivered in the Ironwood pool (v6 tx) | DOCUMENTED | `zcash_client_backend@0.24.0` `src/proposal.rs:116–140` (`OrchardReceiverRequiresIronwood`, `OrchardPoolValueCreation`, `OrchardPoolPayment`) |
| C-005 | Ironwood shares the Orchard receiver in a UA | DOCUMENTED | `zcash_keys@0.16.1` `src/address.rs:447` "Ironwood shares the Orchard receiver." |
| C-006 | Orchard→Ironwood migration uses ZIP-318 denominated crossings (`{1,2,5}×10^k`, 16-action padded prep txs, timed spacing) | DOCUMENTED | `zcash_protocol@0.10.6` `src/zip318.rs`; https://zips.z.cash/zip-0318 |
| C-007 | Wallet scanning, balances, spends and proposals for Ironwood | DOCUMENTED | `zcash_client_backend@0.24.0` CHANGELOG (Ironwood balance, nullifiers, shards, `ValuePool::Ironwood`, `decrypt_transaction` Ironwood domain) |
| C-008 | Tor transport in the backend | DOCUMENTED | `zcash_client_backend@0.24.0` feature `tor` (arti-client), `src/tor.rs`, `src/tor/grpc.rs`. Not exercised. |
| C-009 | lightwalletd gRPC client with TLS + WebPKI roots | DOCUMENTED | features `lightwalletd-tonic`, `lightwalletd-tonic-tls-webpki-roots` |
| C-010 | Light server `zec.rocks:443` (alias `zecrocks`, default in zcash-devtool); regional `ap./eu./na./sa.zec.rocks:443`; testnet `testnet.zec.rocks:443` | DOCUMENTED | `zcash/zcash-devtool` `src/remote.rs` (main branch, read 2026-10-20). TLS for non-loopback hosts. |
| C-011a | zec.rocks TLS with a valid certificate | PROVEN | 2026-10-20 `openssl s_client -connect zec.rocks:443 -servername zec.rocks -alpn h2 -verify_return_error`: TLSv1.3, ALPN h2, CN=zec.rocks, issuer Let's Encrypt YE2, verify return code 0 |
| C-011b | zec.rocks serves mainnet past NU6.3 (GetLightdInfo) | UNVERIFIED | To test from the sidecar in P1b |
| C-012 | A `FullPrivacy`-style policy object inside `zcash_client_backend` | UNSUPPORTED (as a named type) | grep for `FullPrivacy` / `PrivacyPolicy` in `zcash_client_backend@0.24.0/src`: no matches. Lute enforces the equivalent itself by inspecting the proposal (`input_count_in_pool`, `output_count_in_pool`, `change_count_in_pool`, `is_canonical_crossing` exist per CHANGELOG). |
| C-013 | Regtest support in zcash-devtool | DOCUMENTED | behind `regtest_support` feature, custom host:port (`src/remote.rs`) |
| C-014 | Sidecar can run against regtest params with these crates | UNVERIFIED | P1a |
| C-015 | zip321 `TransactionRequest`, `Payment`, `memo_to_base64`, `memo_from_base64` | DOCUMENTED | docs.rs zip321 0.9.0 (per mandate §27); source downloaded, not yet exercised |
| C-016 | Zodl (payer wallet) supports NU6.3 / Ironwood | DOCUMENTED | Owner's Zodl Android **3.17.1 (3155)** (screenshot 2026-10-20). zodl-inc/zodl-android CHANGELOG: 3.8.0 (2018) "added support for Zcash's Ironwood network upgrade (NU6.3)"; 3.9.0 (2339) "Move to Ironwood" guided Orchard→Ironwood migration. A real Zodl→Lute payment is the PROVEN step (P1b). |
| C-016a | Payer funds must already be in Ironwood for a same-pool (non-revealing) demo payment | Owner action | If the owner's Zodl balance is still in Orchard, paying a Lute UA is an Orchard→Ironwood crossing that reveals the value. Owner completes "Move to Ironwood" in Zodl before P1b. |
| C-018 | Zebra 6.2.3 mines shielded coinbase to a UA miner address; from NU6.3 the Orchard-receiver coinbase lands in **Ironwood** (v6 tx, no Orchard component) | DOCUMENTED | ZcashFoundation/zebra v6.2.3 (7121c82) `zebra-rpc/src/config/mining.rs` (`miner_address: Option<ZcashAddress>`, `miner_memo` "if miner_address contains a shielded component"); test `coinbase_at_nu6_3_routes_shielded_output_to_ironwood` in `zebra-rpc/src/methods/types/get_block_template/tests.rs`. Coinbase outputs are decryptable with the all-zero OVK (consensus rule), so fixture funding is public by design. Basis of D-007. |
| C-017 | Z3 regtest stack (Zebra, Zallet, Zaino) | BLOCKED | Docker not installed (B-002), disk (B-001) |
