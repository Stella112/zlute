//! Incoming payments to a specific receive address, and payment-request verification
//! (mandate §19.2): unique address + memo `LUTE:<ref>` (or address-only, recorded), value ≥
//! amount, confirmations ≥ min. Overpayment recorded; underpayment stays PENDING.
//!
//! Received outputs come from `zcash_client_sqlite@0.22.0`'s `v_received_outputs` view joined to
//! `addresses` and `transactions` (read-only connection). Memos are not in compact blocks, so
//! each candidate transaction is fetched and decrypted with `Wallet::verify` (GetTransaction;
//! see docs/PRIVACY.md for what that reveals to the light server).

use anyhow::Context;
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use zcash_client_backend::data_api::WalletRead;
use zcash_protocol::TxId;

use super::Wallet;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct IncomingOutput {
    pub txid: String,
    pub mined_height: Option<u32>,
    pub confirmations: u32,
    pub pool: &'static str,
    pub value_zat: u64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RequestStatus {
    Unpaid,
    Pending,
    Paid,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MatchedBy {
    AddressAndMemo,
    /// The payer's wallet sent no memo (or a different one); matched by the unique address only.
    AddressOnly,
}

#[derive(Debug, Clone, Serialize)]
pub struct RequestCheck {
    pub status: RequestStatus,
    pub matched_by: Option<MatchedBy>,
    pub requested_zat: u64,
    pub received_confirmed_zat: u64,
    pub received_pending_zat: u64,
    pub overpaid_zat: u64,
    pub txids: Vec<String>,
}

fn pool_name(p: i64) -> &'static str {
    match p {
        2 => "sapling",
        3 => "orchard",
        4 => "ironwood",
        0 => "transparent",
        _ => "unknown",
    }
}

/// Pure classification (unit-tested).
pub fn classify(
    requested_zat: u64,
    outputs: &[IncomingOutput],
    min_conf: u32,
    memo_matched: bool,
) -> RequestCheck {
    let confirmed: u64 = outputs
        .iter()
        .filter(|o| o.confirmations >= min_conf)
        .map(|o| o.value_zat)
        .sum();
    let pending: u64 = outputs
        .iter()
        .filter(|o| o.confirmations < min_conf)
        .map(|o| o.value_zat)
        .sum();
    let status = if outputs.is_empty() {
        RequestStatus::Unpaid
    } else if confirmed >= requested_zat {
        RequestStatus::Paid
    } else {
        RequestStatus::Pending
    };
    let mut txids: Vec<String> = outputs.iter().map(|o| o.txid.clone()).collect();
    txids.dedup();
    RequestCheck {
        status,
        matched_by: (!outputs.is_empty()).then_some(if memo_matched {
            MatchedBy::AddressAndMemo
        } else {
            MatchedBy::AddressOnly
        }),
        requested_zat,
        received_confirmed_zat: confirmed,
        received_pending_zat: pending,
        overpaid_zat: confirmed.saturating_sub(requested_zat),
        txids,
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TxStatus {
    pub txid: String,
    /// False if this wallet has no record of the transaction.
    pub known: bool,
    pub mined_height: Option<u32>,
    pub confirmations: u32,
    /// True once the transaction expired unmined (it can no longer confirm).
    pub expired_unmined: bool,
}

impl Wallet {
    /// Status of a transaction this wallet created or received, from its own DB (no server call
    /// beyond the regular sync, so nothing extra is revealed to the light server).
    pub fn tx_status(&self, txid_hex: &str) -> anyhow::Result<TxStatus> {
        let txid = TxId::from_hex(txid_hex).ok_or_else(|| anyhow::anyhow!("invalid txid"))?;
        let tip = self
            .db()?
            .chain_height()?
            .map(u32::from)
            .unwrap_or_default();
        let conn = Connection::open_with_flags(
            self.dir.join(super::DB_FILE),
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .context("opening wallet DB read-only")?;
        let row: Option<(Option<i64>, Option<i64>)> = conn
            .query_row(
                "SELECT mined_height, expiry_height FROM transactions WHERE txid = ?1",
                params![txid.as_ref().to_vec()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        Ok(match row {
            None => TxStatus {
                txid: txid.to_string(),
                known: false,
                mined_height: None,
                confirmations: 0,
                expired_unmined: false,
            },
            Some((mined, expiry)) => {
                let mined_height = mined.map(|h| h as u32);
                TxStatus {
                    txid: txid.to_string(),
                    known: true,
                    mined_height,
                    confirmations: mined_height.map_or(0, |h| tip.saturating_sub(h) + 1),
                    expired_unmined: mined_height.is_none()
                        && expiry.is_some_and(|e| e > 0 && (e as u32) < tip),
                }
            }
        })
    }

    /// Non-change outputs received at exactly `address` (one Lute request = one address).
    pub fn received_to(&self, address: &str) -> anyhow::Result<Vec<IncomingOutput>> {
        let tip = self
            .db()?
            .chain_height()?
            .map(u32::from)
            .unwrap_or_default();
        let conn = Connection::open_with_flags(
            self.dir.join(super::DB_FILE),
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .context("opening wallet DB read-only")?;
        let mut stmt = conn.prepare(
            "SELECT t.txid, t.mined_height, r.value, r.pool
               FROM v_received_outputs r
               JOIN addresses a ON a.id = r.address_id
               JOIN transactions t ON t.id_tx = r.transaction_id
              WHERE a.address = ?1 AND r.is_change = 0 AND r.sent_note_id IS NULL
              ORDER BY t.mined_height IS NULL, t.mined_height, t.txid",
        )?;
        let rows = stmt.query_map(params![address], |r| {
            let txid: Vec<u8> = r.get(0)?;
            let mined: Option<i64> = r.get(1)?;
            let value: i64 = r.get(2)?;
            let pool: i64 = r.get(3)?;
            Ok((txid, mined, value, pool))
        })?;
        let mut out = vec![];
        for row in rows {
            let (txid, mined, value, pool) = row?;
            let bytes: [u8; 32] = txid
                .try_into()
                .map_err(|_| anyhow::anyhow!("malformed txid in wallet DB"))?;
            let mined_height = mined.map(|h| h as u32);
            out.push(IncomingOutput {
                txid: TxId::from_bytes(bytes).to_string(),
                mined_height,
                confirmations: mined_height.map_or(0, |h| tip.saturating_sub(h) + 1),
                pool: pool_name(pool),
                value_zat: u64::try_from(value).unwrap_or(0),
            });
        }
        Ok(out)
    }

    /// Checks a payment request: payments to its unique address, memo `LUTE:<opaque_ref>`.
    pub async fn check_request(
        &self,
        address: &str,
        requested_zat: u64,
        opaque_ref: &str,
        min_conf: u32,
    ) -> anyhow::Result<RequestCheck> {
        let outputs = self.received_to(address)?;
        let expected = format!("{}{}", crate::zip321req::MEMO_PREFIX, opaque_ref);
        let mut memo_matched = !outputs.is_empty();
        let mut txids: Vec<&str> = outputs.iter().map(|o| o.txid.as_str()).collect();
        txids.dedup();
        for txid in txids {
            let v = self.verify(txid).await?;
            if !v
                .received
                .iter()
                .any(|r| r.memo_text.as_deref() == Some(expected.as_str()))
            {
                memo_matched = false;
            }
        }
        Ok(classify(requested_zat, &outputs, min_conf, memo_matched))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out(txid: &str, value: u64, conf: u32) -> IncomingOutput {
        IncomingOutput {
            txid: txid.into(),
            mined_height: (conf > 0).then_some(100),
            confirmations: conf,
            pool: "ironwood",
            value_zat: value,
        }
    }

    #[test]
    fn unpaid_when_nothing_received() {
        let c = classify(1_000, &[], 3, false);
        assert_eq!(c.status, RequestStatus::Unpaid);
        assert_eq!(c.matched_by, None);
    }

    #[test]
    fn paid_needs_value_and_confirmations() {
        assert_eq!(
            classify(1_000, &[out("a", 1_000, 3)], 3, true).status,
            RequestStatus::Paid
        );
        // Enough value but not enough confirmations: pending, never PAID (F6).
        let c = classify(1_000, &[out("a", 1_000, 2)], 3, true);
        assert_eq!(c.status, RequestStatus::Pending);
        assert_eq!(c.received_pending_zat, 1_000);
    }

    #[test]
    fn underpayment_stays_pending_with_received_amount() {
        let c = classify(1_000, &[out("a", 400, 5)], 3, true);
        assert_eq!(c.status, RequestStatus::Pending);
        assert_eq!(c.received_confirmed_zat, 400);
    }

    #[test]
    fn overpayment_and_multiple_payments_recorded() {
        let c = classify(1_000, &[out("a", 700, 4), out("b", 500, 3)], 3, true);
        assert_eq!(c.status, RequestStatus::Paid);
        assert_eq!(c.overpaid_zat, 200);
        assert_eq!(c.txids, vec!["a", "b"]);
    }

    #[test]
    fn address_only_match_is_recorded() {
        let c = classify(1_000, &[out("a", 1_000, 3)], 3, false);
        assert_eq!(c.matched_by, Some(MatchedBy::AddressOnly));
    }
}
