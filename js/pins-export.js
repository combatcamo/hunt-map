/* Hunt Scout inbox export (pure). Builds user_{water,food,scrape,rub}.geojson FeatureCollections.
   Phone downloads/shares these files; scripts/write-inbox-geojson.py copies them into the inbox. */
(function (root) {
  'use strict';

  var FOOD_TYPES = [
    'food_plot', 'ag_field', 'oak_flat', 'mast_tree', 'clearcut', 'browse', 'orchard', 'other',
    'hard_mast', 'soft_mast', 'persimmon', 'mineral'
  ];
  var FOOD_STATUS = ['planted', 'growing', 'mature', 'grazed_down', 'unknown'];
  var WATER_TYPES = ['spring', 'seep', 'pond', 'creek_pool', 'wallow', 'tank', 'puddle', 'other'];
  var RELIABILITY = ['year_round', 'seasonal', 'after_rain', 'unknown'];
  var FRESHNESS = ['fresh', 'active', 'old', 'unknown'];
  var SIZES = ['large', 'medium', 'small', 'unknown'];
  var INBOX_TYPES = ['water', 'food', 'scrape', 'rub'];
  var PREFIX = { water: 'w', food: 'f', scrape: 's', rub: 'r' };
  var LEGAL_NOTE = 'Mineral or bait may be illegal on WMA land. It can be shown on the map but does not raise stand ranks.';

  function str(v) { return v == null ? '' : String(v).trim(); }
  function lower(v) { return str(v).toLowerCase(); }
  function pick(v, allowed, fallback) {
    var s = lower(v);
    return allowed.indexOf(s) >= 0 ? s : fallback;
  }
  function isoAdded(p) {
    if (p && p.added) return str(p.added);
    if (p && p.created) {
      var d = new Date(+p.created);
      if (isFinite(d.getTime())) return d.toISOString();
    }
    if (p && p.updated) {
      var u = str(p.updated);
      if (/^\d{4}-\d{2}-\d{2}$/.test(u)) return u + 'T00:00:00.000Z';
      if (u) return u;
    }
    return new Date().toISOString();
  }
  function isMineralOrBait(p) {
    if (!p) return false;
    if (lower(p.food_type) === 'mineral') return true;
    var blob = [p.notes, p.crop, p.name, p.food_type].map(str).join(' ');
    return /mineral|bait|salt\s*lick|attractant/i.test(blob);
  }

  /** Stable contract id: w-/f-/s-/r-… Keep an already-correct prefix; otherwise prefix the existing id. */
  function exportId(p) {
    var type = p && p.type;
    var pre = PREFIX[type];
    if (!pre) return str(p && p.id) || '';
    var raw = str(p && p.id);
    if (new RegExp('^' + pre + '-', 'i').test(raw)) return raw;
    var stripped = raw.replace(/^(water|food|scrape|rub|pin|parking|stand)-/i, '');
    return pre + '-' + (stripped || raw || 'pin');
  }

  function pointFeature(p, props) {
    var lat = p.lat != null ? +p.lat : null, lon = p.lon != null ? +p.lon : null;
    if (!isFinite(lat) || !isFinite(lon)) return null;
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: props
    };
  }

  function pinToFeature(p) {
    if (!p || INBOX_TYPES.indexOf(p.type) < 0) return null;
    var id = exportId(p);
    var props = {
      id: id,
      name: str(p.name),
      notes: str(p.notes),
      added: isoAdded(p),
      source: 'user'
    };
    if (p.type === 'water') {
      props.water_type = pick(p.water_type, WATER_TYPES, 'other');
      props.reliability = pick(p.reliability, RELIABILITY, 'unknown');
    } else if (p.type === 'food') {
      props.food_type = pick(p.food_type, FOOD_TYPES, 'other');
      if (p.crop != null && str(p.crop)) props.crop = str(p.crop);
      if (p.status != null && str(p.status)) props.status = pick(p.status, FOOD_STATUS, 'unknown');
      else props.status = 'unknown';
      if (isMineralOrBait(p)) props.legal_note = LEGAL_NOTE;
    } else {
      if (p.sign_date) props.sign_date = str(p.sign_date);
      if (p.freshness) props.freshness = pick(p.freshness, FRESHNESS, 'unknown');
      if (p.size) props.size = pick(p.size, SIZES, 'unknown');
      if (p.licking_branch === true || p.licking_branch === 'true' || p.licking_branch === 'yes' || p.licking_branch === 1) {
        props.licking_branch = true;
      }
      if (p.count != null && p.count !== '') {
        var n = parseInt(p.count, 10);
        if (isFinite(n) && n > 0) props.count = n;
      }
    }
    return pointFeature(p, props);
  }

  function collection(pins, type) {
    var feats = (pins || []).filter(function (p) { return p && p.type === type; }).map(pinToFeature).filter(Boolean);
    return { type: 'FeatureCollection', features: feats };
  }

  function allInbox(pins) {
    return {
      'user_water.geojson': collection(pins, 'water'),
      'user_food.geojson': collection(pins, 'food'),
      'user_scrape.geojson': collection(pins, 'scrape'),
      'user_rub.geojson': collection(pins, 'rub')
    };
  }

  var api = {
    FOOD_TYPES: FOOD_TYPES, FOOD_STATUS: FOOD_STATUS, WATER_TYPES: WATER_TYPES, RELIABILITY: RELIABILITY,
    FRESHNESS: FRESHNESS, SIZES: SIZES, INBOX_TYPES: INBOX_TYPES, PREFIX: PREFIX, LEGAL_NOTE: LEGAL_NOTE,
    exportId: exportId, isMineralOrBait: isMineralOrBait, pinToFeature: pinToFeature,
    collection: collection, allInbox: allInbox
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PinsExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
