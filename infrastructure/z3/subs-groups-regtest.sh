#!/usr/bin/env bash
# Regtest evidence for subscriptions and groups: starts a regtest sidecar API on 127.0.0.1:48110,
# runs apps/api/scripts/subs-groups-regtest.mjs (payer = fixture funder), then the merchant wallet
# verifies the payments with its own keys.
# Usage (on the VPS): bash subs-groups-regtest.sh > /opt/zlute/logs/subs-groups-regtest.log 2>&1
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
if [ -f "$W/funder/control.sqlite" ]; then
  mv "$W/funder/control.sqlite" "$W/funder/control-archived-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
  rm -f "$W/funder/control.sqlite-wal" "$W/funder/control.sqlite-shm"
fi
for name in funder merchant; do "$BIN" wallet --dir "$W/$name" sync > /dev/null; done

"$BIN" serve --listen 127.0.0.1:48110 --wallets "$W" --network regtest --secret-file "$SECRET" --owner-pub "$PUB" &
SC=$!
trap 'kill $SC 2>/dev/null' EXIT
sleep 2

step "run: API code built from the deployed source in $SRC (host node $(node --version))"
( cd "$SRC/apps/api" && SIDECAR_URL=http://127.0.0.1:48110 SIDECAR_SECRET_FILE="$SECRET" \
  OWNER_BIN="$OWNER" OWNER_KEY="$KEY" ZEBRA_URL="$ZEBRA" ZEBRA_AUTH="$RPC_AUTH" \
  node scripts/subs-groups-regtest.mjs ) | tee /tmp/zlute-subs-run.txt
echo "exit=${PIPESTATUS[0]}"

step "merchant wallet verifies each payment with its own keys"
"$BIN" wallet --dir "$W/merchant" sync > /dev/null
for t in $(python3 -c "import json; d=[json.loads(l) for l in open('/tmp/zlute-subs-run.txt') if l.startswith('{\"subscription_period_1\"')][-1]; print(*d.values())" 2>/dev/null); do
  "$BIN" wallet --dir "$W/merchant" verify --txid "$t"
done
step "done"
