//! `lute-owner`: the owner's approval key (mandate §13.3). Runs on the owner's own machine.
//!
//! - `init --key <file>`: creates an Ed25519 key (refuses to overwrite) and prints the public key
//!   to register on the sidecar host as `/opt/zlute/owner.pub`.
//! - `sign --key <file>`: reads a proposal view (the JSON printed by
//!   `lute-sidecar wallet … show`) from stdin, **recomputes the proposal hash locally**, shows the
//!   decoded payment and asks the owner to type `approve <first 8 hash chars>` before signing.
//!   It never signs a hash it did not compute itself.
//!
//! - `sign-mandate --key <file>`: reads a mandate (JSON) from stdin, shows its bounds, and signs
//!   its canonical hash after the owner types `approve mandate <first 8 hash chars>`.
//!
//! The message formats and hashes must match `services/wallet-sidecar/src/approval.rs` and
//! `services/wallet-sidecar/src/mandate.rs`.

use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context};
use clap::{Parser, Subcommand};
use ed25519_dalek::{Signer, SigningKey};
use rand_core::OsRng;
use sha2::{Digest, Sha256};

#[derive(Parser)]
#[command(name = "lute-owner", version)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Create a new owner key file and print its public key.
    Init {
        #[arg(long)]
        key: PathBuf,
    },
    /// Print the public key of an existing owner key file.
    Pubkey {
        #[arg(long)]
        key: PathBuf,
    },
    /// Review a proposal (JSON on stdin) and sign it after typed confirmation.
    Sign {
        #[arg(long)]
        key: PathBuf,
        /// Skip the typed confirmation. Refused unless the summary's network is `regtest`
        /// (used with disposable regtest owner keys in automated evidence runs).
        #[arg(long)]
        unattended_regtest: bool,
    },
    /// Review an agent mandate (JSON on stdin) and sign it after typed confirmation.
    SignMandate {
        #[arg(long)]
        key: PathBuf,
        /// As for `sign`: refused unless the mandate's network is `regtest`.
        #[arg(long)]
        unattended_regtest: bool,
    },
}

/// Parses JSON text. Windows PowerShell 5.1 may prefix piped text with a UTF-8 byte order mark;
/// it is not part of the JSON, so it is dropped.
fn parse_json(input: &str) -> anyhow::Result<serde_json::Value> {
    let text = input.trim().trim_start_matches('\u{feff}').trim();
    serde_json::from_str(text).context("parsing JSON")
}

fn read_stdin_json() -> anyhow::Result<serde_json::Value> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    parse_json(&input)
}

/// Reads one line from the terminal (not stdin, which carries the JSON) and compares it.
fn confirm(expected: &str) -> anyhow::Result<()> {
    let mut answer = String::new();
    #[cfg(unix)]
    let tty_in = std::fs::File::open("/dev/tty");
    #[cfg(windows)]
    let tty_in = std::fs::File::open("CONIN$");
    std::io::BufReader::new(tty_in.context("opening the terminal for confirmation")?)
        .read_line(&mut answer)?;
    if answer.trim() != expected {
        bail!("not approved");
    }
    Ok(())
}

fn read_key(path: &Path) -> anyhow::Result<SigningKey> {
    let hex_str =
        std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    let bytes: [u8; 32] = hex::decode(hex_str.trim())?
        .try_into()
        .map_err(|_| anyhow!("owner key file must hold 32 bytes of hex"))?;
    Ok(SigningKey::from_bytes(&bytes))
}

/// Same canonicalization as the sidecar: serde_json objects are BTreeMap-backed (sorted keys),
/// compact output.
fn canonical_hash(summary: &serde_json::Value) -> anyhow::Result<String> {
    let canonical = serde_json::to_string(summary)?;
    Ok(hex::encode(Sha256::digest(canonical.as_bytes())))
}

fn field<'a>(s: &'a serde_json::Value, k: &str) -> anyhow::Result<&'a serde_json::Value> {
    s.get(k).ok_or_else(|| anyhow!("summary is missing `{k}`"))
}

fn truncate(addr: &str) -> String {
    if addr.len() <= 24 {
        addr.to_string()
    } else {
        format!("{}…{}", &addr[..14], &addr[addr.len() - 8..])
    }
}

fn zec(zat: u64) -> String {
    format!("{}.{:08}", zat / 100_000_000, zat % 100_000_000)
}

fn main() -> anyhow::Result<()> {
    match Cli::parse().cmd {
        Cmd::Init { key } => {
            if key.exists() {
                bail!(
                    "{} already exists; refusing to overwrite an owner key",
                    key.display()
                );
            }
            let sk = SigningKey::generate(&mut OsRng);
            let mut opts = std::fs::OpenOptions::new();
            opts.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            opts.open(&key)?
                .write_all(hex::encode(sk.to_bytes()).as_bytes())?;
            println!("{}", hex::encode(sk.verifying_key().to_bytes()));
            eprintln!(
                "Owner key written to {}. Keep it on this machine only; back it up offline.\n\
                 Register the public key above on the sidecar host as /opt/zlute/owner.pub.",
                key.display()
            );
        }
        Cmd::Pubkey { key } => {
            println!(
                "{}",
                hex::encode(read_key(&key)?.verifying_key().to_bytes())
            );
        }
        Cmd::Sign {
            key,
            unattended_regtest,
        } => {
            let sk = read_key(&key)?;
            // Accept either the full view (`{proposal_hash, sign_message, summary}`) or a bare summary.
            let v = read_stdin_json()?;
            let summary = v.get("summary").unwrap_or(&v);
            let hash = canonical_hash(summary)?;
            if let Some(claimed) = v.get("proposal_hash").and_then(|h| h.as_str()) {
                if claimed != hash {
                    bail!("the proposal_hash supplied by the server does not match the summary; refusing");
                }
            }
            let network = field(summary, "network")?
                .as_str()
                .unwrap_or_default()
                .to_string();
            let amount = field(summary, "amount_zat")?.as_u64().unwrap_or_default();
            let fee = field(summary, "fee_zat")?.as_u64().unwrap_or_default();
            let recipient = field(summary, "recipient")?.as_str().unwrap_or_default();

            let tty = std::io::stderr();
            let mut out = tty.lock();
            writeln!(out, "\n=== Lute payment approval ===")?;
            writeln!(out, "network:        {network}")?;
            writeln!(out, "amount:         {} ZEC ({amount} zat)", zec(amount))?;
            writeln!(out, "fee:            {} ZEC ({fee} zat)", zec(fee))?;
            writeln!(out, "recipient:      {}", truncate(recipient))?;
            writeln!(out, "recipient pool: {}", field(summary, "recipient_pool")?)?;
            writeln!(out, "input pools:    {}", field(summary, "input_pools")?)?;
            writeln!(out, "output pools:   {}", field(summary, "output_pools")?)?;
            writeln!(out, "change pools:   {}", field(summary, "change_pools")?)?;
            writeln!(out, "policy:         {}", field(summary, "policy")?)?;
            writeln!(out, "memo hash:      {}", field(summary, "memo_hash")?)?;
            if let Some(lines) = summary.get("payments").and_then(|p| p.as_array()) {
                writeln!(out, "BATCH: {} payments in one transaction:", lines.len())?;
                for (i, l) in lines.iter().enumerate() {
                    let a = l
                        .get("amount_zat")
                        .and_then(|v| v.as_u64())
                        .unwrap_or_default();
                    let r = l
                        .get("recipient")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    writeln!(out, "  {}. {} ZEC -> {}", i + 1, zec(a), truncate(r))?;
                }
            }
            writeln!(out, "expires (unix): {}", field(summary, "expires_at")?)?;
            writeln!(out, "proposal hash:  {hash}")?;
            if unattended_regtest {
                if network != "regtest" {
                    bail!("--unattended-regtest is refused for network `{network}`");
                }
                writeln!(out, "(unattended regtest signing)")?;
                drop(out);
            } else {
                write!(
                    out,
                    "\nType `approve {}` to sign, anything else to abort: ",
                    &hash[..8]
                )?;
                out.flush()?;
                drop(out);
                confirm(&format!("approve {}", &hash[..8]))?;
            }
            let msg = format!("lute-approve-v1|{network}|{hash}");
            println!("{}", hex::encode(sk.sign(msg.as_bytes()).to_bytes()));
        }
        Cmd::SignMandate {
            key,
            unattended_regtest,
        } => {
            let sk = read_key(&key)?;
            let m = read_stdin_json()?;
            let hash = canonical_hash(&m)?;
            let s = |k: &str| -> anyhow::Result<String> {
                Ok(field(&m, k)?.as_str().unwrap_or_default().to_string())
            };
            let n =
                |k: &str| -> anyhow::Result<u64> { Ok(field(&m, k)?.as_u64().unwrap_or_default()) };
            let network = s("network")?;
            let recipients = field(&m, "allowed_recipients")?
                .as_array()
                .ok_or_else(|| anyhow!("allowed_recipients must be a list"))?
                .iter()
                .map(|r| truncate(r.as_str().unwrap_or_default()))
                .collect::<Vec<_>>();

            let tty = std::io::stderr();
            let mut out = tty.lock();
            writeln!(out, "\n=== Lute agent mandate ===")?;
            writeln!(out, "network:        {network}")?;
            writeln!(out, "wallet:         {}", s("wallet")?)?;
            writeln!(out, "purpose:        {}", s("purpose")?)?;
            writeln!(out, "per payment:    up to {} ZEC", zec(n("max_tx_zat")?))?;
            writeln!(out, "total budget:   {} ZEC", zec(n("total_zat")?))?;
            writeln!(out, "may pay only:   {}", recipients.join(", "))?;
            writeln!(out, "expires (unix): {}", n("expires_at")?)?;
            writeln!(out, "mandate id:     {}", s("mandate_id")?)?;
            writeln!(out, "mandate hash:   {hash}")?;
            writeln!(out, "Payments inside these bounds will NOT ask you again.")?;
            if unattended_regtest {
                if network != "regtest" {
                    bail!("--unattended-regtest is refused for network `{network}`");
                }
                writeln!(out, "(unattended regtest signing)")?;
                drop(out);
            } else {
                write!(
                    out,
                    "\nType `approve mandate {}` to sign, anything else to abort: ",
                    &hash[..8]
                )?;
                out.flush()?;
                drop(out);
                confirm(&format!("approve mandate {}", &hash[..8]))?;
            }
            let msg = format!("lute-mandate-v1|{network}|{hash}");
            println!("{}", hex::encode(sk.sign(msg.as_bytes()).to_bytes()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bom_prefixed_json_parses_like_plain_json() {
        let plain = parse_json(r#"{"a":1}"#).unwrap();
        assert_eq!(parse_json("\u{feff}{\"a\":1}\r\n").unwrap(), plain);
    }

    #[test]
    fn canonical_hash_matches_sorted_compact_json() {
        // Field order in the input must not matter.
        let a: serde_json::Value = serde_json::from_str(r#"{"b":1,"a":"x"}"#).unwrap();
        let b: serde_json::Value = serde_json::from_str(r#"{ "a" : "x", "b" : 1 }"#).unwrap();
        assert_eq!(canonical_hash(&a).unwrap(), canonical_hash(&b).unwrap());
        assert_eq!(serde_json::to_string(&a).unwrap(), r#"{"a":"x","b":1}"#);
    }

    #[test]
    fn zec_formatting() {
        assert_eq!(zec(1_000_000), "0.01000000");
        assert_eq!(zec(123_456_789), "1.23456789");
    }
}
