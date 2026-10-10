/* Hunt Map – main app. Plain JS, no build step. */
(function () {
  'use strict';
  var WMA_CENTER = [35.205, -93.57], WMA_ZOOM = 11;
  var TYPES = {
    stand:   { label: 'Stand',   color: '#ff9f1a', glyph: '<path d="M14 10 L14 34 M30 10 L30 34 M14 16 H30 M14 23 H30 M14 30 H30" stroke="#000" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M10 10 H34" stroke="#000" stroke-width="4" stroke-linecap="round"/>' },
    blind:   { label: 'Blind',   color: '#3ddc84', glyph: '<path d="M8 33 L22 9 L36 33 Z" fill="#000"/><rect x="18" y="22" width="8" height="5" fill="#3ddc84"/>' },
    parking: { label: 'Truck',   color: '#2f8cff', glyph: '<path d="M7 27 V18 H24 V27 M24 21 H30 L36 25 V27 H24" stroke="#000" stroke-width="3" fill="none" stroke-linejoin="round"/><circle cx="13" cy="29" r="3.3" fill="#000"/><circle cx="30" cy="29" r="3.3" fill="#000"/>' },
    water:   { label: 'Water',   color: '#29b6f6', glyph: '<path d="M22 8 C22 8 10 20 10 27 a12 12 0 0 0 24 0 C34 20 22 8 22 8Z" fill="#000"/>' },
    food:    { label: 'Food',    color: '#c6ff00', glyph: '<circle cx="22" cy="22" r="10" fill="#000"/><path d="M22 12 v20 M12 22 h20" stroke="#c6ff00" stroke-width="3"/>' },
    scrape:  { label: 'Scrape',  color: '#ff8a65', glyph: '<ellipse cx="22" cy="26" rx="12" ry="6" fill="#000"/><path d="M14 18 h16" stroke="#000" stroke-width="3"/>' },
    rub:     { label: 'Rub',     color: '#ce93d8', glyph: '<path d="M16 34 V14 h6 v20 M26 34 V18 h6 v16" stroke="#000" stroke-width="3" fill="none"/>' }
  };
  var SUBTYPES = ['', 'ladder', 'hang-on', 'ground blind', 'duck blind'];
  var BASE_ORDER = ['topo', 'aerial', 'hybrid'];
  var BASE_LABEL = { topo: 'Topo', aerial: 'Aerial', hybrid: 'Hybrid' };
  var ATTRIB = 'Tiles: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a> (public domain) | WMA: AGFC | Parcels: AR GIS Office | MVUM: USFS';
  var PARCEL_NOTE = 'Tax-map parcel lines are approximate and are not legal boundaries.';

  var S = {
    map: null, base: null, settings: { basemap: 'topo', night: false, boundary: true, parcels: false, mvum: false, view: null },
    pins: [], routes: [], markers: {}, routeLayers: {}, overlays: {}, overlayState: {},
    me: null, meMarker: null, meCircle: null, follow: false, heading: null, headingSrc: '', compassOn: false,
    nav: null, navLine: null, dl: null
  };
  window.HuntMap = S; // for debugging/tests

  // ---------- utils ----------
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, ms || 2600);
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); }
  function recency(p) { return Math.max(p.created || 0, Date.parse(p.updated || '') || 0); }
  function fmtMB(b) { return b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : Math.round(b / 1e6) + ' MB'; }
  function saveSettings() { return DB.setSetting('settings', S.settings); }
  function readFile(f) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; r.readAsText(f); }); }
  function downloadFile(name, text, type) {
    var blob = new Blob([text], { type: type || 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function pinSvg(type) {
    var t = TYPES[type] || TYPES.stand;
    var shape = type === 'parking' ? '<rect x="2" y="2" width="40" height="40" rx="9" fill="' + t.color + '" stroke="#fff" stroke-width="3"/>'
      : type === 'blind' ? '<path d="M22 1 L43 22 L22 43 L1 22 Z" fill="' + t.color + '" stroke="#fff" stroke-width="3"/>'
      : '<circle cx="22" cy="22" r="20" fill="' + t.color + '" stroke="#fff" stroke-width="3"/>';
    return '<svg viewBox="0 0 44 44">' + shape + t.glyph + '</svg>';
  }

  // ---------- sheet ----------
  function openSheet(html, bind) {
    $('sheet-body').innerHTML = html; $('sheet').hidden = false; $('sheet-backdrop').hidden = false;
    $('sheet').scrollTop = 0; if (bind) bind($('sheet-body'));
  }
  function closeSheet() { $('sheet').hidden = true; $('sheet-backdrop').hidden = true; $('sheet-body').innerHTML = ''; }
  function confirmSheet(title, text, okLabel, onOk) {
    openSheet('<h2>' + esc(title) + '</h2><p>' + esc(text) + '</p><div class="row" style="margin-top:14px">' +
      '<button id="c-no">Cancel</button><button id="c-yes" class="danger">' + esc(okLabel) + '</button></div>', function (el) {
      el.querySelector('#c-no').onclick = closeSheet;
      el.querySelector('#c-yes').onclick = function () { closeSheet(); onOk(); };
    });
  }

  // ---------- map ----------
  function initMap() {
    var v = S.settings.view;
    S.map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 19, minZoom: 8,
      center: v ? [v.lat, v.lon] : WMA_CENTER, zoom: v ? v.z : WMA_ZOOM, tap: true, worldCopyJump: false });
    S.map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    L.control.scale({ imperial: true, metric: false, position: 'bottomleft' }).addTo(S.map);
    S.canvas = L.canvas({ padding: 0.3, tolerance: 10 });
    setBasemap(S.settings.basemap);
    S.map.on('dragstart', function () { if (S.follow) { S.follow = false; $('btn-center').classList.remove('following'); } });
    var lbl = function () { S.map.getContainer().classList.toggle('labels-off', S.map.getZoom() < 14); };
    S.map.on('zoomend', lbl); lbl();
    S.map.on('moveend', function () {
      var c = S.map.getCenter(); S.settings.view = { lat: c.lat, lon: c.lng, z: S.map.getZoom() }; saveSettings();
    });
  }
  function setBasemap(key) {
    if (!Offline.BASEMAPS[key]) key = 'topo';
    if (S.base) S.map.removeLayer(S.base);
    S.base = L.tileLayer(Offline.BASEMAPS[key].url, {
      maxNativeZoom: 16, maxZoom: 19, crossOrigin: true, attribution: ATTRIB, keepBuffer: 3,
      errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
    }).addTo(S.map);
    S.base.bringToBack();
    document.body.classList.remove('base-topo', 'base-aerial', 'base-hybrid'); document.body.classList.add('base-' + key);
    S.settings.basemap = key; $('lbl-basemap').textContent = BASE_LABEL[key]; saveSettings();
  }

  // ---------- overlays ----------
  var OVERLAYS = {
    boundary: { url: 'data/wma-boundary.geojson', label: 'WMA boundary', make: function (gj) {
      return L.geoJSON(gj, { interactive: false, style: { color: '#ffea00', weight: 3.5, opacity: 0.95, fill: false, dashArray: '10 6' } }); } },
    mvum: { url: 'data/mvum.geojson', label: 'USFS MVUM roads/trails', make: function (gj) {
      return L.geoJSON(gj, { renderer: S.canvas, style: function (f) {
          var s = (f.properties.mvum_symbol_name || '').toLowerCase();
          return { color: f.properties.kind === 'trail' ? '#00e5ff' : /all vehicles/.test(s) ? '#7CFC00' : /highway legal/.test(s) ? '#ffffff' : '#ffb000',
            weight: 3, opacity: 0.9, dashArray: /seasonal/.test(s) ? '6 5' : null };
        },
        onEachFeature: function (f, layer) {
          var p = f.properties;
          layer.bindPopup('<b>' + esc(p.name || 'Road') + '</b> ' + (p.id ? '(FS ' + esc(p.id) + ')' : '') + '<br>' + esc(p.mvum_symbol_name || '') +
            (p.passengervehicle ? '<br>Cars: ' + esc(p.passengervehicle) + ' ' + esc(p.passengervehicle_datesopen || '') : '') +
            (p.atv ? '<br>ATV: ' + esc(p.atv) + ' ' + esc(p.atv_datesopen || '') : '') +
            '<div class="popup-note">USFS MVUM snapshot. Check the current MVUM and posted signs.</div>');
        } }); } }
  };
  function installScoutOverlays() {
    if (!window.Layers) return;
    Layers.SCOUT_OVERLAYS.forEach(function (spec) {
      OVERLAYS[spec.id] = {
        url: spec.file,
        label: spec.label,
        scout: true,
        make: function (gj) { return Layers.makeOverlay(spec, gj, L); }
      };
    });
    OVERLAYS.top10 = {
      url: Layers.TOP10_FILE,
      label: 'Top 10 stands (Scout)',
      scout: true,
      make: function (gj) { return Layers.makeOverlay({ id: 'top10', kind: 'point', color: '#ff9f1a', label: 'Top 10' }, Layers.normalizeTop10(gj), L); }
    };
  }

    // ----- parcels: never bundled; downloaded on the phone (Offline maps) or queried live -----
  function makeParcelLayer(gj) {
    return L.geoJSON(gj, { renderer: S.canvas, style: { color: '#ff40ff', weight: 1.4, opacity: 0.9, fillOpacity: 0.02 },
      onEachFeature: function (f, layer) {
        var p = f.properties || {};
        layer.bindPopup('<b>' + esc(p.owner || 'Owner not listed') + '</b><br>' +
          (p.acres != null ? esc(p.acres) + ' ac (computed)<br>' : '') +
          (p.parcelid ? 'Parcel ' + esc(p.parcelid) + '<br>' : '') + (p.str ? esc(p.str) + ' · ' : '') + esc(p.county || '') +
          '<div class="popup-note">' + PARCEL_NOTE + '</div>');
      } });
  }
  function parcelNote(extra) { var n = $('parcel-note'); n.textContent = PARCEL_NOTE + (extra ? ' ' + extra : ''); n.hidden = false; }
  function dropParcelLayer() {
    if (S.overlays.parcels) S.map.removeLayer(S.overlays.parcels);
    S.overlays.parcels = null; S.parcelSource = null;
    if (S.parcelMoveHandler) { S.map.off('moveend', S.parcelMoveHandler); S.parcelMoveHandler = null; }
    if (S.parcelLiveCtl) { S.parcelLiveCtl.abort(); S.parcelLiveCtl = null; }
  }
  function liveParcels() {
    if (!S.settings.parcels || S.parcelSource !== 'live') return;
    if (S.map.getZoom() < 14) { parcelNote('(Live: zoom in closer to load parcels.)'); return; }
    if (S.parcelLiveCtl) S.parcelLiveCtl.abort();
    var ctl = S.parcelLiveCtl = new AbortController(), b = S.map.getBounds();
    parcelNote('(Live, loading…)');
    Parcels.queryView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], ctl.signal).then(function (gj) {
      if (ctl.signal.aborted || S.parcelSource !== 'live') return;
      if (S.overlays.parcels) S.map.removeLayer(S.overlays.parcels);
      S.overlays.parcels = makeParcelLayer(gj).addTo(S.map); S.overlayState.parcels = 'live';
      parcelNote('(Live view only, not saved offline. Download with More → Offline maps.)');
    }).catch(function (e) { if (!ctl.signal.aborted) parcelNote('(Live parcel query failed: ' + e.message + ')'); });
  }
  function setParcels(on) {
    S.settings.parcels = on; saveSettings();
    dropParcelLayer();
    if (!on) { $('parcel-note').hidden = true; return Promise.resolve(); }
    S.overlayState.parcels = 'loading';
    return Parcels.loadLocal().catch(function () { return null; }).then(function (gj) {
      if (!S.settings.parcels) return;
      if (gj && gj.features) {
        S.overlays.parcels = makeParcelLayer(gj).addTo(S.map); S.parcelSource = 'local'; S.overlayState.parcels = 'loaded';
        parcelNote(); return;
      }
      if (navigator.onLine) {
        S.parcelSource = 'live'; S.parcelMoveHandler = function () { clearTimeout(S._pt); S._pt = setTimeout(liveParcels, 600); };
        S.map.on('moveend', S.parcelMoveHandler); liveParcels(); return;
      }
      S.overlayState.parcels = 'missing';
      parcelNote('(Not downloaded yet: use More → Offline maps while online.)');
      toast('Parcels not downloaded yet. Use More → Offline maps while online.', 4000);
    });
  }
  function setOverlay(key, on) {
    if (key === 'parcels') return setParcels(on);
    S.settings[key] = on; saveSettings();
    var def = OVERLAYS[key];
    if (!on) { if (S.overlays[key]) S.map.removeLayer(S.overlays[key]); return Promise.resolve(); }
    if (S.overlays[key]) { S.overlays[key].addTo(S.map); return Promise.resolve(); }
    S.overlayState[key] = 'loading';
    return fetch(def.url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (gj) {
      S.overlays[key] = def.make(gj); S.overlayState[key] = 'loaded';
      if (S.settings[key]) S.overlays[key].addTo(S.map);
      if (key === 'boundary') S.boundaryGeojson = gj;
    }).catch(function (e) {
      S.overlayState[key] = 'missing';
      if (key === 'boundary') toast('Boundary not loaded (data/wma-boundary.geojson missing)');
    });
  }

  // ---------- GPS + compass ----------
  function startGPS() {
    if (!('geolocation' in navigator)) { $('st-gps').textContent = 'GPS: not available'; return; }
    $('st-gps').textContent = 'GPS: searching…';
    S.watchId = navigator.geolocation.watchPosition(onPos, function (err) {
      $('st-gps').textContent = err.code === 1 ? 'GPS: permission denied' : 'GPS: no fix';
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }
  function onPos(pos) {
    var c = pos.coords;
    S.me = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, course: c.heading, speed: c.speed, t: pos.timestamp };
    recordCrumb(S.me);
    var ll = [c.latitude, c.longitude];
    if (!S.meMarker) {
      S.meCircle = L.circle(ll, { radius: c.accuracy, color: '#1e90ff', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(S.map);
      S.meMarker = L.marker(ll, { interactive: false, zIndexOffset: 1000, icon: L.divIcon({ className: 'me-ico', iconSize: [64, 64],
        html: '<div class="me-head" id="me-head" hidden><svg viewBox="0 0 64 64"><path d="M32 2 L44 26 L32 21 L20 26 Z" fill="#1e90ff" stroke="#fff" stroke-width="2"/></svg></div><div class="me-dot"></div>' }) }).addTo(S.map);
    } else { S.meMarker.setLatLng(ll); S.meCircle.setLatLng(ll).setRadius(c.accuracy); }
    // without a compass, use GPS course while walking
    if (!S.compassOn && c.heading != null && !isNaN(c.heading) && c.speed > 0.7) { S.heading = c.heading; S.headingSrc = 'gps'; }
    $('st-gps').textContent = 'GPS ±' + Math.round(c.accuracy / Geo.M_PER_YD) + ' yd';
    if (S.follow) S.map.panTo(ll, { animate: true });
    renderHeading(); updateNav();
  }
  function needsCompassPermission() {
    return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
  }
  /** Must be called from a tap on iOS. */
  function enableCompass(fromTap) {
    if (S.compassOn) return Promise.resolve(true);
    if (typeof DeviceOrientationEvent === 'undefined') return Promise.resolve(false);
    var p = needsCompassPermission() ? DeviceOrientationEvent.requestPermission() : Promise.resolve('granted');
    return p.then(function (state) {
      if (state !== 'granted') { if (fromTap) toast('Compass permission denied'); return false; }
      var onOri = function (e) {
        var h = null;
        if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading; // iOS: degrees from magnetic north
        else if (e.absolute && e.alpha != null) h = 360 - e.alpha; // Android absolute
        if (h == null) return;
        var so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
        S.heading = (h + so + 360) % 360; S.headingSrc = 'compass'; S.compassOn = true;
        renderHeading(); updateNav();
      };
      if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOri, true);
      window.addEventListener('deviceorientation', onOri, true);
      S.compassListening = true;
      return true;
    }).catch(function () { return false; });
  }
  function renderHeading() {
    var el = document.getElementById('me-head');
    if (!el) return;
    if (S.heading == null) { el.hidden = true; return; }
    el.hidden = false; el.style.transform = 'rotate(' + S.heading + 'deg)';
  }

  // ---------- pins ----------
  function loadPins() { return DB.all('pins').then(function (p) { S.pins = p || []; renderPins(); }); }
  function renderPins() {
    Object.keys(S.markers).forEach(function (id) { S.map.removeLayer(S.markers[id]); });
    S.markers = {};
    S.pins.forEach(function (p) {
      var m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'pin-ico', html: pinSvg(p.type), iconSize: [44, 44], iconAnchor: [22, 22] }), title: p.name });
      m.bindTooltip(esc(p.name), { permanent: true, direction: 'bottom', offset: [0, 18], className: 'pin-label' });
      m.on('click', function () { showPin(p.id); });
      m.addTo(S.map); S.markers[p.id] = m;
    });
  }
  function getPin(id) { for (var i = 0; i < S.pins.length; i++) if (S.pins[i].id === id) return S.pins[i]; return null; }
  function savePin(p) {
    return DB.put('pins', p).then(function () {
      var i = S.pins.findIndex(function (x) { return x.id === p.id; });
      if (i >= 0) S.pins[i] = p; else S.pins.push(p);
      renderPins(); updateNav();
    });
  }
  function deletePin(id) {
    return DB.del('pins', id).then(function () {
      S.pins = S.pins.filter(function (p) { return p.id !== id; }); renderPins();
      if (S.nav && S.nav.pinId === id) stopNav();
    });
  }
  function windsHtml(p) {
    var h = '';
    if (p.best_winds && p.best_winds.length) h += '<dt>Best winds</dt><dd class="winds-best">' + esc(p.best_winds.join(', ')) + '</dd>';
    if (p.skip_winds && p.skip_winds.length) h += '<dt>Skip winds</dt><dd class="winds-skip">' + esc(p.skip_winds.join(', ')) + '</dd>';
    return h;
  }
  function showPin(id) {
    var p = getPin(id); if (!p) return;
    var t = TYPES[p.type] || TYPES.stand, rel = '';
    if (S.me) {
      var d = Geo.haversine(S.me.lat, S.me.lon, p.lat, p.lon), b = Geo.bearing(S.me.lat, S.me.lon, p.lat, p.lon), f = Geo.formatDistance(d);
      rel = '<dt>From me</dt><dd>' + f.main + (f.sub ? ' (' + f.sub + ')' : '') + ' · ' + Math.round(b) + '° ' + Geo.compass(b) + '</dd>';
    }
    var extra = '';
    var X = p.extra || {}, names = { access: 'Access', land_access: 'Land', last_hunted: 'Last hunted', last_sighting: 'Last sighting' };
    Object.keys(names).forEach(function (k) { if (X[k]) extra += '<dt>' + names[k] + '</dt><dd>' + esc(X[k]) + '</dd>'; });
    openSheet('<h2 style="display:flex;gap:10px;align-items:center"><span style="width:40px;height:40px;display:inline-block">' + pinSvg(p.type) + '</span>' + esc(p.name) + '</h2>' +
      '<dl class="kv"><dt>Type</dt><dd>' + esc(t.label) + (p.subtype ? ' · ' + esc(p.subtype) : '') + '</dd>' + windsHtml(p) +
      (p.notes ? '<dt>Notes</dt><dd>' + esc(p.notes) + '</dd>' : '') + rel + extra +
      '<dt>Lat, lon</dt><dd>' + p.lat.toFixed(5) + ', ' + p.lon.toFixed(5) + '</dd></dl>' +
      '<div class="col"><button class="primary" id="p-nav">Navigate here</button>' +
      '<div class="row"><button id="p-edit">Edit</button><button id="p-del" class="danger">Delete</button></div>' +
      '<button id="p-close">Close</button></div>', function (el) {
      el.querySelector('#p-nav').onclick = function () { closeSheet(); startNav(p.id); };
      el.querySelector('#p-edit').onclick = function () { editPin(p); };
      el.querySelector('#p-del').onclick = function () {
        confirmSheet('Delete pin?', 'Delete "' + p.name + '"? This cannot be undone.', 'Delete', function () { deletePin(p.id).then(function () { toast('Pin deleted'); }); });
      };
      el.querySelector('#p-close').onclick = closeSheet;
    });
  }
  /** Add (p = null) or edit a pin. */
  function editPin(p) {
    var isNew = !p;
    var center = S.map.getCenter();
    var draft = p ? Object.assign({}, p) : { type: 'stand', name: '', notes: '', subtype: '', best_winds: [], skip_winds: [] };
    var where = 'center';
    var html = '<h2>' + (isNew ? 'Add pin' : 'Edit pin') + '</h2>' +
      '<div class="row" id="e-types">' + ['stand', 'blind', 'parking', 'water', 'food', 'scrape', 'rub'].map(function (k) {
        return '<button class="typebtn' + (draft.type === k ? ' sel' : '') + '" data-type="' + k + '">' + pinSvg(k) + TYPES[k].label + '</button>';
      }).join('') + '</div>' +
      (isNew ? '<h3>Where</h3><div class="row"><button id="e-at-center" class="sel">Crosshair</button><button id="e-at-gps"' + (S.me ? '' : ' disabled') + '>My GPS' + (S.me ? ' ±' + Math.round(S.me.acc / Geo.M_PER_YD) + 'yd' : '') + '</button></div>' +
        '<p class="muted" id="e-where">' + center.lat.toFixed(5) + ', ' + center.lng.toFixed(5) + '</p>' : '') +
      '<label class="field" for="e-name">Name</label><input type="text" id="e-name" maxlength="60" placeholder="e.g. Ridge ladder" value="' + esc(draft.name) + '">' +
      '<div id="e-subwrap"><label class="field" for="e-sub">Kind</label><div class="row" id="e-sub" style="flex-wrap:wrap">' +
      SUBTYPES.map(function (s) { return '<button class="small' + ((draft.subtype || '') === s ? ' sel' : '') + '" data-sub="' + s + '">' + (s || 'none') + '</button>'; }).join('') + '</div></div>' +
      '<label class="field" for="e-notes">Notes</label><textarea id="e-notes" maxlength="1000">' + esc(draft.notes) + '</textarea>' +
      '<div id="e-windwrap"><label class="field" for="e-best">Best winds (e.g. N, NW)</label><input type="text" id="e-best" value="' + esc((draft.best_winds || []).join(', ')) + '">' +
      '<label class="field" for="e-skip">Skip winds</label><input type="text" id="e-skip" value="' + esc((draft.skip_winds || []).join(', ')) + '"></div>' +
      '<div class="row" style="margin-top:14px"><button id="e-cancel">Cancel</button><button class="primary" id="e-save">Save</button></div>';
    openSheet(html, function (el) {
      function syncType() { el.querySelector('#e-subwrap').hidden = el.querySelector('#e-windwrap').hidden = draft.type === 'parking'; }
      syncType();
      el.querySelectorAll('#e-types button').forEach(function (b) {
        b.onclick = function () { draft.type = b.dataset.type; el.querySelectorAll('#e-types button').forEach(function (x) { x.classList.toggle('sel', x === b); }); syncType(); };
      });
      el.querySelectorAll('#e-sub button').forEach(function (b) {
        b.onclick = function () { draft.subtype = b.dataset.sub; el.querySelectorAll('#e-sub button').forEach(function (x) { x.classList.toggle('sel', x === b); }); };
      });
      if (isNew) {
        var bc = el.querySelector('#e-at-center'), bg = el.querySelector('#e-at-gps');
        bc.onclick = function () { where = 'center'; bc.classList.add('sel'); bg.classList.remove('sel'); el.querySelector('#e-where').textContent = center.lat.toFixed(5) + ', ' + center.lng.toFixed(5); };
        bg.onclick = function () { if (!S.me) return; where = 'gps'; bg.classList.add('sel'); bc.classList.remove('sel'); el.querySelector('#e-where').textContent = S.me.lat.toFixed(5) + ', ' + S.me.lon.toFixed(5) + ' (GPS)'; };
      }
      el.querySelector('#e-cancel').onclick = closeSheet;
      el.querySelector('#e-save').onclick = function () {
        var name = el.querySelector('#e-name').value.trim();
        if (!name) { var n = S.pins.filter(function (x) { return x.type === draft.type; }).length + 1; name = TYPES[draft.type].label + ' ' + n; }
        var rec = Object.assign({}, draft, { name: name, notes: el.querySelector('#e-notes').value.trim(), updated: today() });
        if (rec.type === 'parking') { rec.subtype = ''; }
        else { rec.best_winds = Registry.normWinds(el.querySelector('#e-best').value); rec.skip_winds = Registry.normWinds(el.querySelector('#e-skip').value); }
        if (isNew) {
          var ll = where === 'gps' && S.me ? [S.me.lat, S.me.lon] : [center.lat, center.lng];
          rec.id = uid(rec.type === 'parking' ? 'parking' : 'pin'); rec.lat = ll[0]; rec.lon = ll[1];
          rec.created = Date.now(); rec.source = 'user'; rec.extra = {};
        }
        savePin(rec).then(function () { closeSheet(); toast(isNew ? 'Pin saved' : 'Pin updated'); });
      };
    });
  }

  // ---------- navigation ----------
  function parkingPins() { return S.pins.filter(function (p) { return p.type === 'parking'; }).sort(function (a, b) { return recency(b) - recency(a); }); }
  function startNav(pinId) {
    var p = getPin(pinId); if (!p) return;
    S.nav = { pinId: pinId }; $('nav').hidden = false; $('nav-target').textContent = (p.type === 'parking' ? 'Back to ' : 'To ') + p.name;
    if (!S.compassOn && needsCompassPermission()) $('nav-hint').textContent = 'Tap “Me” to turn on the compass';
    updateNav();
  }
  function stopNav() { S.nav = null; $('nav').hidden = true; if (S.navLine) { S.map.removeLayer(S.navLine); S.navLine = null; } }
  function updateNav() {
    if (!S.nav) return;
    var p = getPin(S.nav.pinId); if (!p) return stopNav();
    if (!S.me) { $('nav-bearing').textContent = '—'; $('nav-dist').textContent = 'Waiting for GPS…'; return; }
    var d = Geo.haversine(S.me.lat, S.me.lon, p.lat, p.lon), b = Geo.bearing(S.me.lat, S.me.lon, p.lat, p.lon), f = Geo.formatDistance(d);
    $('nav-bearing').textContent = Math.round(b) + '° ' + Geo.compass(b);
    $('nav-dist').textContent = f.main + (f.sub ? '  ·  ' + f.sub : '');
    var rot = S.heading == null ? b : b - S.heading;
    $('nav-arrow').style.transform = 'rotate(' + rot + 'deg)';
    $('nav-hint').textContent = S.heading == null ? 'No compass: arrow is relative to map north (top). Bearings are true north.'
      : (S.headingSrc === 'gps' ? 'Arrow uses GPS travel direction (keep walking).' : 'Arrow uses phone compass. Hold phone flat.') + (S.me.acc > 30 ? ' Weak GPS.' : '');
    var ll = [[S.me.lat, S.me.lon], [p.lat, p.lon]];
    if (!S.navLine) S.navLine = L.polyline(ll, { color: '#ff9f1a', weight: 3, dashArray: '8 8', interactive: false }).addTo(S.map);
    else S.navLine.setLatLngs(ll);
  }
  function backToTruck() {
    var list = parkingPins();
    if (!list.length) { toast('No truck pin yet. Tap Pin → Truck to drop one.', 3500); return; }
    startNav(list[0].id);
  }
  function chooseTarget() {
    var list = parkingPins().concat(S.pins.filter(function (p) { return p.type !== 'parking'; }));
    openSheet('<h2>Navigate to…</h2>' + (list.length ? list.map(function (p) {
      return '<div class="list-item"><span style="width:36px;height:36px">' + pinSvg(p.type) + '</span><div class="grow"><div class="t">' + esc(p.name) + '</div><div class="s">' + esc(TYPES[p.type].label) + '</div></div><button class="small" data-go="' + esc(p.id) + '">Go</button></div>';
    }).join('') : '<p class="muted">No pins yet.</p>') + '<button id="t-close" style="width:100%;margin-top:12px">Close</button>', function (el) {
      el.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { closeSheet(); startNav(b.dataset.go); }; });
      el.querySelector('#t-close').onclick = closeSheet;
    });
  }

  // ---------- routes ----------
  function loadRoutes() { return DB.all('routes').then(function (r) { S.routes = r || []; renderRoutes(); }); }
  function renderRoutes() {
    Object.keys(S.routeLayers).forEach(function (id) { S.map.removeLayer(S.routeLayers[id]); });
    S.routeLayers = {};
    S.routes.forEach(function (r) {
      if (r.visible === false || !r.segments || !r.segments.length) return;
      var lyr = L.polyline(r.segments, { color: r.source === 'registry' ? '#ff6a00' : '#00e5ff', weight: 5, opacity: 0.9 });
      var info = '<b>' + esc(r.name) + '</b>';
      if (r.distance_m) info += '<br>Walk: ' + Geo.formatDistance(r.distance_m).main;
      if (r.bearing_deg != null) info += '<br>Truck → stand: ' + Math.round(r.bearing_deg) + '° ' + Geo.compass(r.bearing_deg);
      if (r.back_bearing_deg != null) info += '<br>Back to truck: ' + Math.round(r.back_bearing_deg) + '° ' + Geo.compass(r.back_bearing_deg) + (r.straight_m ? ', ' + Geo.formatDistance(r.straight_m).main + ' straight' : '');
      if (r.winds_ok && r.winds_ok.length) info += '<br>Winds OK: ' + esc(r.winds_ok.join(', '));
      lyr.bindPopup(info); lyr.addTo(S.map); S.routeLayers[r.id] = lyr;
    });
  }
  function putRoutes(list) {
    return DB.putMany('routes', list).then(function () {
      list.forEach(function (r) { var i = S.routes.findIndex(function (x) { return x.id === r.id; }); if (i >= 0) S.routes[i] = r; else S.routes.push(r); });
      renderRoutes();
    });
  }
  function routeLength(segs) { var m = 0; segs.forEach(function (s) { for (var i = 1; i < s.length; i++) m += Geo.haversine(s[i - 1][0], s[i - 1][1], s[i][0], s[i][1]); }); return m; }

  /** Import standalone GPX files: tracks/routes -> routes (upsert by file+index); waypoints -> optional pins (deduped). */
  function importGpxFiles(files) {
    var newRoutes = [], cands = [], skippedTracks = 0, errors = [];
    var regNames = S.routes.map(function (r) { return (r.name || '').toLowerCase(); });
    return Promise.all(Array.prototype.map.call(files, function (f) {
      return readFile(f).then(function (txt) {
        var g; try { g = GPX.parse(txt); } catch (e) { errors.push(f.name + ': ' + e.message); return; }
        g.tracks.forEach(function (t, i) {
          var name = t.name || g.name || f.name.replace(/\.gpx$/i, '');
          var id = 'gpx-' + Registry.slug(f.name) + '-' + i;
          // stands.gpx from Hunt Scout repeats registry routes: don't duplicate them
          if (regNames.indexOf(name.toLowerCase()) >= 0 && !S.routes.some(function (r) { return r.id === id; })) { skippedTracks++; return; }
          newRoutes.push({ id: id, name: name, segments: t.segments, visible: true, source: 'gpx', file: f.name,
            distance_m: Math.round(routeLength(t.segments)), created: Date.now(), updated: today() });
        });
        g.waypoints.forEach(function (w) { cands.push(Registry.waypointToPin(w, today())); });
      });
    })).then(function () {
      return putRoutes(newRoutes);
    }).then(function () {
      if (newRoutes.length) { var b = L.latLngBounds([]); newRoutes.forEach(function (r) { r.segments.forEach(function (s) { b.extend(s); }); }); S.map.fitBounds(b, { padding: [40, 40], maxZoom: 16 }); }
      var fresh = [], dup = 0, pool = S.pins.slice();
      cands.forEach(function (c) { if (Registry.findMatch(c, pool)) dup++; else { fresh.push(c); pool.push(c); } });
      var msg = newRoutes.length + ' route(s) imported' + (skippedTracks ? ', ' + skippedTracks + ' already in registry' : '') + (errors.length ? '. Errors: ' + errors.join('; ') : '');
      if (!fresh.length) { toast(msg + (dup ? '. ' + dup + ' waypoint(s) already pinned.' : ''), 4000); return { routes: newRoutes.length, pinsAdded: 0, dup: dup }; }
      return new Promise(function (resolve) {
        openSheet('<h2>GPX imported</h2><p>' + esc(msg) + '.</p><p>This file has <b>' + fresh.length + '</b> new waypoint(s)' + (dup ? ' (' + dup + ' already pinned, skipped)' : '') + '.</p>' +
          '<div class="col">' + fresh.slice(0, 30).map(function (c) { return '<div class="list-item"><span style="width:32px;height:32px">' + pinSvg(c.type) + '</span><div class="grow t">' + esc(c.name) + '</div></div>'; }).join('') +
          '<button class="primary" id="w-add">Add ' + fresh.length + ' as pins</button><button id="w-skip">Skip</button></div>', function (el) {
          el.querySelector('#w-add').onclick = function () {
            fresh.forEach(function (c) { c.created = Date.now(); });
            DB.putMany('pins', fresh).then(loadPins).then(function () { closeSheet(); toast(fresh.length + ' pin(s) added'); resolve({ routes: newRoutes.length, pinsAdded: fresh.length, dup: dup }); });
          };
          el.querySelector('#w-skip').onclick = function () { closeSheet(); resolve({ routes: newRoutes.length, pinsAdded: 0, dup: dup }); };
        });
      });
    });
  }

  // ---------- Hunt Scout registry ----------
  /** json = parsed stands.json; getGpx(path) -> Promise<text|null>. Upserts by id. */
  function applyRegistry(json, getGpx) {
    var norm = Registry.normalizeRegistry(json, today()), plan, routeOut = [], wptMatched = 0, wptUnmatched = 0, fromPoints = 0, fromGpx = 0;
    return DB.all('pins').then(function (existing) {
      plan = Registry.planPinUpsert(existing, norm.pins);
      return DB.delMany('pins', plan.remove).then(function () { return DB.putMany('pins', plan.put); });
    }).then(loadPins).then(function () {
      var byId = {}; S.pins.forEach(function (p) { byId[p.id] = p; });
      return Promise.all(norm.routes.map(function (r) {
        return Promise.resolve(r.gpx ? getGpx(r.gpx) : null).catch(function () { return null; }).then(function (txt) {
          var segs = null;
          if (txt) {
            try {
              var g = GPX.parse(txt);
              segs = []; g.tracks.forEach(function (t) { segs = segs.concat(t.segments); });
              g.waypoints.forEach(function (w) { if (Registry.findMatch(Registry.waypointToPin(w), S.pins)) wptMatched++; else wptUnmatched++; });
              if (!segs.length) segs = null; else fromGpx++;
            } catch (e) { norm.warnings.push(r.gpx + ': ' + e.message); }
          }
          if (!segs) { var line = Registry.routeLine(r, byId); if (line.length) { segs = [line]; fromPoints++; } }
          if (!segs) norm.warnings.push('route ' + r.id + ': no GPX and no points; saved without a line');
          var old = S.routes.find(function (x) { return x.id === r.id; });
          routeOut.push(Object.assign({}, r, { segments: segs || [], visible: old ? old.visible !== false : true, created: (old && old.created) || Date.now() }));
        });
      }));
    }).then(function () { return putRoutes(routeOut); }).then(function () {
      var res = { added: plan.added, updated: plan.updated, replacedGpx: plan.remove.length, routes: routeOut.length, fromGpx: fromGpx, fromPoints: fromPoints,
        wptMatched: wptMatched, wptUnmatched: wptUnmatched, warnings: norm.warnings };
      S.lastRegistryResult = res;
      return res;
    });
  }
  function registryReport(res, title) {
    openSheet('<h2>' + esc(title) + '</h2><dl class="kv"><dt>New pins</dt><dd>' + res.added + '</dd><dt>Updated pins</dt><dd>' + res.updated + '</dd>' +
      '<dt>Routes</dt><dd>' + res.routes + ' (' + res.fromGpx + ' from GPX, ' + res.fromPoints + ' from inline points)</dd>' +
      '<dt>GPX waypoints</dt><dd>' + res.wptMatched + ' matched existing pins (no duplicates)' + (res.wptUnmatched ? ', ' + res.wptUnmatched + ' unmatched, not added' : '') + '</dd></dl>' +
      (res.warnings.length ? '<h3>Warnings</h3><p class="warn">' + res.warnings.map(esc).join('<br>') + '</p>' : '') +
      '<button id="r-ok" class="primary" style="width:100%;margin-top:10px">OK</button>', function (el) { el.querySelector('#r-ok').onclick = closeSheet; });
  }
  function syncRegistry() {
    toast('Syncing from registry…');
    return fetch('registry/stands.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('registry/stands.json not found (' + r.status + '). Run scripts/sync-registry.sh on the server.');
      return r.json();
    }).then(function (json) {
      return applyRegistry(json, function (path) {
        return fetch('registry/' + path.replace(/^\.?\//, ''), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : null; });
      });
    }).then(function (res) { registryReport(res, 'Registry synced'); return res; })
      .catch(function (e) { toast('Sync failed: ' + e.message, 5000); throw e; });
  }
  function importRegistryFiles(files) {
    var json = null, gpx = {}, otherGpx = [];
    return Promise.all(Array.prototype.map.call(files, function (f) {
      return readFile(f).then(function (txt) {
        if (/\.json$/i.test(f.name)) { try { json = JSON.parse(txt); } catch (e) { toast(f.name + ': not valid JSON'); } }
        else { gpx[f.name.toLowerCase()] = txt; otherGpx.push(f); }
      });
    })).then(function () {
      if (!json) {
        // only GPX picked (e.g. stands.gpx): treat as a normal GPX import with dedupe
        return otherGpx.length ? importGpxFiles(otherGpx) : toast('Pick stands.json (and route GPX files)');
      }
      return applyRegistry(json, function (path) { return Promise.resolve(gpx[path.split('/').pop().toLowerCase()] || null); })
        .then(function (res) { registryReport(res, 'Registry imported'); return res; });
    });
  }

  // ---------- export / import pins ----------
  function exportPins() {
    var data = { app: 'hunt-map', kind: 'pins', version: 1, exported: new Date().toISOString(), pins: S.pins };
    downloadFile('hunt-map-pins-' + today() + '.json', JSON.stringify(data, null, 2));
    toast(S.pins.length + ' pins exported');
  }
  function importPinsFile(f) {
    return readFile(f).then(function (txt) {
      var data = JSON.parse(txt), list = Array.isArray(data) ? data : data.pins;
      if (!Array.isArray(list)) throw new Error('No "pins" list in file');
      var good = list.filter(function (p) { return p && p.id && isFinite(p.lat) && isFinite(p.lon); }).map(function (p) {
        return Object.assign({ type: 'stand', name: 'Pin', notes: '', best_winds: [], skip_winds: [], extra: {} }, p, { type: TYPES[p.type] ? p.type : 'stand' });
      });
      var before = S.pins.length;
      return DB.putMany('pins', good).then(loadPins).then(function () { toast(good.length + ' pins imported (' + (S.pins.length - before) + ' new)'); });
    }).catch(function (e) { toast('Import failed: ' + e.message, 4000); });
  }

  // ---------- offline maps ----------
  function offlineSheet() {
    var area = S.boundaryGeojson;
    var tiles = area ? Offline.planTiles(area, 11, 16, 0.004) : Offline.planTiles({ type: 'Polygon', coordinates: [[[-93.80, 35.125], [-93.34, 35.125], [-93.34, 35.285], [-93.80, 35.285], [-93.80, 35.125]]] }, 11, 16, 0);
    S.dlPlan = tiles;
    var sel = { topo: true, aerial: true, hybrid: false, parcels: true };
    var tileKeys = function () { return ['topo', 'aerial', 'hybrid'].filter(function (k) { return sel[k]; }); };
    function est() { return Offline.estimate(tiles, tileKeys()); }
    function per(k) { var e = Offline.estimate(tiles, [k]); return e.count.toLocaleString() + ' tiles · ~' + fmtMB(e.bytes); }
    openSheet('<h2>Offline maps</h2><p class="muted">Area: ' + (area ? 'Mount Magazine WMA boundary + ~400 m' : 'WMA bounding box (boundary not loaded)') + ', zoom 11–16. Do this at home on Wi-Fi.</p>' +
      ['topo', 'aerial', 'hybrid'].map(function (k) {
        return '<label class="toggle"><span>' + Offline.BASEMAPS[k].name + '<br><span class="muted">' + per(k) + '</span></span><input type="checkbox" data-k="' + k + '"' + (sel[k] ? ' checked' : '') + '></label>';
      }).join('') +
      '<label class="toggle"><span>Parcel lines (tax map)<br><span class="muted">Fetched by this phone from AR GIS Office · ~1 MB saved, ~0.2 MB download</span></span><input type="checkbox" data-k="parcels" checked></label>' +
      '<p id="o-est" style="font-weight:700"></p><p class="muted" id="o-have"></p><p class="muted" id="o-parcels"></p>' +
      '<div id="o-prog" hidden><p id="o-ptxt" class="muted"></p><progress id="o-bar" max="1" value="0"></progress><p id="o-txt" class="muted"></p></div>' +
      '<div class="col"><button class="primary" id="o-start">Download WMA for offline</button><button id="o-cancel" hidden class="danger">Cancel download</button>' +
      '<button id="o-clear" class="danger">Clear offline maps</button><button id="o-close">Close</button></div>', function (el) {
      function refresh() {
        var e = est(); el.querySelector('#o-est').textContent = 'Selected: ' + e.count.toLocaleString() + ' tiles, about ' + fmtMB(e.bytes) + (sel.parcels ? ' + parcels' : '');
        el.querySelector('#o-start').disabled = (!e.count && !sel.parcels) || !!S.dl;
      }
      function have() {
        Offline.cachedCount().then(function (n) {
          var q = navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve(null);
          return q.then(function (s) { var h = el.querySelector('#o-have'); if (h) h.textContent = 'Saved on this phone: ' + n.toLocaleString() + ' tiles' + (s ? ' · storage used ' + fmtMB(s.usage) + ' of ' + fmtMB(s.quota) : ''); });
        });
        Parcels.info().then(function (i) { var h = el.querySelector('#o-parcels'); if (h) h.textContent = i ? 'Parcels saved: ' + i.count.toLocaleString() + ' (' + i.fetched.slice(0, 10) + ')' : 'Parcels: not saved yet'; });
      }
      el.querySelectorAll('input[data-k]').forEach(function (cb) { cb.onchange = function () { sel[cb.dataset.k] = cb.checked; refresh(); }; });
      refresh(); have();
      if (S.dl) showRunning();
      function showRunning() { el.querySelector('#o-prog').hidden = false; el.querySelector('#o-cancel').hidden = false; el.querySelector('#o-start').disabled = true; }
      el.querySelector('#o-start').onclick = function () {
        if (!navigator.onLine) { toast('You are offline. Connect to Wi-Fi first.'); return; }
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
        var keys = tileKeys();
        var ctl = new AbortController(); S.dl = { ctl: ctl, started: Date.now() }; showRunning();
        var setP = function (t) { var x = document.getElementById('o-ptxt'); if (x) x.textContent = t; };
        var parcelStep = !sel.parcels ? Promise.resolve(null) : (function () {
          setP('Parcels: contacting AR GIS Office…');
          var bb = Geo.bufferBBox(area ? Geo.geojsonBBox(area) : [-93.80, 35.125, -93.34, 35.285], 0.003);
          var keep = new Set(tiles.filter(function (t) { return t.z === 14; }).map(function (t) { return t.x + '/' + t.y; }));
          return Parcels.downloadAndStore(bb, area ? keep : null, { signal: ctl.signal, onProgress: function (pg, pages, kept) {
            S.dl.parcelProgress = { pg: pg, pages: pages, kept: kept };
            setP('Parcels: page ' + pg + ' / ' + pages + ' · ' + kept.toLocaleString() + ' parcels kept');
            var bar = document.getElementById('o-bar'); if (bar && !keys.length) { bar.max = pages; bar.value = pg; }
          } }).then(function (r) {
            S.lastParcelDownload = r;
            setP('Parcels saved: ' + r.count.toLocaleString() + ' (' + fmtMB(r.bytes) + ', ' + Math.round(r.ms / 1000) + ' s)');
            if (S.settings.parcels) setParcels(true);
            return r;
          }).catch(function (e) {
            if (ctl.signal.aborted) return null;
            S.lastParcelDownload = { error: e.message };
            setP('Parcels failed: ' + e.message + ' (maps still downloading; try again later)');
            return null;
          });
        })();
        parcelStep.then(function () {
          if (ctl.signal.aborted || !keys.length) return { done: 0, total: 0, failed: 0, bytes: 0, skipped: 0, cancelled: ctl.signal.aborted };
          return Offline.download(tiles, keys, { concurrency: 6, delayMs: 60, signal: ctl.signal, onProgress: function (d, t, failed, bytes, skipped) {
            S.dl.progress = { d: d, t: t, failed: failed };
            var bar = document.getElementById('o-bar'), txt = document.getElementById('o-txt');
            if (bar) { bar.max = t; bar.value = d; }
            if (txt) txt.textContent = d.toLocaleString() + ' / ' + t.toLocaleString() + ' tiles (' + Math.floor(100 * d / t) + '%) · ' + fmtMB(bytes) + ' new' + (skipped ? ' · ' + skipped + ' already saved' : '') + (failed ? ' · ' + failed + ' failed' : '');
          } });
        }).then(function (r) {
          S.dl = null; S.lastDownload = r;
          var c = document.getElementById('o-cancel'); if (c) c.hidden = true;
          toast(r.cancelled ? 'Download cancelled. Tap Download again to resume.' : 'Offline maps ready' + (r.failed ? ' (' + r.failed + ' failed; run again to retry)' : ''), 5000);
          if (document.getElementById('o-have')) { refresh(); have(); }
        });
      };
      el.querySelector('#o-cancel').onclick = function () { if (S.dl) S.dl.ctl.abort(); };
      el.querySelector('#o-clear').onclick = function () {
        confirmSheet('Clear offline maps?', 'Delete all saved map tiles and parcel lines from this phone? Pins and routes are kept.', 'Clear maps', function () {
          if (S.dl) S.dl.ctl.abort();
          Promise.all([Offline.clearTiles(), Parcels.clear()]).then(function () {
            if (S.parcelSource === 'local') setParcels(S.settings.parcels);
            toast('Offline maps and parcels cleared');
          });
        });
      };
      el.querySelector('#o-close').onclick = closeSheet;
    });
  }

  function scoutToggles() {
    if (!window.Layers) return '';
    var keys = Layers.SCOUT_OVERLAYS.map(function (s) { return s.id; }).concat(['top10']);
    return '<h3>Scout layers</h3>' + keys.map(function (k) {
      var def = OVERLAYS[k]; if (!def) return '';
      var st = S.overlayState[k] === 'missing' ? ' <span class="warn">(waiting)</span>' : '';
      return '<label class="toggle"><span>' + def.label + st + '</span><input type="checkbox" data-ov="' + k + '"' + (S.settings[k] ? ' checked' : '') + '></label>';
    }).join('');
  }


  function forecastSheet() {
    fetch('data/forecast.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (fc) {
      var rows = (fc.hunts || []).map(function (h) {
        return '<p><b>' + esc(h.when) + '</b> <span class="muted">(' + esc(h.rank) + ')</span><br>' + esc(h.wind) + '<br>' + esc(h.sit) + '</p>';
      }).join('');
      openSheet('<h2>5-day forecast</h2><p class="muted">' + esc(fc.note) + '</p>' + rows +
        '<p class="muted">Source: ' + esc(fc.source) + '. Updated ' + esc(fc.updated) + '.</p>' +
        '<button id="fc-close" style="width:100%">Close</button>', function (el) {
        el.querySelector('#fc-close').onclick = closeSheet;
      });
    }).catch(function () { toast('Forecast not loaded'); });
  }


  function recordCrumb(me) {
    if (S.settings.crumbs === false) return;
    if (!window.Trail || !Trail.shouldAccept) return;
    S.crumbs = S.crumbs || [];
    var prev = S.crumbs[S.crumbs.length - 1];
    if (!Trail.shouldAccept(prev, me.lat, me.lon, me.acc, me.t)) return;
    S.crumbs.push({ lat: me.lat, lon: me.lon, t: me.t, acc: me.acc });
    S.crumbs = Trail.prune(S.crumbs, Date.now());
    drawCrumbs();
    if (window.DB && S.crumbs.length % 8 === 0) DB.setSetting('crumbs', S.crumbs);
  }
  function drawCrumbs() {
    if (!S.map) return;
    if (S.crumbLine) S.map.removeLayer(S.crumbLine);
    if (!S.crumbs || S.crumbs.length < 2 || S.settings.crumbs === false) return;
    S.crumbLine = L.polyline(S.crumbs.map(function (p) { return [p.lat, p.lon]; }), { color: '#ffea00', weight: 3, opacity: 0.85 }).addTo(S.map);
  }
  function clearCrumbs() {
    S.crumbs = [];
    if (S.crumbLine) { S.map.removeLayer(S.crumbLine); S.crumbLine = null; }
    if (window.DB) DB.setSetting('crumbs', []);
    toast('Breadcrumbs cleared');
  }
  function refreshWind() {
    var ll = S.me ? [S.me.lat, S.me.lon] : (S.map ? [S.map.getCenter().lat, S.map.getCenter().lng] : WMA_CENTER);
    if (!window.NWS || !NWS.standWind) return;
    NWS.standWind(ll[0], ll[1]).then(function (w) {
      S.wind = w || {};
      var el = document.getElementById('st-net');
      if (!el) return;
      var deg = w.direction_deg_from;
      var dir = w.compass || w.direction || w.windDirection ||
        (isFinite(deg) && deg !== null ? ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((+deg % 360) + 360) % 360 / 22.5) % 16] : '');
      var spd = w.mph != null ? w.mph : (w.speedMph != null ? w.speedMph : (w.speed_mph != null ? Math.round(w.speed_mph) : (w.speed || '')));
      el.textContent = dir ? ('Wind ' + dir + (spd === '' ? '' : ' ' + spd) + (String(spd).indexOf('mph') >= 0 || spd === '' ? '' : ' mph')) : 'Wind —';
    }).catch(function () {});
  }
  function movementSheet() {
    var w = S.wind || {};
    var dir = w.direction || w.windDirection || 'unknown';
    openSheet('<h2>Deer movement</h2>' +
      '<p>Wind right now: <b>' + esc(dir) + '</b>. Sit on the downwind side of the trail you are watching, and approach from downwind. This is a planning aid, not a solunar promise.</p>' +
      '<p>Early pre-rut: watch the downwind side of fresh rubs and scrapes between oak flats and bedding. Confirm sign yourself. Do not hang a stand on a guessed pin.</p>' +
      '<p class="muted">Top 10 stands are not on the map. Q asked for them, but no field pins were saved, and I will not invent ten spots. Drop Water, Food, Scrape, and Rub pins as you find them. Delete is on every pin.</p>' +
      '<button id="mv-close" style="width:100%">Close</button>', function (el) { el.querySelector('#mv-close').onclick = closeSheet; });
  }

  // ---------- More menu ----------
  function moreSheet() {
    var ov = function (k, label) {
      var st = S.overlayState[k] === 'missing' ? ' <span class="warn">(not loaded)</span>' : '';
      return '<label class="toggle"><span>' + label + st + '</span><input type="checkbox" data-ov="' + k + '"' + (S.settings[k] ? ' checked' : '') + '></label>';
    };
    var compassTxt = S.compassOn ? 'Compass: on' : 'Turn on compass';
    openSheet('<h2>More</h2>' +
      '<div class="col"><button class="primary" id="m-offline">Offline maps (download / clear)</button>' +
      '<div class="row"><button id="m-night">' + (S.settings.night ? 'Dark mode' : 'Red night mode') + '</button><button id="m-compass"' + (S.compassOn ? ' disabled' : '') + '>' + compassTxt + '</button></div>' +
      '<button id="m-goto">Navigate to a pin…</button></div>' +
      '<h3>Layers</h3>' + ov('boundary', 'WMA boundary') + ov('parcels', 'Parcel lines (tax map, approximate)') + ov('mvum', 'USFS roads/trails (MVUM)') +
      scoutToggles() +
      '<h3>Pins (' + S.pins.length + ')</h3><div id="m-pins"></div>' +
      '<h3>Routes (' + S.routes.length + ')</h3><div id="m-routes"></div>' +
      '<h3>Import / export</h3><div class="col">' +
      '<button id="m-gpx">Import GPX route</button>' +
      '<div class="row"><button id="m-sync">Sync from registry</button><button id="m-regfiles">Registry files…</button></div>' +
      '<div class="row"><button id="m-export">Export pins</button><button id="m-import">Import pins</button></div></div>' +
      '<button id="m-forecast" class="primary">5-day hunt forecast</button>' +
      '<div class="row"><button id="m-move">Deer movement</button><button id="m-clear-crumbs">Clear breadcrumbs</button></div>' +
      '<h3>About</h3><p class="muted">Mount Magazine WMA, Yell/Logan Co., AR. Maps: USGS The National Map (public domain). Boundary: AGFC. Parcels: Arkansas GIS Office (CAMP), approximate, not legal boundaries. Roads: USFS MVUM. Always confirm boundaries with posted signs and current AGFC regulations.</p>' +
      '<button id="m-close" style="width:100%">Close</button>', function (el) {
      el.querySelector('#m-forecast').onclick = forecastSheet;
      el.querySelector('#m-move').onclick = movementSheet;
      el.querySelector('#m-clear-crumbs').onclick = function () { clearCrumbs(); moreSheet(); };
      el.querySelector('#m-offline').onclick = offlineSheet;
      el.querySelector('#m-night').onclick = function () { setNight(!S.settings.night); moreSheet(); };
      el.querySelector('#m-compass').onclick = function () { enableCompass(true).then(function (ok) { toast(ok ? 'Compass on' : 'Compass not available'); moreSheet(); }); };
      el.querySelector('#m-goto').onclick = chooseTarget;
      el.querySelectorAll('[data-ov]').forEach(function (cb) { cb.onchange = function () { setOverlay(cb.dataset.ov, cb.checked); }; });
      var pl = el.querySelector('#m-pins');
      pl.innerHTML = S.pins.length ? S.pins.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (p) {
        return '<div class="list-item"><span style="width:34px;height:34px">' + pinSvg(p.type) + '</span><div class="grow" data-show="' + esc(p.id) + '"><div class="t">' + esc(p.name) + '</div><div class="s">' + esc(TYPES[p.type].label) + (p.subtype ? ' · ' + esc(p.subtype) : '') + '</div></div><button class="small" data-go="' + esc(p.id) + '">Go</button></div>';
      }).join('') : '<p class="muted">No pins yet. Center the crosshair and tap Pin.</p>';
      pl.querySelectorAll('[data-show]').forEach(function (d) { d.onclick = function () { var p = getPin(d.dataset.show); S.map.setView([p.lat, p.lon], Math.max(S.map.getZoom(), 15)); showPin(p.id); }; });
      pl.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { closeSheet(); startNav(b.dataset.go); }; });
      var rl = el.querySelector('#m-routes');
      rl.innerHTML = S.routes.length ? S.routes.map(function (r) {
        return '<div class="list-item"><div class="grow" data-zoom="' + esc(r.id) + '"><div class="t">' + esc(r.name) + '</div><div class="s">' + (r.source === 'registry' ? 'Hunt Scout' : 'GPX') + (r.distance_m ? ' · ' + Geo.formatDistance(r.distance_m).main : '') + '</div></div>' +
          '<button class="small" data-vis="' + esc(r.id) + '">' + (r.visible === false ? 'Show' : 'Hide') + '</button><button class="small danger" data-del="' + esc(r.id) + '">Del</button></div>';
      }).join('') : '<p class="muted">No routes yet.</p>';
      rl.querySelectorAll('[data-zoom]').forEach(function (d) { d.onclick = function () { var l = S.routeLayers[d.dataset.zoom]; if (l) { closeSheet(); S.map.fitBounds(l.getBounds(), { padding: [40, 40] }); } }; });
      rl.querySelectorAll('[data-vis]').forEach(function (b) { b.onclick = function () {
        var r = S.routes.find(function (x) { return x.id === b.dataset.vis; }); r.visible = r.visible === false; DB.put('routes', r).then(function () { renderRoutes(); moreSheet(); });
      }; });
      rl.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () {
        var r = S.routes.find(function (x) { return x.id === b.dataset.del; });
        confirmSheet('Delete route?', 'Delete "' + r.name + '"?', 'Delete', function () {
          DB.del('routes', r.id).then(function () { S.routes = S.routes.filter(function (x) { return x.id !== r.id; }); renderRoutes(); toast('Route deleted'); });
        });
      }; });
      el.querySelector('#m-gpx').onclick = function () { $('file-gpx').click(); };
      el.querySelector('#m-sync').onclick = function () { syncRegistry().catch(function () {}); };
      el.querySelector('#m-regfiles').onclick = function () { $('file-registry').click(); };
      el.querySelector('#m-export').onclick = exportPins;
      el.querySelector('#m-import').onclick = function () { $('file-pins').click(); };
      el.querySelector('#m-close').onclick = closeSheet;
    });
  }
  function setNight(on) {
    S.settings.night = !!on; document.body.classList.toggle('night', !!on);
    document.querySelector('meta[name=theme-color]').content = '#000000'; saveSettings();
  }
  function setNetStatus() { var el = $('st-net'); el.textContent = navigator.onLine ? '' : 'Offline'; el.className = navigator.onLine ? '' : 'off'; }

  // ---------- wire up ----------
  function bindUI() {
    $('btn-basemap').onclick = function () { var i = BASE_ORDER.indexOf(S.settings.basemap); setBasemap(BASE_ORDER[(i + 1) % BASE_ORDER.length]); toast(BASE_LABEL[S.settings.basemap] + ' map'); };
    $('btn-center').onclick = function () {
      enableCompass(true); // tap = allowed to ask on iOS
      if (!S.me) { toast(S.watchId == null ? 'GPS not available' : 'Waiting for GPS fix…'); if (S.watchId == null) startGPS(); return; }
      S.follow = true; $('btn-center').classList.add('following');
      S.map.setView([S.me.lat, S.me.lon], Math.max(S.map.getZoom(), 15));
    };
    $('btn-pin').onclick = function () { editPin(null); };
    $('btn-truck').onclick = backToTruck;
    $('btn-more').onclick = moreSheet;
    $('nav-close').onclick = stopNav;
    $('nav-change').onclick = chooseTarget;
    $('sheet-backdrop').onclick = closeSheet;
    $('file-gpx').onchange = function (e) { var f = e.target.files; if (f.length) { closeSheet(); importGpxFiles(f); } e.target.value = ''; };
    $('file-registry').onchange = function (e) { var f = e.target.files; if (f.length) { closeSheet(); importRegistryFiles(f); } e.target.value = ''; };
    $('file-pins').onchange = function (e) { var f = e.target.files[0]; if (f) { closeSheet(); importPinsFile(f); } e.target.value = ''; };
    window.addEventListener('online', setNetStatus); window.addEventListener('offline', setNetStatus); setNetStatus();
  }
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(function (reg) { S.swReg = reg; }).catch(function (e) { console.warn('SW failed', e); });
  }

  // test hooks (used by tests/e2e.mjs; harmless in production)
  S.api = { importGpxFiles: importGpxFiles, applyRegistry: applyRegistry, syncRegistry: syncRegistry, importRegistryFiles: importRegistryFiles,
    setBasemap: setBasemap, setOverlay: setOverlay, setNight: setNight, startNav: startNav, backToTruck: backToTruck, savePin: savePin,
    loadPins: loadPins, offlineSheet: offlineSheet, setParcels: setParcels, onPos: onPos, closeSheet: closeSheet };

  DB.getSetting('settings', null).then(function (s) {
    if (s) Object.assign(S.settings, s);
    initMap(); bindUI(); setNight(S.settings.night);
    // boundary data is always loaded (offline download area uses it); shown only if toggled on
    var wantBoundary = S.settings.boundary !== false;
    setOverlay('boundary', true).then(function () { if (!wantBoundary) setOverlay('boundary', false); });
    installScoutOverlays();
    ['parcels', 'mvum'].concat(window.Layers ? Layers.SCOUT_OVERLAYS.map(function (s) { return s.id; }).concat(['top10']) : []).forEach(function (k) { if (S.settings[k]) setOverlay(k, true); });
    refreshWind(); setInterval(refreshWind, 15 * 60 * 1000);
    return Promise.all([loadPins(), loadRoutes(), DB.getSetting('crumbs', []).then(function (c) { S.crumbs = c || []; drawCrumbs(); })]);
  }).then(function () {
    startGPS(); registerSW(); S.ready = true;
  }).catch(function (e) { console.error(e); toast('Startup error: ' + e.message, 6000); });
})();
