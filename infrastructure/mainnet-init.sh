#!/usr/bin/env bash
# Creates Lute's mainnet hot wallets on the VPS (P1b). New wallets only: no seed is imported and
# no funds move (funding is an owner action, mandate §8). Each wallet has its own directory,
# its own sealed seed (seed.enc) and its own key file under /opt/zlute/keys (0400), §10.5.
# Usage (on the VPS): bash mainnet-init.sh > /opt/zlute/logs/mainnet-init.log 2>&1
set -euo pipefail

BIN=/opt/zlute/bin/lute-sidecar
SERVER=https://zec.rocks:443
ROOT=/opt/zlute/wallets/main
KEYS=/opt/zlute/keys

step() { echo "== $(date -u +%FT%TZ) $*"; }

step "binary"; sha256sum "$BIN"
step "light server"; "$BIN" server-info "$SERVER"

mkdir -p "$ROOT" "$KEYS"
chmod 700 /opt/zlute/wallets "$ROOT" "$KEYS"

for name in merchant payout agent; do
  if [ -f "$ROOT/$name/wallet.json" ]; then
    step "$name exists; skipping init"
  else
    step "init $name"
    "$BIN" wallet --dir "$ROOT/$name" init --name "$name" --network main --server "$SERVER" --kek "$KEYS/main-$name.kek"
  fi
  step "sync $name"; "$BIN" wallet --dir "$ROOT/$name" sync
done
step "key files"; ls -l "$KEYS"
step "done"
