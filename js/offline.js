/* Offline tile planning + polite bulk downloader.
   Tiles are written to Cache Storage ("hm-tiles-v1") from the page; the service worker
   serves that same cache first (works offline). Running the long job in the page (not in
   the SW) avoids iOS/Chrome killing a long-running service-worker task mid-download. */
(function (root) {
  'use strict';
  var Geo = root.Geo || require('./geo.js');
  var TILE_CACHE = 'hm-tiles-v1';
  var BASEMAPS = {
    topo:   { name: 'USGS Topo', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', maxNative: 16 },
    aerial: { name: 'USGS Aerial', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', maxNative: 16 },
    hybrid: { name: 'Aerial + labels', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}', maxNative: 16 }
  };
  // Average JPEG bytes per tile over this WMA, sampled 2026-10-02 (see README).
  var AVG_BYTES = {
    topo:   { 11: 22000, 12: 22000, 13: 22000, 14: 20000, 15: 18400, 16: 12000 },
    aerial: { 11: 18400, 12: 18400, 13: 18400, 14: 22000, 15: 25000, 16: 29600 },
    hybrid: { 11: 21000, 12: 21000, 13: 21000, 14: 25000, 15: 28000, 16: 33000 }
  };
  function tileUrl(key, z, x, y) { return BASEMAPS[key].url.replace('{z}', z).replace('{y}', y).replace('{x}', x); }
  function tile2lon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
  function tile2lat(y, z) { var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }

  function polygonsOf(gj) {
    var out = [];
    (gj.type === 'FeatureCollection' ? gj.features : [gj]).forEach(function (f) {
      var g = f.type === 'Feature' ? f.geometry : f;
      if (!g) return;
      if (g.type === 'Polygon') out.push(g.coordinates);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(function (p) { out.push(p); });
    });
    return out;
  }
  function inRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function inPolys(x, y, polys) {
    for (var p = 0; p < polys.length; p++) {
      if (inRing(x, y, polys[p][0])) {
        var hole = false;
        for (var h = 1; h < polys[p].length; h++) if (inRing(x, y, polys[p][h])) { hole = true; break; }
        if (!hole) return true;
      }
    }
    return false;
  }
  /** Tiles at zooms zmin..zmax covering the area: whole buffered bbox if no polygon, otherwise only tiles
      touching the polygon grown by bufDeg (approx; ~0.004 deg ≈ 400 m). Returns [{z,x,y}] */
  function planTiles(areaGeojson, zmin, zmax, bufDeg) {
    bufDeg = bufDeg == null ? 0.004 : bufDeg;
    var bbox = Geo.bufferBBox(Geo.geojsonBBox(areaGeojson), bufDeg);
    var polys = polygonsOf(areaGeojson), verts = [];
    polys.forEach(function (p) { p[0].forEach(function (c) { verts.push(c); }); });
    var tiles = [];
    Geo.tileRanges(bbox, zmin, zmax).forEach(function (r) {
      for (var x = r.x0; x <= r.x1; x++) for (var y = r.y0; y <= r.y1; y++) {
        if (!polys.length || r.z <= 12) { tiles.push({ z: r.z, x: x, y: y }); continue; }
        var w = tile2lon(x, r.z) - bufDeg, e = tile2lon(x + 1, r.z) + bufDeg;
        var n = tile2lat(y, r.z) + bufDeg, s = tile2lat(y + 1, r.z) - bufDeg, hit = false;
        for (var i = 0; i <= 4 && !hit; i++) for (var j = 0; j <= 4 && !hit; j++)
          if (inPolys(w + (e - w) * i / 4, s + (n - s) * j / 4, polys)) hit = true;
        for (var k = 0; k < verts.length && !hit; k++)
          if (verts[k][0] >= w && verts[k][0] <= e && verts[k][1] >= s && verts[k][1] <= n) hit = true;
        if (hit) tiles.push({ z: r.z, x: x, y: y });
      }
    });
    return tiles;
  }
  function estimate(tiles, keys) {
    var count = 0, bytes = 0;
    keys.forEach(function (k) { tiles.forEach(function (t) { count++; bytes += AVG_BYTES[k][t.z] || 25000; }); });
    return { count: count, bytes: bytes };
  }

  /** Download tiles for basemap keys. opts: {concurrency=6, delayMs=60, onProgress(done,total,failed), signal} */
  function download(tiles, keys, opts) {
    opts = opts || {};
    var conc = opts.concurrency || 6, delay = opts.delayMs == null ? 60 : opts.delayMs;
    var urls = [];
    keys.forEach(function (k) { tiles.forEach(function (t) { urls.push(tileUrl(k, t.z, t.x, t.y)); }); });
    var total = urls.length, done = 0, failed = 0, skipped = 0, bytes = 0, idx = 0;
    return caches.open(TILE_CACHE).then(function (cache) {
      function worker() {
        if (opts.signal && opts.signal.aborted) return Promise.resolve();
        if (idx >= urls.length) return Promise.resolve();
        var url = urls[idx++];
        return cache.match(url).then(function (hit) {
          if (hit) { skipped++; return; } // resumable: skip what we already have
          return fetch(url, { mode: 'cors', credentials: 'omit', signal: opts.signal }).then(function (res) {
            if (!res.ok) { if (res.status !== 404) failed++; return; } // 404 = no tile there
            return res.clone().blob().then(function (b) { bytes += b.size; return cache.put(url, res); })
              .then(function () { return new Promise(function (r) { setTimeout(r, delay); }); });
          });
        }).catch(function (e) { if (!(opts.signal && opts.signal.aborted)) failed++; })
          .then(function () { done++; opts.onProgress && opts.onProgress(done, total, failed, bytes, skipped); return worker(); });
      }
      var ws = []; for (var i = 0; i < conc; i++) ws.push(worker());
      return Promise.all(ws).then(function () {
        return { done: done, total: total, failed: failed, bytes: bytes, skipped: skipped, cancelled: !!(opts.signal && opts.signal.aborted) };
      });
    });
  }
  function cachedCount() {
    return caches.open(TILE_CACHE).then(function (c) { return c.keys(); }).then(function (k) { return k.length; });
  }
  function clearTiles() { return caches.delete(TILE_CACHE); }

  var api = { BASEMAPS: BASEMAPS, TILE_CACHE: TILE_CACHE, AVG_BYTES: AVG_BYTES, tileUrl: tileUrl, planTiles: planTiles,
    estimate: estimate, download: download, cachedCount: cachedCount, clearTiles: clearTiles, inPolys: inPolys };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Offline = api;
})(this);
