#!/usr/bin/env bash
# Sets up Z3 regtest for Lute on the shared VPS (P1a-03). Idempotent for the clone/config steps.
# Usage (on the VPS, as root): bash setup-vps.sh /path/to/docker-compose.zlute.yml
set -euo pipefail

Z3_COMMIT="e84ce9f"          # ZcashFoundation/z3 main, 2026-08-10 (read 2026-10-20)
ROOT="/opt/zlute"
Z3_DIR="$ROOT/z3"
OVERLAY_SRC="${1:?path to docker-compose.zlute.yml}"

mkdir -p "$ROOT"
if [ ! -d "$Z3_DIR/.git" ]; then
  git clone -q https://github.com/ZcashFoundation/z3.git "$Z3_DIR"
fi
git -C "$Z3_DIR" fetch -q origin
git -C "$Z3_DIR" -c advice.detachedHead=false checkout -q "$Z3_COMMIT"

cp "$OVERLAY_SRC" "$Z3_DIR/docker-compose.zlute.yml"

ENV="$Z3_DIR/.env.regtest"
# Lute-specific project name (volumes become zlute-z3_*) and our overlay last in the merge order.
sed -i 's/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME=zlute-z3/' "$ENV"
sed -i 's/^COMPOSE_FILE=.*/COMPOSE_FILE=docker-compose.yml:docker-compose.regtest.yml:docker-compose.zlute.yml/' "$ENV"

grep -E '^(COMPOSE_PROJECT_NAME|COMPOSE_FILE)=' "$ENV"
echo "Prepared $Z3_DIR at $(git -C "$Z3_DIR" rev-parse --short HEAD). Next: (cd $Z3_DIR && ./scripts/regtest-init.sh)"
