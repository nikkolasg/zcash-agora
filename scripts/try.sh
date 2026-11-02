#!/usr/bin/env bash
# Try Zcash Agora on this machine, passport-free: the whole ledger runs
# locally with isoloir's *dev* registry (type any identifier instead of
# scanning), the site is served with the real voting page, and the poll
# closes after CLOSE_IN seconds (default 20 minutes), after which the result
# appears on the vote page.
#
# Safety: a dev registry is refused by any ingest not started with --dev,
# and the production registry (ledger/registries/1.json) is ZKPassport. This
# script never touches the production setups or site/agora.config.json.
#
#   scripts/try.sh                 # then open http://localhost:5173/
#   CLOSE_IN=300 scripts/try.sh    # a five-minute poll
#
# Needs: Rust, Postgres on localhost, node 22, nargo 1.0.0-beta.22
# (~/.nargo/bin), and bb 5.0.0 (installed with isoloir/js's dependencies).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export PATH="$HOME/.nargo/bin:$PATH"
export CLOSE_IN=${CLOSE_IN:-1200}
arch=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/'); os=$(uname | tr A-Z a-z | sed 's/darwin/macos/')
export ISOLOIR_BB=${ISOLOIR_BB:-$ROOT/isoloir/js/node_modules/@aztec/bb.js/build/$arch-$os/bb}

command -v nargo >/dev/null || { echo "nargo 1.0.0-beta.22 is needed: noirup -v 1.0.0-beta.22"; exit 1; }
pg_isready -q || { echo "Postgres is not running (brew services start postgresql@17)"; exit 1; }
[ -x "$ROOT/isoloir/target/release/isoloir" ] || (cd "$ROOT/isoloir" && cargo build --release -p isoloir)
[ -d "$ROOT/isoloir/js/dist" ] || (cd "$ROOT/isoloir/js" && npm install --no-audit --no-fund && npm run wasm:web && npm run build)
[ -x "$ISOLOIR_BB" ] || { chmod +x "$ISOLOIR_BB" 2>/dev/null || { echo "bb not found at $ISOLOIR_BB"; exit 1; }; }
[ -d "$ROOT/site/app/node_modules" ] || (cd "$ROOT/site/app" && npm install --no-audit --no-fund)
python3 "$ROOT/site/build-pages.py" >/dev/null

cleanup() { kill $(jobs -p) 2>/dev/null || true; pkill -f "vite --mode trial" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# The static pages on 8788; the voting page (dev server, trial mode) on 5173 proxies everything else to them.
(cd "$ROOT/site" && python3 -m http.server 8788 --bind 127.0.0.1 >/dev/null 2>&1) &
rm -f "$ROOT/site/app/.env.trial"
SERVE=1 "$ROOT/scripts/trial.sh" 2>&1 | grep --line-buffered -v isoloir_relay &
until [ -f "$ROOT/site/app/.env.trial" ]; do sleep 2; done
(cd "$ROOT/site/app" && npx vite --mode trial --port 5173 --strictPort >/dev/null 2>&1) &
until curl -s -o /dev/null http://localhost:5173/vote/; do sleep 1; done
echo
echo "==> Zcash Agora, test mode: http://localhost:5173/  (vote: http://localhost:5173/vote/)"
echo "    Register with any identifier (no passport), vote; the poll closes in $CLOSE_IN s and the result appears."
echo "    Ctrl-C stops everything."
[ -z "${NO_OPEN:-}" ] && command -v open >/dev/null && open http://localhost:5173/ || true
wait
