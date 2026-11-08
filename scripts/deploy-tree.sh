#!/usr/bin/env bash
# Assembles the directory the host builds a service from: isoloir at the
# submodule's commit (its Dockerfile builds the binary, bb, the ZKPassport
# verifier), this ledger's setups, and the service's start script.
#
#   scripts/deploy-tree.sh ingest    /path/to/out   # then deploy that directory as the ingest service
#   scripts/deploy-tree.sh authority /path/to/out   # and this one as the scheduled authority
#
# The tree is disposable: build it again after a submodule update or a change
# under ledger/ or deploy/service/. Nothing in it is edited by hand.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ROLE=${1:?ingest|authority}; OUT=${2:?output directory}
case "$ROLE" in ingest|authority) ;; *) echo "role: ingest or authority"; exit 1;; esac
if [ -e "$OUT" ] && [ -n "$(ls -A "$OUT" 2>/dev/null)" ]; then echo "$OUT is not empty: remove it first"; exit 1; fi
mkdir -p "$OUT"
git -C "$ROOT/isoloir" archive --format=tar HEAD | tar -x -C "$OUT"
mkdir -p "$OUT/agora-ledger"
cp "$ROOT/ledger/ledger.json" "$OUT/agora-ledger/"
cp -R "$ROOT/ledger/polls" "$ROOT/ledger/registries" "$OUT/agora-ledger/"
cp "$ROOT/deploy/service/$ROLE-start.sh" "$OUT/start.sh"
cat >> "$OUT/Dockerfile" <<'DOCKER'

# Zcash Agora: the ledger's setups and the service's start script (scripts/deploy-tree.sh).
COPY agora-ledger /app/agora/ledger
COPY start.sh /app/start.sh
CMD ["sh", "/app/start.sh"]
DOCKER
printf '%s\n' target node_modules .git js/node_modules zkverifier/node_modules circuits/build > "$OUT/.dockerignore"
echo "isoloir $(git -C "$ROOT/isoloir" rev-parse --short HEAD) + ledger + $ROLE start script -> $OUT"
