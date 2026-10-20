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
             );",
        )?;
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
