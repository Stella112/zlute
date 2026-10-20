//! ZIP-321 payment requests (mandate §19.2) on `zip321@0.9.0`.
//!
//! A ZIP-321 URI exposes address, amount and memo to anyone who sees it; it is only shown on the
//! pay page after decryption and never placed in a public URL (MetadataPolicy).
//!
//! Lute's own requests: exactly one payment, a shielded recipient that passes sidecar inspection,
//! an amount, and the memo `LUTE:<opaqueRef>` where the ref is 8–64 base64url characters (so no
//! personal data can be put in it).

use std::str::FromStr;

use serde::Serialize;
use zcash_address::ZcashAddress;
use zcash_protocol::{
    consensus::NetworkType,
    memo::{Memo, MemoBytes},
    value::Zatoshis,
};
use zip321::{Payment, TransactionRequest};

use crate::inspect::{inspect, Verdict};

pub const MEMO_PREFIX: &str = "LUTE:";

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RequestError {
    InvalidOpaqueRef,
    RecipientDenied(Verdict),
    InvalidAmount,
    InvalidMemo,
    /// The URI failed ZIP-321 parsing (bad encoding, precision, duplicate params, …).
    Unparseable(String),
    NotExactlyOnePayment,
    MissingAmount,
    /// ZIP-321: a `req-` parameter this implementation does not understand must cause rejection.
    UnsupportedRequiredParam(String),
}

fn valid_ref(r: &str) -> bool {
    (8..=64).contains(&r.len())
        && r.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Builds `zcash:<address>?amount=<ZEC>&memo=<base64url "LUTE:<ref>">`.
pub fn build(
    network: NetworkType,
    address: &str,
    amount_zat: u64,
    opaque_ref: &str,
) -> Result<String, RequestError> {
    if !valid_ref(opaque_ref) {
        return Err(RequestError::InvalidOpaqueRef);
    }
    let i = inspect(address, network);
    if !i.is_allowed() {
        return Err(RequestError::RecipientDenied(i.verdict));
    }
    if amount_zat == 0 {
        return Err(RequestError::InvalidAmount);
    }
    let amount = Zatoshis::from_u64(amount_zat).map_err(|_| RequestError::InvalidAmount)?;
    let memo = Memo::from_str(&format!("{MEMO_PREFIX}{opaque_ref}"))
        .map_err(|_| RequestError::InvalidMemo)?;
    let addr =
        ZcashAddress::from_str(address).map_err(|e| RequestError::Unparseable(e.to_string()))?;
    let payment = Payment::new(
        addr,
        Some(amount),
        Some(MemoBytes::from(memo)),
        None,
        None,
        vec![],
    )
    .map_err(|e| RequestError::Unparseable(format!("{e:?}")))?;
    let req = TransactionRequest::new(vec![payment])
        .map_err(|e| RequestError::Unparseable(e.to_string()))?;
    // zip321@0.9.0 `TransactionRequest::to_uri`
    Ok(req.to_uri())
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct ParsedRequest {
    pub address: String,
    pub amount_zat: u64,
    pub memo_text: Option<String>,
    /// The `LUTE:` reference, if the memo carries one.
    pub opaque_ref: Option<String>,
}

/// Parses and validates a single-payment ZIP-321 request for the given network.
pub fn parse(network: NetworkType, uri: &str) -> Result<ParsedRequest, RequestError> {
    // zip321@0.9.0 `TransactionRequest::from_uri`
    let req =
        TransactionRequest::from_uri(uri).map_err(|e| RequestError::Unparseable(e.to_string()))?;
    let payments = req.payments();
    if payments.len() != 1 {
        return Err(RequestError::NotExactlyOnePayment);
    }
    let payment = payments.values().next().expect("one payment");
    if let Some((k, _)) = payment
        .other_params()
        .iter()
        .find(|(k, _)| k.starts_with("req-"))
    {
        return Err(RequestError::UnsupportedRequiredParam(k.clone()));
    }
    let address = payment.recipient_address().encode();
    let i = inspect(&address, network);
    if !i.is_allowed() {
        return Err(RequestError::RecipientDenied(i.verdict));
    }
    let amount_zat = u64::from(payment.amount().ok_or(RequestError::MissingAmount)?);
    if amount_zat == 0 {
        return Err(RequestError::InvalidAmount);
    }
    let memo_text = match payment.memo().map(Memo::try_from) {
        None => None,
        Some(Ok(Memo::Text(t))) => Some(t.to_string()),
        Some(Ok(_)) => None,
        Some(Err(_)) => return Err(RequestError::InvalidMemo),
    };
    let opaque_ref = memo_text
        .as_deref()
        .and_then(|m| m.strip_prefix(MEMO_PREFIX))
        .filter(|r| valid_ref(r))
        .map(str::to_string);
    Ok(ParsedRequest {
        address,
        amount_zat,
        memo_text,
        opaque_ref,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use zcash_address::ToAddress;
    use zcash_keys::keys::{
        ReceiverRequirement::{Omit, Require},
        UnifiedAddressRequest, UnifiedSpendingKey,
    };
    use zcash_protocol::consensus::MainNetwork;

    fn ua() -> String {
        let usk = UnifiedSpendingKey::from_seed(&MainNetwork, &[3u8; 32], zip32::AccountId::ZERO)
            .unwrap();
        let (ua, _) = usk
            .to_unified_full_viewing_key()
            .default_address(UnifiedAddressRequest::unsafe_custom(Require, Require, Omit))
            .unwrap();
        ua.to_zcash_address(NetworkType::Main).encode()
    }

    const REF: &str = "Ab3_x-9Zq1";

    #[test]
    fn build_parse_roundtrip() {
        let uri = build(NetworkType::Main, &ua(), 1_234_567, REF).unwrap();
        assert!(uri.starts_with("zcash:"));
        assert!(uri.contains("amount=0.01234567"));
        let p = parse(NetworkType::Main, &uri).unwrap();
        assert_eq!(p.amount_zat, 1_234_567);
        assert_eq!(p.memo_text.as_deref(), Some("LUTE:Ab3_x-9Zq1"));
        assert_eq!(p.opaque_ref.as_deref(), Some(REF));
        assert_eq!(p.address, ua());
    }

    #[test]
    fn opaque_ref_must_be_opaque() {
        for bad in [
            "short",
            "has space here",
            "alice@example.com",
            &"x".repeat(65),
        ] {
            assert_eq!(
                build(NetworkType::Main, &ua(), 1, bad),
                Err(RequestError::InvalidOpaqueRef),
                "{bad}"
            );
        }
    }

    #[test]
    fn transparent_recipient_not_requestable() {
        let t = ZcashAddress::from_transparent_p2pkh(NetworkType::Main, [1u8; 20]).encode();
        assert!(matches!(
            build(NetworkType::Main, &t, 1, REF),
            Err(RequestError::RecipientDenied(Verdict::DeniedTransparent))
        ));
        let uri = format!("zcash:{t}?amount=1");
        assert!(matches!(
            parse(NetworkType::Main, &uri),
            Err(RequestError::RecipientDenied(Verdict::DeniedTransparent))
        ));
    }

    #[test]
    fn wrong_network_denied() {
        let uri = build(NetworkType::Main, &ua(), 1_000, REF).unwrap();
        assert!(matches!(
            parse(NetworkType::Regtest, &uri),
            Err(RequestError::RecipientDenied(Verdict::DeniedWrongNetwork))
        ));
    }

    #[test]
    fn precision_beyond_8_decimals_rejected() {
        let uri = format!("zcash:{}?amount=0.000000001", ua());
        assert!(parse(NetworkType::Main, &uri).is_err());
    }

    #[test]
    fn invalid_encodings_rejected() {
        for uri in [
            "zcash:",
            "zcash:notanaddress?amount=1",
            "bitcoin:abc",
            "zcash:?amount=1",
        ] {
            assert!(parse(NetworkType::Main, uri).is_err(), "{uri}");
        }
    }

    #[test]
    fn conflicting_duplicate_params_rejected() {
        let uri = format!("zcash:{}?amount=1&amount=2", ua());
        assert!(parse(NetworkType::Main, &uri).is_err());
    }

    #[test]
    fn unknown_required_param_rejected() {
        let uri = format!("zcash:{}?amount=1&req-futurething=1", ua());
        assert!(matches!(
            parse(NetworkType::Main, &uri),
            Err(RequestError::UnsupportedRequiredParam(_)) | Err(RequestError::Unparseable(_))
        ));
    }

    #[test]
    fn multiple_payments_rejected() {
        let a = ua();
        let uri = format!("zcash:?address={a}&amount=1&address.1={a}&amount.1=2");
        assert_eq!(
            parse(NetworkType::Main, &uri),
            Err(RequestError::NotExactlyOnePayment)
        );
    }

    #[test]
    fn missing_or_zero_amount_rejected() {
        let a = ua();
        assert_eq!(
            parse(NetworkType::Main, &format!("zcash:{a}")),
            Err(RequestError::MissingAmount)
        );
        assert_eq!(
            parse(NetworkType::Main, &format!("zcash:{a}?amount=0")),
            Err(RequestError::InvalidAmount)
        );
    }

    /// W10: a memo over 512 bytes cannot be encoded.
    #[test]
    fn w10_oversized_memo_rejected() {
        assert!(Memo::from_str(&"a".repeat(513)).is_err());
        assert!(Memo::from_str(&"a".repeat(512)).is_ok());
    }
}
