//! Shielded send (regtest only in this slice) and recipient-side verification.
//!
//! Flow follows zcash-devtool f1ec9b1 `src/commands/wallet/send.rs`, with Lute's additions:
//! sidecar recipient inspection, the single-pool policy (`crate::policy`) checked on the proposal
//! *before* any proving or signing, change kept in Ironwood, and no automatic broadcast retry.

use std::str::FromStr;

use anyhow::{anyhow, bail, Context};
use secrecy::ExposeSecret;
use serde::Serialize;
use zcash_address::ZcashAddress;
use zcash_client_backend::{
    data_api::{
        wallet::{
            create_proposed_transactions,
            input_selection::{GreedyInputSelector, GreedyInputSelectorError, SpendPolicy},
            propose_transfer, ConfirmationsPolicy, SpendingKeys,
        },
        Account, WalletRead,
    },
    decrypt_transaction,
    fees::{standard::MultiOutputChangeStrategy, DustOutputPolicy, SplitPolicy, StandardFeeRule},
    proto::service,
    wallet::OvkPolicy,
    TransferType,
};
use zcash_client_sqlite::wallet::commitment_tree;
use zcash_keys::keys::UnifiedSpendingKey;
use zcash_primitives::transaction::{fees::zip317, Transaction};
use zcash_proofs::prover::LocalTxProver;
use zcash_protocol::{
    consensus::{BlockHeight, BranchId},
    memo::{Memo, MemoBytes},
    value::Zatoshis,
    ShieldedPool, TxId,
};
use zip321::{Payment, TransactionRequest};

use super::{connect, Wallet, SEED_FILE};

/// A proposal as produced by `propose_transfer` against the sqlite wallet.
pub type LuteProposal =
    zcash_client_backend::proposal::Proposal<StandardFeeRule, zcash_client_sqlite::ReceivedNoteId>;
use crate::{
    inspect::inspect,
    network::NetworkKind,
    policy::{self, SinglePool},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Broadcast {
    /// The server accepted the transaction. Not the same as mined or confirmed.
    Accepted,
    /// The server answered with an error code; the transaction was not accepted.
    Rejected,
    /// No usable answer (transport error/timeout). The transaction may or may not be in the
    /// mempool. Never retried automatically; reconcile by txid (mandate §13.3, W16).
    Ambiguous,
}

#[derive(Debug, Serialize)]
pub struct SendOutcome {
    pub txid: String,
    pub pool: SinglePool,
    pub fee_zat: u64,
    pub broadcast: Broadcast,
    pub detail: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReceivedOutput {
    pub pool: &'static str,
    pub value_zat: u64,
    /// Text memo, if the memo is valid UTF-8 text. Never logged by the sidecar.
    pub memo_text: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Verification {
    pub txid: String,
    pub mined_height: Option<u32>,
    pub confirmations: u32,
    pub received: Vec<ReceivedOutput>,
}

fn pool_name(p: ShieldedPool) -> &'static str {
    match p {
        ShieldedPool::Sapling => "sapling",
        ShieldedPool::Orchard => "orchard",
        ShieldedPool::Ironwood => "ironwood",
    }
}

/// Downloads the Sapling proving parameters into the default folder
/// (`zcash_proofs@0.30.0::download_sapling_parameters`, hash-checked by the crate).
pub fn fetch_params() -> anyhow::Result<()> {
    zcash_proofs::download_sapling_parameters(Some(600))
        .map(|_| ())
        .map_err(|e| anyhow!("downloading Sapling parameters: {e}"))
}

impl Wallet {
    fn spending_key(&self) -> anyhow::Result<UnifiedSpendingKey> {
        let seed = secrecy::SecretVec::new(
            std::fs::read(self.dir.join(SEED_FILE)).context("reading seed file")?,
        );
        let db = self.db()?;
        let account = db
            .get_account(self.account())?
            .ok_or_else(|| anyhow!("account not found"))?;
        let derivation = account
            .source()
            .key_derivation()
            .ok_or_else(|| anyhow!("view-only account cannot spend"))?;
        UnifiedSpendingKey::from_seed(
            &self.params(),
            seed.expose_secret(),
            derivation.account_index(),
        )
        .map_err(|e| anyhow!("deriving spending key: {e:?}"))
    }

    /// Builds and policy-checks a proposal (no proving, no signing).
    pub(crate) fn make_proposal(
        &self,
        db: &mut super::Db,
        to: &str,
        amount_zat: u64,
        memo: Option<&str>,
    ) -> anyhow::Result<(LuteProposal, SinglePool)> {
        // Sidecar-side recipient inspection, independent of LuteGuard (W1, W2, W9).
        let inspection = inspect(to, self.config.network.params_type());
        if !inspection.is_allowed() {
            bail!(
                "recipient denied: {}",
                serde_json::to_string(&inspection.verdict)?
            );
        }
        if amount_zat == 0 {
            bail!("amount must be > 0");
        }
        // W10: Memo::from_str rejects text over 512 bytes.
        let memo = memo
            .map(Memo::from_str)
            .transpose()
            .map_err(|e| anyhow!("invalid memo: {e:?}"))?
            .map(MemoBytes::from);
        let payment = Payment::new(
            ZcashAddress::from_str(to).map_err(|e| anyhow!("{e}"))?,
            Some(Zatoshis::from_u64(amount_zat).map_err(|_| anyhow!("invalid amount"))?),
            memo,
            None,
            None,
            vec![],
        )
        .map_err(|e| anyhow!("payment: {e:?}"))?;
        let request = TransactionRequest::new(vec![payment]).map_err(|e| anyhow!("{e}"))?;

        // Change stays in Ironwood when not otherwise determined; the policy check below
        // rejects any proposal that is not single-pool regardless.
        let change = MultiOutputChangeStrategy::new(
            StandardFeeRule::Zip317,
            None,
            ShieldedPool::Ironwood,
            DustOutputPolicy::default(),
            SplitPolicy::single_output(),
        );
        // zcash_client_backend@0.24.0 `data_api::wallet::propose_transfer`
        let proposal = propose_transfer::<_, _, _, _, commitment_tree::Error>(
            db,
            &self.params(),
            self.account(),
            &GreedyInputSelector::new(),
            &change,
            request,
            ConfirmationsPolicy::MIN,
            &SpendPolicy::default(),
            None,
            None,
        )
        .map_err(|e| anyhow!("propose: {e}"))?;

        let pool = policy::check(&proposal)
            .map_err(|d| anyhow!("policy denied: {}", serde_json::to_string(&d).unwrap()))?;
        Ok((proposal, pool))
    }

    /// Proves, signs and broadcasts a policy-checked proposal exactly once.
    pub(crate) async fn build_and_broadcast(
        &self,
        db: &mut super::Db,
        proposal: &LuteProposal,
    ) -> anyhow::Result<(TxId, Broadcast, Option<String>)> {
        let params = self.params();
        let prover = LocalTxProver::with_default_location().ok_or_else(|| {
            anyhow!("Sapling parameters missing; run `lute-sidecar fetch-params`")
        })?;
        let usk = self.spending_key()?;
        // zcash_client_backend@0.24.0 `data_api::wallet::create_proposed_transactions`
        // Error type parameters pinned as in zcash-devtool f1ec9b1 `src/error.rs` (WalletErrorT).
        let txids =
            create_proposed_transactions::<_, _, GreedyInputSelectorError, _, zip317::FeeError, _>(
                db,
                &params,
                &prover,
                &prover,
                &SpendingKeys::from_unified_spending_key(usk),
                OvkPolicy::Sender,
                proposal,
                None,
            )
            .map_err(|e| anyhow!("create transaction: {e}"))?;
        if txids.len() != 1 {
            bail!("expected exactly one transaction, got {}", txids.len());
        }
        let txid = *txids.first();

        let tx = db
            .get_transaction(txid)?
            .ok_or_else(|| anyhow!("built transaction not found in wallet"))?;
        let mut raw = service::RawTransaction::default();
        tx.write(&mut raw.data)?;

        // Broadcast exactly once. Any transport failure is "ambiguous", never retried here.
        let (broadcast, detail) = match connect(&self.config.server).await {
            Err(e) => (Broadcast::Ambiguous, Some(format!("connect: {e}"))),
            Ok(mut client) => match client.send_transaction(raw).await {
                Ok(resp) => {
                    let r = resp.into_inner();
                    if r.error_code == 0 {
                        (Broadcast::Accepted, None)
                    } else {
                        (
                            Broadcast::Rejected,
                            Some(format!("{}: {}", r.error_code, r.error_message)),
                        )
                    }
                }
                Err(status) => (Broadcast::Ambiguous, Some(status.to_string())),
            },
        };
        Ok((txid, broadcast, detail))
    }

    /// REGTEST-ONLY test helper: propose + policy-check + build + broadcast without an owner
    /// approval. Used for fixture movements and W17. Every other network must use
    /// propose / approve / execute (mandate §13.3).
    pub async fn send(
        &self,
        to: &str,
        amount_zat: u64,
        memo: Option<&str>,
    ) -> anyhow::Result<SendOutcome> {
        if self.config.network != NetworkKind::Regtest {
            bail!("`send` is a regtest test helper; use propose/approve/execute");
        }
        let mut db = self.db()?;
        let (proposal, pool) = self.make_proposal(&mut db, to, amount_zat, memo)?;
        let fee_zat = u64::from(proposal.steps().first().balance().fee_required());
        let (txid, broadcast, detail) = self.build_and_broadcast(&mut db, &proposal).await?;
        Ok(SendOutcome {
            txid: txid.to_string(),
            pool,
            fee_zat,
            broadcast,
            detail,
        })
    }

    /// Fetches a transaction by txid and decrypts it with this wallet's own viewing key,
    /// reporting what this wallet received (amount, pool, memo) and its confirmations.
    ///
    /// Privacy note (docs/PRIVACY.md, light-server analysis): `GetTransaction` tells the server
    /// that this client is interested in this txid.
    pub async fn verify(&self, txid_hex: &str) -> anyhow::Result<Verification> {
        let txid = TxId::from_hex(txid_hex).ok_or_else(|| anyhow!("invalid txid"))?;
        let params = self.params();
        let mut client = connect(&self.config.server).await?;
        let tip: u32 = client
            .get_latest_block(service::ChainSpec::default())
            .await?
            .into_inner()
            .height
            .try_into()?;
        let raw = client
            .get_transaction(service::TxFilter {
                hash: txid.as_ref().to_vec(),
                ..Default::default()
            })
            .await?
            .into_inner();
        // RawTransaction.height: 0 = mempool, u64::MAX = mined on a non-main-chain fork.
        let mined = match raw.height {
            0 | u64::MAX => None,
            h => Some(BlockHeight::from_u32(u32::try_from(h)?)),
        };
        let branch = BranchId::for_height(
            &params,
            mined.unwrap_or(BlockHeight::from_u32(tip.saturating_add(1))),
        );
        let tx = Transaction::read(&raw.data[..], branch)?;
        if tx.txid() != txid {
            bail!("server returned a different transaction");
        }

        let ufvks = self.db()?.get_unified_full_viewing_keys()?;
        let decrypted = decrypt_transaction(
            &params,
            mined,
            Some(BlockHeight::from_u32(tip)),
            &tx,
            &ufvks,
        );

        let text = |m: &MemoBytes| match Memo::try_from(m) {
            Ok(Memo::Text(t)) => Some(t.to_string()),
            _ => None,
        };
        let mut received = vec![];
        for o in decrypted.sapling_outputs() {
            if o.transfer_type() == TransferType::Incoming {
                received.push(ReceivedOutput {
                    pool: pool_name(o.value_pool()),
                    value_zat: u64::from(o.note_value()),
                    memo_text: text(o.memo()),
                });
            }
        }
        for o in decrypted
            .orchard_outputs()
            .iter()
            .chain(decrypted.ironwood_outputs())
        {
            if o.transfer_type() == TransferType::Incoming {
                received.push(ReceivedOutput {
                    pool: pool_name(o.value_pool()),
                    // Orchard-shaped outputs carry (orchard::Note, ValuePool); value as in
                    // zcash_client_backend@0.24.0 decrypt.rs `note_value`.
                    value_zat: o.note().0.value().inner(),
                    memo_text: text(o.memo()),
                });
            }
        }

        Ok(Verification {
            txid: txid.to_string(),
            mined_height: mined.map(u32::from),
            confirmations: mined.map_or(0, |h| tip.saturating_sub(u32::from(h)) + 1),
            received,
        })
    }
}
