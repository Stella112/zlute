//! WebAssembly bindings. Seeds and PCZTs cross the boundary as hex strings; results as JSON.

use wasm_bindgen::prelude::*;

use crate::{derive_ufvk, sign_pczt, Expect, Net};

fn js(e: anyhow::Error) -> JsError {
    JsError::new(&format!("{e:#}"))
}

/// Unified full viewing key for `account` of the seed (hex).
#[wasm_bindgen(js_name = deriveUfvk)]
pub fn derive_ufvk_js(seed_hex: &str, network: &str, account: u32) -> Result<String, JsError> {
    let seed = hex::decode(seed_hex).map_err(|e| JsError::new(&e.to_string()))?;
    derive_ufvk(&seed, Net::parse(network).map_err(js)?, account).map_err(js)
}

/// Checks the PCZT (hex) against the expected payment and returns the signatures as JSON
/// `[{"index":0,"sig":"…"}]`. Amounts are decimal strings (zatoshi).
#[wasm_bindgen(js_name = signPczt)]
pub fn sign_pczt_js(
    seed_hex: &str,
    network: &str,
    account: u32,
    pczt_hex: &str,
    recipient: &str,
    amount_zat: &str,
    fee_zat: &str,
) -> Result<String, JsError> {
    let seed = hex::decode(seed_hex).map_err(|e| JsError::new(&e.to_string()))?;
    let pczt = hex::decode(pczt_hex).map_err(|e| JsError::new(&e.to_string()))?;
    let expect = Expect {
        recipient: recipient.to_string(),
        amount_zat: amount_zat.parse().map_err(|_| JsError::new("bad amount"))?,
        fee_zat: fee_zat.parse().map_err(|_| JsError::new("bad fee"))?,
    };
    let sigs = sign_pczt(
        &seed,
        Net::parse(network).map_err(js)?,
        account,
        &pczt,
        &expect,
    )
    .map_err(js)?;
    serde_json::to_string(&sigs).map_err(|e| JsError::new(&e.to_string()))
}
