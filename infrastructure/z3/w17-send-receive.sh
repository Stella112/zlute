#!/usr/bin/env bash
# W17 evidence run (regtest): real shielded send + receive with recipient verification,
# plus sidecar-side denials (W1 transparent, W2 TEX, W9 wrong network).
# Funds come from the fixture funder (D-007). Output: one JSON-ish line per step.
# Usage (on the VPS): bash w17-send-receive.sh > /opt/zlute/logs/w17.log 2>&1
set -uo pipefail

BIN=/opt/zlute/bin/lute-sidecar
W=/opt/zlute/wallets/regtest
ZAINO=http://127.0.0.1:28137
ZEBRA=http://127.0.0.1:29232
RPC_AUTH="${Z3_RPC_AUTH:-zebra:zebra}"   # Z3's public regtest default, local-only (see fund-fixture.sh)
AMOUNT=1000000                          # 0.01 regtest ZEC
MEMO="LUTE:w17"

step() { echo "== $(date -u +%FT%TZ) $*"; }
rpc() {
  curl -sf -u "$RPC_AUTH" -X POST -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"$1\",\"params\":$2,\"id\":1}" "$ZEBRA"
}

step "binary"; "$BIN" --version; sha256sum "$BIN"
step "fetch-params"; "$BIN" fetch-params

if [ ! -f "$W/recipient/wallet.json" ]; then
  step "init recipient"; "$BIN" wallet --dir "$W/recipient" init --name recipient --network regtest --server "$ZAINO"
fi
step "sync funder";    "$BIN" wallet --dir "$W/funder" sync
step "sync recipient"; "$BIN" wallet --dir "$W/recipient" sync
TO="$("$BIN" wallet --dir "$W/recipient" address)"
step "recipient address prefix: ${TO:0:12}"

# W2 (TEX) and W9 (wrong network) are covered with real derived addresses by the CI unit tests.
step "W1 send to transparent recipient (expect denial before any signing)"
T_ADDR=tmSRd1r8gs77Ja67Fw1JcdoXytxsyrLTPJm   # Z3's default regtest miner t-address (.env.regtest)
"$BIN" wallet --dir "$W/funder" send --to "$T_ADDR" --zat "$AMOUNT"; echo "exit=$?"

step "W17 send $AMOUNT zat with memo"
OUT="$("$BIN" wallet --dir "$W/funder" send --to "$TO" --zat "$AMOUNT" --memo "$MEMO")"; RC=$?
echo "$OUT"; echo "exit=$RC"
TXID="$(echo "$OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["txid"])' 2>/dev/null || true)"
if [ -z "$TXID" ] || [ "$RC" -ne 0 ]; then step "send failed"; exit 1; fi

step "mine 1 block"; rpc generate '[1]' >/dev/null && rpc getblockcount '[]'; echo
sleep 5
step "sync recipient"; "$BIN" wallet --dir "$W/recipient" sync
step "W17 recipient verify $TXID"; "$BIN" wallet --dir "$W/recipient" verify --txid "$TXID"; echo "exit=$?"
step "sync funder";    "$BIN" wallet --dir "$W/funder" sync
step "done"
