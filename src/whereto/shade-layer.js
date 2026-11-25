// Draws shaded strokes on a canvas laid over a map. The map view supplies:
//   toScreen(x, y) -> [px, py]   a stored point to canvas pixels (CSS px)
//   radiusPx(stroke) -> px       a stroke's radius on screen
// Each person's strokes are drawn on a scratch canvas first, so their own overlaps and
// erasing work out before they are blended with everyone else's.

export class ShadeLayer {
  constructor(host) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'shade-canvas';
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.tmp = document.createElement('canvas');
    this.tctx = this.tmp.getContext('2d');
    this.w = 0; this.h = 0;
  }

  fit(w, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && this.dpr === dpr) return;
    this.w = w; this.h = h; this.dpr = dpr;
    for (const c of [this.canvas, this.tmp]) { c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr)); }
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  // scene: { toScreen, radiusPx, mine?: { strokes, yes, maybe }, group?: { people: [strokes], color },
  //          live?: stroke being drawn, marker?: { x, y, r, color } (canvas px) }
  draw(scene) {
    const { ctx, tctx, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const paint = (strokes, color) => {
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.clearRect(0, 0, this.tmp.width, this.tmp.height);
      tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const s of strokes) drawStroke(tctx, s, scene, color);
      tctx.globalCompositeOperation = 'source-over';
    };
    if (scene.group) {
      const { people, color } = scene.group;
      // n layers of alpha a stack up to about 0.85 where everyone overlaps
      const a = people.length ? 1 - 0.15 ** (1 / people.length) : 0;
      for (const strokes of people) {
        paint(strokes, () => color);
        ctx.globalAlpha = a;
        ctx.drawImage(this.tmp, 0, 0);
      }
    }
    if (scene.mine) {
      const { strokes, yes, maybe } = scene.mine;
      paint(scene.live ? [...strokes, scene.live] : strokes, (v) => (v === 2 ? yes : maybe));
      ctx.globalAlpha = 0.62;
      ctx.drawImage(this.tmp, 0, 0);
    }
    ctx.globalAlpha = 1;
    if (scene.marker) {
      const { x, y, r, color } = scene.marker;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(14, r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawStroke(ctx, s, scene, colorFor) {
  const r = Math.max(1.5, scene.radiusPx(s));
  ctx.globalCompositeOperation = s.v ? 'source-over' : 'destination-out';
  ctx.strokeStyle = ctx.fillStyle = s.v ? colorFor(s.v) : '#000';
  ctx.lineWidth = r * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (s.p.length === 2) {
    const [x, y] = scene.toScreen(s.p[0], s.p[1]);
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 0; i < s.p.length; i += 2) {
    const [x, y] = scene.toScreen(s.p[i], s.p[i + 1]);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.stroke();
}
