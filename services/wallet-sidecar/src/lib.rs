//! Lute wallet sidecar library.
//!
//! The sidecar is the only Lute component that parses Zcash addresses, holds keys or
//! signs (mandate §10, §18). Everything here fails closed.

pub mod api;
pub mod approval;
pub mod control;
pub mod inspect;
pub mod mandate;
pub mod network;
pub mod policy;
pub mod wallet;
pub mod zip321req;

/// Installs the process-wide rustls crypto provider (ring). Call once at startup, before any TLS.
/// Idempotent: a provider that is already installed is kept.
pub fn install_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

#[cfg(test)]
mod tls_tests {
    /// Regression: without an installed provider, the first TLS connection panics.
    #[test]
    fn crypto_provider_is_available() {
        super::install_crypto_provider();
        assert!(rustls::crypto::CryptoProvider::get_default().is_some());
    }
}
