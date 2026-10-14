const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { createServer } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');

let server, browser, base;
const root = path.resolve(__dirname, '..');
before(async () => {
  await mkdir(path.join(__dirname, 'output'), { recursive: true });
  server = createServer(async (req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
    try {
      let target = file === root ? path.join(root, 'index.html') : file;
      if (file.startsWith(path.join(root, 'vendor', 'leaflet') + path.sep)) {
        target = path.join(root, 'node_modules', 'leaflet', 'dist', path.relative(path.join(root, 'vendor', 'leaflet'), file));
      }
      const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' }[path.extname(target)];
      const body = await readFile(target);
      res.writeHead(200, { 'Content-Type': type || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.CHROME_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'
  ].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openApp(t, forecast) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  t.after(() => context.close());
  await context.route('https://**/*', route => {
    const url = route.request().url();
    if (!url.startsWith('https://api.weather.gov/')) return route.abort();
    let properties;
    if (url.includes('/points/')) properties = {
      forecastHourly: 'https://api.weather.gov/test/hourly', forecastGridData: 'https://api.weather.gov/test/grid'
    };
    else if (url.endsWith('/hourly')) properties = { periods: [{
      startTime: new Date().toISOString(), windDirection: 'SSW', windSpeed: '7 mph'
    }] };
    else properties = {};
    return route.fulfill({ json: { properties } });
  });
  if (forecast) await context.route('**/data/forecast.json', route => route.fulfill({ json: forecast }));
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => window.HuntMap?.ready);
  return page;
}

test('boundary caveat is visible above the map without obscuring navigation', async t => {
  const page = await openApp(t);
  const visible = await page.locator('#boundary-caveat').evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.top >= 0 && r.bottom < innerHeight &&
      document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el;
  });
  assert.equal(visible, true);
  await page.screenshot({ path: path.join(__dirname, 'output', 'mobile-map.png') });
  await page.locator('#nav').evaluate(el => { el.hidden = false; });
  const overlaps = await page.evaluate(() => {
    const a = document.querySelector('#nav').getBoundingClientRect();
    const b = document.querySelector('#boundary-caveat').getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  assert.equal(overlaps, false);
});

test('all seven pin types fit the mobile form and remain selectable', async t => {
  const page = await openApp(t);
  await page.click('#btn-pin');
  const boxes = await page.locator('#e-types button').evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect(); return { left: r.left, right: r.right };
  }));
  assert.equal(boxes.length, 7);
  assert.ok(boxes.every(r => r.left >= 0 && r.right <= 390), JSON.stringify(boxes));
  await page.click('[data-type="rub"]');
  assert.equal(await page.locator('[data-type="rub"]').evaluate(el => el.classList.contains('sel')), true);
  await page.screenshot({ path: path.join(__dirname, 'output', 'mobile-pins.png') });
});

test('expired forecast hides relative dates and hunt recommendations', async t => {
  const page = await openApp(t);
  await page.click('#btn-more'); await page.click('#m-forecast');
  await page.waitForSelector('#fc-close');
  const text = await page.locator('#sheet-body').innerText();
  assert.match(text, /expired/i);
  assert.doesNotMatch(text, /Tonight|current NWS read|High side of a bench/);
});

for (const updated of ['invalid', new Date(Date.now() + 86400000).toISOString()]) {
  test(`forecast fails closed for timestamp ${updated}`, async t => {
    const page = await openApp(t, { updated, note: 'current NWS read', hunts: [{ when: 'Tonight', sit: 'Old advice' }] });
    await page.click('#btn-more'); await page.click('#m-forecast');
    await page.waitForSelector('#fc-close');
    const text = await page.locator('#sheet-body').innerText();
    assert.match(text, /expired|unavailable/i);
    assert.doesNotMatch(text, /Tonight|Old advice|current NWS read/);
  });
}

test('fresh forecast keeps its advice and displays its source date', async t => {
  const updated = new Date().toISOString();
  const page = await openApp(t, { updated, source: 'Test NWS snapshot', hunts: [{ when: 'Tomorrow', wind: 'SSW', sit: 'Fresh advice', rank: 'fair' }] });
  await page.click('#btn-more'); await page.click('#m-forecast');
  await page.waitForSelector('#fc-close');
  const text = await page.locator('#sheet-body').innerText();
  assert.match(text, /Fresh advice/); assert.ok(text.includes(updated));
});

test('one to seven accepted GPS fixes survive a reload', async t => {
  const page = await openApp(t);
  for (let i = 0; i < 7; i++) {
    await page.evaluate(i => HuntMap.api.onPos({ timestamp: Date.now(), coords: {
      latitude: 35.205 + i * 0.001, longitude: -93.57, accuracy: 5, heading: null
    } }), i);
    // Reading from IndexedDB waits behind earlier writes on the same store.
    const count = await page.evaluate(async () => (await DB.getSetting('crumbs', [])).length);
    assert.equal(count, i + 1);
  }
  await page.reload(); await page.waitForFunction(() => window.HuntMap?.ready);
  assert.equal(await page.evaluate(() => HuntMap.crumbs.length), 7);
});

test('restoring a trail removes expired fixes from the map and storage', async t => {
  const page = await openApp(t);
  await page.evaluate(async () => DB.setSetting('crumbs', [
    { lat: 35.20, lon: -93.57, t: Date.now() - 19 * 3600000 },
    { lat: 35.21, lon: -93.57, t: Date.now() - 1000 }
  ]));
  await page.reload(); await page.waitForFunction(() => window.HuntMap?.ready);
  assert.equal(await page.evaluate(() => HuntMap.crumbs.length), 1);
  assert.equal(await page.evaluate(async () => (await DB.getSetting('crumbs', [])).length), 1);
});

test('movement card uses the same NWS compass and degree fallback as the wind chip', async t => {
  const page = await openApp(t);
  await page.waitForFunction(() => document.querySelector('#st-net').textContent.includes('SSW'));
  await page.click('#btn-more'); await page.click('#m-move');
  assert.match(await page.locator('#sheet-body').innerText(), /Wind right now: SSW/);
  await page.click('#mv-close');
  await page.evaluate(() => { HuntMap.wind = { direction_deg_from: 270 }; });
  await page.click('#btn-more'); await page.click('#m-move');
  assert.match(await page.locator('#sheet-body').innerText(), /Wind right now: W\./);
});
