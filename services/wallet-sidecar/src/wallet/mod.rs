//! A Lute-operated wallet: one directory, one seed file, one SQLite wallet DB, one account
//! (mandate §10.5). Built on `zcash_client_sqlite@0.22.0` / `zcash_client_backend@0.24.0`,
//! following zcash-devtool f1ec9b1 (`src/commands/wallet/init.rs`, `src/data.rs`) as reference.
//!
//! Key storage: the seed is sealed with XChaCha20-Poly1305 under a per-wallet key file kept outside
//! the wallet directory (`keystore.rs`). Required on mainnet and testnet. Regtest wallets created
//! before encrypted storage existed keep a plain 0600 `seed.bin` (disposable test keys).

pub mod approve;
pub mod cache;
pub mod incoming;
pub mod keystore;
pub mod send;

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context};
use rand_core::{OsRng, RngCore};
use secrecy::{ExposeSecret, SecretVec};
use serde::{Deserialize, Serialize};
use tonic::transport::{Channel, ClientTlsConfig};
use uuid::Uuid;
use zcash_client_backend::{
    data_api::{
        chain::ChainState, wallet::ConfirmationsPolicy, AccountBirthday, WalletRead, WalletWrite,
    },
    proto::service::{self, compact_tx_streamer_client::CompactTxStreamerClient},
};
use zcash_client_sqlite::{util::SystemClock, wallet::init::init_wallet_db, AccountUuid, WalletDb};
use zcash_keys::keys::{
    ReceiverRequirement::{Omit, Require},
    UnifiedAddressRequest,
};
use zcash_protocol::consensus::{BlockHeight, NetworkUpgrade, Parameters};

use crate::network::{LuteNetwork, NetworkKind};

const CONFIG_FILE: &str = "wallet.json";
const SEED_FILE: &str = "seed.bin";
const SEALED_SEED_FILE: &str = "seed.enc";
pub(crate) const DB_FILE: &str = "wallet.sqlite";

/// Shielded-only receive addresses (mandate §19.1, test W4): an Orchard receiver (paid in the
/// Ironwood pool after NU6.3, D-002) and a Sapling receiver are *required*; transparent is
/// omitted. `UnifiedAddressRequest::SHIELDED` only *allows* receivers, and zcash_keys@0.16.1 was
/// observed to drop Sapling under it, so requirements are explicit.
pub const SHIELDED_RECEIVE: UnifiedAddressRequest =
    UnifiedAddressRequest::unsafe_custom(Require, Require, Omit);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WalletConfig {
    pub name: String,
    pub network: NetworkKind,
    /// lightwalletd-compatible gRPC endpoint, e.g. `http://127.0.0.1:28137` (Zaino, regtest).
    pub server: String,
    pub account: Uuid,
    pub birthday_height: u32,
    /// Key-encryption-key file sealing `seed.enc`; `None` only for legacy regtest wallets.
    #[serde(default)]
    pub kek_path: Option<PathBuf>,
}

pub type Db = WalletDb<rusqlite::Connection, LuteNetwork, SystemClock, OsRng>;

pub struct Wallet {
    pub dir: PathBuf,
    pub config: WalletConfig,
}

/// Opens a gRPC channel. TLS (WebPKI roots, certificate verification) for every non-loopback
/// host, as in zcash-devtool f1ec9b1 `src/remote.rs` `connect_direct`. Plaintext is allowed only
/// for loopback, which is how Zaino is published on the VPS (127.0.0.1:28137).
pub async fn connect(server: &str) -> anyhow::Result<CompactTxStreamerClient<Channel>> {
    let uri: tonic::transport::Uri = server.parse().context("server URI")?;
    let host = uri
        .host()
        .ok_or_else(|| anyhow!("server URI has no host"))?;
    let loopback = matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]");
    let channel = Channel::from_shared(server.to_string())?;
    let channel = match (uri.scheme_str(), loopback) {
        (Some("https"), _) => channel.tls_config(
            ClientTlsConfig::new()
                .domain_name(host.to_string())
                .assume_http2(true)
                .with_webpki_roots(),
        )?,
        (Some("http"), true) => channel,
        _ => bail!("refusing non-TLS connection to non-loopback server {host}"),
    };
    Ok(CompactTxStreamerClient::new(channel.connect().await?))
}

/// The wallet birthday: chain state as of the block before `birthday_height`.
/// Note (docs/PRIVACY.md, light-server analysis): `GetTreeState` reveals the birthday height to
/// the server, as zcash-devtool's own comment warns.
async fn birthday(
    client: &mut CompactTxStreamerClient<Channel>,
    params: &LuteNetwork,
    birthday_height: BlockHeight,
) -> anyhow::Result<AccountBirthday> {
    let sapling = params
        .activation_height(NetworkUpgrade::Sapling)
        .ok_or_else(|| anyhow!("Sapling activation height not set"))?;
    let h = birthday_height.max(sapling);
    if h == sapling {
        let block = client
            .get_block(service::BlockId {
                height: u64::from(h),
                ..Default::default()
            })
            .await?
            .into_inner();
        Ok(AccountBirthday::from_parts(
            ChainState::empty(h.saturating_sub(1), block.prev_hash()),
            None,
        ))
    } else {
        let treestate = client
            .get_tree_state(service::BlockId {
                height: u64::from(h) - 1,
                ..Default::default()
            })
            .await?
            .into_inner();
        AccountBirthday::from_treestate(treestate, None)
            .map_err(|e| anyhow!("birthday tree state: {e:?}"))
    }
}

impl Wallet {
    pub fn open(dir: &Path) -> anyhow::Result<Self> {
        let raw = fs::read_to_string(dir.join(CONFIG_FILE))
            .with_context(|| format!("reading {}", dir.join(CONFIG_FILE).display()))?;
        Ok(Wallet {
            dir: dir.to_path_buf(),
            config: serde_json::from_str(&raw)?,
        })
    }

    /// Loads the seed: sealed `seed.enc` + key file, or (legacy regtest only) plain `seed.bin`.
    pub(crate) fn load_seed(&self) -> anyhow::Result<SecretVec<u8>> {
        match &self.config.kek_path {
            Some(k) => {
                let kek = keystore::read_kek(k)?;
                let blob = fs::read(self.dir.join(SEALED_SEED_FILE)).context("reading seed.enc")?;
                let network = serde_json::to_value(self.config.network)?
                    .as_str()
                    .unwrap_or_default()
                    .to_string();
                keystore::open(&kek, &keystore::aad(&self.config.name, &network), &blob)
            }
            None if self.config.network == NetworkKind::Regtest => Ok(SecretVec::new(
                fs::read(self.dir.join(SEED_FILE)).context("reading seed.bin")?,
            )),
            None => bail!("wallet has no key file configured; refusing to load a plain seed"),
        }
    }

    pub fn params(&self) -> LuteNetwork {
        self.config.network.params()
    }

    pub fn db(&self) -> anyhow::Result<Db> {
        Ok(WalletDb::for_path(
            self.dir.join(DB_FILE),
            self.params(),
            SystemClock,
            OsRng,
        )?)
    }

    pub fn account(&self) -> AccountUuid {
        AccountUuid::from_uuid(self.config.account)
    }

    /// Creates a new wallet directory with a fresh random seed and one account.
    pub async fn init(
        dir: &Path,
        name: &str,
        network: NetworkKind,
        server: &str,
        birthday_height: Option<u32>,
        kek_path: Option<&Path>,
    ) -> anyhow::Result<Self> {
        if network != NetworkKind::Regtest && kek_path.is_none() {
            bail!("--kek <file outside the wallet directory> is required on {network:?}");
        }
        if let Some(k) = kek_path {
            let wallet_dir = fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
            let kek_parent = k
                .parent()
                .map(|p| fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()))
                .unwrap_or_default();
            if kek_parent.starts_with(&wallet_dir) {
                bail!("the key file must live outside the wallet directory");
            }
        }
        if dir.join(CONFIG_FILE).exists() {
            bail!("{} already holds a wallet", dir.display());
        }
        fs::create_dir_all(dir)?;
        restrict_dir(dir)?;
        let params = network.params();

        let mut client = connect(server).await?;
        let tip: u32 = client
            .get_latest_block(service::ChainSpec::default())
            .await?
            .into_inner()
            .height
            .try_into()?;
        let birthday = birthday(
            &mut client,
            &params,
            BlockHeight::from_u32(birthday_height.unwrap_or(tip.saturating_sub(100))),
        )
        .await?;

        let mut seed_bytes = vec![0u8; 32];
        OsRng.fill_bytes(&mut seed_bytes);
        let seed = SecretVec::new(seed_bytes);
        let network_label = serde_json::to_value(network)?
            .as_str()
            .unwrap_or_default()
            .to_string();
        match kek_path {
            Some(k) => {
                let kek = keystore::create_kek(k)?;
                let blob = keystore::seal(
                    &kek,
                    &keystore::aad(name, &network_label),
                    seed.expose_secret(),
                );
                write_secret(&dir.join(SEALED_SEED_FILE), &blob)?;
            }
            None => write_secret(&dir.join(SEED_FILE), seed.expose_secret())?,
        }

        let mut db = WalletDb::for_path(dir.join(DB_FILE), params, SystemClock, OsRng)?;
        init_wallet_db(&mut db, None).map_err(|e| anyhow!("init wallet db: {e:?}"))?;
        // zcash_client_backend@0.24.0 `WalletWrite::create_account`
        let (account, _usk) = db.create_account(name, &seed, &birthday, None)?;
        // The wallet DB cannot expose an address until it knows the chain tip (observed on
        // regtest: "Chain height unknown; please call `update_chain_tip`").
        db.update_chain_tip(BlockHeight::from_u32(tip))?;

        let config = WalletConfig {
            name: name.to_string(),
            network,
            server: server.to_string(),
            account: account.expose_uuid(),
            birthday_height: u32::from(birthday.height()),
            kek_path: kek_path.map(Path::to_path_buf),
        };
        fs::write(
            dir.join(CONFIG_FILE),
            serde_json::to_string_pretty(&config)?,
        )?;
        Ok(Wallet {
            dir: dir.to_path_buf(),
            config,
        })
    }

    /// Syncs with the configured server using `zcash_client_backend@0.24.0::sync::run`.
    pub async fn sync(&self) -> anyhow::Result<()> {
        let mut client = connect(&self.config.server).await?;
        let cache = cache::MemBlockCache::default();
        let mut db = self.db()?;
        zcash_client_backend::sync::run(&mut client, &self.params(), &cache, &mut db, 1000)
            .await
            .map_err(|e| anyhow!("sync: {e}"))
    }

    /// Next unused shielded-only receive address (W4).
    pub fn next_address(&self) -> anyhow::Result<String> {
        let mut db = self.db()?;
        // zcash_client_backend@0.24.0 `WalletWrite::get_next_available_address`
        let (ua, _) = db
            .get_next_available_address(self.account(), SHIELDED_RECEIVE)?
            .ok_or_else(|| anyhow!("account not found"))?;
        if ua.has_transparent() {
            bail!("internal error: generated receive address has a transparent receiver");
        }
        Ok(ua.encode(&self.params()))
    }

    pub fn balance(&self, min_confirmations: u32) -> anyhow::Result<Balances> {
        let db = self.db()?;
        let policy = if min_confirmations <= 1 {
            ConfirmationsPolicy::MIN
        } else {
            ConfirmationsPolicy::default()
        };
        // zcash_client_backend@0.24.0 `WalletRead::get_wallet_summary`
        let summary = db
            .get_wallet_summary(policy)?
            .ok_or_else(|| anyhow!("wallet not yet synced"))?;
        let b = summary
            .account_balances()
            .get(&self.account())
            .ok_or_else(|| anyhow!("no balance for account"))?;
        Ok(Balances {
            chain_tip_height: u32::from(summary.chain_tip_height()),
            fully_scanned_height: u32::from(summary.fully_scanned_height()),
            ironwood: PoolBalance::from(b.ironwood_balance()),
            orchard: PoolBalance::from(b.orchard_balance()),
            sapling: PoolBalance::from(b.sapling_balance()),
            transparent_total_zat: u64::from(b.unshielded_balance().total()),
        })
    }
}

#[derive(Debug, Serialize)]
pub struct PoolBalance {
    pub spendable_zat: u64,
    pub total_zat: u64,
}

impl From<&zcash_client_backend::data_api::Balance> for PoolBalance {
    fn from(b: &zcash_client_backend::data_api::Balance) -> Self {
        PoolBalance {
            spendable_zat: u64::from(b.spendable_value()),
            total_zat: u64::from(b.total()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct Balances {
    pub chain_tip_height: u32,
    pub fully_scanned_height: u32,
    pub ironwood: PoolBalance,
    pub orchard: PoolBalance,
    pub sapling: PoolBalance,
    pub transparent_total_zat: u64,
}

#[cfg(unix)]
fn restrict_dir(dir: &Path) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_dir(_dir: &Path) -> anyhow::Result<()> {
    Ok(())
}

fn write_secret(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    use std::io::Write;
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)?.write_all(bytes)?;
    Ok(())
}
