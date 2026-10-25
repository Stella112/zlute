#!/usr/bin/env bash
# Regtest agent evidence: creates (once) the regtest `agent` and `merchant` wallets, funds the agent
# wallet from the fixture funder with an owner-approved payment (disposable regtest key), starts a
# regtest sidecar API on 127.0.0.1:48110, runs apps/api/scripts/agent-regtest.mjs, and has the
# merchant (service) wallet verify the agent's payment with its own keys.
# Usage (on the VPS): bash agent-regtest.sh > /opt/zlute/logs/agent-regtest.log 2>&1
set -uo pipefail

BIN=/opt/zlute/bin/lute-sidecar
OWNER=/opt/zlute/bin/lute-owner
W=/opt/zlute/wallets/regtest
KEY=/opt/zlute/regtest-owner/owner.key
PUB=/opt/zlute/regtest-owner/owner.pub
SECRET=/opt/zlute/regtest-owner/sidecar.secret
SRC=/opt/zlute/api/src
ZAINO=http://127.0.0.1:28137
ZEBRA=http://127.0.0.1:29232
RPC_AUTH="${Z3_RPC_AUTH:-zebra:zebra}"
step() { echo "== $(date -u +%FT%TZ) $*"; }
rpc() {
  curl -sf -u "$RPC_AUTH" -X POST -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"$1\",\"params\":$2,\"id\":1}" "$ZEBRA"
}

step "binaries"; sha256sum "$BIN" "$OWNER"
[ -f "$SECRET" ] || { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$SECRET"; chmod 600 "$SECRET"; }
TIP=$(rpc getblockcount '[]' | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])")
for name in agent merchant; do
  if [ ! -f "$W/$name/wallet.json" ]; then
    step "init regtest $name (birthday $TIP)"
    "$BIN" wallet --dir "$W/$name" init --name "$name" --network regtest --server "$ZAINO" --birthday "$TIP"
  fi
  "$BIN" wallet --dir "$W/$name" sync > /dev/null
done
# Fresh control DB for the agent wallet so mandate and day budgets come only from this run (archived).
for name in agent funder; do
  if [ -f "$W/$name/control.sqlite" ]; then
    mv "$W/$name/control.sqlite" "$W/$name/control-archived-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
    rm -f "$W/$name/control.sqlite-wal" "$W/$name/control.sqlite-shm"
  fi
done

step "fund the agent wallet: 1,000,000 zat from the fixture funder (owner-approved, regtest key)"
"$BIN" wallet --dir "$W/funder" sync > /dev/null
AGENT_ADDR="$("$BIN" wallet --dir "$W/agent" address)"
P="$("$BIN" wallet --dir "$W/funder" propose --to "$AGENT_ADDR" --zat 1000000)"
PID="$(echo "$P" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary']['proposal_id'])")"
SIG="$("$BIN" wallet --dir "$W/funder" show --proposal "$PID" | "$OWNER" sign --key "$KEY" --unattended-regtest 2>/dev/null)"
"$BIN" wallet --dir "$W/funder" approve --proposal "$PID" --signature "$SIG" --owner-pub "$PUB"
"$BIN" wallet --dir "$W/funder" execute --proposal "$PID" --owner-pub "$PUB"
rpc generate '[3]' > /dev/null; sleep 6
"$BIN" wallet --dir "$W/agent" sync > /dev/null
step "agent balance"; "$BIN" wallet --dir "$W/agent" balance

"$BIN" serve --listen 127.0.0.1:48110 --wallets "$W" --network regtest --secret-file "$SECRET" --owner-pub "$PUB" &
SC=$!
trap 'kill $SC 2>/dev/null' EXIT
sleep 2

step "run: API code built from the deployed source in $SRC (host node $(node --version))"
( cd "$SRC/apps/api" && SIDECAR_URL=http://127.0.0.1:48110 SIDECAR_SECRET_FILE="$SECRET" \
  OWNER_BIN="$OWNER" OWNER_KEY="$KEY" ZEBRA_URL="$ZEBRA" ZEBRA_AUTH="$RPC_AUTH" \
  node scripts/agent-regtest.mjs ) | tee /tmp/zlute-agent-run.txt
echo "exit=${PIPESTATUS[0]}"

step "the metered service (merchant wallet) verifies the agent payment with its own keys"
"$BIN" wallet --dir "$W/merchant" sync > /dev/null
T="$(python3 -c "import json; d=[json.loads(l) for l in open('/tmp/zlute-agent-run.txt') if l.startswith('{\"settlement_1\"')]; print(d[-1]['settlement_1'])" 2>/dev/null)"
[ -n "$T" ] && "$BIN" wallet --dir "$W/merchant" verify --txid "$T"
step "done"
