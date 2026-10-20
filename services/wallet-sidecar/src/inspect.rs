//! Recipient inspection (mandate §18 TransactionPolicy, decision D-002).
//!
//! Lute accepts a recipient only if it can be paid in a single shielded pool:
//! - a Sapling address, or
//! - a Unified Address with an Orchard receiver (paid in the Ironwood pool after NU6.3)
//!   and/or a Sapling receiver. A transparent receiver inside such a UA is ignored, never paid.
//!
//! Everything else is denied: transparent P2PKH/P2SH, TEX (ZIP-320), Sprout, UAs whose only
//! known receivers are transparent, wrong-network and undecodable addresses.

use serde::Serialize;
use zcash_address::{ConversionError, ZcashAddress};
use zcash_keys::address::Address;
use zcash_protocol::consensus::NetworkType;

/// Why an address was accepted or rejected. Serialized as a stable reason code.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Verdict {
    Allowed,
    DeniedTransparent,
    DeniedTex,
    DeniedSprout,
    DeniedNoShieldedReceiver,
    DeniedWrongNetwork,
    DeniedInvalid,
}

/// The shielded pool a payment to this recipient would be delivered in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Pool {
    Ironwood,
    Sapling,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Inspection {
    pub verdict: Verdict,
    /// Address kind as decoded; `None` if undecodable.
    pub kind: Option<&'static str>,
    /// Receivers present in a UA (or the single receiver of a non-unified address).
    pub has_orchard: bool,
    pub has_sapling: bool,
    pub has_transparent: bool,
    /// Pools this recipient can be paid in under D-002, most preferred first.
    pub payable_pools: Vec<Pool>,
}

impl Inspection {
    fn denied(verdict: Verdict, kind: Option<&'static str>) -> Self {
        Inspection {
            verdict,
            kind,
            has_orchard: false,
            has_sapling: false,
            has_transparent: false,
            payable_pools: vec![],
        }
    }

    pub fn is_allowed(&self) -> bool {
        self.verdict == Verdict::Allowed
    }
}

/// Inspects an encoded address for the configured network.
///
/// Network and receiver validity come from `zcash_keys@0.16.1`
/// (`ZcashAddress::convert_if_network::<Address>`), which rejects wrong-network encodings and
/// Sapling/Orchard receivers that are not valid curve points.
pub fn inspect(encoded: &str, network: NetworkType) -> Inspection {
    // zcash_address@0.13.0 `ZcashAddress::try_from_encoded`
    let zaddr = match ZcashAddress::try_from_encoded(encoded.trim()) {
        Ok(a) => a,
        Err(_) => return Inspection::denied(Verdict::DeniedInvalid, None),
    };

    // zcash_address@0.13.0 `convert_if_network` treats testnet transparent encodings as valid
    // on regtest. Transparent is denied regardless, so that exception cannot admit anything.
    // zcash_keys@0.16.1 `impl TryFromAddress for Address` (Sprout is unsupported there).
    let addr = match zaddr.convert_if_network::<Address>(network) {
        Ok(a) => a,
        Err(ConversionError::IncorrectNetwork { .. }) => {
            return Inspection::denied(Verdict::DeniedWrongNetwork, None)
        }
        Err(ConversionError::Unsupported(_)) => {
            // The only kind zcash_keys' `Address` does not support is Sprout.
            return Inspection::denied(Verdict::DeniedSprout, Some("sprout"));
        }
        Err(ConversionError::User(_)) => return Inspection::denied(Verdict::DeniedInvalid, None),
    };

    match addr {
        Address::Sapling(_) => Inspection {
            verdict: Verdict::Allowed,
            kind: Some("sapling"),
            has_orchard: false,
            has_sapling: true,
            has_transparent: false,
            payable_pools: vec![Pool::Sapling],
        },
        Address::Transparent(_) => {
            Inspection::denied(Verdict::DeniedTransparent, Some("transparent"))
        }
        Address::Tex(_) => Inspection::denied(Verdict::DeniedTex, Some("tex")),
        Address::Unified(ua) => {
            // zcash_keys@0.16.1 `UnifiedAddress::{has_orchard, has_sapling, has_transparent}`.
            // Ironwood shares the Orchard receiver (zcash_keys@0.16.1 src/address.rs:447).
            let mut pools = vec![];
            if ua.has_orchard() {
                pools.push(Pool::Ironwood);
            }
            if ua.has_sapling() {
                pools.push(Pool::Sapling);
            }
            let verdict = if pools.is_empty() {
                Verdict::DeniedNoShieldedReceiver
            } else {
                Verdict::Allowed
            };
            Inspection {
                verdict,
                kind: Some("unified"),
                has_orchard: ua.has_orchard(),
                has_sapling: ua.has_sapling(),
                has_transparent: ua.has_transparent(),
                payable_pools: pools,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zcash_address::{unified, unified::Encoding, ToAddress};
    use zcash_keys::keys::{UnifiedAddressRequest, UnifiedSpendingKey};
    use zcash_protocol::consensus::{MainNetwork, TestNetwork};

    const SEED: [u8; 32] = [7u8; 32];

    /// Real, valid addresses derived from a fixed test seed. Test fixtures only.
    fn ua(net: NetworkType, request: UnifiedAddressRequest) -> zcash_keys::address::UnifiedAddress {
        let usk = match net {
            NetworkType::Main => {
                UnifiedSpendingKey::from_seed(&MainNetwork, &SEED, zip32::AccountId::ZERO)
            }
            _ => UnifiedSpendingKey::from_seed(&TestNetwork, &SEED, zip32::AccountId::ZERO),
        }
        .unwrap();
        usk.to_unified_full_viewing_key()
            .default_address(request)
            .unwrap()
            .0
    }

    fn encode_ua(ua: &zcash_keys::address::UnifiedAddress, net: NetworkType) -> String {
        ua.to_zcash_address(net).encode()
    }

    #[test]
    fn shielded_ua_allowed_ironwood_first() {
        let a = encode_ua(
            &ua(NetworkType::Main, UnifiedAddressRequest::SHIELDED),
            NetworkType::Main,
        );
        let i = inspect(&a, NetworkType::Main);
        assert_eq!(i.verdict, Verdict::Allowed);
        assert_eq!(i.payable_pools, vec![Pool::Ironwood, Pool::Sapling]);
        assert!(!i.has_transparent);
    }

    #[test]
    fn orchard_only_ua_pays_ironwood() {
        let a = encode_ua(
            &ua(NetworkType::Main, UnifiedAddressRequest::ORCHARD),
            NetworkType::Main,
        );
        let i = inspect(&a, NetworkType::Main);
        assert_eq!(i.verdict, Verdict::Allowed);
        assert_eq!(i.payable_pools, vec![Pool::Ironwood]);
    }

    #[test]
    fn sapling_address_allowed() {
        let u = ua(NetworkType::Main, UnifiedAddressRequest::SHIELDED);
        let a = Address::Sapling(*u.sapling().unwrap()).encode(&MainNetwork);
        let i = inspect(&a, NetworkType::Main);
        assert_eq!(i.verdict, Verdict::Allowed);
        assert_eq!(i.payable_pools, vec![Pool::Sapling]);
    }

    /// W3 (address part): a UA that also carries a transparent receiver is allowed, but only
    /// shielded pools are payable.
    #[test]
    fn w3_ua_with_transparent_receiver_pays_only_shielded() {
        let a = encode_ua(
            &ua(NetworkType::Main, UnifiedAddressRequest::ALLOW_ALL),
            NetworkType::Main,
        );
        let i = inspect(&a, NetworkType::Main);
        assert_eq!(i.verdict, Verdict::Allowed);
        assert!(i.has_transparent);
        assert_eq!(i.payable_pools, vec![Pool::Ironwood, Pool::Sapling]);
    }

    /// W1: transparent recipients are denied.
    #[test]
    fn w1_transparent_denied() {
        let p2pkh = ZcashAddress::from_transparent_p2pkh(NetworkType::Main, [1u8; 20]).encode();
        let p2sh = ZcashAddress::from_transparent_p2sh(NetworkType::Main, [2u8; 20]).encode();
        assert_eq!(
            inspect(&p2pkh, NetworkType::Main).verdict,
            Verdict::DeniedTransparent
        );
        assert_eq!(
            inspect(&p2sh, NetworkType::Main).verdict,
            Verdict::DeniedTransparent
        );
    }

    /// W2: TEX (ZIP-320) is denied.
    #[test]
    fn w2_tex_denied() {
        let tex = ZcashAddress::from_tex(NetworkType::Main, [3u8; 20]).encode();
        assert_eq!(inspect(&tex, NetworkType::Main).verdict, Verdict::DeniedTex);
    }

    /// A UA whose only receiver is transparent cannot be paid privately.
    #[test]
    fn transparent_only_ua_denied() {
        let ua = unified::Address::try_from_items(vec![unified::Receiver::P2pkh([4u8; 20])]);
        // ZIP-316 may forbid transparent-only UAs at construction; either way it must not pass.
        if let Ok(ua) = ua {
            let a = ZcashAddress::from_unified(NetworkType::Main, ua).encode();
            assert!(!inspect(&a, NetworkType::Main).is_allowed());
        }
    }

    /// W9: wrong network is denied.
    #[test]
    fn w9_wrong_network_denied() {
        let a = encode_ua(
            &ua(NetworkType::Test, UnifiedAddressRequest::SHIELDED),
            NetworkType::Test,
        );
        assert_eq!(
            inspect(&a, NetworkType::Main).verdict,
            Verdict::DeniedWrongNetwork
        );
        let m = encode_ua(
            &ua(NetworkType::Main, UnifiedAddressRequest::SHIELDED),
            NetworkType::Main,
        );
        assert_eq!(
            inspect(&m, NetworkType::Regtest).verdict,
            Verdict::DeniedWrongNetwork
        );
    }

    #[test]
    fn invalid_encodings_denied() {
        for s in [
            "",
            "zcash",
            "u1notreal",
            "zs1xxxxxxxx",
            "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbX",
        ] {
            assert_eq!(
                inspect(s, NetworkType::Main).verdict,
                Verdict::DeniedInvalid,
                "{s}"
            );
        }
    }

    /// A structurally valid UA whose Orchard receiver bytes are not a valid point is invalid.
    #[test]
    fn invalid_orchard_point_denied() {
        let ua = unified::Address::try_from_items(vec![unified::Receiver::Orchard([0xffu8; 43])])
            .unwrap();
        let a = ZcashAddress::from_unified(NetworkType::Main, ua).encode();
        assert_eq!(
            inspect(&a, NetworkType::Main).verdict,
            Verdict::DeniedInvalid
        );
    }

    #[test]
    fn verdict_serializes_as_reason_code() {
        assert_eq!(
            serde_json::to_string(&Verdict::DeniedTex).unwrap(),
            "\"DENIED_TEX\""
        );
    }
}
