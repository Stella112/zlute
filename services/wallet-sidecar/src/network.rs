//! Network parameters for the sidecar.

use serde::{Deserialize, Serialize};
use zcash_protocol::{
    consensus::{BlockHeight, MainNetwork, NetworkType, NetworkUpgrade, Parameters, TestNetwork},
    local_consensus::LocalNetwork,
};

/// The networks the sidecar can run on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NetworkKind {
    Main,
    Test,
    /// Z3 regtest (ZcashFoundation/z3 e84ce9f `config/regtest/zebra.toml`).
    Regtest,
}

impl NetworkKind {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "main" => Some(Self::Main),
            "test" => Some(Self::Test),
            "regtest" => Some(Self::Regtest),
            _ => None,
        }
    }

    pub fn params_type(self) -> NetworkType {
        match self {
            Self::Main => NetworkType::Main,
            Self::Test => NetworkType::Test,
            Self::Regtest => NetworkType::Regtest,
        }
    }

    pub fn params(self) -> LuteNetwork {
        match self {
            Self::Main => LuteNetwork::Main(MainNetwork),
            Self::Test => LuteNetwork::Test(TestNetwork),
            Self::Regtest => LuteNetwork::Regtest(z3_regtest()),
        }
    }
}

/// Activation heights of Z3 regtest, read from `config/regtest/zebra.toml`
/// `[network.testnet_parameters.activation_heights]` (Z3 e84ce9f): Overwinter..Canopy at 1,
/// NU5..NU6.3 at 2. Uses `zcash_protocol@0.10.6::local_consensus::LocalNetwork`; its exhaustive
/// struct literal fails to compile if a dependency bump adds an upgrade.
pub fn z3_regtest() -> LocalNetwork {
    let one = Some(BlockHeight::from_u32(1));
    let two = Some(BlockHeight::from_u32(2));
    LocalNetwork {
        overwinter: one,
        sapling: one,
        blossom: one,
        heartwood: one,
        canopy: one,
        nu5: two,
        nu6: two,
        nu6_1: two,
        nu6_2: two,
        nu6_3: two,
    }
}

/// Parameters for whichever network the sidecar was configured with.
#[derive(Clone, Copy, Debug)]
pub enum LuteNetwork {
    Main(MainNetwork),
    Test(TestNetwork),
    Regtest(LocalNetwork),
}

impl Parameters for LuteNetwork {
    fn network_type(&self) -> NetworkType {
        match self {
            Self::Main(p) => p.network_type(),
            Self::Test(p) => p.network_type(),
            Self::Regtest(p) => p.network_type(),
        }
    }

    fn activation_height(&self, nu: NetworkUpgrade) -> Option<BlockHeight> {
        match self {
            Self::Main(p) => p.activation_height(nu),
            Self::Test(p) => p.activation_height(nu),
            Self::Regtest(p) => p.activation_height(nu),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regtest_has_nu6_3_at_height_2() {
        let p = NetworkKind::Regtest.params();
        assert_eq!(p.network_type(), NetworkType::Regtest);
        assert_eq!(
            p.activation_height(NetworkUpgrade::Nu6_3),
            Some(BlockHeight::from_u32(2))
        );
        assert_eq!(
            p.activation_height(NetworkUpgrade::Sapling),
            Some(BlockHeight::from_u32(1))
        );
    }

    #[test]
    fn mainnet_nu6_3_height_matches_capability_ledger() {
        // docs/CAPABILITIES.md C-001.
        assert_eq!(
            NetworkKind::Main
                .params()
                .activation_height(NetworkUpgrade::Nu6_3),
            Some(BlockHeight::from_u32(3_428_143))
        );
    }
}
