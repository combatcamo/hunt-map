/* National Weather Service client (api.weather.gov). CORS: Access-Control-Allow-Origin: *.
   User-Agent is required. Caches ≥15 min in memory + Cache Storage ("hm-nws-v1").
   Hourly: windDirection (compass text), windSpeed ("N mph").
   Grid: windDirection degrees FROM, windSpeed/windGust km/h → mph. */
(function (root) {
  'use strict';
  var UA = 'HuntMap/1.1 (https://combatcamo.github.io/hunt-map/; github.com/combatcamo)';
  var CACHE = 'hm-nws-v1';
  var TTL_MS = 15 * 60 * 1000;
  var mem = {};
  var COMPASS = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };

  function headers() { return { 'User-Agent': UA, Accept: 'application/geo+json' }; }
  function key(kind, lat, lon) { return kind + ':' + (+lat).toFixed(3) + ',' + (+lon).toFixed(3); }
  function cacheUrl(k) { return new URL('offline-data/nws/' + encodeURIComponent(k) + '.json', root.location ? root.location.href : 'http://x/').href; }

  function getJSON(url) {
    return fetch(url, { mode: 'cors', credentials: 'omit', headers: headers() }).then(function (r) {
      if (!r.ok) throw new Error('NWS HTTP ' + r.status);
      return r.json();
    });
  }
  function readCache(k) {
    var m = mem[k];
    if (m && Date.now() - m.t < TTL_MS) return Promise.resolve(m.v);
    if (typeof caches === 'undefined') return Promise.resolve(null);
    return caches.open(CACHE).then(function (c) { return c.match(cacheUrl(k)); }).then(function (r) {
      if (!r) return null;
      var age = Date.now() - Date.parse(r.headers.get('X-Cached') || 0);
      if (age > TTL_MS) return null;
      return r.json().then(function (v) { mem[k] = { t: Date.now() - age, v: v }; return v; });
    }).catch(function () { return null; });
  }
  function writeCache(k, v) {
    mem[k] = { t: Date.now(), v: v };
    if (typeof caches === 'undefined') return Promise.resolve(v);
    var body = JSON.stringify(v);
    return caches.open(CACHE).then(function (c) {
      return c.put(cacheUrl(k), new Response(body, { headers: { 'Content-Type': 'application/json', 'X-Cached': new Date().toISOString() } }));
    }).then(function () { return v; }).catch(function () { return v; });
  }

  function points(lat, lon) {
    var k = key('pts', lat, lon);
    return readCache(k).then(function (hit) {
      if (hit) return hit;
      return getJSON('https://api.weather.gov/points/' + (+lat).toFixed(4) + ',' + (+lon).toFixed(4))
        .then(function (d) {
          var p = d.properties || {};
          return writeCache(k, { forecastHourly: p.forecastHourly, forecastGridData: p.forecastGridData, gridId: p.gridId, gridX: p.gridX, gridY: p.gridY });
        });
    });
  }

  function parseMph(s) {
    if (s == null) return null;
    var m = String(s).match(/([\d.]+)\s*mph/i);
    return m ? parseFloat(m[1]) : null;
  }
  function compassToDeg(t) { return COMPASS[String(t || '').trim().toUpperCase()]; }
  function kmhToMph(v) { return v == null ? null : Math.round(v / 1.609344 * 10) / 10; }

  function seriesAt(series, t) {
    var vals = (series && series.values) || [], ms = +new Date(t);
    for (var i = 0; i < vals.length; i++) {
      var vt = vals[i].validTime || '', slash = vt.indexOf('/');
      var start = Date.parse(slash >= 0 ? vt.slice(0, slash) : vt);
      var dur = slash >= 0 ? parseDurationMs(vt.slice(slash + 1)) : 3600000;
      if (ms >= start && ms < start + dur) return vals[i].value;
    }
    return null;
  }
  function parseDurationMs(iso) {
    var m = String(iso).match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
    if (!m) return 3600000;
    return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60) * 1000;
  }

  function hourly(lat, lon) {
    var k = key('hr', lat, lon);
    return readCache(k).then(function (hit) {
      if (hit) return hit;
      return points(lat, lon).then(function (p) {
        if (!p.forecastHourly) throw new Error('No hourly forecast URL');
        return getJSON(p.forecastHourly).then(function (d) {
          var periods = ((d.properties && d.properties.periods) || []).map(function (x) {
            return {
              startTime: x.startTime, endTime: x.endTime,
              windDirection: x.windDirection || '',
              windSpeed: x.windSpeed || '',
              speed_mph: parseMph(x.windSpeed),
              direction_deg_from: compassToDeg(x.windDirection),
              shortForecast: x.shortForecast || '', temperature: x.temperature, temperatureUnit: x.temperatureUnit
            };
          });
          return writeCache(k, { fetched: new Date().toISOString(), periods: periods });
        });
      });
    });
  }

  function gridWind(lat, lon, hours) {
    hours = hours || 24;
    var k = key('gw', lat, lon);
    return readCache(k).then(function (hit) {
      if (hit) return hit;
      return points(lat, lon).then(function (p) {
        if (!p.forecastGridData) throw new Error('No grid URL');
        return getJSON(p.forecastGridData).then(function (d) {
          var prop = d.properties || {};
          var now = Date.now(), out = [];
          for (var i = 0; i < hours; i++) {
            var t = new Date(now + i * 3600000).toISOString();
            var dir = seriesAt(prop.windDirection, t);
            var spd = seriesAt(prop.windSpeed, t);
            var gust = seriesAt(prop.windGust, t);
            out.push({ valid_time: t, direction_deg_from: dir, speed_mph: kmhToMph(spd), gust_mph: kmhToMph(gust) });
          }
          return writeCache(k, { fetched: new Date().toISOString(), hours: out });
        });
      });
    });
  }

  function standWind(lat, lon) {
    return Promise.all([
      hourly(lat, lon).catch(function (e) { return { error: e.message, periods: [] }; }),
      gridWind(lat, lon, 6).catch(function (e) { return { error: e.message, hours: [] }; })
    ]).then(function (pair) {
      var hr = pair[0], gw = pair[1], now = pair[0].periods && pair[0].periods[0];
      var g0 = gw.hours && gw.hours[0];
      return {
        fetched: hr.fetched || gw.fetched,
        compass: now ? now.windDirection : null,
        speed_text: now ? now.windSpeed : null,
        direction_deg_from: (g0 && g0.direction_deg_from != null) ? g0.direction_deg_from : (now && now.direction_deg_from),
        speed_mph: (g0 && g0.speed_mph != null) ? g0.speed_mph : (now && now.speed_mph),
        gust_mph: g0 && g0.gust_mph,
        shortForecast: now && now.shortForecast,
        temperature: now && now.temperature,
        temperatureUnit: now && now.temperatureUnit,
        hours: gw.hours || [],
        hourly: hr.periods || [],
        error: hr.error || gw.error || null
      };
    });
  }

  function clear() {
    mem = {};
    return typeof caches === 'undefined' ? Promise.resolve(false) : caches.delete(CACHE);
  }

  var api = { UA: UA, TTL_MS: TTL_MS, CACHE: CACHE, points: points, hourly: hourly, gridWind: gridWind, standWind: standWind,
    clear: clear, compassToDeg: compassToDeg, parseMph: parseMph, kmhToMph: kmhToMph, seriesAt: seriesAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NWS = api;
})(this);
