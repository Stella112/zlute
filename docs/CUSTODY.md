# Custody: who can spend the money

This is the answer to "who can ultimately spend the funds in a Lute wallet", traced in the code and
on the deployed server (2026-10-26). It decides what Lute may claim.

## Summary

| Question | Answer |
|---|---|
| Where are the spending keys? | Each Lute wallet (`merchant`, `payout`, `agent`, per user) has a random 32-byte seed, sealed with XChaCha20-Poly1305 in `<wallet>/seed.enc`. The key that opens it is a separate 32-byte file `/opt/zlute/keys/<network>-<wallet>.kek` (mode 0400, root). Both are on the Lute server. |
| Who can decrypt and use them? | The wallet sidecar process (runs as root) and anyone with root on that server: the operator, and anyone who compromises the server or its host. |
| Does the user's approval key protect the funds? | It is enforced by **Lute's software**: the sidecar refuses to spend unless the user's key (or a mandate the user signed) approves the exact transaction. It is **not** a cryptographic constraint on the blockchain. Someone with root can open a seed and spend with other software, without the user's key. |
| Can users withdraw if Lute disappears? | **No.** Users never receive the wallet seed. The approval-key backup is not a wallet backup. The seed is raw 32-byte entropy, not a BIP-39 phrase, so it could not be imported into Zodl as is. |
| So is Lute custodial? | **Yes.** Hosted Lute is a custodial service with application-enforced approvals. |

## What the approval key does protect against

Because every spend must pass the sidecar's checks (`services/wallet-sidecar/src/control.rs`
`reserve` / `reserve_with_mandate`, verified against the wallet's own `owner.pub`,
`services/wallet-sidecar/src/api.rs` `owner_pub_for`), the following cannot move money:

| Attacker | Why they cannot spend | Evidence |
|---|---|---|
| Someone who takes over the web app or the API (or its database) | The API holds no keys; the sidecar rejects any spend without a valid signature from the wallet owner's key | E-007 (`NO_APPROVAL`, forged key `APPROVAL_SIGNATURE_INVALID`), E-010 (direct sidecar bypass refused) |
| A prompt-injected or buggy AI agent | It can only pay the one recipient in its signed mandate, within the per-payment cap and total budget, until expiry | E-010, E-011; tests A2/A3/A5/A8 |
| A replayed or altered approval | Approvals are one-use and bound to the exact transaction hash, with a 5-minute lifetime | E-007 (W8 `HASH_MISMATCH`, W12 `PROPOSAL_EXPIRED`, W13 `APPROVAL_ALREADY_USED`) |
| Another Lute user | Each wallet accepts only its own owner key, written once at creation | `owner_pub_for`; sign-up tests |

It does **not** protect against the operator (or anyone with root on the server), who can read the
seed and its key file directly.

## Code references

- Seed sealing: `services/wallet-sidecar/src/wallet/keystore.rs` (`seal`, `open`, AAD binds wallet name and network).
- Seed creation and loading: `services/wallet-sidecar/src/wallet/mod.rs` (`init`: 32 random bytes; `load_seed`).
- Key file location: `--keys-dir /opt/zlute/keys` (`infrastructure/sidecar/zlute-sidecar-main.service`).
- Approval checks: `services/wallet-sidecar/src/control.rs`, `services/wallet-sidecar/src/mandate.rs`.
- Per-wallet owner key: `services/wallet-sidecar/src/api.rs` (`h_create_wallet`, `owner_pub_for`).

## What Lute may claim

- "Lute requires your approval for every payout, or a budget you authorised in advance."
- "Payouts are approved with a key that stays in your browser; the server cannot approve on your behalf through Lute's software."
- "Hosted Lute holds your wallets (custodial). Keep only working balances there."

Lute must not claim: "non-custodial", "only you can move your money", "even the server cannot spend",
or that the approval-key backup restores funds.

## How it could become non-custodial (roadmap)

1. **Recovery phrase for users:** generate wallet seeds from a BIP-39 phrase and give the user the
   phrase at sign-up, so they can restore the wallet in Zodl if Lute disappears. (Recovery, not
   custody: the server would still hold the seed.)
2. **Self-hosting:** run the sidecar on the user's own machine; the operator then holds nothing.
3. **Client-side spending keys:** build and sign transactions in the user's browser or wallet, with
   the server only proposing; the server never holds spending keys.
4. **Threshold or hardware-isolated keys** for the hosted case (for example, the seed sealed to an
   enclave that only signs approved proposals).
