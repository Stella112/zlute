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
    /// Build a ZIP-321 request: zcash:<addr>?amount=..&memo=base64url("LUTE:<ref>").
    Zip321Build {
        #[arg(value_parser = parse_network)]
        network: NetworkKind,
        #[arg(long)]
        address: String,
        #[arg(long)]
        zat: u64,
        /// Opaque reference (8-64 base64url chars); goes into the memo as LUTE:<ref>.
        #[arg(long = "ref")]
        opaque_ref: String,
    },
    /// Parse and validate a single-payment ZIP-321 request.
    Zip321Parse {
        #[arg(value_parser = parse_network)]
        network: NetworkKind,
        uri: String,
    },
    /// Serve the authenticated loopback HTTP API for apps/api (mandate §13.4).
    Serve {
        /// Must be a loopback address, e.g. 127.0.0.1:48100.
        #[arg(long)]
        listen: std::net::SocketAddr,
        /// Directory holding one subdirectory per wallet (all on the same network).
        #[arg(long)]
        wallets: PathBuf,
        #[arg(long, value_parser = parse_network)]
        network: NetworkKind,
        /// File with the shared HMAC secret (hex, >= 32 bytes).
        #[arg(long)]
        secret_file: PathBuf,
        #[arg(long, default_value = "/opt/zlute/owner.pub")]
        owner_pub: PathBuf,
        /// Enables wallet creation over the API: key-encryption-key files are written here
        /// (outside the wallets directory). Requires --lightwalletd.
        #[arg(long)]
        keys_dir: Option<PathBuf>,
        /// Light-wallet server new wallets sync from, e.g. https://zec.rocks:443.
        #[arg(long)]
        lightwalletd: Option<String>,
    },
    /// Query a light-wallet server's GetLightdInfo (chain, height, branch id, upgrade).
    ServerInfo {
        /// e.g. https://zec.rocks:443 or http://127.0.0.1:28137
        server: String,
    },
    /// Download the Sapling proving parameters (hash-checked) into the default folder.
    FetchParams,
    /// Lute-operated wallet commands.
    Wallet {
        /// Wallet directory (one wallet per directory).
        #[arg(long)]
        dir: PathBuf,
        #[command(subcommand)]
        cmd: WalletCmd,
    },
    /// The browser signer's logic (services/lute-signer) as a CLI, for regtest/testnet runs of
    /// browser-signed wallets. Refuses mainnet: on mainnet the seed only ever exists in a browser.
    Signer {
        #[command(subcommand)]
        cmd: SignerCmd,
    },
}

#[derive(Subcommand)]
enum SignerCmd {
    /// Print the unified full viewing key for an account of a seed (hex file).
    DeriveUfvk {
        #[arg(long)]
        seed_file: PathBuf,
        #[arg(long, value_parser = parse_network)]
        network: NetworkKind,
        #[arg(long, default_value_t = 0)]
        account: u32,
    },
    /// Check and sign a PCZT view (JSON from `wallet prepare-pczt`); prints the signatures JSON.
    SignPczt {
        #[arg(long)]
        seed_file: PathBuf,
        #[arg(long, value_parser = parse_network)]
        network: NetworkKind,
        #[arg(long, default_value_t = 0)]
        account: u32,
        #[arg(long)]
        view: PathBuf,
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
        /// Key-encryption-key file (created; must not exist; outside the wallet dir).
        /// Required on main and test networks.
        #[arg(long)]
        kek: Option<PathBuf>,
    },
    /// Create a non-custodial (browser-signed) wallet from a unified full viewing key.
    InitViewOnly {
        #[arg(long)]
        name: String,
        #[arg(long, value_parser = parse_network)]
        network: NetworkKind,
        #[arg(long)]
        server: String,
        #[arg(long)]
        ufvk: String,
    },
    /// Browser-signed wallets: build and prove the unsigned PCZT for a stored proposal.
    PreparePczt {
        #[arg(long)]
        proposal: String,
    },
    /// Browser-signed wallets: apply signatures (JSON `[{"index":..,"sig":".."}]`) and broadcast,
    /// after the owner's approval was recorded with `approve`.
    ExecuteSigned {
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        sigs: String,
        #[arg(long, default_value = "/opt/zlute/owner.pub")]
        owner_pub: PathBuf,
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
    /// REGTEST-ONLY test helper: send without an owner approval. Exit 0 only if accepted.
    Send {
        #[arg(long)]
        to: String,
        /// Amount in zatoshi (integer).
        #[arg(long)]
        zat: u64,
        #[arg(long)]
        memo: Option<String>,
    },
    /// Show what this wallet received in a transaction (amount, pool, memo, confirmations).
    Verify {
        #[arg(long)]
        txid: String,
    },
    /// Check a payment request: payments to its unique address, memo LUTE:<ref>, confirmations.
    CheckRequest {
        #[arg(long)]
        address: String,
        #[arg(long)]
        zat: u64,
        #[arg(long = "ref")]
        opaque_ref: String,
        #[arg(long, default_value_t = 1)]
        min_conf: u32,
    },
    /// Status of a transaction in this wallet (mined height, confirmations).
    TxStatus {
        #[arg(long)]
        txid: String,
    },
    /// Step 1: build, policy-check and store a payment proposal (nothing is signed).
    Propose {
        #[arg(long)]
        to: String,
        /// Amount in zatoshi (integer).
        #[arg(long)]
        zat: u64,
        #[arg(long)]
        memo: Option<String>,
    },
    /// BatchPay: one transaction paying every line of a JSON file
    /// `[{"to":"u…","amount_zat":1000,"memo":"LUTE:x"}]` (1 to 10 lines).
    ProposeBatch {
        #[arg(long)]
        lines: PathBuf,
    },
    /// Show a stored proposal, its hash and the exact message the owner signs.
    Show {
        #[arg(long)]
        proposal: String,
    },
    /// Step 2: record the owner's signature (made with `lute-owner sign` on the owner's machine).
    Approve {
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        signature: String,
        #[arg(long, default_value = "/opt/zlute/owner.pub")]
        owner_pub: PathBuf,
    },
    /// Step 3: re-check, consume the approval, reserve budget, sign and broadcast once.
    Execute {
        #[arg(long)]
        proposal: String,
        #[arg(long, default_value = "/opt/zlute/owner.pub")]
        owner_pub: PathBuf,
    },
    /// Load an owner-signed mandate (canonical JSON file + signature from `lute-owner sign-mandate`).
    LoadMandate {
        #[arg(long)]
        mandate: PathBuf,
        #[arg(long)]
        signature: String,
        #[arg(long, default_value = "/opt/zlute/owner.pub")]
        owner_pub: PathBuf,
    },
    /// Report what any transaction reveals by its structure (transparent parts, pools, value).
    InspectTx {
        #[arg(long)]
        txid: String,
    },
    /// Show a loaded mandate's budget (committed and remaining).
    MandateStatus {
        #[arg(long)]
        mandate_id: String,
    },
    /// Step 3 under a loaded mandate instead of a per-proposal approval.
    ExecuteMandate {
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        mandate_id: String,
        #[arg(long, default_value = "/opt/zlute/owner.pub")]
        owner_pub: PathBuf,
    },
}

fn parse_network(s: &str) -> Result<NetworkKind, String> {
    NetworkKind::parse(s).ok_or_else(|| "network must be main, test or regtest".to_string())
}

#[tokio::main]
async fn main() -> ExitCode {
    lute_sidecar::install_crypto_provider();
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
        Cmd::Zip321Build {
            network,
            address,
            zat,
            opaque_ref,
        } => {
            match lute_sidecar::zip321req::build(network.params_type(), &address, zat, &opaque_ref)
            {
                Ok(uri) => {
                    println!("{uri}");
                    Ok(ExitCode::SUCCESS)
                }
                Err(e) => {
                    println!("{}", serde_json::to_string(&e)?);
                    Ok(ExitCode::from(1))
                }
            }
        }
        Cmd::Zip321Parse { network, uri } => {
            match lute_sidecar::zip321req::parse(network.params_type(), &uri) {
                Ok(p) => {
                    println!("{}", serde_json::to_string(&p)?);
                    Ok(ExitCode::SUCCESS)
                }
                Err(e) => {
                    println!("{}", serde_json::to_string(&e)?);
                    Ok(ExitCode::from(1))
                }
            }
        }
        Cmd::Serve {
            listen,
            wallets,
            network,
            secret_file,
            owner_pub,
            keys_dir,
            lightwalletd,
        } => {
            if let Some(k) = &keys_dir {
                if k.starts_with(&wallets) {
                    anyhow::bail!("--keys-dir must be outside the wallets directory");
                }
            }
            let cfg = lute_sidecar::api::ApiConfig {
                listen,
                wallets_root: wallets,
                secret: lute_sidecar::api::load_secret(&secret_file)?,
                owner_pub,
                network,
                keys_dir,
                lightwalletd,
            };
            eprintln!("lute-sidecar API listening on {listen} ({network:?})");
            lute_sidecar::api::serve(cfg).await?;
            Ok(ExitCode::SUCCESS)
        }
        Cmd::ServerInfo { server } => {
            let mut client = lute_sidecar::wallet::connect(&server).await?;
            let i = client
                .get_lightd_info(zcash_client_backend::proto::service::Empty {})
                .await?
                .into_inner();
            println!(
                "{}",
                serde_json::json!({
                    "chain_name": i.chain_name,
                    "block_height": i.block_height,
                    "estimated_height": i.estimated_height,
                    "consensus_branch_id": i.consensus_branch_id,
                    "upgrade_name": i.upgrade_name,
                    "upgrade_height": i.upgrade_height,
                    "vendor": i.vendor,
                    "version": i.version,
                    "lightwallet_protocol_version": i.lightwallet_protocol_version,
                })
            );
            Ok(ExitCode::SUCCESS)
        }
        Cmd::FetchParams => {
            tokio::task::spawn_blocking(lute_sidecar::wallet::send::fetch_params).await??;
            println!("ok");
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Wallet { dir, cmd } => {
            match cmd {
                WalletCmd::Init {
                    name,
                    network,
                    server,
                    birthday,
                    kek,
                } => {
                    let w = Wallet::init(&dir, &name, network, &server, birthday, kek.as_deref())
                        .await?;
                    println!("{}", serde_json::to_string(&w.config)?);
                }
                WalletCmd::InitViewOnly {
                    name,
                    network,
                    server,
                    ufvk,
                } => {
                    let w = Wallet::init_view_only(&dir, &name, network, &server, &ufvk).await?;
                    println!("{}", serde_json::to_string(&w.config)?);
                }
                WalletCmd::PreparePczt { proposal } => {
                    let v = Wallet::open(&dir)?.prepare_pczt(&proposal)?;
                    println!("{}", serde_json::to_string(&v)?);
                }
                WalletCmd::ExecuteSigned {
                    proposal,
                    sigs,
                    owner_pub,
                } => {
                    let sigs: Vec<lute_sidecar::wallet::pczt::SpendSig> =
                        serde_json::from_str(&sigs)?;
                    let out = Wallet::open(&dir)?
                        .execute_signed(&proposal, &sigs, &owner_pub)
                        .await?;
                    println!("{}", serde_json::to_string(&out)?);
                    if out.status != lute_sidecar::control::SpendStatus::Submitted {
                        return Ok(ExitCode::from(3));
                    }
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
                WalletCmd::Send { to, zat, memo } => {
                    let out = Wallet::open(&dir)?.send(&to, zat, memo.as_deref()).await?;
                    println!("{}", serde_json::to_string(&out)?);
                    if !matches!(
                        out.broadcast,
                        lute_sidecar::wallet::send::Broadcast::Accepted
                    ) {
                        return Ok(ExitCode::from(3));
                    }
                }
                WalletCmd::CheckRequest {
                    address,
                    zat,
                    opaque_ref,
                    min_conf,
                } => {
                    let c = Wallet::open(&dir)?
                        .check_request(&address, zat, &opaque_ref, min_conf)
                        .await?;
                    println!("{}", serde_json::to_string(&c)?);
                }
                WalletCmd::TxStatus { txid } => {
                    println!(
                        "{}",
                        serde_json::to_string(&Wallet::open(&dir)?.tx_status(&txid)?)?
                    );
                }
                WalletCmd::Propose { to, zat, memo } => {
                    let v = Wallet::open(&dir)?.propose(&to, zat, memo.as_deref())?;
                    println!("{}", serde_json::to_string(&v)?);
                }
                WalletCmd::ProposeBatch { lines } => {
                    let v: Vec<serde_json::Value> =
                        serde_json::from_str(&std::fs::read_to_string(lines)?)?;
                    let lines: Vec<(String, u64, Option<String>)> = v
                        .iter()
                        .map(|l| {
                            (
                                l["to"].as_str().unwrap_or_default().to_string(),
                                l["amount_zat"].as_u64().unwrap_or_default(),
                                l["memo"].as_str().map(str::to_string),
                            )
                        })
                        .collect();
                    let v = Wallet::open(&dir)?.propose_batch(&lines)?;
                    println!("{}", serde_json::to_string(&v)?);
                }
                WalletCmd::Show { proposal } => {
                    let v = Wallet::open(&dir)?.show_proposal(&proposal)?;
                    println!("{}", serde_json::to_string(&v)?);
                }
                WalletCmd::Approve {
                    proposal,
                    signature,
                    owner_pub,
                } => {
                    Wallet::open(&dir)?.approve(&proposal, &signature, &owner_pub)?;
                    println!("approved");
                }
                WalletCmd::Execute {
                    proposal,
                    owner_pub,
                } => {
                    let out = Wallet::open(&dir)?.execute(&proposal, &owner_pub).await?;
                    println!("{}", serde_json::to_string(&out)?);
                    if out.status != lute_sidecar::control::SpendStatus::Submitted {
                        return Ok(ExitCode::from(3));
                    }
                }
                WalletCmd::LoadMandate {
                    mandate,
                    signature,
                    owner_pub,
                } => {
                    let json = std::fs::read_to_string(&mandate)?;
                    let v =
                        Wallet::open(&dir)?.load_mandate(json.trim(), &signature, &owner_pub)?;
                    println!("{}", serde_json::to_string(&v)?);
                }
                WalletCmd::InspectTx { txid } => {
                    let v = Wallet::open(&dir)?.inspect_onchain(&txid).await?;
                    println!("{}", serde_json::to_string(&v)?);
                }
                WalletCmd::MandateStatus { mandate_id } => {
                    let v = Wallet::open(&dir)?.mandate_status(&mandate_id)?;
                    println!("{}", serde_json::to_string(&v)?);
                }
                WalletCmd::ExecuteMandate {
                    proposal,
                    mandate_id,
                    owner_pub,
                } => {
                    let out = Wallet::open(&dir)?
                        .execute_with_mandate(&proposal, &mandate_id, &owner_pub)
                        .await?;
                    println!("{}", serde_json::to_string(&out)?);
                    if out.status != lute_sidecar::control::SpendStatus::Submitted {
                        return Ok(ExitCode::from(3));
                    }
                }
                WalletCmd::Verify { txid } => {
                    let v = Wallet::open(&dir)?.verify(&txid).await?;
                    println!("{}", serde_json::to_string(&v)?);
                }
            }
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Signer { cmd } => {
            let net = |n: NetworkKind| -> anyhow::Result<lute_signer::Net> {
                match n {
                    NetworkKind::Main => {
                        anyhow::bail!("refused on mainnet: the seed belongs in the user's browser")
                    }
                    NetworkKind::Test => Ok(lute_signer::Net::Test),
                    NetworkKind::Regtest => Ok(lute_signer::Net::Regtest),
                }
            };
            let seed = |p: &PathBuf| -> anyhow::Result<Vec<u8>> {
                Ok(hex::decode(std::fs::read_to_string(p)?.trim())?)
            };
            match cmd {
                SignerCmd::DeriveUfvk {
                    seed_file,
                    network,
                    account,
                } => println!(
                    "{}",
                    lute_signer::derive_ufvk(&seed(&seed_file)?, net(network)?, account)?
                ),
                SignerCmd::SignPczt {
                    seed_file,
                    network,
                    account,
                    view,
                } => {
                    let v: serde_json::Value =
                        serde_json::from_str(&std::fs::read_to_string(view)?)?;
                    let field = |k: &str| v["summary"][k].clone();
                    let expect = lute_signer::Expect {
                        recipient: field("recipient").as_str().unwrap_or_default().to_string(),
                        amount_zat: field("amount_zat").as_u64().unwrap_or_default(),
                        fee_zat: field("fee_zat").as_u64().unwrap_or_default(),
                        payments: v["summary"]["payments"]
                            .as_array()
                            .map(|ls| {
                                ls.iter()
                                    .map(|l| lute_signer::ExpectPay {
                                        recipient: l["recipient"]
                                            .as_str()
                                            .unwrap_or_default()
                                            .to_string(),
                                        amount_zat: l["amount_zat"].as_u64().unwrap_or_default(),
                                    })
                                    .collect()
                            })
                            .unwrap_or_default(),
                    };
                    let pczt = hex::decode(v["pczt_hex"].as_str().unwrap_or_default())?;
                    let sigs = lute_signer::sign_pczt(
                        &seed(&seed_file)?,
                        net(network)?,
                        account,
                        &pczt,
                        &expect,
                    )?;
                    println!("{}", serde_json::to_string(&sigs)?);
                }
            }
            Ok(ExitCode::SUCCESS)
        }
    }
}
