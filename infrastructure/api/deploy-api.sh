#!/usr/bin/env bash
# Builds and (re)starts the Lute API on the VPS from a source tarball (git archive) that the
# developer machine uploads to /opt/zlute/api/src.tgz. Build runs inside node:24 (the VPS host has
# Node 22). Creates secrets on first run only (never overwrites).
# Usage (on the VPS): bash deploy-api.sh <network> <app-origin>
set -euo pipefail

NETWORK="${1:?network (main|test|regtest)}"
ORIGIN="${2:?app origin, e.g. https://lute.example}"
BASE=/opt/zlute/api
KEYS=/opt/zlute/keys
mkdir -p "$BASE" "$KEYS" && chmod 700 "$BASE" "$KEYS"

# --- secrets (created once) ---
[ -f "$BASE/pg_password" ] || { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$BASE/pg_password"; chmod 444 "$BASE/pg_password"; }
[ -f "$KEYS/api.secret" ] || { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$KEYS/api.secret"; chmod 444 "$KEYS/api.secret"; }
if [ ! -f "$BASE/api.env" ]; then
  umask 077
  cat > "$BASE/api.env" <<EOF
LUTE_NETWORK=$NETWORK
DATABASE_URL=postgres://lute:$(cat "$BASE/pg_password")@127.0.0.1:48432/lute
LUTE_DATA_KEY=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
LUTE_SIDECAR_URL=http://127.0.0.1:48100
LUTE_SIDECAR_SECRET_FILE=/run/secrets/sidecar_secret
LUTE_API_HOST=127.0.0.1
LUTE_API_PORT=48200
LUTE_APP_ORIGIN=$ORIGIN
LUTE_SECURE_COOKIES=true
EOF
fi

# --- source + build (inside node:24) ---
rm -rf "$BASE/src.new" && mkdir -p "$BASE/src.new"
tar xzf "$BASE/src.tgz" -C "$BASE/src.new"
docker run --rm --memory 768m --cpus 1 -v "$BASE/src.new:/app" -w /app node:24-bookworm-slim \
  sh -c "corepack enable && pnpm install --frozen-lockfile --filter @lute/api... && pnpm --filter @lute/luteguard build && pnpm --filter @lute/core build && pnpm --filter @lute/api build"
rm -rf "$BASE/src.old"; [ -d "$BASE/src" ] && mv "$BASE/src" "$BASE/src.old"; mv "$BASE/src.new" "$BASE/src"

cd "$BASE/src/infrastructure/api"
docker compose up -d
# The API bind-mounts $BASE/src, which was just replaced: recreate it so it runs the new build.
docker compose up -d --force-recreate --no-deps api
sleep 8
docker ps --filter name=zlute- --format '{{.Names}}\t{{.Status}}'
curl -s http://127.0.0.1:48200/v1/health; echo
