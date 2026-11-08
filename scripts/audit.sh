#!/usr/bin/env bash
# Recounts the Zcash Agora ledger from its public mirror: every checkpoint
# signature, every registration (passport proof included), every ballot
# proof, the tally's openings and
# the Bitcoin timestamps. Exit 0 and no PROBLEM line is a clean recount.
#
#   scripts/audit.sh                      # circuits: the mirror's (fine for a first look)
#   CIRCUITS=./my-circuits scripts/audit.sh   # circuits you built yourself (isoloir circuits ...), the real check
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ISOLOIR=${ISOLOIR:-$ROOT/isoloir/target/release/isoloir}
CONFIG=$ROOT/site/agora.config.json
MIRROR=${MIRROR:-$(python3 -c 'import json,sys;c=json.load(open(sys.argv[1]));print("https://cdn.jsdelivr.net/gh/%s@%s"%(c["mirror"]["repo"],c["mirror"]["branch"]))' "$CONFIG")}
LOG_KEY=${LOG_KEY:-$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["verifierKey"])' "$CONFIG")}
[ -n "$LOG_KEY" ] || { echo "no verifierKey in $CONFIG yet (the ledger has no genesis)"; exit 1; }
cd "$ROOT/isoloir/zkverifier" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null
exec "$ISOLOIR" audit --mirror "$MIRROR" --log-key "$LOG_KEY" ${CIRCUITS:+--circuits "$CIRCUITS"} \
  --zkverifier "$ROOT/isoloir/zkverifier/verify.mjs" --bitcoin "$@"
