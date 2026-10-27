//! The sidecar's own control DB (mandate §13.3): proposals, owner approvals and spend
//! reservations. One SQLite file per wallet, separate from the librustzcash wallet DB.
//!
//! `reserve` runs in a single `BEGIN IMMEDIATE` transaction: it checks expiry, hash binding,
//! the approval (exists, valid signature, unused) and the caps, then consumes the approval and
//! records a reservation. SQLite serializes `IMMEDIATE` writers, so two executions cannot both
//! pass the cap check on the same budget (W15).

use ed25519_dalek::VerifyingKey;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;

use crate::approval::{verify_approval, ProposalSummary, DAILY_CAP_ZAT, MAX_TX_ZAT};
use crate::mandate::Mandate;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Denial {
    UnknownProposal,
    ProposalExpired,
    HashMismatch,
    NoApproval,
    ApprovalAlreadyUsed,
    ApprovalSignatureInvalid,
    AlreadyExecuted,
    OverPerTxCap,
    OverDailyCap,
    UnknownMandate,
    MandateInvalid,
    MandateExpired,
    MandateAlreadyLoaded,
    RecipientNotInMandate,
    OverMandatePerTx,
    OverMandateTotal,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SpendStatus {
    Reserved,
    Submitted,
    Released,
    Ambiguous,
}

impl SpendStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Reserved => "reserved",
            Self::Submitted => "submitted",
            Self::Released => "released",
            Self::Ambiguous => "ambiguous",
        }
    }
}

pub struct ControlDb {
    conn: Connection,
}

fn day(unix_s: u64) -> i64 {
    (unix_s / 86_400) as i64
}

impl ControlDb {
    pub fn open(path: &std::path::Path) -> rusqlite::Result<Self> {
        Self::init(Connection::open(path)?)
    }

    pub fn in_memory() -> rusqlite::Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> rusqlite::Result<Self> {
        // Concurrent writers (other connections or processes) wait for BEGIN IMMEDIATE instead of
        // failing at once; budget checks then run one at a time.
        conn.busy_timeout(std::time::Duration::from_secs(10))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS proposals (
                 id TEXT PRIMARY KEY,
                 hash TEXT NOT NULL UNIQUE,
                 summary_json TEXT NOT NULL,
                 proposal BLOB NOT NULL,
                 amount_zat INTEGER NOT NULL CHECK (amount_zat > 0),
                 created_at INTEGER NOT NULL,
                 expires_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS approvals (
                 proposal_hash TEXT PRIMARY KEY REFERENCES proposals(hash),
                 signature TEXT NOT NULL,
                 created_at INTEGER NOT NULL,
                 used_at INTEGER
             );
             CREATE TABLE IF NOT EXISTS spends (
                 id INTEGER PRIMARY KEY,
                 proposal_hash TEXT NOT NULL UNIQUE REFERENCES proposals(hash),
                 amount_zat INTEGER NOT NULL CHECK (amount_zat > 0),
                 day INTEGER NOT NULL,
                 status TEXT NOT NULL CHECK (status IN ('reserved','submitted','released','ambiguous')),
                 txid TEXT,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS mandates (
                 id TEXT PRIMARY KEY,
                 hash TEXT NOT NULL UNIQUE,
                 mandate_json TEXT NOT NULL,
                 signature TEXT NOT NULL,
                 max_tx_zat INTEGER NOT NULL CHECK (max_tx_zat > 0),
                 total_zat INTEGER NOT NULL CHECK (total_zat > 0),
                 expires_at INTEGER NOT NULL,
                 created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS pczts (
                 proposal_id TEXT PRIMARY KEY REFERENCES proposals(id),
                 pczt BLOB NOT NULL,
                 created_at INTEGER NOT NULL
             );",
        )?;
        // Spends made under a mandate carry its id (budget accounting). Added in place so control
        // DBs created before mandates keep their history.
        let has_col: bool = conn
            .prepare("SELECT 1 FROM pragma_table_info('spends') WHERE name = 'mandate_id'")?
            .exists([])?;
        if !has_col {
            conn.execute_batch(
                "ALTER TABLE spends ADD COLUMN mandate_id TEXT REFERENCES mandates(id)",
            )?;
        }
        Ok(ControlDb { conn })
    }

    pub fn insert_proposal(
        &self,
        summary: &ProposalSummary,
        proposal_bytes: &[u8],
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO proposals (id, hash, summary_json, proposal, amount_zat, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                summary.proposal_id,
                summary.hash(),
                summary.canonical_json(),
                proposal_bytes,
                summary.amount_zat as i64,
                summary.created_at as i64,
                summary.expires_at as i64,
            ],
        )?;
        Ok(())
    }

    /// Returns (hash, summary_json, proposal bytes) for a proposal id.
    pub fn load_proposal(&self, id: &str) -> rusqlite::Result<Option<(String, String, Vec<u8>)>> {
        self.conn
            .query_row(
                "SELECT hash, summary_json, proposal FROM proposals WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
    }

    /// Records an owner approval after verifying its signature. One approval per proposal hash.
    pub fn record_approval(
        &self,
        owner: &VerifyingKey,
        network: &str,
        proposal_hash: &str,
        signature_hex: &str,
        now: u64,
    ) -> Result<(), Denial> {
        verify_approval(owner, network, proposal_hash, signature_hex)
            .map_err(|_| Denial::ApprovalSignatureInvalid)?;
        let exists: bool = self
            .conn
            .query_row(
                "SELECT 1 FROM proposals WHERE hash = ?1",
                params![proposal_hash],
                |_| Ok(()),
            )
            .optional()
            .map_err(|_| Denial::UnknownProposal)?
            .is_some();
        if !exists {
            return Err(Denial::UnknownProposal);
        }
        self.conn
            .execute(
                "INSERT INTO approvals (proposal_hash, signature, created_at) VALUES (?1, ?2, ?3)",
                params![proposal_hash, signature_hex.trim(), now as i64],
            )
            .map_err(|_| Denial::ApprovalAlreadyUsed)?;
        Ok(())
    }

    /// Cheap, certain checks against the control DB that run before the (expensive, wallet-state
    /// dependent) proposal decoding: unknown, expired, already executed, approval missing or used.
    /// `reserve` repeats all of them atomically; this only orders denials sensibly.
    pub fn precheck(&self, proposal_id: &str, now: u64) -> Result<(), Denial> {
        let row: Option<(String, i64)> = self
            .conn
            .query_row(
                "SELECT hash, expires_at FROM proposals WHERE id = ?1",
                params![proposal_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|_| Denial::UnknownProposal)?;
        let (hash, expires_at) = row.ok_or(Denial::UnknownProposal)?;
        let executed = self
            .conn
            .query_row(
                "SELECT 1 FROM spends WHERE proposal_hash = ?1",
                params![hash],
                |_| Ok(()),
            )
            .optional()
            .map_err(|_| Denial::AlreadyExecuted)?
            .is_some();
        let approval: Option<Option<i64>> = self
            .conn
            .query_row(
                "SELECT used_at FROM approvals WHERE proposal_hash = ?1",
                params![hash],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| Denial::NoApproval)?;
        match approval {
            Some(Some(_)) => return Err(Denial::ApprovalAlreadyUsed),
            _ if executed => return Err(Denial::AlreadyExecuted),
            None => return Err(Denial::NoApproval),
            Some(None) => {}
        }
        if (now as i64) >= expires_at {
            return Err(Denial::ProposalExpired);
        }
        Ok(())
    }

    /// Atomically: check expiry, binding, approval, caps; consume the approval; reserve budget.
    /// `recomputed_hash` is the hash of the summary re-derived from the stored proposal.
    pub fn reserve(
        &mut self,
        owner: &VerifyingKey,
        network: &str,
        proposal_id: &str,
        recomputed_hash: &str,
        now: u64,
    ) -> Result<i64, Denial> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| Denial::UnknownProposal)?;

        let row: Option<(String, i64, i64)> = tx
            .query_row(
                "SELECT hash, amount_zat, expires_at FROM proposals WHERE id = ?1",
                params![proposal_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|_| Denial::UnknownProposal)?;
        let (hash, amount, expires_at) = row.ok_or(Denial::UnknownProposal)?;

        if (now as i64) >= expires_at {
            return Err(Denial::ProposalExpired); // W12
        }
        if recomputed_hash != hash {
            return Err(Denial::HashMismatch); // W8
        }

        let approval: Option<(String, Option<i64>)> = tx
            .query_row(
                "SELECT signature, used_at FROM approvals WHERE proposal_hash = ?1",
                params![hash],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|_| Denial::NoApproval)?;
        let (sig, used_at) = approval.ok_or(Denial::NoApproval)?;
        if used_at.is_some() {
            return Err(Denial::ApprovalAlreadyUsed); // W13
        }
        verify_approval(owner, network, &hash, &sig)
            .map_err(|_| Denial::ApprovalSignatureInvalid)?;

        let executed: bool = tx
            .query_row(
                "SELECT 1 FROM spends WHERE proposal_hash = ?1",
                params![hash],
                |_| Ok(()),
            )
            .optional()
            .map_err(|_| Denial::AlreadyExecuted)?
            .is_some();
        if executed {
            return Err(Denial::AlreadyExecuted);
        }

        if amount as u64 > MAX_TX_ZAT {
            return Err(Denial::OverPerTxCap); // W14
        }
        let spent_today: i64 = tx
            .query_row(
                "SELECT COALESCE(SUM(amount_zat), 0) FROM spends
                 WHERE day = ?1 AND status IN ('reserved','submitted','ambiguous')",
                params![day(now)],
                |r| r.get(0),
            )
            .map_err(|_| Denial::OverDailyCap)?;
        if (spent_today + amount) as u64 > DAILY_CAP_ZAT {
            return Err(Denial::OverDailyCap); // W14
        }

        tx.execute(
            "UPDATE approvals SET used_at = ?1 WHERE proposal_hash = ?2 AND used_at IS NULL",
            params![now as i64, hash],
        )
        .map_err(|_| Denial::ApprovalAlreadyUsed)?;
        tx.execute(
            "INSERT INTO spends (proposal_hash, amount_zat, day, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'reserved', ?4, ?4)",
            params![hash, amount, day(now), now as i64],
        )
        .map_err(|_| Denial::AlreadyExecuted)?;
        let spend_id = tx.last_insert_rowid();
        tx.commit().map_err(|_| Denial::AlreadyExecuted)?;
        Ok(spend_id)
    }

    /// Stores a mandate that `Mandate::verify` accepted. A mandate id can be loaded once.
    pub fn record_mandate(&self, m: &Mandate, signature_hex: &str, now: u64) -> Result<(), Denial> {
        self.conn
            .execute(
                "INSERT INTO mandates (id, hash, mandate_json, signature, max_tx_zat, total_zat, expires_at, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    m.mandate_id,
                    m.hash(),
                    m.canonical_json(),
                    signature_hex.trim(),
                    m.max_tx_zat as i64,
                    m.total_zat as i64,
                    m.expires_at as i64,
                    now as i64,
                ],
            )
            .map_err(|_| Denial::MandateAlreadyLoaded)?;
        Ok(())
    }

    /// (mandate, budget committed: reserved + submitted + ambiguous) for a loaded mandate.
    pub fn mandate_usage(&self, mandate_id: &str) -> Result<(Mandate, u64), Denial> {
        let json: String = self
            .conn
            .query_row(
                "SELECT mandate_json FROM mandates WHERE id = ?1",
                params![mandate_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| Denial::UnknownMandate)?
            .ok_or(Denial::UnknownMandate)?;
        let m: Mandate = serde_json::from_str(&json).map_err(|_| Denial::MandateInvalid)?;
        let used: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(amount_zat), 0) FROM spends
                 WHERE mandate_id = ?1 AND status IN ('reserved','submitted','ambiguous')",
                params![mandate_id],
                |r| r.get(0),
            )
            .map_err(|_| Denial::UnknownMandate)?;
        Ok((m, used as u64))
    }

    /// Like `reserve`, but authorized by a loaded owner-signed mandate instead of a per-proposal
    /// approval. Atomically checks: proposal (expiry, hash binding, not executed); mandate (loaded,
    /// signature still valid, unexpired, recipient on its allow-list, per-tx cap, remaining total);
    /// the §13.1 caps; then reserves budget against both the day and the mandate.
    #[allow(clippy::too_many_arguments)]
    pub fn reserve_with_mandate(
        &mut self,
        owner: &VerifyingKey,
        network: &str,
        proposal_id: &str,
        recomputed_hash: &str,
        recipient: &str,
        mandate_id: &str,
        now: u64,
    ) -> Result<i64, Denial> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| Denial::UnknownProposal)?;

        let row: Option<(String, i64, i64)> = tx
            .query_row(
                "SELECT hash, amount_zat, expires_at FROM proposals WHERE id = ?1",
                params![proposal_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|_| Denial::UnknownProposal)?;
        let (hash, amount, expires_at) = row.ok_or(Denial::UnknownProposal)?;
        if (now as i64) >= expires_at {
            return Err(Denial::ProposalExpired);
        }
        if recomputed_hash != hash {
            return Err(Denial::HashMismatch);
        }
        let executed: bool = tx
            .query_row(
                "SELECT 1 FROM spends WHERE proposal_hash = ?1",
                params![hash],
                |_| Ok(()),
            )
            .optional()
            .map_err(|_| Denial::AlreadyExecuted)?
            .is_some();
        if executed {
            return Err(Denial::AlreadyExecuted);
        }

        let mrow: Option<(String, String)> = tx
            .query_row(
                "SELECT mandate_json, signature FROM mandates WHERE id = ?1",
                params![mandate_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|_| Denial::UnknownMandate)?;
        let (mjson, msig) = mrow.ok_or(Denial::UnknownMandate)?;
        let m: Mandate = serde_json::from_str(&mjson).map_err(|_| Denial::MandateInvalid)?;
        // Re-verify the stored signature: a mandate row edited on disk is not a mandate.
        crate::approval::verify_signature(
            owner,
            &crate::mandate::mandate_message(network, &m.hash()),
            &msig,
        )
        .map_err(|_| Denial::MandateInvalid)?;
        if m.network != network {
            return Err(Denial::MandateInvalid);
        }
        if now >= m.expires_at {
            return Err(Denial::MandateExpired);
        }
        if !m.allowed_recipients.iter().any(|r| r == recipient) {
            return Err(Denial::RecipientNotInMandate);
        }
        if amount as u64 > m.max_tx_zat {
            return Err(Denial::OverMandatePerTx);
        }
        let used: i64 = tx
            .query_row(
                "SELECT COALESCE(SUM(amount_zat), 0) FROM spends
                 WHERE mandate_id = ?1 AND status IN ('reserved','submitted','ambiguous')",
                params![mandate_id],
                |r| r.get(0),
            )
            .map_err(|_| Denial::OverMandateTotal)?;
        if (used + amount) as u64 > m.total_zat {
            return Err(Denial::OverMandateTotal);
        }

        if amount as u64 > MAX_TX_ZAT {
            return Err(Denial::OverPerTxCap);
        }
        let spent_today: i64 = tx
            .query_row(
                "SELECT COALESCE(SUM(amount_zat), 0) FROM spends
                 WHERE day = ?1 AND status IN ('reserved','submitted','ambiguous')",
                params![day(now)],
                |r| r.get(0),
            )
            .map_err(|_| Denial::OverDailyCap)?;
        if (spent_today + amount) as u64 > DAILY_CAP_ZAT {
            return Err(Denial::OverDailyCap);
        }

        tx.execute(
            "INSERT INTO spends (proposal_hash, amount_zat, day, status, created_at, updated_at, mandate_id)
             VALUES (?1, ?2, ?3, 'reserved', ?4, ?4, ?5)",
            params![hash, amount, day(now), now as i64, mandate_id],
        )
        .map_err(|_| Denial::AlreadyExecuted)?;
        let spend_id = tx.last_insert_rowid();
        tx.commit().map_err(|_| Denial::AlreadyExecuted)?;
        Ok(spend_id)
    }

    /// What happened to a proposal's spend, for recovering operations after a crash or restart:
    /// `None` = never reserved (nothing was sent); otherwise the spend status and txid.
    pub fn spend_for_proposal(
        &self,
        proposal_id: &str,
    ) -> rusqlite::Result<Option<(String, Option<String>)>> {
        self.conn
            .query_row(
                "SELECT s.status, s.txid FROM spends s JOIN proposals p ON p.hash = s.proposal_hash
                 WHERE p.id = ?1",
                params![proposal_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
    }

    /// Stores the proved, unsigned PCZT built for a browser-signed proposal (first one wins, so a
    /// retried prepare returns the same transaction the browser may already be signing).
    pub fn store_pczt(&self, proposal_id: &str, pczt: &[u8], now: u64) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO pczts (proposal_id, pczt, created_at) VALUES (?1, ?2, ?3)",
            params![proposal_id, pczt, now as i64],
        )?;
        Ok(())
    }

    pub fn load_pczt(&self, proposal_id: &str) -> rusqlite::Result<Option<Vec<u8>>> {
        self.conn
            .query_row(
                "SELECT pczt FROM pczts WHERE proposal_id = ?1",
                params![proposal_id],
                |r| r.get(0),
            )
            .optional()
    }

    /// Settles a reservation. `Released` frees the budget (the transaction was not accepted);
    /// `Ambiguous` keeps it reserved until reconciled by txid (W16); never retried here.
    pub fn finish(
        &self,
        spend_id: i64,
        status: SpendStatus,
        txid: Option<&str>,
        now: u64,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE spends SET status = ?1, txid = COALESCE(?2, txid), updated_at = ?3 WHERE id = ?4",
            params![status.as_str(), txid, now as i64, spend_id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::approval::{approval_message, POLICY};
    use ed25519_dalek::{Signer, SigningKey};

    const NOW: u64 = 1_800_000_000;

    fn owner() -> SigningKey {
        SigningKey::from_bytes(&[5u8; 32])
    }

    fn summary(id: &str, amount: u64) -> ProposalSummary {
        ProposalSummary {
            payments: vec![],
            proposal_id: id.into(),
            account: "a".into(),
            network: "regtest".into(),
            recipient: "uregtest1x".into(),
            recipient_pool: "ironwood".into(),
            amount_zat: amount,
            fee_zat: 10_000,
            input_pools: vec!["ironwood".into()],
            output_pools: vec!["ironwood".into()],
            change_pools: vec!["ironwood".into()],
            policy: POLICY.into(),
            memo_hash: String::new(),
            created_at: NOW,
            expires_at: NOW + 300,
        }
    }

    fn sign(h: &str) -> String {
        hex::encode(owner().sign(&approval_message("regtest", h)).to_bytes())
    }

    fn setup(id: &str, amount: u64, approve: bool) -> (ControlDb, ProposalSummary) {
        let db = ControlDb::in_memory().unwrap();
        let s = summary(id, amount);
        db.insert_proposal(&s, b"proposal").unwrap();
        if approve {
            db.record_approval(
                &owner().verifying_key(),
                "regtest",
                &s.hash(),
                &sign(&s.hash()),
                NOW,
            )
            .unwrap();
        }
        (db, s)
    }

    #[test]
    fn approved_proposal_reserves() {
        let (mut db, s) = setup("p", 1_000_000, true);
        assert!(db
            .reserve(&owner().verifying_key(), "regtest", "p", &s.hash(), NOW + 1)
            .is_ok());
    }

    #[test]
    fn no_approval_denied() {
        let (mut db, s) = setup("p", 1_000_000, false);
        assert_eq!(
            db.reserve(&owner().verifying_key(), "regtest", "p", &s.hash(), NOW + 1),
            Err(Denial::NoApproval)
        );
    }

    /// W13: an approval is consumed by its first execution.
    #[test]
    fn w13_approval_reuse_denied() {
        let (mut db, s) = setup("p", 1_000_000, true);
        let pk = owner().verifying_key();
        assert_eq!(db.precheck("p", NOW + 1), Ok(()));
        db.reserve(&pk, "regtest", "p", &s.hash(), NOW + 1).unwrap();
        assert_eq!(db.precheck("p", NOW + 2), Err(Denial::ApprovalAlreadyUsed));
        assert_eq!(
            db.reserve(&pk, "regtest", "p", &s.hash(), NOW + 2),
            Err(Denial::ApprovalAlreadyUsed)
        );
        // And it cannot be re-recorded to get a second use.
        assert_eq!(
            db.record_approval(&pk, "regtest", &s.hash(), &sign(&s.hash()), NOW + 3),
            Err(Denial::ApprovalAlreadyUsed)
        );
    }

    /// W12
    #[test]
    fn w12_expired_proposal_denied() {
        let (mut db, s) = setup("p", 1_000_000, true);
        assert_eq!(
            db.reserve(
                &owner().verifying_key(),
                "regtest",
                "p",
                &s.hash(),
                NOW + 300
            ),
            Err(Denial::ProposalExpired)
        );
    }

    /// W8: the proposal re-derived at execution must hash to what was approved.
    #[test]
    fn w8_mutation_after_approval_denied() {
        let (mut db, s) = setup("p", 1_000_000, true);
        let mut mutated = s.clone();
        mutated.recipient = "uregtest1attacker".into();
        assert_eq!(
            db.reserve(
                &owner().verifying_key(),
                "regtest",
                "p",
                &mutated.hash(),
                NOW + 1
            ),
            Err(Denial::HashMismatch)
        );
    }

    #[test]
    fn forged_approval_rejected() {
        let (db, s) = setup("p", 1_000_000, false);
        let attacker = SigningKey::from_bytes(&[6u8; 32]);
        let forged = hex::encode(
            attacker
                .sign(&approval_message("regtest", &s.hash()))
                .to_bytes(),
        );
        assert_eq!(
            db.record_approval(&owner().verifying_key(), "regtest", &s.hash(), &forged, NOW),
            Err(Denial::ApprovalSignatureInvalid)
        );
    }

    /// W14: per-transaction cap.
    #[test]
    fn w14_per_tx_cap() {
        let (mut db, s) = setup("p", MAX_TX_ZAT + 1, true);
        assert_eq!(
            db.reserve(&owner().verifying_key(), "regtest", "p", &s.hash(), NOW + 1),
            Err(Denial::OverPerTxCap)
        );
    }

    const MID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn mandate(total: u64, max_tx: u64) -> (Mandate, String) {
        let m = Mandate {
            mandate_id: MID.into(),
            network: "regtest".into(),
            wallet: "agent".into(),
            purpose: "agent".into(),
            max_tx_zat: max_tx,
            total_zat: total,
            allowed_recipients: vec!["uregtest1x".into()],
            expires_at: NOW + 3600,
            nonce: "n".into(),
        };
        let sig = hex::encode(
            owner()
                .sign(&crate::mandate::mandate_message("regtest", &m.hash()))
                .to_bytes(),
        );
        (m, sig)
    }

    fn mandate_db(amounts: &[u64]) -> (ControlDb, Vec<ProposalSummary>) {
        let db = ControlDb::in_memory().unwrap();
        let (m, sig) = mandate(30_000, 20_000);
        db.record_mandate(&m, &sig, NOW).unwrap();
        let ps = amounts
            .iter()
            .enumerate()
            .map(|(i, a)| {
                let s = summary(&format!("m{i}"), *a);
                db.insert_proposal(&s, b"x").unwrap();
                s
            })
            .collect();
        (db, ps)
    }

    fn rm(
        db: &mut ControlDb,
        ps: &[ProposalSummary],
        i: usize,
        recipient: &str,
        mandate_id: &str,
        now: u64,
    ) -> Result<i64, Denial> {
        db.reserve_with_mandate(
            &owner().verifying_key(),
            "regtest",
            &format!("m{i}"),
            &ps[i].hash(),
            recipient,
            mandate_id,
            now,
        )
    }

    /// A2/A3 in the sidecar: a mandate's per-tx cap and total budget, without any owner approval.
    #[test]
    fn mandate_spends_within_budget_then_denies() {
        let (mut db, ps) = mandate_db(&[20_000, 20_000, 25_000, 10_000]);
        assert!(rm(&mut db, &ps, 0, "uregtest1x", MID, NOW + 1).is_ok());
        assert_eq!(
            rm(&mut db, &ps, 2, "uregtest1x", MID, NOW + 1),
            Err(Denial::OverMandatePerTx)
        );
        // 20k + 20k > 30k total.
        assert_eq!(
            rm(&mut db, &ps, 1, "uregtest1x", MID, NOW + 1),
            Err(Denial::OverMandateTotal)
        );
        assert!(rm(&mut db, &ps, 3, "uregtest1x", MID, NOW + 1).is_ok()); // exactly 30k
        assert_eq!(db.mandate_usage(MID).unwrap().1, 30_000);
    }

    #[test]
    fn mandate_recipient_unknown_replay_binding_expiry() {
        let (mut db, ps) = mandate_db(&[10_000, 10_000]);
        let pk = owner().verifying_key();
        assert_eq!(
            rm(&mut db, &ps, 0, "uregtest1attacker", MID, NOW + 1),
            Err(Denial::RecipientNotInMandate)
        );
        assert_eq!(
            rm(
                &mut db,
                &ps,
                0,
                "uregtest1x",
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                NOW + 1
            ),
            Err(Denial::UnknownMandate)
        );
        rm(&mut db, &ps, 0, "uregtest1x", MID, NOW + 1).unwrap();
        assert_eq!(
            rm(&mut db, &ps, 0, "uregtest1x", MID, NOW + 2),
            Err(Denial::AlreadyExecuted)
        );
        // The approval path still needs a per-proposal owner approval.
        assert_eq!(
            db.reserve(&pk, "regtest", "m1", &ps[1].hash(), NOW + 1),
            Err(Denial::NoApproval)
        );
        // W8 binding applies to mandate spends too.
        let mut mutated = ps[1].clone();
        mutated.amount_zat += 1;
        assert_eq!(
            db.reserve_with_mandate(
                &pk,
                "regtest",
                "m1",
                &mutated.hash(),
                "uregtest1x",
                MID,
                NOW + 1
            ),
            Err(Denial::HashMismatch)
        );
        assert_eq!(
            rm(&mut db, &ps, 1, "uregtest1x", MID, NOW + 300),
            Err(Denial::ProposalExpired)
        );
    }

    #[test]
    fn mandate_expires_and_tampering_or_reload_is_refused() {
        let (mut db, ps) = mandate_db(&[10_000, 10_000]);
        let (m, sig) = mandate(30_000, 20_000);
        assert_eq!(
            db.record_mandate(&m, &sig, NOW),
            Err(Denial::MandateAlreadyLoaded)
        );
        // Someone with DB access raises the budget: the stored signature no longer matches.
        db.conn
            .execute(
                "UPDATE mandates SET mandate_json = replace(mandate_json, '30000', '5000000')",
                [],
            )
            .unwrap();
        assert_eq!(
            rm(&mut db, &ps, 0, "uregtest1x", MID, NOW + 1),
            Err(Denial::MandateInvalid)
        );
    }

    #[test]
    fn expired_mandate_spends_nothing() {
        let db = ControlDb::in_memory().unwrap();
        let mut db = db;
        let (mut m, _) = mandate(30_000, 20_000);
        m.expires_at = NOW + 10;
        let sig = hex::encode(
            owner()
                .sign(&crate::mandate::mandate_message("regtest", &m.hash()))
                .to_bytes(),
        );
        db.record_mandate(&m, &sig, NOW).unwrap();
        let mut s = summary("m0", 10_000);
        s.expires_at = NOW + 300;
        db.insert_proposal(&s, b"x").unwrap();
        assert_eq!(
            rm(&mut db, &[s], 0, "uregtest1x", MID, NOW + 10),
            Err(Denial::MandateExpired)
        );
    }

    fn temp_db_path(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "lute-control-{tag}-{}-{nanos}.db",
            std::process::id()
        ))
    }

    /// R1: settlements racing from separate connections (as separate requests or processes would)
    /// cannot together exceed a mandate's budget. 8 × 10,000 zat against a 30,000 budget, two
    /// writers at once: exactly three reserve.
    #[test]
    fn r1_concurrent_mandate_spends_cannot_exceed_budget() {
        let path = temp_db_path("r1");
        let ps = {
            let db = ControlDb::open(&path).unwrap();
            let (m, sig) = mandate(30_000, 20_000);
            db.record_mandate(&m, &sig, NOW).unwrap();
            (0..8)
                .map(|i| {
                    let s = summary(&format!("m{i}"), 10_000);
                    db.insert_proposal(&s, b"x").unwrap();
                    s
                })
                .collect::<Vec<_>>()
        };
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let handles: Vec<_> = (0..2)
            .map(|t| {
                let (path, ps, barrier) = (path.clone(), ps.clone(), barrier.clone());
                std::thread::spawn(move || {
                    let mut db = ControlDb::open(&path).unwrap();
                    barrier.wait();
                    (0..4)
                        .map(|k| {
                            let i = t * 4 + k;
                            rm(&mut db, &ps, i, "uregtest1x", MID, NOW + 1)
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        let results: Vec<_> = handles
            .into_iter()
            .flat_map(|h| h.join().unwrap())
            .collect();
        let ok = results.iter().filter(|r| r.is_ok()).count();
        assert_eq!(ok, 3, "{results:?}");
        assert!(results
            .iter()
            .filter(|r| r.is_err())
            .all(|r| *r == Err(Denial::OverMandateTotal)));
        assert_eq!(
            ControlDb::open(&path)
                .unwrap()
                .mandate_usage(MID)
                .unwrap()
                .1,
            30_000
        );
        let _ = std::fs::remove_file(&path);
    }

    /// R2: the same approved payout submitted twice at once (a retry racing the original) is
    /// reserved, and so charged, once.
    #[test]
    fn r2_concurrent_retry_of_one_payout_charges_once() {
        let path = temp_db_path("r2");
        let s = {
            let db = ControlDb::open(&path).unwrap();
            let s = summary("p", 1_000_000);
            db.insert_proposal(&s, b"x").unwrap();
            db.record_approval(
                &owner().verifying_key(),
                "regtest",
                &s.hash(),
                &sign(&s.hash()),
                NOW,
            )
            .unwrap();
            s
        };
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
        let results: Vec<_> = (0..4)
            .map(|_| {
                let (path, hash, barrier) = (path.clone(), s.hash(), barrier.clone());
                std::thread::spawn(move || {
                    let mut db = ControlDb::open(&path).unwrap();
                    barrier.wait();
                    db.reserve(&owner().verifying_key(), "regtest", "p", &hash, NOW + 1)
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect();
        assert_eq!(
            results.iter().filter(|r| r.is_ok()).count(),
            1,
            "{results:?}"
        );
        assert!(results
            .iter()
            .filter(|r| r.is_err())
            .all(|r| *r == Err(Denial::ApprovalAlreadyUsed)));
        let spends: i64 = ControlDb::open(&path)
            .unwrap()
            .conn
            .query_row("SELECT COUNT(*) FROM spends", [], |r| r.get(0))
            .unwrap();
        assert_eq!(spends, 1);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn spend_for_proposal_reports_what_happened() {
        let (mut db, s) = setup("p", 1_000_000, true);
        assert_eq!(db.spend_for_proposal("p").unwrap(), None);
        let id = db
            .reserve(&owner().verifying_key(), "regtest", "p", &s.hash(), NOW + 1)
            .unwrap();
        assert_eq!(
            db.spend_for_proposal("p").unwrap(),
            Some(("reserved".into(), None))
        );
        db.finish(id, SpendStatus::Submitted, Some("tx1"), NOW + 2)
            .unwrap();
        assert_eq!(
            db.spend_for_proposal("p").unwrap(),
            Some(("submitted".into(), Some("tx1".into())))
        );
    }

    /// W14/W15: the daily cap counts reserved, submitted and ambiguous spends; released frees it.
    #[test]
    fn w14_w15_daily_cap() {
        let db = ControlDb::in_memory().unwrap();
        let mut db = db;
        let pk = owner().verifying_key();
        let mut ids = vec![];
        for (i, amt) in [2_000_000u64, 2_000_000, 1_000_000, 1].iter().enumerate() {
            let s = summary(&format!("p{i}"), *amt);
            db.insert_proposal(&s, b"x").unwrap();
            db.record_approval(&pk, "regtest", &s.hash(), &sign(&s.hash()), NOW)
                .unwrap();
            ids.push(s);
        }
        let s0 = db
            .reserve(&pk, "regtest", "p0", &ids[0].hash(), NOW + 1)
            .unwrap();
        let s1 = db
            .reserve(&pk, "regtest", "p1", &ids[1].hash(), NOW + 1)
            .unwrap();
        db.finish(s1, SpendStatus::Ambiguous, Some("txid"), NOW + 2)
            .unwrap();
        db.reserve(&pk, "regtest", "p2", &ids[2].hash(), NOW + 1)
            .unwrap(); // exactly 5_000_000
        assert_eq!(
            db.reserve(&pk, "regtest", "p3", &ids[3].hash(), NOW + 1),
            Err(Denial::OverDailyCap)
        );
        // Releasing a reservation (tx not accepted) frees budget for an approved proposal.
        db.finish(s0, SpendStatus::Released, None, NOW + 3).unwrap();
        assert!(db
            .reserve(&pk, "regtest", "p3", &ids[3].hash(), NOW + 4)
            .is_ok());
    }
}
