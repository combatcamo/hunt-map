# Data sources and licenses

All data below was fetched on 2026-10-02 (CT) from free, public services with no sign-in or API key.
Sources were cross-checked against Hunt Scout's research note `/workspace/hunt-scout/mount-magazine-data-sources.md`.

## data/wma-boundary.geojson — Mount Magazine WMA boundary
- **Source:** Arkansas Game and Fish Commission (AGFC), ArcGIS REST "WMA Boundaries" layer
  `https://gisec2.agfc.com/arcgis/rest/services/GIS/AGFC_DATA/FeatureServer/11`
- **Feature:** `objectid=37`, `fname='Mount Magazine WMA'`, owner USFS, type "Regulatory Boundary", 112,153 acres, last edited 2023-11-02 (CT).
- **Query used:** `.../FeatureServer/11/query?where=objectid%3D37&outSR=4326&f=geojson`
- **How it got here:** copied unchanged from Hunt Scout's `/workspace/hunt-scout/mount_magazine_wma_boundary.geojson`
  (44 KB MultiPolygon, 1,081 vertices). I also downloaded the same feature live from AGFC myself; it matched (same extent and vertex count).
- **Extent:** -93.7911 to -93.3464 W, 35.1315 to 35.2779 N (wider east–west than the rough box in the original brief).
  The offline-map download area is this polygon plus a ~400 m buffer.
- **License/terms:** public government GIS service; no explicit license published. Treat as "as is". Confirm boundaries with posted signs and current AGFC maps.
- Mirror: Arkansas GIS Office `FEATURESERVICES/Boundaries/FeatureServer/37` (ST_WILDLIFE_MNGMNT_AGFC), same objectid 37.

## Parcel lines (NOT bundled; fetched by each phone)
- **No parcel or owner-name data is stored in this repo or on the website.** During **Offline maps → Download WMA for offline**
  the phone itself queries the Arkansas GIS Office statewide CAMP parcel layer and saves the result in its own Cache Storage
  (`hm-parcels-v1`). "Clear offline maps" deletes it. With no saved copy, turning the layer on (online) queries just the current view.
- **Service:** `https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6` (PARCEL_POLYGON_CAMP)
- **CORS:** verified 2026-10-02: `Access-Control-Allow-Origin` echoes the requesting origin (tested with `Origin: https://combatcamo.github.io`
  and `http://127.0.0.1`), and preflight is allowed, so browsers can query it directly.
- **Query:** envelope of the WMA boundary + ~300 m, `outSR=4326`, `outFields=parcelid,ownername,str,county`, `geometryPrecision=6`,
  `maxAllowableOffset=0.00002` (≈2 m simplification), paged 200 at a time with `resultOffset` (19 requests). Parcels are kept if they touch
  a z14 tile of the offline plan (the WMA polygon + ~400 m). Measured: about 2,640 parcels, ~0.2 MB over the network (gzip),
  ~0.9 MB stored, about 5 s.
- **Fields kept:** owner, parcel id, Section-Township-Range, county, plus acres computed on the phone from the geometry.
- **Terms:** provided "as is", no warranty. **Not a legal boundary** (Ark. Code 15-21-504). The app shows
  "Tax-map parcel lines are approximate and are not legal boundaries." on the layer and in every popup.

## data/mvum.geojson — USFS Motor Vehicle Use Map roads and trails
- **Source:** USDA Forest Service EDW `https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer` layers 1 (roads) and 2 (trails).
- **Selection:** lines intersecting the WMA boundary + ~300 m. 249 features (mostly roads, a few trails).
- **In the repo:** committed as `data/mvum-1.geojson` + `data/mvum-2.geojson` (coordinates rounded to 5 decimals) so the Pages build does not depend on the flaky USFS endpoint. The workflow merges them into `mvum.geojson`; the app can also load and merge the parts directly.
- **License:** USFS data is US federal government work (public domain). It's a snapshot, so check the current MVUM and posted signs.
- **Refresh:** `python3 scripts/fetch-mvum.py` then re-split if you need to update the committed parts.

## Hunt Scout mapdata (hot-add)
- Planned GeoJSONs under `/workspace/hunt-scout/mapdata/` are copied into `data/` by `scripts/sync-mapdata.sh`.
- Layers: wma_boundary, state_park_exclusion, saddles, benches, ridge_spurs, drainages, pinch_points, likely_bedding, food_sources, water, roads_100ft_buffer, access_parking, plus top10_stands.geojson and wind_grid.geojson.
- Until a file lands, its toggle shows as *waiting*. No scrapes (field sign).

## Basemap tiles (not stored in the repo; cached on the phone when you download)
- USGS The National Map: `USGSTopo`, `USGSImageryOnly`, `USGSImageryTopo` (hybrid) tile services at
  `https://basemap.nationalmap.gov/arcgis/rest/services/<name>/MapServer/tile/{z}/{y}/{x}`.
- Public domain (USGS). Attribution is shown in the app. Native detail tops out at z16 here (z17 returns 404), so the app caches z11–16
  and over-zooms beyond that. USGS asks for fair use, so the downloader runs 6 requests at a time with a 60 ms pause after each tile,
  and only downloads tiles touching the WMA polygon.

## Vendored library
- Leaflet 1.9.4 (BSD-2-Clause), `vendor/leaflet/`, license in `vendor/leaflet/LICENSE`.

## Hunt Scout mapdata (synced)
Copied by `scripts/sync-scout-layers.sh` from `/workspace/hunt-scout/mapdata/`.
Includes WMA/park/roads/terrain candidates, top10 stands, and `wind_grid.geojson.gz` (gzipped 24h NWS grid).
Empty layers (ridge_spurs, drainages, food_sources, food_influence, deer_sign, sign_lines, sign_influence when empty) are not shipped. Non-empty: water_influence (and food/sign layers when Scout fills them). `_scratch/` is never published.


## Wind
Live: NWS (`js/nws.js`). Optional grid: `wind_grid.geojson.gz.b64` (stale-ok). Scout owns `wind_refresh.py`.
