const { test } = require('node:test');
const assert = require('node:assert/strict');
const Layers = require('../js/layers.js');

const HOUR = 60 * 60 * 1000;

function grid(updated, extraProps) {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-93.64, 35.17] },
      properties: Object.assign({
        id: 'g1',
        updated,
        hours: [{ valid_time: updated, direction_deg_from: 200, speed_mph: 7 }]
      }, extraProps || {})
    }]
  };
}

test('isWindGridStale is false when updated is under 2 hours old', () => {
  const now = Date.parse('2026-11-24T16:00:00Z');
  const gj = grid('2026-11-24T14:35:00Z');
  assert.equal(Layers.isWindGridStale(gj, now), false);
  assert.equal(Layers.isWindGridStale(gj, now + 3 * HOUR), true);
});

test('isWindGridStale is true when updated is missing or unparseable', () => {
  assert.equal(Layers.isWindGridStale({ type: 'FeatureCollection', features: [] }), true);
  assert.equal(Layers.isWindGridStale(grid('not-a-date')), true);
  assert.equal(Layers.isWindGridStale(null), true);
});

test('nearestWind returns null for a stale grid', () => {
  const stale = grid('2026-11-24T10:00:00Z');
  const now = Date.parse('2026-11-24T16:00:00Z');
  // freeze check by passing a stale file; nearestWind uses Date.now(), so mark via isWindGridStale path
  // Force stale by using an old updated and stubbing clock is not available; use 2000-era stamp.
  const veryOld = grid('2000-01-01T00:00:00Z');
  assert.equal(Layers.nearestWind(veryOld, 35.17, -93.64), null);
  const fresh = grid(new Date().toISOString());
  const hit = Layers.nearestWind(fresh, 35.17, -93.64);
  assert.ok(hit);
  assert.equal(hit.hours[0].speed_mph, 7);
});

test('windFit prefers live NWS and falls back to a fresh grid only', () => {
  const stand = { best_winds: ['SSE', 'S', 'SSW'], skip_winds: ['N', 'NNE'] };
  const good = Layers.windFit(stand, { compass: 'SSW', speed_mph: 6 }, { direction_deg_from: 10 }, false);
  assert.equal(good.fit, 'good');
  assert.equal(good.source, 'nws');
  assert.equal(good.compass, 'SSW');

  const poor = Layers.windFit(stand, { direction_deg_from: 10 }, null, false);
  assert.equal(poor.fit, 'poor'); // ~N
  assert.equal(poor.source, 'nws');

  const fair = Layers.windFit(stand, { compass: 'W' }, null, false);
  assert.equal(fair.fit, 'fair');

  const backup = Layers.windFit(stand, null, { direction_deg_from: 200, speed_mph: 5 }, false);
  assert.equal(backup.fit, 'good'); // 200° ≈ SSW
  assert.equal(backup.source, 'grid');

  const stale = Layers.windFit(stand, null, { direction_deg_from: 200 }, true);
  assert.equal(stale.fit, 'unknown');
  assert.match(stale.label, /stale/i);
});

test('normalizeTop10 keeps rank_change strings including new', () => {
  const stands = Layers.normalizeTop10({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-93.47, 35.22] },
        properties: { id: 'mm-01', name: 'East Spring', rank: 1, rank_score: 95, rank_change: '+2', best_winds: 'SSE,S,SSW', sign_hot: true, water_bonus: 1 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-93.70, 35.15] },
        properties: { id: 'mm-02', name: 'West', rank: 2, rank_change: 'new', best_winds: ['SW', 'W'] } }
    ]
  });
  assert.equal(stands[0].id, 'mm-01');
  assert.equal(stands[0].rank_change, '+2');
  assert.equal(stands[0].sign_hot, true);
  assert.equal(Layers.formatRankChange(stands[0].rank_change), '↑2');
  assert.equal(stands[1].rank_change, 'new');
  assert.equal(Layers.formatRankChange('new'), 'new');
  assert.equal(Layers.formatRankChange('0'), '');
});
