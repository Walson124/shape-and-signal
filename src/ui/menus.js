import {
  REALMS, STAGES, TECHNIQUES, ACTIVE_TECHNIQUES, PILLS, GALAXIES, BOSSES, STAR_TYPES, SWORD_GRADES, TIPS,
  getGalaxySystems, priceFor, MANUAL_PRICE, realmOf, masteryMult, swordCount,
} from '../game/data.js';
import { MAX_BOUNTIES } from '../game/missions.js';
import { settings, PRESETS } from '../core/settings.js';
import { fmt, esc, hex, dangerClass } from './hud.js';

const CONTROLS = [
  ['Look / steer', 'Mouse'], ['Fly', 'W A S D'], ['Rise / sink', 'Space / X'], ['Boost', 'Shift'],
  ['Star Bolt', 'Left mouse (hold)'], ['Steer flying swords', 'Right mouse (hold)'], ['Sword control distance', 'Mouse wheel while steering'],
  ['Loose swords at targets', 'Q'], ['Sword formation', 'Z'], ['Domain Burst', 'R'], ['Golden Body', 'F'], ['Ten Thousand Swords', 'V'],
  ['Lock / cycle target', 'Tab'], ['Cultivate', 'C (hold)'], ['Breakthrough', 'B'], ['Interact / scan planet', 'E (hold to scan)'],
  ['Pills', '1 2 3'], ['Set course / cruise', 'T / G'], ['Toggle first / third person', 'P'], ['Star map', 'M'],
  ['Cultivation', 'K'], ['Bounties', 'J'], ['Guide', 'H'], ['Mute', 'N'], ['Pause', 'Esc'],
];

export class Menus {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.panelKind = null;
    this.panelTab = null;
    this.selectedSystem = null;
    this.settingsTab = 'graphics';
    this.settingsReturn = null;
    this.modalResolve = null;
    this.tipTimer = null;
    this.bind();
  }

  get panelOpen() {
    return this.panelKind !== null;
  }

  get overlayOpen() {
    return this.panelOpen || !this.$('settings').classList.contains('hidden') || !this.$('modal').classList.contains('hidden');
  }

  bind() {
    const g = this.game;
    const snd = () => g.sound;
    document.addEventListener('mouseover', (e) => {
      if (e.target.closest && e.target.closest('.menu-item, .btn, .tab, .seg button')) snd().hover();
    });
    this.$('title-menu').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      snd().init();
      snd().confirm();
      const act = b.dataset.act;
      if (act === 'continue') g.continueGame();
      else if (act === 'new') g.requestNewGame();
      else if (act === 'settings') this.openSettings('title');
      else if (act === 'controls') this.showControls();
      else if (act === 'credits') this.showCredits();
    });
    this.$('pause').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      snd().confirm();
      const act = b.dataset.act;
      if (act === 'resume') g.resume();
      else if (act === 'settings') this.openSettings('pause');
      else if (act === 'controls') this.showControls();
      else if (act === 'quit') g.quitToTitle();
    });
    this.$('panel-close').addEventListener('click', () => g.closePanel());
    this.$('panel-tabs').addEventListener('click', (e) => {
      const t = e.target.closest('[data-kind]');
      if (!t) return;
      snd().ui();
      this.openPanel(t.dataset.kind, t.dataset.tab || null);
    });
    this.$('panel-body').addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a || a.disabled) return;
      const { action } = a.dataset;
      if (action === 'select-system') {
        this.selectedSystem = Number(a.dataset.index);
        snd().ui();
        this.render();
      } else if (action === 'warp') {
        g.requestWarp(Number(a.dataset.galaxy), Number(a.dataset.index));
      } else if (action === 'buy') {
        g.buy(a.dataset.item, a.dataset.tech);
        this.render();
      } else if (action === 'forge') {
        g.forge();
        this.render();
      } else if (action === 'refine') {
        g.refine(Number(a.dataset.frac));
        this.render();
      } else if (action === 'accept') {
        g.acceptBounty(Number(a.dataset.id));
        this.render();
      } else if (action === 'abandon') {
        g.abandonBounty(Number(a.dataset.id));
        this.render();
      }
    });
    this.$('settings-close').addEventListener('click', () => this.closeSettings());
    this.$('settings-done').addEventListener('click', () => this.closeSettings());
    this.$('settings-reset').addEventListener('click', () => {
      settings.reset();
      this.renderSettings();
    });
    this.$('settings-tabs').addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (!t) return;
      this.settingsTab = t.dataset.tab;
      snd().ui();
      this.renderSettings();
    });
    this.$('settings-body').addEventListener('click', (e) => {
      const seg = e.target.closest('[data-seg]');
      if (seg) {
        const [key, val] = seg.dataset.seg.split(':');
        settings.set(key, val);
        snd().ui();
        this.renderSettings();
        return;
      }
      const tog = e.target.closest('[data-toggle]');
      if (tog) {
        const key = tog.dataset.toggle;
        settings.set(key, !settings.get(key));
        snd().ui();
        this.renderSettings();
      }
    });
    this.$('settings-body').addEventListener('input', (e) => {
      const r = e.target.closest('[data-range]');
      if (!r) return;
      const key = r.dataset.range;
      const v = Number(r.value) / Number(r.dataset.div || 1);
      settings.set(key, v);
      r.parentElement.querySelector('output').textContent = r.dataset.fmt === 'pct' ? `${Math.round(v * 100)}%` : r.dataset.fmt === 'x' ? `${v.toFixed(2)}` : `${Math.round(v)}`;
    });
    this.$('modal-actions').addEventListener('click', (e) => {
      const b = e.target.closest('[data-val]');
      if (!b) return;
      snd().ui();
      this.closeModal(b.dataset.val);
    });
  }

  // --------------------------------------------------------- loading --
  setLoading(p, status) {
    this.$('load-fill').style.width = `${Math.round(p * 100)}%`;
    this.$('load-pct').textContent = `${Math.round(p * 100)}%`;
    if (status) this.$('load-status').textContent = status;
  }

  showLoading(v) {
    this.$('loading').classList.toggle('hidden', !v);
    clearInterval(this.tipTimer);
    if (v) {
      const tip = () => { this.$('load-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)]; };
      tip();
      this.tipTimer = setInterval(tip, 4200);
    }
  }

  // ----------------------------------------------------------- title --
  showTitle(v, save) {
    this.$('title').classList.toggle('hidden', !v);
    const cont = this.$('title-menu').querySelector('[data-act="continue"]');
    cont.classList.toggle('hidden', !save);
    if (save) {
      const r = REALMS[save.realm];
      this.$('continue-sub').textContent = `${r.name.toUpperCase()} · ${STAGES[save.stage].name.toUpperCase()} · ${GALAXIES[save.galaxy].name.toUpperCase()}`;
    }
  }

  showPause(v) {
    this.$('pause').classList.toggle('hidden', !v);
  }

  showDeath(v, text) {
    this.$('death').classList.toggle('hidden', !v);
    if (text) this.$('death-text').textContent = text;
  }

  setDeathCount(t) {
    this.$('death-count').textContent = t;
  }

  // ----------------------------------------------------------- modal --
  modal({ kicker = '', title, body, actions }) {
    this.$('modal-kicker').textContent = kicker;
    this.$('modal-title').textContent = title;
    this.$('modal-body').innerHTML = body;
    this.$('modal-actions').innerHTML = actions.map((a) => `<button class="btn ${a.cls || ''}" data-val="${a.val}">${esc(a.label)}</button>`).join('');
    this.$('modal').classList.remove('hidden');
    return new Promise((res) => { this.modalResolve = res; });
  }

  closeModal(val = null) {
    if (this.$('modal').classList.contains('hidden')) return;
    this.$('modal').classList.add('hidden');
    const r = this.modalResolve;
    this.modalResolve = null;
    if (r) r(val);
  }

  confirm(title, body, okLabel = 'Confirm', danger = false) {
    return this.modal({ kicker: 'CONFIRM', title, body: `<p>${body}</p>`, actions: [{ label: 'Cancel', val: 'no', cls: 'ghost' }, { label: okLabel, val: 'yes', cls: danger ? 'danger' : 'primary' }] }).then((v) => v === 'yes');
  }

  showControls() {
    const rows = CONTROLS.map(([a, b]) => `<div><span>${esc(a)}</span><span><b>${esc(b)}</b></span></div>`).join('');
    return this.modal({ kicker: 'INPUT MAP', title: 'Controls', body: `<div class="help-grid" style="grid-template-columns:1fr;max-height:55vh;overflow:auto">${rows}</div>`, actions: [{ label: 'Close', val: 'ok', cls: 'primary' }] });
  }

  showCredits() {
    return this.modal({
      kicker: 'CREDITS',
      title: 'Starsea Ascension',
      body: `<div class="credits"><p>A cultivation game inspired by the xianxia space epics, especially 吞噬星空 (Swallowed Star).</p>
        <p>Built with Three.js and Vite. Every planet, star, nebula, beast, sword and sound is generated in code at runtime.</p>
        <p>Fonts: Orbitron, Rajdhani, Share Tech Mono, Noto Serif SC (Google Fonts).</p></div>`,
      actions: [{ label: 'Close', val: 'ok', cls: 'primary' }],
    });
  }

  // -------------------------------------------------------- settings --
  openSettings(from) {
    this.settingsReturn = from;
    this.$('settings').classList.remove('hidden');
    this.renderSettings();
  }

  closeSettings() {
    this.$('settings').classList.add('hidden');
  }

  renderSettings() {
    const tabs = [['graphics', 'Graphics'], ['controls', 'Controls'], ['audio', 'Audio'], ['gameplay', 'Gameplay']];
    this.$('settings-tabs').innerHTML = tabs.map(([k, l]) => `<button class="tab ${k === this.settingsTab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('');
    const s = settings.data;
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${String(s[key]) === String(v) ? 'on' : ''}" data-seg="${key}:${v}">${l}</button>`).join('')}</div>`;
    const tog = (key) => `<button class="toggle ${s[key] ? 'on' : ''}" data-toggle="${key}" aria-pressed="${s[key]}"></button>`;
    const range = (key, min, max, step, div, fmtKind) => {
      const v = s[key];
      const shown = fmtKind === 'pct' ? `${Math.round(v * 100)}%` : fmtKind === 'x' ? v.toFixed(2) : Math.round(v);
      return `<div class="range"><input type="range" min="${min}" max="${max}" step="${step}" value="${v * div}" data-range="${key}" data-div="${div}" data-fmt="${fmtKind}"><output>${shown}</output></div>`;
    };
    const row = (label, hint, ctl) => `<div class="set-row"><label>${label}<span class="hint">${hint}</span></label>${ctl}</div>`;
    let html = '';
    if (this.settingsTab === 'graphics') {
      html = row('Quality preset', 'Texture resolution, anti-aliasing, particle counts.', seg('quality', Object.entries(PRESETS).map(([k, p]) => [k, p.label.toUpperCase()])))
        + row('Render scale', 'Lower this if the game stutters.', range('renderScale', 50, 100, 5, 100, 'pct'))
        + row('Dynamic resolution', 'Automatically trade sharpness for a steady frame rate.', tog('dynamicRes'))
        + row('Speed blur', 'Radial blur when boosting.', tog('speedBlur'))
        + row('Chromatic aberration', 'Lens fringing at the screen edges.', tog('aberration'))
        + row('Film grain', 'Subtle noise over the image.', tog('grain'))
        + row('Show FPS', 'Frame rate counter on the HUD.', tog('showFps'));
      if (this.game.qualityChangePending) html += '<p class="panel-note" style="margin-top:12px">The new quality preset applies fully the next time you enter a star system.</p>';
    } else if (this.settingsTab === 'controls') {
      html = row('Mouse sensitivity', '', range('sensitivity', 20, 300, 5, 100, 'x'))
        + row('Invert vertical look', '', tog('invertY'))
        + row('Field of view', 'Vertical degrees.', range('fov', 60, 110, 1, 1, 'n'))
        + row('Default view', 'P switches during play.', seg('camera', [['first', 'FIRST PERSON'], ['third', 'THIRD PERSON']]));
    } else if (this.settingsTab === 'audio') {
      html = row('Master volume', '', range('master', 0, 100, 1, 100, 'pct'))
        + row('Music', 'Generative score that intensifies in combat.', range('music', 0, 100, 1, 100, 'pct'))
        + row('Effects', '', range('sfx', 0, 100, 1, 100, 'pct'));
    } else {
      html = row('Damage numbers', 'Floating numbers when you hit beasts.', tog('damageNumbers'))
        + row('Screen shake', 'Camera shake from impacts and lightning.', tog('shake'));
    }
    this.$('settings-body').innerHTML = html;
  }

  // ---------------------------------------------------------- panels --
  openPanel(kind, tab) {
    this.panelKind = kind;
    this.panelTab = tab || null;
    if (kind === 'map' && !this.panelTab) this.panelTab = 'galaxy';
    if (kind === 'map' && this.selectedSystem === null) this.selectedSystem = this.game.state.system;
    this.$('panel').classList.remove('hidden');
    this.render();
  }

  closePanel() {
    this.panelKind = null;
    this.$('panel').classList.add('hidden');
  }

  render() {
    const k = this.panelKind;
    if (!k) return;
    const docked = this.game.atStation;
    const tabs = [
      ['map', 'galaxy', 'Star map'],
      ['map', 'universe', 'Universe'],
      ['cultivation', '', 'Cultivation'],
      ['bounties', '', 'Bounties'],
      ...(docked ? [['shop', '', 'Exchange'], ['forge', '', 'Sword forge']] : []),
      ['guide', '', 'Guide'],
    ];
    this.$('panel-tabs').innerHTML = tabs.map(([kind, tab, label]) => {
      const on = kind === k && (!tab || tab === this.panelTab);
      return `<button class="tab ${on ? 'on' : ''}" data-kind="${kind}" data-tab="${tab}">${label}</button>`;
    }).join('');
    let html = '';
    if (k === 'map') html = this.panelTab === 'universe' ? this.renderUniverse() : this.renderGalaxy();
    else if (k === 'cultivation') html = this.renderCultivation();
    else if (k === 'bounties') html = this.renderBounties();
    else if (k === 'shop') html = this.renderShop();
    else if (k === 'forge') html = this.renderForge();
    else html = this.renderGuide();
    this.$('panel-body').innerHTML = html;
  }

  renderGalaxy() {
    const { state } = this.game;
    const systems = getGalaxySystems(state.galaxy);
    const g = GALAXIES[state.galaxy];
    const sel = systems[this.selectedSystem] || systems[state.system];
    let lines = '';
    for (let i = 1; i < systems.length; i++) {
      const a = systems[i - 1], b = systems[i];
      lines += `<line x1="${a.mapX}" y1="${a.mapY * 0.7}" x2="${b.mapX}" y2="${b.mapY * 0.7}" stroke="rgba(62,242,255,0.35)" stroke-width="0.3" stroke-dasharray="1.2 0.8"/>`;
    }
    const nodes = systems.map((s) => {
      const star = STAR_TYPES[s.starType];
      const cls = dangerClass(s.tier, state.realm);
      const color = cls === 'danger-ok' ? '#5dffa8' : cls === 'danger-warn' ? '#ffe44d' : '#ff4466';
      const here = s.index === state.system;
      const y = s.mapY * 0.7;
      const icons = [s.boss !== null ? (state.bosses.includes(s.boss) ? '✓' : '☠') : '', s.station ? '⌂' : '', s.gate ? '◎' : ''].filter(Boolean).join(' ');
      return `<g class="node" data-action="select-system" data-index="${s.index}">
        <circle cx="${s.mapX}" cy="${y}" r="5.5" fill="${hex(star.glow)}" opacity="0.2"/>
        ${here ? `<circle class="here" cx="${s.mapX}" cy="${y}" r="4" fill="none" stroke="#3ef2ff" stroke-width="0.5"/>` : ''}
        <circle cx="${s.mapX}" cy="${y}" r="2.2" fill="${hex(star.core)}" stroke="${s.index === sel.index ? '#fff' : color}" stroke-width="${s.index === sel.index ? 0.7 : 0.45}"/>
        <text x="${s.mapX}" y="${y + 6.3}" text-anchor="middle" font-size="2.5" fill="#e8f4ff">${esc(s.name)}</text>
        <text x="${s.mapX}" y="${y + 9.2}" text-anchor="middle" font-size="1.9" fill="${color}">${esc(realmOf(s.tier).name)} ${icons}</text>
      </g>`;
    }).join('');
    const check = this.game.canWarpTo(state.galaxy, sel.index);
    const bossDone = sel.boss !== null && state.bosses.includes(sel.boss);
    const rel = Math.pow(3, sel.tier - state.realm);
    const card = `<div class="card">
      <h3>${esc(sel.name)}</h3>
      <div class="misc-line">${STAR_TYPES[sel.starType].label}</div>
      <div class="tags">
        ${sel.station ? '<span class="tag station">STATION</span>' : ''}
        ${sel.gate ? '<span class="tag gate">UNIVERSE GATE</span>' : ''}
        ${sel.boss !== null ? `<span class="tag ${bossDone ? 'done' : 'boss'}">${bossDone ? 'SLAIN: ' : 'OVERLORD: '}${esc(BOSSES[sel.boss].name.toUpperCase())}</span>` : ''}
      </div>
      <div class="row"><span>Threat</span><span class="${dangerClass(sel.tier, state.realm)}">${esc(realmOf(sel.tier).name)} ${REALMS[Math.floor(sel.tier)].cn}</span></div>
      <div class="row"><span>Cultivation speed</span><span>×${rel >= 10 ? Math.round(rel) : rel.toFixed(rel < 1 ? 2 : 1)} vs. your realm</span></div>
      <div class="row"><span>Beasts</span><span>${sel.tier >= 2 ? 'Mites, Rays, Rockbacks, Wraiths' : sel.tier >= 1 ? 'Mites, Rays, Rockbacks' : 'Mites, Rays'}</span></div>
      ${sel.index === state.system ? '<div class="misc-line" style="margin-top:10px">You are here.</div>' : `<button class="btn primary" data-action="warp" data-galaxy="${state.galaxy}" data-index="${sel.index}" ${check.ok ? '' : 'disabled'}>Warp to ${esc(sel.name)}</button>`}
      ${!check.ok && sel.index !== state.system ? `<div class="why">${esc(check.reason)}</div>` : ''}
    </div>`;
    return `<p class="panel-note"><b>${esc(g.name)}</b> <span class="cn">${g.cn}</span>. ${esc(g.desc)} Green systems match your realm. Yellow ones are a step above. Red ones are out of reach.</p>
      <div class="map-wrap"><svg class="map-svg" viewBox="0 0 100 70">${lines}${nodes}</svg>${card}</div>`;
  }

  renderUniverse() {
    const { state } = this.game;
    const cards = GALAXIES.map((g, i) => {
      const check = this.game.canTravelGalaxy(i);
      const boss = BOSSES[g.boss];
      const slain = state.bosses.includes(g.boss);
      return `<div class="card galaxy-card ${i === state.galaxy ? 'current' : ''}" style="--gc:${g.sky[0]}">
        <h3>${esc(g.name)}<span class="cn">${g.cn}</span></h3>
        <p>${esc(g.desc)}</p>
        <div class="meta">Requires <span class="${state.realm >= g.reqRealm ? 'danger-ok' : 'danger-bad'}">${esc(REALMS[g.reqRealm].name)}</span></div>
        <div class="meta">Threat ${esc(realmOf(g.tiers[0]).name)} to ${esc(realmOf(g.tiers[g.tiers.length - 1]).name)}</div>
        <div class="meta">Overlord <span class="${slain ? 'danger-ok' : 'danger-bad'}">${esc(boss.name)} ${boss.cn}${slain ? ' · slain' : ''}</span></div>
        ${i === state.galaxy ? '<div class="misc-line" style="margin-top:10px">You are in this galaxy.</div>' : `<button class="btn ${check.ok ? 'primary' : ''}" data-action="warp" data-galaxy="${i}" data-index="0" ${check.ok ? '' : 'disabled'}>${check.ok ? 'Jump through the gate' : esc(check.reason)}</button>`}
      </div>`;
    }).join('');
    return `<p class="panel-note">${this.game.atGate ? 'The Universe Gate hums before you. Choose a destination.' : 'Crossing galaxies requires a Universe Gate. Every galaxy keeps one in its first system, near the station.'}</p><div class="galaxy-grid">${cards}</div>`;
  }

  renderCultivation() {
    const { state } = this.game;
    const st = this.game.stats;
    const ladder = REALMS.map((r, i) => `<div class="rung ${i < state.realm ? 'done' : i === state.realm ? 'current' : ''}"><span>${i < state.realm ? '✓ ' : ''}${esc(r.name)}</span><span class="cn">${r.cn}</span></div>`).join('');
    const techs = Object.entries(TECHNIQUES).map(([k, t]) => {
      const unlocked = k === 'devour' ? state.devour : state.realm >= t.unlockRealm;
      const m = state.mastery[k];
      const pips = m ? `<div class="pips-row">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= m ? 'on' : ''}"></i>`).join('')}</div>` : '';
      const lock = k === 'devour' ? (unlocked ? '' : 'Hidden in an ancient ruin.') : unlocked ? '' : `Unlocks at ${REALMS[t.unlockRealm].name}.`;
      return `<div class="tech ${unlocked ? '' : 'locked'}"><h4><span>${esc(t.name)} <span class="cn">${t.cn}</span></span><span>${t.key === 'passive' ? 'PASSIVE' : `<kbd>${t.key}</kbd>`}</span></h4><p>${esc(t.desc)} ${lock ? `<b>${esc(lock)}</b>` : ''}</p>${pips}</div>`;
    }).join('');
    const r = REALMS[state.realm];
    const mins = Math.floor(state.playtime / 60);
    const grade = SWORD_GRADES[state.swordGrade];
    return `<div class="cult-wrap">
      <div><div class="section-title" style="margin-top:0">Path of cultivation</div><div class="ladder">${ladder}</div></div>
      <div>
        <div class="section-title" style="margin-top:0">${esc(r.name)} · ${STAGES[state.stage].name} <span class="cn">${r.cn}${STAGES[state.stage].cn}</span></div>
        <p class="panel-note">${esc(r.blurb)}</p>
        <div class="stat-grid">
          <div class="stat"><div class="k">LIFE</div><div class="v">${fmt(st.maxHp)}</div></div>
          <div class="stat"><div class="k">ATTACK</div><div class="v">${fmt(st.atk)}</div></div>
          <div class="stat"><div class="k">ENERGY</div><div class="v">${st.maxEnergy}</div></div>
          <div class="stat"><div class="k">SPIRIT</div><div class="v">${st.maxSpirit}</div></div>
          <div class="stat"><div class="k">SWORDS</div><div class="v">${st.swords}</div></div>
        </div>
        <div class="misc-line">Flying swords: <b>${grade.name} ${grade.cn}</b> grade, ×${grade.mult} damage. You gain one sword per realm, up to twelve.</div>
        <div class="section-title">Techniques</div>
        <div class="tech-list">${techs}</div>
        <div class="section-title">Record</div>
        <div class="misc-line">Beasts slain <b>${state.kills}</b> · Overlords slain <b>${state.bosses.length}/${BOSSES.length}</b> (+10% life and attack each) · Worlds explored <b>${state.explored.length}</b> · Bounties completed <b>${state.completedBounties}</b> · Time <b>${Math.floor(mins / 60)}h ${mins % 60}m</b></div>
      </div>
    </div>`;
  }

  rewardText(r) {
    const parts = [];
    if (r.coins) parts.push(`<span class="price">${fmt(r.coins)} ◈</span>`);
    if (r.essence) parts.push(`<span class="price ess">${fmt(r.essence)} ✦</span>`);
    if (r.xp) parts.push(`<span class="price" style="color:var(--gd)">${fmt(r.xp)} EXP</span>`);
    return parts.join(' ');
  }

  renderBounties() {
    const { state } = this.game;
    const docked = this.game.atStation;
    const active = state.bounties.length
      ? state.bounties.map((b) => {
        const prog = b.type === 'cultivate' ? `${fmt(b.progress)}/${fmt(b.need)}` : `${b.progress}/${b.need}`;
        return `<div class="item"><div><h4>${esc(b.title)}</h4><p>${esc(b.desc)}</p><p class="mono">PROGRESS ${prog} · ${GALAXIES[b.galaxy].name.toUpperCase()}</p></div><div>${this.rewardText(b.reward)}</div><button class="btn small danger" data-action="abandon" data-id="${b.id}">Abandon</button></div>`;
      }).join('')
      : '<p class="panel-note">No active bounties.</p>';
    let offers = '';
    if (docked) {
      const full = state.bounties.length >= MAX_BOUNTIES;
      offers = state.offers.length
        ? state.offers.map((b) => `<div class="item"><div><h4>${esc(b.title)}</h4><p>${esc(b.desc)}</p></div><div>${this.rewardText(b.reward)}</div><button class="btn small primary" data-action="accept" data-id="${b.id}" ${full ? 'disabled' : ''}>Accept</button></div>`).join('')
        : '<p class="panel-note">The board is empty. New contracts arrive while you are away.</p>';
      offers = `<div class="section-title">Bounty board${full ? ' · you carry the maximum of three' : ''}</div><div class="list">${offers}</div>`;
    } else {
      offers = '<p class="panel-note" style="margin-top:14px">Dock at a station to take new bounties. Rewards pay out the moment a contract is complete.</p>';
    }
    return `<div class="section-title" style="margin-top:0">Active contracts · ${state.bounties.length}/${MAX_BOUNTIES}</div><div class="list">${active}</div>${offers}`;
  }

  renderShop() {
    const { state } = this.game;
    const pills = Object.entries(PILLS).map(([k, p]) => {
      const price = priceFor(p.price, state.realm);
      return `<div class="item"><div><h4>${esc(p.name)}<span class="cn">${p.cn}</span></h4><p>${esc(p.desc)} Owned ${state.pills[k]}. Hotkey <kbd>${p.key}</kbd>.</p></div><span class="price">${fmt(price)} ◈</span><button class="btn small" data-action="buy" data-item="${k}" ${state.coins >= price ? '' : 'disabled'}>Buy</button></div>`;
    }).join('');
    const manuals = ACTIVE_TECHNIQUES.filter((k) => state.realm >= TECHNIQUES[k].unlockRealm).map((k) => {
      const t = TECHNIQUES[k];
      const m = state.mastery[k];
      const price = priceFor(MANUAL_PRICE * m, state.realm);
      const maxed = m >= 5;
      return `<div class="item"><div><h4>Manual: ${esc(t.name)}<span class="cn">${t.cn}秘籍</span></h4><p>Mastery ${m} to ${Math.min(5, m + 1)}: +25% power.</p></div><span class="price">${maxed ? 'MASTERED' : `${fmt(price)} ◈`}</span><button class="btn small" data-action="buy" data-item="manual" data-tech="${k}" ${!maxed && state.coins >= price ? '' : 'disabled'}>Buy</button></div>`;
    }).join('');
    return `<p class="panel-note">Docked. Life, energy and spirit restored. You hold <b class="gold">${fmt(state.coins)} ◈</b> star coins and <b class="mg">${fmt(state.essence)} ✦</b> beast essence.</p>
      <div class="section-title" style="margin-top:0">Pills and elixirs</div><div class="list">${pills}</div>
      <div class="section-title">Technique manuals</div><div class="list">${manuals}</div>`;
  }

  renderForge() {
    const { state } = this.game;
    const cur = SWORD_GRADES[state.swordGrade];
    const next = SWORD_GRADES[state.swordGrade + 1];
    const track = SWORD_GRADES.map((g, i) => `<span class="${i <= state.swordGrade ? 'on' : ''}">${g.name}</span>`).join('');
    const can = next && state.coins >= next.coins && state.essence >= next.essence;
    const refineAll = state.essence;
    return `<div class="forge">
      <div class="card">
        <div class="mono dim">FLYING SWORDS · ${swordCount(state.realm)} BLADES</div>
        <h3>${esc(cur.name)} <span class="cn" style="color:var(--gd)">${cur.cn}</span></h3>
        <div class="grade-track">${track}</div>
        <div class="row"><span>Damage multiplier</span><span>×${cur.mult}</span></div>
        <div class="row"><span>Sword mastery</span><span>${state.mastery.swords} / 5</span></div>
        ${next ? `<div class="section-title">Next: ${esc(next.name)} ${next.cn}</div>
          <div class="row"><span>Damage</span><span>×${cur.mult} → ×${next.mult}</span></div>
          <div class="row"><span>Cost</span><span><span class="price">${fmt(next.coins)} ◈</span> <span class="price ess">${fmt(next.essence)} ✦</span></span></div>
          <button class="btn gold" data-action="forge" ${can ? '' : 'disabled'}>Reforge swords</button>` : '<p class="panel-note" style="margin-top:12px">Your swords have reached their final form.</p>'}
      </div>
      <div class="card">
        <div class="mono dim">ESSENCE REFINERY</div>
        <h3>Refine essence</h3>
        <p class="panel-note" style="margin-top:8px">Beast essence can be refined directly into cultivation experience, one point for one point.</p>
        <div class="row"><span>Essence held</span><span class="price ess">${fmt(state.essence)} ✦</span></div>
        <button class="btn" data-action="refine" data-frac="0.25" ${refineAll > 0 ? '' : 'disabled'}>Refine a quarter</button>
        <button class="btn primary" data-action="refine" data-frac="1" ${refineAll > 0 ? '' : 'disabled'}>Refine all</button>
      </div>
    </div>`;
  }

  renderGuide() {
    return `<ul class="tips">
      <li><b>Flying swords.</b> Hold right mouse to steer them with your mind. They follow your crosshair and cut everything they pass through. Scroll to push them further or pull them closer. Z switches between Swarm, a whirling blade storm, and Lance, a piercing spear. Q looses them at targets. Idle swords guard you and swat enemy shots out of the air.</li>
      <li><b>Cultivate</b> by holding C. Energy is richest near stars and inside glowing nebulae, and richer still in dangerous systems.</li>
      <li><b>Hunt beasts</b> for experience, star coins and essence cores. Fly into the cores to collect them. Beasts far below your realm teach you little.</li>
      <li><b>Explore planets</b> by holding E nearby. Planets marked with ruins hold inheritances.</li>
      <li>At <b>Peak</b> stage, press B to face the <b>Heavenly Tribulation</b>. Keep moving and stay out of the red spheres.</li>
      <li><b>Stations</b> heal you, sell pills and manuals, post bounties, forge your swords and refine essence.</li>
      <li>Use the <b>star map</b> (M) to warp between systems and the <b>Universe Gate</b> to cross galaxies once your realm allows.</li>
      <li>Each galaxy has an <b>Overlord</b>. Slaying one permanently strengthens you. The last one guards the path to Universe Master.</li>
    </ul>
    <div class="section-title">Controls</div>
    <div class="help-grid">${CONTROLS.map(([a, b]) => `<div><span>${esc(a)}</span><span><b>${esc(b)}</b></span></div>`).join('')}</div>`;
  }
}
