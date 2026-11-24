const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { writeFileSync, mkdirSync, rmSync, readFileSync } = require('node:fs');
const path = require('node:path');
const Pins = require('../js/pins-export.js');

const pins = [
  { id: 'water-old', type: 'water', name: 'Spring', lat: 35.17, lon: -93.64, water_type: 'spring', reliability: 'year_round', notes: 'clear', created: 1700000000000 },
  { id: 'f-oak', type: 'food', name: 'Oak flat', lat: 35.18, lon: -93.63, food_type: 'oak_flat', crop: 'white oak', status: 'mature' },
  { id: 'pin-1', type: 'food', name: 'Mineral block', lat: 35.19, lon: -93.62, food_type: 'mineral', notes: 'bait pile' },
  { id: 's-1', type: 'scrape', name: 'Creek scrape', lat: 35.2, lon: -93.61, sign_date: '2026-11-20', freshness: 'fresh', size: 'large', licking_branch: true, count: 3 },
  { id: 'r-1', type: 'rub', name: 'Line rub', lat: 35.21, lon: -93.60, freshness: 'active', size: 'medium' },
  { id: 'stand-1', type: 'stand', name: 'Ignore me', lat: 35.22, lon: -93.59 }
];

test('export ids use w-/f-/s-/r- prefixes and remap legacy ids', () => {
  assert.equal(Pins.exportId(pins[0]), 'w-old');
  assert.equal(Pins.exportId(pins[1]), 'f-oak');
  assert.equal(Pins.exportId({ id: 'food-abc', type: 'food' }), 'f-abc');
  assert.equal(Pins.exportId(pins[3]), 's-1');
  assert.equal(Pins.exportId(pins[4]), 'r-1');
});

test('inbox collections match the Hunt Scout contract', () => {
  const all = Pins.allInbox(pins);
  assert.deepEqual(Object.keys(all).sort(), [
    'user_food.geojson', 'user_rub.geojson', 'user_scrape.geojson', 'user_water.geojson'
  ]);
  const water = all['user_water.geojson'].features[0];
  assert.equal(water.type, 'Feature');
  assert.equal(water.geometry.type, 'Point');
  assert.deepEqual(water.geometry.coordinates, [-93.64, 35.17]);
  assert.equal(water.properties.id, 'w-old');
  assert.equal(water.properties.water_type, 'spring');
  assert.equal(water.properties.reliability, 'year_round');
  assert.equal(water.properties.source, 'user');
  assert.ok(water.properties.added);

  const food = all['user_food.geojson'].features;
  const oak = food.find(f => f.properties.food_type === 'oak_flat');
  assert.equal(oak.properties.id, 'f-oak');
  assert.equal(oak.properties.crop, 'white oak');
  assert.equal(oak.properties.status, 'mature');
  assert.equal(oak.properties.legal_note, undefined);

  const mineral = food.find(f => f.properties.food_type === 'mineral');
  assert.equal(mineral.properties.id, 'f-1'); // pin-1 remapped
  assert.match(mineral.properties.legal_note, /illegal on WMA/i);

  const scrape = all['user_scrape.geojson'].features[0].properties;
  assert.equal(scrape.id, 's-1');
  assert.equal(scrape.sign_date, '2026-11-20');
  assert.equal(scrape.freshness, 'fresh');
  assert.equal(scrape.size, 'large');
  assert.equal(scrape.licking_branch, true);
  assert.equal(scrape.count, 3);

  const rub = all['user_rub.geojson'].features[0].properties;
  assert.equal(rub.id, 'r-1');
  assert.equal(rub.freshness, 'active');
  assert.equal(all['user_water.geojson'].features.length + food.length +
    all['user_scrape.geojson'].features.length + all['user_rub.geojson'].features.length, 5);
});

test('unknown food_type becomes other; mineral/bait always get a legal note', () => {
  const f = Pins.pinToFeature({ id: 'f-x', type: 'food', lat: 35, lon: -93, food_type: 'not-a-type', notes: 'salt lick' });
  assert.equal(f.properties.food_type, 'other');
  assert.ok(f.properties.legal_note);
  assert.equal(Pins.isMineralOrBait({ food_type: 'mineral' }), true);
});

test('write-inbox-geojson.py accepts all four files via --dir', () => {
  const dir = path.join(__dirname, 'output', 'inbox-src');
  mkdirSync(dir, { recursive: true });
  const all = Pins.allInbox(pins);
  for (const [name, gj] of Object.entries(all)) {
    writeFileSync(path.join(dir, name), JSON.stringify(gj));
  }
  const inbox = '/workspace/hunt-scout/inbox';
  const script = path.resolve(__dirname, '../scripts/write-inbox-geojson.py');
  const r = spawnSync('python3', [script, '--dir', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  try {
    const water = JSON.parse(readFileSync(path.join(inbox, 'user_water.geojson'), 'utf8'));
    assert.equal(water.features[0].properties.water_type, 'spring');
    const food = JSON.parse(readFileSync(path.join(inbox, 'user_food.geojson'), 'utf8'));
    assert.ok(food.features.some(f => f.properties.food_type === 'mineral' && f.properties.legal_note));
    const scrape = JSON.parse(readFileSync(path.join(inbox, 'user_scrape.geojson'), 'utf8'));
    assert.equal(scrape.features[0].properties.count, 3);
    const rub = JSON.parse(readFileSync(path.join(inbox, 'user_rub.geojson'), 'utf8'));
    assert.equal(rub.features[0].properties.id, 'r-1');
  } finally {
    const empty = '{"type":"FeatureCollection","features":[]}\n';
    for (const name of Object.keys(all)) writeFileSync(path.join(inbox, name), empty);
    rmSync(dir, { recursive: true, force: true });
  }
});
