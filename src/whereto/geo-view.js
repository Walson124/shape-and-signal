import { Map as MapLibre, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ShadeLayer } from './shade-layer.js';
import { fromPlane } from './shade.js';
import { searchPlaces } from './geocode.js';
import { esc } from '../platform/shell.js';

// The real, zoomable world map for shaded plans: OpenFreeMap vector tiles (free, no key,
// OpenStreetMap data) drawn by MapLibre, with a canvas on top for people's shading.
// Stored points are [lon, lat]; brush radii are meters.

setWorkerUrl(workerUrl);
const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const EARTH = 40075016.686;
const WORLD = [[-168, -56], [190, 76]];

export class GeoView {
  // opts: { view: [w, s, e, n] | null, brush: { start(x, y), move(x, y), end(), cancel() },
  //         onHover(lonlat | null, clientX, clientY), onReady() }
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.tool = 'paint';
    this.paintable = false;
    this.scene = null;
    root.classList.add('geoview');
    root.innerHTML = `
      <div class="geo-map"></div>
      <form class="geo-search" autocomplete="off" onsubmit="event.preventDefault()">
        <input type="search" placeholder="Search a place…" aria-label="Search a place" enterkeyhint="search" />
        <ul class="geo-results hidden"></ul>
      </form>`;
    const v = opts.view;
    this.map = new MapLibre({
      container: root.querySelector('.geo-map'),
      style: STYLE,
      bounds: v ? [[v[0], v[1]], [v[2], v[3]]] : WORLD,
      fitBoundsOptions: { padding: 20 },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      attributionControl: { compact: true },
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation();
    this.map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    this.layer = new ShadeLayer(root);
    const redraw = () => this.redraw();
    this.map.on('move', redraw);
    this.map.on('resize', redraw);
    this.map.on('load', () => { redraw(); opts.onReady?.(); });
    new ResizeObserver(redraw).observe(root);
    this.bindBrush();
    this.bindSearch();
  }

  setTool(tool) { this.tool = tool; this.sync(); }
  setPaintable(on) { this.paintable = on; this.sync(); }
  sync() {
    const painting = this.paintable && this.tool === 'paint';
    this.root.classList.toggle('painting', painting);
    for (const h of [this.map.dragPan, this.map.doubleClickZoom]) painting ? h.disable() : h.enable();
  }

  toScreen = (lon, lat) => { const p = this.map.project([lon, lat]); return [p.x, p.y]; };
  // meters per CSS pixel at a latitude
  mpp(lat) { return EARTH * Math.cos(lat * Math.PI / 180) / (512 * 2 ** this.map.getZoom()); }
  radiusPx = (s) => s.r / this.mpp(s.p[1]);
  brushRadius(px, lat) { return px * this.mpp(lat); }

  surfaceAt(clientX, clientY) {
    const r = this.map.getContainer().getBoundingClientRect();
    const ll = this.map.unproject([clientX - r.left, clientY - r.top]).wrap();
    return [ll.lng, Math.max(-85, Math.min(85, ll.lat))];
  }

  // scene: everything ShadeLayer.draw takes except the projection, plus marker: { plane: [x, y], r: plane units }
  show(scene) { this.scene = scene; this.redraw(); }
  redraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const r = this.root.getBoundingClientRect();
      this.layer.fit(r.width, r.height);
      if (!this.scene) { this.layer.draw({ toScreen: this.toScreen, radiusPx: this.radiusPx }); return; }
      let marker = null;
      if (this.scene.marker) {
        const [lon, lat] = fromPlane({ kind: 'geo' }, ...this.scene.marker.plane);
        const [lon2, lat2] = fromPlane({ kind: 'geo' }, this.scene.marker.plane[0] + this.scene.marker.r, this.scene.marker.plane[1]);
        const [x, y] = this.toScreen(lon, lat), [x2] = this.toScreen(lon2, lat2);
        marker = { x, y, r: Math.abs(x2 - x), color: this.scene.marker.color };
      }
      this.layer.draw({ ...this.scene, marker, toScreen: this.toScreen, radiusPx: this.radiusPx });
    });
  }

  // zoom to a region given in plane units [x0, y0, x1, y1]
  focus(bounds) {
    const [w, n] = fromPlane({ kind: 'geo' }, bounds[0], bounds[1]);
    const [e, s] = fromPlane({ kind: 'geo' }, bounds[2], bounds[3]);
    this.map.fitBounds([[w, s], [e, n]], { padding: 70, maxZoom: 13, duration: 700 });
  }

  bindBrush() {
    const el = this.map.getCanvasContainer();
    const touches = new Set();
    let drawing = null;   // pointerId of the stroke being drawn
    let pending = null;   // a touch that may become a stroke (or a pinch)
    const can = (e) => this.paintable && this.tool === 'paint' && (e.pointerType !== 'mouse' || e.button === 0);
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') touches.add(e.pointerId);
      if (touches.size > 1) {
        // a second finger: this is a pinch, not a stroke
        if (drawing !== null) { this.opts.brush?.cancel(); drawing = null; }
        pending = null;
        return;
      }
      if (!can(e)) return;
      if (e.pointerType === 'touch') { pending = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
      drawing = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      this.opts.brush?.start(...this.surfaceAt(e.clientX, e.clientY));
    });
    el.addEventListener('pointermove', (e) => {
      if (pending && e.pointerId === pending.id && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 6) {
        drawing = pending.id;
        this.opts.brush?.start(...this.surfaceAt(pending.x, pending.y));
        pending = null;
      }
      if (drawing === e.pointerId) { this.opts.brush?.move(...this.surfaceAt(e.clientX, e.clientY)); return; }
      if (e.pointerType === 'mouse' && e.buttons === 0) this.opts.onHover?.(this.surfaceAt(e.clientX, e.clientY), e.clientX, e.clientY);
    });
    const end = (e) => {
      touches.delete(e.pointerId);
      if (pending && pending.id === e.pointerId) {
        // a tap: a single dab
        this.opts.brush?.start(...this.surfaceAt(pending.x, pending.y));
        this.opts.brush?.end();
        pending = null;
        return;
      }
      if (drawing === e.pointerId) { drawing = null; this.opts.brush?.end(); }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); if (drawing === e.pointerId) { drawing = null; this.opts.brush?.cancel(); } pending = null; });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && drawing === null) this.opts.onHover?.(null); });
  }

  bindSearch() {
    const form = this.root.querySelector('.geo-search');
    const input = form.querySelector('input');
    const list = form.querySelector('.geo-results');
    let results = [];
    const go = (r) => {
      list.classList.add('hidden');
      input.value = r.short;
      input.blur();
      const [w, s, e, n] = r.bbox;
      this.map.fitBounds([[w, s], [e, n]], { padding: 30, maxZoom: 14, duration: 900 });
    };
    form.addEventListener('submit', async () => {
      const q = input.value.trim();
      if (!q) return;
      list.innerHTML = '<li class="muted">Searching…</li>';
      list.classList.remove('hidden');
      try { results = await searchPlaces(q); } catch { results = []; }
      if (!results.length) { list.innerHTML = '<li class="muted">No places found</li>'; return; }
      if (results.length === 1) { go(results[0]); return; }
      list.innerHTML = results.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}</button></li>`).join('');
    });
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) go(results[Number(b.dataset.i)]); });
    input.addEventListener('input', () => { if (!input.value) list.classList.add('hidden'); });
    document.addEventListener('pointerdown', (e) => { if (!form.contains(e.target)) list.classList.add('hidden'); });
  }
}
