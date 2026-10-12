import * as THREE from 'three';
import {
  REALMS, STAGES, MAX_REALM, TECHNIQUES, ACTIVE_TECHNIQUES, PILLS, GALAXIES, BOSSES, STAR_TYPES,
  getGalaxySystems, priceFor, MANUAL_PRICE, realmOf, masteryMult,
} from './data.js';

export function fmt(n) {
  n = Math.max(0, n);
  if (n < 1000) return Math.round(n).toString();
  const units = ['k', 'M', 'B', 'T'];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return `${n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n)}${units[u]}`;
}
const fmtDist = (d) => (d >= 1000 ? `${(d / 1000).toFixed(1)}k` : `${Math.round(d)}`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// Danger of a tier relative to the player's realm.
export function dangerClass(tier, realm) {
  const diff = tier - realm;
  if (diff <= 0.25) return 'danger-ok';
  if (diff <= 1.01) return 'danger-warn';
  return 'danger-bad';
}

const tmpV = new THREE.Vector3();

export class UI {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.el = {
      hud: $('hud'), realmName: $('realm-name'), realmCn: $('realm-cn'), stage: $('stage-name'),
      xpFill: $('xp-fill'), xpText: $('xp-text'), hpFill: $('hp-fill'), hpText: $('hp-text'), enFill: $('en-fill'), enText: $('en-text'),
      btReady: $('bt-ready'), locGalaxy: $('loc-galaxy'), locSystem: $('loc-system'), locDanger: $('loc-danger'), density: $('density'), coins: $('coins'),
      bossBar: $('boss-bar'), bossName: $('boss-name'), bossFill: $('boss-fill'), tribBar: $('trib-bar'), tribFill: $('trib-fill'),
      crosshair: $('crosshair'), markers: $('markers'), dmg: $('dmg-layer'), feed: $('feed'), prompt: $('prompt'), nav: $('nav-info'),
      meditate: $('meditate'), medRate: $('med-rate'), skills: $('skills'), banner: $('banner'), fade: $('fade'), vignette: $('vignette'),
      title: $('title-screen'), pause: $('pause-screen'), death: $('death-screen'), deathText: $('death-text'), deathCount: $('death-count'),
      panel: $('panel'), panelTabs: $('panel-tabs'), panelBody: $('panel-body'),
    };
    this.markerEls = new Map();
    this.dmgPool = [];
    this.dmgActive = [];
    this.panelKind = null;
    this.panelTab = null;
    this.selectedSystem = null;
    this.textTimer = 0;
    this.bannerTimer = null;
    this.buildSkillBar();
    this.buildTitleRealms();
    this.bind();
  }

  get panelOpen() {
    return this.panelKind !== null;
  }

  bind() {
    const g = this.game;
    this.$('btn-new').addEventListener('click', () => {
      if (g.hasSave && !confirm('Start over? Your current cultivation progress will be lost.')) return;
      g.newGame();
    });
    this.$('btn-continue').addEventListener('click', () => g.continueGame());
    this.$('btn-resume').addEventListener('click', () => g.resume());
    this.$('btn-help').addEventListener('click', () => this.openPanel('help'));
    this.$('btn-mute').addEventListener('click', (e) => {
      const muted = g.sound.toggleMute();
      e.currentTarget.textContent = `Sound: ${muted ? 'off' : 'on'}`;
    });
    this.$('btn-reset').addEventListener('click', () => {
      if (confirm('Erase all progress and return to the title screen?')) g.resetSave();
    });
    this.$('panel-close').addEventListener('click', () => g.closePanel());
    this.el.panelTabs.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (!t) return;
      this.game.sound.ui();
      this.openPanel(t.dataset.kind, t.dataset.tab);
    });
    this.el.panelBody.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a || a.disabled) return;
      const { action } = a.dataset;
      if (action === 'select-system') {
        this.selectedSystem = Number(a.dataset.index);
        this.game.sound.ui();
        this.render();
      } else if (action === 'warp') {
        g.requestWarp(Number(a.dataset.galaxy), Number(a.dataset.index));
      } else if (action === 'buy') {
        g.buy(a.dataset.item, a.dataset.tech);
        this.render();
      } else if (action === 'tab') {
        this.openPanel(a.dataset.kind, a.dataset.tab);
      }
    });
  }

  buildTitleRealms() {
    this.$('title-realms').innerHTML = REALMS.map((r) => `<span>${esc(r.name)}<span class="cn">${r.cn}</span></span>`).join('');
  }

  buildSkillBar() {
    const slots = [
      ...ACTIVE_TECHNIQUES.map((k) => ({ id: k, key: TECHNIQUES[k].key, name: TECHNIQUES[k].name, cn: TECHNIQUES[k].cn })),
      { sep: true },
      { id: 'meditate', key: 'C', name: 'Cultivate', cn: '修炼' },
      { id: 'breakthrough', key: 'B', name: 'Break-through', cn: '突破' },
      { sep: true },
      ...Object.entries(PILLS).map(([k, p]) => ({ id: `pill-${k}`, key: p.key, name: p.name.split(' ')[0], cn: p.cn, pill: k })),
    ];
    this.skillEls = {};
    this.el.skills.innerHTML = '';
    for (const s of slots) {
      if (s.sep) {
        const d = document.createElement('div');
        d.className = 'skill-sep';
        this.el.skills.appendChild(d);
        continue;
      }
      const d = document.createElement('div');
      d.className = 'skill';
      d.innerHTML = `<div class="s-cd"></div><span class="s-key">${s.key}</span><span class="s-cn">${s.cn}</span><span class="s-name">${esc(s.name)}</span>${s.pill ? '<span class="s-count"></span>' : ''}`;
      this.el.skills.appendChild(d);
      this.skillEls[s.id] = { el: d, cd: d.querySelector('.s-cd'), count: d.querySelector('.s-count') };
    }
  }

  // ------------------------------------------------------------- HUD --
  updateHUD(dt, info) {
    const { state, stats, rt } = info;
    const e = this.el;
    e.hpFill.style.width = `${(100 * rt.hp) / stats.maxHp}%`;
    e.enFill.style.width = `${(100 * rt.energy) / stats.maxEnergy}%`;
    e.xpFill.style.width = `${Math.min(100, (100 * state.xp) / stats.xpNeed)}%`;
    e.vignette.style.opacity = rt.hurtFlash > 0 ? Math.min(1, rt.hurtFlash * 2.5) : rt.hp / stats.maxHp < 0.25 ? 0.35 : 0;

    // skills
    for (const k of ACTIVE_TECHNIQUES) {
      const s = this.skillEls[k];
      const t = TECHNIQUES[k];
      const unlocked = state.realm >= t.unlockRealm;
      s.el.classList.toggle('locked', !unlocked);
      s.el.classList.toggle('low', unlocked && rt.energy < t.cost);
      s.el.classList.toggle('active', k === 'body' && rt.shieldT > 0);
      const cd = rt.cooldowns[k] || 0;
      s.cd.style.transform = `scaleY(${unlocked ? Math.min(1, cd / t.cd) : 0})`;
    }
    this.skillEls.meditate.el.classList.toggle('active', rt.meditating);
    this.skillEls.breakthrough.el.classList.toggle('active', info.breakthroughReady);
    this.skillEls.breakthrough.el.classList.toggle('locked', !info.breakthroughReady);
    for (const k of Object.keys(PILLS)) {
      const s = this.skillEls[`pill-${k}`];
      s.count.textContent = state.pills[k];
      s.el.classList.toggle('locked', state.pills[k] <= 0);
    }

    e.meditate.classList.toggle('hidden', !rt.meditating);
    e.hud.classList.toggle('trib', !!rt.trib);
    e.crosshair.classList.toggle('on-target', !!info.aimTarget);
    if (info.boss && info.boss.aggro) {
      e.bossBar.classList.remove('hidden');
      e.bossName.innerHTML = `${esc(info.boss.name)}<span class="cn">${info.boss.cn}</span>`;
      e.bossFill.style.width = `${(100 * Math.max(0, info.boss.hp)) / info.boss.maxHp}%`;
    } else {
      e.bossBar.classList.add('hidden');
    }
    if (rt.trib) {
      e.tribBar.classList.remove('hidden');
      e.tribFill.style.width = `${100 * (1 - rt.trib.t / rt.trib.dur)}%`;
    } else {
      e.tribBar.classList.add('hidden');
    }

    this.textTimer -= dt;
    if (this.textTimer > 0) return;
    this.textTimer = 0.15;
    const realm = REALMS[state.realm];
    e.realmName.textContent = realm.name;
    e.realmName.style.color = hex(realm.color);
    e.realmCn.textContent = realm.cn;
    e.stage.textContent = `${STAGES[state.stage].name} stage · ${STAGES[state.stage].cn}`;
    e.hpText.textContent = `${fmt(rt.hp)} / ${fmt(stats.maxHp)}`;
    e.enText.textContent = `${Math.floor(rt.energy)} / ${stats.maxEnergy}`;
    e.xpText.textContent = state.realm >= MAX_REALM && state.stage === 3 ? 'Summit reached' : `${fmt(state.xp)} / ${fmt(stats.xpNeed)}`;
    e.btReady.classList.toggle('hidden', !info.breakthroughReady);
    if (info.breakthroughBlocked) {
      e.btReady.classList.remove('hidden');
      e.btReady.textContent = info.breakthroughBlocked;
    } else {
      e.btReady.innerHTML = 'Breakthrough ready: press <kbd>B</kbd>';
    }
    const g = GALAXIES[state.galaxy];
    const sys = info.systemDef;
    e.locGalaxy.innerHTML = `${esc(g.name)} <span class="cn">${g.cn}</span>`;
    e.locSystem.textContent = `${sys.name} system`;
    e.locDanger.innerHTML = `Danger: <span class="${dangerClass(sys.tier, state.realm)}">${realmOf(sys.tier).name}</span>`;
    e.density.innerHTML = `Cosmic energy ×${info.density.toFixed(1)}`;
    e.coins.innerHTML = `<b>${fmt(state.coins)}</b> star coins`;
    e.medRate.textContent = `+${fmt(info.medRate)}/s`;
    if (info.nav) {
      e.nav.classList.remove('hidden');
      e.nav.textContent = `${info.cruise ? 'Cruising to' : 'Course set:'} ${info.nav.label} · ${fmtDist(info.navDist)}${info.cruise ? '' : '  (G to cruise)'}`;
    } else {
      e.nav.classList.add('hidden');
    }
  }

  setPrompt(html) {
    if (!html) {
      this.el.prompt.classList.add('hidden');
      return;
    }
    if (this.el.prompt.innerHTML !== html) this.el.prompt.innerHTML = html;
    this.el.prompt.classList.remove('hidden');
  }

  notify(text, kind = '') {
    const d = document.createElement('div');
    d.className = `feed-item ${kind}`;
    d.innerHTML = text;
    this.el.feed.appendChild(d);
    while (this.el.feed.children.length > 6) this.el.feed.firstChild.remove();
    setTimeout(() => { d.style.opacity = '0'; }, 5500);
    setTimeout(() => d.remove(), 6200);
  }

  banner(title, sub, color, duration = 3.4) {
    const b = this.el.banner;
    b.classList.add('hidden');
    void b.offsetWidth;
    b.querySelector('.b-title').textContent = title;
    b.querySelector('.b-sub').innerHTML = sub || '';
    b.querySelector('.b-title').style.color = color || '';
    b.classList.remove('hidden');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.add('hidden'), duration * 1000);
  }

  setFade(a) {
    this.el.fade.style.opacity = a;
  }

  // --------------------------------------------------------- markers --
  updateMarkers(items, camera, w, h) {
    const used = new Set();
    const margin = 40;
    for (const it of items) {
      tmpV.copy(it.pos).applyMatrix4(camera.matrixWorldInverse);
      const behind = tmpV.z > 0;
      const dist = it.dist;
      tmpV.copy(it.pos).project(camera);
      let x = (tmpV.x * 0.5 + 0.5) * w;
      let y = (-tmpV.y * 0.5 + 0.5) * h;
      const onScreen = !behind && x > margin && x < w - margin && y > margin && y < h - margin;
      if (!onScreen && !it.edge) continue;
      let edge = false;
      let angle = 0;
      if (!onScreen) {
        edge = true;
        let dx = x - w / 2, dy = y - h / 2;
        if (behind) { dx = -dx; dy = -dy; }
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) dy = 1;
        const sx = (w / 2 - margin) / Math.abs(dx), sy = (h / 2 - margin) / Math.abs(dy);
        const s = Math.min(sx, sy);
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
        m = { el, arrow: el.children[0], label: el.children[2], sub: el.children[3], hp: el.children[4], hpFill: el.children[4].firstChild, cls: '', text: '', subText: '' };
        this.markerEls.set(it.key, m);
      }
      const cls = `mk ${it.kind}${edge ? ' edge' : ''}${it.nav ? ' nav' : ''}`;
      if (m.cls !== cls) { m.el.className = cls; m.cls = cls; }
      if (m.text !== it.label) { m.label.innerHTML = it.label; m.text = it.label; }
      const sub = it.sub !== undefined ? it.sub : fmtDist(dist);
      if (m.subText !== sub) { m.sub.textContent = sub; m.subText = sub; }
      if (it.hp !== undefined) {
        m.hp.style.display = '';
        m.hpFill.style.width = `${Math.max(0, it.hp) * 100}%`;
      } else {
        m.hp.style.display = 'none';
      }
      m.el.style.display = '';
      m.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      m.arrow.style.transform = edge ? `rotate(${angle}rad)` : '';
    }
    for (const [key, m] of this.markerEls) {
      if (!used.has(key)) {
        if (key.startsWith('b:')) {
          m.el.remove();
          this.markerEls.delete(key);
        } else {
          m.el.style.display = 'none';
        }
      }
    }
  }

  clearMarkers() {
    for (const m of this.markerEls.values()) m.el.remove();
    this.markerEls.clear();
  }

  // -------------------------------------------------- damage numbers --
  damageNumber(pos, text, kind = '') {
    let d = this.dmgPool.pop();
    if (!d) {
      const el = document.createElement('div');
      this.el.dmg.appendChild(el);
      d = { el, pos: new THREE.Vector3() };
    }
    d.el.className = `dmg ${kind}`;
    d.el.textContent = text;
    d.el.style.display = '';
    d.pos.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3));
    d.t = 0;
    d.life = kind === 'xp' ? 1.4 : 0.9;
    d.rise = kind === 'xp' ? 6 : 10;
    this.dmgActive.push(d);
    if (this.dmgActive.length > 40) this.recycleDmg(0);
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
      d.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${f < 0.15 ? 0.7 + f * 2 : 1})`;
    }
  }

  // --------------------------------------------------------- screens --
  showHUD(v) { this.el.hud.classList.toggle('hidden', !v); }
  showTitle(v, hasSave) {
    this.el.title.classList.toggle('hidden', !v);
    this.$('btn-continue').classList.toggle('hidden', !hasSave);
    this.$('btn-new').classList.toggle('primary', !hasSave);
  }
  showPause(v) { this.el.pause.classList.toggle('hidden', !v); }
  showDeath(v, text) {
    this.el.death.classList.toggle('hidden', !v);
    if (text) this.el.deathText.textContent = text;
  }
  setDeathCount(text) { this.el.deathCount.textContent = text; }

  // ---------------------------------------------------------- panels --
  openPanel(kind, tab) {
    this.panelKind = kind;
    this.panelTab = tab || (kind === 'map' ? 'galaxy' : null);
    if (kind === 'map' && this.selectedSystem === null) this.selectedSystem = this.game.state.system;
    this.el.panel.classList.remove('hidden');
    this.el.pause.classList.add('hidden');
    this.render();
  }

  closePanel() {
    this.panelKind = null;
    this.el.panel.classList.add('hidden');
  }

  render() {
    const k = this.panelKind;
    if (!k) return;
    const tabs = [
      ['map', 'galaxy', 'Galaxy map'],
      ['map', 'universe', 'Universe'],
      ['cultivation', null, 'Cultivation'],
      ...(this.game.atStation ? [['shop', null, 'Station']] : []),
      ['help', null, 'Guide'],
    ];
    this.el.panelTabs.innerHTML = tabs
      .map(([kind, tab, label]) => `<button class="tab ${kind === k && (tab === null || tab === this.panelTab) ? 'on' : ''}" data-kind="${kind}" data-tab="${tab || ''}">${label}</button>`)
      .join('');
    let html = '';
    if (k === 'map') html = this.panelTab === 'universe' ? this.renderUniverse() : this.renderGalaxy();
    else if (k === 'cultivation') html = this.renderCultivation();
    else if (k === 'shop') html = this.renderShop();
    else if (k === 'help') html = this.renderHelp();
    this.el.panelBody.innerHTML = html;
  }

  renderGalaxy() {
    const { state } = this.game;
    const systems = getGalaxySystems(state.galaxy);
    const g = GALAXIES[state.galaxy];
    const sel = systems[this.selectedSystem] || systems[state.system];
    let lines = '';
    for (let i = 1; i < systems.length; i++) {
      const a = systems[i - 1], b = systems[i];
      lines += `<line x1="${a.mapX}" y1="${a.mapY * 0.7}" x2="${b.mapX}" y2="${b.mapY * 0.7}" stroke="rgba(160,190,255,0.3)" stroke-width="0.35" stroke-dasharray="1.2 1"/>`;
    }
    const nodes = systems.map((s) => {
      const star = STAR_TYPES[s.starType];
      const cls = dangerClass(s.tier, state.realm);
      const color = cls === 'danger-ok' ? '#6dffb0' : cls === 'danger-warn' ? '#ffd166' : '#ff5a6e';
      const here = s.index === state.system;
      const y = s.mapY * 0.7;
      const icons = [s.boss !== null ? (state.bosses.includes(s.boss) ? '✓' : '☠') : '', s.station ? '⌂' : '', s.gate ? '◎' : ''].filter(Boolean).join(' ');
      return `<g class="node" data-action="select-system" data-index="${s.index}">
        <circle cx="${s.mapX}" cy="${y}" r="5" fill="${hex(star.glow)}" opacity="0.18"/>
        ${here ? `<circle class="here" cx="${s.mapX}" cy="${y}" r="3.8" fill="none" stroke="#f3cf7a" stroke-width="0.5"/>` : ''}
        <circle class="core" cx="${s.mapX}" cy="${y}" r="2.2" fill="${hex(star.core)}" stroke="${s.index === sel.index ? '#fff' : color}" stroke-width="${s.index === sel.index ? 0.7 : 0.45}"/>
        <text x="${s.mapX}" y="${y + 6.2}" text-anchor="middle" font-size="2.6" fill="#e9ecf8">${esc(s.name)}</text>
        <text x="${s.mapX}" y="${y + 9.2}" text-anchor="middle" font-size="2" fill="${color}">${esc(realmOf(s.tier).name)} ${icons}</text>
      </g>`;
    }).join('');
    const svg = `<svg class="map-svg" viewBox="0 0 100 70">${lines}${nodes}</svg>`;

    const check = this.game.canWarpTo(state.galaxy, sel.index);
    const bossDone = sel.boss !== null && state.bosses.includes(sel.boss);
    const card = `<div class="sys-card">
      <h3>${esc(sel.name)}</h3>
      <div class="misc-line">${STAR_TYPES[sel.starType].label}</div>
      <div class="tags">
        ${sel.station ? '<span class="tag station">Station · shop &amp; rest</span>' : ''}
        ${sel.gate ? '<span class="tag gate">Universe Gate</span>' : ''}
        ${sel.boss !== null ? `<span class="tag ${bossDone ? 'done' : 'boss'}">${bossDone ? 'Slain: ' : 'Overlord: '}${esc(BOSSES[sel.boss].name)}</span>` : ''}
      </div>
      <div class="row"><span>Danger</span><span class="${dangerClass(sel.tier, state.realm)}">${esc(realmOf(sel.tier).name)} ${REALMS[Math.floor(sel.tier)].cn}</span></div>
      <div class="row"><span>Cultivation speed</span><span>×${(() => { const r = Math.pow(3, sel.tier - state.realm); return r >= 10 ? Math.round(r) : r.toFixed(r < 1 ? 2 : 1); })()} vs. your realm</span></div>
      <div class="row"><span>Beasts</span><span>${sel.tier >= 2 ? 'Mites, Rays, Rockbacks, Wraiths' : sel.tier >= 1 ? 'Mites, Rays, Rockbacks' : 'Mites, Rays'}</span></div>
      ${sel.index === state.system ? '<div class="misc-line" style="margin-top:10px">You are here.</div>' : `<button class="btn primary" data-action="warp" data-galaxy="${state.galaxy}" data-index="${sel.index}" ${check.ok ? '' : 'disabled'}>Warp to ${esc(sel.name)}</button>`}
      ${!check.ok && sel.index !== state.system ? `<div class="why">${esc(check.reason)}</div>` : ''}
    </div>`;
    return `<p class="panel-note">${esc(g.name)} <span class="cn">${g.cn}</span>. ${esc(g.desc)} Green systems match your realm, yellow ones are a step above, red ones are too dangerous to reach yet.</p><div class="map-wrap">${svg}${card}</div>`;
  }

  renderUniverse() {
    const { state } = this.game;
    const atGate = this.game.atGate;
    const cards = GALAXIES.map((g, i) => {
      const check = this.game.canTravelGalaxy(i);
      const boss = BOSSES[g.boss];
      const slain = state.bosses.includes(g.boss);
      const tiers = `${realmOf(g.tiers[0]).name} to ${realmOf(g.tiers[g.tiers.length - 1]).name}`;
      return `<div class="galaxy-card ${i === state.galaxy ? 'current' : ''}" style="--gc:${g.sky[0]}">
        <h3>${esc(g.name)} <span class="cn">${g.cn}</span></h3>
        <p>${esc(g.desc)}</p>
        <div class="meta">Requires: <span class="${state.realm >= g.reqRealm ? 'danger-ok' : 'danger-bad'}">${esc(REALMS[g.reqRealm].name)} realm</span></div>
        <div class="meta">Danger: ${esc(tiers)}</div>
        <div class="meta">Overlord: <span class="${slain ? 'danger-ok' : 'danger-bad'}">${esc(boss.name)} ${boss.cn}${slain ? ' (slain)' : ''}</span></div>
        ${i === state.galaxy ? '<div class="misc-line" style="margin-top:10px">You are in this galaxy.</div>' : `<button class="btn ${check.ok ? 'primary' : ''}" data-action="warp" data-galaxy="${i}" data-index="0" ${check.ok ? '' : 'disabled'}>${check.ok ? 'Travel through the gate' : esc(check.reason)}</button>`}
      </div>`;
    }).join('');
    return `<p class="panel-note">${atGate ? 'The Universe Gate hums before you. Choose a destination.' : 'Crossing between galaxies requires a Universe Gate. Every galaxy keeps one in its first system, next to the station.'}</p><div class="galaxy-grid">${cards}</div>`;
  }

  renderCultivation() {
    const { state } = this.game;
    const stats = this.game.stats;
    const ladder = REALMS.map((r, i) => `<div class="rung ${i < state.realm ? 'done' : i === state.realm ? 'current' : ''}"><span>${i < state.realm ? '✓ ' : ''}${esc(r.name)}</span><span class="cn">${r.cn}</span></div>`).join('');
    const techs = Object.entries(TECHNIQUES).map(([k, t]) => {
      const unlocked = k === 'devour' ? state.devour : state.realm >= t.unlockRealm;
      const m = state.mastery[k];
      const pips = m ? `<div class="pips">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= m ? 'on' : ''}"></i>`).join('')}</div>` : '';
      const lock = k === 'devour' ? (unlocked ? '' : 'Hidden in an ancient ruin.') : unlocked ? '' : `Unlocks at ${REALMS[t.unlockRealm].name}.`;
      return `<div class="tech ${unlocked ? '' : 'locked'}"><h4><span>${esc(t.name)} <span class="cn">${t.cn}</span></span><span>${t.key === 'passive' ? 'Passive' : `<kbd>${t.key}</kbd>`}</span></h4><p>${esc(t.desc)} ${lock ? `<b>${esc(lock)}</b>` : ''}</p>${pips}</div>`;
    }).join('');
    const r = REALMS[state.realm];
    const mins = Math.floor(state.playtime / 60);
    return `<div class="cult-wrap">
      <div><div class="section-title" style="margin-top:0">Path of cultivation</div><div class="ladder">${ladder}</div></div>
      <div>
        <div class="section-title" style="margin-top:0">${esc(r.name)} · ${STAGES[state.stage].name} <span class="cn">${r.cn}${STAGES[state.stage].cn}</span></div>
        <p class="panel-note">${esc(r.blurb)}</p>
        <div class="stat-grid">
          <div class="stat"><div class="k">Life</div><div class="v">${fmt(stats.maxHp)}</div></div>
          <div class="stat"><div class="k">Attack</div><div class="v">${fmt(stats.atk * masteryMult(state.mastery.bolt))}</div></div>
          <div class="stat"><div class="k">Energy</div><div class="v">${stats.maxEnergy}</div></div>
          <div class="stat"><div class="k">Speed</div><div class="v">${Math.round(stats.speed)}</div></div>
        </div>
        <div class="section-title">Techniques</div>
        <div class="tech-list">${techs}</div>
        <div class="section-title">Record</div>
        <div class="misc-line">Beasts slain: <b>${state.kills}</b></div>
        <div class="misc-line">Overlords slain: <b>${state.bosses.length} / ${BOSSES.length}</b> (each grants +10% life and attack)</div>
        <div class="misc-line">Worlds explored: <b>${state.explored.length}</b></div>
        <div class="misc-line">Time cultivating: <b>${Math.floor(mins / 60)}h ${mins % 60}m</b></div>
      </div>
    </div>`;
  }

  renderShop() {
    const { state } = this.game;
    const pills = Object.entries(PILLS).map(([k, p]) => {
      const price = priceFor(p.price, state.realm);
      return `<div class="shop-item"><div><h4>${esc(p.name)}<span class="cn">${p.cn}</span></h4><p>${esc(p.desc)} Owned: ${state.pills[k]}. Use with <kbd>${p.key}</kbd>.</p></div><span class="price">${fmt(price)} ◈</span><button class="btn small" data-action="buy" data-item="${k}" ${state.coins >= price ? '' : 'disabled'}>Buy</button></div>`;
    }).join('');
    const manuals = ACTIVE_TECHNIQUES.filter((k) => state.realm >= TECHNIQUES[k].unlockRealm).map((k) => {
      const t = TECHNIQUES[k];
      const m = state.mastery[k];
      const price = priceFor(MANUAL_PRICE * m, state.realm);
      const maxed = m >= 5;
      return `<div class="shop-item"><div><h4>Manual: ${esc(t.name)}<span class="cn">${t.cn}秘籍</span></h4><p>Raise mastery ${m} to ${Math.min(5, m + 1)}: +25% power.</p></div><span class="price">${maxed ? 'Mastered' : `${fmt(price)} ◈`}</span><button class="btn small" data-action="buy" data-item="manual" data-tech="${k}" ${!maxed && state.coins >= price ? '' : 'disabled'}>Buy</button></div>`;
    }).join('');
    return `<p class="panel-note">Docked at the station. Your life and energy have been restored. You hold <b style="color:var(--gold)">${fmt(state.coins)} ◈</b> star coins.</p>
      <div class="section-title" style="margin-top:0">Pills and elixirs</div><div class="shop-list">${pills}</div>
      <div class="section-title">Technique manuals</div><div class="shop-list">${manuals}</div>`;
  }

  renderHelp() {
    const rows = [
      ['Steer', 'Mouse'], ['Fly', 'W A S D'], ['Rise / sink', 'Space / X'], ['Boost (uses energy)', 'Shift'],
      ['Star Bolt', 'Left click (hold)'], ['Flying Swords', 'Q'], ['Domain Burst', 'R'], ['Golden Body', 'F'],
      ['Cultivate (hold still)', 'C (hold)'], ['Break through at Peak', 'B'], ['Explore world / dock / gate', 'E'],
      ['Pills', '1 2 3'], ['Set course to marker near crosshair', 'T'], ['Cruise to course', 'G'],
      ['Camera zoom', 'Mouse wheel'], ['Star map', 'M'], ['Cultivation', 'K'], ['Mute', 'N'], ['Pause', 'Esc'],
    ];
    return `<div class="help-grid">${rows.map(([a, b]) => `<div><span>${esc(a)}</span><span><b>${esc(b)}</b></span></div>`).join('')}</div>
      <div class="section-title">How to ascend</div>
      <ul class="tips">
        <li><b>Cultivate</b> by holding C. Energy is richest near stars and inside glowing energy nebulae, and richer still in dangerous systems.</li>
        <li><b>Hunt beasts</b> for experience and star coins. Beasts far below your realm teach you little.</li>
        <li><b>Explore planets</b> with E. You may find energy crystals, coins, pills, technique manuals or a nest of angry beasts. Planets marked with ruins hold inheritances.</li>
        <li>Fill your experience to <b>Peak</b> stage, then press B to face the <b>Heavenly Tribulation</b>. Dodge the red markers to survive and enter the next realm.</li>
        <li>Use the <b>star map</b> (M) to warp between systems. Use the <b>Universe Gate</b> beside each galaxy's station to cross to new galaxies once your realm allows.</li>
        <li>Each galaxy is ruled by an <b>Overlord</b>. Slaying one permanently strengthens you. The last one guards the path to Universe Master.</li>
        <li>Dock at a <b>station</b> (E) to fully heal and buy pills and technique manuals.</li>
      </ul>`;
  }
}
