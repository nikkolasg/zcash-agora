#!/bin/sh
# Prints the drand quicknet round at or after a Unix time (SPEC §7.2):
#   ledger/round.sh 1797249600
# quicknet: period 3 s, genesis 1692803367 (https://api.drand.sh/v2/beacons/quicknet/info).
set -eu
t="${1:?unix time}"
genesis=1692803367
period=3
echo $(( (t - genesis + period - 1) / period + 1 ))
