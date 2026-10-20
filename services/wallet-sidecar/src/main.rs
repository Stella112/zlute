//! `lute-sidecar` CLI. P1a slice: `inspect <main|test|regtest> <address>` prints a JSON verdict.
//! The HTTP API, wallet sync and signing are added in later slices.

use std::process::ExitCode;

use lute_sidecar::inspect::inspect;
use zcash_protocol::consensus::NetworkType;

fn parse_network(s: &str) -> Option<NetworkType> {
    match s {
        "main" => Some(NetworkType::Main),
        "test" => Some(NetworkType::Test),
        "regtest" => Some(NetworkType::Regtest),
        _ => None,
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [cmd, net, addr] if cmd == "inspect" => {
            let Some(net) = parse_network(net) else {
                eprintln!("network must be main, test or regtest");
                return ExitCode::from(2);
            };
            let result = inspect(addr, net);
            println!("{}", serde_json::to_string(&result).expect("serializable"));
            if result.is_allowed() {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            }
        }
        _ => {
            eprintln!("usage: lute-sidecar inspect <main|test|regtest> <address>");
            ExitCode::from(2)
        }
    }
}
