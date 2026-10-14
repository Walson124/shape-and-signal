import {
  REALMS, STAGES, PILLS, REGIONS, BOSSES, SWORD_GRADES, SHIPS, TIPS, DEVOUR, SELL, RADARS,
  priceFor, MANUAL_PRICE, masteryMult,
} from '../game/data.js';
import { PATHS, PATH_IDS, TECHS, REALM_PERKS, TREES, treeFor, canLearn, pointsFree, pointsEarned, activePath, ownedPaths, owns, knows } from '../game/paths.js';
import { MAX_BOUNTIES } from '../game/missions.js';
import { LORE } from '../game/lore.js';
import { ACT1 } from '../game/campaign.js';
import { settings, PRESETS } from '../core/settings.js';
import { ACTIONS, codeLabel } from '../core/bindings.js';
import { fmt, esc, hex } from './hud.js';

const key = (a) => `<kbd>${esc(codeLabel(settings.key(a)))}</kbd>`;

export class Menus {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.panelKind = null;
    this.panelTab = null;
    this.settingsTab = 'graphics';
    this.settingsReturn = null;
    this.modalResolve = null;
    this.tipTimer = null;
    this.rebinding = null;
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
      if (e.target.closest && e.target.closest('.menu-item, .btn, .tab, .seg button, .path-card, .node')) snd().hover();
    });
    this.$('title-menu').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      snd().init();
      snd().confirm();
      const act = b.dataset.act;
      if (act === 'continue') g.continueGame();
      else if (act === 'campaign') g.requestNewGame('story');
      else if (act === 'free') g.requestNewGame('free');
      else if (act === 'settings') this.openSettings('title');
      else if (act === 'controls') { this.settingsTab = 'controls'; this.openSettings('title'); }
      else if (act === 'credits') this.showCredits();
    });
    this.$('pause').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      snd().confirm();
      const act = b.dataset.act;
      if (act === 'resume') g.resume();
      else if (act === 'settings') this.openSettings('pause');
      else if (act === 'controls') { this.settingsTab = 'controls'; this.openSettings('pause'); }
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
      const handlers = {
        'build-ship': () => g.buildShip(Number(a.dataset.tier)),
        buy: () => g.buy(a.dataset.item, a.dataset.tech),
        forge: () => g.forge(),
        refine: () => g.refine(Number(a.dataset.frac)),
        accept: () => g.acceptBounty(Number(a.dataset.id)),
        abandon: () => g.abandonBounty(Number(a.dataset.id)),
        learn: () => g.learnSkill(a.dataset.id),
        respec: () => this.confirmRespec(),
        'buy-weapon': () => g.buyWeapon(a.dataset.id),
        equip: () => g.equipWeapon(a.dataset.id),
        tree: () => { this.treeTab = a.dataset.tree; },
        sell: () => g.sell(a.dataset.what, Number(a.dataset.frac)),
        gene: () => g.buyGene(),
        chamber: () => g.rentChamber(),
        meal: () => g.buyMeal(a.dataset.meal),
        rumor: () => g.buyRumor(),
        home: () => g.rentHome(),
        sleep: () => { g.sleep(); g.closePanel(); },
        arena: () => g.startArena(),
        radar: () => g.buyRadar(),
        order: () => g.orderDelivery(a.dataset.item),
        sim: () => g.startSim(),
        story: () => g.beginStory(),
      };
      if (handlers[action]) {
        handlers[action]();
        if (this.panelKind) this.render();
      }
    });
    this.$('settings-close').addEventListener('click', () => this.closeSettings());
    this.$('settings-done').addEventListener('click', () => this.closeSettings());
    this.$('settings-reset').addEventListener('click', () => {
      if (this.settingsTab === 'controls') settings.resetBindings();
      else settings.reset();
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
      const rb = e.target.closest('[data-rebind]');
      if (rb) {
        this.rebinding = rb.dataset.rebind;
        this.renderSettings();
        g.input.captureNext((code) => {
          if (code) settings.bind(this.rebinding, code);
          this.rebinding = null;
          this.renderSettings();
        });
        return;
      }
      const seg = e.target.closest('[data-seg]');
      if (seg) {
        const [k, val] = seg.dataset.seg.split(':');
        if (k === 'quality') settings.set('autoQuality', false);
        const num = Number(val);
        settings.set(k, Number.isNaN(num) || val === '' ? val : num);
        snd().ui();
        this.renderSettings();
        return;
      }
      const tog = e.target.closest('[data-toggle]');
      if (tog) {
        const k = tog.dataset.toggle;
        settings.set(k, !settings.get(k));
        snd().ui();
        this.renderSettings();
      }
    });
    this.$('settings-body').addEventListener('input', (e) => {
      const r = e.target.closest('[data-range]');
      if (!r) return;
      const k = r.dataset.range;
      const v = Number(r.value) / Number(r.dataset.div || 1);
      settings.set(k, v);
      r.parentElement.querySelector('output').textContent = r.dataset.fmt === 'pct' ? `${Math.round(v * 100)}%` : r.dataset.fmt === 'x' ? `${v.toFixed(2)}` : `${Math.round(v)}`;
    });
    this.$('modal-actions').addEventListener('click', (e) => {
      const b = e.target.closest('[data-val]');
      if (!b) return;
      snd().ui();
      this.closeModal(b.dataset.val);
    });
    this.$('modal-body').addEventListener('click', (e) => {
      const c = e.target.closest('[data-pick]');
      if (!c) return;
      snd().confirm();
      this.closeModal(c.dataset.pick);
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
      const path = PATHS[activePath(save)];
      this.$('continue-sub').textContent = `${r.name.toUpperCase()} · ${STAGES[save.stage].name.toUpperCase()}${path ? ` · ${path.name.toUpperCase()}` : ''}${save.loc && save.loc.label ? ` · ${save.loc.label.toUpperCase()}` : ''}`;
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
  modal({ kicker = '', title, body, actions, wide = false }) {
    this.$('modal-kicker').textContent = kicker;
    this.$('modal-title').textContent = title;
    this.$('modal-body').innerHTML = body;
    this.$('modal-actions').innerHTML = actions.map((a) => `<button class="btn ${a.cls || ''}" data-val="${a.val}">${esc(a.label)}</button>`).join('');
    this.$('modal').classList.remove('hidden');
    this.$('modal').querySelector('.modal-frame').classList.toggle('wide', wide);
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

  // Path selection: resolves to a path id, or null if cancelled.
  async chooseMode() {
    const card = (id, cn, name, desc) => `<button class="path-card" data-pick="${id}" style="--pc:${id === 'story' ? '#ffc857' : '#3ef2ff'}">
        <div class="pc-cn">${cn}</div>
        <div class="pc-name">${name}</div>
        <p>${desc}</p>
      </button>`;
    const cards = card('story', '故事', 'Story', 'Recommended. Begin as a convoy recruit on a salvage run into the ruins, and find out what waits in the dark. Act I: missions, cutscenes and a beast tide. Free roaming is always open between missions.')
      + card('free', '自由', 'Free Play', 'Start in Base City 07 with Nix already at your side and no story. You can still begin the story later from the Story tab.');
    const v = await this.modal({ kicker: 'HOW DO YOU WANT TO BEGIN?', title: 'Choose a Mode', body: `<div class="path-cards two">${cards}</div>`, actions: [{ label: 'Back', val: 'no', cls: 'ghost' }], wide: true });
    return v && v !== 'no' ? v : null;
  }

  async confirmRespec() {
    const g = this.game;
    const cost = g.respecCost();
    const ok = await this.confirm('Reset your skill points?', `Every skill point you have spent, in every tree, is refunded. Cost: <b class="gold">${fmt(cost)} ◈</b>.`, 'Reset');
    if (ok) g.respec();
    if (this.panelKind) this.render();
  }

  showCredits() {
    return this.modal({
      kicker: 'CREDITS',
      title: 'Starsea Ascension',
      body: `<div class="credits"><p>A cultivation game inspired by the xianxia space epics, especially 吞噬星空 (Swallowed Star).</p>
        <p>Built with Three.js and Vite. Every planet, city, star, nebula, beast, sword and sound is generated in code at runtime.</p>
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
    this.rebinding = null;
    this.game.input.capture = null;
    this.$('settings').classList.add('hidden');
  }

  renderSettings() {
    const tabs = [['graphics', 'Graphics'], ['visuals', 'Visuals'], ['controls', 'Controls'], ['gameplay', 'Gameplay'], ['audio', 'Audio']];
    this.$('settings-tabs').innerHTML = tabs.map(([k, l]) => `<button class="tab ${k === this.settingsTab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('');
    this.$('settings-reset').textContent = this.settingsTab === 'controls' ? 'Default keys' : 'Restore defaults';
    const s = settings.data;
    const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${String(s[k]) === String(v) ? 'on' : ''}" data-seg="${k}:${v}">${l}</button>`).join('')}</div>`;
    const tog = (k) => `<button class="toggle ${s[k] ? 'on' : ''}" data-toggle="${k}" aria-pressed="${s[k]}"></button>`;
    const range = (k, min, max, step, div, fmtKind) => {
      const v = s[k];
      const shown = fmtKind === 'pct' ? `${Math.round(v * 100)}%` : fmtKind === 'x' ? v.toFixed(2) : Math.round(v);
      return `<div class="range"><input type="range" min="${min}" max="${max}" step="${step}" value="${v * div}" data-range="${k}" data-div="${div}" data-fmt="${fmtKind}"><output>${shown}</output></div>`;
    };
    const row = (label, hint, ctl) => `<div class="set-row"><label>${label}<span class="hint">${hint}</span></label>${ctl}</div>`;
    let html = '';
    const t = this.settingsTab;
    if (t === 'graphics') {
      html = row('Quality preset', 'Texture resolution, anti-aliasing, terrain detail, crowds and particles. Minimal suits older laptops.', seg('quality', Object.entries(PRESETS).map(([k, p]) => [k, p.label.toUpperCase()])))
        + row('Render scale', 'Lower this if the game stutters.', range('renderScale', 40, 100, 5, 100, 'pct'))
        + row('Dynamic resolution', 'Automatically trade sharpness for a steady frame rate.', tog('dynamicRes'))
        + row('Terrain detail', 'How finely the ground near you is built. Lower is faster.', seg('terrainDetail', [[0.6, 'LOW'], [1, 'NORMAL'], [1.4, 'HIGH']]))
        + row('Trees and rocks', 'Density of vegetation and boulders.', seg('propDensity', [[0, 'OFF'], [0.5, 'SPARSE'], [1, 'FULL']]))
        + row('City crowds', 'Pedestrians walking the streets.', tog('crowds'))
        + row('Automatic quality', 'Lower the preset by itself if the frame rate stays low. Picking a preset turns this off.', tog('autoQuality'))
        + row('Show FPS', 'Frame rate counter on the HUD.', tog('showFps'));
      if (this.game.qualityChangePending) html += '<p class="panel-note" style="margin-top:12px">Some changes apply fully the next time you enter a star system.</p>';
    } else if (t === 'visuals') {
      html = row('Field of view', 'Vertical degrees.', range('fov', 60, 110, 1, 1, 'n'))
        + row('Bloom', 'Glow around bright lights.', tog('bloom'))
        + row('Speed blur', 'Radial blur when boosting.', tog('speedBlur'))
        + row('Chromatic aberration', 'Lens fringing at the screen edges.', tog('aberration'))
        + row('Film grain', 'Subtle noise over the image.', tog('grain'))
        + row('Vignette', 'Darkened screen corners.', tog('vignette'))
        + row('Screen shake', 'Camera shake from impacts and lightning.', tog('shake'))
        + row('Head bob', 'Camera bob while walking in first person.', tog('headBob'))
        + row('Damage numbers', 'Floating numbers when you hit beasts.', tog('damageNumbers'))
        + row('HUD scale', 'Size of the interface.', range('hudScale', 70, 130, 5, 100, 'pct'));
    } else if (t === 'controls') {
      html = row('Mouse sensitivity', '', range('sensitivity', 20, 300, 5, 100, 'x'))
        + row('Invert vertical look', '', tog('invertY'));
      let group = '';
      for (const a of ACTIONS) {
        if (a.group !== group) {
          group = a.group;
          html += `<div class="section-title">${esc(group)}</div>`;
        }
        const active = this.rebinding === a.id;
        html += `<div class="set-row bind-row"><label>${esc(a.label)}</label><button class="btn small bind ${active ? 'listening' : ''}" data-rebind="${a.id}">${active ? 'PRESS A KEY · ESC CANCELS' : esc(codeLabel(s.bindings[a.id]))}</button></div>`;
      }
    } else if (t === 'gameplay') {
      html = row('View', 'First or third person. The camera key switches during play.', seg('camera', [['first', 'FIRST PERSON'], ['third', 'THIRD PERSON']]))
        + row('Cultivate input', 'Tap toggles cultivation on and off (holding still works). Hold means only while held.', seg('cultivateMode', [['toggle', 'TAP TO TOGGLE'], ['hold', 'HOLD']]))
        + row('Always sprint', 'Run by default; the sprint key walks.', tog('autoSprint'))
        + row('Nix chatter', 'How much your ring companion talks. Quiet keeps only warnings and story.', seg('nixChatter', [['normal', 'NORMAL'], ['quiet', 'QUIET'], ['off', 'OFF']]));
    } else {
      html = row('Master volume', '', range('master', 0, 100, 1, 100, 'pct'))
        + row('Music', 'Generative score that intensifies in combat.', range('music', 0, 100, 1, 100, 'pct'))
        + row('Effects', '', range('sfx', 0, 100, 1, 100, 'pct'));
    }
    this.$('settings-body').innerHTML = html;
  }

  // ---------------------------------------------------------- panels --
  openPanel(kind, tab) {
    this.panelKind = kind;
    this.panelTab = tab || null;
    this.$('panel').classList.remove('hidden');
    this.render();
  }

  closePanel() {
    this.panelKind = null;
    this.$('panel').classList.add('hidden');
  }

  venueTabs() {
    const vk = this.game.atStation ? this.game.venueKind : null;
    const map = {
      station: [['shop', 'Exchange'], ['armory', 'Armory'], ['forge', 'Sword forge'], ['shipyard', 'Shipyard']],
      exchange: [['shop', 'Exchange']], pills: [['shop', 'Pill pavilion']], forge: [['armory', 'Armory'], ['forge', 'Sword forge']], shipyard: [['shipyard', 'Shipyard']],
      hall: [['bounties', 'Bounties'], ['trainer', 'Skill reset']], clinic: [['clinic', 'Gene clinic']], chamber: [['chamber', 'Chamber']],
      bar: [['bar', 'Teahouse']], food: [['food', 'Noodle bar']], home: [['home', 'Apartment']], arena: [['arena', 'Arena']],
      camp: [['shop', 'Trader'], ['bar', 'Campfire']],
      virtual: [['vshop', 'Star Mall'], ['bounties', 'Bounty board'], ['vsim', 'Simulator'], ['fame', 'Hall of Fame']],
    };
    return map[vk] || [];
  }

  render() {
    const k = this.panelKind;
    if (!k) return;
    const venue = this.venueTabs();
    const base = [['cultivation', 'Cultivation'], ['skills', 'Skills'], ['bounties', 'Bounties'], ['story', 'Story'], ['archive', 'Archive'], ['guide', 'Guide']];
    const tabs = [...venue, ...base.filter(([kk]) => !venue.some(([vk]) => vk === kk))];
    this.$('panel-tabs').innerHTML = tabs.map(([kind, label]) => `<button class="tab ${kind === k ? 'on' : ''}" data-kind="${kind}">${label}</button>`).join('');
    const r = {
      shipyard: () => this.renderShipyard(), cultivation: () => this.renderCultivation(), skills: () => this.renderSkills(), bounties: () => this.renderBounties(),
      shop: () => this.renderShop(), forge: () => this.renderForge(), armory: () => this.renderArmory(), trainer: () => this.renderTrainer(), clinic: () => this.renderClinic(),
      chamber: () => this.renderChamber(), bar: () => this.renderBar(), food: () => this.renderFood(), home: () => this.renderHome(), arena: () => this.renderArena(),
      archive: () => this.renderArchive(),
      story: () => this.renderStory(),
      vshop: () => this.renderMall(), vsim: () => this.renderSim(), fame: () => this.renderFame(),
    }[k];
    this.$('panel-body').innerHTML = r ? r() : this.renderGuide();
  }

  wallet() {
    const s = this.game.state;
    return `<b class="gold">${fmt(s.coins)} ◈</b> · <b class="cyan">${fmt(s.ore)} ⬢</b> · <b class="mg">${fmt(s.essence)} ✦</b>`;
  }

  renderShipyard() {
    const { state } = this.game;
    const cur = state.ship ? state.ship.tier : -1;
    const locked = state.realm < 2;
    const rows = SHIPS.map((sh, i) => {
      const owned = i <= cur;
      const next = i === cur + 1;
      const can = next && !(locked && i > 0) && state.coins >= sh.coins && state.ore >= sh.ore && state.essence >= sh.essence;
      return `<div class="item"><div><h4>${esc(sh.name)}<span class="cn">${sh.cn}</span></h4>
        <p>Warp range ${sh.range} light years · cruise ${(sh.cruise / 1000).toFixed(0)} km/s · hull ×${sh.hull}</p></div>
        <div><span class="price">${fmt(sh.coins)} ◈</span> <span class="price" style="color:var(--cy)">${fmt(sh.ore)} ⬢</span> <span class="price ess">${fmt(sh.essence)} ✦</span></div>
        ${owned ? '<span class="tag done">OWNED</span>' : `<button class="btn small ${can ? 'primary' : ''}" data-action="build-ship" data-tier="${i}" ${can ? '' : 'disabled'}>${cur < 0 ? 'Build' : 'Upgrade'}</button>`}</div>`;
    }).join('');
    const note = locked
      ? (state.ship ? 'Bigger hulls need the <b>Planetary</b> realm: a weaker body cannot survive the void even inside a hull.' : 'A <b>Skyjet</b> flies anywhere in the sky of a world. Starships and space flight need the <b>Planetary</b> realm: a weaker body cannot survive the void even inside a hull.')
      : state.ship
        ? `Your <b>${esc(SHIPS[state.ship.tier].name)}</b> is registered here. Upgrades are fitted on the spot.`
        : `Build a starship to cross the void between stars. Aim at any star with ${key('target')} and warp with ${key('engage')}.`;
    return `<p class="panel-note">${note} You hold ${this.wallet()}.</p><div class="list">${rows}</div>`;
  }

  techCard(id, slotKey, state) {
    const t = TECHS[id];
    const known = knows(state, id);
    const unlocked = state.realm >= t.unlockRealm && known;
    const m = state.mastery[id] || 1;
    const pips = `<div class="pips-row">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= m ? 'on' : ''}"></i>`).join('')}</div>`;
    return `<div class="tech ${unlocked ? '' : 'locked'}"><h4><span>${esc(t.name)} <span class="cn">${t.cn}</span></span><span>${slotKey}</span></h4><p>${esc(t.desc)} ${unlocked ? '' : state.realm < t.unlockRealm ? `<b>Unlocks at ${REALMS[t.unlockRealm].name}.</b>` : '<b>Learn it in your skill tree.</b>'}</p>${pips}</div>`;
  }

  renderCultivation() {
    const { state } = this.game;
    const st = this.game.stats;
    const P = PATHS[activePath(state)];
    const ladder = REALMS.map((r, i) => `<div class="rung ${i < state.realm ? 'done' : i === state.realm ? 'current' : ''}"><span>${i < state.realm ? '✓ ' : ''}${esc(r.name)}</span><span class="cn">${r.cn}</span></div>`).join('');
    const techs = [
      this.techCard(P.primary, key('fire'), state),
      this.techCard(P.secondary, key('focus'), state),
      ...P.skills.map((id, i) => this.techCard(id, key(`skill${i + 1}`), state)),
      `<div class="tech ${state.devour ? '' : 'locked'}"><h4><span>${DEVOUR.name} <span class="cn">${DEVOUR.cn}</span></span><span>PASSIVE</span></h4><p>${esc(DEVOUR.desc)}</p></div>`,
    ].join('');
    const perks = REALM_PERKS.map((p) => `<div class="perk ${state.realm >= p.realm ? 'on' : ''}"><span class="mono">${esc(REALMS[p.realm].name.toUpperCase())}</span><b>${esc(p.name)}</b><span>${esc(p.desc)}</span></div>`).join('');
    const r = REALMS[state.realm];
    const mins = Math.floor(state.playtime / 60);
    const grade = SWORD_GRADES[state.swordGrade];
    return `<div class="cult-wrap">
      <div><div class="section-title" style="margin-top:0">Path of cultivation</div><div class="ladder">${ladder}</div></div>
      <div>
        <div class="section-title" style="margin-top:0">${esc(r.name)} · ${STAGES[state.stage].name} <span class="cn">${r.cn}${STAGES[state.stage].cn}</span> · <span style="color:${hex(P.color)}">${esc(P.name)} ${P.cn}</span></div>
        <p class="panel-note">${esc(r.blurb)}</p>
        <div class="stat-grid">
          <div class="stat"><div class="k">LIFE</div><div class="v">${fmt(st.maxHp)}</div></div>
          <div class="stat"><div class="k">ATTACK</div><div class="v">${fmt(st.atk)}</div></div>
          <div class="stat"><div class="k">ENERGY</div><div class="v">${st.maxEnergy}</div></div>
          <div class="stat"><div class="k">SPIRIT</div><div class="v">${st.maxSpirit}</div></div>
          <div class="stat"><div class="k">SWORDS</div><div class="v">${st.swords}</div></div>
          <div class="stat"><div class="k">RUN</div><div class="v">${st.walk.toFixed(0)} m/s</div></div>
          <div class="stat"><div class="k">CRIT</div><div class="v">${Math.round(st.crit * 100)}%</div></div>
          <div class="stat"><div class="k">DEFENCE</div><div class="v">${Math.round(st.armor * 100)}%</div></div>
        </div>
        <div class="misc-line">${owns(state, 'mind') ? `Flying swords: <b>${grade.name} ${grade.cn}</b>, ×${grade.mult} damage · ` : ''}Gene enhancement level <b>${state.gene || 0}</b> · Realm Insight <b style="color:#c08cff">${state.insight || 0}</b> · Radar <b>${RADARS[state.radar || 0].name}</b></div>
        <p class="panel-note">Each breakthrough needs a <b>Realm Insight</b>. Earn one by winning an obelisk trial, slaying an Overlord, clearing every fifth arena wave, or completing a Martial Hall breakthrough trial.</p>
        <div class="section-title">Techniques</div>
        <div class="tech-list">${techs}</div>
        <div class="section-title">Realm powers</div>
        <div class="perks">${perks}</div>
        <div class="section-title">Record</div>
        <div class="misc-line">Beasts slain <b>${state.kills}</b> · Overlords slain <b>${state.bosses.length}/${BOSSES.length}</b> · Places explored <b>${state.explored.length}</b> · Bounties <b>${state.completedBounties}</b> · Arena best <b>wave ${state.arena || 0}</b> · Time <b>${Math.floor(mins / 60)}h ${mins % 60}m</b></div>
      </div>
    </div>`;
  }

  renderSkills() {
    const { state } = this.game;
    const owned = ownedPaths(state);
    if (!this.treeTab || (this.treeTab !== 'general' && !PATHS[this.treeTab])) this.treeTab = activePath(state);
    const tab = this.treeTab;
    const P = PATHS[tab];
    const free = pointsFree(state);
    const nodes = treeFor(tab);
    const tabs = ['general', ...PATH_IDS].map((id) => {
      const label = id === 'general' ? 'General' : PATHS[id].name;
      const have = id === 'general' || owned.includes(id);
      return `<button class="btn small ${id === tab ? 'on' : ''}" data-action="tree" data-tree="${id}" style="${have ? '' : 'opacity:0.5'}">${esc(label)}${have ? '' : ' 🔒'}</button>`;
    }).join('');
    const branches = [];
    for (const n of nodes) {
      const key2 = `${P ? P.name : 'General'}: ${n.branch}`;
      let b = branches.find((x) => x.k === key2);
      if (!b) branches.push((b = { k: key2, list: [] }));
      b.list.push(n);
    }
    const cols = branches.map((b) => `<div class="branch"><div class="mono dim">${esc(b.k.toUpperCase())}</div>${b.list.map((n) => {
      const r = state.skills[n.id] || 0;
      const chk = canLearn(state, n);
      const req = n.req ? nodes.find((x) => x.id === n.req[0]) : null;
      const why = chk.ok ? '' : chk.why === 'Locked' && req ? `Needs ${req.name} ${n.req[1]}` : chk.why.startsWith('Needs realm') ? `Needs ${REALMS[n.realm].name}` : chk.why;
      return `<button class="node ${n.tech ? 'tech' : ''} ${r ? 'has' : ''} ${r >= n.max ? 'max' : ''} ${chk.ok ? 'can' : ''}" data-action="learn" data-id="${n.id}" ${chk.ok ? '' : 'disabled'}>
        <div class="n-top"><b>${esc(n.name)}</b><span class="cn">${n.cn}</span></div>
        <div class="n-desc">${esc(n.desc)}</div>
        <div class="n-foot mono"><span>${r}/${n.max}</span><span>${n.cost} PT${n.cost > 1 ? 'S' : ''}</span>${why ? `<span class="n-why">${esc(why)}</span>` : ''}</div>
      </button>`;
    }).join('')}</div>`).join('');
    const intro = !P ? 'Training that helps every discipline.'
      : owned.includes(tab) ? `${esc(P.desc)} Techniques marked ◆ are learned here, then used with the ${esc(P.weapon.name)} in hand.`
      : `Buy the <b>${esc(P.weapon.name)}</b> at an Armory to open this tree. ${esc(P.desc)}`;
    return `<div class="tree-tabs">${tabs}</div><p class="panel-note">${intro} <b class="gold">${free}</b> skill point${free === 1 ? '' : 's'} free of ${pointsEarned(state)} earned (one per stage, five per breakthrough), shared by every tree. Reset them at any Martial Hall.</p><div class="tree">${cols}</div>`;
  }

  renderTrainer() {
    const g = this.game, s = g.state;
    const cost = g.respecCost();
    return `<p class="panel-note">The masters of the hall can unbind your skill points so you can spend them again. You hold ${this.wallet()}.</p>
      <div class="list"><div class="item"><div><h4>Reset skill points<span class="cn">洗点</span></h4><p>Refund every point you have spent, in every tree.</p></div><span class="price">${fmt(cost)} ◈</span><button class="btn small" data-action="respec" ${s.coins >= cost ? '' : 'disabled'}>Reset</button></div></div>`;
  }

  rewardText(r) {
    const parts = [];
    if (r.coins) parts.push(`<span class="price">${fmt(r.coins)} ◈</span>`);
    if (r.essence) parts.push(`<span class="price ess">${fmt(r.essence)} ✦</span>`);
    if (r.xp) parts.push(`<span class="price" style="color:var(--gd)">${fmt(r.xp)} EXP</span>`);
    if (r.insight) parts.push('<span class="price" style="color:#c08cff">REALM INSIGHT</span>');
    return parts.join(' ');
  }

  renderBounties() {
    const { state } = this.game;
    const docked = this.game.atStation && ['hall', 'station', 'bar', 'virtual'].includes(this.game.venueKind);
    const active = state.bounties.length
      ? state.bounties.map((b) => {
        const prog = b.type === 'cultivate' ? `${fmt(b.progress)}/${fmt(b.need)}` : `${b.progress}/${b.need}`;
        return `<div class="item"><div><h4>${esc(b.title)}</h4><p>${esc(b.desc)}</p><p class="mono">PROGRESS ${prog} · ${(REGIONS[b.region] || REGIONS[0]).name.toUpperCase()}</p></div><div>${this.rewardText(b.reward)}</div><button class="btn small danger" data-action="abandon" data-id="${b.id}">Abandon</button></div>`;
      }).join('')
      : '<p class="panel-note">No active bounties.</p>';
    let offers = '';
    if (docked) {
      const full = state.bounties.length >= MAX_BOUNTIES;
      offers = state.offers.length
        ? state.offers.map((b) => `<div class="item"><div><h4>${esc(b.title)}</h4><p>${esc(b.desc)}</p></div><div>${this.rewardText(b.reward)}</div><button class="btn small primary" data-action="accept" data-id="${b.id}" ${full ? 'disabled' : ''}>Accept</button></div>`).join('')
        : '<p class="panel-note">The board is empty. New contracts arrive while you are away.</p>';
      offers = `<div class="section-title">Bounty board${full ? ` · you carry the maximum of ${MAX_BOUNTIES}` : ''}</div><div class="list">${offers}</div>`;
    } else {
      offers = '<p class="panel-note" style="margin-top:14px">Visit a Martial Hall, a teahouse or a station to take new bounties. Rewards pay out the moment a contract is complete.</p>';
    }
    return `<div class="section-title" style="margin-top:0">Active contracts · ${state.bounties.length}/${MAX_BOUNTIES}</div><div class="list">${active}</div>${offers}`;
  }

  renderShop() {
    const { state } = this.game;
    const vk = this.game.venueKind;
    const pills = Object.entries(PILLS).map(([k, p], i) => {
      const price = priceFor(p.price, state.realm);
      return `<div class="item"><div><h4>${esc(p.name)}<span class="cn">${p.cn}</span></h4><p>${esc(p.desc)} Owned ${state.pills[k]}. Hotkey ${key(`pill${i + 1}`)}.</p></div><span class="price">${fmt(price)} ◈</span><button class="btn small" data-action="buy" data-item="${k}" ${state.coins >= price ? '' : 'disabled'}>Buy</button></div>`;
    }).join('');
    const manuals = ownedPaths(state).flatMap((id) => [PATHS[id].primary, ...PATHS[id].skills]).filter((k) => state.realm >= TECHS[k].unlockRealm && knows(state, k)).map((k) => {
      const t = TECHS[k];
      const m = state.mastery[k] || 1;
      const price = priceFor(MANUAL_PRICE * m, state.realm);
      const maxed = m >= 5;
      return `<div class="item"><div><h4>Manual: ${esc(t.name)}<span class="cn">${t.cn}秘籍</span></h4><p>Mastery ${m} to ${Math.min(5, m + 1)}: +25% power.</p></div><span class="price">${maxed ? 'MASTERED' : `${fmt(price)} ◈`}</span><button class="btn small" data-action="buy" data-item="manual" data-tech="${k}" ${!maxed && state.coins >= price ? '' : 'disabled'}>Buy</button></div>`;
    }).join('');
    const orePrice = SELL.ore(Math.min(state.realm, this.game.star.tier + 1));
    const sell = vk === 'pills' ? '' : `<div class="section-title">Sell materials</div><div class="list">
      <div class="item"><div><h4>Star metal<span class="cn">星金</span></h4><p>${fmt(orePrice)} ◈ each. You hold ${fmt(state.ore)}. Keep some for starships.</p></div><button class="btn small" data-action="sell" data-what="ore" data-frac="0.5" ${state.ore > 1 ? '' : 'disabled'}>Sell half</button><button class="btn small" data-action="sell" data-what="ore" data-frac="1" ${state.ore > 0 ? '' : 'disabled'}>Sell all</button></div>
      <div class="item"><div><h4>Beast essence<span class="cn">精华</span></h4><p>${SELL.essence} ◈ each. Refining it into experience at a forge is usually better.</p></div><button class="btn small" data-action="sell" data-what="essence" data-frac="0.5" ${state.essence > 1 ? '' : 'disabled'}>Sell half</button><button class="btn small" data-action="sell" data-what="essence" data-frac="1" ${state.essence > 0 ? '' : 'disabled'}>Sell all</button></div>
    </div>`;
    const rn = RADARS[(state.radar || 0) + 1];
    const radar = vk === 'pills' ? '' : `<div class="section-title">Scanners</div><div class="list">${rn
      ? `<div class="item"><div><h4>${esc(rn.name)}<span class="cn">${rn.cn}</span></h4><p>${esc(rn.desc)} Radar ${rn.range} m · pulse ${rn.ping >= 1000 ? `${rn.ping / 1000} km` : `${rn.ping} m`}.</p></div><span class="price">${fmt(rn.price)} ◈</span><button class="btn small" data-action="radar" ${state.coins >= rn.price ? '' : 'disabled'}>Install</button></div>`
      : '<p class="panel-note">You already carry the finest scanner in the galaxy.</p>'}</div>`;
    return `<p class="panel-note">Life, energy and spirit restored. You hold ${this.wallet()}.</p>${radar}
      <div class="section-title" style="margin-top:0">Pills and elixirs</div><div class="list">${pills}</div>
      ${vk === 'pills' ? '' : `<div class="section-title">Technique manuals</div><div class="list">${manuals}</div>`}${sell}`;
  }

  renderArmory() {
    const { state } = this.game;
    const cur = activePath(state);
    const rows = PATH_IDS.map((id) => {
      const p = PATHS[id];
      const have = owns(state, id);
      const btn = id === cur ? '<span class="tag done">IN HAND</span>'
        : have ? `<button class="btn small" data-action="equip" data-id="${id}">Equip</button>`
        : `<span class="price">${fmt(p.weapon.price)} ◈</span><button class="btn small ${state.coins >= p.weapon.price ? 'primary' : ''}" data-action="buy-weapon" data-id="${id}" ${state.coins >= p.weapon.price ? '' : 'disabled'}>Buy</button>`;
      const techs = [p.primary, p.secondary, ...p.skills].map((t) => TECHS[t].name).join(' · ');
      return `<div class="item"><div><h4 style="color:${hex(p.color)}">${esc(p.weapon.name)}<span class="cn">${p.weapon.cn}</span> <span class="mono dim" style="font-size:11px">${esc(p.name.toUpperCase())} · ${esc(p.style.toUpperCase())}</span></h4><p>${esc(p.weapon.desc)} ${esc(p.desc)}</p><p class="mono dim" style="font-size:11px">${esc(techs)}</p></div>${btn}</div>`;
    }).join('');
    return `<p class="panel-note">Every weapon brings its own discipline: its attacks, and a skill tree of techniques to learn. Carry as many as you like and switch with <kbd>${esc(codeLabel(settings.key('weaponNext')))}</kbd> or the mouse wheel. You hold ${this.wallet()}.</p><div class="list">${rows}</div>`;
  }

  renderForge() {
    const { state } = this.game;
    const cur = SWORD_GRADES[state.swordGrade];
    const next = SWORD_GRADES[state.swordGrade + 1];
    const track = SWORD_GRADES.map((g, i) => `<span class="${i <= state.swordGrade ? 'on' : ''}">${g.name}</span>`).join('');
    const can = next && state.coins >= next.coins && state.essence >= next.essence;
    return `<div class="forge">
      <div class="card">
        <div class="mono dim">FLYING SWORDS · ${this.game.stats.swords} BLADES</div>
        <h3>${esc(cur.name)} <span class="cn" style="color:var(--gd)">${cur.cn}</span></h3>
        <div class="grade-track">${track}</div>
        <div class="row"><span>Damage multiplier</span><span>×${cur.mult}</span></div>
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
        <button class="btn" data-action="refine" data-frac="0.25" ${state.essence > 0 ? '' : 'disabled'}>Refine a quarter</button>
        <button class="btn primary" data-action="refine" data-frac="1" ${state.essence > 0 ? '' : 'disabled'}>Refine all</button>
      </div>
    </div>`;
  }

  renderClinic() {
    const g = this.game, s = g.state;
    const cost = g.geneCost();
    const cap = g.geneCap();
    const lvl = s.gene || 0;
    return `<p class="panel-note">Gene optimisation fuses beast-derived genes into your body. Each level adds <b>6%</b> life and attack permanently. Your body can take <b>${cap}</b> levels at your realm. You hold ${this.wallet()}.</p>
      <div class="list"><div class="item"><div><h4>Gene enhancement · level ${lvl} → ${lvl + 1}<span class="cn">基因</span></h4><p>${lvl >= cap ? 'Your body cannot take more until your next breakthrough.' : 'A night in the pod. You will wake stronger.'}</p></div><span class="price">${fmt(cost)} ◈</span><button class="btn small primary" data-action="gene" ${s.coins >= cost && lvl < cap ? '' : 'disabled'}>Enhance</button></div></div>`;
  }

  renderChamber() {
    const g = this.game, s = g.state;
    const left = Math.max(0, s.chamberUntil - s.playtime);
    return `<p class="panel-note">A gravity chamber saturated with cosmic energy. While your rental lasts, cultivating <b>inside this room</b> earns <b>2.5×</b> experience. ${left > 0 ? `<b class="gold">${Math.ceil(left / 60)} min</b> remaining.` : ''} You hold ${this.wallet()}.</p>
      <div class="list"><div class="item"><div><h4>Rent 5 minutes<span class="cn">修炼室</span></h4><p>Time stacks. Press ${key('cultivate')} on a mat to begin.</p></div><span class="price">${fmt(g.chamberCost())} ◈</span><button class="btn small primary" data-action="chamber" ${s.coins >= g.chamberCost() ? '' : 'disabled'}>Rent</button></div></div>`;
  }

  renderBar() {
    const g = this.game, s = g.state;
    const couriers = s.offers.filter((b) => b.type === 'courier');
    const jobs = couriers.length
      ? couriers.map((b) => `<div class="item"><div><h4>${esc(b.title)}</h4><p>${esc(b.desc)}</p></div><div>${this.rewardText(b.reward)}</div><button class="btn small primary" data-action="accept" data-id="${b.id}" ${s.bounties.length >= MAX_BOUNTIES ? 'disabled' : ''}>Accept</button></div>`).join('')
      : '<p class="panel-note">No courier work right now. Check the Martial Hall board too.</p>';
    return `<p class="panel-note">The teahouse is where hunters trade stories. Buy a round and someone always knows something. You hold ${this.wallet()}.</p>
      <div class="list"><div class="item"><div><h4>Buy a round for the hunters<span class="cn">消息</span></h4><p>Hear a rumour about an unexplored ruin, spring, wreck or ore vein on this world. It appears on your compass.</p></div><span class="price">${fmt(g.rumorCost())} ◈</span><button class="btn small" data-action="rumor" ${s.coins >= g.rumorCost() ? '' : 'disabled'}>Listen</button></div></div>
      <div class="section-title">Courier jobs</div><div class="list">${jobs}</div>`;
  }

  renderFood() {
    const g = this.game, s = g.state;
    const meals = [
      ['spicy', 'Spicy Beast Noodles', '兽肉面', '+25% damage for 10 minutes.'],
      ['broth', 'Spirit Broth', '灵汤', '+50% energy and spirit recovery for 10 minutes.'],
      ['dumpling', 'Iron Dumplings', '铁饺', 'Full life now and 30% less damage taken for 10 minutes.'],
    ];
    const cur = s.meal && s.playtime < s.meal.until ? meals.find((m) => m[0] === s.meal.kind) : null;
    return `<p class="panel-note">${cur ? `You are still full from <b>${cur[1]}</b> (${Math.ceil((s.meal.until - s.playtime) / 60)} min). A new meal replaces it.` : 'Only one meal works at a time.'} You hold ${this.wallet()}.</p>
      <div class="list">${meals.map(([k, n, cn, d]) => `<div class="item"><div><h4>${n}<span class="cn">${cn}</span></h4><p>${d}</p></div><span class="price">${fmt(g.mealCost(k))} ◈</span><button class="btn small" data-action="meal" data-meal="${k}" ${s.coins >= g.mealCost(k) ? '' : 'disabled'}>Eat</button></div>`).join('')}</div>`;
  }

  renderHome() {
    const g = this.game, s = g.state;
    const city = g.lastService && g.lastService.service && g.lastService.service.city;
    const here = s.home && s.home.site === city && s.home.star === g.star.key;
    return `<p class="panel-note">${here ? `This is your home in <b>${esc(city)}</b>. You wake here if you fall.` : s.home ? `You rent a room in <b>${esc(s.home.site)}</b>. Renting here moves your home.` : 'Rent a room and this city becomes your home: you wake here if you fall.'} You hold ${this.wallet()}.</p>
      <div class="list">
        ${here ? '' : `<div class="item"><div><h4>Rent a room<span class="cn">公寓</span></h4><p>One payment, yours for good.</p></div><span class="price">${fmt(g.homeCost())} ◈</span><button class="btn small primary" data-action="home" ${s.coins >= g.homeCost() ? '' : 'disabled'}>Rent</button></div>`}
        <div class="item"><div><h4>Sleep until morning<span class="cn">休息</span></h4><p>Restore everything and wake when the sun is up.</p></div><button class="btn small" data-action="sleep" ${here ? '' : 'disabled'}>Sleep</button></div>
      </div>`;
  }

  renderArena() {
    const g = this.game, s = g.state;
    const wave = (s.arena || 0) + 1;
    return `<p class="panel-note">Step into the ring and face waves of this world's beasts while the crowd watches. Each wave is harder and pays more. Leave the ring and you forfeit. Best so far: <b>wave ${s.arena || 0}</b>.</p>
      <div class="list"><div class="item"><div><h4>Wave ${wave}<span class="cn">竞技场</span></h4><p>${Math.min(10, 2 + Math.floor(wave / 2))} beasts. Fight inside the sand circle.</p></div><button class="btn small primary" data-action="arena" ${g.arena ? 'disabled' : ''}>Enter the ring</button></div></div>`;
  }

  renderMall() {
    const g = this.game, s = g.state;
    const eta = g.deliveryEta();
    const pending = (s.deliveries || []).map((d) => `<li>${esc(d.label)} · ${Math.max(0, Math.ceil(d.due - s.playtime))} s</li>`).join('');
    const rows = g.mallCatalog().map((c) => `<div class="item"><div><h4>${esc(c.name)}</h4><p>${esc(c.desc)}</p></div><span class="price">${fmt(c.price)} ◈</span><button class="btn small" data-action="order" data-item="${c.id}" ${s.coins >= c.price ? '' : 'disabled'}>Order</button></div>`).join('');
    return `<p class="panel-note">Buy anything here and a drop pod delivers it to wherever your body is: city, wilds or deep space. Delivery to your current location takes about <b>${eta} s</b>. Prices include a 15% shipping fee. You hold ${this.wallet()}.</p>
      ${pending ? `<div class="section-title">On the way</div><ul class="tips">${pending}</ul>` : ''}
      <div class="list">${rows}</div>`;
  }

  renderSim() {
    const s = this.game.state;
    const best = s.simBest[`r${s.realm}`];
    return `<p class="panel-note">Holographic targets appear around the simulator. Hit all twelve with your primary attack as fast as you can. The first clear at each realm pays out; after that it's for the leaderboard.</p>
      <div class="list"><div class="item"><div><h4>Target practice<span class="cn">靶场</span></h4><p>${best !== undefined ? `Your best at this realm: <b>${best.toFixed(2)} s</b>` : 'Not yet cleared at this realm.'}</p></div><button class="btn small primary" data-action="sim">Start</button></div></div>`;
  }

  renderFame() {
    const s = this.game.state;
    const st = this.game.stats;
    const mins = Math.floor(s.playtime / 60);
    const rows = [
      ['Realm', `${REALMS[s.realm].name} · ${STAGES[s.stage].name}`], ['Weapon', PATHS[activePath(s)].weapon.name], ['Life · attack', `${fmt(st.maxHp)} · ${fmt(st.atk)}`],
      ['Beasts slain', fmt(s.kills)], ['Overlords slain', s.bosses.length], ['Bounties completed', s.completedBounties], ['Arena best', `wave ${s.arena || 0}`],
      ['Archive logs', `${(s.lore || []).length}/${LORE.length}`], ['Systems visited', s.visited.length], ['Places discovered', s.discovered.length], ['Time played', `${Math.floor(mins / 60)}h ${mins % 60}m`],
    ];
    return `<p class="panel-note">Your record in the Virtual Universe. One day, other cultivators will be listed here beside you.</p><div class="help-grid">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><span><b>${esc(String(v))}</b></span></div>`).join('')}</div>`;
  }

  renderStory() {
    const g = this.game;
    const c = g.state.campaign;
    if (!c || !c.started) {
      return `<p class="panel-note">Act I · <b>The Walled City</b>. A salvage convoy, an ambush in the ruins of the Aurean Concord, and a ring that talks back. Your realm, skills and items are kept.</p>
        <div class="actions-row"><button class="btn primary" data-action="story">Begin the story</button></div>`;
    }
    const rows = ACT1.map((m, i) => {
      const done = c.done.includes(m.id);
      const cur = i === c.mi;
      const step = cur ? m.steps[c.si] : null;
      const obj = step && step.text ? (typeof step.text === 'function' ? step.text() : step.text) : '';
      return `<div class="item story ${done ? 'done' : cur ? 'focus' : 'locked'}"><div><h4>${done ? '✓ ' : ''}${esc(m.title)} <span class="cn">${m.cn}</span></h4><p>${done ? 'Complete.' : cur ? esc(obj || 'In progress…') : 'Locked.'}</p></div></div>`;
    }).join('');
    const end = c.act1Done ? '<p class="panel-note gold">Act I complete. Act II is coming.</p>' : '';
    return `<p class="panel-note">Act I · <b>The Walled City</b> <span class="cn">第一幕 · 城墙</span></p>${end}<div class="list">${rows}</div>`;
  }

  renderArchive() {
    const { state } = this.game;
    const found = (state.lore || []).slice().sort((a, b) => a - b);
    const focus = this.loreFocus ?? found[found.length - 1];
    this.loreFocus = null;
    const list = LORE.map((l, i) => {
      const has = found.includes(i);
      return `<div class="item lore ${has ? '' : 'locked'} ${i === focus ? 'focus' : ''}"><div><h4>${has ? esc(l.title) : '— Missing log —'}</h4><p>${has ? esc(l.text) : 'Somewhere in the ruins of Terra, an old Concord terminal still holds this record.'}</p></div></div>`;
    }).join('');
    return `<p class="panel-note">Records of the Aurean Concord, the civilisation that ruled Terra before the Night of Teeth. Bunker terminals in the ruin fields still hold them. <b>${found.length}/${LORE.length}</b> recovered.</p><div class="list">${list}</div>`;
  }

  renderGuide() {
    const rows = ACTIONS.map((a) => `<div><span>${esc(a.label)}</span><span><b>${esc(codeLabel(settings.key(a.id)))}</b></span></div>`).join('');
    return `<ul class="tips">
      <li><b>Your homeworld.</b> You begin in Base City 07 on Terra. Terra has several walled base cities and outposts; beasts roam between them and grow stronger far from any city.</li>
      <li><b>Cities.</b> Walk into any building with a glowing door: exchanges, forges, pill shops, gene clinics, cultivation chambers, teahouses, noodle bars and apartments. The capital has an arena.</li>
      <li><b>Weapons.</b> You start with bare fists. Buy a saber, spear, throwing knives, bow, flying swords or a psionic focus at an <b>Armory</b>; each has its own skill tree of techniques (${key('panelSkills')}). Carry several and switch with ${key('weaponNext')}.</li>
      <li><b>Radar.</b> Press ${key('ping')} to hold up your scanner. It finds ore veins and wrecks, and better radars from the Exchange find more.</li>
      <li><b>Realms change how you play.</b> Fly at War God, leave the planet at Planetary, blink at Stellar, and at higher realms weak beasts flee or simply die in your presence.</li>
      <li><b>Every planet is a world</b> with its own beasts. Look for ancient ruins, energy springs, ore deposits, beast nests and wrecks.</li>
      <li><b>Cultivate</b> with ${key('cultivate')}. Springs, chambers, stars and nebulae are richest.</li>
      <li>At <b>Peak</b> stage, press ${key('breakthrough')} to face the <b>Heavenly Tribulation</b>. Keep moving.</li>
      <li><b>Skyjets and starships.</b> Buy a Skyjet at a shipyard to fly anywhere in the sky; at Planetary, upgrade to starships. Aim at any star with ${key('target')} and press ${key('engage')} in your ship to warp. Orbital stations can be landed on.</li>
    </ul>
    <div class="section-title">Controls · change them in Settings</div>
    <div class="help-grid">${rows}</div>`;
  }
}
