#!/usr/bin/env bash
# A complete local trial of the Zcash Agora poll with isoloir's dev passport
# provider: a relay, an ingest, the registry and a short time-locked poll,
# three voters, the drand opening after the close, and the audit.
#
# Needs: Postgres on localhost, the isoloir binary, nargo 1.0.0-beta.22, bb
# 5.0.0 (ISOLOIR_BB), node. Run from the repository root:
#   scripts/trial.sh            # ~3 minutes; the poll closes 90 s after it opens
#   SERVE=1 scripts/trial.sh    # also serves the mirror on :8787 for site/app (npm run dev -- --mode trial)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ISOLOIR=${ISOLOIR:-$ROOT/isoloir/target/release/isoloir}
TRIAL=${TRIAL:-$ROOT/trial}
DB=${DATABASE_URL:-postgresql://localhost/agora_trial}
CLOSE_IN=${CLOSE_IN:-90}
: "${ISOLOIR_BB:?path to bb 5.0.0}"
command -v nargo >/dev/null || { echo "nargo not on PATH (~/.nargo/bin)"; exit 1; }

rm -rf "$TRIAL"; mkdir -p "$TRIAL/mirror"
dropdb --if-exists "${DB##*/}" >/dev/null 2>&1 || true; createdb "${DB##*/}"
cd "$ROOT/isoloir"   # circuits are built from the isoloir repository root

cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT

"$ISOLOIR" relay --listen 127.0.0.1:7777 >"$TRIAL/relay.log" 2>&1 &
sleep 1

eval "$("$ISOLOIR" keygen log --origin trial.local/agora | sed -n 's/^ISOLOIR_LOG_SEED=\(.*\)/export ISOLOIR_LOG_SEED=\1/p; s/^log_key: \(.*\)/export LOG_KEY=\1/p')"
eval "$("$ISOLOIR" keygen nostr | sed -n 's/^ISOLOIR_NOSTR_KEY=\(.*\)/export ISOLOIR_NOSTR_KEY=\1/p; s/^ingest: \(.*\)/export INGEST_PUB=\1/p')"
[ -n "${LOG_KEY:-}" ] && [ -n "${INGEST_PUB:-}" ] || { echo "keygen output changed; see $ISOLOIR keygen"; exit 1; }
export DATABASE_URL=$DB

"$ISOLOIR" circuits choice4_tlock_linked_d20 --mirror "$TRIAL/mirror" | tee "$TRIAL/circuits.txt"
VK=$(awk '/choice4_tlock_linked_d20/ {print $2}' "$TRIAL/circuits.txt")

NOW=$(date +%s); OPENS=$NOW; CLOSES=$((NOW + CLOSE_IN)); ROUND=$("$ROOT/ledger/round.sh" "$CLOSES")
cat >"$TRIAL/ledger.json" <<J
{"v":1,"version":1,"origin":"trial.local/agora","log_key":"$LOG_KEY","ingest":"$INGEST_PUB",
 "channels":[{"type":"nostr","url":"ws://127.0.0.1:7777","state":"active"},{"type":"direct","url":"http://127.0.0.1:8080","state":"active"}],
 "checkpoint_period":5,"anchor_age":86400}
J
cat >"$TRIAL/registry.json" <<J
{"v":1,"id":1,"version":1,"name":"Zcash Agora trial (dev provider)",
 "eligibility":{"provider":"dev","domain":"trial.local","scope":"agora/registry/1"},"validity":3600,"depth":20}
J
# The real poll's shape (ledger/polls/1.json) with trial dates and the real quicknet chain.
python3 - "$ROOT/ledger/polls/1.json" "$TRIAL/poll.json" "$OPENS" "$CLOSES" "$ROUND" "$VK" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))
p["opens"], p["closes"] = int(sys.argv[3]), int(sys.argv[4])
p["encryption"]["round"] = int(sys.argv[5]); p["circuit"]["vk_hash"] = sys.argv[6]
json.dump(p, open(sys.argv[2], "w"))
PY
"$ISOLOIR" check ledger "$TRIAL/ledger.json" >/dev/null
"$ISOLOIR" check registry "$TRIAL/registry.json" >/dev/null
"$ISOLOIR" check poll "$TRIAL/poll.json" --registry "$TRIAL/registry.json" >/dev/null
"$ISOLOIR" genesis "$TRIAL/ledger.json"
PORT=8080 "$ISOLOIR" ingest --mirror-dir "$TRIAL/mirror" --dev --no-stamps --listen 127.0.0.1:8080 >"$TRIAL/ingest.log" 2>&1 &
sleep 2
"$ISOLOIR" submit registry "$TRIAL/registry.json"
"$ISOLOIR" submit poll "$TRIAL/poll.json"

for i in 0 1 2; do
  S=$("$ISOLOIR" voter secret); echo "$S" >"$TRIAL/voter$i.secret"
  "$ISOLOIR" voter register --mirror "$TRIAL/mirror" --registry 1 --secret "$S" --uid "trial-voter-$i"
done
sleep 8   # a checkpoint with the registrations, so ballots can prove against the tree
"$ISOLOIR" voter vote --mirror "$TRIAL/mirror" --poll 1 --secret "$(cat "$TRIAL/voter0.secret")" --choice 0
"$ISOLOIR" voter vote --mirror "$TRIAL/mirror" --poll 1 --secret "$(cat "$TRIAL/voter1.secret")" --choice 1
"$ISOLOIR" voter vote --mirror "$TRIAL/mirror" --poll 1 --secret "$(cat "$TRIAL/voter2.secret")" --choice 0

if [ -n "${SERVE:-}" ]; then
  echo "mirror on http://127.0.0.1:8787 ; relay ws://127.0.0.1:7777 ; direct http://127.0.0.1:8080"
  echo "verifierKey=$LOG_KEY"
  python3 "$ROOT/scripts/serve-mirror.py" "$TRIAL/mirror" 8787 >"$TRIAL/http.log" 2>&1 &
  cat >"$ROOT/site/app/.env.trial" <<E
VITE_AGORA_ORIGIN=trial.local/agora
VITE_AGORA_VERIFIER_KEY=$LOG_KEY
VITE_AGORA_MIRROR=http://127.0.0.1:8787
VITE_AGORA_DEV=1
E
  echo "waiting for the close ($CLOSE_IN s) ... vote from the site meanwhile"
fi

WAIT=$((CLOSES - $(date +%s) + 12)); [ "$WAIT" -gt 0 ] && sleep "$WAIT"
echo "--- the poll closed; opening the ballots with the drand beacon"
"$ISOLOIR" authority --mirror "$TRIAL/mirror" --circuits "$TRIAL/mirror/circuits" --log-key "$LOG_KEY" --drand https://api.drand.sh --db "$DB" --nostr-key "$ISOLOIR_NOSTR_KEY" --dev --once
sleep 8
echo "--- tally"; cat "$TRIAL/mirror/polls/1/tallies/latest.json"; echo
echo "--- audit"
"$ISOLOIR" audit --mirror "$TRIAL/mirror" --circuits "$TRIAL/mirror/circuits" --log-key "$LOG_KEY" --relays --skip-passports --dev
if [ -n "${SERVE:-}" ]; then
  echo "--- the result is on the vote page; the servers stay up until Ctrl-C"
  wait
fi
