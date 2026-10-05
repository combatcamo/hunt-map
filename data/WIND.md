# Wind

**Primary (live):** NWS client-side via `js/nws.js` — per-stand detail + map readout. Always fresh (CORS `*`, ≥15 min cache). Degrees = FROM.

**Optional arrow field:** `data/wind_grid.geojson.gz.b64` (base64 of gzip of GeoJSON). App gunzips with `DecompressionStream`. Treat as stale-ok; show “as of” when properties include a timestamp. Do **not** block deploy on refreshing the grid.

**Scout-owned:** `/workspace/hunt-scout/mapdata/wind_refresh.py` (hourly). Hunt Map does not depend on it for live wind. Sync with `scripts/sync-scout-layers.sh` when a grid file exists.
