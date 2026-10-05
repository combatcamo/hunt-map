/* Breadcrumb trail helpers. Auto-record while GPS watch is active.
   Cap: drop points older than MAX_AGE_MS or when > MAX_POINTS; thin by MIN_DIST_M. */
(function (root) {
  'use strict';
  var MAX_POINTS = 5000;
  var MAX_AGE_MS = 18 * 60 * 60 * 1000; // 18h
  var MIN_DIST_M = 12;
  var MAX_ACCURACY_M = 50; // ignore very inaccurate fixes

  function haversine(lat1, lon1, lat2, lon2) {
    if (root.Geo && root.Geo.haversine) return root.Geo.haversine(lat1, lon1, lat2, lon2);
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Should we keep this fix? prev may be null. */
  function shouldAccept(prev, lat, lon, accuracy, t) {
    if (!isFinite(lat) || !isFinite(lon)) return false;
    if (accuracy != null && accuracy > MAX_ACCURACY_M) return false;
    if (!prev) return true;
    if (t != null && prev.t != null && t < prev.t) return false;
    var d = haversine(prev.lat, prev.lon, lat, lon);
    return d >= MIN_DIST_M;
  }

  /** Drop old / excess points (keeps newest). Mutates and returns array. */
  function prune(points, now) {
    now = now || Date.now();
    var cutoff = now - MAX_AGE_MS;
    var kept = (points || []).filter(function (p) { return p && p.t >= cutoff; });
    if (kept.length > MAX_POINTS) kept = kept.slice(kept.length - MAX_POINTS);
    return kept;
  }

  function toLatLngs(points) {
    return (points || []).map(function (p) { return [p.lat, p.lon]; });
  }

  /** Optional GPX export of trail points. */
  function toGpx(points, name) {
    var nm = name || 'Hunt Map breadcrumb';
    var body = (points || []).map(function (p) {
      return '<trkpt lat="' + p.lat + '" lon="' + p.lon + '"><time>' +
        new Date(p.t).toISOString() + '</time>' +
        (p.accuracy != null ? '<extensions><accuracy>' + p.accuracy + '</accuracy></extensions>' : '') +
        '</trkpt>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="Hunt Map"><trk><name>' + nm + '</name><trkseg>' +
      body + '</trkseg></trk></gpx>';
  }

  var api = {
    MAX_POINTS: MAX_POINTS, MAX_AGE_MS: MAX_AGE_MS, MIN_DIST_M: MIN_DIST_M, MAX_ACCURACY_M: MAX_ACCURACY_M,
    shouldAccept: shouldAccept, prune: prune, toLatLngs: toLatLngs, toGpx: toGpx, haversine: haversine
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Trail = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
