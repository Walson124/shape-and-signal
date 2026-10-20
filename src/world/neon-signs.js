import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The city's neon: vertical blade signs of glowing glyphs hung off tower corners,
// holographic billboards on the rooftops and light strips along rooflines. All of it
// merges into a handful of draw calls per city and glows past the bloom threshold, so
// at night the streets read as a neon city rather than a field of lit windows.

const PALETTE = [0x3ef2ff, 0xff2fa0, 0xa86cff, 0xffb347, 0x5dffa8, 0xff3c4a];
const GLYPHS = ['星海', '拉面', '武馆', '灵药', '夜市', '飞升', '酒吧', '电玩', '修炼', '龙门', '天机', '丹房', '茶馆', '剑阁', '星际', '当铺'];
const ADS = [
  ['QI COLA', '气', 0xff2fa0], ['NEON NOODLE', '面', 0xffb347], ['STARSEA', '星', 0x3ef2ff], ['VOID BANK', '虚', 0xa86cff],
  ['JADE TEA', '茶', 0x5dffa8], ['SKYJET', '飞', 0x3ef2ff], ['PILL+', '丹', 0xff3c4a], ['ARENA TONIGHT', '战', 0xff2fa0],
  ['NIX RINGS', '戒', 0xa86cff], ['DEEP DIVE', '海', 0x3ef2ff], ['BLADE & CO', '剑', 0xffb347], ['ASCEND', '升', 0x5dffa8],
];
const COLS = GLYPHS.length;

let tex = null;
function textures() {
  if (tex) return tex;
  if (typeof document === 'undefined') return (tex = { glyphs: null, ads: null });
  // blade signs: one column per word, characters stacked top to bottom, inside a frame
  const gc = document.createElement('canvas');
  gc.width = COLS * 64; gc.height = 512;
  const g = gc.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, gc.width, gc.height);
  GLYPHS.forEach((word, i) => {
    const x = i * 64;
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.strokeRect(x + 5, 5, 54, 502);
    g.fillStyle = '#fff';
    g.font = 'bold 50px "Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const n = word.length, step = 470 / n;
    for (let k = 0; k < n; k++) g.fillText(word[k], x + 32, 26 + step * (k + 0.5));
  });
  const glyphs = new THREE.CanvasTexture(gc);
  glyphs.colorSpace = THREE.SRGBColorSpace;
  glyphs.anisotropy = 4;
  // billboards: a 4 x 3 sheet of adverts with a big glyph, a name and scanlines
  const ac = document.createElement('canvas');
  ac.width = 1024; ac.height = 480;
  const a = ac.getContext('2d');
  ADS.forEach(([name, glyph, hex], i) => {
    const x = (i % 4) * 256, y = Math.floor(i / 4) * 160;
    const c = new THREE.Color(hex);
    const css = (k, al = 1) => `rgba(${Math.round(c.r * 255 * k)},${Math.round(c.g * 255 * k)},${Math.round(c.b * 255 * k)},${al})`;
    const bg = a.createLinearGradient(x, y, x + 256, y + 160);
    bg.addColorStop(0, css(0.18)); bg.addColorStop(1, css(0.05));
    a.fillStyle = bg; a.fillRect(x, y, 256, 160);
    a.fillStyle = css(1);
    a.font = 'bold 96px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    a.textAlign = 'center'; a.textBaseline = 'middle';
    a.fillText(glyph, x + 64, y + 82);
    a.fillStyle = '#ffffff';
    a.font = 'bold 26px sans-serif';
    a.textAlign = 'left';
    const words = name.split(' ');
    words.forEach((w, k) => a.fillText(w, x + 124, y + 70 + (k - (words.length - 1) / 2) * 30));
    a.strokeStyle = css(1); a.lineWidth = 4; a.strokeRect(x + 4, y + 4, 248, 152);
    a.fillStyle = 'rgba(0,0,0,0.22)';
    for (let s = 0; s < 160; s += 4) a.fillRect(x, y + s, 256, 2);
  });
  const ads = new THREE.CanvasTexture(ac);
  ads.colorSpace = THREE.SRGBColorSpace;
  ads.anisotropy = 4;
  return (tex = { glyphs, ads });
}

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// map every face of a box onto one cell of an atlas
function atlasUv(geo, u0, v0, du, dv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * du, v0 + uv.getY(i) * dv);
  return geo;
}

/**
 * buildings: [{ x, z, w, d, h }] in city space; drop(x, z) is the planet's curve below
 * the city plane. Returns an array of meshes to add to the city group.
 */
export function buildSignage(buildings, seed, drop, { density = 1 } = {}) {
  const r = rng(seed ^ 0x51a7e5);
  const blades = [], strips = [], boards = [], posts = [];
  const put = (list, geo, x, y, z, ry = 0) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y + drop(x, z), z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
    list.push(geo.applyMatrix4(m));
  };
  for (const b of buildings) {
    if (!b.h || b.h < 16) continue;
    const hex = PALETTE[Math.floor(r() * PALETTE.length)];
    // blade signs off the faces, near the corners, sticking out into the street
    const nBlades = (r() < 0.8 * density ? 1 : 0) + (r() < 0.45 * density ? 1 : 0);
    for (let bi = 0; bi < nBlades; bi++) {
      const face = Math.floor(r() * 4);
      const L = Math.min(8 + r() * 14, b.h * 0.7);
      const y = Math.min(b.h - 1.5 - L / 2, 4 + L / 2 + r() * b.h * 0.35);
      const nx = face === 0 ? 1 : face === 1 ? -1 : 0, nz = face === 2 ? 1 : face === 3 ? -1 : 0;
      const along = (r() < 0.5 ? -1 : 1) * ((nx ? b.d : b.w) / 2 - 1.8);
      const out = 1.8 + (nx ? b.w : b.d) / 2;
      const x = b.x + nx * out + (nx ? 0 : along), z = b.z + nz * out + (nz ? 0 : along);
      const col = Math.floor(r() * COLS);
      const geo = atlasUv(new THREE.BoxGeometry(3.2, L, 0.4), col / COLS, 0, 1 / COLS, 1);
      // the sign's broad faces look along the street: its width runs out from the wall
      put(blades, colored(geo, hex), x, y, z, nx ? 0 : Math.PI / 2);
    }
    // a glowing shopfront sign over the ground floor, at street level where you walk
    if (r() < 0.6 * density) {
      const face = Math.floor(r() * 4);
      const nx = face === 0 ? 1 : face === 1 ? -1 : 0, nz = face === 2 ? 1 : face === 3 ? -1 : 0;
      const W = Math.min(9, (nx ? b.d : b.w) * 0.6), H = W * 0.32;
      const ad = Math.floor(r() * ADS.length);
      const geo = new THREE.PlaneGeometry(W, H);
      atlasUv(geo, (ad % 4) / 4, 1 - (Math.floor(ad / 4) + 1) * (160 / 480), 1 / 4, 160 / 480);
      const out = 0.15 + (nx ? b.w : b.d) / 2;
      put(boards, geo, b.x + nx * out, 4.6 + r() * 1.2, b.z + nz * out, Math.atan2(nx, nz));
    }
    // a light strip around the roof, sometimes a second band lower down
    if (r() < 0.7 * density) {
      const sh = PALETTE[Math.floor(r() * PALETTE.length)];
      const bands = r() < 0.3 ? [b.h + 0.15, b.h * (0.45 + r() * 0.3)] : [b.h + 0.15];
      for (const y of bands) {
        put(strips, colored(new THREE.BoxGeometry(b.w + 0.3, 0.22, 0.22), sh), b.x, y, b.z + b.d / 2 + 0.1);
        put(strips, colored(new THREE.BoxGeometry(b.w + 0.3, 0.22, 0.22), sh), b.x, y, b.z - b.d / 2 - 0.1);
        put(strips, colored(new THREE.BoxGeometry(0.22, 0.22, b.d + 0.3), sh), b.x + b.w / 2 + 0.1, y, b.z);
        put(strips, colored(new THREE.BoxGeometry(0.22, 0.22, b.d + 0.3), sh), b.x - b.w / 2 - 0.1, y, b.z);
      }
    }
    // a holographic billboard on the roof of the taller towers, facing the city centre
    if (b.h > 26 && r() < 0.4 * density) {
      const W = Math.min(20, Math.min(b.w, b.d) * 1.0), H = W * 0.62;
      const ad = Math.floor(r() * ADS.length);
      const geo = new THREE.PlaneGeometry(W, H);
      atlasUv(geo, (ad % 4) / 4, 1 - (Math.floor(ad / 4) + 1) * (160 / 480), 1 / 4, 160 / 480);
      const face = Math.atan2(-b.x, -b.z);
      put(boards, geo, b.x, b.h + 2.2 + H / 2, b.z, face);
      for (const s of [-1, 1]) {
        const px = b.x + Math.cos(face) * s * W * 0.35, pz = b.z - Math.sin(face) * s * W * 0.35;
        put(posts, new THREE.BoxGeometry(0.35, 2.4 + H * 0.5, 0.35), px, b.h + (2.4 + H * 0.5) / 2, pz);
      }
    }
  }
  const t = textures();
  const out = [];
  if (blades.length) out.push(new THREE.Mesh(mergeGeometries(blades), new THREE.MeshBasicMaterial({ map: t.glyphs, vertexColors: true, color: new THREE.Color(2.6, 2.6, 2.6) })));
  if (strips.length) out.push(new THREE.Mesh(mergeGeometries(strips.map((g) => { g.deleteAttribute('uv'); g.deleteAttribute('normal'); return g; })), new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.4, 2.4, 2.4) })));
  if (boards.length) out.push(new THREE.Mesh(mergeGeometries(boards), new THREE.MeshBasicMaterial({ map: t.ads, color: new THREE.Color(2.4, 2.4, 2.4), side: THREE.DoubleSide })));
  if (posts.length) out.push(new THREE.Mesh(mergeGeometries(posts.map((g) => (g.index ? g.toNonIndexed() : g))), new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.6, metalness: 0.6 })));
  for (const m of out) m.userData.signage = true;
  return out;
}
