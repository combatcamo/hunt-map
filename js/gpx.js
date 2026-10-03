/* GPX 1.0/1.1 parser (trk, rte, wpt) using DOMParser. window.GPX / module.exports */
(function (root) {
  'use strict';
  function kids(el, name) {
    // namespace-agnostic child lookup
    var out = [], c = el.childNodes;
    for (var i = 0; i < c.length; i++) if (c[i].nodeType === 1 && (c[i].localName || c[i].nodeName) === name) out.push(c[i]);
    return out;
  }
  function all(doc, name) {
    var l = doc.getElementsByTagNameNS ? doc.getElementsByTagNameNS('*', name) : [];
    if (!l.length) l = doc.getElementsByTagName(name);
    return Array.prototype.slice.call(l);
  }
  function text(el, name) { var k = kids(el, name)[0]; return k ? (k.textContent || '').trim() : ''; }
  function pt(el) {
    var lat = parseFloat(el.getAttribute('lat')), lon = parseFloat(el.getAttribute('lon'));
    return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
  }
  /** Parse GPX text. Returns {name, tracks:[{name, desc, segments:[[[lat,lon],...]]}], waypoints:[{name,desc,cmt,sym,type,lat,lon}]} */
  function parse(xmlText, DOMParserImpl) {
    var P = DOMParserImpl || root.DOMParser;
    var doc = new P().parseFromString(xmlText, 'application/xml');
    if (all(doc, 'parsererror').length) throw new Error('Not a valid GPX/XML file');
    var gpx = all(doc, 'gpx')[0];
    if (!gpx) throw new Error('No <gpx> element found');
    var tracks = [];
    all(doc, 'trk').forEach(function (trk) {
      var segs = kids(trk, 'trkseg').map(function (s) { return kids(s, 'trkpt').map(pt).filter(Boolean); })
        .filter(function (s) { return s.length > 1; });
      if (segs.length) tracks.push({ name: text(trk, 'name'), desc: text(trk, 'desc'), kind: 'trk', segments: segs });
    });
    all(doc, 'rte').forEach(function (rte) {
      var p = kids(rte, 'rtept').map(pt).filter(Boolean);
      if (p.length > 1) tracks.push({ name: text(rte, 'name'), desc: text(rte, 'desc'), kind: 'rte', segments: [p] });
    });
    var waypoints = kids(gpx, 'wpt').map(function (w) {
      var p = pt(w); if (!p) return null;
      return { name: text(w, 'name'), desc: text(w, 'desc'), cmt: text(w, 'cmt'), sym: text(w, 'sym'),
        type: text(w, 'type'), lat: p[0], lon: p[1] };
    }).filter(Boolean);
    var meta = kids(gpx, 'metadata')[0];
    return { name: (meta && text(meta, 'name')) || '', tracks: tracks, waypoints: waypoints };
  }
  var api = { parse: parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GPX = api;
})(this);
