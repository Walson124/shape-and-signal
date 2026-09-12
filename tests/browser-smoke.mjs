import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const baseUrl = process.env.WHEREFORM_URL ?? 'http://127.0.0.1:5173';
const chromePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const dataset = JSON.parse(await readFile(new URL('../src/data/places.json', import.meta.url), 'utf8'));

function mulberry32(seed) { return () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffle(items, random) { const copy = [...items]; for (let i = copy.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }
const now = new Date();
const seed = Number(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`);
const dailyTargets = shuffle(dataset.records, mulberry32(seed)).slice(0, 5);
const firstTarget = dailyTargets[0];

async function clickCountry(page, atlasId) {
  const locator = page.locator(`[data-country-id="${atlasId}"]`);
  await locator.scrollIntoViewIfNeeded();
  const point = await locator.evaluate((element) => {
    const box = element.getBBox(), svg = element.ownerSVGElement, probe = svg.createSVGPoint();
    for (let row = 0; row < 40; row += 1) {
      for (let column = 0; column < 40; column += 1) {
        probe.x = box.x + box.width * (column + .5) / 40;
        probe.y = box.y + box.height * (row + .5) / 40;
        if (element.isPointInFill(probe)) {
          const screen = probe.matrixTransform(element.getScreenCTM());
          return { x: screen.x, y: screen.y };
        }
      }
    }
    throw new Error(`Could not find a clickable point inside ${atlasId}.`);
  });
  await page.mouse.click(point.x, point.y);
}

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(error.message));
await page.addInitScript(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async (payload) => { window.__whereformShare = payload; } }));

try {
  await page.goto(`${baseUrl}/#play`, { waitUntil: 'networkidle' });
  await page.getByText('PLACE YOUR GUESS').waitFor();
  if (await page.locator('.evidence-card').count() !== 3) throw new Error('Round did not begin with three mixed signals.');

  const startingValue = Number(await page.locator('.potential-score strong').textContent());
  await page.waitForTimeout(1100);
  const decayedValue = Number(await page.locator('.potential-score strong').textContent());
  if (decayedValue >= startingValue) throw new Error('Round score did not decay over time.');

  await page.getByRole('button', { name: 'REVEAL NEXT SIGNAL' }).click();
  await page.getByText('1/5 OPEN').waitFor();

  const wrongTarget = dataset.records.find((place) => place.worldAtlasId !== firstTarget.worldAtlasId);
  await clickCountry(page, wrongTarget.worldAtlasId);
  const outline = await page.locator(`[data-country-id="${wrongTarget.worldAtlasId}"]`).evaluate((element) => getComputedStyle(element).outlineStyle);
  if (outline !== 'none') throw new Error('Mouse click left a rectangular focus outline on the country.');
  await page.getByText('READY TO LOCK?').waitFor();

  const map = page.locator('.world-map');
  const initialViewBox = await map.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const zoomedViewBox = await map.getAttribute('viewBox');
  if (zoomedViewBox === initialViewBox) throw new Error('Zoom in did not change the map viewBox.');

  const box = await map.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  if (await page.getByText('NEAREST LAND DISTANCE').count()) throw new Error('Dragging the map committed the guess.');

  await page.getByRole('button', { name: 'Reset map' }).click();
  const resetViewBox = await map.getAttribute('viewBox');
  await map.hover();
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(100);
  if (await map.getAttribute('viewBox') === resetViewBox) throw new Error('Mouse-wheel zoom did not change the map viewBox.');
  await page.getByRole('button', { name: 'Reset map' }).click();
  await page.getByRole('button', { name: 'LOCK GUESS' }).click();
  await page.getByText('NEAREST LAND DISTANCE').waitFor();
  await page.getByText(firstTarget.name, { exact: true }).waitFor();

  for (const target of dailyTargets.slice(1)) {
    await page.getByRole('button', { name: 'NEXT PLACE' }).click();
    await clickCountry(page, target.worldAtlasId);
    await page.getByRole('button', { name: 'LOCK GUESS' }).click();
    await page.getByText('EXACT COUNTRY').waitFor();
    await page.getByText(target.name, { exact: true }).waitFor();
  }
  await page.getByRole('button', { name: 'SEE RESULTS' }).click();
  await page.getByText('DAILY WORLD / COMPLETE').waitFor();
  await page.getByRole('button', { name: 'SHARE SCORE' }).click();
  const sharePayload = await page.evaluate(() => window.__whereformShare);
  if (!sharePayload?.text?.includes('Score:') || !sharePayload.text.includes('/ 5000')) throw new Error('Shared text did not include the score.');

  const scoreFloor = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  scoreFloor.on('console', (message) => { if (message.type() === 'error') errors.push(`score-floor: ${message.text()}`); });
  scoreFloor.on('pageerror', (error) => errors.push(`score-floor: ${error.message}`));
  await scoreFloor.addInitScript(() => {
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = (handler, timeout, ...args) => nativeSetInterval(handler, timeout === 1000 ? 1 : timeout, ...args);
  });
  await scoreFloor.goto(`${baseUrl}/#play`, { waitUntil: 'networkidle' });
  await scoreFloor.waitForFunction(() => document.querySelector('.potential-score strong')?.textContent === '0');
  await scoreFloor.close();

  const freePlay = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  freePlay.on('console', (message) => { if (message.type() === 'error') errors.push(`free: ${message.text()}`); });
  await freePlay.goto(baseUrl, { waitUntil: 'networkidle' });
  await freePlay.getByRole('button', { name: 'FREE PLAY' }).click();
  await freePlay.getByText('FREE PLAY SCORE').waitFor();
  if (!freePlay.url().endsWith('#free')) throw new Error('Free Play did not use its dedicated route.');
  await freePlay.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.on('console', (message) => { if (message.type() === 'error') errors.push(`mobile: ${message.text()}`); });
  mobile.on('pageerror', (error) => errors.push(`mobile: ${error.message}`));
  await mobile.goto(`${baseUrl}/#play`, { waitUntil: 'networkidle' });
  await mobile.getByRole('button', { name: 'Zoom in' }).click();
  await clickCountry(mobile, firstTarget.worldAtlasId);
  await mobile.getByRole('button', { name: 'LOCK GUESS' }).click();
  await mobile.getByText(firstTarget.name, { exact: true }).waitFor();
  await mobile.close();

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`);
  console.log(`Smoke test passed: zero-floor scoring, mixed clues, movable one-guess pins, distance scoring, daily/free modes, map interactions, all rounds, results, and scored sharing.`);
} finally {
  await browser.close();
}
