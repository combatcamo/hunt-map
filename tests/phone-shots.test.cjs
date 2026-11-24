const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { createServer } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');

const SHOTS = '/workspace/hunt-map-notes/shots';
const root = path.resolve(__dirname, '..');
let server, browser, base;

before(async () => {
  await mkdir(SHOTS, { recursive: true });
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
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

test('phone-size offline screenshots show stands and the pin form', { timeout: 60000 }, async t => {
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
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => window.HuntMap?.ready, null, { timeout: 15000 });
  await page.waitForFunction(() => (window.HuntMap.top10 || []).length >= 10, null, { timeout: 15000 });
  // Zoom to the east cluster so numbered badges are visible at phone size
  await page.evaluate(() => {
    const east = HuntMap.top10.filter(s => s.lon > -93.55);
    if (east.length && HuntMap.map) {
      HuntMap.map.setView([east[0].lat, east[0].lon], 13);
    }
  });
  await page.waitForTimeout(500);
  const standsOnline = path.join(SHOTS, 'stands-phone.png');
  await page.screenshot({ path: standsOnline, fullPage: false });

  // External network already blocked (https aborted). setOffline cuts remaining net but we stay on the loaded page,
  // which is how the service worker would serve the app in airplane mode after a first visit.
  await context.setOffline(true);
  const nMarkers = await page.locator('.top10-badge').count();
  assert.ok(nMarkers >= 1, 'expected stand badges offline, got ' + nMarkers);
  await page.screenshot({ path: path.join(SHOTS, 'stands-offline.png'), fullPage: false });

  await page.click('#btn-pin');
  await page.waitForSelector('#e-types');
  await page.click('[data-type="food"]');
  await page.waitForSelector('#e-foodwrap', { state: 'visible' });
  const saved = await page.locator('#e-save').evaluate(el => {
    const r = el.getBoundingClientRect();
    return { h: r.height, label: el.textContent, w: r.width };
  });
  assert.ok(saved.h >= 56, 'Save button should be at least 56px, got ' + saved.h);
  await page.locator('#sheet').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, 'pin-form-offline.png'), fullPage: false });
});
