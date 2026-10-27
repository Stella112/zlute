//! propose → approve (owner signature) → execute (mandate §13.2, §13.3).

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context};
use prost::Message;
use rand_core::{OsRng, RngCore};
use serde::Serialize;
use sha2::{Digest, Sha256};
use zcash_client_backend::proto::proposal::Proposal as ProposalProto;
use zcash_protocol::{PoolType, ShieldedPool};

use super::send::{Broadcast, LuteProposal};
use super::Wallet;
use crate::approval::{
    approval_message, parse_owner_pubkey, ProposalSummary, MAX_TX_ZAT, POLICY, PROPOSAL_TTL_S,
};
use crate::control::{ControlDb, SpendStatus};
use crate::mandate::Mandate;
use crate::policy::StepPools;

const CONTROL_FILE: &str = "control.sqlite";

pub(super) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after 1970")
        .as_secs()
}

fn pool_label(p: PoolType) -> &'static str {
    match p {
        PoolType::Transparent => "transparent",
        PoolType::Shielded(ShieldedPool::Sapling) => "sapling",
        PoolType::Shielded(ShieldedPool::Orchard) => "orchard",
        PoolType::Shielded(ShieldedPool::Ironwood) => "ironwood",
    }
}

const ALL_POOLS: [PoolType; 4] = [
    PoolType::TRANSPARENT,
    PoolType::SAPLING,
    PoolType::ORCHARD,
    PoolType::IRONWOOD,
];

/// Metadata that is not derivable from the proposal itself.
pub(super) struct Meta {
    pub(super) proposal_id: String,
    pub(super) created_at: u64,
    pub(super) expires_at: u64,
}

impl Wallet {
    pub(super) fn control(&self) -> anyhow::Result<ControlDb> {
        Ok(ControlDb::open(&self.dir.join(CONTROL_FILE))?)
    }

    /// Derives the bound summary from a proposal. Used both at propose time and, on the decoded
    /// stored proposal, at execute time, so a stored proposal that was altered no longer matches
    /// the approved hash (W8).
    pub(super) fn summarize(
        &self,
        proposal: &LuteProposal,
        meta: &Meta,
    ) -> anyhow::Result<ProposalSummary> {
        if proposal.steps().len() != 1 {
            bail!("multi-step proposal");
        }
        let step = proposal.steps().first();
        // Re-run the single-pool policy on whatever is being summarized.
        crate::policy::decide(&[StepPools::of(step)])
            .map_err(|d| anyhow!("policy denied: {}", serde_json::to_string(&d).unwrap()))?;
        let payments = step.transaction_request().payments();
        if payments.len() != 1 {
            bail!("expected exactly one payment");
        }
        let (idx, payment) = payments.iter().next().expect("one payment");
        let recipient_pool = step
            .payment_pools()
            .get(idx)
            .copied()
            .ok_or_else(|| anyhow!("payment pool unknown"))?;
        let pools = |f: &dyn Fn(PoolType) -> bool| -> Vec<String> {
            ALL_POOLS
                .iter()
                .filter(|p| f(**p))
                .map(|p| pool_label(*p).to_string())
                .collect()
        };
        Ok(ProposalSummary {
            proposal_id: meta.proposal_id.clone(),
            account: self.config.account.to_string(),
            network: serde_json::to_value(self.config.network)?
                .as_str()
                .unwrap_or_default()
                .to_string(),
            recipient: payment.recipient_address().encode(),
            recipient_pool: pool_label(recipient_pool).to_string(),
            amount_zat: payment.amount().map(u64::from).unwrap_or(0),
            fee_zat: u64::from(step.balance().fee_required()),
            input_pools: pools(&|p| step.input_in_pool(p)),
            output_pools: pools(&|p| step.output_in_pool(p)),
            change_pools: pools(&|p| step.change_in_pool(p)),
            policy: POLICY.to_string(),
            memo_hash: payment
                .memo()
                .map(|m| hex::encode(Sha256::digest(m.as_slice())))
                .unwrap_or_default(),
            created_at: meta.created_at,
            expires_at: meta.expires_at,
        })
    }

    /// Step 1: build, policy-check and store a proposal; nothing is signed.
    pub fn propose(
        &self,
        to: &str,
        amount_zat: u64,
        memo: Option<&str>,
    ) -> anyhow::Result<ProposalView> {
        if amount_zat > MAX_TX_ZAT {
            bail!("amount exceeds the per-transaction cap of {MAX_TX_ZAT} zat");
        }
        let mut db = self.db()?;
        let (proposal, _pool) = self.make_proposal(&mut db, to, amount_zat, memo)?;
        let mut id = [0u8; 16];
        OsRng.fill_bytes(&mut id);
        let created_at = now();
        let meta = Meta {
            proposal_id: hex::encode(id),
            created_at,
            expires_at: created_at + PROPOSAL_TTL_S,
        };
        let summary = self.summarize(&proposal, &meta)?;
        // zcash_client_backend@0.24.0 `proto::proposal::Proposal::from_standard_proposal`
        let bytes = ProposalProto::from_standard_proposal(&proposal).encode_to_vec();
        self.control()?.insert_proposal(&summary, &bytes)?;
        Ok(ProposalView::new(summary))
    }

    /// Shows a stored proposal and the exact message the owner must sign.
    pub fn show_proposal(&self, proposal_id: &str) -> anyhow::Result<ProposalView> {
        let (_, summary_json, _) = self
            .control()?
            .load_proposal(proposal_id)?
            .ok_or_else(|| anyhow!("unknown proposal"))?;
        Ok(ProposalView::new(serde_json::from_str(&summary_json)?))
    }

    /// Step 2: record the owner's signature over the proposal hash (verified here).
    pub fn approve(
        &self,
        proposal_id: &str,
        signature_hex: &str,
        owner_pub: &Path,
    ) -> anyhow::Result<()> {
        let owner = load_owner(owner_pub)?;
        let view = self.show_proposal(proposal_id)?;
        self.control()?
            .record_approval(
                &owner,
                &view.summary.network,
                &view.proposal_hash,
                signature_hex,
                now(),
            )
            .map_err(|d| anyhow!("approval rejected: {}", serde_json::to_string(&d).unwrap()))
    }

    /// Step 3: re-derive and re-check the stored proposal, atomically consume the approval and
    /// reserve budget, then prove, sign and broadcast exactly once.
    pub async fn execute(
        &self,
        proposal_id: &str,
        owner_pub: &Path,
    ) -> anyhow::Result<ExecuteOutcome> {
        if self.config.browser_signed {
            // Before the approval is consumed: this wallet can only pay with browser signatures.
            bail!("browser-signed wallet: Lute holds no spending key; use prepare-pczt / execute-signed");
        }
        let owner = load_owner(owner_pub)?;
        let mut control = self.control()?;
        control
            .precheck(proposal_id, now())
            .map_err(|d| anyhow!("execution denied: {}", serde_json::to_string(&d).unwrap()))?;
        let (_, summary_json, bytes) = control
            .load_proposal(proposal_id)?
            .ok_or_else(|| anyhow!("unknown proposal"))?;
        let stored: ProposalSummary = serde_json::from_str(&summary_json)?;

        let mut db = self.db()?;
        let decoded: LuteProposal = ProposalProto::decode(&bytes[..])?
            .try_into_standard_proposal(&self.params(), &db)
            .map_err(|e| anyhow!("stored proposal no longer valid: {e}"))?;
        let meta = Meta {
            proposal_id: stored.proposal_id.clone(),
            created_at: stored.created_at,
            expires_at: stored.expires_at,
        };
        let recomputed = self.summarize(&decoded, &meta)?.hash();

        let spend_id = control
            .reserve(&owner, &stored.network, proposal_id, &recomputed, now())
            .map_err(|d| anyhow!("execution denied: {}", serde_json::to_string(&d).unwrap()))?;

        let result = self.build_and_broadcast(&mut db, &decoded).await;
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

impl Wallet {
    /// Recovery lookup: the spend status of a proposal ("none" if it was never reserved).
    pub fn spend_status(&self, proposal_id: &str) -> anyhow::Result<SpendStatusView> {
        let control = self.control()?;
        if control.load_proposal(proposal_id)?.is_none() {
            bail!("unknown proposal");
        }
        Ok(match control.spend_for_proposal(proposal_id)? {
            None => SpendStatusView {
                status: "none".into(),
                txid: None,
            },
            Some((status, txid)) => SpendStatusView { status, txid },
        })
    }
}

#[derive(Debug, Serialize)]
pub struct SpendStatusView {
    /// none | reserved | submitted | released | ambiguous
    pub status: String,
    pub txid: Option<String>,
}

impl Wallet {
    /// The wallet's directory name: what a mandate's `wallet` field must equal.
    fn wallet_name(&self) -> String {
        self.dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    fn network_label(&self) -> anyhow::Result<String> {
        Ok(serde_json::to_value(self.config.network)?
            .as_str()
            .unwrap_or_default()
            .to_string())
    }

    /// Loads an owner-signed mandate (verified against the owner public key, this wallet and
    /// network, and the §13.1 caps) into this wallet's control DB.
    pub fn load_mandate(
        &self,
        mandate_json: &str,
        signature_hex: &str,
        owner_pub: &Path,
    ) -> anyhow::Result<MandateView> {
        let owner = load_owner(owner_pub)?;
        let network = self.network_label()?;
        let m = Mandate::verify(
            mandate_json,
            signature_hex,
            &owner,
            &network,
            &self.wallet_name(),
            now(),
        )
        .map_err(|e| anyhow!("mandate rejected: {}", serde_json::to_string(&e).unwrap()))?;
        let control = self.control()?;
        control
            .record_mandate(&m, signature_hex, now())
            .map_err(|d| anyhow!("mandate rejected: {}", serde_json::to_string(&d).unwrap()))?;
        self.mandate_status(&m.mandate_id)
    }

    pub fn mandate_status(&self, mandate_id: &str) -> anyhow::Result<MandateView> {
        let (m, used) = self
            .control()?
            .mandate_usage(mandate_id)
            .map_err(|d| anyhow!("execution denied: {}", serde_json::to_string(&d).unwrap()))?;
        Ok(MandateView {
            mandate_id: m.mandate_id.clone(),
            mandate_hash: m.hash(),
            max_tx_zat: m.max_tx_zat,
            total_zat: m.total_zat,
            committed_zat: used,
            remaining_zat: m.total_zat.saturating_sub(used),
            expires_at: m.expires_at,
            allowed_recipients: m.allowed_recipients.len(),
        })
    }

    /// Step 3 under a mandate: like `execute`, but the authorization is the loaded owner-signed
    /// mandate (recipient allow-list, per-tx cap, remaining budget, expiry), reserved atomically.
    pub async fn execute_with_mandate(
        &self,
        proposal_id: &str,
        mandate_id: &str,
        owner_pub: &Path,
    ) -> anyhow::Result<ExecuteOutcome> {
        if self.config.browser_signed {
            bail!("browser-signed wallet: Lute holds no spending key; use prepare-pczt / execute-signed");
        }
        let owner = load_owner(owner_pub)?;
        let mut control = self.control()?;
        let (_, summary_json, bytes) = control
            .load_proposal(proposal_id)?
            .ok_or_else(|| anyhow!("unknown proposal"))?;
        let stored: ProposalSummary = serde_json::from_str(&summary_json)?;

        let mut db = self.db()?;
        let decoded: LuteProposal = ProposalProto::decode(&bytes[..])?
            .try_into_standard_proposal(&self.params(), &db)
            .map_err(|e| anyhow!("stored proposal no longer valid: {e}"))?;
        let meta = Meta {
            proposal_id: stored.proposal_id.clone(),
            created_at: stored.created_at,
            expires_at: stored.expires_at,
        };
        // The recipient checked against the mandate comes from the re-derived proposal, not from
        // anything the caller sent.
        let summary = self.summarize(&decoded, &meta)?;
        let recomputed = summary.hash();
        let spend_id = control
            .reserve_with_mandate(
                &owner,
                &stored.network,
                proposal_id,
                &recomputed,
                &summary.recipient,
                mandate_id,
                now(),
            )
            .map_err(|d| anyhow!("execution denied: {}", serde_json::to_string(&d).unwrap()))?;

        let result = self.build_and_broadcast(&mut db, &decoded).await;
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

#[derive(Debug, Serialize)]
pub struct MandateView {
    pub mandate_id: String,
    pub mandate_hash: String,
    pub max_tx_zat: u64,
    pub total_zat: u64,
    pub committed_zat: u64,
    pub remaining_zat: u64,
    pub expires_at: u64,
    /// Count only: the allow-listed addresses are not echoed back.
    pub allowed_recipients: usize,
}

pub(super) fn load_owner(path: &Path) -> anyhow::Result<ed25519_dalek::VerifyingKey> {
    let hex_str = std::fs::read_to_string(path)
        .with_context(|| format!("reading owner public key {}", path.display()))?;
    parse_owner_pubkey(&hex_str).map_err(|e| anyhow!("owner public key: {e:?}"))
}

#[derive(Debug, Serialize)]
pub struct ProposalView {
    pub proposal_hash: String,
    /// The exact bytes the owner signs (UTF-8), shown so the owner can check them.
    pub sign_message: String,
    pub summary: ProposalSummary,
}

impl ProposalView {
    fn new(summary: ProposalSummary) -> Self {
        let proposal_hash = summary.hash();
        let sign_message =
            String::from_utf8(approval_message(&summary.network, &proposal_hash)).unwrap();
        ProposalView {
            proposal_hash,
            sign_message,
            summary,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ExecuteOutcome {
    pub proposal_hash: String,
    pub status: SpendStatus,
    pub txid: Option<String>,
    pub broadcast: Option<Broadcast>,
    pub detail: Option<String>,
}
