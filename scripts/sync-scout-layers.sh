#!/usr/bin/env bash
# Copy Hunt Scout mapdata into data/ for local serve / GitHub Pages deploy.
# Skips empty layers and _scratch/. Builds wind_grid.geojson.gz (+ .b64 for commit size).
set -euo pipefail
SRC="${1:-/workspace/hunt-scout/mapdata}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/data"
mkdir -p "$DEST"
if [ ! -d "$SRC" ]; then echo "No mapdata at $SRC" >&2; exit 1; fi

/workspace/hunt-scout/.venv/bin/python - "$SRC" "$DEST" <<'PY'
import json, gzip, sys, base64
from pathlib import Path
from shapely.geometry import shape, mapping
SRC, DEST = Path(sys.argv[1]), Path(sys.argv[2])
INCLUDE = [
  'wma_boundary','state_park_exclusion','roads_100ft_buffer','roads_centerlines',
  'access_parking','saddles','benches','likely_bedding','pinch_points','water','top10_stands',
  'food_sources','food_influence'  # picked up when Scout ships non-empty files
]
def round_coords(c, n=5):
  if isinstance(c[0], (int, float)): return [round(float(c[0]), n), round(float(c[1]), n)]
  return [round_coords(x, n) for x in c]
def slim(path, tol=None):
  d = json.load(open(path)); feats = []
  for f in d.get('features') or []:
    if not f.get('geometry'): continue
    g = shape(f['geometry'])
    if tol is not None and hasattr(g, 'simplify'): g = g.simplify(tol, preserve_topology=True)
    if g.is_empty: continue
    m = mapping(g); m['coordinates'] = round_coords(m['coordinates'])
    feats.append({'type': 'Feature', 'geometry': m, 'properties': dict(f.get('properties') or {})})
  return {'type': 'FeatureCollection', 'features': feats}
for name in INCLUDE:
  src = SRC / f'{name}.geojson'
  if not src.exists() or src.stat().st_size <= 50:
    print(f'  (skip) {name}'); continue
  tol = 0.00012 if name.startswith('roads') else (0.00005 if name in ('wma_boundary','state_park_exclusion','roads_100ft_buffer') else None)
  if name in ('access_parking','top10_stands','saddles','benches','pinch_points','water','likely_bedding'): tol = None
  gj = slim(src, tol=tol)
  if not gj['features']:
    out = DEST / f'{name}.geojson'
    if out.exists(): out.unlink()
    print(f'  (skip empty) {name}'); continue
  body = json.dumps(gj, separators=(',', ':'))
  (DEST / f'{name}.geojson').write_text(body)
  print(f'  {name}: {len(gj["features"])} features, {len(body)} bytes')
wg = SRC / 'wind_grid.geojson'
if wg.exists() and wg.stat().st_size > 50:
  data = json.dumps(json.loads(wg.read_text()), separators=(',', ':')).encode()
  gz_path = DEST / 'wind_grid.geojson.gz'
  with gzip.open(gz_path, 'wb', compresslevel=9) as z: z.write(data)
  b64_path = DEST / 'wind_grid.geojson.gz.b64'
  b64_path.write_text(base64.b64encode(gz_path.read_bytes()).decode('ascii'))
  print(f'  wind_grid.geojson.gz: {gz_path.stat().st_size} bytes; b64 {b64_path.stat().st_size}')
else:
  print('  (waiting) wind_grid.geojson')
(DEST / 'WIND.md').write_text(
  'Full 24h wind: wind_grid.geojson.gz.b64 (base64 of gzip). App gunzips with DecompressionStream.\n'
  'Upstream refresh: /workspace/hunt-scout/mapdata/wind_refresh.py then scripts/sync-scout-layers.sh\n'
)
print(f'Synced Scout layers -> {DEST}')
PY

for expect in wma_boundary state_park_exclusion roads_100ft_buffer roads_centerlines access_parking \
              saddles benches likely_bedding pinch_points water top10_stands food_sources food_influence; do
  [ -f "$DEST/$expect.geojson" ] || echo "  (waiting) $expect.geojson"
done
[ -f "$DEST/wind_grid.geojson.gz.b64" ] || echo "  (waiting) wind_grid.geojson.gz.b64"
