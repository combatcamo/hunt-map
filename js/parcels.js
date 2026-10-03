/* Parcel lines, fetched on the phone from the Arkansas GIS Office (no parcel data ships with the app).
   - downloadAndStore(): pages through the statewide CAMP parcel layer for the WMA extent, keeps
     parcels touching the WMA (+buffer), stores one GeoJSON in Cache Storage ("hm-parcels-v1").
   - loadLocal(): read that copy (works offline).
   - queryView(): live query for the current map view (online, no local copy yet).
   Service sends CORS headers (Access-Control-Allow-Origin echoes the page origin). */
(function (root) {
  'use strict';
  var Geo = root.Geo || require('./geo.js');
  var SVC = 'https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6/query';
  var CACHE = 'hm-parcels-v1';
  var PAGE = 200; // service MaxRecordCount
  var FIELDS = 'parcelid,ownername,str,county';
  function key() { return new URL('offline-data/parcels.geojson', root.location ? root.location.href : 'http://x/').href; }

  function qs(o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
  function envelopeParams(b) {
    return { geometry: b.join(','), geometryType: 'esriGeometryEnvelope', inSR: 4326, spatialRel: 'esriSpatialRelIntersects', where: '1=1' };
  }
  function getJSON(url, signal, tries) {
    tries = tries || 3;
    return fetch(url, { mode: 'cors', credentials: 'omit', signal: signal }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) { if (d.error) throw new Error(d.error.message || 'service error'); return d; })
      .catch(function (e) {
        if ((signal && signal.aborted) || tries <= 1) throw e;
        return new Promise(function (res) { setTimeout(res, 1500); }).then(function () { return getJSON(url, signal, tries - 1); });
      });
  }
  /* Esri rings -> GeoJSON MultiPolygon. Esri: clockwise = outer ring, counter-clockwise = hole. */
  function ringArea2(r) { var s = 0; for (var i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[i][0] - r[j][0]) * (r[i][1] + r[j][1]); return s; } // >0 = clockwise (y up)
  function esriToGeo(rings) {
    var polys = [];
    (rings || []).forEach(function (r) {
      if (r.length < 4) return;
      if (ringArea2(r) > 0 || !polys.length) polys.push([r]); else polys[polys.length - 1].push(r);
    });
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
  }
  /* Geodesic-ish polygon area (m²), spherical formula used by d3/turf. */
  function ringAreaM2(r) {
    var R = 6378137, s = 0, rad = Math.PI / 180;
    for (var i = 0; i < r.length - 1; i++) s += (r[i + 1][0] - r[i][0]) * rad * (2 + Math.sin(r[i][1] * rad) + Math.sin(r[i + 1][1] * rad));
    return Math.abs(s * R * R / 2);
  }
  function acres(g) {
    var m2 = 0; g.coordinates.forEach(function (p) { p.forEach(function (ring, k) { m2 += (k ? -1 : 1) * ringAreaM2(ring); }); });
    return Math.round(m2 / 4046.8564224 * 10) / 10;
  }
  function toFeature(f) {
    var g = esriToGeo(f.geometry && f.geometry.rings); if (!g) return null;
    var a = f.attributes || {};
    return { type: 'Feature', geometry: g, properties: { owner: (a.ownername || '').trim(), parcelid: a.parcelid || '', str: a.str || '', county: a.county || '', acres: acres(g) } };
  }
  function featureBBox(f) { return Geo.geojsonBBox(f.geometry); }

  /** Download all parcels for the area. keepTiles: Set of "x/y" z14 tiles to keep (from the offline plan); null keeps all.
      opts: {onProgress(pageDone, pages, kept), signal}. Resolves {count, bytes, ms, pages}. */
  function downloadAndStore(areaBBox, keepTiles, opts) {
    opts = opts || {};
    var t0 = Date.now(), base = envelopeParams(areaBBox), bytes = 0;
    return getJSON(SVC + '?' + qs(Object.assign({ returnCountOnly: true, f: 'json' }, base)), opts.signal).then(function (c) {
      var pages = Math.ceil((c.count || 0) / PAGE), feats = [], page = 0;
      function next(offset) {
        if (opts.signal && opts.signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
        var url = SVC + '?' + qs(Object.assign({}, base, { outFields: FIELDS, returnGeometry: true, outSR: 4326, f: 'json',
          geometryPrecision: 6, maxAllowableOffset: 0.00002, orderByFields: 'objectid', resultOffset: offset, resultRecordCount: PAGE }));
        return getJSON(url, opts.signal).then(function (d) {
          page++;
          (d.features || []).forEach(function (f) {
            var gf = toFeature(f); if (!gf) return;
            if (keepTiles) {
              var b = featureBBox(gf), hit = false;
              for (var x = Geo.lon2tile(b[0], 14); x <= Geo.lon2tile(b[2], 14) && !hit; x++)
                for (var y = Geo.lat2tile(b[3], 14); y <= Geo.lat2tile(b[1], 14) && !hit; y++) if (keepTiles.has(x + '/' + y)) hit = true;
              if (!hit) return;
            }
            feats.push(gf);
          });
          opts.onProgress && opts.onProgress(page, pages, feats.length);
          // the server returns <200 rows when some records lack geometry, so page by offset, not by row count
          if (offset + PAGE < c.count) return new Promise(function (r) { setTimeout(r, 150); }).then(function () { return next(offset + PAGE); });
        });
      }
      return (pages ? next(0) : Promise.resolve()).then(function () {
        var gj = { type: 'FeatureCollection', _source: SVC, _fetched: new Date().toISOString(), features: feats };
        var body = JSON.stringify(gj); bytes = body.length;
        return caches.open(CACHE).then(function (cache) {
          return cache.put(key(), new Response(body, { headers: { 'Content-Type': 'application/geo+json', 'X-Fetched': gj._fetched, 'X-Count': String(feats.length) } }));
        }).then(function () { return { count: feats.length, bytes: bytes, ms: Date.now() - t0, pages: pages }; });
      });
    });
  }
  function loadLocal() {
    if (typeof caches === 'undefined') return Promise.resolve(null);
    return caches.open(CACHE).then(function (c) { return c.match(key()); }).then(function (r) { return r ? r.json() : null; });
  }
  function info() {
    if (typeof caches === 'undefined') return Promise.resolve(null);
    return caches.open(CACHE).then(function (c) { return c.match(key()); }).then(function (r) {
      return r ? { count: +r.headers.get('X-Count'), fetched: r.headers.get('X-Fetched') } : null;
    });
  }
  function clear() { return caches.delete(CACHE); }
  /** Live query for a view bbox (max ~maxPages*200 parcels). */
  function queryView(bbox, signal, maxPages) {
    maxPages = maxPages || 4;
    var base = envelopeParams(bbox), feats = [];
    function next(offset, n) {
      var url = SVC + '?' + qs(Object.assign({}, base, { outFields: FIELDS, outSR: 4326, f: 'json', geometryPrecision: 6,
        maxAllowableOffset: 0.00002, orderByFields: 'objectid', resultOffset: offset, resultRecordCount: PAGE }));
      return getJSON(url, signal, 2).then(function (d) {
        (d.features || []).forEach(function (f) { var gf = toFeature(f); if (gf) feats.push(gf); });
        if (d.exceededTransferLimit && n + 1 < maxPages) return next(offset + PAGE, n + 1);
      });
    }
    return next(0, 0).then(function () { return { type: 'FeatureCollection', features: feats }; });
  }
  var api = { SVC: SVC, CACHE: CACHE, downloadAndStore: downloadAndStore, loadLocal: loadLocal, info: info, clear: clear,
    queryView: queryView, esriToGeo: esriToGeo, acres: acres, key: key };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Parcels = api;
})(this);
