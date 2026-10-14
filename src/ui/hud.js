import * as THREE from 'three';
import { REALMS, STAGES, MAX_REALM, PILLS, realmOf } from '../game/data.js';
import { PATHS, TECHS, knows, ownedPaths } from '../game/paths.js';
import { settings } from '../core/settings.js';
import { codeLabel } from '../core/bindings.js';

export function fmt(n) {
  n = Math.max(0, n);
  if (n < 1000) return Math.round(n).toString();
  const units = ['K', 'M', 'B', 'T', 'Q'];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return `${n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n)}${units[u]}`;
}
export const fmtDist = (d) => (d >= 1000 ? `${(d / 1000).toFixed(1)}K` : `${Math.round(d)}`);
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
export function dangerClass(tier, realm) {
  const diff = tier - realm;
  if (diff <= 0.25) return 'danger-ok';
  if (diff <= 1.01) return 'danger-warn';
  return 'danger-bad';
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const tmpV = new THREE.Vector3();
const FEED_TAGS = { '': 'SYS', gold: 'CULT', red: 'WARN', violet: 'INFO', green: 'ITEM', yl: 'TASK' };

export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.el = {};
    for (const id of ['hud', 'target', 't-name', 't-cn', 't-realm', 't-dist', 't-hp', 'boss-bar', 'boss-name', 'boss-cn', 'boss-fill', 'boss-ghost', 'trib-bar', 'trib-fill',
      'realm-name', 'realm-cn', 'stage-name', 'xp-fill', 'xp-text', 'bt-ready', 'loc-galaxy', 'loc-system', 'loc-danger', 'density', 'coins', 'essence', 'bounty-list',
      'hp-fill', 'hp-text', 'en-fill', 'en-text', 'sp-fill', 'sp-text', 'status-row', 'sword-pips', 'skills', 'speed', 'formation', 'sword-range', 'view-mode',
      'altitude', 'alt-row', 'ore', 'speed-unit', 'move-mode', 'hull', 'hull-row', 'star-target', 'st-name', 'st-dist', 'st-threat', 'st-range',
      'reticle', 'hitmark', 'lock', 'ctrl-mark', 'markers', 'dmg-layer', 'feed', 'alert', 'prompt', 'prompt-text', 'prompt-prog', 'nav-info', 'meditate', 'med-rate',
      'fps', 'banner', 'compass', 'radar']) this.el[id] = $(id);
    this.compassCtx = this.el.compass.getContext('2d');
    this.radarCtx = this.el.radar.getContext('2d');
    this.setupCanvas(this.el.compass, 560, 44);
    this.setupCanvas(this.el.radar, 260, 150);
    this.markerEls = new Map();
    this.dmgPool = [];
    this.dmgActive = [];
    this.textTimer = 0;
    this.bannerTimer = null;
    this.pipCount = -1;
    this.lastBounties = '';
    this.radarSweep = 0;
    this.buildSkills('fist');
    settings.onChange((k) => {
      if (k === 'bindings') this.buildSkills(this.path || 'fist');
      if (k === 'hudScale') this.applyScale();
    });
    this.applyScale();
  }

  // Expanding ring when the radar pulses.
  pulse() {
    const r = document.getElementById('ping-ring');
    r.classList.remove('go');
    void r.offsetWidth;
    r.classList.add('go');
  }

  applyScale() {
    document.documentElement.style.setProperty('--hud-scale', String(settings.get('hudScale') || 1));
  }

  setupCanvas(c, w, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * dpr;
    c.height = h * dpr;
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  show(v) {
    this.el.hud.classList.toggle('hidden', !v);
  }

  buildSkills(pathId) {
    this.path = pathId;
    const P = PATHS[pathId] || PATHS.fist;
    const key = (a) => codeLabel(settings.key(a));
    const wl = document.getElementById('weapon-label');
    if (wl) wl.innerHTML = `<span class="mono dim">${esc(key('weaponNext'))} · WEAPON</span> <b style="color:#${P.color.toString(16).padStart(6, '0')}">${esc(P.weapon.name)}</b> <span class="cn">${P.cn}</span>`;
    const short = (id) => TECHS[id].name.split(' ').slice(-1)[0];
    this.techSlots = [
      { id: P.primary, key: key('fire') },
      { id: P.secondary, key: key('focus') },
      ...P.skills.map((id, i) => ({ id, key: key(`skill${i + 1}`) })),
    ];
    const slots = [
      ...this.techSlots.map((t) => ({ id: t.id, key: t.key, name: short(t.id), cn: TECHS[t.id].cn })),
      { sep: true },
      { id: 'meditate', key: key('cultivate'), name: 'Cultivate', cn: '修炼' },
      { id: 'breakthrough', key: key('breakthrough'), name: 'Break', cn: '突破' },
      { sep: true },
      ...Object.entries(PILLS).map(([k, p], i) => ({ id: `pill-${k}`, key: key(`pill${i + 1}`), name: { heal: 'Heal', energy: 'Elixir', cult: 'Insight' }[k], cn: p.cn, pill: true })),
    ];
    this.skillEls = {};
    this.el.skills.innerHTML = '';
    for (const s of slots) {
      const d = document.createElement('div');
      if (s.sep) {
        d.className = 'skill-sep';
        this.el.skills.appendChild(d);
        continue;
      }
      d.className = 'skill';
      d.innerHTML = `<div class="s-cd"></div><span class="s-key">${esc(s.key)}</span><span class="s-cn">${s.cn}</span><span class="s-name">${esc(s.name)}</span>${s.pill ? '<span class="s-count"></span>' : ''}`;
      this.el.skills.appendChild(d);
      this.skillEls[s.id] = { el: d, cd: d.querySelector('.s-cd'), count: d.querySelector('.s-count'), wasCd: false };
    }
  }

  // ------------------------------------------------------------ update --
  update(dt, info) {
    const { state, stats, rt } = info;
    const e = this.el;
    e['hp-fill'].style.width = `${(100 * Math.max(0, rt.hp)) / stats.maxHp}%`;
    e['en-fill'].style.width = `${(100 * rt.energy) / stats.maxEnergy}%`;
    e['sp-fill'].style.width = `${(100 * rt.spirit) / stats.maxSpirit}%`;
    e['xp-fill'].style.width = `${Math.min(100, (100 * state.xp) / stats.xpNeed)}%`;

    if (info.path && info.path !== this.path) this.buildSkills(info.path);
    for (const slot of this.techSlots) {
      const k = slot.id;
      const s = this.skillEls[k];
      const t = TECHS[k];
      const unlocked = state.realm >= t.unlockRealm && knows(state, k);
      const pool = t.res === 'spirit' ? rt.spirit : rt.energy;
      s.el.classList.toggle('locked', !unlocked);
      s.el.classList.toggle('low', unlocked && pool < t.cost);
      s.el.classList.toggle('active', ((k === 'barrier') && rt.shieldT > 0) || (k === 'will' && rt.willT > 0) || (k === 'iron' && rt.ironT > 0) || (k === 'venom' && rt.venomT > 0) || (k === 'steer' && info.controlling) || (k === 'guard' && rt.guarding) || (k === 'aim' && rt.aiming));
      const cd = rt.cooldowns[k] || 0;
      s.cd.style.setProperty('--p', `${unlocked ? Math.min(100, (cd / t.cd) * 100) : 0}%`);
      if (s.wasCd && cd <= 0 && unlocked && t.cd > 1) {
        s.el.classList.remove('ready-flash');
        void s.el.offsetWidth;
        s.el.classList.add('ready-flash');
      }
      s.wasCd = cd > 0;
    }
    this.skillEls.meditate.el.classList.toggle('active', rt.meditating);
    this.skillEls.breakthrough.el.classList.toggle('active', info.bt.ready);
    this.skillEls.breakthrough.el.classList.toggle('locked', !info.bt.ready);
    for (const k of Object.keys(PILLS)) {
      const s = this.skillEls[`pill-${k}`];
      s.count.textContent = state.pills[k];
      s.el.classList.toggle('locked', state.pills[k] <= 0);
    }

    // sword pips
    const states = info.swordStates;
    if (states.length !== this.pipCount) {
      this.pipCount = states.length;
      e['sword-pips'].innerHTML = states.map(() => '<i class="pip"></i>').join('');
    }
    const pips = e['sword-pips'].children;
    for (let i = 0; i < states.length; i++) {
      const st = states[i];
      pips[i].className = `pip${st === 'control' ? ' control' : st === 'guard' ? '' : ' away'}`;
    }

    e.meditate.classList.toggle('hidden', !rt.meditating);
    e.reticle.classList.toggle('on-target', !!info.aimTarget);
    e.reticle.classList.toggle('firing', info.firing);
    e.reticle.classList.toggle('controlling', info.controlling);

    // target panel / boss bar
    const boss = info.boss && info.boss.aggro ? info.boss : null;
    if (boss) {
      e['boss-bar'].classList.remove('hidden');
      e['boss-name'].textContent = boss.name;
      e['boss-cn'].textContent = boss.cn;
      const pct = `${(100 * Math.max(0, boss.hp)) / boss.maxHp}%`;
      e['boss-fill'].style.width = pct;
      e['boss-ghost'].style.width = pct;
    } else {
      e['boss-bar'].classList.add('hidden');
    }
    if (rt.trib) {
      e['trib-bar'].classList.remove('hidden');
      e['trib-fill'].style.width = `${100 * (1 - rt.trib.t / rt.trib.dur)}%`;
    } else {
      e['trib-bar'].classList.add('hidden');
    }
    const tgt = !boss && !rt.trib ? info.target : null;
    if (tgt) {
      e.target.classList.remove('hidden');
      e['t-hp'].style.width = `${(100 * Math.max(0, tgt.hp)) / tgt.maxHp}%`;
    } else {
      e.target.classList.add('hidden');
    }

    this.textTimer -= dt;
    if (this.textTimer > 0) return;
    this.textTimer = 0.12;
    const realm = REALMS[state.realm];
    e['realm-name'].textContent = realm.name;
    e['realm-name'].parentElement.style.color = hex(realm.color);
    e['realm-cn'].textContent = realm.cn;
    e['stage-name'].textContent = `${STAGES[state.stage].name.toUpperCase()} STAGE · ${STAGES[state.stage].cn}`;
    e['hp-text'].textContent = `${fmt(rt.hp)}/${fmt(stats.maxHp)}`;
    e['en-text'].textContent = `${Math.floor(rt.energy)}/${stats.maxEnergy}`;
    e['sp-text'].textContent = `${Math.floor(rt.spirit)}/${stats.maxSpirit}`;
    e['xp-text'].textContent = state.realm >= MAX_REALM && state.stage === 3 ? 'SUMMIT' : `${fmt(state.xp)} / ${fmt(stats.xpNeed)}`;
    const bt = e['bt-ready'];
    if (info.bt.ready) {
      bt.classList.remove('hidden', 'blocked');
      bt.innerHTML = 'BREAKTHROUGH READY · PRESS <kbd>B</kbd>';
    } else if (info.bt.blocked) {
      bt.classList.remove('hidden');
      bt.classList.add('blocked');
      bt.textContent = info.bt.blocked;
    } else {
      bt.classList.add('hidden');
    }
    const loc = info.loc;
    e['loc-galaxy'].textContent = `${loc.region.toUpperCase()} · ${loc.system.toUpperCase()}`;
    e['loc-system'].textContent = loc.body;
    e['loc-danger'].innerHTML = `<span class="${dangerClass(loc.tier, state.realm)}">${realmOf(loc.tier).name.toUpperCase()}</span>`;
    if (loc.alt !== null) {
      e['alt-row'].classList.remove('hidden');
      e.altitude.textContent = loc.alt >= 1000 ? `${(loc.alt / 1000).toFixed(2)} KM` : `${Math.round(loc.alt)} M`;
    } else {
      e['alt-row'].classList.add('hidden');
    }
    e.ore.textContent = fmt(state.ore);
    e['move-mode'].textContent = loc.mode;
    if (info.hull !== null) {
      e['hull-row'].classList.remove('hidden');
      e.hull.textContent = `${Math.round(info.hull * 100)}%`;
    } else {
      e['hull-row'].classList.add('hidden');
    }
    const stt = info.starTarget;
    if (stt) {
      e['star-target'].classList.remove('hidden');
      e['st-name'].textContent = `${stt.name}${stt.boss ? ' ☠' : ''}${stt.visited ? ' ✓' : ''}`;
      e['st-dist'].textContent = `${stt.dist.toFixed(1)} LY`;
      e['st-threat'].innerHTML = `<span class="${dangerClass(stt.tier, state.realm)}">${realmOf(stt.tier).name.toUpperCase()}</span>`;
      e['st-range'].innerHTML = stt.inRange === null ? '<span class="dim">NO SHIP</span>' : stt.inRange ? '<span class="danger-ok">IN RANGE · [G]</span>' : `<span class="danger-bad">RANGE ${stt.range} LY</span>`;
    } else {
      e['star-target'].classList.add('hidden');
    }
    e.density.textContent = `×${info.density.toFixed(1)}`;
    e.coins.textContent = fmt(state.coins);
    e.essence.textContent = fmt(state.essence);
    e['med-rate'].textContent = `+${fmt(info.medRate)}/S`;
    if (info.speed >= 10000) { e.speed.textContent = (info.speed / 1000).toFixed(1); e['speed-unit'].textContent = 'KM/S'; } else { e.speed.textContent = Math.round(info.speed); e['speed-unit'].textContent = 'M/S'; }
    e.formation.textContent = info.path && info.path !== 'mind' ? '—' : info.formation.toUpperCase();
    e['view-mode'].textContent = info.camMode === 'first' ? 'FIRST PERSON' : 'THIRD PERSON';
    if (info.nav) {
      e['nav-info'].classList.remove('hidden');
      e['nav-info'].textContent = `${info.cruise ? '▶ CRUISING TO' : '◆ COURSE SET:'} ${info.nav.label.toUpperCase()} · ${fmtDist(info.navDist)}${info.cruise ? '' : ' · [G] CRUISE'}`;
    } else {
      e['nav-info'].classList.add('hidden');
    }
    if (tgt) {
      e['t-name'].textContent = tgt.name;
      e['t-cn'].textContent = tgt.cn;
      e['t-realm'].innerHTML = `<span class="${dangerClass(tgt.tier, state.realm)}">${realmOf(tgt.tier).name.toUpperCase()}</span>${info.locked ? ' <span class="mg">· LOCKED</span>' : ''}`;
      e['t-dist'].textContent = `${fmtDist(info.targetDist)}M`;
    }
    const status = [];
    if (rt.shieldT > 0) status.push(`<span class="status gold">GOLDEN BODY ${rt.shieldT.toFixed(1)}</span>`);
    if (state.devour) status.push('<span class="status mg">DEVOUR</span>');
    if (rt.invuln > 0.6) status.push('<span class="status cy">PROTECTED</span>');
    if (rt.underwater || (rt.breath !== undefined && rt.breath < 40 + info.state.realm * 25 - 0.5)) status.push(`<span class="status ${rt.breath < 10 ? 'red' : 'cy'}">BREATH ${Math.ceil(rt.breath)}s</span>`);
    e['status-row'].innerHTML = status.join('');
    const bkey = JSON.stringify(state.bounties.map((b) => [b.id, b.progress]));
    if (bkey !== this.lastBounties) {
      this.lastBounties = bkey;
      e['bounty-list'].innerHTML = state.bounties.map((b) => {
        const prog = b.type === 'cultivate' ? `${fmt(b.progress)}/${fmt(b.need)}` : `${b.progress}/${b.need}`;
        return `<div class="bounty cy"><div class="b-t">${esc(b.title)}</div><div class="b-p mono"><span>BOUNTY</span><span>${prog}</span></div><div class="b-bar"><i style="width:${(100 * b.progress) / b.need}%"></i></div></div>`;
      }).join('');
    }
    if (settings.get('showFps')) {
      e.fps.classList.remove('hidden');
      e.fps.textContent = `${Math.round(info.fps)} FPS · ${Math.round(info.renderScale * 100)}%`;
    } else {
      e.fps.classList.add('hidden');
    }
  }

  // ----------------------------------------------------------- compass --
  // heading: radians, 0 = north, clockwise positive. items: [{bearing, color}] same convention.
  drawCompass(headingRad, items) {
    const ctx = this.compassCtx;
    const w = 560, h = 44, cx = w / 2;
    const span = THREE.MathUtils.degToRad(75);
    ctx.clearRect(0, 0, w, h);
    const heading = ((THREE.MathUtils.radToDeg(headingRad) % 360) + 360) % 360;
    ctx.font = '12px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    for (let d = Math.floor(heading - 80); d <= heading + 80; d++) {
      if (d % 5 !== 0) continue;
      const x = cx + ((d - heading) / 75) * (w / 2);
      const major = d % 45 === 0;
      ctx.strokeStyle = major ? 'rgba(62,242,255,0.9)' : 'rgba(62,242,255,0.35)';
      ctx.lineWidth = major ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 14);
      ctx.lineTo(x, major ? 26 : d % 15 === 0 ? 22 : 19);
      ctx.stroke();
      if (d % 15 === 0) {
        const n = ((d % 360) + 360) % 360;
        const lbl = { 0: 'N', 90: 'E', 180: 'S', 270: 'W', 45: 'NE', 135: 'SE', 225: 'SW', 315: 'NW' }[n] ?? String(n).padStart(3, '0');
        ctx.fillStyle = major ? '#e8f4ff' : 'rgba(138,152,184,0.9)';
        ctx.fillText(lbl, x, 39);
      }
    }
    ctx.fillStyle = '#3ef2ff';
    ctx.beginPath();
    ctx.moveTo(cx - 6, 2);
    ctx.lineTo(cx + 6, 2);
    ctx.lineTo(cx, 10);
    ctx.fill();
    for (const it of items) {
      const rel = wrap(it.bearing - headingRad);
      const x = cx + (rel / span) * (w / 2);
      const clamped = Math.max(10, Math.min(w - 10, x));
      ctx.fillStyle = it.color;
      ctx.beginPath();
      ctx.moveTo(clamped, 12);
      ctx.lineTo(clamped - 5, 4);
      ctx.lineTo(clamped + 5, 4);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------- radar --
  drawRadar(dt, blips, range) {
    const ctx = this.radarCtx;
    const w = 260, h = 150, cx = w / 2, cy = h / 2 + 6, rx = 118, ry = 56;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    grad.addColorStop(0, 'rgba(62,242,255,0.12)');
    grad.addColorStop(1, 'rgba(62,242,255,0.02)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(62,242,255,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(62,242,255,0.18)';
    for (const k of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * k, ry * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy); ctx.lineTo(cx + rx, cy);
    ctx.moveTo(cx, cy - ry); ctx.lineTo(cx, cy + ry);
    ctx.stroke();
    // view cone
    ctx.fillStyle = 'rgba(62,242,255,0.07)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - rx * 0.6, cy - ry);
    ctx.lineTo(cx + rx * 0.6, cy - ry);
    ctx.closePath();
    ctx.fill();
    // sweep
    this.radarSweep = (this.radarSweep + dt * 2.2) % (Math.PI * 2);
    const sa = this.radarSweep;
    ctx.strokeStyle = 'rgba(62,242,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sa) * rx, cy + Math.sin(sa) * ry);
    ctx.stroke();

    const sorted = blips.slice().sort((a, b) => b.f - a.f);
    for (const b of sorted) {
      let fwd = b.f;
      let right = b.r;
      const dy = b.u;
      const dist = Math.hypot(fwd, right);
      let edge = false;
      if (dist > range) {
        if (!b.edge) continue;
        fwd *= range / dist;
        right *= range / dist;
        edge = true;
      }
      const x = cx + (right / range) * rx;
      const y = cy - (fwd / range) * ry;
      const up = edge ? 0 : Math.max(-1, Math.min(1, dy / range)) * ry * 1.2;
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - up);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = b.color;
      const s = b.size || 2.5;
      if (b.shape === 'diamond') {
        ctx.beginPath();
        ctx.moveTo(x, y - up - s); ctx.lineTo(x + s, y - up); ctx.lineTo(x, y - up + s); ctx.lineTo(x - s, y - up);
        ctx.fill();
      } else {
        ctx.fillRect(x - s / 2, y - up - s / 2, s, s);
      }
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx + 4, cy + 4);
    ctx.lineTo(cx - 4, cy + 4);
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------- reticle bits --
  hitmarker(kill) {
    const h = this.el.hitmark;
    h.classList.remove('show', 'kill');
    void h.offsetWidth;
    h.classList.add('show');
    if (kill) h.classList.add('kill');
  }

  placeLock(target, camera, w, h) {
    const el = this.el.lock;
    if (!target) {
      el.classList.add('hidden');
      return;
    }
    tmpV.copy(target.pos).applyMatrix4(camera.matrixWorldInverse);
    if (tmpV.z > 0) {
      el.classList.add('hidden');
      return;
    }
    const dist = -tmpV.z;
    tmpV.copy(target.pos).project(camera);
    const x = (tmpV.x * 0.5 + 0.5) * w, y = (-tmpV.y * 0.5 + 0.5) * h;
    const scale = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const size = Math.max(30, Math.min(260, (target.radius * 2.4 * scale) / dist));
    el.classList.remove('hidden');
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.transform = `translate(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px)`;
  }

  placeCtrl(point, camera, w, h, visible, time) {
    const el = this.el['ctrl-mark'];
    if (!visible) {
      el.classList.add('hidden');
      return;
    }
    tmpV.copy(point).applyMatrix4(camera.matrixWorldInverse);
    if (tmpV.z > 0) {
      el.classList.add('hidden');
      return;
    }
    tmpV.copy(point).project(camera);
    const x = (tmpV.x * 0.5 + 0.5) * w, y = (-tmpV.y * 0.5 + 0.5) * h;
    el.classList.remove('hidden');
    el.style.transform = `translate(${(x - 9).toFixed(1)}px, ${(y - 9).toFixed(1)}px) rotate(${(time * 180) % 360}deg)`;
  }

  alert(text) {
    const a = this.el.alert;
    if (!text) {
      a.classList.add('hidden');
      return;
    }
    a.textContent = text;
    a.classList.remove('hidden');
  }

  setPrompt(html, progress = 0) {
    const p = this.el.prompt;
    if (!html) {
      p.classList.add('hidden');
      return;
    }
    if (this.el['prompt-text'].innerHTML !== html) this.el['prompt-text'].innerHTML = html;
    this.el['prompt-prog'].style.strokeDashoffset = `${94.25 * (1 - progress)}`;
    p.querySelector('.prompt-ring').style.display = progress > 0 ? '' : 'none';
    p.classList.remove('hidden');
  }

  notify(text, kind = '') {
    const d = document.createElement('div');
    d.className = `feed-item ${kind}`;
    d.innerHTML = `<span class="tag">[${FEED_TAGS[kind] || 'SYS'}]</span>${text}`;
    // messages that show a key stay longest, so there's time to read the binding
    const keyHint = text.includes('<kbd>');
    if (keyHint) d.classList.add('key-hint');
    this.el.feed.appendChild(d);
    while (this.el.feed.children.length > 7) {
      const old = [...this.el.feed.children].find((c) => !c.classList.contains('key-hint')) || this.el.feed.firstChild;
      old.remove();
    }
    const life = keyHint ? 14000 : 10000;
    setTimeout(() => { d.style.opacity = '0'; d.style.transform = 'translateX(-12px)'; }, life);
    setTimeout(() => d.remove(), life + 700);
  }

  banner(kicker, title, sub, color, duration = 3.6, small = false) {
    const b = this.el.banner;
    b.classList.add('hidden');
    b.classList.toggle('small', small);
    void b.offsetWidth;
    b.querySelector('.b-kicker').textContent = kicker || '';
    b.querySelector('.b-title').textContent = title;
    b.querySelector('.b-sub').innerHTML = sub || '';
    b.querySelector('.b-title').style.color = color || '';
    b.classList.remove('hidden');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.add('hidden'), duration * 1000);
  }

  hideBanner() {
    this.el.banner.classList.add('hidden');
  }

  // ----------------------------------------------------------- markers --
  updateMarkers(items, camera, w, h) {
    const used = new Set();
    const margin = 44;
    for (const it of items) {
      tmpV.copy(it.pos).applyMatrix4(camera.matrixWorldInverse);
      const behind = tmpV.z > 0;
      tmpV.copy(it.pos).project(camera);
      let x = (tmpV.x * 0.5 + 0.5) * w;
      let y = (-tmpV.y * 0.5 + 0.5) * h;
      const onScreen = !behind && x > margin && x < w - margin && y > margin && y < h - margin;
      if (!onScreen && !it.edge) continue;
      let edge = false, angle = 0;
      if (!onScreen) {
        edge = true;
        let dx = x - w / 2, dy = y - h / 2;
        if (behind) { dx = -dx; dy = -dy; }
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) dy = 1;
        const s = Math.min((w / 2 - margin) / Math.abs(dx), (h / 2 - margin) / Math.abs(dy));
        x = w / 2 + dx * s;
        y = h / 2 + dy * s;
        angle = Math.atan2(dy, dx) + Math.PI / 2;
      }
      used.add(it.key);
      let m = this.markerEls.get(it.key);
      if (!m) {
        const el = document.createElement('div');
        el.innerHTML = '<div class="mk-arrow"></div><div class="mk-dot"></div><div class="mk-label"></div><div class="mk-sub"></div><div class="mk-hp"><i></i></div>';
        this.el.markers.appendChild(el);
        m = { el, arrow: el.children[0], label: el.children[2], sub: el.children[3], hp: el.children[4], hpFill: el.children[4].firstChild, cls: '', text: '', subText: '', hpShown: null };
        this.markerEls.set(it.key, m);
      }
      const cls = `mk ${it.kind}${edge ? ' edge' : ''}${it.nav ? ' nav' : ''}`;
      if (m.cls !== cls) { m.el.className = cls; m.cls = cls; }
      if (m.text !== it.label) { m.label.innerHTML = it.label; m.text = it.label; }
      const sub = it.sub !== undefined ? it.sub : fmtDist(it.dist);
      if (m.subText !== sub) { m.sub.textContent = sub; m.subText = sub; }
      const showHp = it.hp !== undefined;
      if (showHp !== m.hpShown) { m.hp.style.display = showHp ? '' : 'none'; m.hpShown = showHp; }
      if (showHp) m.hpFill.style.width = `${Math.max(0, it.hp) * 100}%`;
      m.el.style.display = '';
      m.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -6px)`;
      m.arrow.style.transform = edge ? `rotate(${angle}rad)` : '';
    }
    for (const [key, m] of this.markerEls) {
      if (used.has(key)) continue;
      if (key.startsWith('b:')) {
        m.el.remove();
        this.markerEls.delete(key);
      } else if (m.el.style.display !== 'none') {
        m.el.style.display = 'none';
      }
    }
  }

  clearMarkers() {
    for (const m of this.markerEls.values()) m.el.remove();
    this.markerEls.clear();
  }

  damageNumber(pos, text, kind = '') {
    if (!settings.get('damageNumbers') && kind !== 'xp' && kind !== 'player') return;
    let d = this.dmgPool.pop();
    if (!d) {
      const el = document.createElement('div');
      this.el['dmg-layer'].appendChild(el);
      d = { el, pos: new THREE.Vector3() };
    }
    d.el.className = `dmg ${kind}`;
    d.el.textContent = text;
    d.el.style.display = '';
    d.pos.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3));
    d.t = 0;
    d.life = kind === 'xp' ? 1.4 : 0.85;
    d.rise = kind === 'xp' ? 6 : 10;
    this.dmgActive.push(d);
    if (this.dmgActive.length > 48) this.recycleDmg(0);
  }

  recycleDmg(i) {
    const d = this.dmgActive[i];
    d.el.style.display = 'none';
    this.dmgActive.splice(i, 1);
    this.dmgPool.push(d);
  }

  updateDamageNumbers(dt, camera, w, h) {
    for (let i = this.dmgActive.length - 1; i >= 0; i--) {
      const d = this.dmgActive[i];
      d.t += dt;
      if (d.t >= d.life) { this.recycleDmg(i); continue; }
      d.pos.y += d.rise * dt;
      tmpV.copy(d.pos).applyMatrix4(camera.matrixWorldInverse);
      if (tmpV.z > 0) { d.el.style.opacity = 0; continue; }
      tmpV.copy(d.pos).project(camera);
      const x = (tmpV.x * 0.5 + 0.5) * w, y = (-tmpV.y * 0.5 + 0.5) * h;
      const f = d.t / d.life;
      d.el.style.opacity = f < 0.7 ? 1 : 1 - (f - 0.7) / 0.3;
      d.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${f < 0.12 ? 1.5 - f * 4 : 1})`;
    }
  }

  clearDamageNumbers() {
    while (this.dmgActive.length) this.recycleDmg(0);
  }
}
