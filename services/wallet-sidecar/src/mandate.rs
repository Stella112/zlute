//! Owner-signed mandates (mandate §13.3): the only form of automated spending.
//!
//! A mandate is a canonical JSON object (sorted keys, no whitespace) signed by the owner key over
//! `"lute-mandate-v1|<network>|<sha256(canonical_json)>"`. It binds one wallet, a purpose, a
//! per-transaction cap, a total budget, an explicit recipient allow-list and an expiry. Without a
//! loaded, valid, unexpired mandate the sidecar spends nothing automatically: every other spend
//! still needs a one-use owner approval of the exact proposal.

use ed25519_dalek::VerifyingKey;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::approval::{verify_signature, ApprovalError, DAILY_CAP_ZAT, MAX_TX_ZAT};

/// Mandates may not outlive this (default expiry ≤ 48 h).
pub const MAX_MANDATE_LIFETIME_S: u64 = 48 * 3600;
pub const MAX_RECIPIENTS: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mandate {
    /// 32 lowercase hex characters.
    pub mandate_id: String,
    pub network: String,
    /// Wallet (directory) name this mandate may spend from, e.g. "agent".
    pub wallet: String,
    /// Only "agent" in this build.
    pub purpose: String,
    pub max_tx_zat: u64,
    pub total_zat: u64,
    /// Encoded addresses the mandate may pay; compared exactly with the proposal's recipient.
    pub allowed_recipients: Vec<String>,
    pub expires_at: u64,
    pub nonce: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MandateError {
    MandateMalformed,
    MandateSignatureInvalid,
    MandateWrongNetwork,
    MandateWrongWallet,
    MandatePurposeNotAllowed,
    MandateOverCaps,
    MandateExpired,
    MandateTooLong,
    MandateNoRecipients,
}

impl Mandate {
    pub fn canonical_json(&self) -> String {
        let v = serde_json::to_value(self).expect("mandate serializes");
        serde_json::to_string(&v).expect("value serializes")
    }

    pub fn hash(&self) -> String {
        hex::encode(Sha256::digest(self.canonical_json().as_bytes()))
    }

    /// Parses and fully validates a mandate for `wallet` on `network` at time `now`.
    pub fn verify(
        json: &str,
        signature_hex: &str,
        owner: &VerifyingKey,
        network: &str,
        wallet: &str,
        now: u64,
    ) -> Result<Mandate, MandateError> {
        let m: Mandate = serde_json::from_str(json).map_err(|_| MandateError::MandateMalformed)?;
        let id_ok = m.mandate_id.len() == 32
            && m.mandate_id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if !id_ok || m.nonce.is_empty() || m.nonce.len() > 64 {
            return Err(MandateError::MandateMalformed);
        }
        verify_signature(owner, &mandate_message(network, &m.hash()), signature_hex).map_err(
            |e| match e {
                ApprovalError::InvalidSignature | ApprovalError::BadSignatureEncoding => {
                    MandateError::MandateSignatureInvalid
                }
                ApprovalError::BadPublicKey => MandateError::MandateSignatureInvalid,
            },
        )?;
        if m.network != network {
            return Err(MandateError::MandateWrongNetwork);
        }
        if m.wallet != wallet {
            return Err(MandateError::MandateWrongWallet);
        }
        if m.purpose != "agent" {
            return Err(MandateError::MandatePurposeNotAllowed);
        }
        if m.max_tx_zat == 0
            || m.max_tx_zat > MAX_TX_ZAT
            || m.total_zat == 0
            || m.total_zat > DAILY_CAP_ZAT
            || m.max_tx_zat > m.total_zat
        {
            return Err(MandateError::MandateOverCaps);
        }
        if m.expires_at <= now {
            return Err(MandateError::MandateExpired);
        }
        if m.expires_at > now + MAX_MANDATE_LIFETIME_S {
            return Err(MandateError::MandateTooLong);
        }
        if m.allowed_recipients.is_empty() || m.allowed_recipients.len() > MAX_RECIPIENTS {
            return Err(MandateError::MandateNoRecipients);
        }
        Ok(m)
    }
}

pub fn mandate_message(network: &str, mandate_hash: &str) -> Vec<u8> {
    format!("lute-mandate-v1|{network}|{mandate_hash}").into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    const NOW: u64 = 1_800_000_000;

    fn key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    pub fn sample() -> Mandate {
        Mandate {
            mandate_id: "0123456789abcdef0123456789abcdef".into(),
            network: "regtest".into(),
            wallet: "agent".into(),
            purpose: "agent".into(),
            max_tx_zat: 20_000,
            total_zat: 30_000,
            allowed_recipients: vec!["uregtest1service".into()],
            expires_at: NOW + 3600,
            nonce: "n1".into(),
        }
    }

    fn sign(m: &Mandate, k: &SigningKey) -> String {
        hex::encode(k.sign(&mandate_message(&m.network, &m.hash())).to_bytes())
    }

    fn check(m: &Mandate, sig: &str) -> Result<Mandate, MandateError> {
        Mandate::verify(
            &m.canonical_json(),
            sig,
            &key().verifying_key(),
            "regtest",
            "agent",
            NOW,
        )
    }

    #[test]
    fn valid_mandate_verifies() {
        let m = sample();
        assert_eq!(check(&m, &sign(&m, &key())), Ok(m));
    }

    #[test]
    fn forged_or_altered_mandate_rejected() {
        let m = sample();
        let forged = sign(&m, &SigningKey::from_bytes(&[8u8; 32]));
        assert_eq!(
            check(&m, &forged),
            Err(MandateError::MandateSignatureInvalid)
        );
        // Raising the budget after signing breaks the signature.
        let sig = sign(&m, &key());
        let mut bigger = m.clone();
        bigger.total_zat = 5_000_000;
        assert_eq!(
            check(&bigger, &sig),
            Err(MandateError::MandateSignatureInvalid)
        );
    }

    /// A mutation of a valid mandate and the error it must produce.
    type Case = (fn(&mut Mandate), MandateError);

    #[test]
    fn bounds_are_enforced_even_when_signed() {
        let cases: Vec<Case> = vec![
            (
                |m| m.max_tx_zat = MAX_TX_ZAT + 1,
                MandateError::MandateOverCaps,
            ),
            (
                |m| m.total_zat = DAILY_CAP_ZAT + 1,
                MandateError::MandateOverCaps,
            ),
            (
                |m| m.max_tx_zat = m.total_zat + 1,
                MandateError::MandateOverCaps,
            ),
            (|m| m.expires_at = NOW, MandateError::MandateExpired),
            (
                |m| m.expires_at = NOW + MAX_MANDATE_LIFETIME_S + 1,
                MandateError::MandateTooLong,
            ),
            (
                |m| m.allowed_recipients.clear(),
                MandateError::MandateNoRecipients,
            ),
            (
                |m| m.wallet = "payout".into(),
                MandateError::MandateWrongWallet,
            ),
            (
                |m| m.network = "main".into(),
                MandateError::MandateWrongNetwork,
            ),
            (
                |m| m.purpose = "stream".into(),
                MandateError::MandatePurposeNotAllowed,
            ),
            (
                |m| m.mandate_id = "x".into(),
                MandateError::MandateMalformed,
            ),
        ];
        for (f, want) in cases {
            let mut m = sample();
            f(&mut m);
            // Signed over its own network so only the bound under test fails.
            let sig = hex::encode(
                key()
                    .sign(&mandate_message("regtest", &m.hash()))
                    .to_bytes(),
            );
            assert_eq!(check(&m, &sig), Err(want), "{m:?}");
        }
    }
}
