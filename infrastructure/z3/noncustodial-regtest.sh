#!/usr/bin/env bash
# Non-custodial (browser-signed) payout on regtest, end to end with the real sidecar and Zaino.
# The wallet is created from a viewing key only; its seed is a disposable regtest seed that plays
# the browser's role through `lute-sidecar signer` (the same Rust code the browser runs as
# WebAssembly). Checks: no seed on the server, custodial execute refused, a tampered expectation
# is not signed, no approval / bad signature / replay refused, the real payment is delivered in
# a single shielded pool.
# Usage (on the VPS): bash noncustodial-regtest.sh > /opt/zlute/logs/noncustodial-regtest.log 2>&1
set -uo pipefail

BIN=/opt/zlute/bin/lute-sidecar
OWNER=/opt/zlute/bin/lute-owner
W=/opt/zlute/wallets/regtest
FUNDER="$W/funder"
NC="$W/nc-payout"
KEY=/opt/zlute/regtest-owner/owner.key          # disposable regtest approval key
PUB=/opt/zlute/regtest-owner/owner.pub
SEED=/opt/zlute/regtest-owner/nc-seed.hex       # disposable regtest seed (the "browser")
RUN=/opt/zlute/regtest-owner/nc-run
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
mkdir -p /opt/zlute/regtest-owner "$RUN" && chmod 700 /opt/zlute/regtest-owner "$RUN"
[ -f "$KEY" ] || "$OWNER" init --key "$KEY" > "$PUB" 2>/dev/null
if [ -d "$NC" ]; then
  mv "$NC" "$W/nc-payout-archived-$(date -u +%Y%m%dT%H%M%SZ)"; step "archived previous nc-payout wallet"
fi
head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$SEED"; chmod 600 "$SEED"

step "browser side: derive the viewing key (account 1 = payout)"
UFVK="$("$BIN" signer derive-ufvk --seed-file "$SEED" --network regtest --account 1)"; echo "ufvk prefix: ${UFVK:0:20}…"
"$BIN" signer derive-ufvk --seed-file "$SEED" --network main --account 1; echo "mainnet refused: exit=$?"

step "server side: create the wallet from the viewing key only"
nc init-view-only --name nc-payout --network regtest --server "$ZAINO" --ufvk "$UFVK"; echo "exit=$?"
step "no seed or key file in the wallet directory"; ls -la "$NC"; ls "$NC" | grep -E 'seed|kek' && echo "SEED FOUND (fail)" || echo "no seed files: ok"

step "fund the non-custodial wallet with 1,000,000 zat from the fixture"
"$BIN" wallet --dir "$FUNDER" sync > /dev/null
NCADDR="$(nc address)"
"$BIN" wallet --dir "$FUNDER" send --to "$NCADDR" --zat 1000000 --memo "LUTE:ncfund"; echo "exit=$?"
rpc generate '[2]' > /dev/null; sleep 6
nc sync; echo

"$BIN" wallet --dir "$W/recipient" sync > /dev/null
TO="$("$BIN" wallet --dir "$W/recipient" address)"

step "propose 300,000 zat (policy-checked, nothing signed)"
P_JSON="$(nc propose --to "$TO" --zat 300000 --memo 'LUTE:noncustodial')"; echo "$P_JSON"
P="$(echo "$P_JSON" | jget '["summary"]["proposal_id"]')"

step "custodial execute is refused for this wallet (Lute holds no spending key)"
nc execute --proposal "$P" --owner-pub "$PUB"; echo "exit=$?"

step "prepare the unsigned, proved transaction (PCZT)"
nc prepare-pczt --proposal "$P" > "$RUN/view.json"; echo "exit=$? bytes=$(wc -c < "$RUN/view.json")"

step "browser refuses a transaction that does not match what the user approved (amount + 1)"
python3 - "$RUN/view.json" "$RUN/view-tampered.json" <<'PY'
import json, sys
v = json.load(open(sys.argv[1])); v["summary"]["amount_zat"] += 1; json.dump(v, open(sys.argv[2], "w"))
PY
"$BIN" signer sign-pczt --seed-file "$SEED" --network regtest --account 1 --view "$RUN/view-tampered.json"; echo "exit=$?"

step "browser refuses with the wrong wallet account (0 = merchant)"
"$BIN" signer sign-pczt --seed-file "$SEED" --network regtest --account 0 --view "$RUN/view.json"; echo "exit=$?"

step "browser signs (account 1)"
SIGS="$("$BIN" signer sign-pczt --seed-file "$SEED" --network regtest --account 1 --view "$RUN/view.json")"; echo "$SIGS"

step "execute-signed without the owner's approval -> NO_APPROVAL"
nc execute-signed --proposal "$P" --sigs "$SIGS" --owner-pub "$PUB"; echo "exit=$?"

step "owner approval (Ed25519 over the proposal hash)"
APPROVAL="$(nc show --proposal "$P" | "$OWNER" sign --key "$KEY" --unattended-regtest 2>/dev/null)"
nc approve --proposal "$P" --signature "$APPROVAL" --owner-pub "$PUB"; echo "exit=$?"

step "a corrupted spend signature -> BAD_SPEND_SIGNATURE, approval not consumed"
BAD="$(echo "$SIGS" | python3 -c "import sys,json; s=json.load(sys.stdin); x=s[0]['sig']; s[0]['sig']=('0' if x[0]!='0' else '1')+x[1:]; print(json.dumps(s))")"
nc execute-signed --proposal "$P" --sigs "$BAD" --owner-pub "$PUB"; echo "exit=$?"

step "execute-signed with the browser's signatures -> submitted"
EX="$(nc execute-signed --proposal "$P" --sigs "$SIGS" --owner-pub "$PUB")"; echo "$EX"; echo "exit=$?"
TX="$(echo "$EX" | jget '["txid"]' 2>/dev/null)"

step "replay -> APPROVAL_ALREADY_USED"
nc execute-signed --proposal "$P" --sigs "$SIGS" --owner-pub "$PUB"; echo "exit=$?"

step "mine 1 block; recipient verifies; on-chain structure"
rpc generate '[1]' > /dev/null; sleep 6
"$BIN" wallet --dir "$W/recipient" sync > /dev/null
"$BIN" wallet --dir "$W/recipient" verify --txid "$TX"; echo "exit=$?"
nc inspect-tx --txid "$TX"; echo "exit=$?"
nc sync; echo
step "done"
