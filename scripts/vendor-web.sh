#!/usr/bin/env bash
# Copies the built @isoloir/web package (dist, the web wasm, package.json)
# from the submodule into site/app/vendor/isoloir-web, so that the site builds
# with node alone (GitHub Pages) and pins the exact build it was tested with.
# Run after a submodule update: (cd isoloir/js && npm ci && npm run wasm:web && npm run build) first.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC=$ROOT/isoloir/js; DST=$ROOT/site/app/vendor/isoloir-web
[ -d "$SRC/dist" ] && [ -f "$SRC/wasm/web/isoloir_wasm_bg.wasm" ] || { echo "build isoloir/js first"; exit 1; }
rm -rf "$DST"; mkdir -p "$DST/wasm"
cp -R "$SRC/dist" "$DST/dist"; cp -R "$SRC/wasm/web" "$DST/wasm/web"; cp "$SRC/package.json" "$DST/package.json"
git -C "$ROOT/isoloir" rev-parse HEAD > "$DST/ISOLOIR_COMMIT"
echo "vendored @isoloir/web from isoloir $(cat "$DST/ISOLOIR_COMMIT")"
