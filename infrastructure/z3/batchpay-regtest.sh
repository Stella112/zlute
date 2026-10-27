#!/usr/bin/env bash
# BatchPay on regtest, end to end with the real sidecar and Zaino: one shielded transaction pays
# three recipients from a browser-signed (non-custodial) wallet. Checks: the batch is proposed as
# one transaction with every line in the approved summary; the signer refuses a batch whose lines
# differ from what was approved; the owner approval + browser signatures execute it once; every
# recipient receives exactly its amount and its own memo; the transaction is single-pool Ironwood.
# Usage (on the VPS): bash batchpay-regtest.sh > /opt/zlute/logs/batchpay-regtest.log 2>&1
set -uo pipefail

BIN=/opt/zlute/bin/lute-sidecar
OWNER=/opt/zlute/bin/lute-owner
W=/opt/zlute/wallets/regtest
FUNDER="$W/funder"
NC="$W/nc-payout"                                # browser-signed wallet from noncustodial-regtest.sh
KEY=/opt/zlute/regtest-owner/owner.key
PUB=/opt/zlute/regtest-owner/owner.pub
SEED=/opt/zlute/regtest-owner/nc-seed.hex
RUN=/opt/zlute/regtest-owner/batch-run
ZAINO=http://127.0.0.1:28137
ZEBRA=http://127.0.0.1:29232
RPC_AUTH="${Z3_RPC_AUTH:-zebra:zebra}"

step() { echo "== $(date -u +%FT%TZ) $*"; }
rpc() {
  curl -sf -u "$RPC_AUTH" -X POST -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"$1\",\"params\":$2,\"id\":1}" "$ZEBRA"
}
jget() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }
nc() { "$BIN" wallet --dir "$NC" "$@"; }

step "binaries"; sha256sum "$BIN" "$OWNER"
mkdir -p "$RUN" && chmod 700 "$RUN"
[ -d "$NC" ] || { echo "run noncustodial-regtest.sh first"; exit 1; }

step "three recipient wallets (regtest fixtures)"
for r in pay1 pay2 pay3; do
  if [ ! -d "$W/$r" ]; then
    TIP=$(rpc getblockcount '[]' | jget '["result"]')
    "$BIN" wallet --dir "$W/$r" init --name "$r" --network regtest --server "$ZAINO" --birthday "$TIP" > /dev/null
  fi
  "$BIN" wallet --dir "$W/$r" sync > /dev/null
done
A1=$("$BIN" wallet --dir "$W/pay1" address); A2=$("$BIN" wallet --dir "$W/pay2" address); A3=$("$BIN" wallet --dir "$W/pay3" address)

step "top up the browser-signed wallet (1,000,000 zat) and mine"
"$BIN" wallet --dir "$FUNDER" sync > /dev/null
"$BIN" wallet --dir "$FUNDER" send --to "$(nc address)" --zat 1000000 --memo "LUTE:batchfund" > /dev/null; echo "exit=$?"
rpc generate '[2]' > /dev/null; sleep 6
nc sync; echo

python3 - "$RUN/lines.json" "$A1" "$A2" "$A3" <<'PY'
import json, sys
p, a1, a2, a3 = sys.argv[1:]
json.dump([{"to": a1, "amount_zat": 100000, "memo": "LUTE:slip-one"},
           {"to": a2, "amount_zat": 200000, "memo": "LUTE:slip-two"},
           {"to": a3, "amount_zat": 300000, "memo": "LUTE:slip-three"}], open(p, "w"))
PY

step "propose one batch transaction (3 recipients, 600,000 zat)"
P_JSON="$(nc propose-batch --lines "$RUN/lines.json")"; echo "$P_JSON" | python3 -c "import sys,json; s=json.load(sys.stdin)['summary']; print({k: s[k] for k in ('recipient','amount_zat','fee_zat','input_pools','output_pools','change_pools')}, 'lines:', [(l['amount_zat'], l['recipient_pool']) for l in s['payments']])"
P="$(echo "$P_JSON" | jget '["summary"]["proposal_id"]')"

step "prepare the unsigned, proved batch transaction"
nc prepare-pczt --proposal "$P" > "$RUN/view.json"; echo "exit=$?"

step "signer refuses a batch whose second line differs from what was approved (amount + 1)"
python3 - "$RUN/view.json" "$RUN/view-tampered.json" <<'PY'
import json, sys
v = json.load(open(sys.argv[1])); v["summary"]["payments"][1]["amount_zat"] += 1; json.dump(v, open(sys.argv[2], "w"))
PY
"$BIN" signer sign-pczt --seed-file "$SEED" --network regtest --account 1 --view "$RUN/view-tampered.json"; echo "exit=$?"

step "signer checks every line and signs"
SIGS="$("$BIN" signer sign-pczt --seed-file "$SEED" --network regtest --account 1 --view "$RUN/view.json")"; echo "$SIGS"

step "owner approval (lute-owner shows every batch line) and execute"
APPROVAL="$(nc show --proposal "$P" | "$OWNER" sign --key "$KEY" --unattended-regtest 2>"$RUN/owner-display.txt")"
grep -E "BATCH|ZEC ->" "$RUN/owner-display.txt"
nc approve --proposal "$P" --signature "$APPROVAL" --owner-pub "$PUB"; echo "exit=$?"
EX="$(nc execute-signed --proposal "$P" --sigs "$SIGS" --owner-pub "$PUB")"; echo "$EX"; echo "exit=$?"
TX="$(echo "$EX" | jget '["txid"]' 2>/dev/null)"

step "replay -> APPROVAL_ALREADY_USED"
nc execute-signed --proposal "$P" --sigs "$SIGS" --owner-pub "$PUB"; echo "exit=$?"

step "mine; every recipient verifies its own amount and memo"
rpc generate '[1]' > /dev/null; sleep 6
for r in pay1 pay2 pay3; do
  "$BIN" wallet --dir "$W/$r" sync > /dev/null
  "$BIN" wallet --dir "$W/$r" verify --txid "$TX"; echo
done
nc inspect-tx --txid "$TX"; echo
step "done"
