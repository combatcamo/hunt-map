#!/usr/bin/env bash
# Copy Hunt Scout mapdata GeoJSONs into this app's data/ folder for local serving / deploy.
# Read-only on the source. Skips _scratch/. Missing files are fine — the app shows those layers as waiting.
set -euo pipefail
SRC="${1:-/workspace/hunt-scout/mapdata}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/data"
mkdir -p "$DEST"
if [ ! -d "$SRC" ]; then echo "No mapdata dir at $SRC" >&2; exit 1; fi
n=0
shopt -s nullglob
for f in "$SRC"/*.geojson; do
  base="$(basename "$f")"
  cp -f "$f" "$DEST/$base"
  n=$((n + 1))
  echo "  $base"
done
echo "Synced $n GeoJSON file(s) from $SRC -> $DEST"
for expect in wma_boundary state_park_exclusion saddles benches ridge_spurs drainages pinch_points \
              likely_bedding food_sources water roads_100ft_buffer access_parking top10_stands wind_grid; do
  if [ ! -f "$DEST/$expect.geojson" ]; then echo "  (waiting) $expect.geojson"; fi
done
