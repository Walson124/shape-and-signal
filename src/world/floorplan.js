import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { signTexture } from './textures.js';
import { buildNPC } from './interiors.js';
import { propWind } from './props.js';

// Office blocks and apartment buildings you can walk into: a lobby behind the street
// door, a corridor running back from it, and rooms off the corridor through doorways:
// offices, open-plan floors, meeting rooms, break rooms, store rooms, studio flats.
// Each is furnished (desks, chairs, monitors, shelves, sofas, beds, kitchens, plants) and
// lit, and some things in it can be used: terminals, vending machines, coffee, beds,
// sofas, and the lift to the roof.
//
// planFloor() is pure and cheap: walls and big furniture as collision boxes, plus the
// usable fixtures, so the city can make them solid when it is built. buildFloor() makes
// the meshes when you come close, merged into a handful of draw calls.
//
// Building frame: x across the door, z into the building (door at z = -d/2), y up.

export const CEIL = 3.4;       // a dropped ceiling: rooms at a human height inside the tall shell
const SHELL = 0.6;             // the outer walls the city builds
const WALL = 0.15;
const CORR = 1.25;             // half the corridor's width
const DOOR = 1.1;

const COMPANIES = ['Kunlun', 'Azure Gate', 'Xingyun', 'Tianhe', 'Jade Bridge', 'Meridian', 'Nine Dragons', 'Starbridge', 'White Crane', 'Silverline', 'Red Lotus', 'Longmen'];
const TRADES = ['Logistics', 'Holdings', 'Biotech', 'Data Systems', 'Mining Consortium', 'Shipping', 'Insurance', 'Arms Works', 'Media', 'Pharmaceuticals', 'Engineering', 'Trading Co.'];
const PALETTE = {
  wallOffice: [0xd8d6d0, 0xc9ccd0, 0xd2cec4, 0xbfc6c9],
  wallHome: [0xe0d6c4, 0xcfd8d2, 0xd8c8c0, 0xc8ccd8],
  accent: [0x2f5d7c, 0x7c3a2f, 0x3f6b4a, 0x5a4a7a, 0x8a6a2a],
  wood: [0x8a6040, 0x6e4a30, 0xa07850, 0x5a3c28],
  fabric: [0x3a4656, 0x5a3a3a, 0x3d5a4a, 0x6a6a72, 0x2a2e38, 0x7a5a3a],
};

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];

/**
 * A floor plan: rooms, walls (with doorways), collision boxes, fixtures.
 * kind: 'office' | 'residence'.
 */
export const HALLS = new Set(['club', 'store', 'gym', 'arcade']);

export function planFloor(kind, w, d, seed) {
  if (HALLS.has(kind)) return planHall(kind, w, d, seed);
  const r = rng(seed);
  const X0 = -w / 2 + SHELL, X1 = w / 2 - SHELL, Z0 = -d / 2 + SHELL, Z1 = d / 2 - SHELL;
  const lobbyD = THREE.MathUtils.clamp(d * 0.3, 5, 8);
  const LZ = Z0 + lobbyD;
  const walls = [];      // { x0, z0, x1, z1 } axis-aligned centre lines, with gaps already cut
  const gaps = [];       // doorways, for frames and door leaves: { x, z, axis: 'x'|'z' }
  const rooms = [];
  const colliders = [];
  const fixtures = [];
  // the lobby's back wall, open to the corridor
  walls.push({ x0: X0, z0: LZ, x1: -CORR, z1: LZ }, { x0: CORR, z0: LZ, x1: X1, z1: LZ });
  // rooms down each side of the corridor
  for (const s of [-1, 1]) {
    const inner = s * CORR, outer = s > 0 ? X1 : X0;
    const width = Math.abs(outer - inner);
    if (width < 3.2) { walls.push({ x0: inner, z0: LZ, x1: inner, z1: Z1 }); continue; }
    let z = LZ;
    const cuts = [];
    while (Z1 - z > 3.5) {
      const len = Math.min(Z1 - z, kind === 'residence' ? 5.5 + r() * 1.5 : 4 + r() * 3.5);
      const end = Z1 - (z + len) < 3 ? Z1 : z + len;
      cuts.push([z, end]);
      z = end;
    }
    if (!cuts.length) { walls.push({ x0: inner, z0: LZ, x1: inner, z1: Z1 }); continue; }
    // the corridor wall, with a doorway into each room
    let at = LZ;
    for (const [a, b] of cuts) {
      const dz = THREE.MathUtils.clamp(a + 1.2 + DOOR / 2, a + DOOR / 2 + 0.3, b - DOOR / 2 - 0.3);
      walls.push({ x0: inner, z0: at, x1: inner, z1: dz - DOOR / 2 });
      gaps.push({ x: inner, z: dz, axis: 'z', side: s });
      at = dz + DOOR / 2;
      rooms.push({ side: s, x0: Math.min(inner, outer), x1: Math.max(inner, outer), z0: a, z1: b, door: dz, inner, outer, type: null });
      if (b < Z1) walls.push({ x0: inner, z0: b, x1: outer, z1: b });
    }
    walls.push({ x0: inner, z0: at, x1: inner, z1: Z1 });
  }
  // what each room is for
  const types = kind === 'residence' ? ['flat'] : ['office', 'open', 'meeting', 'break', 'office', 'storage', 'open', 'office'];
  rooms.sort((a, b) => a.z0 - b.z0 || a.side - b.side);
  rooms.forEach((rm, i) => {
    const area = (rm.x1 - rm.x0) * (rm.z1 - rm.z0);
    let t = kind === 'residence' ? 'flat' : types[i % types.length];
    if (t === 'open' && area < 22) t = 'office';
    if (t === 'meeting' && area < 14) t = 'office';
    if (kind === 'office' && i === 1 && !rooms.some((x) => x.type === 'break')) t = 'break';
    rm.type = t;
  });
  // walls collide
  for (const wl of walls) {
    const len = Math.hypot(wl.x1 - wl.x0, wl.z1 - wl.z0);
    if (len < 0.05) continue;
    const cx = (wl.x0 + wl.x1) / 2, cz = (wl.z0 + wl.z1) / 2;
    const alongX = Math.abs(wl.x1 - wl.x0) > Math.abs(wl.z1 - wl.z0);
    colliders.push({ x: cx, z: cz, w: alongX ? len : WALL, d: alongX ? WALL : len, h: CEIL });
  }
  const name = kind === 'residence' ? `${pick(r, COMPANIES)} Residences` : `${pick(r, COMPANIES)} ${pick(r, TRADES)}`;
  const plan = { kind, w, d, seed, X0, X1, Z0, Z1, LZ, walls, gaps, rooms, colliders, fixtures, name, items: [] };
  furnish(plan, r);
  return plan;
}

// ---- furniture: laid out at plan time (collision + fixtures), meshed later from plan.items
// an item: { f: builder name, x, z, ry, ...params }; colliders are added here too
function furnish(p, r) {
  const add = (it, box) => {
    p.items.push(it);
    if (box) {
      const sw = Math.abs(Math.sin(it.ry || 0)) > 0.5;
      p.colliders.push({ x: it.x, z: it.z, w: sw ? box[1] : box[0], d: sw ? box[0] : box[1], h: box[2] });
    }
  };
  const fix = (kind, name, x, y, z) => p.fixtures.push({ kind, name, x, y, z, id: `${p.seed}:${p.fixtures.length}` });
  // ---- lobby
  const midZ = (p.Z0 + p.LZ) / 2;
  if (p.kind === 'office') {
    add({ f: 'reception', x: 0, z: p.LZ - 1.6, ry: 0 }, [3.4, 1.0, 1.1]);
    add({ f: 'npc', x: 0, z: p.LZ - 0.8, ry: Math.PI, sit: false });
  } else {
    // mailboxes along the side wall, clear of the way through to the corridor
    add({ f: 'mailboxes', x: p.X1 - 0.25, z: midZ, ry: Math.PI / 2 }, [3, 0.4, 1.8]);
  }
  add({ f: 'sign', x: 0, z: p.LZ - 0.09, ry: Math.PI, text: p.name.toUpperCase() });
  for (const s of [-1, 1]) {
    const sx = s * (p.X1 - 1.6);
    if (Math.abs(sx) > 3.5 && !(p.kind === 'residence' && s > 0)) {
      add({ f: 'sofa', x: sx, z: midZ, ry: s * Math.PI / 2, color: pick(r, PALETTE.fabric) }, [2.1, 0.9, 0.9]);
      add({ f: 'coffeeTable', x: sx - s * 1.3, z: midZ, ry: Math.PI / 2 }, [1.1, 0.6, 0.45]);
      fix('seat', 'sofa', sx, 0.5, midZ);
    }
    add({ f: 'plant', x: s * (p.X1 - 0.6), z: p.Z0 + 0.7, big: true });
    // lifts either side of the corridor
    add({ f: 'lift', x: s * (CORR + 1.4), z: p.LZ - 0.1, ry: 0 });
    fix('lift', 'lift to the roof', s * (CORR + 1.4), 1.2, p.LZ - 0.8);
  }
  add({ f: 'vending', x: p.X0 + 0.55, z: p.LZ - 1.0, ry: -Math.PI / 2 }, [1.0, 0.8, 1.9]);
  fix('vending', 'vending machine', p.X0 + 1.1, 1.0, p.LZ - 1.0);
  add({ f: 'rug', x: 0, z: midZ - 0.3, w: Math.min(5, p.X1 - p.X0 - 4), d: Math.min(3, p.LZ - p.Z0 - 2.5), color: pick(r, PALETTE.accent) });
  add({ f: 'plant', x: CORR + 0.35, z: p.LZ + 0.4 });

  // ---- rooms
  for (const rm of p.rooms) {
    const s = rm.side;
    const W = rm.x1 - rm.x0, D = rm.z1 - rm.z0;
    // room coordinates: u from the corridor wall toward the outside wall, v along the corridor
    const X = (u) => rm.inner + s * u;
    const faceCorr = -s * Math.PI / 2;  // an item's front (+z) turned toward the corridor
    const faceOut = s * Math.PI / 2;
    const nearDoor = (u, v) => u < 1.6 && Math.abs(v - rm.door) < 1.3;
    if (rm.type === 'office') {
      // a desk facing the door, against the outside wall
      const u = W - 1.1, v = (rm.z0 + rm.z1) / 2;
      add({ f: 'desk', x: X(u), z: v, ry: faceCorr, chair: true, monitors: 2 }, [1.7, 0.85, 0.8]);
      fix('terminal', 'office terminal', X(u - 0.25), 1.1, v);
      add({ f: 'shelf', x: X(W / 2), z: rm.z0 + 0.25, ry: Math.PI, books: true }, [Math.min(2.2, W - 1.5), 0.4, 2.1]);
      add({ f: 'cabinet', x: X(W - 0.35), z: rm.z1 - 0.5, ry: faceOut }, [0.5, 0.6, 1.3]);
      add({ f: 'plant', x: X(W - 0.45), z: rm.z0 + 0.5 });
      if (D > 4.5) add({ f: 'armchair', x: X(1.0), z: rm.z1 - 0.8, ry: faceCorr, color: pick(r, PALETTE.fabric) }, [0.8, 0.8, 0.9]);
      add({ f: 'whiteboard', x: rm.inner + s * 0.09, z: rm.z1 - 1.1, ry: faceCorr });
    } else if (rm.type === 'open') {
      const cols = Math.max(1, Math.floor((W - 1.6) / 2.2)), rows = Math.max(1, Math.floor((D - 1.2) / 1.9));
      let n = 0;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const u = 1.6 + 1.1 + i * 2.2, v = rm.z0 + 0.95 + j * 1.9;
        if (u > W - 0.9 || nearDoor(u, v)) continue;
        add({ f: 'desk', x: X(u), z: v, ry: j % 2 ? 0 : Math.PI, chair: true, monitors: 1, divider: true }, [1.6, 0.8, 1.15]);
        if (n++ % 3 === 0) fix('terminal', 'workstation', X(u), 1.1, v);
        if (r() < 0.35) add({ f: 'npc', x: X(u), z: v + (j % 2 ? -0.62 : 0.62), ry: j % 2 ? 0 : Math.PI, sit: true });
      }
      add({ f: 'printer', x: X(0.5), z: rm.z1 - 0.6, ry: faceCorr }, [0.7, 0.6, 1.0]);
      add({ f: 'plant', x: X(W - 0.45), z: rm.z1 - 0.45, big: true });
      add({ f: 'cooler', x: X(W - 0.4), z: rm.z0 + 0.4, ry: faceCorr }, [0.4, 0.4, 1.3]);
      fix('coffee', 'water cooler', X(W - 0.8), 1.0, rm.z0 + 0.4);
    } else if (rm.type === 'meeting') {
      const L = Math.min(W - 2.2, 5.2), v = (rm.z0 + rm.z1) / 2;
      add({ f: 'meetingTable', x: X(1.4 + L / 2 + 0.2), z: v, ry: Math.PI / 2, len: L }, [Math.min(1.3, D - 2.4), L, 0.78]);
      for (let k = 0; k < Math.floor(L / 0.9); k++) for (const side of [-1, 1]) {
        const u = 1.6 + 0.45 + k * 0.9;
        add({ f: 'chair', x: X(u), z: v + side * 1.05, ry: side > 0 ? Math.PI : 0 });
      }
      add({ f: 'screen', x: rm.outer - s * 0.08, z: v, ry: faceOut, w: Math.min(2.6, D - 1) });
      add({ f: 'plant', x: X(W - 0.4), z: rm.z0 + 0.4 });
    } else if (rm.type === 'break') {
      // a kitchen run along the far wall, a table, a sofa
      const run = Math.min(D - 1, 4);
      add({ f: 'kitchen', x: rm.outer - s * 0.33, z: rm.z0 + 0.5 + run / 2, ry: faceOut, len: run }, [run, 0.65, 0.95]);
      add({ f: 'fridge', x: rm.outer - s * 0.38, z: rm.z0 + 0.5 + run + 0.45, ry: faceOut }, [0.75, 0.75, 1.9]);
      fix('coffee', 'coffee machine', X(W - 1.0), 1.1, rm.z0 + 0.5 + run * 0.3);
      const tx = X(W / 2), tz = rm.z1 - 1.3;
      add({ f: 'table', x: tx, z: tz, ry: 0 }, [1.2, 1.2, 0.76]);
      for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.4; add({ f: 'chair', x: tx + Math.cos(a) * 0.85, z: tz + Math.sin(a) * 0.85, ry: Math.atan2(-Math.cos(a), -Math.sin(a)) }); }
      if (W > 4) add({ f: 'vending', x: X(1.0), z: rm.z1 - 0.45, ry: 0 }, [1.0, 0.8, 1.9]);
      if (W > 4) fix('vending', 'vending machine', X(1.0), 1.0, rm.z1 - 1.0);
      add({ f: 'plant', x: X(W - 0.45), z: rm.z1 - 0.45 });
    } else if (rm.type === 'storage') {
      for (let k = 0; k < Math.floor((D - 0.6) / 1.4); k++) add({ f: 'rack', x: X(W - 0.45), z: rm.z0 + 0.8 + k * 1.4, ry: faceCorr }, [1.2, 0.6, 2.2]);
      for (let k = 0; k < 4; k++) add({ f: 'crate', x: X(1.8 + r() * Math.max(0.1, W - 3)), z: rm.z0 + 0.6 + r() * (D - 1.2), ry: r() * 0.4, size: 0.4 + r() * 0.35 });
    } else if (rm.type === 'flat') {
      // a studio flat: bed against the outside wall, a living corner, a kitchenette by the door
      const bedV = rm.z1 - 1.25;
      add({ f: 'bed', x: X(W - 1.1), z: bedV, ry: faceOut, color: pick(r, PALETTE.fabric) }, [1.6, 2.1, 0.7]);
      fix('bed', 'bed', X(W - 1.1), 0.6, bedV);
      add({ f: 'nightstand', x: X(W - 0.3), z: bedV - 1.15, ry: faceCorr }, [0.45, 0.45, 0.6]);
      add({ f: 'wardrobe', x: X(W - 0.35), z: rm.z0 + 0.7, ry: faceCorr }, [1.2, 0.6, 2.2]);
      const lv = (rm.z0 + bedV) / 2;
      // the living corner sits past the doorway, the sofa facing a screen on the outside wall
      if (W > 4.2) {
        const us = Math.max(2.1, W - 2.7);
        add({ f: 'sofa', x: X(us), z: lv, ry: faceCorr, color: pick(r, PALETTE.fabric) }, [2.0, 0.9, 0.9]);
        fix('seat', 'sofa', X(us), 0.5, lv);
        add({ f: 'tv', x: X(W - 0.3), z: lv, ry: faceCorr }, [1.4, 0.45, 1.3]);
        add({ f: 'coffeeTable', x: X((us + W - 0.3) / 2), z: lv, ry: Math.PI / 2 }, [1.0, 0.55, 0.45]);
        add({ f: 'rug', x: X((us + W - 0.3) / 2), z: lv, w: 2.0, d: 1.5, color: pick(r, PALETTE.accent) });
      }
      // the kitchenette runs along the corridor wall at the far end, clear of the door; in a short
      // flat it goes on the end wall instead, if there's room beside the bed
      if (rm.z1 - 0.4 - 1.8 > rm.door + DOOR / 2 + 0.35) add({ f: 'kitchen', x: X(0.35), z: rm.z1 - 0.4 - 0.9, ry: faceCorr, len: 1.8 }, [1.8, 0.62, 0.95]);
      else if (W > 5.6) add({ f: 'kitchen', x: X(2.5), z: rm.z1 - 0.33, ry: 0, len: 1.8 }, [1.8, 0.62, 0.95]);
      add({ f: 'plant', x: X(W - 0.4), z: rm.z1 - 0.35 });
    }
    // every room: a ceiling light over its middle
    add({ f: 'ceilingLight', x: X(W / 2), z: (rm.z0 + rm.z1) / 2, w: Math.min(2.4, W - 1), d: 0.5 });
    rm.wall = p.kind === 'residence' ? pick(r, PALETTE.wallHome) : pick(r, PALETTE.wallOffice);
  }
  for (let z = p.LZ + 1.5; z < p.Z1 - 0.5; z += 3) add({ f: 'ceilingLight', x: 0, z, w: 0.5, d: 1.2 });
  for (const x of [-(p.X1 - p.X0) / 4, (p.X1 - p.X0) / 4]) add({ f: 'ceilingLight', x, z: midZ, w: 1.2, d: 1.2 });
  p.lobbyWall = p.kind === 'residence' ? pick(r, PALETTE.wallHome) : 0xcfd2d6;
  p.accent = pick(r, PALETTE.accent);
}

// ---- open halls: one big room, laid out for what it is
const HALL_NAMES = {
  club: ['NEON LOTUS', 'VOID', 'STARFALL', 'JADE DRAGON', 'AFTERBURN', 'NINTH HEAVEN'],
  store: ['24/7 MART', 'QUICKSTOP', 'STARMART', 'LUCKY 8'],
  gym: ['IRON BODY GYM', 'WAR GOD FITNESS', 'MERIDIAN STRENGTH'],
  arcade: ['PIXEL PALACE', 'QI ARCADE', 'COIN-OP HEAVEN', 'HIGH SCORE'],
};
function planHall(kind, w, d, seed) {
  const r = rng(seed);
  const X0 = -w / 2 + SHELL, X1 = w / 2 - SHELL, Z0 = -d / 2 + SHELL, Z1 = d / 2 - SHELL;
  const W = X1 - X0, D = Z1 - Z0;
  const p = { kind, w, d, seed, X0, X1, Z0, Z1, LZ: Z0, walls: [], gaps: [], rooms: [], colliders: [], fixtures: [], items: [], name: pick(r, HALL_NAMES[kind]), windows: kind === 'store' || kind === 'gym',
    accent: { club: 0xff2fa0, store: 0x2fae5a, gym: 0xff8a2a, arcade: 0x2fb8d8 }[kind] };
  const add = (it, box) => {
    p.items.push(it);
    if (box) {
      const sw = Math.abs(Math.sin(it.ry || 0)) > 0.5;
      p.colliders.push({ x: it.x, z: it.z, w: sw ? box[1] : box[0], d: sw ? box[0] : box[1], h: box[2] });
    }
  };
  const fix = (k, name, x, y, z) => p.fixtures.push({ kind: k, name, x, y, z, id: `${seed}:${p.fixtures.length}` });
  add({ f: 'sign', x: 0, z: Z1 - 0.09, ry: Math.PI, text: p.name });
  if (kind === 'club') {
    p.floors = [{ x0: X0, z0: Z0 - SHELL, x1: X1, z1: Z1, hex: 0x1a1a22, pattern: 0 }];
    p.lobbyWall = 0x1c1a24;
    // the bar down the left wall, stools in front, bottles glowing behind
    const barLen = Math.min(8, D - 6);
    const bz = Z0 + 3 + barLen / 2;
    add({ f: 'barShelf', x: X0 + 0.2, z: bz, ry: Math.PI / 2, len: barLen });
    add({ f: 'bar', x: X0 + 1.3, z: bz, ry: Math.PI / 2, len: barLen }, [barLen, 0.7, 1.1]);
    add({ f: 'npc', x: X0 + 0.75, z: bz, ry: Math.PI / 2, pose: 'stand' });
    for (let k = 0; k < Math.floor(barLen / 0.9); k++) add({ f: 'stool', x: X0 + 2.15, z: Z0 + 3.4 + k * 0.9 });
    fix('bar', 'the bar', X0 + 2.0, 1.1, bz);
    // a stage and DJ booth at the back, the dance floor before it, light beams over it
    const fw = Math.min(8, W - 7), fd = Math.min(7, D - 9);
    const fz = Z1 - 3.2 - fd / 2;
    add({ f: 'stage', x: 0, z: Z1 - 1.5, w: Math.min(6, W - 4), d: 2.4 });
    add({ f: 'djBooth', x: 0, z: Z1 - 1.6, ry: Math.PI }, [2.2, 0.8, 1.15]);
    add({ f: 'npc', x: 0, z: Z1 - 1.0, ry: Math.PI, pose: 'stand' });
    add({ f: 'disco', x: 0, z: fz, w: fw, d: fd });
    fix('dance', 'the dance floor', 0, 1, fz);
    for (let k = 0; k < 7; k++) add({ f: 'npc', x: (r() - 0.5) * (fw - 1.2), z: fz + (r() - 0.5) * (fd - 1.2), ry: r() * 6.28, pose: 'dance' });
    for (let k = 0; k < 4; k++) add({ f: 'beam', x: (k - 1.5) * (fw / 4), z: fz + (k % 2 ? 1 : -1) * fd * 0.25, color: pick(r, [0xff2fa0, 0x3ef2ff, 0xa86cff, 0xffb347]), tilt: (r() - 0.5) * 0.5 });
    // booths down the right wall
    for (let k = 0; k < Math.floor((D - 4) / 3.4); k++) {
      const z = Z0 + 2.6 + k * 3.4;
      if (z > fz - fd / 2 - 1.2 && X1 - 2 < fw / 2 + 1) continue;
      add({ f: 'sofa', x: X1 - 0.5, z, ry: Math.PI / 2, color: pick(r, [0x5a1a3a, 0x2a1a4a, 0x1a3a4a]) }, [2.1, 0.9, 0.9]);
      add({ f: 'coffeeTable', x: X1 - 1.75, z, ry: Math.PI / 2 }, [1.1, 0.6, 0.45]);
      if (r() < 0.6) add({ f: 'npc', x: X1 - 0.75, z: z + (r() - 0.5), ry: -Math.PI / 2, pose: 'sit' });
      fix('seat', 'booth', X1 - 0.9, 0.5, z);
    }
    for (const [x0, z0, x1, z1] of [[X0, Z0, X0, Z1], [X1, Z0, X1, Z1], [X0, Z1, X1, Z1]]) add({ f: 'neonStrip', x0, z0, x1, z1, y: 2.7, color: pick(r, [0xff2fa0, 0x3ef2ff, 0xa86cff]) });
    add({ f: 'neonStrip', x0: X0, z0: Z1, x1: X1, z1: Z1, y: 0.15, color: 0x3ef2ff });
  } else if (kind === 'store') {
    p.floors = [{ x0: X0, z0: Z0 - SHELL, x1: X1, z1: Z1, hex: 0xe0dcd4, pattern: 0 }];
    p.lobbyWall = 0xe8e6e0;
    // the till by the door, aisles of shelves, drinks fridges along the back
    add({ f: 'checkout', x: X1 - 1.6, z: Z0 + 2.2, ry: -Math.PI / 2 }, [1.0, 2.4, 1.0]);
    add({ f: 'npc', x: X1 - 0.8, z: Z0 + 2.2, ry: -Math.PI / 2, pose: 'stand' });
    p.service = { kind: 'pills', x: X1 - 2.6, z: Z0 + 2.2 };
    const aisles = Math.max(1, Math.floor((W - 3) / 2.4));
    for (let a = 0; a < aisles; a++) {
      const x = X0 + 1.6 + a * 2.4;
      if (x > X1 - 3.4) break;
      const len = Math.max(2, D - 7.5);
      add({ f: 'aisle', x, z: Z0 + 4.2 + len / 2, len }, [0.9, len, 1.7]);
    }
    const fl = Math.min(W - 2, 9);
    add({ f: 'fridgeWall', x: 0, z: Z1 - 0.45, ry: Math.PI, len: fl }, [fl, 0.8, 2.1]);
    fix('vending', 'drinks fridge', 0, 1.1, Z1 - 1.2);
    if (r() < 0.8) add({ f: 'npc', x: X0 + 2.8, z: Z0 + 5, ry: Math.PI / 2, pose: 'stand' });
    for (let x = X0 + 2; x < X1 - 1; x += 2.6) for (let z = Z0 + 2; z < Z1 - 1; z += 2.6) add({ f: 'ceilingLight', x, z, w: 1.6, d: 0.3 });
  } else if (kind === 'gym') {
    p.floors = [{ x0: X0, z0: Z0 - SHELL, x1: X1, z1: Z1, hex: 0x2a2c30, pattern: 0 }];
    p.lobbyWall = 0x9aa0a8;
    const racks = Math.min(3, Math.floor((D - 4) / 2.4));
    for (let k = 0; k < racks; k++) add({ f: 'weightRack', x: X0 + 0.45, z: Z0 + 3 + k * 2.4, ry: Math.PI / 2 }, [1.8, 0.6, 1.1]);
    for (let k = 0; k < Math.floor((D - 5) / 2.2); k++) {
      const z = Z0 + 3 + k * 2.2;
      add({ f: 'bench', x: X0 + 2.6, z, ry: 0 }, [0.5, 1.3, 0.5]);
      if (k % 2 === 0) fix('train', 'bench press', X0 + 2.6, 0.8, z);
    }
    for (let k = 0; k < Math.floor((D - 4) / 1.6); k++) {
      const z = Z0 + 2.4 + k * 1.6;
      add({ f: 'treadmill', x: X1 - 1.1, z, ry: Math.PI / 2 }, [0.9, 2.0, 1.4]);
      if (k % 2 === 1) fix('train', 'treadmill', X1 - 2.2, 1, z);
      if (r() < 0.35) add({ f: 'npc', x: X1 - 1.1, z, ry: -Math.PI / 2, pose: 'stand' });
    }
    for (let k = 0; k < Math.min(3, Math.floor((W - 6) / 2)); k++) {
      add({ f: 'bag', x: -1.5 + k * 2, z: Z1 - 1.6 }, [0.6, 0.6, 1.8]);
      fix('bag', 'punching bag', -1.5 + k * 2, 1.2, Z1 - 2.3);
    }
    add({ f: 'mirror', x: 0, z: Z1 - 0.06, ry: Math.PI, w: Math.min(W - 2, 10) });
    for (let x = X0 + 2; x < X1 - 1; x += 3) for (let z = Z0 + 2; z < Z1 - 1; z += 3) add({ f: 'ceilingLight', x, z, w: 2.2, d: 0.35 });
  } else if (kind === 'arcade') {
    p.floors = [{ x0: X0, z0: Z0 - SHELL, x1: X1, z1: Z1, hex: 0x2a1a3a, pattern: 2 }];
    p.lobbyWall = 0x1a1424;
    const rows = Math.max(1, Math.floor((W - 3) / 3));
    let n = 0;
    for (let row = 0; row < rows; row++) {
      const x = X0 + 2 + row * 3;
      if (x > X1 - 1.5) break;
      for (let z = Z0 + 3.5; z < Z1 - 2.5; z += 1.0) {
        for (const side of [-1, 1]) {
          add({ f: 'cabinet', x: x + side * 0.45, z, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2, color: pick(r, [0xff2fa0, 0x3ef2ff, 0xffb347, 0x5dffa8, 0xa86cff]) }, [0.8, 0.8, 1.8]);
          if (n++ % 3 === 0) fix('arcade', 'arcade cabinet', x + side * 1.3, 1.2, z);
        }
      }
    }
    for (let k = 0; k < 2; k++) {
      add({ f: 'claw', x: X1 - 1.0, z: Z0 + 1.6 + k * 1.5, ry: -Math.PI / 2 }, [1.0, 1.0, 2.0]);
      fix('claw', 'claw machine', X1 - 1.9, 1.2, Z0 + 1.6 + k * 1.5);
    }
    for (let k = 0; k < 4; k++) add({ f: 'npc', x: X0 + 2 + Math.floor(r() * rows) * 3 + (r() < 0.5 ? -1.3 : 1.3), z: Z0 + 4 + r() * (D - 7), ry: r() * 6.28, pose: 'stand' });
    for (const [x0, z0, x1, z1] of [[X0, Z0, X0, Z1], [X1, Z0, X1, Z1], [X0, Z1, X1, Z1]]) add({ f: 'neonStrip', x0, z0, x1, z1, y: 2.9, color: pick(r, [0xff2fa0, 0x3ef2ff, 0xa86cff, 0x5dffa8]) });
  }
  return p;
}

// ---------------------------------------------------------------- meshes --
let MATS = null;
export const windowLight = new THREE.Color(0.8, 0.9, 1.0);
function materials() {
  if (MATS) return MATS;
  const floor = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.02 });
  // floors draw their own pattern: stone tiles, wood planks, carpet tiles
  floor.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute float pattern;\nvarying float vPat;\nvarying vec2 vFP;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = pattern;\nvFP = position.xz;');
    shader.fragmentShader = `varying float vPat;\nvarying vec2 vFP;\nfloat fh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
      if (vPat < 0.5) {
        // stone tiles with thin grout and a little tone in each tile
        vec2 c = floor(vFP / 0.8); vec2 f = fract(vFP / 0.8);
        float grout = step(0.97, max(f.x, f.y)) + step(max(f.x, f.y), 0.03);
        diffuseColor.rgb *= (0.92 + 0.12 * fh(c)) * (1.0 - 0.35 * clamp(grout, 0.0, 1.0));
      } else if (vPat < 1.5) {
        // wood planks, staggered, each its own shade, with fine grain
        float row = floor(vFP.x / 0.18);
        float len = floor((vFP.y + fh(vec2(row, 1.0)) * 2.0) / 1.6);
        float edge = step(0.94, fract(vFP.x / 0.18)) + step(0.985, fract((vFP.y + fh(vec2(row, 1.0)) * 2.0) / 1.6));
        float grain = 0.94 + 0.06 * sin(vFP.y * 40.0 + fh(vec2(row, len)) * 30.0 + sin(vFP.x * 9.0) * 2.0);
        diffuseColor.rgb *= (0.82 + 0.3 * fh(vec2(row, len))) * grain * (1.0 - 0.4 * clamp(edge, 0.0, 1.0));
      } else {
        // carpet tiles laid in alternating directions, with fibre noise
        vec2 c = floor(vFP / 0.6);
        float dir = mod(c.x + c.y, 2.0);
        float fib = fh(floor(vFP * 90.0));
        diffuseColor.rgb *= (0.9 + 0.08 * dir) * (0.93 + 0.1 * fib);
      }`);
  };
  floor.customProgramCacheKey = () => 'floorplan-floor';
  MATS = {
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }),
    gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.45 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2.2, 2.2) }),
    glass: new THREE.MeshStandardMaterial({ color: 0xa8c8d8, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide }),
    window: new THREE.MeshBasicMaterial({ color: windowLight }),
    disco: discoMaterial(),
    beam: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    shade: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, alphaMap: shadeTexture(), depthWrite: false }),
    floor,
  };
  MATS.window.color = windowLight; // shared: the game tints it with the sky outside
  return MATS;
}

// a rounded rectangle that fades out to its edges, for the shadow under a piece of furniture
function shadeTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
  g.filter = 'blur(7px)';
  g.fillStyle = '#fff'; g.fillRect(14, 14, 36, 36);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// a dance floor of light tiles that change colour to the beat
function discoMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uT = propWind;
    shader.vertexShader = `varying vec2 vDP;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDP = position.xz;');
    shader.fragmentShader = `uniform float uT;\nvarying vec2 vDP;\n${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 c = floor(vDP / 0.8); vec2 f = fract(vDP / 0.8);
      float beat = floor(uT * 2.2);
      float h = fract(sin(dot(c + beat * vec2(1.3, 2.1), vec2(12.9898, 78.233))) * 43758.5453);
      vec3 col = h < 0.25 ? vec3(1.0, 0.18, 0.62) : h < 0.5 ? vec3(0.24, 0.95, 1.0) : h < 0.7 ? vec3(0.66, 0.42, 1.0) : h < 0.85 ? vec3(1.0, 0.7, 0.28) : vec3(0.05);
      float edge = smoothstep(0.0, 0.06, min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)));
      float pulse = 0.55 + 0.45 * pow(fract(uT * 2.2), 0.4);
      diffuseColor.rgb = col * edge * (1.0 - 0.6 * fract(uT * 2.2)) * 1.6 * pulse + vec3(0.02);`);
  };
  m.customProgramCacheKey = () => 'disco-floor';
  return m;
}

function geoBox(w, h, d) { const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.deleteAttribute('uv'); return g; }
function geoCyl(rt, rb, h, seg = 12) { const g = new THREE.CylinderGeometry(rt, rb, h, seg).toNonIndexed(); g.deleteAttribute('uv'); return g; }
function geoSphere(r, w = 8, h = 6) { const g = new THREE.SphereGeometry(r, w, h).toNonIndexed(); g.deleteAttribute('uv'); return g; }
function paint(g, hex) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

export function buildFloor(plan) {
  const M = materials();
  const L = { solid: [], gloss: [], glow: [], glass: [], window: [], floor: [], disco: [], beam: [] };
  const own = [];
  const g = new THREE.Group();
  const r = rng(plan.seed ^ 0x9e37);
  // place a piece: geometry in item space, then turned by ry and moved to (x, z)
  const put = (list, geo, x, y, z, ry, hex, lx = 0, ly = 0, lz = 0) => {
    geo.translate(lx, ly, lz);
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    if (list !== 'window' && list !== 'glass' && list !== 'disco') paint(geo, hex);
    L[list].push(geo);
  };
  // ---- floors
  const floorQuad = (x0, z0, x1, z1, hex, pattern) => {
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).toNonIndexed();
    geo.deleteAttribute('uv');
    geo.translate((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
    paint(geo, hex);
    geo.setAttribute('pattern', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(pattern), 1));
    L.floor.push(geo);
  };
  const { X0, X1, Z0, Z1, LZ } = plan;
  if (plan.floors) for (const fl of plan.floors) floorQuad(fl.x0, fl.z0, fl.x1, fl.z1, fl.hex, fl.pattern);
  else {
    floorQuad(X0, Z0 - SHELL, X1, LZ, 0xc8c2b8, 0);                    // lobby: stone (and under the door)
    floorQuad(-CORR, LZ, CORR, Z1, 0x3a4250, 2);                       // corridor: carpet
  }
  for (const rm of plan.rooms) {
    const t = rm.type;
    const [hex, pat] = t === 'flat' ? [pick(r, [0x9a6a44, 0x7e5838, 0xb08a60]), 1] : t === 'break' ? [0xd8d4cc, 0] : t === 'storage' ? [0x8a8a86, 0] : t === 'meeting' ? [0x4a3a3a, 2] : [pick(r, [0x5a606a, 0x4a525c, 0x606058]), 2];
    floorQuad(rm.x0, rm.z0, rm.x1, rm.z1, hex, pat);
  }
  // ---- ceiling (facing down) over everything inside
  {
    const geo = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0 + SHELL).rotateX(Math.PI / 2).toNonIndexed();
    geo.deleteAttribute('uv');
    put('solid', geo, (X0 + X1) / 2, CEIL, (Z0 + Z1 - SHELL) / 2, 0, 0xe6e6e2);
  }
  // ---- walls: partition walls, skirting, and linings on the inside of the outer shell
  const wallColorAt = (x, z) => {
    for (const rm of plan.rooms) if (x >= rm.x0 - 0.2 && x <= rm.x1 + 0.2 && z >= rm.z0 - 0.2 && z <= rm.z1 + 0.2) return rm.wall;
    return plan.lobbyWall;
  };
  for (const wl of plan.walls) {
    const len = Math.hypot(wl.x1 - wl.x0, wl.z1 - wl.z0);
    if (len < 0.05) continue;
    const alongX = Math.abs(wl.x1 - wl.x0) > Math.abs(wl.z1 - wl.z0);
    const cx = (wl.x0 + wl.x1) / 2, cz = (wl.z0 + wl.z1) / 2;
    const hex = wallColorAt(cx + (alongX ? 0 : 0.3), cz + (alongX ? 0.3 : 0));
    put('solid', geoBox(alongX ? len : WALL, CEIL, alongX ? WALL : len), cx, CEIL / 2, cz, 0, hex);
    put('solid', geoBox(alongX ? len : WALL + 0.03, 0.1, alongX ? WALL + 0.03 : len), cx, 0.05, cz, 0, 0x3a3634);
  }
  // linings on the outer walls, with windows onto the street in rooms
  const lining = (x0, z0, x1, z1, windows) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    put('solid', geoBox(alongX ? len : 0.04, CEIL, alongX ? 0.04 : len), cx, CEIL / 2, cz, 0, wallColorAt(cx, cz));
    put('solid', geoBox(alongX ? len : 0.07, 0.1, alongX ? 0.07 : len), cx, 0.05, cz, 0, 0x3a3634);
    if (!windows) return;
    for (let t = 1.2; t < len - 1.0; t += 2.4) {
      const k = (t - len / 2);
      const wx = alongX ? cx + k : cx, wz = alongX ? cz : cz + k;
      const off = alongX ? [0, 0, -Math.sign(cz) * 0.03] : [-Math.sign(cx) * 0.03, 0, 0];
      // a pane of light from outside, a frame and a sill
      put('window', geoBox(alongX ? 1.5 : 0.02, 1.6, alongX ? 0.02 : 1.5), wx + off[0], 1.75, wz + off[2], 0, 0);
      put('gloss', geoBox(alongX ? 1.62 : 0.06, 0.06, alongX ? 0.06 : 1.62), wx + off[0] * 1.5, 2.58, wz + off[2] * 1.5, 0, 0x2a2c30);
      put('gloss', geoBox(alongX ? 1.7 : 0.18, 0.05, alongX ? 0.18 : 1.7), wx + off[0] * 3, 0.95, wz + off[2] * 3, 0, 0xd8d8d4);
      put('gloss', geoBox(alongX ? 0.05 : 0.06, 1.6, alongX ? 0.06 : 0.05), wx + off[0] * 1.5, 1.75, wz + off[2] * 1.5, 0, 0x2a2c30);
    }
  };
  lining(X0 + 0.02, LZ, X0 + 0.02, Z1, plan.windows !== false);
  lining(X1 - 0.02, LZ, X1 - 0.02, Z1, plan.windows !== false);
  lining(X0, Z1 - 0.02, X1, Z1 - 0.02, false);
  if (LZ > Z0 + 0.1) {
    lining(X0 + 0.02, Z0, X0 + 0.02, LZ, false);
    lining(X1 - 0.02, Z0, X1 - 0.02, LZ, false);
  }
  // doorways: a frame, and a door standing open into the room
  for (const gp of plan.gaps) {
    const s = gp.side;
    put('gloss', geoBox(WALL + 0.06, 0.08, DOOR + 0.12), gp.x, 2.14, gp.z, 0, 0x4a4440);
    for (const k of [-1, 1]) put('gloss', geoBox(WALL + 0.06, 2.18, 0.06), gp.x, 1.09, gp.z + k * (DOOR / 2 + 0.03), 0, 0x4a4440);
    const leaf = geoBox(0.04, 2.1, DOOR - 0.04);
    leaf.translate(0, 0, (DOOR - 0.04) / 2);
    leaf.rotateY(s * -1.35);
    put('solid', leaf, gp.x + s * 0.06, 1.05, gp.z - DOOR / 2, 0, 0x8a6a4a);
    put('solid', geoBox(WALL + 0.04, CEIL - 2.18, DOOR), gp.x, 2.18 + (CEIL - 2.18) / 2, gp.z, 0, wallColorAt(gp.x + s * 0.4, gp.z));
  }
  // ---- furniture
  const people = [];
  const sit = [];
  for (const it of plan.items) {
    const B = (list, w, h, d, lx, ly, lz, hex) => put(list, geoBox(w, h, d), it.x, 0, it.z, it.ry || 0, hex, lx, ly, lz);
    const C = (list, rt, rb, h, lx, ly, lz, hex, seg) => put(list, geoCyl(rt, rb, h, seg), it.x, 0, it.z, it.ry || 0, hex, lx, ly, lz);
    switch (it.f) {
      case 'desk': {
        const w = 1.6, dd = 0.75, wood = pick(r, PALETTE.wood);
        B('solid', w, 0.04, dd, 0, 0.74, 0, wood);
        for (const sx of [-1, 1]) B('gloss', 0.05, 0.72, dd - 0.08, sx * (w / 2 - 0.05), 0.36, 0, 0x2a2c30);
        B('solid', w - 0.2, 0.4, 0.03, 0, 0.5, dd / 2 - 0.05, 0x2a2c30);
        for (let k = 0; k < (it.monitors || 1); k++) {
          const mx = (it.monitors > 1 ? (k - 0.5) * 0.62 : 0);
          B('gloss', 0.58, 0.36, 0.03, mx, 1.0, 0.18, 0x15161a);
          B('glow', 0.54, 0.31, 0.005, mx, 1.0, 0.163, pick(r, [0x4a6a8a, 0x3a5a7a, 0x5a7a9a, 0x6a5a8a]));
          B('gloss', 0.05, 0.16, 0.05, mx, 0.84, 0.21, 0x15161a);
          B('gloss', 0.22, 0.015, 0.16, mx, 0.765, 0.21, 0x15161a);
        }
        B('gloss', 0.44, 0.02, 0.15, 0, 0.77, -0.12, 0x202226);
        B('solid', 0.07, 0.02, 0.11, 0.32, 0.77, -0.12, 0x202226);
        if (r() < 0.6) C('solid', 0.04, 0.035, 0.1, -0.55, 0.81, -0.05, pick(r, [0xffffff, 0xc84a3a, 0x3a6ac8]), 8);
        if (it.divider) B('solid', w, 0.42, 0.04, 0, 0.95, dd / 2 + 0.02, 0x5a626e);
        if (it.chair) chair(B, C, 0, -0.62, 0x22252a, pick(r, PALETTE.fabric));
        break;
      }
      case 'chair': chair(B, C, 0, 0, 0x22252a, pick(r, PALETTE.fabric)); break;
      case 'reception': {
        B('solid', 3.4, 1.05, 0.12, 0, 0.53, -0.45, 0xe8e6e0);
        B('gloss', 3.5, 0.05, 0.4, 0, 1.08, -0.38, 0x2a2c30);
        B('solid', 3.2, 0.74, 0.7, 0, 0.37, 0.05, 0xd0ccc4);
        B('glow', 3.3, 0.04, 0.02, 0, 0.92, -0.52, plan.accent);
        B('gloss', 0.5, 0.32, 0.03, 0.6, 1.0, 0.15, 0x15161a);
        B('glow', 0.46, 0.28, 0.005, 0.6, 1.0, 0.13, 0x4a6a8a);
        break;
      }
      case 'mailboxes': {
        B('gloss', 3, 1.8, 0.35, 0, 0.9 + 0.3, 0, 0x8a8e94);
        for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) B('gloss', 0.44, 0.38, 0.02, -1.25 + i * 0.5, 0.5 + j * 0.42 + 0.3, -0.18, 0x6a6e74);
        break;
      }
      case 'sign': {
        const tex = signTexture(it.text, `#${new THREE.Color(plan.accent).offsetHSL(0, 0.2, 0.25).getHexString()}`);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(1.6, 1.6, 1.6) });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.56), mat);
        mesh.position.set(it.x, 2.55, it.z);
        mesh.rotation.y = it.ry;
        g.add(mesh);
        own.push(tex, mat, mesh.geometry);
        break;
      }
      case 'sofa': {
        const c = it.color;
        B('solid', 2.1, 0.42, 0.85, 0, 0.21, 0, c);
        B('solid', 2.1, 0.5, 0.22, 0, 0.62, 0.32, c);
        for (const sx of [-1, 1]) B('solid', 0.2, 0.62, 0.85, sx * 0.95, 0.31, 0, c);
        for (const sx of [-0.48, 0.48]) B('solid', 0.86, 0.12, 0.62, sx, 0.48, -0.06, new THREE.Color(c).offsetHSL(0, 0, 0.04).getHex());
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) B('gloss', 0.06, 0.06, 0.06, sx * 0.95, 0.03, sz * 0.35, 0x1a1a1a);
        break;
      }
      case 'armchair': {
        const c = it.color;
        B('solid', 0.8, 0.4, 0.8, 0, 0.2, 0, c);
        B('solid', 0.8, 0.5, 0.18, 0, 0.6, 0.31, c);
        for (const sx of [-1, 1]) B('solid', 0.14, 0.58, 0.8, sx * 0.33, 0.29, 0, c);
        break;
      }
      case 'coffeeTable': B('gloss', 1.1, 0.04, 0.55, 0, 0.42, 0, 0x2a2c30); B('glass', 1.0, 0.012, 0.5, 0, 0.445, 0, 0); for (const sx of [-1, 1]) B('gloss', 0.04, 0.4, 0.5, sx * 0.5, 0.2, 0, 0x2a2c30); break;
      case 'rug': B('solid', it.w, 0.012, it.d, 0, 0.03, 0, it.color); B('solid', it.w - 0.2, 0.013, it.d - 0.2, 0, 0.031, 0, new THREE.Color(it.color).offsetHSL(0, -0.1, 0.12).getHex()); break;
      case 'plant': {
        const s = it.big ? 1.5 : 1;
        C('solid', 0.2 * s, 0.15 * s, 0.4 * s, 0, 0.2 * s, 0, 0x3a3634, 10);
        C('solid', 0.19 * s, 0.19 * s, 0.02, 0, 0.4 * s, 0, 0x3a2a1a, 10);
        const leaf = pick(r, [0x3a6a32, 0x2f5a2a, 0x4a7a3a]);
        for (let k = 0; k < 7; k++) {
          const a = k * 2.4, h = 0.55 + (k % 3) * 0.18;
          const geo = geoSphere(0.16 * s, 6, 4);
          geo.scale(1, 1.7, 0.45);
          geo.rotateZ(0.5 * Math.cos(a)); geo.rotateX(0.5 * Math.sin(a));
          put('solid', geo, it.x, 0, it.z, 0, new THREE.Color(leaf).offsetHSL(0, 0, (k % 3) * 0.03).getHex(), Math.cos(a) * 0.12 * s, h * s, Math.sin(a) * 0.12 * s);
        }
        break;
      }
      case 'lift': {
        B('gloss', 1.5, 2.4, 0.06, 0, 1.2, 0, 0x9aa0a8);
        B('gloss', 0.02, 2.3, 0.07, 0, 1.15, 0, 0x5a5e64);
        B('gloss', 1.7, 0.12, 0.1, 0, 2.46, 0, 0x2a2c30);
        B('glow', 0.32, 0.08, 0.02, 0, 2.62, -0.04, 0xff8a3a);
        B('glow', 0.06, 0.12, 0.02, 1.0, 1.15, -0.04, 0x3ef2ff);
        break;
      }
      case 'vending': {
        B('gloss', 1.0, 1.9, 0.8, 0, 0.95, 0, pick(r, [0xb83a3a, 0x2a5a9a, 0x2a2c30]));
        B('glow', 0.62, 1.2, 0.02, -0.12, 1.15, -0.41, 0xd8e8f0);
        for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) B('solid', 0.1, 0.16, 0.03, -0.35 + j * 0.15, 0.7 + i * 0.22, -0.43, pick(r, [0xe84a3a, 0x3ae86a, 0xe8c83a, 0x3a8ae8, 0xe8e8e8]));
        B('glow', 0.14, 0.3, 0.02, 0.36, 1.25, -0.41, 0x3ef2ff);
        break;
      }
      case 'cooler': B('gloss', 0.38, 1.0, 0.38, 0, 0.5, 0, 0xe0e0dc); C('glass', 0.16, 0.16, 0.45, 0, 1.25, 0, 0, 12); break;
      case 'printer': B('gloss', 0.6, 0.5, 0.7, 0, 0.75, 0, 0xd8d8d4); B('solid', 0.62, 0.5, 0.72, 0, 0.25, 0, 0x2a2c30); B('glow', 0.12, 0.05, 0.01, 0.15, 0.95, -0.36, 0x5dffa8); break;
      case 'shelf': {
        const w = 2.0;
        B('solid', w, 2.1, 0.06, 0, 1.05, 0.17, 0x6e5440);
        for (const sx of [-1, 1]) B('solid', 0.04, 2.1, 0.38, sx * w / 2, 1.05, 0, 0x6e5440);
        for (let k = 0; k < 5; k++) {
          B('solid', w, 0.03, 0.38, 0, 0.1 + k * 0.48, 0, 0x6e5440);
          if (k < 4 && it.books) for (let b = -w / 2 + 0.08; b < w / 2 - 0.1;) {
            const bw = 0.03 + r() * 0.05, bh = 0.25 + r() * 0.15;
            if (r() < 0.85) B('solid', bw, bh, 0.24, b + bw / 2, 0.115 + k * 0.48 + bh / 2, 0, pick(r, [0x7a2a2a, 0x2a4a7a, 0x2a5a3a, 0xc8b88a, 0x4a3a2a, 0x8a6a2a, 0x2a2a2a]));
            b += bw + 0.005;
          }
        }
        break;
      }
      case 'cabinet': B('gloss', 0.5, 1.3, 0.6, 0, 0.65, 0, 0x7a8088); for (let k = 0; k < 4; k++) B('gloss', 0.18, 0.02, 0.02, 0, 0.2 + k * 0.31, -0.31, 0x2a2c30); break;
      case 'whiteboard': B('gloss', 1.8, 1.1, 0.03, 0, 1.55, 0, 0xf4f4f0); B('gloss', 1.86, 1.16, 0.02, 0, 1.55, 0.01, 0x9a9ea4);
        for (let k = 0; k < 4; k++) B('solid', 0.3 + r() * 0.8, 0.012, 0.005, -0.4 + r() * 0.4, 1.3 + k * 0.18, -0.02, pick(r, [0x2a4aa8, 0xa82a2a, 0x2a2a2a])); break;
      case 'screen': B('gloss', it.w, it.w * 0.58, 0.05, 0, 1.6, 0, 0x101114); B('glow', it.w - 0.08, it.w * 0.58 - 0.08, 0.005, 0, 1.6, -0.03, 0x3a6a9a); break;
      case 'glassWall': put('glass', geoBox(0.03, CEIL - 0.1, Math.max(0.1, it.len - 2.6)), it.x, CEIL / 2, it.z, 0, 0); break;
      case 'meetingTable': {
        const len = it.len;
        B('solid', 1.2, 0.05, len, 0, 0.75, 0, pick(r, PALETTE.wood));
        for (const sz of [-1, 1]) B('gloss', 0.5, 0.72, 0.1, 0, 0.36, sz * (len / 2 - 0.5), 0x2a2c30);
        break;
      }
      case 'table': {
        C('solid', 0.6, 0.6, 0.04, 0, 0.75, 0, pick(r, PALETTE.wood), 20);
        C('gloss', 0.05, 0.05, 0.72, 0, 0.36, 0, 0x2a2c30, 8);
        C('gloss', 0.3, 0.3, 0.03, 0, 0.015, 0, 0x2a2c30, 12);
        break;
      }
      case 'kitchen': {
        const len = it.len;
        B('solid', len, 0.86, 0.6, 0, 0.43, 0, pick(r, [0xe8e6e0, 0x3a3e44, 0x6a5a4a]));
        B('gloss', len + 0.04, 0.04, 0.64, 0, 0.88, -0.02, 0x2a2c30);
        for (let k = 0; k < Math.floor(len / 0.6); k++) B('gloss', 0.12, 0.02, 0.02, -len / 2 + 0.3 + k * 0.6, 0.72, -0.31, 0x9aa0a8);
        B('gloss', 0.5, 0.05, 0.4, len / 2 - 0.5, 0.88, -0.04, 0x9aa0a8);
        C('gloss', 0.02, 0.02, 0.3, len / 2 - 0.5, 1.05, 0.12, 0x9aa0a8, 6);
        B('solid', len, 0.7, 0.35, 0, 2.0, 0.12, pick(r, [0xe8e6e0, 0x3a3e44, 0x6a5a4a]));
        B('gloss', 0.45, 0.28, 0.35, -len / 2 + 0.4, 1.05, 0.05, 0x2a2c30);
        break;
      }
      case 'fridge': B('gloss', 0.72, 1.85, 0.68, 0, 0.93, 0, 0xd8dadc); B('gloss', 0.02, 0.5, 0.03, -0.28, 1.2, -0.35, 0x9aa0a8); B('gloss', 0.72, 0.01, 0.69, 0, 1.25, 0, 0x8a8e94); break;
      case 'rack': B('gloss', 1.2, 2.2, 0.55, 0, 1.1, 0, 0x5a6068);
        for (let k = 0; k < 4; k++) for (let b = 0; b < 3; b++) if (r() < 0.75) B('solid', 0.3 + r() * 0.1, 0.25 + r() * 0.15, 0.4, -0.38 + b * 0.38, 0.25 + k * 0.52, 0, pick(r, [0xa88a5a, 0x8a6e48, 0x5a6a7a])); break;
      case 'crate': { const s = it.size; B('solid', s, s, s, 0, s / 2, 0, pick(r, [0xa88a5a, 0x8a6e48])); break; }
      case 'bed': {
        const c = it.color;
        B('solid', 1.6, 0.35, 2.05, 0, 0.18, 0, 0x4a3a2e);
        B('solid', 1.55, 0.2, 1.95, 0, 0.45, 0.02, 0xe8e6e0);
        B('solid', 1.58, 0.06, 1.3, 0, 0.57, -0.3, c);
        for (const sx of [-0.38, 0.38]) B('solid', 0.6, 0.14, 0.38, sx, 0.62, 0.72, 0xf0eee8);
        B('solid', 1.7, 1.0, 0.08, 0, 0.6, 1.05, 0x4a3a2e);
        break;
      }
      case 'nightstand': B('solid', 0.45, 0.55, 0.42, 0, 0.28, 0, 0x5a4434); C('solid', 0.07, 0.1, 0.3, 0, 0.7, 0, 0x2a2c30, 8); C('glow', 0.14, 0.1, 0.18, 0, 0.92, 0, 0xffd8a0, 10); break;
      case 'wardrobe': B('solid', 1.2, 2.2, 0.6, 0, 1.1, 0, pick(r, PALETTE.wood)); B('solid', 0.01, 2.1, 0.61, 0, 1.1, 0, 0x2a2420); break;
      case 'tv': B('solid', 1.4, 0.5, 0.42, 0, 0.25, 0, 0x2a2c30); B('gloss', 1.25, 0.72, 0.04, 0, 1.0, 0.05, 0x101114); B('glow', 1.19, 0.66, 0.005, 0, 1.0, 0.028, pick(r, [0x3a6a9a, 0x6a3a7a, 0x2a7a6a])); break;
      case 'bar': {
        const len = it.len;
        B('solid', len, 1.05, 0.6, 0, 0.53, 0, 0x2a1e1a);
        B('gloss', len + 0.1, 0.05, 0.75, 0, 1.08, -0.05, 0x101014);
        B('glow', len, 0.03, 0.02, 0, 0.95, -0.32, 0xff2fa0);
        for (let k = 0; k < 6; k++) C('glass', 0.035, 0.035, 0.14, -len / 2 + 0.6 + k * (len / 6), 1.17, 0, 0, 8);
        break;
      }
      case 'barShelf': {
        const len = it.len;
        B('solid', len, 2.2, 0.35, 0, 1.1, 0, 0x1a1418);
        for (let k = 0; k < 3; k++) {
          B('glow', len - 0.2, 0.02, 0.3, 0, 1.0 + k * 0.45, 0, 0x6a4a8a);
          for (let b = -len / 2 + 0.2; b < len / 2 - 0.15; b += 0.13 + r() * 0.06) C('glow', 0.035, 0.04, 0.24 + r() * 0.1, b, 1.15 + k * 0.45, 0.02, pick(r, [0x3a7a3a, 0x7a4a1a, 0x5a2a6a, 0x2a5a7a, 0x8a7a3a]), 8);
        }
        break;
      }
      case 'stool': C('gloss', 0.03, 0.03, 0.7, 0, 0.35, 0, 0x9aa0a8, 6); C('solid', 0.2, 0.2, 0.06, 0, 0.72, 0, 0x5a1a2a, 12); C('gloss', 0.2, 0.2, 0.02, 0, 0.01, 0, 0x9aa0a8, 12); break;
      case 'stage': B('gloss', it.w, 0.3, it.d, 0, 0.15, 0, 0x15151a); B('glow', it.w, 0.03, 0.03, 0, 0.3, -it.d / 2, 0x3ef2ff); break;
      case 'djBooth': B('solid', 2.2, 1.0, 0.8, 0, 0.8, 0, 0x101014); B('glow', 2.0, 0.04, 0.02, 0, 1.0, -0.41, 0xa86cff);
        for (const sx of [-0.55, 0.55]) C('gloss', 0.18, 0.18, 0.03, sx, 1.32, 0.05, 0x2a2c30, 16); B('glow', 0.5, 0.12, 0.3, 0, 1.33, 0.05, 0x3ef2ff); break;
      case 'disco': {
        const geo = new THREE.PlaneGeometry(it.w, it.d).rotateX(-Math.PI / 2).toNonIndexed();
        geo.deleteAttribute('uv');
        geo.translate(it.x, 0.035, it.z);
        L.disco.push(geo);
        break;
      }
      case 'beam': {
        const geo = new THREE.CylinderGeometry(0.08, 1.4, CEIL - 0.1, 16, 1, true).toNonIndexed();
        geo.deleteAttribute('uv');
        geo.rotateZ(it.tilt || 0);
        geo.translate(it.x, (CEIL - 0.1) / 2, it.z);
        paint(geo, it.color);
        L.beam.push(geo);
        put('glow', geoBox(0.3, 0.12, 0.3), it.x, CEIL - 0.08, it.z, 0, it.color);
        break;
      }
      case 'neonStrip': {
        const len = Math.hypot(it.x1 - it.x0, it.z1 - it.z0), alongX = Math.abs(it.x1 - it.x0) > Math.abs(it.z1 - it.z0);
        const inset = 0.1;
        const cx = (it.x0 + it.x1) / 2 + (alongX ? 0 : -Math.sign((it.x0 + it.x1) / 2) * inset), cz = (it.z0 + it.z1) / 2 + (alongX ? -Math.sign((it.z0 + it.z1) / 2) * inset : 0);
        put('glow', geoBox(alongX ? len : 0.04, 0.05, alongX ? 0.04 : len), cx, it.y, cz, 0, it.color);
        break;
      }
      case 'checkout': B('solid', 2.4, 1.0, 0.9, 0, 0.5, 0, 0xd8d4cc); B('gloss', 2.45, 0.04, 0.95, 0, 1.02, 0, 0x3a3e44);
        B('gloss', 0.4, 0.3, 0.05, 0.5, 1.3, 0.2, 0x15161a); B('glow', 0.36, 0.25, 0.01, 0.5, 1.3, 0.17, 0x5dffa8);
        for (let k = 0; k < 8; k++) B('solid', 0.07, 0.12, 0.05, -0.9 + k * 0.12, 1.1, -0.35, pick(r, [0xe84a3a, 0x3ae86a, 0xe8c83a, 0x3a8ae8])); break;
      case 'aisle': {
        const len = it.len;
        B('gloss', 0.12, 1.7, len, 0, 0.85, 0, 0xe8e8e4);
        for (const side of [-1, 1]) for (let k = 0; k < 4; k++) {
          B('gloss', 0.38, 0.02, len, side * 0.25, 0.2 + k * 0.45, 0, 0xd8d8d4);
          for (let z = -len / 2 + 0.12; z < len / 2 - 0.1;) {
            const pw = 0.1 + r() * 0.16, ph = 0.14 + r() * 0.2;
            if (r() < 0.88) B('solid', 0.22, ph, pw, side * 0.27, 0.21 + k * 0.45 + ph / 2, z + pw / 2, pick(r, [0xe84a3a, 0x3ae86a, 0xe8c83a, 0x3a8ae8, 0xf0f0f0, 0xe87a2a, 0x8a3ae8, 0x2a2a2a]));
            z += pw + 0.02;
          }
        }
        break;
      }
      case 'fridgeWall': {
        const len = it.len;
        B('gloss', len, 2.1, 0.8, 0, 1.05, 0, 0xc8ccd0);
        for (let k = 0; k < Math.floor(len / 0.9); k++) {
          const x = -len / 2 + 0.45 + k * 0.9;
          B('glow', 0.82, 1.7, 0.02, x, 1.05, -0.41, 0xd8ecf4);
          for (let j = 0; j < 4; j++) for (let b = 0; b < 5; b++) C('solid', 0.035, 0.035, 0.2, x - 0.3 + b * 0.15, 0.4 + j * 0.42, -0.3, pick(r, [0xe84a3a, 0x3ae86a, 0x3a8ae8, 0xe8c83a, 0xf0f0f0]), 8);
          put('glass', geoBox(0.84, 1.75, 0.02), it.x, 1.05, it.z, it.ry, 0, x, 0, -0.43);
        }
        break;
      }
      case 'weightRack': B('gloss', 1.8, 0.05, 0.5, 0, 0.5, 0, 0x2a2c30); B('gloss', 1.8, 0.05, 0.5, 0, 0.95, 0, 0x2a2c30);
        for (let k = 0; k < 6; k++) for (const y of [0.6, 1.05]) { const g2 = geoCyl(0.07, 0.07, 0.36, 10); g2.rotateZ(Math.PI / 2); put('gloss', g2, it.x, 0, it.z, it.ry || 0, 0x15161a, -0.75 + k * 0.3, y, 0); } break;
      case 'bench': B('solid', 0.32, 0.1, 1.2, 0, 0.45, 0, 0x1a1a1e); B('gloss', 0.06, 0.4, 0.06, 0, 0.22, 0.45, 0x9aa0a8); B('gloss', 0.06, 0.4, 0.06, 0, 0.22, -0.45, 0x9aa0a8);
        B('gloss', 1.6, 0.04, 0.04, 0, 1.2, -0.45, 0x9aa0a8); for (const sx of [-0.7, 0.7]) { const g2 = geoCyl(0.2, 0.2, 0.06, 16); g2.rotateZ(Math.PI / 2); put('gloss', g2, it.x, 0, it.z, it.ry || 0, 0x15161a, sx, 1.2, -0.45); } break;
      case 'treadmill': B('solid', 0.8, 0.18, 1.9, 0, 0.09, 0, 0x1a1a1e); B('gloss', 0.7, 0.02, 1.6, 0, 0.19, 0.1, 0x2a2a2e);
        for (const sx of [-0.38, 0.38]) B('gloss', 0.05, 1.1, 0.05, sx, 0.65, -0.82, 0x9aa0a8);
        B('gloss', 0.8, 0.3, 0.1, 0, 1.25, -0.85, 0x15161a); B('glow', 0.5, 0.18, 0.01, 0, 1.27, -0.79, 0x3ef2ff); break;
      case 'bag': C('gloss', 0.01, 0.01, 0.6, 0, CEIL - 0.3, 0, 0x5a5e64, 4); C('solid', 0.22, 0.22, 1.1, 0, CEIL - 1.15, 0, pick(r, [0x7a1a1a, 0x1a1a1a, 0x1a2a5a]), 14); break;
      case 'mirror': B('gloss', it.w, 2.0, 0.03, 0, 1.4, 0, 0xc8d8e0); break;
      case 'cabinet': {
        B('solid', 0.75, 1.8, 0.75, 0, 0.9, 0, 0x101014);
        B('gloss', 0.66, 0.5, 0.02, 0, 1.35, -0.38, 0x050506);
        B('glow', 0.6, 0.44, 0.01, 0, 1.35, -0.395, pick(r, [0x3a6aea, 0xea3a6a, 0x3aea8a, 0xeaa03a, 0x9a3aea]));
        B('glow', 0.75, 0.16, 0.02, 0, 1.78, -0.36, it.color);
        B('solid', 0.75, 0.08, 0.3, 0, 1.0, -0.5, 0x1a1a1e);
        for (const sx of [-0.15, 0.15]) C('glow', 0.025, 0.025, 0.02, sx, 1.05, -0.55, pick(r, [0xff3c4a, 0x3ef2ff, 0xffe44d]), 8);
        break;
      }
      case 'claw': B('solid', 1.0, 0.9, 1.0, 0, 0.45, 0, 0xd83a7a); put('glass', geoBox(0.96, 1.0, 0.96), it.x, 1.4, it.z, it.ry, 0); B('glow', 1.0, 0.12, 1.0, 0, 1.96, 0, 0x8a7a3a);
        for (let k = 0; k < 10; k++) put('solid', geoSphere(0.09, 6, 4), it.x, 0, it.z, it.ry, pick(r, [0xff7aa8, 0x7ad8ff, 0xffe47a, 0xa87aff]), (r() - 0.5) * 0.7, 0.98, (r() - 0.5) * 0.7); break;
      case 'ceilingLight': put('glow', geoBox(it.w, 0.03, it.d), it.x, CEIL - 0.03, it.z, 0, 0x8a8680); break; // just past the bloom threshold: lit, not glaring
      case 'npc': {
        const p = buildNPC(pick(r, [0x2a3040, 0x40283a, 0x283a40, 0x3a3a3a, 0x5a4a3a, 0x3a5a6a, 0x6a2a4a, 0x2a5a5a]), pick(r, [0x3ef2ff, 0xff3c7d, 0xffe44d]), { pose: it.pose || (it.sit ? 'sit' : r() < 0.4 ? 'fold' : 'stand') });
        p.group.position.set(it.x, 0, it.z);
        p.group.rotation.y = it.ry || 0;
        if (it.sit || it.pose === 'sit') sit.push(p);
        g.add(p.group);
        people.push(p);
        break;
      }
      default: break;
    }
  }
  // soft shadows pooled under the furniture that stands on the floor
  const shade = [];
  for (const c of plan.colliders) {
    if (c.h > CEIL - 0.1) continue; // walls
    const geo = new THREE.PlaneGeometry(c.w + 0.5, c.d + 0.5).rotateX(-Math.PI / 2);
    geo.translate(c.x, 0.03, c.z);
    shade.push(geo);
  }
  if (shade.length) {
    const geo = mergeGeometries(shade);
    for (const gg of shade) gg.dispose();
    const mesh = new THREE.Mesh(geo, M.shade);
    mesh.renderOrder = 1;
    g.add(mesh);
    own.push(geo);
  }
  // light falls off toward the floor and into the corners: darken low surfaces a little
  for (const k of ['solid', 'gloss']) for (const geo of L[k]) {
    const pos = geo.attributes.position, col = geo.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const f = 0.7 + 0.3 * THREE.MathUtils.smoothstep(y, 0, 1.4) - 0.08 * THREE.MathUtils.smoothstep(y, CEIL - 0.6, CEIL);
      col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
    }
  }
  // merge everything by material
  for (const [k, list] of Object.entries(L)) {
    if (!list.length) continue;
    const geo = mergeGeometries(list);
    for (const gg of list) gg.dispose();
    const mesh = new THREE.Mesh(geo, M[k]);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    if (k === 'glass') mesh.renderOrder = 2;
    if (k === 'beam') mesh.renderOrder = 3;
    g.add(mesh);
    own.push(geo);
  }
  let t = 0;
  return {
    group: g,
    update(dt) { t += dt; for (const p of people) p.anim(t); },
    dispose() {
      for (const p of people) p.dispose();
      for (const o of own) o.dispose && o.dispose();
    },
  };
}

// an office chair: five-star base, gas column, seat and back (item space, then turned)
function chair(B, C, x, z, frame, fabric, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const [px, pz] = at(Math.cos(a) * 0.2, Math.sin(a) * 0.2);
    B('gloss', 0.05, 0.04, 0.05, px, 0.05, pz, frame);
  }
  C('gloss', 0.03, 0.03, 0.38, x, 0.26, z, frame, 6);
  const [sx, sz] = at(0, 0);
  B('solid', 0.48, 0.08, 0.46, sx, 0.48, sz, fabric);
  const [bx, bz] = at(0, -0.24);
  B('solid', 0.46, 0.5, 0.06, bx, 0.78, bz, fabric);
}
