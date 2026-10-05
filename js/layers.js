/* Hunt Scout mapdata layer catalog + loaders.
   Files live under data/ after scripts/sync-mapdata.sh copies /workspace/hunt-scout/mapdata/.
   Missing layers stay hidden or show as "waiting" — the app hot-adds them when files appear. */
(function (root) {
  'use strict';

  /** Planned Scout overlay GeoJSONs (EPSG:4326). Every feature: layer, name, description. */
  var SCOUT_OVERLAYS = [
    { id: 'wma_boundary', file: 'data/wma_boundary.geojson', label: 'WMA boundary (Scout)', kind: 'poly', color: '#7CFF00', weight: 3, fill: false },
    { id: 'state_park_exclusion', file: 'data/state_park_exclusion.geojson', label: 'State park — NO HUNT', kind: 'poly', color: '#ff4d4d', weight: 2, fill: true, fillOpacity: 0.28 },
    { id: 'roads_100ft_buffer', file: 'data/roads_100ft_buffer.geojson', label: 'Roads ±100 ft (no hunt)', kind: 'poly', color: '#ff6b6b', weight: 1, fill: true, fillOpacity: 0.18 },
    { id: 'roads_centerlines', file: 'data/roads_centerlines.geojson', label: 'WMA road centerlines', kind: 'line', color: '#9e9e9e', weight: 2 },
    { id: 'access_parking', file: 'data/access_parking.geojson', label: 'Access / parking', kind: 'point', color: '#1e90ff' },
    { id: 'saddles', file: 'data/saddles.geojson', label: 'Saddles', kind: 'point', color: '#ab47bc' },
    { id: 'benches', file: 'data/benches.geojson', label: 'Benches', kind: 'point', color: '#42a5f5' },
    { id: 'likely_bedding', file: 'data/likely_bedding.geojson', label: 'Likely bedding (scout to confirm)', kind: 'point', color: '#8d6e63' },
    { id: 'pinch_points', file: 'data/pinch_points.geojson', label: 'Pinch points', kind: 'point', color: '#ff6b6b' },
    { id: 'water', file: 'data/water.geojson', label: 'Water (Scout/NHD)', kind: 'any', color: '#29b6f6', weight: 2, fill: true, fillOpacity: 0.35 },
    { id: 'water_influence', file: 'data/water_influence.geojson', label: 'Water influence', kind: 'poly', color: '#4fc3f7', weight: 1, fill: true, fillOpacity: 0.16 },
    { id: 'food_sources', file: 'data/food_sources.geojson', label: 'Food sources (Scout)', kind: 'any', color: '#c6ff00', weight: 2, fill: true, fillOpacity: 0.25 },
    { id: 'food_influence', file: 'data/food_influence.geojson', label: 'Food influence (Scout)', kind: 'poly', color: '#aeea00', weight: 1, fill: true, fillOpacity: 0.15 },
    { id: 'deer_sign', file: 'data/deer_sign.geojson', label: 'Deer sign', kind: 'point', color: '#ff8a65' },
    { id: 'sign_lines', file: 'data/sign_lines.geojson', label: 'Sign lines', kind: 'line', color: '#ffab91', weight: 3 },
    { id: 'sign_influence', file: 'data/sign_influence.geojson', label: 'Sign influence', kind: 'poly', color: '#ffccbc', weight: 1, fill: true, fillOpacity: 0.18 }
  ];
  var TOP10_FILE = 'data/top10_stands.geojson';
  var WIND_GRID_FILE = 'data/wind_grid.geojson.gz.b64'; // optional arrow field (stale-ok). Live wind = NWS (js/nws.js).
  var WIND_GRID_TTL_MS = 15 * 60 * 1000; // refresh / cache ≥15 min
  var WIND_CACHE = 'hm-windgrid-v1';

  function fetchGj(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
      return r.json();
    }).catch(function (e) {
      if (e && /Failed to fetch|NetworkError|404/.test(String(e.message || e))) return null;
      throw e;
    });
  }

  /** Probe which Scout layer files exist. Resolves [{id,label,file,status:'ready'|'waiting', count?}]. */
  function probe() {
    return Promise.all(SCOUT_OVERLAYS.map(function (def) {
      return fetchGj(def.file).then(function (gj) {
        return Object.assign({}, def, {
          status: gj && gj.features ? 'ready' : 'waiting',
          count: gj && gj.features ? gj.features.length : 0
        });
      }).catch(function () { return Object.assign({}, def, { status: 'waiting', count: 0 }); });
    }));
  }

  function popupHtml(f) {
    var p = f.properties || {};
    var name = p.name || p.flabel || p.fname || 'Feature';
    var desc = p.description || p.fdescrip || p.comments || '';
    var layer = p.layer || '';
    return '<b>' + esc(name) + '</b>' + (layer ? '<br><span class="muted">' + esc(layer) + '</span>' : '') +
      (desc ? '<br>' + esc(desc) : '');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  function styleFor(def) {
    return {
      color: def.color || '#ff9f1a', weight: def.weight || 2, opacity: 0.9,
      fillColor: def.color || '#ff9f1a', fillOpacity: def.fill ? (def.fillOpacity || 0.2) : 0
    };
  }

  /** Build a Leaflet layer group from GeoJSON + def. Uses window.L. */
  function makeOverlay(def, gj, L) {
    return L.geoJSON(gj, {
      style: function () { return styleFor(def); },
      pointToLayer: function (f, latlng) {
        return L.circleMarker(latlng, { radius: 7, color: def.color || '#1e90ff', weight: 2, fillColor: def.color || '#1e90ff', fillOpacity: 0.85 });
      },
      onEachFeature: function (f, layer) { layer.bindPopup(popupHtml(f)); }
    });
  }

  /** top10_stands.geojson → pin-like records. Prefer id mm-01..; else name. */
  function normalizeTop10(gj) {
    if (!gj || !gj.features) return [];
    return gj.features.map(function (f, i) {
      var p = f.properties || {};
      var g = f.geometry || {};
      var coords = g.type === 'Point' ? g.coordinates : null;
      var lat = p.lat != null ? +p.lat : (coords ? coords[1] : null);
      var lon = p.lon != null ? +p.lon : (coords ? coords[0] : null);
      if (!isFinite(lat) || !isFinite(lon)) return null;
      // Prefer explicit id (mm-01..); else parse from name; else index
      var id = String(p.id || '').toLowerCase().replace(/\s+/g, '-');
      if (!/^mm-\d+$/i.test(id)) {
        var m = String(p.name || '').match(/mm-?(\d+)/i);
        id = m ? ('mm-' + String(m[1]).padStart(2, '0')) : ('mm-' + String(i + 1).padStart(2, '0'));
      }
      var rawName = String(p.name || id.toUpperCase());
      // Label as "MM-01 Name" (id is the key; names can repeat)
      var name = /^mm-\d+/i.test(rawName) ? rawName : (id.toUpperCase() + ' ' + rawName);
      var rank = p.rank != null ? +p.rank : (parseInt((id.match(/\d+/) || [i + 1])[0], 10) || (i + 1));
      var chg = p.rank_change;
      if (chg == null || chg === '') chg = 0;
      else if (typeof chg === 'string' && !/^[+-]?\d+(\.\d+)?$/.test(chg.trim())) chg = 0;
      else chg = +chg;
      return {
        id: id, name: name, rank: rank, type: 'stand', subtype: p.feature_type || '',
        lat: lat, lon: lon, elevation_ft: p.elevation_ft, feature_type: p.feature_type || '',
        why: p.why || '', best_winds: normList(p.best_winds), skip_winds: normList(p.skip_winds),
        best_time: p.best_time || '', access_note: p.access_note || '',
        boundary_check: p.boundary_check || '', notes: p.why || '', source: 'top10',
        unverified: String(p.boundary_check || '').toLowerCase() === 'unverified',
        rank_score: p.rank_score != null ? +p.rank_score : null,
        rank_change: chg,
        water_bonus: +p.water_bonus || 0, food_bonus: +p.food_bonus || 0, sign_bonus: +p.sign_bonus || 0,
        near_water: p.near_water || null, near_food: p.near_food || null, near_sign: p.near_sign || null,
        sign_hot: !!p.sign_hot
      };
    }).filter(Boolean).sort(function (a, b) { return a.rank - b.rank; });
  }
  function normList(v) {
    if (Array.isArray(v)) return v.map(function (x) { return String(x).trim().toUpperCase(); }).filter(Boolean);
    if (v == null || v === '') return [];
    return String(v).split(/[\s,;\/|]+/).map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean);
  }

  function loadTop10() { return fetchGj(TOP10_FILE).then(normalizeTop10); }

  function windGridKey() { return new URL('offline-data/wind_grid.geojson', root.location ? root.location.href : 'http://x/').href; }
  function gunzipJson(buf) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('Gzip not supported in this browser'));
    }
    var ds = new DecompressionStream('gzip');
    var stream = new Response(buf).body.pipeThrough(ds);
    return new Response(stream).json();
  }
  function b64ToBytes(b64) {
    var bin = atob(b64.replace(/\s/g, '')), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function fetchWindGridNet() {
    return fetch(WIND_GRID_FILE, { cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('wind grid HTTP ' + r.status);
      if (/\.b64$/i.test(WIND_GRID_FILE)) {
        return r.text().then(function (t) { return gunzipJson(b64ToBytes(t).buffer); });
      }
      var ct = (r.headers.get('content-type') || '') + WIND_GRID_FILE;
      if (/gzip|\.gz/i.test(ct) || /\.gz$/i.test(WIND_GRID_FILE)) {
        return r.arrayBuffer().then(gunzipJson);
      }
      return r.json();
    }).then(function (gj) {
      if (!gj) return null;
      if (typeof caches !== 'undefined') {
        caches.open(WIND_CACHE).then(function (c) {
          c.put(windGridKey(), new Response(JSON.stringify(gj), {
            headers: { 'Content-Type': 'application/geo+json', 'X-Cached': new Date().toISOString() }
          }));
        }).catch(function () {});
      }
      return gj;
    });
  }
  function loadWindGrid(force) {
    if (force || typeof caches === 'undefined') return fetchWindGridNet();
    return caches.open(WIND_CACHE).then(function (c) { return c.match(windGridKey()); }).then(function (r) {
      if (!r) return fetchWindGridNet();
      var age = Date.now() - Date.parse(r.headers.get('X-Cached') || 0);
      if (age > WIND_GRID_TTL_MS) return fetchWindGridNet();
      return r.json();
    }).catch(fetchWindGridNet);
  }

  /** Nearest wind_grid point to lat/lon; returns feature properties (with hours[]) or null. */
  function nearestWind(gj, lat, lon) {
    if (!gj || !gj.features || !gj.features.length) return null;
    var best = null, bestD = Infinity;
    gj.features.forEach(function (f) {
      var c = f.geometry && f.geometry.coordinates; if (!c) return;
      var dlat = c[1] - lat, dlon = c[0] - lon, d = dlat * dlat + dlon * dlon;
      if (d < bestD) { bestD = d; best = f; }
    });
    return best ? Object.assign({ _lon: best.geometry.coordinates[0], _lat: best.geometry.coordinates[1] }, best.properties || {}) : null;
  }

  /** Load MVUM from single file or merged parts (committed as mvum-1/2 for GitHub size limits). */
  function loadMvum() {
    var parts = [];
    for (var i = 1; i <= 6; i++) parts.push(fetchGj('data/mvum-' + i + '.geojson'));
    return Promise.all([fetchGj('data/mvum.geojson')].concat(parts)).then(function (all) {
      if (all[0] && all[0].features && all[0].features.length) return all[0];
      var feats = [];
      all.slice(1).forEach(function (g) { if (g && g.features) feats = feats.concat(g.features); });
      return feats.length ? { type: 'FeatureCollection', features: feats } : null;
    });
  }

  var api = { SCOUT_OVERLAYS: SCOUT_OVERLAYS, TOP10_FILE: TOP10_FILE, WIND_GRID_FILE: WIND_GRID_FILE,
    WIND_GRID_TTL_MS: WIND_GRID_TTL_MS, probe: probe, fetchGj: fetchGj, makeOverlay: makeOverlay,
    normalizeTop10: normalizeTop10, loadTop10: loadTop10, loadWindGrid: loadWindGrid, nearestWind: nearestWind,
    loadMvum: loadMvum, popupHtml: popupHtml, styleFor: styleFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Layers = api;
})(this);
