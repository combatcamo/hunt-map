/* Pure geo math. Works in the browser (window.Geo) and in Node (module.exports). */
(function (root) {
  'use strict';
  var R = 6371008.8; // mean Earth radius, meters (IUGG)
  var M_PER_YD = 0.9144, M_PER_MI = 1609.344;
  var rad = function (d) { return d * Math.PI / 180; };
  var deg = function (r) { return r * 180 / Math.PI; };

  /** Great-circle distance in meters. */
  function haversine(lat1, lon1, lat2, lon2) {
    var dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  /** Initial (forward) bearing from point 1 to point 2, degrees true, 0..360. */
  function bearing(lat1, lon1, lat2, lon2) {
    var p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  var POINTS16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  function compass(b) { return POINTS16[Math.floor(((b % 360) + 360 + 11.25) % 360 / 22.5)]; }
  /** "350 yd" or "1,950 yd · 1.11 mi" */
  function formatDistance(m) {
    var yd = m / M_PER_YD;
    var ydTxt = Math.round(yd).toLocaleString('en-US') + ' yd';
    if (m > M_PER_MI) return { main: (m / M_PER_MI).toFixed(2) + ' mi', sub: ydTxt, yd: yd };
    return { main: ydTxt, sub: '', yd: yd };
  }
  /** Normalize angle difference to -180..180 */
  function angleDiff(a, b) { return ((a - b + 540) % 360) - 180; }

  /* Slippy-map tile math (Web Mercator / XYZ). */
  function lon2tile(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
  function lat2tile(lat, z) {
    var r = rad(lat);
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
  }
  /** Tile ranges for bbox [west, south, east, north] at zooms zmin..zmax */
  function tileRanges(bbox, zmin, zmax) {
    var out = [];
    for (var z = zmin; z <= zmax; z++) {
      var x0 = lon2tile(bbox[0], z), x1 = lon2tile(bbox[2], z);
      var y0 = lat2tile(bbox[3], z), y1 = lat2tile(bbox[1], z);
      out.push({ z: z, x0: x0, x1: x1, y0: y0, y1: y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) });
    }
    return out;
  }
  /** Bounding box [w,s,e,n] of any GeoJSON object */
  function geojsonBBox(gj) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    (function walk(c) {
      if (typeof c[0] === 'number') {
        if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1];
        if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1];
      } else c.forEach(walk);
    })(collectCoords(gj));
    return b;
  }
  function collectCoords(gj) {
    if (gj.type === 'FeatureCollection') return gj.features.map(function (f) { return collectCoords(f); });
    if (gj.type === 'Feature') return collectCoords(gj.geometry);
    if (gj.type === 'GeometryCollection') return gj.geometries.map(collectCoords);
    return gj.coordinates;
  }
  function bufferBBox(b, d) { return [b[0] - d, b[1] - d, b[2] + d, b[3] + d]; }

  var api = { haversine: haversine, bearing: bearing, compass: compass, formatDistance: formatDistance,
    angleDiff: angleDiff, lon2tile: lon2tile, lat2tile: lat2tile, tileRanges: tileRanges,
    geojsonBBox: geojsonBBox, bufferBBox: bufferBBox, M_PER_YD: M_PER_YD, M_PER_MI: M_PER_MI };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Geo = api;
})(this);
