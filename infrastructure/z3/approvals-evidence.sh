#!/usr/bin/env bash
# Approval/caps evidence run on regtest (P1a-07): W8, W12, W13, W14, forged approval, and an
# approved execution that really broadcasts. Uses a DISPOSABLE regtest owner key on the VPS;
# the owner's real key never lives here.
# Usage (on the VPS): bash approvals-evidence.sh > /opt/zlute/logs/approvals.log 2>&1
set -uo pipefail

BIN=/opt/zlute/bin/lute-sidecar
OWNER=/opt/zlute/bin/lute-owner
W=/opt/zlute/wallets/regtest
FUNDER="$W/funder"
KEY=/opt/zlute/regtest-owner/owner.key          # disposable regtest key
PUB=/opt/zlute/regtest-owner/owner.pub
FORGER_KEY=/opt/zlute/regtest-owner/forger.key  # a different key, to test forged approvals
ZEBRA=http://127.0.0.1:29232
RPC_AUTH="${Z3_RPC_AUTH:-zebra:zebra}"          # Z3's public regtest default, local-only

step() { echo "== $(date -u +%FT%TZ) $*"; }
rpc() {
  curl -sf -u "$RPC_AUTH" -X POST -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"$1\",\"params\":$2,\"id\":1}" "$ZEBRA"
}
jget() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }
propose() { "$BIN" wallet --dir "$FUNDER" propose --to "$TO" --zat "$1" ${2:+--memo "$2"}; }
sign() { "$BIN" wallet --dir "$FUNDER" show --proposal "$1" | "$OWNER" sign --key "${2:-$KEY}" --unattended-regtest; }
approve() { "$BIN" wallet --dir "$FUNDER" approve --proposal "$1" --signature "$2" --owner-pub "$PUB"; }
execute() { "$BIN" wallet --dir "$FUNDER" execute --proposal "$1" --owner-pub "$PUB"; }

step "binaries"; sha256sum "$BIN" "$OWNER"
mkdir -p /opt/zlute/regtest-owner && chmod 700 /opt/zlute/regtest-owner
[ -f "$KEY" ] || "$OWNER" init --key "$KEY" > "$PUB" 2>/dev/null
[ -f "$FORGER_KEY" ] || "$OWNER" init --key "$FORGER_KEY" > /dev/null 2>&1
step "regtest owner pubkey: $(cat "$PUB")"

"$BIN" wallet --dir "$FUNDER" sync > /dev/null
"$BIN" wallet --dir "$W/recipient" sync > /dev/null
TO="$("$BIN" wallet --dir "$W/recipient" address)"

step "W14a propose over per-tx cap (2,000,001 zat) -> refused at propose"
propose 2000001; echo "exit=$?"

step "A: propose 1,000,000 zat"
PA_JSON="$(propose 1000000 'LUTE:approvals')"; echo "$PA_JSON"
PA="$(echo "$PA_JSON" | jget '["summary"]["proposal_id"]')"

step "A: execute without approval -> NO_APPROVAL"
execute "$PA"; echo "exit=$?"

step "A: forged approval (different key) -> rejected"
FORGED="$(sign "$PA" "$FORGER_KEY" 2>/dev/null)"
approve "$PA" "$FORGED"; echo "exit=$?"

step "A: owner approval + execute -> submitted"
SIG="$(sign "$PA" 2>/dev/null)"
approve "$PA" "$SIG"; echo "exit=$?"
EXA="$(execute "$PA")"; echo "$EXA"; echo "exit=$?"
TXA="$(echo "$EXA" | jget '["txid"]' 2>/dev/null)"

step "W13 A: execute again with the same approval -> APPROVAL_ALREADY_USED"
execute "$PA"; echo "exit=$?"

step "mine 1 block, verify A at recipient"
rpc generate '[1]' > /dev/null; sleep 5
"$BIN" wallet --dir "$W/recipient" sync > /dev/null
"$BIN" wallet --dir "$W/recipient" verify --txid "$TXA"; echo "exit=$?"
"$BIN" wallet --dir "$FUNDER" sync > /dev/null

step "W8: approve B, then swap B's stored proposal for C's -> HASH_MISMATCH"
PB="$(propose 1500000 | jget '["summary"]["proposal_id"]')"
PC="$(propose 1600000 | jget '["summary"]["proposal_id"]')"
approve "$PB" "$(sign "$PB" 2>/dev/null)" > /dev/null
python3 - "$FUNDER/control.sqlite" "$PB" "$PC" <<'PY'
import sqlite3, sys
db, pb, pc = sys.argv[1:4]
c = sqlite3.connect(db)
blob = c.execute("SELECT proposal FROM proposals WHERE id=?", (pc,)).fetchone()[0]
c.execute("UPDATE proposals SET proposal=? WHERE id=?", (blob, pb))
c.commit()
print("tampered: proposal", pb, "now holds the bytes of", pc)
PY
execute "$PB"; echo "exit=$?"

step "W14b daily cap: 1,000,000 already submitted today; approve 2,000,000 + 2,000,000 + 1"
PD="$(propose 2000000 | jget '["summary"]["proposal_id"]')"; approve "$PD" "$(sign "$PD" 2>/dev/null)" > /dev/null
PE="$(propose 2000000 | jget '["summary"]["proposal_id"]')"; approve "$PE" "$(sign "$PE" 2>/dev/null)" > /dev/null
PF="$(propose 1 | jget '["summary"]["proposal_id"]' 2>/dev/null)"
echo "D:"; execute "$PD"; echo "exit=$?"
rpc generate '[1]' > /dev/null; sleep 5; "$BIN" wallet --dir "$FUNDER" sync > /dev/null
echo "E:"; execute "$PE"; echo "exit=$?"
if [ -n "$PF" ]; then
  approve "$PF" "$(sign "$PF" 2>/dev/null)" > /dev/null
  echo "F (expect OVER_DAILY_CAP):"; execute "$PF"; echo "exit=$?"
else
  echo "F: a 1-zat payment was refused at propose (dust/fee rules); daily cap shown by D/E totals"
fi
rpc generate '[1]' > /dev/null

step "W12: propose G, approve, wait past the 300 s TTL, execute -> PROPOSAL_EXPIRED"
PG="$(propose 1000 | jget '["summary"]["proposal_id"]')"
approve "$PG" "$(sign "$PG" 2>/dev/null)"; echo "exit=$?"
sleep 305
execute "$PG"; echo "exit=$?"

step "done"
