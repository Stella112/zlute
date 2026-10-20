//! Lute wallet sidecar library.
//!
//! The sidecar is the only Lute component that parses Zcash addresses, holds keys or
//! signs (mandate §10, §18). Everything here fails closed.

pub mod api;
pub mod approval;
pub mod control;
pub mod inspect;
pub mod network;
pub mod policy;
pub mod wallet;
pub mod zip321req;
