//! Proposal binding, owner approvals and spending caps (mandate §13.1–§13.3).
//!
//! - A proposal is summarized into a canonical JSON object (sorted keys, no whitespace) and
//!   bound by `proposal_hash = SHA-256(canonical_json)`.
//! - An approval is an Ed25519 signature by the **owner key** over
//!   `"lute-approve-v1|<network>|<proposal_hash>"`. The owner's private key stays on the owner's
//!   machine (`tools/lute-owner`); the sidecar only holds the public key. An agent with shell
//!   access to the sidecar host therefore cannot approve a spend.
//! - Caps are compiled in and can only be changed by changing the binary (owner-only release).

use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// §13.1 caps, per spending account.
pub const MAX_TX_ZAT: u64 = 2_000_000;
pub const DAILY_CAP_ZAT: u64 = 5_000_000;
pub const WARN_BALANCE_ZAT: u64 = 10_000_000;
/// §13.2 proposal TTL.
pub const PROPOSAL_TTL_S: u64 = 300;

pub const POLICY: &str = "LUTE_STRICT/D-002";

/// Every field that determines what an executed proposal does. If any field changes, the hash
/// changes and the owner's approval no longer applies (W8).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposalSummary {
    pub proposal_id: String,
    pub account: String,
    pub network: String,
    pub recipient: String,
    pub recipient_pool: String,
    pub amount_zat: u64,
    pub fee_zat: u64,
    pub input_pools: Vec<String>,
    pub output_pools: Vec<String>,
    pub change_pools: Vec<String>,
    pub policy: String,
    /// SHA-256 of the memo bytes (hex), or empty when there is no memo. The memo itself is not
    /// stored in the summary.
    pub memo_hash: String,
    pub created_at: u64,
    pub expires_at: u64,
}

impl ProposalSummary {
    /// Canonical JSON: `serde_json::Value` objects are `BTreeMap`-backed (the `preserve_order`
    /// feature is not enabled), so keys serialize sorted; `to_string` emits no whitespace.
    pub fn canonical_json(&self) -> String {
        let v = serde_json::to_value(self).expect("summary serializes");
        serde_json::to_string(&v).expect("value serializes")
    }

    pub fn hash(&self) -> String {
        hex::encode(Sha256::digest(self.canonical_json().as_bytes()))
    }
}

pub fn approval_message(network: &str, proposal_hash: &str) -> Vec<u8> {
    format!("lute-approve-v1|{network}|{proposal_hash}").into_bytes()
}

#[derive(Debug, PartialEq, Eq)]
pub enum ApprovalError {
    BadPublicKey,
    BadSignatureEncoding,
    InvalidSignature,
}

pub fn parse_owner_pubkey(hex_str: &str) -> Result<VerifyingKey, ApprovalError> {
    let bytes: [u8; 32] = hex::decode(hex_str.trim())
        .map_err(|_| ApprovalError::BadPublicKey)?
        .try_into()
        .map_err(|_| ApprovalError::BadPublicKey)?;
    VerifyingKey::from_bytes(&bytes).map_err(|_| ApprovalError::BadPublicKey)
}

pub fn verify_approval(
    owner: &VerifyingKey,
    network: &str,
    proposal_hash: &str,
    signature_hex: &str,
) -> Result<(), ApprovalError> {
    let sig: [u8; 64] = hex::decode(signature_hex.trim())
        .map_err(|_| ApprovalError::BadSignatureEncoding)?
        .try_into()
        .map_err(|_| ApprovalError::BadSignatureEncoding)?;
    owner
        // verify_strict rejects weak keys and malleable signatures.
        .verify_strict(
            &approval_message(network, proposal_hash),
            &Signature::from_bytes(&sig),
        )
        .map_err(|_| ApprovalError::InvalidSignature)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn summary() -> ProposalSummary {
        ProposalSummary {
            proposal_id: "p1".into(),
            account: "a1".into(),
            network: "regtest".into(),
            recipient: "uregtest1xyz".into(),
            recipient_pool: "ironwood".into(),
            amount_zat: 1_000_000,
            fee_zat: 10_000,
            input_pools: vec!["ironwood".into()],
            output_pools: vec!["ironwood".into()],
            change_pools: vec!["ironwood".into()],
            policy: POLICY.into(),
            memo_hash: String::new(),
            created_at: 100,
            expires_at: 400,
        }
    }

    #[test]
    fn canonical_json_is_sorted_and_compact() {
        let j = summary().canonical_json();
        assert!(j.starts_with("{\"account\":\"a1\",\"amount_zat\":1000000,"));
        assert!(!j.contains(' '));
    }

    #[test]
    fn hash_is_stable() {
        assert_eq!(summary().hash(), summary().hash());
        assert_eq!(summary().hash().len(), 64);
    }

    /// W8: any change to a bound field changes the hash.
    #[test]
    fn w8_every_field_change_changes_hash() {
        let base = summary().hash();
        let mutations: Vec<Box<dyn Fn(&mut ProposalSummary)>> = vec![
            Box::new(|s| s.recipient.push('a')),
            Box::new(|s| s.amount_zat += 1),
            Box::new(|s| s.fee_zat += 1),
            Box::new(|s| s.recipient_pool = "sapling".into()),
            Box::new(|s| s.input_pools.push("sapling".into())),
            Box::new(|s| s.change_pools.clear()),
            Box::new(|s| s.network = "main".into()),
            Box::new(|s| s.account = "a2".into()),
            Box::new(|s| s.memo_hash = "00".into()),
            Box::new(|s| s.expires_at += 1),
            Box::new(|s| s.policy = "WEAKER".into()),
        ];
        for m in mutations {
            let mut s = summary();
            m(&mut s);
            assert_ne!(s.hash(), base);
        }
    }

    #[test]
    fn approval_signature_roundtrip_and_binding() {
        let sk = SigningKey::from_bytes(&[9u8; 32]);
        let pk_hex = hex::encode(sk.verifying_key().to_bytes());
        let pk = parse_owner_pubkey(&pk_hex).unwrap();
        let h = summary().hash();
        let sig = hex::encode(sk.sign(&approval_message("regtest", &h)).to_bytes());

        assert_eq!(verify_approval(&pk, "regtest", &h, &sig), Ok(()));
        // Bound to the hash (W8) and to the network (W9).
        let mut other = summary();
        other.amount_zat += 1;
        assert_eq!(
            verify_approval(&pk, "regtest", &other.hash(), &sig),
            Err(ApprovalError::InvalidSignature)
        );
        assert_eq!(
            verify_approval(&pk, "main", &h, &sig),
            Err(ApprovalError::InvalidSignature)
        );
        // A different key cannot approve.
        let other_pk = SigningKey::from_bytes(&[8u8; 32]).verifying_key();
        assert_eq!(
            verify_approval(&other_pk, "regtest", &h, &sig),
            Err(ApprovalError::InvalidSignature)
        );
        assert_eq!(
            verify_approval(&pk, "regtest", &h, "zz"),
            Err(ApprovalError::BadSignatureEncoding)
        );
    }
}
