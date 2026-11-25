import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, toPlane, fromPlane, whoAt, missingFrom } from '../src/whereto/shade.js';
import { cleanStrokes, validateResponse, validatePlan, isShadePlan } from '../worker/plan-protocol.js';

const geo = { kind: 'geo' };
const img = { kind: 'image', aspect: 0.5 };
// a short horizontal brush stroke at (lon, lat), 30 km wide
const blob = (v, lon, lat, r = 15000) => ({ v, r, p: [lon - 0.1, lat, lon + 0.1, lat] });

test('plane conversion round-trips', () => {
  for (const [lon, lat] of [[0, 0], [135.77, 35.01], [-122.4, 37.8], [151.2, -33.9]]) {
    const [x, y] = toPlane(geo, lon, lat);
    const [lo, la] = fromPlane(geo, x, y);
    assert.ok(Math.abs(lo - lon) < 1e-9 && Math.abs(la - lat) < 1e-9);
  }
  assert.deepEqual(toPlane(img, 0.5, 0.5), [0.5, 0.25]);
});

test('nobody shading gives no analysis', () => {
  assert.equal(analyze([], geo), null);
  assert.equal(analyze([{ name: 'A', strokes: [] }, { name: 'B', strokes: [blob(0, 0, 0)] }], geo), null);
});

test('the overlap of everyone wins, and names who is in', () => {
  const kyoto = [135.77, 35.01], osaka = [135.5, 34.69], tokyo = [139.69, 35.69];
  const responses = [
    { name: 'Ann', strokes: [blob(2, ...kyoto), blob(2, ...tokyo)] },
    { name: 'Bob', strokes: [blob(2, ...kyoto), blob(1, ...osaka)] },
    { name: 'Cy', strokes: [blob(1, ...kyoto, 40000)] },
  ];
  const a = analyze(responses, geo);
  const top = a.regions[0];
  assert.equal(top.count, 3);
  assert.equal(top.all, true);
  assert.deepEqual(top.yes.sort(), ['Ann', 'Bob']);
  assert.deepEqual(top.maybe, ['Cy']);
  const [lon, lat] = fromPlane(geo, ...top.center);
  assert.ok(Math.abs(lon - kyoto[0]) < 0.3 && Math.abs(lat - kyoto[1]) < 0.3, `centre ${lon},${lat}`);
  // Tokyo and Osaka come later, with one person each
  assert.ok(a.regions.slice(1).every((r) => r.count < 3));
  assert.deepEqual(whoAt(a, ...toPlane(geo, ...tokyo)).map((w) => w.name), ['Ann']);
});

test('erasing removes shading, and later strokes win', () => {
  const responses = [{ name: 'Ann', strokes: [blob(2, 10, 10), blob(0, 10, 10, 20000), blob(1, 20, 20)] }];
  const a = analyze(responses, geo);
  assert.equal(whoAt(a, ...toPlane(geo, 10, 10)).length, 0);
  assert.deepEqual(whoAt(a, ...toPlane(geo, 20, 20)), [{ name: 'Ann', v: 1 }]);
});

test('closest area when no place suits everyone', () => {
  const responses = [
    { name: 'Ann', strokes: [{ v: 2, r: 0.05, p: [0.2, 0.2] }] },
    { name: 'Bob', strokes: [{ v: 2, r: 0.05, p: [0.8, 0.8] }] },
    { name: 'Cy', strokes: [{ v: 2, r: 0.05, p: [0.8, 0.8] }] },
    { name: 'Dee', strokes: [] },
  ];
  const a = analyze(responses, img);
  assert.equal(a.regions[0].count, 2);
  assert.equal(a.regions[0].all, false);
  assert.deepEqual(missingFrom(a.regions[0], responses).sort(), ['Ann', 'Dee']);
});

test('stroke validation keeps sane strokes only', () => {
  const geoPlan = { map: { type: 'geo' } }, imgPlan = { map: { type: 'image', shade: true } };
  assert.ok(isShadePlan(geoPlan) && isShadePlan(imgPlan) && !isShadePlan({ map: { type: 'builtin', id: 'world' } }));
  const got = cleanStrokes([
    { v: 2, r: 5000, p: [135.123456789, 35.1] },
    { v: 3, r: 5000, p: [0, 0] },                 // bad value
    { v: 1, r: 1, p: [0, 0] },                    // brush too small
    { v: 1, r: 5000, p: [0, 0, 999, 0] },         // one point off the map is dropped
    { v: 0, r: 5000, p: [1] },                    // odd number of coordinates
    'junk',
  ], geoPlan);
  assert.deepEqual(got, [{ v: 2, r: 5000, p: [135.12346, 35.1] }, { v: 1, r: 5000, p: [0, 0] }]);
  assert.deepEqual(cleanStrokes([{ v: 2, r: 0.05, p: [0.5, 1.5] }], imgPlan), []);
  const many = Array.from({ length: 50 }, () => ({ v: 2, r: 5000, p: Array(400).fill(1) }));
  assert.ok(cleanStrokes(many, geoPlan).reduce((n, s) => n + s.p.length / 2, 0) <= 4000);
  // a spots plan ignores strokes; a shade plan keeps them
  assert.deepEqual(validateResponse({ name: 'A', strokes: [{ v: 2, r: 5000, p: [0, 0] }] }).strokes, []);
  assert.equal(validateResponse({ name: 'A', strokes: [{ v: 2, r: 5000, p: [0, 0] }] }, geoPlan).strokes.length, 1);
});

test('geo and shaded picture plans validate', () => {
  const g = validatePlan({ title: 'Japan', kind: 'travel', map: { type: 'geo', view: [129.5, 30.9, 146, 45.6] } });
  assert.ok(g.ok);
  assert.deepEqual(g.plan.map, { type: 'geo', view: [129.5, 30.9, 146, 45.6] });
  assert.equal(validatePlan({ title: 'x', map: { type: 'geo', view: [10, 0, 5, 1] } }).plan.map.view, null);
  const pic = 'data:image/png;base64,AAAA';
  const s = validatePlan({ title: 'Park', map: { type: 'image', img: pic, w: 100, h: 50, shade: true } });
  assert.ok(s.ok, s.error);
  assert.equal(s.plan.map.shade, true);
  assert.equal(validatePlan({ title: 'Park', map: { type: 'image', img: pic, w: 100, h: 50 } }).ok, false);
});
