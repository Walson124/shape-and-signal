import test from 'node:test';
import assert from 'node:assert/strict';
import { planFloor } from '../src/world/floorplan.js';

const blocked = (plan, x, z, r = 0.3) => plan.colliders.some((c) => Math.abs(x - c.x) < c.w / 2 + r && Math.abs(z - c.z) < c.d / 2 + r);

test('floor plans are the same for the same building', () => {
  assert.deepEqual(planFloor('office', 22, 24, 77).rooms, planFloor('office', 22, 24, 77).rooms);
});

test('offices and apartment blocks get furnished rooms off a corridor', () => {
  const office = planFloor('office', 24, 26, 5);
  assert.ok(office.rooms.length >= 4, `rooms: ${office.rooms.length}`);
  assert.ok(office.rooms.some((r) => r.type === 'break'));
  assert.ok(office.fixtures.some((f) => f.kind === 'terminal'));
  assert.ok(office.fixtures.some((f) => f.kind === 'lift'));
  const homes = planFloor('residence', 24, 26, 9);
  assert.ok(homes.rooms.every((r) => r.type === 'flat'));
  assert.ok(homes.fixtures.some((f) => f.kind === 'bed'));
});

test('you can walk from the street door down the corridor and into every room', () => {
  for (let seed = 1; seed < 60; seed++) {
    for (const kind of ['office', 'residence']) {
      const w = 14 + (seed % 7) * 2, d = 14 + (seed % 5) * 3;
      const p = planFloor(kind, w, d, seed);
      // in at the door, then round the reception desk (or mailboxes) on one side or the other
      for (let z = p.Z0 + 0.4; z < p.Z0 + 1.2; z += 0.2) assert.ok(!blocked(p, 0, z), `${kind} ${seed}: doorway blocked at z ${z.toFixed(1)}`);
      // ...then along behind it to the corridor's mouth in the middle of the lobby's back wall
      const clearSide = [-2.25, 2.25].some((x) => {
        for (let z = p.Z0 + 1.2; z < p.LZ - 0.5; z += 0.3) if (blocked(p, x, z, 0.25)) return false;
        for (let k = 0; k <= 1; k += 0.1) if (blocked(p, x * (1 - k), p.LZ - 0.5, 0.25)) return false;
        return true;
      });
      assert.ok(clearSide, `${kind} ${seed}: no way round the lobby desk`);
      // the corridor
      for (let z = p.LZ + 0.3; z < p.Z1 - 0.4; z += 0.4) assert.ok(!blocked(p, 0, z, 0.25), `${kind} ${seed}: corridor blocked at z ${z.toFixed(1)}`);
      // each doorway, and a step inside it
      for (const rm of p.rooms) {
        const doorX = rm.inner;
        assert.ok(!blocked(p, doorX + rm.side * 0.9, rm.door, 0.25), `${kind} ${seed}: ${rm.type} doorway blocked`);
      }
    }
  }
});

test('clubs, stores, gyms and arcades open from the door and nothing usable is walled in', () => {
  for (const kind of ['club', 'store', 'gym', 'arcade']) {
    for (let seed = 1; seed < 40; seed++) {
      const w = 16 + (seed % 6) * 2, d = 16 + (seed % 4) * 3;
      const p = planFloor(kind, w, d, seed);
      for (let z = p.Z0 + 0.4; z < p.Z0 + 2.2; z += 0.3) assert.ok(!blocked(p, 0, z, 0.25), `${kind} ${seed}: door blocked`);
      assert.ok(p.fixtures.length > 0, `${kind} ${seed}: nothing to use`);
      // somewhere you can stand within reach (1.6 m) of everything usable
      for (const fx of p.fixtures) {
        let ok = false;
        for (let a = 0; a < 16 && !ok; a++) for (const rr of [0, 0.8, 1.4]) { const x = fx.x + Math.cos(a / 16 * Math.PI * 2) * rr, z = fx.z + Math.sin(a / 16 * Math.PI * 2) * rr; if (x > p.X0 + 0.3 && x < p.X1 - 0.3 && z > p.Z0 && z < p.Z1 - 0.3 && !blocked(p, x, z, 0.25)) { ok = true; break; } }
        assert.ok(ok, `${kind} ${seed}: can't reach the ${fx.name}`);
      }
    }
  }
});
