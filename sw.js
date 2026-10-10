/* Hunt Map service worker.
   - App shell + data: precached, served cache-first, refreshed in the background (stale-while-revalidate).
   - Map tiles (basemap.nationalmap.gov): cache-first from "hm-tiles-v1"; tiles you view online are kept too.
   - ./registry/*: network-first, cached copy when offline. */
var VERSION = 'v1.4.0';
var SHELL_CACHE = 'hm-shell-' + VERSION;
var TILE_CACHE = 'hm-tiles-v1';
var REG_CACHE = 'hm-registry-v1';
var SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/geo.js', 'js/gpx.js', 'js/registry.js', 'js/db.js', 'js/offline.js', 'js/parcels.js', 'js/trail.js', 'js/nws.js', 'js/layers.js', 'js/app-boot.js', 'js/app.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon-maskable-512.png',
  'data/wma-boundary.geojson', 'data/mvum.geojson',
  'data/wma_boundary.geojson', 'data/state_park_exclusion.geojson', 'data/roads_100ft_buffer.geojson',
  'data/roads_centerlines.geojson', 'data/access_parking.geojson', 'data/saddles.geojson', 'data/benches.geojson',
  'data/likely_bedding.geojson', 'data/pinch_points.geojson', 'data/water.geojson', 'data/water_influence.geojson', 'data/forecast.json'
  // not precached: top10_stands (needs John's OK to publish), wind_grid (stale; NWS is live), empty user-pin layers
];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL_CACHE).then(function (c) {
    // add individually so one missing optional file doesn't break install
    return Promise.all(SHELL.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('hm-shell-') === 0 && k !== SHELL_CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
function isTile(url) { return url.hostname === 'basemap.nationalmap.gov' && url.pathname.indexOf('/tile/') > 0; }
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (isTile(url)) {
    e.respondWith(caches.open(TILE_CACHE).then(function (cache) {
      return cache.match(req.url).then(function (hit) {
        if (hit) return hit;
        return fetch(req.url, { mode: 'cors', credentials: 'omit' }).then(function (res) {
          if (res.ok) cache.put(req.url, res.clone());
          return res;
        }).catch(function () { return new Response('', { status: 504, statusText: 'offline, tile not cached' }); });
      });
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/registry/') >= 0) {
    e.respondWith(fetch(req, { cache: 'no-store' }).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(REG_CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.open(REG_CACHE).then(function (c) { return c.match(req); })
        .then(function (r) { return r || new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } }); });
    }));
    return;
  }
  // app shell: stale-while-revalidate
  e.respondWith(caches.open(SHELL_CACHE).then(function (cache) {
    var key = req.mode === 'navigate' ? 'index.html' : req;
    return cache.match(key, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res.ok && res.type === 'basic') cache.put(req.mode === 'navigate' ? 'index.html' : req, res.clone());
        return res;
      }).catch(function () { return hit || caches.match('index.html'); });
      if (hit) { e.waitUntil(net.catch(function () {})); return hit; }
      return net;
    });
  }));
});
self.addEventListener('message', function (e) {
  if (e.data === 'version' && e.source) e.source.postMessage({ type: 'version', version: VERSION });
});
