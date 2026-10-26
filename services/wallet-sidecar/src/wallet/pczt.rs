//! Browser-signed (non-custodial) payouts.
//!
//! The wallet holds only a unified full viewing key; the seed is in the user's browser. A payment
//! is proposed and policy-checked as usual (`approve.rs`), then:
//! 1. `prepare_pczt` builds the transaction as a PCZT and creates its Ironwood proof (a viewing
//!    key is enough for both) and stores it;
//! 2. the browser checks the PCZT (`services/lute-signer`) and returns spend-authorization
//!    signatures, plus the owner's Ed25519 approval of the proposal hash (recorded by `approve`);
//! 3. `execute_signed` reserves budget exactly as `execute` does (approval, caps, binding), applies
//!    the signatures to the *stored* PCZT (the browser cannot change the transaction), verifies
//!    the finished transaction (proof and signatures) and broadcasts it once.

use std::path::Path;
use std::sync::OnceLock;

use anyhow::{anyhow, bail};
use orchard::circuit::{OrchardCircuitVersion, ProvingKey, VerifyingKey};
use orchard::primitives::redpallas;
use prost::Message;
use serde::{Deserialize, Serialize};
use zcash_client_backend::{
    data_api::wallet::{
        create_pczt_from_proposal, extract_and_store_transaction_from_pczt,
        input_selection::GreedyInputSelectorError,
    },
    proto::proposal::Proposal as ProposalProto,
    wallet::OvkPolicy,
};
use zcash_primitives::transaction::{builder::BundlePadding, fees::zip317};

use super::approve::{load_owner, now, ExecuteOutcome, Meta};
use super::send::{Broadcast, LuteProposal};
use super::Wallet;
use crate::approval::ProposalSummary;
use crate::control::SpendStatus;

/// Ironwood (NU6.3 onward) proves with the post-NU6.3 circuit
/// (zcash_primitives@0.30.1 `components::orchard::bundle_version_for_branch`).
const IRONWOOD_CIRCUIT: OrchardCircuitVersion = OrchardCircuitVersion::PostNu6_3;

fn proving_key() -> &'static ProvingKey {
    static PK: OnceLock<ProvingKey> = OnceLock::new();
    PK.get_or_init(|| ProvingKey::build(IRONWOOD_CIRCUIT))
}

fn verifying_key() -> &'static VerifyingKey {
    static VK: OnceLock<VerifyingKey> = OnceLock::new();
    VK.get_or_init(|| VerifyingKey::build(IRONWOOD_CIRCUIT))
}

/// What the browser receives to sign: the proved, unsigned transaction and the summary the owner
/// approves (the browser re-checks the PCZT against it before signing).
#[derive(Debug, Serialize)]
pub struct PcztView {
    pub proposal_hash: String,
    pub pczt_hex: String,
    pub summary: ProposalSummary,
}

/// A spend-authorization signature from the browser for the Ironwood action at `index`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SpendSig {
    pub index: usize,
    pub sig: String,
}

impl Wallet {
    fn stored_proposal(
        &self,
        proposal_id: &str,
    ) -> anyhow::Result<(ProposalSummary, LuteProposal, String)> {
        let (_, summary_json, bytes) = self
            .control()?
            .load_proposal(proposal_id)?
            .ok_or_else(|| anyhow!("unknown proposal"))?;
        let stored: ProposalSummary = serde_json::from_str(&summary_json)?;
        let db = self.db()?;
        let decoded: LuteProposal = ProposalProto::decode(&bytes[..])?
            .try_into_standard_proposal(&self.params(), &db)
            .map_err(|e| anyhow!("stored proposal no longer valid: {e}"))?;
        let meta = Meta {
            proposal_id: stored.proposal_id.clone(),
            created_at: stored.created_at,
            expires_at: stored.expires_at,
        };
        // W8: the stored proposal must still summarize to what is shown and approved.
        let recomputed = self.summarize(&decoded, &meta)?.hash();
        if recomputed != stored.hash() {
            bail!("execution denied: \"HASH_MISMATCH\"");
        }
        Ok((stored, decoded, recomputed))
    }

    /// Builds and proves the transaction for a stored proposal as an unsigned PCZT.
    pub fn prepare_pczt(&self, proposal_id: &str) -> anyhow::Result<PcztView> {
        if !self.config.browser_signed {
            bail!("not a browser-signed wallet");
        }
        let control = self.control()?;
        let (stored, decoded, hash) = self.stored_proposal(proposal_id)?;
        if now() >= stored.expires_at {
            bail!("execution denied: \"PROPOSAL_EXPIRED\"");
        }
        if let Some(existing) = control.load_pczt(proposal_id)? {
            return Ok(PcztView {
                proposal_hash: hash,
                pczt_hex: hex::encode(existing),
                summary: stored,
            });
        }
        let mut db = self.db()?;
        // zcash_client_backend@0.24.0 `data_api::wallet::create_pczt_from_proposal` (runs the
        // Creator, Constructor and IO Finalizer roles).
        let pczt =
            create_pczt_from_proposal::<_, _, GreedyInputSelectorError, _, zip317::FeeError, _>(
                &mut db,
                &self.params(),
                self.account(),
                OvkPolicy::Sender,
                &decoded,
                None,
                BundlePadding::DEFAULT,
            )
            .map_err(|e| anyhow!("create pczt: {e}"))?;
        if !pczt.transparent().inputs().is_empty()
            || !pczt.transparent().outputs().is_empty()
            || !pczt.sapling().spends().is_empty()
            || !pczt.sapling().outputs().is_empty()
            || !pczt.orchard().actions().is_empty()
        {
            bail!("policy denied: \"NOT_IRONWOOD_ONLY\"");
        }
        let proved = ::pczt::roles::prover::Prover::new(pczt)
            .create_ironwood_proof(proving_key())
            .map_err(|e| anyhow!("prove: {e:?}"))?
            .finish();
        let bytes = proved
            .serialize()
            .map_err(|e| anyhow!("encode pczt: {e:?}"))?;
        control.store_pczt(proposal_id, &bytes, now())?;
        // A concurrent prepare may have stored first; always hand out the stored one.
        let stored_bytes = control
            .load_pczt(proposal_id)?
            .ok_or_else(|| anyhow!("pczt not stored"))?;
        Ok(PcztView {
            proposal_hash: hash,
            pczt_hex: hex::encode(stored_bytes),
            summary: stored,
        })
    }

    /// Applies the browser's signatures to the stored PCZT and broadcasts, after the same atomic
    /// approval/caps reservation as `execute`.
    pub async fn execute_signed(
        &self,
        proposal_id: &str,
        sigs: &[SpendSig],
        owner_pub: &Path,
    ) -> anyhow::Result<ExecuteOutcome> {
        if !self.config.browser_signed {
            bail!("not a browser-signed wallet");
        }
        if sigs.is_empty() {
            bail!("execution denied: \"NO_SPEND_SIGNATURES\"");
        }
        let owner = load_owner(owner_pub)?;
        let mut control = self.control()?;
        control
            .precheck(proposal_id, now())
            .map_err(|d| anyhow!("execution denied: {}", serde_json::to_string(&d).unwrap()))?;
        let stored_pczt = control
            .load_pczt(proposal_id)?
            .ok_or_else(|| anyhow!("execution denied: \"NO_PCZT\""))?;
        let (stored, _decoded, recomputed) = self.stored_proposal(proposal_id)?;

        // Apply and verify the signatures before reserving: a bad signature consumes nothing.
        let mut signer = ::pczt::roles::signer::Signer::new(
            ::pczt::Pczt::parse(&stored_pczt).map_err(|e| anyhow!("stored pczt: {e:?}"))?,
        )
        .map_err(|e| anyhow!("signer: {e:?}"))?;
        for s in sigs {
            let raw: [u8; 64] = hex::decode(&s.sig)
                .ok()
                .and_then(|b| b.try_into().ok())
                .ok_or_else(|| anyhow!("execution denied: \"BAD_SPEND_SIGNATURE\""))?;
            signer
                .apply_ironwood_signature(s.index, redpallas::Signature::from(raw))
                .map_err(|_| anyhow!("execution denied: \"BAD_SPEND_SIGNATURE\""))?;
        }
        let signed = signer.finish();

        let spend_id = control
            .reserve(&owner, &stored.network, proposal_id, &recomputed, now())
            .map_err(|d| anyhow!("execution denied: {}", serde_json::to_string(&d).unwrap()))?;

        let mut db = self.db()?;
        let result = async {
            // Spend Finalizer + Transaction Extractor; the extractor verifies the Ironwood proof
            // and every signature against the sighash before anything is stored or sent.
            let txid = extract_and_store_transaction_from_pczt::<
                _,
                zcash_client_sqlite::ReceivedNoteId,
            >(&mut db, signed, None, Some(verifying_key()))
            .map_err(|e| anyhow!("finalize: {e}"))?;
            let raw = super::send::raw_transaction(&db, txid)?;
            let (b, detail) = self.broadcast(raw).await;
            anyhow::Ok((txid, b, detail))
        }
        .await;
        let (status, txid, broadcast, detail) = match result {
            Err(e) => (SpendStatus::Released, None, None, Some(format!("{e:#}"))),
            Ok((txid, b, detail)) => {
                let status = match b {
                    Broadcast::Accepted => SpendStatus::Submitted,
                    Broadcast::Rejected => SpendStatus::Released,
                    Broadcast::Ambiguous => SpendStatus::Ambiguous,
                };
                (status, Some(txid.to_string()), Some(b), detail)
            }
        };
        control.finish(spend_id, status, txid.as_deref(), now())?;
        Ok(ExecuteOutcome {
            proposal_hash: recomputed,
            status,
            txid,
            broadcast,
            detail,
        })
    }
}
