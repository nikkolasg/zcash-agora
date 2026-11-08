#!/bin/sh
# The authority, as a scheduled job on the host (an hourly cron): each run
# verifies the log from the ingest's database, clones the circuits from ISOLOIR_MIRROR_GIT,
# opens the time-locked ballots of every poll whose drand round has passed, posts the tally,
# and exits. Before a close there is nothing to open; after it, one run is enough.
# The two echo lines make each run visible in the logs: the authority itself is silent
# when it has nothing to open.
set -u
echo "authority: start $(date -u +%FT%TZ)"
isoloir authority --db "$DATABASE_URL" --zkverifier /app/zkverifier/verify.mjs --drand https://api.drand.sh --once
code=$?
echo "authority: exit $code $(date -u +%FT%TZ)"
exit $code
