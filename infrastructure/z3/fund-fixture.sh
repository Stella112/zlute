#!/usr/bin/env bash
# Regtest FIXTURE funding (docs/DECISIONS.md D-007, docs/CAPABILITIES.md C-018).
# Mines Zebra coinbase to a Lute-controlled "funder" wallet's shielded UA. From NU6.3 the Orchard
# receiver's coinbase lands in the Ironwood pool. These funds are test fixtures, never Lute payments.
#
# Usage (on the VPS): bash fund-fixture.sh [blocks]   (default 110: coinbase matures after 100)
set -euo pipefail

BLOCKS="${1:-110}"
BIN=/opt/zlute/bin/lute-sidecar
Z3=/opt/zlute/z3
WALLETS=/opt/zlute/wallets/regtest
FUNDER="$WALLETS/funder"
ZAINO=http://127.0.0.1:28137
ZEBRA=http://127.0.0.1:29232

rpc() {
  curl -sf -u zebra:zebra -X POST -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"$1\",\"params\":$2,\"id\":1}" "$ZEBRA"
}

mkdir -p "$WALLETS" && chmod 700 /opt/zlute/wallets "$WALLETS"

if [ ! -f "$FUNDER/wallet.json" ]; then
  "$BIN" wallet --dir "$FUNDER" init --name funder --network regtest --server "$ZAINO" --birthday 1
fi
# The wallet DB must know the chain tip before it can expose an address.
"$BIN" wallet --dir "$FUNDER" sync >/dev/null
ADDR="$("$BIN" wallet --dir "$FUNDER" address)"
echo "funder UA: ${ADDR:0:24}..."

ENV="$Z3/.env.regtest"
if ! grep -q "^ZEBRA_MINING__MINER_ADDRESS=$ADDR\$" "$ENV"; then
  sed -i "s|^ZEBRA_MINING__MINER_ADDRESS=.*|ZEBRA_MINING__MINER_ADDRESS=$ADDR|" "$ENV"
  (cd "$Z3" && docker compose --env-file .env.regtest up -d zebra >/dev/null 2>&1)
  until rpc getblockchaininfo '[]' >/dev/null; do sleep 2; done
fi

echo "mining $BLOCKS blocks..."
rpc generate "[$BLOCKS]" >/dev/null
rpc getblockchaininfo '[]' | python3 -c 'import sys,json; print("height", json.load(sys.stdin)["result"]["blocks"])'

sleep 5   # let Zaino index the new blocks
"$BIN" wallet --dir "$FUNDER" sync
