// Shaded plans: people paint areas with a brush instead of picking spots. This module is
// the maths, with no DOM, so tests can run it: it turns everyone's strokes into a shared
// grid, counts how many people cover each cell, and finds the best areas.
//
// Strokes are stored as [{ v: 2 | 1 | 0, r, p: [x0, y0, x1, y1, ...] }] and applied in
// order (v 0 erases). A "surface" says what the numbers mean:
//   { kind: 'geo' }             p is [lon, lat], r is meters
//   { kind: 'image', aspect }   p is fractions of the picture's width and height, r is a
//                               fraction of its width; aspect is height / width
// Everything is measured on a flat "plane" where distances are fair in both directions:
// Web Mercator (0..1) for geo, and fractions of the width for pictures.

const EARTH = 40075016.686;   // meters around the equator
const MAX_CELLS_SIDE = 420;

export function toPlane(surface, x, y) {
  if (surface.kind === 'geo') {
    const lat = Math.max(-85.05, Math.min(85.05, y)) * Math.PI / 180;
    return [(x + 180) / 360, (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2];
  }
  return [x, y * surface.aspect];
}

export function fromPlane(surface, px, py) {
  if (surface.kind === 'geo') {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * py))) * 180 / Math.PI;
    return [px * 360 - 180, lat];
  }
  return [px, py / surface.aspect];
}

// a stroke's radius on the plane
export function planeRadius(surface, r, lat = 0) {
  if (surface.kind === 'geo') return r / (EARTH * Math.max(0.05, Math.cos(lat * Math.PI / 180)));
  return r;
}

// meters across a plane distance at a plane y (geo only)
export function planeToMeters(d, py) {
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * py)));
  return d * EARTH * Math.cos(lat);
}

const strokesOf = (resp) => (Array.isArray(resp?.strokes) ? resp.strokes : []);

// Lay all strokes over one grid and count. Returns null when nobody has shaded anything.
export function analyze(responses, surface) {
  const people = responses.filter((r) => strokesOf(r).some((s) => s.v));
  if (!people.length) return null;

  // the planar bounds of every painted stroke (erasers can't add area)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, minR = Infinity;
  const planar = new Map();
  for (const resp of people) {
    const list = strokesOf(resp).map((s) => {
      const pts = [];
      for (let i = 0; i < s.p.length; i += 2) pts.push(toPlane(surface, s.p[i], s.p[i + 1]));
      const r = planeRadius(surface, s.r, s.p[1]);
      if (s.v) {
        minR = Math.min(minR, r);
        for (const [px, py] of pts) {
          x0 = Math.min(x0, px - r); x1 = Math.max(x1, px + r);
          y0 = Math.min(y0, py - r); y1 = Math.max(y1, py + r);
        }
      }
      return { v: s.v, r, pts };
    });
    planar.set(resp, list);
  }
  const span = Math.max(x1 - x0, y1 - y0, 1e-9);
  // fine enough to resolve the smallest brush, but never a huge grid
  const cell = Math.max(span / MAX_CELLS_SIDE, Math.min(span / 60, minR / 2));
  const cols = Math.max(1, Math.ceil((x1 - x0) / cell)), rows = Math.max(1, Math.ceil((y1 - y0) / cell));
  const size = cols * rows;

  const grid = { x0, y0, cell, cols, rows };
  const masks = people.map((resp) => {
    const m = new Uint8Array(size);
    for (const s of planar.get(resp)) stamp(m, grid, s);
    return m;
  });
  const count = new Uint8Array(size), yes = new Uint8Array(size);
  let max = 0;
  for (const m of masks) {
    for (let i = 0; i < size; i++) {
      if (m[i]) { count[i]++; if (m[i] === 2) yes[i]++; if (count[i] > max) max = count[i]; }
    }
  }
  const a = { surface, grid, people, masks, count, yes, max, n: responses.length };
  a.regions = findRegions(a);
  return a;
}

// paint one stroke into a person's mask: every cell within r of the stroke's path
function stamp(mask, g, s) {
  const r = Math.max(s.r, g.cell * 0.55);
  const pts = s.pts.length === 1 ? [s.pts[0], s.pts[0]] : s.pts;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - g.x0) / g.cell));
    const c1 = Math.min(g.cols - 1, Math.floor((Math.max(ax, bx) + r - g.x0) / g.cell));
    const r0 = Math.max(0, Math.floor((Math.min(ay, by) - r - g.y0) / g.cell));
    const r1 = Math.min(g.rows - 1, Math.floor((Math.max(ay, by) + r - g.y0) / g.cell));
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, rr = r * r;
    for (let row = r0; row <= r1; row++) {
      const cy = g.y0 + (row + 0.5) * g.cell;
      for (let col = c0; col <= c1; col++) {
        const cx = g.x0 + (col + 0.5) * g.cell;
        const t = len2 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2)) : 0;
        const ex = ax + t * dx - cx, ey = ay + t * dy - cy;
        if (ex * ex + ey * ey <= rr) mask[row * g.cols + col] = s.v;
      }
    }
  }
}

// The best areas, best first: patches of cells covered by the most people (then by the
// most "works"), each with who is in and who is missing.
function findRegions(a) {
  const { grid, count, yes, max, masks, people } = a;
  const { cols, rows } = grid;
  const seen = new Uint8Array(count.length);
  const regions = [];
  for (let level = max; level >= 1 && regions.length < 6; level--) {
    const found = [];
    for (let i = 0; i < count.length; i++) {
      if (seen[i] || count[i] !== level) continue;
      // flood fill this patch
      const cells = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop();
        cells.push(c);
        const cx = c % cols, cy = (c - cx) / cols;
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (!seen[j] && count[j] === level) { seen[j] = 1; stack.push(j); }
        }
      }
      found.push(describe(a, level, cells));
    }
    // ignore crumbs next to a real patch at the same level
    const biggest = Math.max(...found.map((f) => f.cells));
    for (const f of found.sort((p, q) => q.yesShare - p.yesShare || q.cells - p.cells)) {
      if (f.cells < Math.max(2, biggest * 0.04) && found.length > 1) continue;
      regions.push(f);
      if (regions.length >= 6) break;
    }
  }
  // overall order: more people, then more "works", then bigger
  regions.sort((p, q) => q.count - p.count || q.yesShare - p.yesShare || q.cells - p.cells);
  regions.forEach((r, i) => { r.id = `area-${i}`; r.all = r.count === a.n && a.n > 0; });
  return regions;
}

function describe(a, level, cells) {
  const { grid, yes, masks, people } = a;
  const { cols, x0, y0, cell } = grid;
  let sx = 0, sy = 0, minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity, ySum = 0;
  for (const c of cells) {
    const cx = c % cols, cy = (c - cx) / cols;
    sx += cx; sy += cy; ySum += yes[c];
    minC = Math.min(minC, cx); maxC = Math.max(maxC, cx); minR = Math.min(minR, cy); maxR = Math.max(maxR, cy);
  }
  const mx = sx / cells.length, my = sy / cells.length;
  // the cell that best stands for the patch: most "works", then nearest the middle
  let rep = cells[0], best = -1;
  for (const c of cells) {
    const cx = c % cols, cy = (c - cx) / cols;
    const score = yes[c] * 1e6 - ((cx - mx) ** 2 + (cy - my) ** 2);
    if (score > best) { best = score; rep = c; }
  }
  const yesNames = [], maybeNames = [], missing = [];
  people.forEach((p, k) => {
    const v = masks[k][rep];
    (v === 2 ? yesNames : v === 1 ? maybeNames : missing).push(p.name);
  });
  // people who answered but shaded nothing at all are missing too
  return {
    count: level,
    cells: cells.length,
    yesShare: ySum / cells.length,
    yes: yesNames,
    maybe: maybeNames,
    missingShaders: missing,
    center: [x0 + (mx + 0.5) * cell, y0 + (my + 0.5) * cell],
    rep: [x0 + ((rep % cols) + 0.5) * cell, y0 + (Math.floor(rep / cols) + 0.5) * cell],
    // a few more points spread through the patch, for naming it when `rep` is in the sea
    samples: spread(cells, 6).map((c) => [x0 + ((c % cols) + 0.5) * cell, y0 + (Math.floor(c / cols) + 0.5) * cell]),
    bounds: [x0 + minC * cell, y0 + minR * cell, x0 + (maxC + 1) * cell, y0 + (maxR + 1) * cell],
  };
}

function spread(cells, k) {
  if (cells.length <= k) return cells;
  return Array.from({ length: k }, (_, i) => cells[Math.floor((i + 0.5) * cells.length / k)]);
}

// who shaded the plane point (px, py): [{ name, v }]
export function whoAt(a, px, py) {
  if (!a) return [];
  const { x0, y0, cell, cols, rows } = a.grid;
  const c = Math.floor((px - x0) / cell), r = Math.floor((py - y0) / cell);
  if (c < 0 || r < 0 || c >= cols || r >= rows) return [];
  const i = r * cols + c;
  return a.people.map((p, k) => ({ name: p.name, v: a.masks[k][i] })).filter((x) => x.v);
}

// people in `responses` who aren't covering a region
export function missingFrom(region, responses) {
  const inside = new Set([...region.yes, ...region.maybe]);
  return responses.map((r) => r.name).filter((n) => !inside.has(n));
}

// [count of works strokes, count of if-needed strokes] that still show (not fully erased is
// not tracked: this is only for the "you've shaded…" summary)
export function strokeCounts(strokes) {
  let y = 0, m = 0;
  for (const s of strokes || []) { if (s.v === 2) y++; else if (s.v === 1) m++; }
  return [y, m];
}
