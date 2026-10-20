//! `lute-sidecar` CLI.
//!
//! P1a slices: address inspection and regtest wallets (init, sync, address, balance).
//! The authenticated HTTP API for `apps/api`, proposals, approvals and signing come next.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use lute_sidecar::{inspect::inspect, network::NetworkKind, wallet::Wallet};

#[derive(Parser)]
#[command(name = "lute-sidecar", version)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Inspect a recipient address; exit 0 if Lute may pay it, 1 if denied.
    Inspect {
        #[arg(value_parser = parse_network)]
        network: NetworkKind,
        address: String,
    },
    /// Lute-operated wallet commands.
    Wallet {
        /// Wallet directory (one wallet per directory).
        #[arg(long)]
        dir: PathBuf,
        #[command(subcommand)]
        cmd: WalletCmd,
    },
}

#[derive(Subcommand)]
enum WalletCmd {
    /// Create a wallet with a fresh random seed (regtest/testnet only in this build).
    Init {
        #[arg(long)]
        name: String,
        #[arg(long, value_parser = parse_network)]
        network: NetworkKind,
        /// lightwalletd-compatible gRPC endpoint, e.g. http://127.0.0.1:28137
        #[arg(long)]
        server: String,
        #[arg(long)]
        birthday: Option<u32>,
    },
    /// Sync the wallet with its server.
    Sync,
    /// Print the next unused shielded-only receive address.
    Address,
    /// Print balances per pool as JSON.
    Balance {
        #[arg(long, default_value_t = 1)]
        min_confirmations: u32,
    },
}

fn parse_network(s: &str) -> Result<NetworkKind, String> {
    NetworkKind::parse(s).ok_or_else(|| "network must be main, test or regtest".to_string())
}

#[tokio::main]
async fn main() -> ExitCode {
    match run(Cli::parse()).await {
        Ok(code) => code,
        Err(e) => {
            eprintln!("error: {e:#}");
            ExitCode::from(2)
        }
    }
}

async fn run(cli: Cli) -> anyhow::Result<ExitCode> {
    match cli.cmd {
        Cmd::Inspect { network, address } => {
            let result = inspect(&address, network.params_type());
            println!("{}", serde_json::to_string(&result)?);
            Ok(if result.is_allowed() {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            })
        }
        Cmd::Wallet { dir, cmd } => {
            match cmd {
                WalletCmd::Init {
                    name,
                    network,
                    server,
                    birthday,
                } => {
                    let w = Wallet::init(&dir, &name, network, &server, birthday).await?;
                    println!("{}", serde_json::to_string(&w.config)?);
                }
                WalletCmd::Sync => {
                    let w = Wallet::open(&dir)?;
                    w.sync().await?;
                    println!("{}", serde_json::to_string(&w.balance(1)?)?);
                }
                WalletCmd::Address => println!("{}", Wallet::open(&dir)?.next_address()?),
                WalletCmd::Balance { min_confirmations } => {
                    let b = Wallet::open(&dir)?.balance(min_confirmations)?;
                    println!("{}", serde_json::to_string(&b)?);
                }
            }
            Ok(ExitCode::SUCCESS)
        }
    }
}
