# Hunt Map: Mount Magazine WMA (v1)

A free, installable, offline-first hunting map (PWA) for deer hunting on **Mount Magazine WMA** (Yell/Logan Co., Arkansas).
It's built for use in the woods, in the dark, with no cell signal. Plain HTML, CSS, and JS with no build step. Leaflet is vendored,
and there are no accounts, API keys, or paid services.

**Live:** https://combatcamo.github.io/hunt-map/ (once GitHub Pages is on)

## Features
| | |
|---|---|
| **Basemaps** | One big **Map** button cycles USGS **Topo**, **Aerial** (USGS imagery), and **Hybrid** (imagery with USGS labels). Attribution is shown. |
| **Offline** | More → **Offline maps** downloads both basemaps for the WMA (boundary plus ~400 m, zoom 11–16). It shows the tile count and estimated size first, then a progress bar. Cancel works, and the download resumes where it stopped. **Clear offline maps** is also there. The app shell, boundary, parcels, and roads work offline after the first load. Any tile you've viewed online is kept too. |
| **Live GPS** | Blue dot with an accuracy circle (`watchPosition`) and a heading cone from the phone compass (`webkitCompassHeading` on iPhone; absolute orientation on Android). Without a compass it falls back to the GPS travel direction. The big **Me** button centers on you and follows you. On iPhone, the first **Me** tap asks for compass permission. |
| **Pins** | **Pin** drops a pin at the orange crosshair or at your GPS position. There are three big distinct pins: **Stand** (orange circle, ladder), **Blind** (green diamond), and **Truck** (blue square). Pins have a name, kind (ladder, hang-on, ground blind, duck blind), notes, and best/skip winds. Edit any pin. Delete asks first. Pins are stored in IndexedDB. More → **Export pins** / **Import pins** (JSON, upsert by id). |
| **Routes** | More → **Import GPX route** reads `trk`, `rte`, and `wpt`. Lines are drawn on the map. Waypoints can become pins (duplicates are skipped). Show, hide, or delete routes from More. |
| **Back to truck** | The **Truck** button navigates to the most recent truck pin. It shows a large bearing (°, true north), compass point, and distance (yards, plus miles over a mile), with an arrow that turns with the phone. **Change** picks another truck, or any pin. **Navigate here** works from any pin. |
| **Layers** | **WMA boundary** (AGFC, on by default) and **USFS roads/trails (MVUM)** ship in `data/`. **Parcel lines** (tax map: tap a parcel for owner, acres, parcel id, and S-T-R, with a "not legal boundaries" note) are **not** shipped. Your phone downloads them from the Arkansas GIS Office during *Download WMA for offline* and keeps them with the offline tiles. Before that, turning the layer on while online loads parcels for the current view only. |
| **Hunt Scout registry** | More → **Sync from registry** (fetches `./registry/stands.json` plus route GPX files) or **Registry files…** (pick `stands.json` and the GPX files, or the combined `stands.gpx`). Upserts by id and never duplicates. |
| **UI** | Dark by default, with an optional **red night mode** (everything red on black; the topo map is inverted so it stays dark). Five 56-px buttons sit at the bottom for one-handed use, and everything else lives under **More**. Safe-area insets are respected (notch and home bar). |

## Run it locally
```bash
cd /workspace/hunt-map-app
python3 -m http.server 8792 --bind 127.0.0.1
# open http://127.0.0.1:8792/
```
To mimic GitHub Pages (app under a subpath), serve the parent folder:
```bash
mkdir -p /tmp/hm-www && ln -sfn /workspace/hunt-map-app /tmp/hm-www/hunt-map
cd /tmp/hm-www && python3 -m http.server 8793 --bind 127.0.0.1   # open http://127.0.0.1:8793/hunt-map/
```
`localhost`/`127.0.0.1` counts as a secure origin, so GPS and the service worker work there. A phone on your LAN needs **HTTPS** (see Hosting).

Tests:
```bash
node --test tests/                    # unit tests: haversine, bearing, compass, tile math, registry normalizer and dedupe
npm install                           # once (playwright-core only); uses the system Chrome (/usr/bin/google-chrome)
node tests/e2e.mjs                    # headless-Chrome end-to-end at http://127.0.0.1:8793/hunt-map/ (subpath server above)
```

## Install on your phone
The app must be served over **HTTPS** (any host below) for install, GPS, and offline to work.
- **iPhone (Safari):** open the URL in **Safari**, tap **Share** (square with arrow), then **Add to Home Screen**, then **Add**. Launch it from the home-screen icon. Allow Location, then tap **Me** once and allow Motion & Orientation (compass).
- **Android (Chrome):** open the URL, then tap the **⋮** menu and **Install app** (or **Add to Home screen**), or accept the install banner.

## Before the hunt: download offline maps
1. At home on **Wi-Fi**, open the app (from the home-screen icon on iPhone; the installed app has its own storage).
2. **More → Offline maps**. Topo, Aerial, and Parcel lines are checked: **6,276 tiles, about 132 MB**, plus about 2,600 parcels (~0.2 MB download, ~1 MB saved, about 5 s). Hybrid adds 3,138 tiles (~98 MB) if you want it.
3. Tap **Download WMA for offline** and keep the screen on until it says *Offline maps ready* (a few minutes). If it stops, tap Download again and it skips tiles it already has.
4. Test it: turn on Airplane Mode, open the app, and pan around the WMA.
5. Drop your **Truck** pin when you park (Pin → Truck → Save). **Truck** brings you back.

Offline tiles live in the browser's Cache Storage. The app asks the browser to keep the storage persistent. iOS may still clear the data of a website that hasn't been opened for weeks, so open the app before each trip.

| Basemap | z11 | z12 | z13 | z14 | z15 | z16 | Tiles | Est. size |
|---|---|---|---|---|---|---|---|---|
| Topo | 6 | 18 | 52 | 168 | 611 | 2,283 | 3,138 | ~44 MB |
| Aerial | same | | | | | | 3,138 | ~88 MB |
| Hybrid (optional) | same | | | | | | 3,138 | ~98 MB |

Sizes come from sampled tiles over the WMA. USGS imagery has no z17 tiles here (they return 404), so nothing above z16 is downloaded. The map over-zooms to z19.

## Hunt Scout registry schema (v1)
`registry/stands.json` (Hunt Scout keeps the master copy in `/workspace/hunt-scout/registry/`):
```json
{
  "schema_version": 1,
  "parking": [ {"id": "parking-north-gate", "name": "North Gate", "type": "parking", "lat": 35.17, "lon": -93.64, "notes": "", "updated": "2026-10-01"} ],
  "stands":  [ {"id": "stand-ridge-ladder", "name": "Ridge Ladder", "type": "stand", "subtype": "ladder",
                "lat": 35.175, "lon": -93.635, "best_winds": ["S","SW"], "skip_winds": ["N","NE"], "notes": "",
                "access": "", "land_access": "", "last_hunted": "", "last_sighting": "", "updated": "2026-10-01"} ],
  "routes":  [ {"id": "route-north-gate-to-ridge", "name": "North Gate to Ridge", "from_id": "parking-north-gate", "to_id": "stand-ridge-ladder",
                "gpx": "routes/route-north-gate-to-ridge.gpx", "bearing_deg": 37.2, "distance_m": 760,
                "back_bearing_deg": 217.2, "straight_m": 714, "winds_ok": ["S","SW"], "points": [[35.1715, -93.639]], "updated": "2026-10-01"} ]
}
```
How the importer handles it (`js/registry.js`):
- **Pins.** `type` is `parking`, `stand`, or `blind`. `subtype` is ladder, hang-on, ground blind, or duck blind. A type such as `"hang-on"` becomes stand + subtype. Missing ids are derived (`stand-<slug>`). Lat/lon may be strings. Items without valid coordinates are skipped with a warning.
- **Winds.** `best_winds`/`skip_winds` are used, and legacy `winds_work`/`winds_skip` serve only as a fallback. Comma strings and lowercase are accepted.
- **Extra fields.** `access`, `land_access`, `last_hunted`, and `last_sighting` are shown in the pin detail when present. Legacy route `from`/`to` names are ignored.
- **Routes.** The line comes from the route's GPX `trk`. If the GPX is missing, it's drawn from `points` (`[lat,lon]`; `[lon,lat]` is auto-detected), with the from/to pins as endpoints. The popup shows walk distance, bearing out, back bearing, straight-line distance, and OK winds.
- **No duplicates.** Pins and routes upsert by `id`. Waypoints in route GPX files (`TRUCK: name`, stand name) are matched to registry pins by id, or by name within 75 m, and are never added twice. A pin you imported earlier from `stands.gpx` is replaced by its registry twin.
- **Copy the registry to the app:** `scripts/sync-registry.sh` copies `/workspace/hunt-scout/registry` → `./registry` (read-only on the source), then press **Sync from registry** in the app.
- Test fixture (fake coordinates): `tests/fixtures/registry/`.

## Hosting
GPS, install, and service workers all require **HTTPS**. All URLs are relative, so the app works at a subpath such as `/hunt-map/`.
- **GitHub Pages** (used here): `.github/workflows/pages.yml` deploys on every push to `main`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
  The repo holds only hand-written text files. At deploy time the workflow downloads Leaflet 1.9.4 from npm (sha256-pinned), fetches the AGFC boundary and USFS MVUM roads, and generates the PNG icons with Pillow, so the deployed site is fully self-contained.
- Alternatives: **Cloudflare Pages** or **Netlify** free tiers (drag-and-drop the folder; run `scripts/make-icons.py` first to get the PNG icons).

Privacy: no parcel or owner-name data is in the repo or on the site. Phones fetch parcels directly from the state service.
Your stand registry (`registry/`) is git-ignored and never published. Use **Registry files…** in the app to load it on the phone.

## Project layout
```
index.html  manifest.webmanifest  sw.js        app shell + PWA
css/app.css                                   dark + red night themes
js/geo.js        haversine, bearing, compass, tile math (unit-tested)
js/gpx.js        GPX parser (DOMParser)
js/registry.js   Hunt Scout normalizer, waypoint matching, upsert plan (unit-tested)
js/db.js         IndexedDB (pins, routes, settings)
js/offline.js    tile plan (clipped to WMA polygon), throttled downloader, clear
js/parcels.js    parcel download from AR GIS Office -> Cache Storage, live view query
js/app.js        UI
data/            boundary + MVUM GeoJSON, SOURCES.md (no parcels)
vendor/leaflet/  Leaflet 1.9.4
scripts/         sync-registry.sh, fetch-mvum.py, make-icons.py
tests/           unit.test.js, e2e.mjs, fixtures/ (fake data only)
screenshots/     390x844 phone screenshots (local only, not published)
```

## Safety notes
Bearings are **true north**. A handheld compass and the iPhone compass read magnetic north. Magnetic declination at Mount Magazine is small (roughly 1°; check NOAA's calculator), so the difference barely matters at hunting distances.
Parcel lines are approximate tax-map graphics, not legal boundaries. Always confirm boundaries with posted signs and current AGFC regulations.
