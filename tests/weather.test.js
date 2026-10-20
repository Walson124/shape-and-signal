import test from 'node:test';
import assert from 'node:assert/strict';
import { weatherAt, forceWeather } from '../src/world/weather.js';

const world = (type, seed = 1234) => ({ type, seed, atmo: true, landable: true });
const HOUR = 3600 * 1000;

test('the forecast is the same for everyone at the same moment', () => {
  const t = 1.7e12;
  assert.deepEqual(weatherAt(world('terran'), t), weatherAt(world('terran'), t));
});

test('each kind of world gets its own kind of weather', () => {
  const kinds = { terran: new Set(), desert: new Set(), ice: new Set(), toxic: new Set(), lava: new Set() };
  for (const type of Object.keys(kinds)) for (let h = 0; h < 400; h++) kinds[type].add(weatherAt(world(type, 77), 1.7e12 + h * HOUR).kind);
  assert.ok(kinds.terran.has('rain') && kinds.terran.has(null));
  assert.ok(!kinds.desert.has('rain') && kinds.desert.has('dust'));
  assert.ok(kinds.ice.has('snow') && !kinds.ice.has('rain'));
  assert.ok(kinds.toxic.has('acid'));
  assert.ok(kinds.lava.has('ash'));
});

test('airless worlds and open space have no weather', () => {
  assert.equal(weatherAt({ type: 'rocky', seed: 1, atmo: false, landable: true }).kind, null);
  assert.equal(weatherAt(null).label, 'CLEAR');
});

test('weather can be forced for testing, then released', () => {
  forceWeather({ kind: 'rain', precip: 1, cover: 1, storm: 1 });
  assert.equal(weatherAt(world('terran'), 1.7e12).label, 'THUNDERSTORM');
  forceWeather(null);
  assert.equal(weatherAt(world('terran'), 1.7e12).label, weatherAt(world('terran'), 1.7e12).label);
});
