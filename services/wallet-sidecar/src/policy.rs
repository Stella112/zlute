//! Sidecar-side transaction policy (mandate §13.3, §18 TransactionPolicy; decision D-002).
//!
//! Enforced on every proposal before any signing, independently of LuteGuard:
//! - exactly one step (multi-step proposals cross pools or chain change; denied),
//! - zero transparent inputs and zero transparent outputs/change,
//! - no Orchard involvement (spending Orchard would be a value-revealing pool crossing after
//!   NU6.3; paying Orchard is impossible under the turnstile),
//! - exactly one shielded pool, Ironwood or Sapling, for inputs, payments and change.

use serde::Serialize;
use zcash_client_backend::proposal::{Proposal, Step};
use zcash_protocol::PoolType;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PolicyDenial {
    MultiStepProposal,
    TransparentInput,
    TransparentOutput,
    OrchardInvolved,
    CrossPool,
    NoShieldedPool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SinglePool {
    Ironwood,
    Sapling,
}

/// Facts about one proposal step, extracted with `zcash_client_backend@0.24.0`
/// `proposal::Step::{transparent_inputs, input_in_pool, output_in_pool, change_in_pool}`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StepPools {
    pub transparent_in: bool,
    pub transparent_out: bool,
    pub orchard: bool,
    pub ironwood: bool,
    pub sapling: bool,
}

impl StepPools {
    pub fn of<N>(step: &Step<N>) -> Self {
        let any =
            |p: PoolType| step.input_in_pool(p) || step.output_in_pool(p) || step.change_in_pool(p);
        StepPools {
            transparent_in: !step.transparent_inputs().is_empty()
                || step.input_in_pool(PoolType::TRANSPARENT),
            transparent_out: step.output_in_pool(PoolType::TRANSPARENT)
                || step.change_in_pool(PoolType::TRANSPARENT),
            orchard: any(PoolType::ORCHARD),
            ironwood: any(PoolType::IRONWOOD),
            sapling: any(PoolType::SAPLING),
        }
    }
}

/// Pure decision on the extracted facts (unit-testable without building real proposals).
pub fn decide(steps: &[StepPools]) -> Result<SinglePool, PolicyDenial> {
    let [s] = steps else {
        return Err(PolicyDenial::MultiStepProposal);
    };
    if s.transparent_in {
        return Err(PolicyDenial::TransparentInput);
    }
    if s.transparent_out {
        return Err(PolicyDenial::TransparentOutput);
    }
    if s.orchard {
        return Err(PolicyDenial::OrchardInvolved);
    }
    match (s.ironwood, s.sapling) {
        (true, false) => Ok(SinglePool::Ironwood),
        (false, true) => Ok(SinglePool::Sapling),
        (true, true) => Err(PolicyDenial::CrossPool),
        (false, false) => Err(PolicyDenial::NoShieldedPool),
    }
}

pub fn check<F, N>(proposal: &Proposal<F, N>) -> Result<SinglePool, PolicyDenial> {
    let steps: Vec<StepPools> = proposal.steps().iter().map(StepPools::of).collect();
    decide(&steps)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(f: impl FnOnce(&mut StepPools)) -> StepPools {
        let mut p = StepPools::default();
        f(&mut p);
        p
    }

    #[test]
    fn ironwood_only_allowed() {
        assert_eq!(
            decide(&[s(|p| p.ironwood = true)]),
            Ok(SinglePool::Ironwood)
        );
    }

    #[test]
    fn sapling_only_allowed() {
        assert_eq!(decide(&[s(|p| p.sapling = true)]), Ok(SinglePool::Sapling));
    }

    /// W5
    #[test]
    fn w5_transparent_input_denied() {
        let st = s(|p| {
            p.ironwood = true;
            p.transparent_in = true;
        });
        assert_eq!(decide(&[st]), Err(PolicyDenial::TransparentInput));
    }

    /// W1 (sidecar layer) / W3: any transparent output or change is denied.
    #[test]
    fn transparent_output_denied() {
        let st = s(|p| {
            p.ironwood = true;
            p.transparent_out = true;
        });
        assert_eq!(decide(&[st]), Err(PolicyDenial::TransparentOutput));
    }

    /// W6: cross-pool (Ironwood <-> Sapling) is denied.
    #[test]
    fn w6_cross_pool_denied() {
        let st = s(|p| {
            p.ironwood = true;
            p.sapling = true;
        });
        assert_eq!(decide(&[st]), Err(PolicyDenial::CrossPool));
    }

    /// D-002: Orchard involvement (a turnstile crossing) is denied.
    #[test]
    fn orchard_denied() {
        let st = s(|p| {
            p.orchard = true;
            p.ironwood = true;
        });
        assert_eq!(decide(&[st]), Err(PolicyDenial::OrchardInvolved));
    }

    #[test]
    fn multi_step_denied() {
        let st = s(|p| p.ironwood = true);
        assert_eq!(decide(&[st, st]), Err(PolicyDenial::MultiStepProposal));
        assert_eq!(decide(&[]), Err(PolicyDenial::MultiStepProposal));
    }

    #[test]
    fn empty_step_denied() {
        assert_eq!(
            decide(&[StepPools::default()]),
            Err(PolicyDenial::NoShieldedPool)
        );
    }
}
