#!/usr/bin/env bash
# Deploys CI-built binaries to the VPS (D-006) without moving them through the developer's
# (slow, unreliable) connection:
#   1. find the successful wallet-sidecar run for COMMIT and the latest successful lute-owner run;
#   2. ask GitHub (with the local token) for each artifact's short-lived signed download URL;
#   3. the VPS downloads from that URL itself and checks the zip's sha256 against GitHub's
#      published artifact digest before swapping the binary in.
# No GitHub token ever goes to the VPS; the signed URL grants that one artifact for ~1 minute.
# Usage: bash infrastructure/deploy-from-ci.sh [commit]
set -uo pipefail

REPO=Stella112/zlute
HOST=hbar-vps
# gh run list --commit needs the full SHA.
COMMIT="$(git rev-parse "${1:-HEAD}^{commit}")" || { echo "[deploy] unknown commit"; exit 1; }

log() { echo "[deploy] $*"; }

id=""; s=""
for _ in $(seq 1 120); do
  id=$(gh run list -R "$REPO" --commit "$COMMIT" --workflow sidecar.yml --json databaseId --jq '.[0].databaseId' 2>/dev/null)
  [ -n "$id" ] || { log "no wallet-sidecar run for $COMMIT (did the commit touch the sidecar?)"; exit 1; }
  s=$(gh run view "$id" -R "$REPO" --json status,conclusion --jq '"\(.status) \(.conclusion)"' 2>/dev/null)
  case "$s" in completed*) break ;; esac
  sleep 20
done
log "sidecar run $id: $s"
case "$s" in *success) ;; *) log "CI not green; aborting"; exit 1 ;; esac
owner_id=$(gh run list -R "$REPO" --workflow owner-tool.yml --status success --limit 1 --json databaseId --jq '.[0].databaseId')

# run name -> "artifact_id digest"
artifact() {
  gh api "repos/$REPO/actions/runs/$1/artifacts" --jq ".artifacts[] | select(.name==\"$2\") | \"\(.id) \(.digest)\""
}

install_one() { # run artifact-name binary-name
  local aid digest url
  read -r aid digest < <(artifact "$1" "$2")
  [ -n "$aid" ] || { log "artifact $2 not found"; return 1; }
  digest="${digest#sha256:}"
  for i in 1 2 3 4 5; do
    url=$(curl -s -o /dev/null -w '%{redirect_url}' -H "Authorization: Bearer $(gh auth token)" \
      "https://api.github.com/repos/$REPO/actions/artifacts/$aid/zip")
    [ -n "$url" ] || { sleep 10; continue; }
    if timeout 120 ssh -o BatchMode=yes -o ConnectTimeout=20 "$HOST" bash -s -- "$3" "$digest" <<EOF
set -euo pipefail
d=\$(mktemp -d); trap 'rm -rf "\$d"' EXIT
curl -sfL --max-time 90 '$url' -o "\$d/a.zip"
got=\$(sha256sum "\$d/a.zip" | cut -d' ' -f1)
[ "\$got" = "\$2" ] || { echo "digest mismatch for \$1"; exit 3; }
python3 -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); open(sys.argv[2],'wb').write(z.read(sys.argv[3]))" "\$d/a.zip" "/opt/zlute/bin/\$1.new" "\$1"
chmod 755 "/opt/zlute/bin/\$1.new" && mv -f "/opt/zlute/bin/\$1.new" "/opt/zlute/bin/\$1"
echo "\$1 installed: zip sha256 \$got, binary sha256 \$(sha256sum /opt/zlute/bin/\$1 | cut -d' ' -f1)"
EOF
    then return 0; fi
    sleep 10
  done
  return 1
}

install_one "$id" lute-sidecar-x86_64-linux-gnu lute-sidecar || { log "sidecar install failed"; exit 1; }
install_one "$owner_id" lute-owner-ubuntu-24.04 lute-owner || { log "owner install failed"; exit 1; }
timeout 60 ssh -o BatchMode=yes "$HOST" '/opt/zlute/bin/lute-sidecar --version && /opt/zlute/bin/lute-owner --version'
log "done ($COMMIT)"
