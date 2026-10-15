import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

let cache;
// Compact, tileable material maps. Physical joints and restrained grain hold
// up at walking distance; generated once and shared across district reloads.
export function blockTextures() {
  if (cache) return cache;
  const maps = {};
  for (const kind of ['brick', 'plaster', 'stone', 'wood']) {
    const n = 256, color = new Uint8Array(n * n * 4), height = new Uint8Array(n * n * 4), r = mulberry32(700 + kind.length);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const row = Math.floor(y / 20), bx = (x + (row % 2) * 32) % 64;
      const joint = kind === 'brick' ? bx < 2 || y % 20 < 2 : kind === 'stone' ? x % 64 < 2 || y % 64 < 2 : false;
      const grain = (r() - 0.5) * (kind === 'plaster' ? 11 : 19);
      let base = kind === 'brick' ? 162 : kind === 'plaster' ? 205 : kind === 'stone' ? 174 : 155;
      if (kind === 'wood') base += Math.sin(y * 0.47 + Math.sin(x * 0.03) * 3) * 13;
      if (kind === 'brick') base += Math.sin(Math.floor((x + (row % 2) * 32) / 64) * 41 + row * 27) * 9;
      const v = Math.max(0, Math.min(255, base + grain - (joint ? 42 : 0))), i = (y * n + x) * 4;
      const tint = kind === 'brick' ? [1, 0.88, 0.78] : kind === 'wood' ? [1, 0.77, 0.52] : [1, 0.99, 0.95];
      for (let k = 0; k < 3; k++) color[i + k] = v * tint[k];
      color[i + 3] = 255;
      height[i] = height[i + 1] = height[i + 2] = joint ? 75 : 170 + grain;
      height[i + 3] = 255;
    }
    const map = new THREE.DataTexture(color, n, n, THREE.RGBAFormat);
    const bump = new THREE.DataTexture(height, n, n, THREE.RGBAFormat);
    map.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [map, bump]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true; texture.anisotropy = 4; texture.needsUpdate = true;
    }
    maps[kind] = { map, bump };
  }
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 2048;
  const c = canvas.getContext('2d');
  const labels = [
    ['SOUTH CONCOURSE', 'BASE CITY 07  /  SOUTH COURT'], ['MERIDIAN', 'NOODLES  /  TEA  /  06:00—23:00'],
    ['KITE', 'ARMORY & PRECISION REPAIRS'], ['SOUTH COURT ROOMS', 'RECEPTION  /  RESIDENTS'],
    ['BOTANICA', 'APOTHECARY & CULTIVATION SUPPLIES'], ['ROOF GARDEN', 'STAIRS  /  PUBLIC ACCESS'],
    ['SET MENU  /  18', 'BROTH  ·  HAND-PULLED NOODLES  ·  TEA'], ['07 — SOUTH COURT', 'RESIDENCES  /  DELIVERIES TO RECEPTION'],
    ['NEIGHBOURHOOD BOARD', 'SOUTH COURT  /  LOCAL NOTICES'], ['LIVE AT MERIDIAN', 'FRIDAY  /  ACOUSTIC SET  /  20:00'],
    ['REPAIR & REUSE', 'KITE  /  TOOL SERVICING  /  WALK INS WELCOME'], ['GROW TOGETHER', 'BOTANICA  /  SEED EXCHANGE  /  SUNDAYS'],
    ['SERVICE ACCESS', 'KEEP CLEAR  /  COLLECTION 06:00'], ['RESIDENTS / 07', 'PLEASE KEEP THE PASSAGE CLEAR'],
    ['FRESH BROTH DAILY', 'MERIDIAN  /  SIT IN OR TAKE AWAY'], ['SOUTH COURT TRANSIT', 'PLAZA  ←  /  CONCOURSE  →'],
  ];
  c.fillStyle = '#17262a'; c.fillRect(0, 0, 1024, 2048);
  labels.forEach(([title, subtitle], i) => {
    const y = i * 128;
    c.fillStyle = i === 1 ? '#eedbc1' : i === 4 ? '#adbea0' : '#d6d8cc'; c.fillRect(0, y, 1024, 124);
    c.fillStyle = '#254149'; c.fillRect(18, y + 18, 6, 86);
    c.font = 'bold 43px sans-serif'; c.fillText(title, 45, y + 59);
    c.font = '19px sans-serif'; c.fillText(subtitle, 48, y + 96);
    c.fillStyle = '#87958c'; c.fillRect(45, y + 112, 920, 1);
  });
  maps.signs = new THREE.CanvasTexture(canvas); maps.signs.colorSpace = THREE.SRGBColorSpace;
  maps.signs.anisotropy = 4;
  return cache = maps;
}

export function blockMaterials() {
  const t = blockTextures();
  const surface = (kind, color, bumpScale) => new THREE.MeshStandardMaterial({ map: t[kind].map, bumpMap: t[kind].bump,
    bumpScale, color, roughness: kind === 'wood' ? 0.65 : 0.9, metalness: 0, vertexColors: true });
  const materials = {
    brick: surface('brick', 0xb6a399, 0.022), plaster: surface('plaster', 0xd5d1bc, 0.012),
    stone: surface('stone', 0xb4b9b5, 0.018), wood: surface('wood', 0xbc9b72, 0.012),
    metal: new THREE.MeshStandardMaterial({ color: 0x7c898a, roughness: 0.48, metalness: 0.6, vertexColors: true }),
    dark: new THREE.MeshStandardMaterial({ color: 0x283538, roughness: 0.65, metalness: 0.25, vertexColors: true }),
    window: new THREE.MeshStandardMaterial({ color: 0x283e48, roughness: 0.19, metalness: 0.45, emissive: 0x5c4025, emissiveIntensity: 0.16, vertexColors: true }),
    glass: new THREE.MeshStandardMaterial({ color: 0x89a7a8, transparent: true, opacity: 0.19, roughness: 0.13, metalness: 0.15, depthWrite: false, side: THREE.DoubleSide, vertexColors: true }),
    light: new THREE.MeshBasicMaterial({ color: 0xffdfae, vertexColors: true }),
    sign: new THREE.MeshBasicMaterial({ map: t.signs, color: 0xc8c8c8 }),
    fabric: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }),
    leaves: new THREE.MeshStandardMaterial({ color: 0x627b4d, roughness: 0.94, vertexColors: true }),
  };
  for (const material of Object.values(materials)) if (material.isMeshStandardMaterial) {
    // Baked irradiance from shop fixtures, evaluated once during construction.
    // This avoids extra scene lights and the associated per-pixel light loops.
    material.onBeforeCompile = shader => {
      shader.vertexShader = `attribute vec3 bakedLight;\nvarying vec3 vBakedLight;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBakedLight = bakedLight;');
      shader.fragmentShader = `varying vec3 vBakedLight;\n${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vBakedLight;');
    };
    material.customProgramCacheKey = () => 'concourse-baked-light-v1';
  }
  return materials;
}
