/* Hunt Scout registry normalizer + dedupe helpers. Pure functions (no DOM, no DB).
   window.Registry / module.exports.  Schema: see README "Registry schema". */
(function (root) {
  'use strict';
  var Geo = root.Geo || (typeof require !== 'undefined' ? require('./geo.js') : null);
  var POINTS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  var STAND_SUBTYPES = ['ladder', 'hang-on', 'ground blind', 'duck blind'];
  var MATCH_RADIUS_M = 75; // "same place" tolerance for name+location matching

  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function num(v) { var n = typeof v === 'string' ? parseFloat(v) : v; return typeof n === 'number' && isFinite(n) ? n : null; }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function normName(s) { return str(s).replace(/^truck\s*:\s*/i, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  /** ["n","nw"] | "N, NW" | "N/NW" -> ["N","NW"] (unknown tokens dropped, de-duplicated) */
  function normWinds(v) {
    if (v == null) return [];
    var arr = Array.isArray(v) ? v : String(v).split(/[\s,;\/|]+/);
    var out = [];
    arr.forEach(function (w) { w = str(w).toUpperCase(); if (POINTS.indexOf(w) >= 0 && out.indexOf(w) < 0) out.push(w); });
    return out;
  }
  function firstNonEmpty() {
    for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; if (a != null && !(Array.isArray(a) && !a.length) && a !== '') return a; }
    return undefined;
  }
  function coords(item) {
    var lat = num(firstNonEmpty(item.lat, item.latitude)), lon = num(firstNonEmpty(item.lon, item.lng, item.long, item.longitude));
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return [lat, lon];
  }
  function normType(t, subtype, bucket) {
    t = str(t).toLowerCase(); subtype = str(subtype).toLowerCase();
    if (bucket === 'parking' || /^(parking|truck|truck\/parking|park|gate)$/.test(t)) return 'parking';
    if (t === 'blind' || /blind/.test(subtype) || /blind/.test(t)) return 'blind';
    return 'stand';
  }

  /** One parking/stand item -> pin record (or null with reason). */
  function normPin(item, bucket, today) {
    if (!item || typeof item !== 'object') return { error: 'not an object' };
    var c = coords(item);
    if (!c) return { error: 'missing/invalid lat/lon for "' + str(item.name || item.id) + '"' };
    var rawType = str(item.type).toLowerCase();
    var subtype = str(item.subtype) || (STAND_SUBTYPES.indexOf(rawType) >= 0 ? rawType : '');
    var type = normType(rawType, subtype, bucket);
    var name = str(item.name) || (type === 'parking' ? 'Truck' : 'Stand');
    var id = str(item.id) || ((type === 'parking' ? 'parking-' : 'stand-') + slug(name));
    var pin = {
      id: id, name: name, type: type, subtype: type === 'parking' ? '' : subtype,
      lat: c[0], lon: c[1], notes: str(item.notes),
      // new fields win; legacy winds_work / winds_skip are only a fallback
      best_winds: normWinds(firstNonEmpty(item.best_winds, item.winds_work)),
      skip_winds: normWinds(firstNonEmpty(item.skip_winds, item.winds_skip)),
      updated: str(item.updated) || today, source: 'registry', extra: {}
    };
    ['access', 'land_access', 'last_hunted', 'last_sighting'].forEach(function (k) { if (str(item[k])) pin.extra[k] = str(item[k]); });
    return { pin: pin };
  }

  /** Route points may be [[lat,lon]], [[lon,lat]] (GeoJSON order) or [{lat,lon}]. Returns [[lat,lon]]. */
  function normPoints(points) {
    if (!Array.isArray(points)) return [];
    return points.map(function (p) {
      if (Array.isArray(p)) {
        var a = num(p[0]), b = num(p[1]); if (a == null || b == null) return null;
        // [lon,lat] if first value can't be a latitude, or (western hemisphere) a<0 while b>0
        if (Math.abs(a) > 90 || (a < 0 && b > 0 && Math.abs(b) <= 90)) return [b, a];
        return [a, b];
      }
      if (p && typeof p === 'object') { var c = coords(p); return c; }
      return null;
    }).filter(Boolean);
  }
  function normRoute(item, today) {
    if (!item || typeof item !== 'object') return { error: 'route not an object' };
    var name = str(item.name) || str(item.id) || 'Route';
    return { route: {
      id: str(item.id) || 'route-' + slug(name), name: name,
      from_id: str(item.from_id), to_id: str(item.to_id), gpx: str(item.gpx),
      bearing_deg: num(item.bearing_deg), back_bearing_deg: num(item.back_bearing_deg),
      distance_m: num(item.distance_m), straight_m: num(item.straight_m),
      winds_ok: normWinds(item.winds_ok), notes: str(item.notes),
      points: normPoints(item.points), updated: str(item.updated) || today, source: 'registry'
    } };
  }

  /** Normalize a whole stands.json. Tolerates missing arrays/fields; de-dupes ids within the file (last wins). */
  function normalizeRegistry(json, today) {
    today = today || new Date().toISOString().slice(0, 10);
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('stands.json must be a JSON object');
    var warnings = [], pins = {}, routes = {};
    if (json.schema_version != null && json.schema_version !== 1) warnings.push('schema_version ' + json.schema_version + ' (expected 1); importing what I can');
    [['parking', 'parking'], ['stands', 'stand']].forEach(function (pair) {
      var arr = json[pair[0]];
      if (arr == null) return;
      if (!Array.isArray(arr)) { warnings.push(pair[0] + ' is not a list; skipped'); return; }
      arr.forEach(function (it) {
        var r = normPin(it, pair[1], today);
        if (r.error) warnings.push(pair[0] + ': ' + r.error); else pins[r.pin.id] = r.pin;
      });
    });
    if (Array.isArray(json.routes)) json.routes.forEach(function (it) {
      var r = normRoute(it, today);
      if (r.error) warnings.push(r.error); else routes[r.route.id] = r.route;
    });
    return { schemaVersion: json.schema_version == null ? null : json.schema_version,
      pins: Object.keys(pins).map(function (k) { return pins[k]; }),
      routes: Object.keys(routes).map(function (k) { return routes[k]; }), warnings: warnings };
  }

  /** Coordinates to draw a registry route from inline points; endpoints come from the from/to pins. */
  function routeLine(route, pinsById) {
    var a = pinsById[route.from_id], b = pinsById[route.to_id], pts = (route.points || []).slice();
    if (a && !(pts.length && near(pts[0], [a.lat, a.lon], 3))) pts.unshift([a.lat, a.lon]);
    if (b && !(pts.length && near(pts[pts.length - 1], [b.lat, b.lon], 3))) pts.push([b.lat, b.lon]);
    return pts.length > 1 ? pts : [];
  }
  function near(p, q, m) { return Geo.haversine(p[0], p[1], q[0], q[1]) <= m; }

  /** GPX waypoint -> pin candidate. Understands Hunt Scout's "TRUCK: name" + "Type:/Works:/Skip:/Notes:" desc. */
  function waypointToPin(w, today) {
    var raw = str(w.name), desc = str(w.desc || w.cmt);
    var field = function (k) { var m = desc.match(new RegExp('^' + k + ':\\s*(.*)$', 'mi')); return m ? m[1].trim() : ''; };
    var isTruck = /^truck\s*:/i.test(raw) || /truck|parking|park(ed)?\b|gate|vehicle/i.test(raw + ' ' + w.sym + ' ' + w.type);
    var tField = field('Type').toLowerCase();
    var subtype = STAND_SUBTYPES.indexOf(tField) >= 0 ? tField : '';
    var type = isTruck ? 'parking' : (tField === 'blind' || /blind/.test(tField + ' ' + raw.toLowerCase()) ? 'blind' : 'stand');
    var name = raw.replace(/^truck\s*:\s*/i, '') || (type === 'parking' ? 'Truck' : 'Waypoint');
    var notes = field('Notes') || (field('Type') ? '' : desc);
    return { id: 'gpx-' + slug(name) + '-' + w.lat.toFixed(5) + '-' + w.lon.toFixed(5), name: name, type: type,
      subtype: type === 'parking' ? '' : subtype, lat: w.lat, lon: w.lon, notes: notes,
      best_winds: normWinds(field('Works') || field('Best')), skip_winds: normWinds(field('Skip')),
      updated: today || new Date().toISOString().slice(0, 10), source: 'gpx', extra: {} };
  }

  /** Find an existing pin that is "the same" as cand: same id, or same name within MATCH_RADIUS_M.
      Also treats a waypoint whose name/desc equals a pin id as a match. */
  function findMatch(cand, pins) {
    var i, p;
    for (i = 0; i < pins.length; i++) if (pins[i].id === cand.id) return pins[i];
    var n = normName(cand.name);
    for (i = 0; i < pins.length; i++) {
      p = pins[i];
      if (n && (normName(p.name) === n || normName(p.id) === n) &&
          Geo.haversine(p.lat, p.lon, cand.lat, cand.lon) <= MATCH_RADIUS_M) return p;
    }
    return null;
  }

  /** Plan an upsert of registry pins into existing pins. Returns {put:[], remove:[ids]}.
      - same id -> update (keeps created time)
      - no id match but a GPX-imported pin with same name nearby -> replace it (remove gpx id)  */
  function planPinUpsert(existing, incoming) {
    var byId = {}; existing.forEach(function (p) { byId[p.id] = p; });
    var put = [], remove = [], added = 0, updated = 0;
    incoming.forEach(function (np) {
      var old = byId[np.id];
      if (!old) {
        var m = findMatch(np, existing.filter(function (p) { return p.source === 'gpx' && remove.indexOf(p.id) < 0; }));
        if (m) { remove.push(m.id); old = m; }
      }
      var rec = Object.assign({}, np, { created: (old && old.created) || Date.now() });
      if (old) updated++; else added++;
      put.push(rec);
    });
    return { put: put, remove: remove, added: added, updated: updated };
  }

  var api = { slug: slug, normWinds: normWinds, normPoints: normPoints, normalizeRegistry: normalizeRegistry,
    routeLine: routeLine, waypointToPin: waypointToPin, findMatch: findMatch, planPinUpsert: planPinUpsert,
    MATCH_RADIUS_M: MATCH_RADIUS_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Registry = api;
})(this);
