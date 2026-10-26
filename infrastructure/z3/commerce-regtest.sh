#!/usr/bin/env bash
# Regtest commerce evidence: starts a regtest sidecar API on 127.0.0.1:48110, runs
# apps/api/scripts/commerce-regtest.mjs (customer = fixture funder; refund to `recipient`), then the
# merchant wallet verifies the payment and the recipient wallet verifies the refund with their keys.
# Usage (on the VPS): bash commerce-regtest.sh > /opt/zlute/logs/commerce-regtest.log 2>&1
set -uo pipefail

BIN=/opt/zlute/bin/lute-sidecar
OWNER=/opt/zlute/bin/lute-owner
W=/opt/zlute/wallets/regtest
KEY=/opt/zlute/regtest-owner/owner.key
PUB=/opt/zlute/regtest-owner/owner.pub
SECRET=/opt/zlute/regtest-owner/sidecar.secret
SRC=/opt/zlute/api/src
ZEBRA=http://127.0.0.1:29232
RPC_AUTH="${Z3_RPC_AUTH:-zebra:zebra}"
step() { echo "== $(date -u +%FT%TZ) $*"; }

step "binaries"; sha256sum "$BIN" "$OWNER"
for name in funder merchant recipient; do
  if [ -f "$W/$name/control.sqlite" ]; then
    mv "$W/$name/control.sqlite" "$W/$name/control-archived-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
    rm -f "$W/$name/control.sqlite-wal" "$W/$name/control.sqlite-shm"
  fi
  "$BIN" wallet --dir "$W/$name" sync > /dev/null
done
REFUND_TO="$("$BIN" wallet --dir "$W/recipient" address)"

"$BIN" serve --listen 127.0.0.1:48110 --wallets "$W" --network regtest --secret-file "$SECRET" --owner-pub "$PUB" &
SC=$!
trap 'kill $SC 2>/dev/null' EXIT
sleep 2

step "run: API code built from the deployed source in $SRC (host node $(node --version))"
( cd "$SRC/apps/api" && SIDECAR_URL=http://127.0.0.1:48110 SIDECAR_SECRET_FILE="$SECRET" \
  OWNER_BIN="$OWNER" OWNER_KEY="$KEY" ZEBRA_URL="$ZEBRA" ZEBRA_AUTH="$RPC_AUTH" REFUND_TO="$REFUND_TO" \
  node scripts/commerce-regtest.mjs ) | tee /tmp/zlute-commerce-run.txt
echo "exit=${PIPESTATUS[0]}"

TX="$(python3 -c "import json; d=[json.loads(l) for l in open('/tmp/zlute-commerce-run.txt') if l.startswith('{\"payment\"')]; print(d[-1]['payment'], d[-1]['refund'])" 2>/dev/null)"
set -- $TX
step "merchant wallet verifies the customer payment"
"$BIN" wallet --dir "$W/merchant" sync > /dev/null; [ -n "${1:-}" ] && "$BIN" wallet --dir "$W/merchant" verify --txid "$1"
step "recipient wallet verifies the refund"
"$BIN" wallet --dir "$W/recipient" sync > /dev/null; [ -n "${2:-}" ] && "$BIN" wallet --dir "$W/recipient" verify --txid "$2"
step "done"
