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
# The verification keys: a folder. Without CIRCUITS, the mirror's keys are downloaded
# (the auditor checks each against the hash its poll names).
if [ -z "${CIRCUITS:-}" ]; then
  CIRCUITS=$(mktemp -d)
  python3 - "$CONFIG" "$MIRROR" "$CIRCUITS" <<'PY'
import json, os, sys, urllib.request
cfg, mirror, out = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
m = cfg["mirror"]
tree = json.load(urllib.request.urlopen("https://api.github.com/repos/%s/git/trees/%s?recursive=1" % (m["repo"], m["branch"])))
for f in tree["tree"]:
    p = f["path"].split("/")
    if len(p) == 3 and p[0] == "circuits" and p[2] == "vk":
        os.makedirs(os.path.join(out, p[1]), exist_ok=True)
        open(os.path.join(out, p[1], "vk"), "wb").write(urllib.request.urlopen("%s/%s" % (mirror, f["path"])).read())
PY
fi
cd "$ROOT/isoloir/zkverifier" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null
exec "$ISOLOIR" audit --mirror "$MIRROR" --log-key "$LOG_KEY" --circuits "$CIRCUITS" \
  --zkverifier "$ROOT/isoloir/zkverifier/verify.mjs" --bitcoin "$@"
