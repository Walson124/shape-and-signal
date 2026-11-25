import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, validateResponse, cleanPlanId, newPlanId, hashPassword, decodeDataUrl } from '../worker/plan-protocol.js';
import { rank, verdict } from '../src/whereto/score.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('built-in plans validate; unknown maps and empty names do not', () => {
  const ok = validatePlan({ title: '  Trip <2027>  ', kind: 'travel', map: { type: 'builtin', id: 'world' } });
  assert.ok(ok.ok);
  assert.equal(ok.plan.title, 'Trip 2027');
  assert.equal(ok.image, null);
  assert.equal(validatePlan({ title: 'x', map: { type: 'builtin', id: 'mars' } }).ok, false);
  assert.equal(validatePlan({ title: '', map: { type: 'builtin', id: 'usa' } }).ok, false);
  assert.equal(validatePlan({ title: 'x', kind: 'weird', map: { type: 'builtin', id: 'cities' } }).plan.kind, 'other');
});

test('uploaded maps need a real picture and either spots or a grid', () => {
  const base = { title: 'Office', kind: 'meet' };
  const spots = [{ id: 'r1', name: 'Room A', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { id: 'r1', name: 'dupe', x: 0, y: 0, w: 0.1, h: 0.1 }, { id: 'bad id!', name: 'x', x: 0, y: 0, w: 0.1, h: 0.1 }];
  const v = validatePlan({ ...base, map: { type: 'image', img: PNG, w: 800, h: 600, spots } });
  assert.ok(v.ok);
  assert.equal(v.plan.map.spots.length, 1, 'duplicate and bad ids dropped');
  assert.equal(v.plan.map.img, undefined, 'the picture is stored apart from the plan');
  assert.equal(v.image, PNG);
  assert.equal(validatePlan({ ...base, map: { type: 'image', img: PNG, w: 800, h: 600, spots: [] } }).ok, false);
  const g = validatePlan({ ...base, map: { type: 'image', img: PNG, w: 800, h: 600, grid: { cols: 16, rows: 12 } } });
  assert.deepEqual(g.plan.map.grid, { cols: 16, rows: 12 });
  assert.equal(validatePlan({ ...base, map: { type: 'image', img: 'data:text/html;base64,PGI+', w: 800, h: 600, grid: { cols: 4, rows: 4 } } }).ok, false);
  assert.equal(validatePlan({ ...base, map: { type: 'image', img: PNG, w: 800, h: 600, grid: { cols: 400, rows: 4 } } }).ok, false);
});

test('responses keep only valid marks', () => {
  const r = validateResponse({ name: ' Sam ', marks: { c392: 2, 'p:tokyo': 1, bad: 3, 'no spaces': 2 } });
  assert.deepEqual(r, { ok: true, name: 'Sam', marks: { c392: 2, 'p:tokyo': 1 }, password: '' });
  assert.equal(validateResponse({ name: '', marks: {} }).ok, false);
});

test('ids, passwords and pictures', async () => {
  const id = newPlanId();
  assert.equal(cleanPlanId(id), id);
  assert.equal(cleanPlanId('../etc'), null);
  assert.equal(await hashPassword('pw', 's'), await hashPassword('pw', 's'));
  assert.notEqual(await hashPassword('pw', 's'), await hashPassword('pw', 't'));
  const img = decodeDataUrl(PNG);
  assert.equal(img.type, 'image/png');
  assert.equal(img.bytes[1], 0x50); // 'P' of PNG
});

test('ranking puts spots everyone can do first, then by how many people', () => {
  const spots = [{ id: 'a', name: 'Alps' }, { id: 'b', name: 'Bali' }, { id: 'c', name: 'Cairo' }, { id: 'd', name: 'Denver' }];
  const responses = [
    { name: 'Ann', marks: { a: 2, b: 2, c: 2 } },
    { name: 'Bob', marks: { a: 1, b: 2, c: 2 } },
    { name: 'Cy', marks: { b: 1, c: 2, d: 2 } },
  ];
  const r = rank(spots, responses);
  assert.deepEqual(r.map((t) => t.id), ['c', 'b', 'a', 'd']);
  assert.ok(r[0].all && r[1].all && !r[2].all);
  assert.deepEqual(r[0].yes, ['Ann', 'Bob', 'Cy']);
  const v = verdict(r, 3);
  assert.equal(v.kind, 'all');
  assert.equal(v.top.id, 'c');
  assert.equal(verdict(rank(spots, [{ name: 'Ann', marks: { a: 2 } }, { name: 'Bob', marks: { b: 2 } }]), 2).kind, 'closest');
  assert.equal(verdict([], 0).kind, 'empty');
});
