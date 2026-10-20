//! Seed encryption at rest (mandate §10.5): XChaCha20-Poly1305 (`chacha20poly1305@0.10`, already
//! in the dependency tree via librustzcash) under a per-wallet 256-bit key-encryption key (KEK)
//! stored in its own file **outside** the wallet directory (mode 0400).
//!
//! What this protects: copies of the wallet directory or backups without the KEK file.
//! What it does not protect: a compromise of the host user that can read the KEK file (root on
//! the shared VPS). This is encryption at rest, not end-to-end encryption (docs/PRIVACY.md).

use anyhow::{anyhow, bail, Context};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand_core::{OsRng, RngCore};
use secrecy::SecretVec;
use std::path::Path;

const VERSION: &[u8] = b"lute-seed-v1";

/// Additional authenticated data: binds the ciphertext to its wallet name and network, so a
/// sealed seed cannot be swapped between wallets unnoticed.
pub fn aad(name: &str, network: &str) -> Vec<u8> {
    [VERSION, b"|", network.as_bytes(), b"|", name.as_bytes()].concat()
}

pub fn seal(kek: &[u8; 32], aad: &[u8], seed: &[u8]) -> Vec<u8> {
    let cipher = XChaCha20Poly1305::new(kek.into());
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: seed, aad })
        .expect("encryption with a valid key cannot fail");
    [&nonce[..], &ct[..]].concat()
}

pub fn open(kek: &[u8; 32], aad: &[u8], blob: &[u8]) -> anyhow::Result<SecretVec<u8>> {
    if blob.len() < 24 + 16 {
        bail!("sealed seed is too short");
    }
    let (nonce, ct) = blob.split_at(24);
    let cipher = XChaCha20Poly1305::new(kek.into());
    let pt = cipher
        .decrypt(XNonce::from_slice(nonce), Payload { msg: ct, aad })
        .map_err(|_| anyhow!("seed decryption failed (wrong key file, wallet or tampering)"))?;
    Ok(SecretVec::new(pt))
}

/// Creates a new KEK file (refuses to overwrite) and returns the key.
pub fn create_kek(path: &Path) -> anyhow::Result<[u8; 32]> {
    use std::io::Write;
    let mut kek = [0u8; 32];
    OsRng.fill_bytes(&mut kek);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o400);
    }
    opts.open(path)
        .with_context(|| {
            format!(
                "creating key file {} (it must not already exist)",
                path.display()
            )
        })?
        .write_all(&kek)?;
    Ok(kek)
}

pub fn read_kek(path: &Path) -> anyhow::Result<[u8; 32]> {
    let bytes =
        std::fs::read(path).with_context(|| format!("reading key file {}", path.display()))?;
    bytes
        .try_into()
        .map_err(|_| anyhow!("key file {} must hold exactly 32 bytes", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use secrecy::ExposeSecret;

    #[test]
    fn roundtrip() {
        let kek = [1u8; 32];
        let a = aad("payout", "main");
        let blob = seal(&kek, &a, b"thirty-two byte seed material!!!");
        assert_eq!(
            open(&kek, &a, &blob).unwrap().expose_secret().as_slice(),
            b"thirty-two byte seed material!!!"
        );
    }

    #[test]
    fn wrong_key_wallet_network_or_tamper_fails() {
        let kek = [1u8; 32];
        let a = aad("payout", "main");
        let mut blob = seal(&kek, &a, b"seed");
        assert!(open(&[2u8; 32], &a, &blob).is_err());
        assert!(open(&kek, &aad("agent", "main"), &blob).is_err());
        assert!(open(&kek, &aad("payout", "test"), &blob).is_err());
        let last = blob.len() - 1;
        blob[last] ^= 1;
        assert!(open(&kek, &a, &blob).is_err());
        assert!(open(&kek, &a, &[0u8; 10]).is_err());
    }

    #[test]
    fn nonces_are_fresh() {
        let kek = [1u8; 32];
        assert_ne!(seal(&kek, b"a", b"s"), seal(&kek, b"a", b"s"));
    }
}
