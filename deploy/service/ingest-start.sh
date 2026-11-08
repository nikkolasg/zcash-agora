#!/bin/sh
# The ingest, as the host runs it. The setups are baked into the image (/app/agora/ledger, from the
# repository's ledger/ at deploy time); genesis runs once (a database that already holds a
# ledger refuses it); the registry and the poll are submitted once each (the mirror, cloned
# by the ingest at start, holds them afterwards); then the ingest runs.
set -u
if [ -f /app/agora/ledger/ledger.json ]; then
  echo "genesis:"; isoloir genesis /app/agora/ledger/ledger.json || echo "(genesis refused: the ledger exists, or see above)"
fi
(
  sleep 40
  if [ ! -f /app/mirror/registries/1.json ]; then echo "submit registry 1:"; isoloir submit registry /app/agora/ledger/registries/1.json; fi
  for n in 1 2; do
    if [ ! -f /app/mirror/polls/$n.json ]; then echo "submit poll $n:"; isoloir submit poll /app/agora/ledger/polls/$n.json; fi
  done
) &
# On a redeploy the previous container still holds the ledger's lease (a Postgres advisory
# lock) until it is stopped: retry for up to ten minutes instead of crashing.
n=0
while :; do
  isoloir ingest --mirror-dir /app/mirror --zkverifier /app/zkverifier/verify.mjs && exit 0
  n=$((n+1)); [ $n -ge 40 ] && exit 1
  echo "ingest exited (attempt $n); retrying in 15 s"; sleep 15
done
