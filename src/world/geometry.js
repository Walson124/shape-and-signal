import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// For deformed organic meshes with no texture seams. Welding removes
// duplicate corner vertices and allows normals to flow across triangles.
export function smoothSurface(geo) {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const smooth = mergeVertices(geo);
  smooth.computeVertexNormals();
  return smooth;
}

// Single-step chamfers catch light without rounded-box subdivisions. The
// result remains one material/batch, fits the original collision bounds,
// and costs 44 triangles. Thin strips and long rods keep the ordinary
// 12-triangle box, including the hundreds of city neon accents.
export function bevelBox(w, h, d, bevel = Math.min(w, h, d) * 0.1, smallObject = false) {
  const smallest = Math.min(w, h, d);
  if ((!smallObject && (smallest < 0.65 || Math.max(w, h, d) / smallest > 32)) || bevel <= 0) return new THREE.BoxGeometry(w, h, d);
  const half = [w / 2, h / 2, d / 2];
  const b = Math.min(bevel, 0.6, Math.min(...half) * 0.45);
  const positions = [], normals = [], uvs = [];
  const point = (signs, fullAxis) => signs.map((s, a) => s * (half[a] - (a === fullAxis ? 0 : b)));
  const face = (points) => {
    const center = new THREE.Vector3();
    points.forEach(p => center.add(new THREE.Vector3(...p)));
    const a = new THREE.Vector3(...points[0]), ab = new THREE.Vector3(...points[1]).sub(a);
    const normal = ab.cross(new THREE.Vector3(...points[2]).sub(a)).normalize();
    if (normal.dot(center) < 0) { points.reverse(); normal.negate(); }
    const axis = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
    const dominant = axis.indexOf(Math.max(...axis));
    const u = dominant === 0 ? 2 : 0, v = dominant === 1 ? 2 : 1;
    for (let i = 1; i < points.length - 1; i++) {
      for (const p of [points[0], points[i], points[i + 1]]) {
        positions.push(...p); normals.push(normal.x, normal.y, normal.z);
        uvs.push(p[u] / (half[u] * 2) + 0.5, p[v] / (half[v] * 2) + 0.5);
      }
    }
  };
  // Six primary faces, twelve edge bands, eight corner caps.
  for (let axis = 0; axis < 3; axis++) {
    const other = [0, 1, 2].filter(a => a !== axis);
    for (const s of [-1, 1]) face([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(pair => {
      const signs = [0, 0, 0]; signs[axis] = s;
      signs[other[0]] = pair[0]; signs[other[1]] = pair[1];
      return point(signs, axis);
    }));
    for (const s of [-1, 1]) for (const t of [-1, 1]) {
      const signs = [0, 0, 0]; signs[other[0]] = s; signs[other[1]] = t;
      signs[axis] = -1;
      const p0 = point(signs, other[0]), p1 = point(signs, other[1]);
      signs[axis] = 1;
      face([p0, p1, point(signs, other[1]), point(signs, other[0])]);
    }
  }
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    face([0, 1, 2].map(axis => point([x, y, z], axis)));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geo;
}

// A low triangle-count vehicle shell. The nose narrows and drops, while
// the rear retains its full width. Dimensions continue to bound the mesh.
export function taperedHull(w, h, d, nose = 0.65) {
  const geo = bevelBox(w, h, d, Math.min(w, h, d) * 0.18, true);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const front = THREE.MathUtils.smoothstep(-p.getZ(i) / d, 0, 0.5);
    p.setXYZ(i, p.getX(i) * (1 - front * (1 - nose)), p.getY(i) * (1 - front * 0.3) - h * 0.1 * front, p.getZ(i));
  }
  geo.computeVertexNormals();
  return geo;
}
