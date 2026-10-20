#!/usr/bin/env bash
# Deploys CI-built binaries to the VPS (docs/DECISIONS.md D-006). Run on the developer machine.
# Waits for the wallet-sidecar run of COMMIT (default HEAD) to succeed, downloads the sidecar
# artifact and the latest successful lute-owner Linux artifact, uploads both with sha256
# verification and retries (the owner's network is unreliable), then swaps them in atomically.
# Usage: bash infrastructure/deploy-from-ci.sh [commit]
set -uo pipefail

REPO=Stella112/zlute
HOST=hbar-vps
COMMIT="${1:-$(git rev-parse HEAD)}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log() { echo "[deploy] $*"; }

id=""
for _ in $(seq 1 120); do
  id=$(gh run list -R "$REPO" --commit "$COMMIT" --workflow sidecar.yml --json databaseId --jq '.[0].databaseId' 2>/dev/null)
  s=$(gh run view "$id" -R "$REPO" --json status,conclusion --jq '"\(.status) \(.conclusion)"' 2>/dev/null)
  case "$s" in completed*) break ;; esac
  sleep 20
done
log "sidecar run $id: $s"
case "$s" in *success) ;; *) log "CI not green; aborting"; exit 1 ;; esac
owner_id=$(gh run list -R "$REPO" --workflow owner-tool.yml --status success --limit 1 --json databaseId --jq '.[0].databaseId')
log "owner-tool run $owner_id"

download() { # run artifact dir
  for _ in 1 2 3 4 5; do
    rm -rf "$3"
    timeout 300 gh run download "$1" -R "$REPO" -n "$2" -D "$3" >/dev/null 2>&1 && return 0
    sleep 15
  done
  return 1
}
download "$id" lute-sidecar-x86_64-linux-gnu "$WORK/s" || { log "sidecar download failed"; exit 1; }
download "$owner_id" lute-owner-ubuntu-24.04 "$WORK/o" || { log "owner download failed"; exit 1; }

upload() { # local-file remote-name
  local want got
  want=$(sha256sum "$1" | cut -d' ' -f1)
  for i in 1 2 3 4 5 6; do
    if timeout 300 scp -q -o ConnectTimeout=20 "$1" "$HOST:/opt/zlute/bin/$2.new" &&
       got=$(timeout 60 ssh -o BatchMode=yes "$HOST" "sha256sum /opt/zlute/bin/$2.new" | cut -d' ' -f1) &&
       [ "$got" = "$want" ]; then
      log "$2 uploaded (attempt $i) sha256 $want"
      return 0
    fi
    sleep 15
  done
  return 1
}
upload "$WORK/s/lute-sidecar" lute-sidecar || { log "sidecar upload failed"; exit 1; }
upload "$WORK/o/lute-owner" lute-owner || { log "owner upload failed"; exit 1; }

timeout 60 ssh -o BatchMode=yes "$HOST" 'cd /opt/zlute/bin && for b in lute-sidecar lute-owner; do chmod 755 $b.new && mv -f $b.new $b; done && ./lute-sidecar --version && ./lute-owner --version'
log "done ($COMMIT)"
