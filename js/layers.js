/* Hunt Scout mapdata layer catalog + loaders.
   Files live under data/ after scripts/sync-mapdata.sh copies /workspace/hunt-scout/mapdata/.
   Missing layers stay hidden or show as "waiting" — the app hot-adds them when files appear. */
(function (root) {
  'use strict';

  /** Planned Scout overlay GeoJSONs (EPSG:4326). Every feature: layer, name, description. */
  var SCOUT_OVERLAYS = [
    { id: 'wma_boundary', file: 'data/wma_boundary.geojson', label: 'WMA boundary (Scout)', kind: 'poly', color: '#7CFF00', weight: 3, fill: false },
    { id: 'state_park_exclusion', file: 'data/state_park_exclusion.geojson', label: 'State park (no hunt)', kind: 'poly', color: '#ff4d4d', weight: 2, fill: true, fillOpacity: 0.15 },
    { id: 'saddles', file: 'data/saddles.geojson', label: 'Saddles', kind: 'any', color: '#ff9f1a', weight: 2 },
    { id: 'benches', file: 'data/benches.geojson', label: 'Benches', kind: 'any', color: '#c4a35a', weight: 2 },
    { id: 'ridge_spurs', file: 'data/ridge_spurs.geojson', label: 'Ridge spurs', kind: 'line', color: '#e6c35c', weight: 2 },
    { id: 'drainages', file: 'data/drainages.geojson', label: 'Drainages', kind: 'line', color: '#4fc3f7', weight: 2 },
    { id: 'pinch_points', file: 'data/pinch_points.geojson', label: 'Pinch points', kind: 'any', color: '#ff6b6b', weight: 3 },
    { id: 'likely_bedding', file: 'data/likely_bedding.geojson', label: 'Likely bedding', kind: 'poly', color: '#8d6e63', weight: 1, fill: true, fillOpacity: 0.25 },
    { id: 'food_sources', file: 'data/food_sources.geojson', label: 'Food sources', kind: 'any', color: '#66bb6a', weight: 2 },
    { id: 'water', file: 'data/water.geojson', label: 'Water', kind: 'any', color: '#29b6f6', weight: 2, fill: true, fillOpacity: 0.3 },
    { id: 'roads_100ft_buffer', file: 'data/roads_100ft_buffer.geojson', label: 'Roads ±100 ft', kind: 'poly', color: '#aaa', weight: 1, fill: true, fillOpacity: 0.12 },
    { id: 'access_parking', file: 'data/access_parking.geojson', label: 'Access / parking', kind: 'point', color: '#1e90ff' }
  ];
  var TOP10_FILE = 'data/top10_stands.geojson';
  var WIND_GRID_FILE = 'data/wind_grid.geojson';
  var WIND_GRID_TTL_MS = 60 * 60 * 1000; // refresh / hourly cache
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
      var name = String(p.name || ('MM-' + String(i + 1).padStart(2, '0')));
      var id = String(p.id || name).toLowerCase().replace(/\s+/g, '-');
      if (!/^mm-?\d+/i.test(id) && /^mm-?\d+/i.test(name)) id = name.toLowerCase().replace(/\s+/g, '-');
      var rank = p.rank != null ? +p.rank : (parseInt(String(name).replace(/\D/g, ''), 10) || (i + 1));
      return {
        id: id, name: name, rank: rank, type: 'stand', subtype: p.feature_type || '',
        lat: lat, lon: lon, elevation_ft: p.elevation_ft, feature_type: p.feature_type || '',
        why: p.why || '', best_winds: normList(p.best_winds), skip_winds: normList(p.skip_winds),
        best_time: p.best_time || '', access_note: p.access_note || '',
        boundary_check: p.boundary_check || '', notes: p.why || '', source: 'top10',
        unverified: String(p.boundary_check || '').toLowerCase() === 'unverified'
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
  function loadWindGrid(force) {
    var loadNet = function () {
      return fetchGj(WIND_GRID_FILE).then(function (gj) {
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
    };
    if (force || typeof caches === 'undefined') return loadNet();
    return caches.open(WIND_CACHE).then(function (c) { return c.match(windGridKey()); }).then(function (r) {
      if (!r) return loadNet();
      var age = Date.now() - Date.parse(r.headers.get('X-Cached') || 0);
      if (age > WIND_GRID_TTL_MS) return loadNet();
      return r.json();
    }).catch(loadNet);
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
