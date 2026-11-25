import { esc } from '../platform/shell.js';

// An SVG map you can zoom (wheel, pinch, buttons), pan (drag in "move" mode or with the
// right/middle button) and paint: press on a spot and drag across others to give them all
// the same mark, like painting times in when2meet.

const SVGNS = 'http://www.w3.org/2000/svg';
const MAX_ZOOM = 14;

export class MapView {
  // opts: { onPaintStart(id) -> value, onPaint(id, value), onHover(id|null, x, y), onClick(id) }
  constructor(root, def, opts = {}) {
    this.root = root;
    this.def = def;
    this.opts = opts;
    this.tool = 'paint';      // paint | move
    this.paintable = false;
    this.k = 1; this.tx = 0; this.ty = 0;
    root.classList.add('mapview');
    root.innerHTML = `
      <svg viewBox="0 0 ${def.w} ${def.h}" preserveAspectRatio="xMidYMid meet" role="img">
        <g class="vp">
          <g class="under">${def.under || ''}</g>
          <g class="spots ${def.overlay ? 'overlay' : ''}"></g>
          <g class="over">${def.over || ''}</g>
          <g class="labels"></g>
        </g>
      </svg>
      <div class="zoom">
        <button type="button" data-z="in" aria-label="Zoom in">+</button>
        <button type="button" data-z="out" aria-label="Zoom out">−</button>
        <button type="button" data-z="reset" aria-label="Fit map">⤢</button>
      </div>`;
    this.svg = root.querySelector('svg');
    this.vp = root.querySelector('.vp');
    this.els = new Map();
    const g = root.querySelector('.spots');
    const frag = document.createDocumentFragment();
    for (const s of def.spots) {
      let el;
      if (s.d) { el = document.createElementNS(SVGNS, 'path'); el.setAttribute('d', s.d); }
      else if (s.cx != null) { el = document.createElementNS(SVGNS, 'circle'); el.setAttribute('cx', s.cx); el.setAttribute('cy', s.cy); el.setAttribute('r', def.pointR || 4); el.classList.add('pt'); }
      else { el = document.createElementNS(SVGNS, 'rect'); for (const k of ['x', 'y']) el.setAttribute(k, s[k]); el.setAttribute('width', s.w); el.setAttribute('height', s.h); if (!s.cell) el.setAttribute('rx', Math.min(8, s.w / 8, s.h / 8)); if (s.cell) el.classList.add('cell'); }
      el.dataset.id = s.id;
      el.classList.add('spot');
      this.els.set(s.id, el);
      frag.append(el);
    }
    g.append(frag);
    if (def.labels) {
      const lg = root.querySelector('.labels');
      lg.innerHTML = def.spots.filter((s) => s.w).map((s) => {
        const fs = Math.max(def.w / 110, Math.min(def.w / 45, s.w / Math.max(6, s.name.length) * 1.6, s.h / 2.5));
        return `<text x="${s.x + s.w / 2}" y="${s.y + s.h / 2}" font-size="${fs.toFixed(1)}" text-anchor="middle" dominant-baseline="central">${esc(s.name)}</text>`;
      }).join('');
    }
    this.bind();
    this.apply();
  }

  setTool(tool) { this.tool = tool; this.root.dataset.tool = tool; }
  setPaintable(on) { this.paintable = on; this.root.classList.toggle('paintable', on); }

  // fill: a CSS color or '' for the default look; cls toggles extra classes
  style(id, fill, opacity = 1) {
    const el = this.els.get(id);
    if (!el) return;
    el.style.fill = fill || '';
    el.style.fillOpacity = fill ? opacity : '';
    el.classList.toggle('marked', !!fill);
  }

  highlight(ids) {
    for (const el of this.root.querySelectorAll('.spot.hl')) el.classList.remove('hl');
    for (const id of ids || []) this.els.get(id)?.classList.add('hl');
  }

  // zoom so a spot fills a good part of the view
  focus(id) {
    const el = this.els.get(id);
    if (!el) return;
    const bb = el.getBBox();
    const { w, h } = this.def;
    const k = Math.min(MAX_ZOOM, Math.max(1, Math.min(w / (bb.width * 4 + 1), h / (bb.height * 4 + 1)), this.def.pointR && !bb.width ? 5 : 1));
    this.k = Math.min(MAX_ZOOM, Math.max(1, el.tagName === 'circle' ? Math.max(this.k, 5) : k));
    this.tx = w / 2 - (bb.x + bb.width / 2) * this.k;
    this.ty = h / 2 - (bb.y + bb.height / 2) * this.k;
    this.apply(true);
  }

  apply(animate = false) {
    const { w, h } = this.def;
    // keep some of the map on screen
    this.tx = Math.min(w * 0.5, Math.max(w * 0.5 - w * this.k, this.tx));
    this.ty = Math.min(h * 0.5, Math.max(h * 0.5 - h * this.k, this.ty));
    this.vp.style.transition = animate ? 'transform 0.35s ease' : '';
    this.vp.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.k})`;
    this.root.style.setProperty('--k', this.k);
    if (this.def.pointR) {
      const r = this.def.pointR / Math.sqrt(this.k);
      for (const el of this.els.values()) el.setAttribute('r', r.toFixed(2));
    }
  }

  zoomAt(factor, px, py) {
    const k = Math.min(MAX_ZOOM, Math.max(1, this.k * factor));
    const f = k / this.k;
    this.tx = px - (px - this.tx) * f;
    this.ty = py - (py - this.ty) * f;
    this.k = k;
    this.apply();
  }

  // screen point -> map units (before the zoom transform)
  toMap(clientX, clientY) {
    const pt = this.svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const m = this.svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  spotAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    return el?.classList?.contains('spot') && this.root.contains(el) ? el.dataset.id : null;
  }

  bind() {
    const root = this.root;
    root.querySelector('.zoom').addEventListener('click', (e) => {
      const z = e.target.closest('[data-z]')?.dataset.z;
      const { w, h } = this.def;
      if (z === 'in') this.zoomAt(1.6, w / 2, h / 2);
      else if (z === 'out') this.zoomAt(1 / 1.6, w / 2, h / 2);
      else if (z === 'reset') { this.k = 1; this.tx = 0; this.ty = 0; this.apply(true); }
    });
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this.toMap(e.clientX, e.clientY);
      this.zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018)), p.x, p.y);
    }, { passive: false });
    this.svg.addEventListener('contextmenu', (e) => e.preventDefault());

    const pointers = new Map();
    let drag = null;      // { kind: 'pan'|'paint', ... }
    let pinch = null;
    this.svg.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.svg.setPointerCapture(e.pointerId);
      if (pointers.size === 2) {
        // two fingers: pinch-zoom and pan, and undo nothing painted (paint starts on move)
        drag = null;
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: this.k, tx: this.tx, ty: this.ty, mid: this.toMap((a.x + b.x) / 2, (a.y + b.y) / 2) };
        return;
      }
      const id = this.spotAt(e.clientX, e.clientY);
      const wantsPaint = this.paintable && this.tool === 'paint' && e.button === 0;
      if (wantsPaint && e.pointerType === 'touch') {
        // a touch could be a pan or a paint: decide once it moves (or lifts)
        drag = { kind: 'maybe', id, x: e.clientX, y: e.clientY, start: this.toMap(e.clientX, e.clientY), tx: this.tx, ty: this.ty };
        return;
      }
      if (wantsPaint && id) {
        drag = { kind: 'paint', value: this.opts.onPaintStart?.(id), seen: new Set([id]) };
        this.opts.onPaint?.(id, drag.value);
        return;
      }
      drag = { kind: 'pan', x: e.clientX, y: e.clientY, start: this.toMap(e.clientX, e.clientY), tx: this.tx, ty: this.ty, id, moved: false };
      root.classList.add('panning');
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const k = Math.min(MAX_ZOOM, Math.max(1, pinch.k * d / pinch.d));
        const mid = this.toMap((a.x + b.x) / 2, (a.y + b.y) / 2);
        // keep the map point that was under the fingers under them
        const mx = (pinch.mid.x - pinch.tx) / pinch.k, my = (pinch.mid.y - pinch.ty) / pinch.k;
        this.k = k;
        this.tx = mid.x - mx * k;
        this.ty = mid.y - my * k;
        this.apply();
        return;
      }
      if (!drag) {
        if (e.pointerType !== 'touch') {
          const id = this.spotAt(e.clientX, e.clientY);
          this.opts.onHover?.(id, e.clientX, e.clientY);
        }
        return;
      }
      if (drag.kind === 'maybe') {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
        // a quick drag on a touch screen paints; panning a painting map takes two fingers or the Move tool
        const id = drag.id || this.spotAt(e.clientX, e.clientY);
        if (!id) { drag = { ...drag, kind: 'pan' }; return; }
        drag = { kind: 'paint', value: this.opts.onPaintStart?.(id), seen: new Set([id]) };
        this.opts.onPaint?.(id, drag.value);
      }
      if (drag.kind === 'paint') {
        const id = this.spotAt(e.clientX, e.clientY);
        if (id && !drag.seen.has(id)) { drag.seen.add(id); this.opts.onPaint?.(id, drag.value); }
        return;
      }
      if (drag.kind === 'pan') {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
        const p = this.toMap(e.clientX, e.clientY);
        this.tx = drag.tx + (p.x - drag.start.x);
        this.ty = drag.ty + (p.y - drag.start.y);
        // toMap reads the current transform-free CTM, so this stays stable while dragging
        this.apply();
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
      if (drag?.kind === 'maybe' && drag.id) {
        // a tap
        const value = this.opts.onPaintStart?.(drag.id);
        this.opts.onPaint?.(drag.id, value);
      } else if (drag?.kind === 'pan' && !drag.moved && drag.id) {
        this.opts.onClick?.(drag.id);
        if (e.pointerType === 'touch') {
          const r = this.svg.getBoundingClientRect();
          this.opts.onHover?.(drag.id, Math.min(e.clientX, r.right - 10), e.clientY);
        }
      }
      drag = null;
      root.classList.remove('panning');
    };
    this.svg.addEventListener('pointerup', end);
    this.svg.addEventListener('pointercancel', end);
    this.svg.addEventListener('pointerleave', (e) => { if (!drag && e.pointerType !== 'touch') this.opts.onHover?.(null); });
  }
}
