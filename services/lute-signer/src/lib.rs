//! Lute browser signer (non-custodial payouts).
//!
//! The wallet seed is created and kept in the user's browser. Lute's server holds only the unified
//! full viewing key derived here: enough to see payments and to build and prove a transaction, never
//! enough to spend. To pay, the server sends a proved, unsigned PCZT (partially created Zcash
//! transaction); this crate checks what it pays and only then adds the spend-authorization
//! signatures for this wallet's own spends.
//!
//! The checks, all on the PCZT itself (the server is not trusted about what it built):
//! - single pool: no transparent, Sapling or Orchard parts, only Ironwood;
//! - exactly `amount_zat` goes to the expected recipient's Orchard-shaped receiver;
//! - every other output is to this wallet (change) or is a zero-value padding output;
//! - the value leaving the shielded pool is exactly `fee_zat`.
//!
//! Built natively (sidecar regtest tooling, tests) and as WebAssembly (`--features wasm`).

use anyhow::{anyhow, bail, Context};
use orchard::keys::{FullViewingKey, SpendAuthorizingKey};
use serde::{Deserialize, Serialize};
use zcash_keys::{address::Address, keys::UnifiedSpendingKey};
use zcash_protocol::consensus::{
    BlockHeight, MainNetwork, NetworkType, NetworkUpgrade, Parameters, TestNetwork,
};

#[cfg(feature = "wasm")]
mod wasm;

/// The network a key belongs to. Regtest uses testnet coin type and regtest encodings.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Net {
    Main,
    Test,
    Regtest,
}

impl Net {
    pub fn parse(s: &str) -> anyhow::Result<Net> {
        match s {
            "main" | "mainnet" => Ok(Net::Main),
            "test" | "testnet" => Ok(Net::Test),
            "regtest" => Ok(Net::Regtest),
            _ => bail!("unknown network {s}"),
        }
    }
}

impl Parameters for Net {
    fn network_type(&self) -> NetworkType {
        match self {
            Net::Main => NetworkType::Main,
            Net::Test => NetworkType::Test,
            Net::Regtest => NetworkType::Regtest,
        }
    }

    fn activation_height(&self, nu: NetworkUpgrade) -> Option<BlockHeight> {
        match self {
            Net::Main => MainNetwork.activation_height(nu),
            Net::Test => TestNetwork.activation_height(nu),
            // Only key derivation and address encoding use these parameters.
            Net::Regtest => Some(BlockHeight::from_u32(1)),
        }
    }
}

fn usk(seed: &[u8], net: Net, account: u32) -> anyhow::Result<UnifiedSpendingKey> {
    if seed.len() < 32 {
        bail!("seed must be at least 32 bytes");
    }
    let account = zip32::AccountId::try_from(account).map_err(|_| anyhow!("bad account index"))?;
    UnifiedSpendingKey::from_seed(&net, seed, account).map_err(|e| anyhow!("deriving keys: {e:?}"))
}

/// The unified full viewing key for `account` of this seed: what Lute's server is given. Shielded
/// parts only: a transparent part would make the server's sync ask the light server about
/// transparent addresses.
pub fn derive_ufvk(seed: &[u8], net: Net, account: u32) -> anyhow::Result<String> {
    shielded_only_ufvk(
        &usk(seed, net, account)?
            .to_unified_full_viewing_key()
            .encode(&net),
    )
}

/// Removes any transparent component from an encoded unified full viewing key (ZIP 316).
pub fn shielded_only_ufvk(encoded: &str) -> anyhow::Result<String> {
    use zcash_address::unified::{Container, Encoding, Fvk, Ufvk};
    let (net, ufvk) = Ufvk::decode(encoded).map_err(|e| anyhow!("viewing key: {e}"))?;
    let items: Vec<Fvk> = ufvk
        .items()
        .into_iter()
        .filter(|i| !matches!(i, Fvk::P2pkh(_)))
        .collect();
    Ok(Ufvk::try_from_items(items)
        .map_err(|e| anyhow!("viewing key: {e}"))?
        .encode(&net))
}

/// What the user approved, from the proposal summary shown to them.
#[derive(Clone, Debug, Deserialize)]
pub struct Expect {
    pub recipient: String,
    pub amount_zat: u64,
    pub fee_zat: u64,
}

/// One spend-authorization signature for the Ironwood action at `index`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpendSig {
    pub index: usize,
    pub sig: String,
}

/// Checks the PCZT against `expect` and signs this wallet's Ironwood spends.
pub fn sign_pczt(
    seed: &[u8],
    net: Net,
    account: u32,
    pczt_bytes: &[u8],
    expect: &Expect,
) -> anyhow::Result<Vec<SpendSig>> {
    let usk = usk(seed, net, account)?;
    let fvk = FullViewingKey::from(usk.orchard());
    let ask = SpendAuthorizingKey::from(usk.orchard());

    let pczt = pczt::Pczt::parse(pczt_bytes).map_err(|e| anyhow!("not a valid PCZT: {e:?}"))?;
    if !pczt.transparent().inputs().is_empty() || !pczt.transparent().outputs().is_empty() {
        bail!("refused: the transaction has transparent parts");
    }
    if !pczt.sapling().spends().is_empty() || !pczt.sapling().outputs().is_empty() {
        bail!("refused: the transaction uses the Sapling pool");
    }
    if !pczt.orchard().actions().is_empty() {
        bail!("refused: the transaction uses the Orchard pool");
    }

    let to = match Address::decode(&net, &expect.recipient) {
        Some(Address::Unified(ua)) => *ua
            .orchard()
            .ok_or_else(|| anyhow!("recipient has no Orchard-shaped receiver"))?,
        _ => bail!("recipient is not a unified address for this network"),
    };

    let mut to_recipient: u64 = 0;
    let mut mine: Vec<usize> = vec![];
    let checked = pczt::roles::verifier::Verifier::new(pczt)
        .with_ironwood::<String, _>(|b| {
            use pczt::roles::verifier::OrchardError::Custom;
            for (i, a) in b.actions().iter().enumerate() {
                let out = a.output();
                match (out.recipient(), out.value().map(|v| v.inner())) {
                    (Some(r), Some(v)) if *r == to => {
                        to_recipient = to_recipient
                            .checked_add(v)
                            .ok_or_else(|| Custom("value overflow".into()))?;
                    }
                    (Some(r), Some(_)) if fvk.scope_for_address(r).is_some() => {} // change
                    (_, Some(0)) => {}                                             // padding
                    _ => return Err(Custom(format!("refused: output {i} pays someone else"))),
                }
                if a.spend().fvk().as_ref() == Some(&fvk) {
                    mine.push(i);
                }
            }
            let net_out = i64::try_from(*b.value_sum())
                .map_err(|_| Custom("value sum out of range".into()))?;
            if net_out != expect.fee_zat as i64 {
                return Err(Custom(format!(
                    "refused: {net_out} zat leaves the shielded pool, expected the fee {}",
                    expect.fee_zat
                )));
            }
            Ok(())
        })
        .map_err(|e| anyhow!("{e:?}"))?
        .finish();
    if to_recipient != expect.amount_zat {
        bail!(
            "refused: the transaction pays the recipient {to_recipient} zat, not {}",
            expect.amount_zat
        );
    }
    if mine.is_empty() {
        bail!("refused: the transaction spends nothing from this wallet");
    }

    let mut signer =
        pczt::roles::signer::Signer::new(checked).map_err(|e| anyhow!("signer: {e:?}"))?;
    for i in &mine {
        signer
            .sign_ironwood(*i, &ask)
            .map_err(|e| anyhow!("signing action {i}: {e:?}"))?;
    }
    let signed = signer.finish();
    mine.iter()
        .map(|i| {
            let sig = signed.ironwood().actions()[*i]
                .spend()
                .spend_auth_sig()
                .context("signature missing after signing")?;
            Ok(SpendSig {
                index: *i,
                sig: hex::encode(sig),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ufvk_is_deterministic_and_network_specific() {
        let seed = [7u8; 32];
        let a = derive_ufvk(&seed, Net::Main, 0).unwrap();
        assert_eq!(a, derive_ufvk(&seed, Net::Main, 0).unwrap());
        assert!(a.starts_with("uview1"));
        assert_ne!(a, derive_ufvk(&seed, Net::Main, 1).unwrap());
        assert!(derive_ufvk(&seed, Net::Regtest, 0)
            .unwrap()
            .starts_with("uviewregtest1"));
        assert!(derive_ufvk(&[1u8; 16], Net::Main, 0).is_err());
    }

    #[test]
    fn viewing_key_has_no_transparent_part() {
        use zcash_address::unified::{Container, Encoding, Fvk, Ufvk};
        let k = derive_ufvk(&[9u8; 64], Net::Main, 1).unwrap();
        let (_, u) = Ufvk::decode(&k).unwrap();
        assert!(u.items().iter().all(|i| !matches!(i, Fvk::P2pkh(_))));
        assert!(u.items().iter().any(|i| matches!(i, Fvk::Orchard(_))));
        assert_eq!(shielded_only_ufvk(&k).unwrap(), k);
    }

    #[test]
    fn garbage_is_not_signed() {
        let e = Expect {
            recipient: "u1x".into(),
            amount_zat: 1,
            fee_zat: 10_000,
        };
        assert!(sign_pczt(&[7u8; 32], Net::Main, 0, b"not a pczt", &e).is_err());
    }
}
