//! Authenticated loopback HTTP API for `apps/api` (mandate §13.4). Nothing else may call it.
//!
//! Every request carries:
//!   X-Lute-Timestamp: unix seconds (±60 s)
//!   X-Lute-Nonce:     16–64 chars [A-Za-z0-9_-], never reused within the window
//!   X-Lute-Signature: hex(HMAC-SHA256(secret, METHOD "\n" PATH "\n" hex(SHA-256(body)) "\n" TS "\n" NONCE))
//! The server binds to loopback only (U12) and refuses any other listen address.
//! Responses carry reason codes, never addresses, memos or keys.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::{to_bytes, Body},
    extract::{Path as UrlPath, Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{inspect::inspect, network::NetworkKind, wallet::Wallet, zip321req};

const MAX_BODY: usize = 64 * 1024;
const SKEW_S: u64 = 60;

type HmacSha256 = Hmac<Sha256>;

pub struct ApiConfig {
    pub listen: SocketAddr,
    pub wallets_root: PathBuf,
    pub secret: Vec<u8>,
    pub owner_pub: PathBuf,
    pub network: NetworkKind,
}

struct AppState {
    wallets_root: PathBuf,
    secret: Vec<u8>,
    owner_pub: PathBuf,
    network: NetworkKind,
    nonces: Mutex<HashMap<String, u64>>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after 1970")
        .as_secs()
}

/// The exact string that is MACed. Shared with `apps/api` (see docs/API.md).
pub fn signing_string(method: &str, path: &str, body: &[u8], ts: &str, nonce: &str) -> String {
    format!(
        "{method}\n{path}\n{}\n{ts}\n{nonce}",
        hex::encode(Sha256::digest(body))
    )
}

pub fn sign(secret: &[u8], s: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(s.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

#[derive(Debug, PartialEq, Eq)]
pub enum AuthError {
    MissingHeader,
    BadTimestamp,
    StaleTimestamp,
    BadNonce,
    ReplayedNonce,
    BadSignature,
}

/// Pure verification, unit-tested. `seen` maps nonce -> timestamp and is pruned here.
pub fn verify(
    secret: &[u8],
    method: &str,
    path: &str,
    body: &[u8],
    headers: (&str, &str, &str),
    now: u64,
    seen: &mut HashMap<String, u64>,
) -> Result<(), AuthError> {
    let (ts, nonce, sig) = headers;
    let ts_n: u64 = ts.parse().map_err(|_| AuthError::BadTimestamp)?;
    if ts_n.abs_diff(now) > SKEW_S {
        return Err(AuthError::StaleTimestamp);
    }
    if !(16..=64).contains(&nonce.len())
        || !nonce
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(AuthError::BadNonce);
    }
    let sig_bytes = hex::decode(sig).map_err(|_| AuthError::BadSignature)?;
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(signing_string(method, path, body, ts, nonce).as_bytes());
    // Constant-time comparison.
    mac.verify_slice(&sig_bytes)
        .map_err(|_| AuthError::BadSignature)?;
    seen.retain(|_, t| t.abs_diff(now) <= 2 * SKEW_S);
    if seen.contains_key(nonce) {
        return Err(AuthError::ReplayedNonce);
    }
    seen.insert(nonce.to_string(), ts_n);
    Ok(())
}

fn header<'a>(h: &'a HeaderMap, k: &str) -> Option<&'a str> {
    h.get(k).and_then(|v| v.to_str().ok())
}

async fn auth(State(st): State<Arc<AppState>>, req: Request, next: Next) -> Response {
    let (parts, body) = req.into_parts();
    let Ok(bytes) = to_bytes(body, MAX_BODY).await else {
        return err(StatusCode::PAYLOAD_TOO_LARGE, "BODY_TOO_LARGE");
    };
    let h = &parts.headers;
    let (Some(ts), Some(nonce), Some(sig)) = (
        header(h, "x-lute-timestamp"),
        header(h, "x-lute-nonce"),
        header(h, "x-lute-signature"),
    ) else {
        return err(StatusCode::UNAUTHORIZED, "UNAUTHENTICATED");
    };
    let path = parts
        .uri
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/");
    let verdict = {
        let mut seen = st.nonces.lock().unwrap_or_else(|e| e.into_inner());
        verify(
            &st.secret,
            parts.method.as_str(),
            path,
            &bytes,
            (ts, nonce, sig),
            now(),
            &mut seen,
        )
    };
    if verdict.is_err() {
        // Same response for every auth failure; no detail for an unauthenticated caller.
        return err(StatusCode::UNAUTHORIZED, "UNAUTHENTICATED");
    }
    next.run(Request::from_parts(parts, Body::from(bytes)))
        .await
}

fn err(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({ "error": code }))).into_response()
}

/// Maps sidecar errors to responses. Policy/approval denials keep their reason code; anything
/// else becomes a generic error (details go nowhere: they may contain addresses).
fn from_anyhow(e: anyhow::Error) -> Response {
    let msg = format!("{e:#}");
    for (prefix, status) in [
        ("recipient denied: ", StatusCode::FORBIDDEN),
        ("policy denied: ", StatusCode::FORBIDDEN),
        ("execution denied: ", StatusCode::FORBIDDEN),
        ("approval rejected: ", StatusCode::FORBIDDEN),
    ] {
        if let Some(code) = msg.strip_prefix(prefix) {
            return err(status, code.trim_matches('"'));
        }
    }
    if msg.starts_with("amount exceeds the per-transaction cap") {
        return err(StatusCode::FORBIDDEN, "OVER_PER_TX_CAP");
    }
    if msg.starts_with("unknown proposal") {
        return err(StatusCode::NOT_FOUND, "UNKNOWN_PROPOSAL");
    }
    err(StatusCode::INTERNAL_SERVER_ERROR, "SIDECAR_ERROR")
}

fn valid_wallet_name(n: &str) -> bool {
    (1..=32).contains(&n.len())
        && n.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn open_wallet(st: &AppState, name: &str) -> Result<Wallet, Box<Response>> {
    let unknown = || Box::new(err(StatusCode::NOT_FOUND, "UNKNOWN_WALLET"));
    if !valid_wallet_name(name) {
        return Err(unknown());
    }
    let w = Wallet::open(&st.wallets_root.join(name)).map_err(|_| unknown())?;
    if w.config.network != st.network {
        return Err(unknown());
    }
    Ok(w)
}

#[derive(Deserialize)]
struct InspectReq {
    address: String,
}

async fn h_inspect(State(st): State<Arc<AppState>>, Json(r): Json<InspectReq>) -> Response {
    Json(inspect(&r.address, st.network.params_type())).into_response()
}

#[derive(Deserialize)]
struct Zip321Req {
    address: String,
    amount_zat: u64,
    opaque_ref: String,
}

async fn h_zip321(State(st): State<Arc<AppState>>, Json(r): Json<Zip321Req>) -> Response {
    match zip321req::build(
        st.network.params_type(),
        &r.address,
        r.amount_zat,
        &r.opaque_ref,
    ) {
        Ok(uri) => Json(json!({ "uri": uri })).into_response(),
        Err(e) => (StatusCode::FORBIDDEN, Json(json!({ "error": e }))).into_response(),
    }
}

async fn h_address(State(st): State<Arc<AppState>>, UrlPath(w): UrlPath<String>) -> Response {
    let w = match open_wallet(&st, &w) {
        Ok(w) => w,
        Err(r) => return *r,
    };
    match w.next_address() {
        Ok(a) => Json(json!({ "address": a })).into_response(),
        Err(e) => from_anyhow(e),
    }
}

async fn h_balance(State(st): State<Arc<AppState>>, UrlPath(w): UrlPath<String>) -> Response {
    let w = match open_wallet(&st, &w) {
        Ok(w) => w,
        Err(r) => return *r,
    };
    match w.balance(1) {
        Ok(b) => Json(b).into_response(),
        Err(e) => from_anyhow(e),
    }
}

async fn h_sync(State(st): State<Arc<AppState>>, UrlPath(w): UrlPath<String>) -> Response {
    let w = match open_wallet(&st, &w) {
        Ok(w) => w,
        Err(r) => return *r,
    };
    match w.sync().await.and_then(|_| w.balance(1)) {
        Ok(b) => Json(b).into_response(),
        Err(e) => from_anyhow(e),
    }
}

#[derive(Deserialize)]
struct CheckReq {
    address: String,
    amount_zat: u64,
    opaque_ref: String,
    min_conf: u32,
}

async fn h_check(
    State(st): State<Arc<AppState>>,
    UrlPath(w): UrlPath<String>,
    Json(r): Json<CheckReq>,
) -> Response {
    let w = match open_wallet(&st, &w) {
        Ok(w) => w,
        Err(r) => return *r,
    };
    match w
        .check_request(&r.address, r.amount_zat, &r.opaque_ref, r.min_conf.max(1))
        .await
    {
        Ok(c) => Json(c).into_response(),
        Err(e) => from_anyhow(e),
    }
}

#[derive(Deserialize)]
struct ProposeReq {
    to: String,
    amount_zat: u64,
    memo: Option<String>,
}

async fn h_propose(
    State(st): State<Arc<AppState>>,
    UrlPath(w): UrlPath<String>,
    Json(r): Json<ProposeReq>,
) -> Response {
    let w = match open_wallet(&st, &w) {
        Ok(w) => w,
        Err(r) => return *r,
    };
    match w.propose(&r.to, r.amount_zat, r.memo.as_deref()) {
        Ok(v) => Json(v).into_response(),
        Err(e) => from_anyhow(e),
    }
}

async fn h_show(
    State(st): State<Arc<AppState>>,
    UrlPath((w, id)): UrlPath<(String, String)>,
) -> Response {
    let w = match open_wallet(&st, &w) {
        Ok(w) => w,
        Err(r) => return *r,
    };
    match w.show_proposal(&id) {
        Ok(v) => Json(v).into_response(),
        Err(e) => from_anyhow(e),
    }
}

#[derive(Deserialize)]
struct ApproveReq {
    signature: String,
}

async fn h_approve(
    State(st): State<Arc<AppState>>,
    UrlPath((w, id)): UrlPath<(String, String)>,
    Json(r): Json<ApproveReq>,
) -> Response {
    let w = match open_wallet(&st, &w) {
        Ok(w) => w,
        Err(r) => return *r,
    };
    match w.approve(&id, &r.signature, &st.owner_pub) {
        Ok(()) => Json(json!({ "approved": true })).into_response(),
        Err(e) => from_anyhow(e),
    }
}

async fn h_execute(
    State(st): State<Arc<AppState>>,
    UrlPath((w, id)): UrlPath<(String, String)>,
) -> Response {
    let w = match open_wallet(&st, &w) {
        Ok(w) => w,
        Err(r) => return *r,
    };
    match w.execute(&id, &st.owner_pub).await {
        Ok(o) => Json(o).into_response(),
        Err(e) => from_anyhow(e),
    }
}

#[derive(Deserialize)]
struct VerifyReq {
    txid: String,
}

async fn h_verify(
    State(st): State<Arc<AppState>>,
    UrlPath(w): UrlPath<String>,
    Json(r): Json<VerifyReq>,
) -> Response {
    let w = match open_wallet(&st, &w) {
        Ok(w) => w,
        Err(r) => return *r,
    };
    match w.verify(&r.txid).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => from_anyhow(e),
    }
}

pub fn router(cfg: &ApiConfig) -> Router {
    let st = Arc::new(AppState {
        wallets_root: cfg.wallets_root.clone(),
        secret: cfg.secret.clone(),
        owner_pub: cfg.owner_pub.clone(),
        network: cfg.network,
        nonces: Mutex::new(HashMap::new()),
    });
    Router::new()
        .route("/v1/inspect", post(h_inspect))
        .route("/v1/zip321/build", post(h_zip321))
        .route("/v1/wallets/{w}/address", post(h_address))
        .route("/v1/wallets/{w}/balance", get(h_balance))
        .route("/v1/wallets/{w}/sync", post(h_sync))
        .route("/v1/wallets/{w}/proposals", post(h_propose))
        .route("/v1/wallets/{w}/proposals/{id}", get(h_show))
        .route("/v1/wallets/{w}/proposals/{id}/approve", post(h_approve))
        .route("/v1/wallets/{w}/proposals/{id}/execute", post(h_execute))
        .route("/v1/wallets/{w}/verify", post(h_verify))
        .route("/v1/wallets/{w}/requests/check", post(h_check))
        .layer(middleware::from_fn_with_state(st.clone(), auth))
        .with_state(st)
}

pub fn load_secret(path: &Path) -> anyhow::Result<Vec<u8>> {
    let s = std::fs::read_to_string(path)?;
    let b = hex::decode(s.trim())?;
    if b.len() < 32 {
        anyhow::bail!("API secret must be at least 32 bytes (64 hex chars)");
    }
    Ok(b)
}

pub async fn serve(cfg: ApiConfig) -> anyhow::Result<()> {
    if !cfg.listen.ip().is_loopback() {
        anyhow::bail!("refusing to listen on a non-loopback address (mandate §8, U12)");
    }
    let listener = tokio::net::TcpListener::bind(cfg.listen).await?;
    axum::serve(listener, router(&cfg)).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &[u8] = b"0123456789abcdef0123456789abcdef";
    const NONCE: &str = "nonce-aaaaaaaaaaaa";

    fn signed(method: &str, path: &str, body: &[u8], ts: u64) -> String {
        sign(
            SECRET,
            &signing_string(method, path, body, &ts.to_string(), NONCE),
        )
    }

    /// Cross-language vector: apps/api/test/sidecar.test.ts computes the same signature.
    #[test]
    fn cross_language_hmac_vector() {
        assert_eq!(
            sign(
                SECRET,
                &signing_string("POST", "/v1/inspect", b"{}", "1000", NONCE)
            ),
            "269ee4330764a125fb41e5be9669614be2393f422e8bd8dc64e4835715d7bf07"
        );
    }

    #[test]
    fn valid_request_passes_once_then_replay_fails() {
        let mut seen = HashMap::new();
        let sig = signed("POST", "/v1/inspect", b"{}", 1000);
        assert_eq!(
            verify(
                SECRET,
                "POST",
                "/v1/inspect",
                b"{}",
                ("1000", NONCE, &sig),
                1000,
                &mut seen
            ),
            Ok(())
        );
        assert_eq!(
            verify(
                SECRET,
                "POST",
                "/v1/inspect",
                b"{}",
                ("1000", NONCE, &sig),
                1001,
                &mut seen
            ),
            Err(AuthError::ReplayedNonce)
        );
    }

    #[test]
    fn tampering_fails() {
        let mut seen = HashMap::new();
        let sig = signed("POST", "/v1/inspect", b"{}", 1000);
        for (m, p, b) in [
            ("GET", "/v1/inspect", &b"{}"[..]),
            ("POST", "/v1/zip321/build", &b"{}"[..]),
            ("POST", "/v1/inspect", &b"{\"a\":1}"[..]),
        ] {
            assert_eq!(
                verify(SECRET, m, p, b, ("1000", NONCE, &sig), 1000, &mut seen),
                Err(AuthError::BadSignature)
            );
        }
        assert_eq!(
            verify(
                b"another-secret-another-secret-xx",
                "POST",
                "/v1/inspect",
                b"{}",
                ("1000", NONCE, &sig),
                1000,
                &mut seen
            ),
            Err(AuthError::BadSignature)
        );
    }

    #[test]
    fn stale_and_malformed_rejected() {
        let mut seen = HashMap::new();
        let sig = signed("POST", "/x", b"", 1000);
        assert_eq!(
            verify(
                SECRET,
                "POST",
                "/x",
                b"",
                ("1000", NONCE, &sig),
                1061,
                &mut seen
            ),
            Err(AuthError::StaleTimestamp)
        );
        assert_eq!(
            verify(
                SECRET,
                "POST",
                "/x",
                b"",
                ("abc", NONCE, &sig),
                1000,
                &mut seen
            ),
            Err(AuthError::BadTimestamp)
        );
        assert_eq!(
            verify(
                SECRET,
                "POST",
                "/x",
                b"",
                ("1000", "short", &sig),
                1000,
                &mut seen
            ),
            Err(AuthError::BadNonce)
        );
    }

    #[test]
    fn wallet_names_cannot_traverse() {
        assert!(valid_wallet_name("payout"));
        for bad in ["", "../keys", "Payout", "a/b", &"x".repeat(33)] {
            assert!(!valid_wallet_name(bad), "{bad}");
        }
    }

    /// U12: the server refuses to bind anything but loopback.
    #[tokio::test]
    async fn u12_refuses_non_loopback() {
        let cfg = ApiConfig {
            listen: "0.0.0.0:0".parse().unwrap(),
            wallets_root: PathBuf::from("/nonexistent"),
            secret: SECRET.to_vec(),
            owner_pub: PathBuf::from("/nonexistent"),
            network: NetworkKind::Regtest,
        };
        assert!(serve(cfg).await.is_err());
    }
}
