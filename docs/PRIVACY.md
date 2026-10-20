# Privacy

Scope: what Lute protects, from whom, and under which assumptions. Claims are scoped as "observer X cannot learn Y under assumption Z". Nothing here claims total anonymity, hidden IPs by default, or untraceable activity. See also `THREAT-MODEL.md`, `PRIVACY-MATRIX.md` and the evidence in `PRIVACY-EVIDENCE.md`.

## Sync backend (light-wallet server) — mandate §11

Lute's sidecar is a light client. It does **not** run a full node on mainnet. It talks lightwalletd-compatible gRPC to a light-wallet server (mainnet: `zec.rocks:443`, TLS; regtest: Zaino on `127.0.0.1:28137`). **This setup does not give the same privacy as a self-operated full node.**

Findings below come from reading the pinned sources (`zcash_client_backend@0.24.0` `src/sync.rs`, Lute's `services/wallet-sidecar/src/wallet/*.rs`, zcash-devtool f1ec9b1), not from documentation alone.

### What the server is asked, and what that reveals

| Call (who makes it) | When | What the server learns |
|---|---|---|
| `GetLatestBlock` (sync, init, verify) | every sync | that this IP runs a Zcash light client, and when it syncs |
| `GetSubtreeRoots` (sync, `sync.rs:244`) for Sapling, Orchard, Ironwood | every sync | nothing wallet-specific (global tree data) |
| `GetBlockRange` (sync, `sync.rs:355`) | for each scan range | the **ranges** this client scans. Every block in a range is downloaded, so individual transactions are not singled out, but range boundaries reveal the wallet's birthday and last-synced height. |
| `GetTreeState` at birthday−1 (wallet init) and for scan-range starts (`sync.rs:381`) | init, sync | the wallet's **birthday height**. zcash-devtool's own comment: "THIS APPROACH LEAKS THE BIRTHDAY TO THE SERVER". |
| `GetBlock` at Sapling activation (init, edge case) | init only | nothing beyond "a wallet with that birthday" |
| `GetTransaction(txid)` (`lute-sidecar wallet verify`) | payment verification | **that this IP is interested in that specific txid**, which links the IP to a payment. Compact blocks carry no memo, so reading `LUTE:<ref>` needs the full transaction. |
| `SendTransaction` (send / execute) | each broadcast | **the IP that submitted this transaction**, at the time it entered the mempool |
| `GetAddressUtxos` (transparent UTXO refresh, `sync.rs:526`) | **never** | not compiled. It is behind `#[cfg(feature = "transparent-inputs")]`, and Lute's sidecar does not enable that feature (only its unit tests use a transparent-capable `zcash_keys` dev-dependency, which Cargo resolver v2 keeps out of the release binary). |

Every call also reveals the client's **IP address** and **timing**.

### What the server cannot learn (under the stated assumptions)
- **Which shielded outputs belong to the wallet.** Trial decryption happens locally in the sidecar against compact blocks. Keys and viewing keys never leave the sidecar host. *Assumption:* the wallet scans whole ranges (it does: `GetBlockRange`) and does not call `GetTransaction` for every detected note. Lute calls it only in `verify`.
- **Shielded amounts, senders, recipients and memos** of transactions it did not see submitted, beyond what any chain observer sees (nothing, for shielded data).
- **Keys.** Spending keys, viewing keys and the owner approval key are never sent anywhere.

### Transport security
- TLS with certificate verification against WebPKI roots for every non-loopback host (`wallet/mod.rs` `connect`, as in zcash-devtool `connect_direct`). Verified for `zec.rocks` (C-011a: TLSv1.3, valid Let's Encrypt certificate).
- Plaintext is refused for any non-loopback host. It is allowed only for `127.0.0.1` (Zaino on the VPS, never published).

### Tor
- `zcash_client_backend@0.24.0` has a `tor` feature (arti-client) with Tor gRPC support (`src/tor.rs`, `src/tor/grpc.rs`), and zcash-devtool uses it via `--connection tor`.
- **Not enabled in Lute yet.** Current status: limitation. Plan: evaluate for the mainnet sidecar (P1b/P7) if it builds in CI and stays within the VPS memory cap. Until then, the server and network observers see the VPS's IP.

### Mitigations adopted
- Fresh, shielded-only receive address per request (W4), so a payment cannot be linked to other requests by address.
- Whole-range scanning; no per-transaction lookups except `verify`.
- Birthdays set near the chain tip at wallet creation (default tip − 100), so the birthday is uninformative beyond "created around now".
- No transparent queries at all.
- The sidecar's network position is a VPS, not the owner's home connection. This separates the owner's personal IP from the wallet, but the VPS IP is stable and attributable to Lute.

### Residual risks
- The light server (zec.rocks operator) can link the VPS IP to: Lute's sync schedule, wallet birthdays, payments Lute verified (`GetTransaction`) and payments Lute submitted (`SendTransaction`). Timing correlation between a customer's payment and Lute's `verify` call is possible.
- A malicious server could withhold or delay blocks or transactions (availability), but cannot forge shielded notes to the wallet's keys.
- No Tor (see above).
