#!/usr/bin/env bash
# Regtest stream evidence: starts a regtest sidecar API on 127.0.0.1:48110 (its own HMAC secret,
# the disposable regtest owner key), runs apps/api/scripts/streams-regtest.mjs against it, then
# verifies both settlements at the recipient with the recipient wallet's own keys.
# Usage (on the VPS): bash streams-regtest.sh > /opt/zlute/logs/streams-regtest.log 2>&1
set -uo pipefail

BIN=/opt/zlute/bin/lute-sidecar
W=/opt/zlute/wallets/regtest
SECRET=/opt/zlute/regtest-owner/sidecar.secret
SRC=/opt/zlute/api/src
step() { echo "== $(date -u +%FT%TZ) $*"; }

step "binaries"; sha256sum "$BIN" /opt/zlute/bin/lute-owner
[ -f "$SECRET" ] || { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$SECRET"; chmod 600 "$SECRET"; }
# Fresh control DB for the funder so today's cap usage comes only from this run (archived, not deleted).
if [ -f "$W/funder/control.sqlite" ]; then
  mv "$W/funder/control.sqlite" "$W/funder/control-archived-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
  rm -f "$W/funder/control.sqlite-wal" "$W/funder/control.sqlite-shm"
fi
"$BIN" wallet --dir "$W/funder" sync > /dev/null
"$BIN" wallet --dir "$W/recipient" sync > /dev/null
RECIPIENT="$("$BIN" wallet --dir "$W/recipient" address)"

"$BIN" serve --listen 127.0.0.1:48110 --wallets "$W" --network regtest --secret-file "$SECRET" --owner-pub /opt/zlute/regtest-owner/owner.pub &
SC=$!
trap 'kill $SC 2>/dev/null' EXIT
sleep 2

step "run: API code built from the deployed source in $SRC (host node $(node --version))"
( cd "$SRC/apps/api" && SIDECAR_URL=http://127.0.0.1:48110 SIDECAR_SECRET_FILE="$SECRET"   OWNER_BIN=/opt/zlute/bin/lute-owner OWNER_KEY=/opt/zlute/regtest-owner/owner.key   RECIPIENT="$RECIPIENT" ZEBRA_URL=http://127.0.0.1:29232 ZEBRA_AUTH="${Z3_RPC_AUTH:-zebra:zebra}"   node scripts/streams-regtest.mjs ) | tee /tmp/zlute-streams-run.txt
RC=${PIPESTATUS[0]}
echo "exit=$RC"

step "recipient verifies each settlement with its own keys"
"$BIN" wallet --dir "$W/recipient" sync > /dev/null
for t in $(python3 -c "import json,sys; d=[json.loads(l) for l in open('/tmp/zlute-streams-run.txt') if l.startswith('{\"settlement_1\"')]; print(d[-1]['settlement_1'], d[-1]['settlement_2'])" 2>/dev/null); do
  "$BIN" wallet --dir "$W/recipient" verify --txid "$t"
done
step "done"
