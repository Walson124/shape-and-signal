import * as THREE from 'three';
import {
  REALMS, STAGES, MAX_REALM, TECHNIQUES, ACTIVE_TECHNIQUES, PILLS, REGIONS, BOSSES, FINAL_BOSS, SWORD_GRADES, SHIPS, FLIGHT,
  xpScale, masteryMult, priceFor, MANUAL_PRICE, realmOf, essenceFor,
} from './data.js';
import { newState, loadState, saveState, clearSave, derive } from './state.js';
import { generateOffers, progressBounties, MAX_BOUNTIES } from './missions.js';
import { settings } from '../core/settings.js';
import { applyShaderFixes } from '../core/shaderfix.js';
import { Input } from '../core/input.js';
import { AudioEngine } from '../core/audio.js';
import { PostFX } from '../core/post.js';
import { clamp } from '../core/rng.js';
import { SkyBaker } from '../world/sky.js';
import { StarSystem } from '../world/system.js';
import { getStar, starsNear, HOME_KEY, CORE_KEY } from '../world/galaxy.js';
import { texPool } from '../world/texpool.js';
import { LensFlare } from '../world/flare.js';
import { SpaceDust } from '../world/dust.js';
import { puffTexture, glowTexture } from '../world/textures.js';
import { Particles } from './particles.js';
import { Combat } from './combat.js';
import { BeastManager } from './beasts.js';
import { Player, EYE } from './player.js';
import { Ship } from './ship.js';
import { SwordArray } from './swords.js';
import { ViewModel } from './viewmodel.js';
import { Loot } from './loot.js';
import { HUD, fmt, esc, hex } from '../ui/hud.js';
import { Menus } from '../ui/menus.js';

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tQ = new THREE.Quaternion();
const tM = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);
const SCAN_TIME = 1.6;
const POI_LABEL = { ruin: 'Ancient Ruins', spring: 'Energy Spring', ore: 'Star Metal Deposit', nest: 'Beast Nest', wreck: 'Wreck', lair: 'Overlord Lair' };
const POI_COLOR = { ruin: '#ffc857', spring: '#7affd8', ore: '#3ef2ff', nest: '#ff4466', wreck: '#b98cff', lair: '#ff3c7d' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Game {
  constructor(canvas) {
    applyShaderFixes();
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, logarithmicDepthBuffer: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.dynScale = 1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020308);
    this.scene.fog = new THREE.FogExp2(0x000000, 0);
    this.scene.environmentIntensity = 0.5;
    this.camera = new THREE.PerspectiveCamera(settings.get('fov'), 1, 0.1, 5e9);
    this.ambient = new THREE.AmbientLight(0x6070a0, 0.2);
    this.hemi = new THREE.HemisphereLight(0x9ab8ff, 0x3a3020, 0.1);
    this.scene.add(this.ambient, this.hemi);
    // Everything the player touches lives in this group. It is re-parented
    // between the star system and a planet's rotating surface.
    this.localRoot = new THREE.Group();
    this.localRoot.name = 'local';
    this.scene.add(this.localRoot);
    this.localRoot.add(this.camera);

    this.viewmodel = new ViewModel(this.scene);
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.viewmodel.scene, this.viewmodel.camera);
    this.flare = new LensFlare();
    this.post.overlays.push(this.flare);
    this.skyBaker = new SkyBaker(this.renderer);
    const preset = settings.preset;
    this.particles = new Particles(this.localRoot, preset.particles);
    this.dust = new SpaceDust(this.localRoot, preset.dust);
    this.sound = new AudioEngine();
    this.combat = new Combat(this.localRoot, this.particles, this.sound);
    this.beasts = new BeastManager(this.localRoot, this.particles, this.combat, this.sound);
    this.beasts.onKill = (b) => this.onBeastKilled(b);
    this.loot = new Loot(this.localRoot, this.particles, this.sound);
    this.swords = new SwordArray(this.localRoot, this.particles, this.combat, this.sound);
    this.player = new Player(this.localRoot, this.particles);
    this.shipObj = null;
    this.input = new Input(canvas);
    this.hud = new HUD();
    this.menus = new Menus(this);
    this.buildWarpLines();

    this.loaded = loadState();
    this.hasSave = !!this.loaded;
    this.state = this.loaded || newState();
    this.stats = derive(this.state);
    this.rt = this.freshRuntime();
    this.mode = 'loading';
    this.camMode = settings.get('camera');
    this.camQuat = new THREE.Quaternion();
    this.roll = 0;
    this.zoom = 1;
    this.time = 0;
    this.saveTimer = 0;
    this.titleAngle = 0;
    this.interact = null;
    this.aimTarget = null;
    this.notifyGate = {};
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.fps = 60;
    this.qualityChangePending = false;
    this.lastMouse = { x: 0, y: 0 };
    this.frame = null;
    this.env = { planet: null, up: null, floorR: null, inAtmo: false, alt: null, D: 0 };
    this.statics = new Map();
    this.nestTriggered = new Set();
    this.lastSpace = -1;
    this.markerList = [];
    this.nearStars = [];

    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onKey = (code) => this.onKey(code);
    canvas.addEventListener('click', () => {
      if (this.mode === 'playing' && !this.input.locked && !this.menus.overlayOpen) this.resume();
    });
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.inGame) this.save(); });
    window.addEventListener('beforeunload', () => { if (this.inGame) this.save(); });
    settings.onChange((k) => this.onSetting(k));
    this.resize();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frameLoop());
    this.boot();
  }

  get inGame() {
    return this.mode === 'playing' || this.mode === 'dead' || this.mode === 'warping';
  }

  freshRuntime() {
    return {
      hp: this.stats.maxHp, energy: this.stats.maxEnergy, spirit: this.stats.maxSpirit,
      cooldowns: { bolt: 0, swords: 0, burst: 0, body: 0, storm: 0 },
      shieldT: 0, meditating: false, medBlock: 0, hurtFlash: 0, lastHurt: -99,
      trib: null, deadT: 0, invuln: 0, nav: null, cruise: false, shake: 0, hand: 1,
      lock: null, controlling: false, spiritLock: false, scanT: 0, firingT: 0,
      inShip: false, warpCharge: 0, warpTarget: null,
    };
  }

  // ------------------------------------------------------------ setup --
  pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, settings.preset.pixelRatio) * settings.get('renderScale') * this.dynScale;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w;
    this.height = h;
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, pr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodel.setAspect(w / h);
    this.particles.setScale(h * pr, this.camera.fov);
  }

  onSetting(k) {
    if (k === 'quality') {
      this.post.build(this.width, this.height, this.pixelRatio());
      this.resize();
      this.qualityChangePending = true;
    } else if (k === 'renderScale' || k === 'dynamicRes') {
      if (k === 'dynamicRes' && !settings.get('dynamicRes')) this.dynScale = 1;
      this.resize();
    } else if (k === 'fov') {
      this.camera.fov = settings.get('fov');
      this.camera.updateProjectionMatrix();
    } else if (k === 'camera' && !this.inGame) {
      this.camMode = settings.get('camera');
    }
  }

  buildWarpLines() {
    const n = 600;
    this.warpData = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * 90;
      this.warpData.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: -20 - Math.random() * 700 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage));
    const col = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) col.set([...(Math.random() < 0.3 ? [1, 0.25, 0.55] : [0.25, 0.95, 1]), 0, 0, 0], i * 6);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.warpLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.warpLines.frustumCulled = false;
    this.warpLines.visible = false;
    this.camera.add(this.warpLines);
  }

  async boot() {
    this.menus.showLoading(true);
    this.menus.setLoading(0.04, 'CALIBRATING SENSORS');
    await sleep(60);
    try {
      const star = getStar(this.state.loc ? this.state.loc.star : HOME_KEY) || getStar(HOME_KEY);
      const sys = await this.buildSystem(star, (p) => this.menus.setLoading(0.08 + p * 0.5, 'GENERATING STAR SYSTEM'));
      this.menus.setLoading(0.6, 'BAKING STARFIELD');
      await sleep(20);
      this.installSystem(sys);
      this.restoreLocation();
      await this.warmTerrain((p) => this.menus.setLoading(0.65 + p * 0.3, 'RAISING TERRAIN'));
      this.swords.setup(this.stats.swords, this.state.swordGrade);
      this.swords.setVisible(false);
      try { this.renderer.compile(this.scene, this.camera); } catch { /* optional */ }
      this.menus.setLoading(1, 'READY');
      await sleep(250);
    } catch (err) {
      console.error(err);
      this.menus.setLoading(1, 'FAILED TO START · SEE CONSOLE');
      return;
    }
    this.menus.showLoading(false);
    this.enterTitle();
  }

  // Let the terrain under the player finish generating before revealing it.
  async warmTerrain(onProgress) {
    const start = performance.now();
    for (;;) {
      const el = performance.now() - start;
      if (el > 15000) break;
      this.positionCamera(0.016);
      this.system.update(0.016, this.state.worldTime, this.camera, this.playerWorld());
      onProgress(Math.min(1, el / 5000));
      if (texPool.busy === 0 && el > 500) break;
      await sleep(40);
    }
    onProgress(1);
  }

  buildSystem(star, onProgress) {
    return StarSystem.create(this.scene, star, settings.preset, (d, t) => onProgress && onProgress(t ? d / t : 1));
  }

  installSystem(sys) {
    // detach everything we own before the old system is disposed
    this.scene.add(this.localRoot);
    this.localRoot.position.set(0, 0, 0);
    this.localRoot.quaternion.identity();
    if (this.system) this.system.dispose();
    this.combat.clear();
    this.particles.clear();
    this.loot.clear();
    this.swords.clearPhantoms();
    this.beasts.clear();
    this.statics.clear();
    this.nestTriggered.clear();
    this.endTribulation();
    if (this.shipObj) {
      this.shipObj.dispose();
      this.shipObj = null;
    }
    this.system = sys;
    this.star = sys.star;
    sys.attach();
    this.frame = null;
    sys.root.add(this.localRoot);
    const baked = this.skyBaker.bake(this.star.region, this.star.pos, settings.preset.skyRes);
    this.scene.background = baked.background;
    this.scene.environment = baked.env;
    this.viewmodel.setEnv(baked.env);
    this.flare.setColor(sys.starType.glow);
    this.sound.setGalaxy(this.star.region);
    this.dust.setTint(REGIONS[this.star.region].sky[3]);
    this.hud.clearMarkers();
    this.hud.clearDamageNumbers();
    this.nearStars = starsNear(this.star.pos, 260).filter((s) => s.star.key !== this.star.key);
    this.markerList = sys.markers();
    this.rt.nav = null;
    this.rt.cruise = false;
    this.rt.lock = null;
    if (!this.state.visited.includes(this.star.key)) this.state.visited.push(this.star.key);
    this.qualityChangePending = false;
    sys.update(0, this.state.worldTime, this.camera, null);
  }

  // Attach the local frame to a planet (or open space), carrying everything along.
  setFrame(planet, carry = true) {
    const parent = planet ? planet.spin : this.system.root;
    if (this.localRoot.parent === parent) {
      this.frame = planet;
      return;
    }
    if (carry && this.localRoot.parent) {
      this.localRoot.updateWorldMatrix(true, false);
      parent.updateWorldMatrix(true, false);
      const m = new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(this.localRoot.matrixWorld);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      this.player.rebase(m, q);
      if (this.shipObj) this.shipObj.rebase(m, q);
      this.beasts.rebase(m, q);
      this.combat.rebase(m, q);
      this.swords.rebase(m, q);
      this.loot.rebase(m, q);
      this.particles.rebase(m, q);
      if (this.rt.trib) {
        this.rt.trib.clouds.position.applyMatrix4(m);
        this.rt.trib.clouds.quaternion.premultiply(q);
        for (const k of this.rt.trib.pending) k.pos.applyMatrix4(m);
      }
      this.camQuat.premultiply(q);
    }
    parent.add(this.localRoot);
    this.localRoot.position.set(0, 0, 0);
    this.localRoot.quaternion.identity();
    this.localRoot.updateWorldMatrix(true, false);
    this.frame = planet;
    this.statics.forEach((b) => this.beasts.removeBeast(b));
    this.statics.clear();
    this.nestTriggered.clear();
  }

  toWorld(v) {
    return this.localRoot.localToWorld(v.clone());
  }

  toLocal(v) {
    return this.localRoot.worldToLocal(v.clone());
  }

  playerWorld() {
    return this.toWorld(this.player.pos);
  }

  homePlanet() {
    const ps = this.system.planets;
    return ps.find((p) => p.body.sites.city && p.body.sites.city.main)
      || ps.find((p) => p.body.landable && (p.body.sites.city || p.body.sites.outposts.length));
  }

  restoreLocation() {
    const loc = this.state.loc;
    const p = this.player;
    if (loc && loc.star === this.star.key && Array.isArray(loc.pos)) {
      const planet = loc.body ? this.system.byId.get(loc.body) : null;
      this.setFrame(planet || null, false);
      p.pos.fromArray(loc.pos);
      p.quat.fromArray(loc.quat);
      p.mode = loc.mode || (planet ? 'ground' : 'space');
      p.vel.set(0, 0, 0);
      p.syncRoot();
    } else {
      this.spawnAtSettlement();
    }
    const sh = this.state.ship;
    if (sh && sh.star === this.star.key && Array.isArray(sh.pos)) {
      this.shipObj = new Ship(this.localRoot, sh.tier);
      const planet = sh.body ? this.system.byId.get(sh.body) : null;
      if ((planet || null) === this.frame) {
        this.shipObj.pos.fromArray(sh.pos);
        this.shipObj.quat.fromArray(sh.quat);
      } else {
        // the ship sits in another frame: convert through world space
        const holder = planet ? planet.spin : this.system.root;
        holder.updateWorldMatrix(true, false);
        const w = new THREE.Vector3().fromArray(sh.pos).applyMatrix4(holder.matrixWorld);
        this.shipObj.pos.copy(this.toLocal(w));
        this.shipObj.quat.fromArray(sh.quat);
      }
      this.shipObj.landed = !!sh.landed;
      this.shipObj.hull = Math.min(this.shipObj.maxHull, sh.hull ?? this.shipObj.maxHull);
      this.shipObj.sync();
      if (loc && loc.inShip && loc.star === this.star.key) this.rt.inShip = true;
    } else if (sh) {
      // a ship saved elsewhere (or by an older version) is delivered next to its owner
      this.shipObj = new Ship(this.localRoot, sh.tier);
      const up = this.frame ? p.pos.clone().normalize() : p.localUp();
      let pos = p.pos.clone().addScaledVector(p.forward().projectOnPlane(up).normalize(), 60);
      if (this.frame && this.frame.terrain) {
        const d = pos.clone().normalize();
        pos = d.multiplyScalar(this.frame.floorRadius(d.x, d.y, d.z) + this.shipObj.gearHeight);
        this.shipObj.landed = true;
      }
      this.shipObj.placeAt(pos, p.pos, up);
    }
    this.camQuat.copy(p.quat);
  }

  spawnAtSettlement(preferred) {
    let planet = preferred && (preferred.body.sites.city || preferred.body.sites.outposts.length) ? preferred : this.homePlanet();
    const p = this.player;
    if (!planet) {
      this.setFrame(null, true);
      const pos = new THREE.Vector3(this.system.starRadius * 14 + 200000, 0, 0);
      p.placeAt(pos, new THREE.Vector3(), Y);
      p.mode = 'space';
      this.camQuat.copy(p.quat);
      return;
    }
    this.setFrame(planet, true);
    planet.buildDetails();
    const s = planet.details.settlements[0];
    const up = s.spawnLocal.clone().normalize();
    const pos = s.spawnLocal.clone().addScaledVector(up, EYE + 0.5);
    p.placeAt(pos, s.group.position.clone().addScaledVector(up, 30), up);
    p.mode = 'ground';
    this.camQuat.copy(p.quat);
  }

  // ------------------------------------------------------- lifecycle --
  enterTitle() {
    this.mode = 'title';
    this.hud.show(false);
    this.player.setVisible(false);
    this.viewmodel.setVisible(false);
    this.swords.setVisible(false);
    this.post.vmEnabled = false;
    this.menus.showTitle(true, this.hasSave ? this.state : null);
    this.menus.showPause(false);
  }

  async requestNewGame() {
    if (this.hasSave) {
      const ok = await this.menus.confirm('Begin a new journey?', 'This erases your current cultivation progress for good.', 'Start over', true);
      if (!ok) return;
    }
    this.newGame();
  }

  async newGame() {
    clearSave();
    this.state = newState();
    this.stats = derive(this.state);
    this.rt = this.freshRuntime();
    this.player.setRealm(0);
    if (this.star.key !== HOME_KEY) {
      this.mode = 'loading';
      this.menus.showTitle(false);
      this.menus.showLoading(true);
      const sys = await this.buildSystem(getStar(HOME_KEY), (p) => this.menus.setLoading(p * 0.7, 'GENERATING STAR SYSTEM'));
      this.installSystem(sys);
      this.spawnAtSettlement();
      await this.warmTerrain((p) => this.menus.setLoading(0.7 + p * 0.3, 'RAISING TERRAIN'));
      this.menus.showLoading(false);
    } else {
      if (this.shipObj) { this.shipObj.dispose(); this.shipObj = null; }
      this.beasts.clear();
      this.endTribulation();
      this.spawnAtSettlement();
    }
    this.swords.setup(this.stats.swords, 0);
    this.save();
    this.hasSave = true;
    this.startPlaying();
  }

  continueGame() {
    this.stats = derive(this.state);
    const inShip = this.rt.inShip;
    this.rt = this.freshRuntime();
    this.rt.inShip = inShip && !!this.shipObj;
    this.player.setRealm(this.state.realm);
    this.swords.setup(this.stats.swords, this.state.swordGrade);
    this.startPlaying();
  }

  startPlaying() {
    this.mode = 'playing';
    this.camMode = settings.get('camera');
    this.menus.showTitle(false);
    this.hud.show(true);
    this.applyCamMode();
    this.swords.setVisible(!this.rt.inShip);
    this.swords.reset(this.player);
    this.viewmodel.setColor(REALMS[this.state.realm].color);
    this.sound.init();
    this.input.lock();
    this.camera.fov = settings.get('fov');
    this.camera.updateProjectionMatrix();
    this.camQuat.copy(this.rt.inShip && this.shipObj ? this.shipObj.quat : this.player.quat);
    if (!this.state.intro) {
      this.state.intro = true;
      const tips = [
        ['Welcome to <b>Base City 07</b>, Warrior. Beasts roam the wilds beyond the walls.', 'gold'],
        ['Your body is still bound to Terra. Reach the <b>War God</b> realm to fly, and <b>Planetary</b> to leave the planet.', 'violet'],
        ['Hold <kbd>RMB</kbd> to steer your flying swords. <kbd>LMB</kbd> fires Star Bolts. <kbd>Q</kbd> looses your swords.', ''],
        ['Hold <kbd>C</kbd> to cultivate. Energy springs, the beams of light in the wilds, are the richest places.', 'gold'],
        ['Visit the <b>Martial Hall</b> and <b>Exchange</b> in the city with <kbd>E</kbd> for bounties, pills and the sword forge.', 'yl'],
      ];
      tips.forEach(([t, k], i) => setTimeout(() => this.inGame && this.hud.notify(t, k), 900 + i * 3400));
      const home = this.homePlanet();
      const cityName = home && home.body.sites.city ? home.body.sites.city.name : 'Base City 07';
      this.hud.banner('SYSTEM ONLINE', cityName, `<span class="cn">基地市</span>${esc(home ? home.body.name : '')} · ${esc(this.star.name)} System`, '#3ef2ff', 4);
    } else {
      this.hud.notify(`Resumed at <b>${esc(this.locationLabel())}</b>.`, 'gold');
    }
  }

  applyCamMode() {
    const fp = this.camMode === 'first' && !this.rt.inShip;
    this.player.setVisible(!fp && !this.rt.inShip && this.mode !== 'dead');
    this.viewmodel.setVisible(fp && this.mode !== 'dead');
    this.post.vmEnabled = fp;
  }

  resume() {
    this.menus.showPause(false);
    this.sound.init();
    this.input.lock();
  }

  async quitToTitle() {
    this.save();
    this.loaded = this.state;
    this.hasSave = true;
    this.menus.showPause(false);
    this.endTribulation();
    this.rt.controlling = false;
    this.rt.warpCharge = 0;
    this.swords.controlling = false;
    this.hud.alert(null);
    this.enterTitle();
  }

  onLockChange(locked) {
    if (locked) this.menus.showPause(false);
    else if (this.inGame && !this.menus.overlayOpen) {
      this.menus.showPause(true);
      this.save();
    }
  }

  onKey(code) {
    const m = this.menus;
    if (code === 'Escape') {
      if (!m.$('modal').classList.contains('hidden')) { m.closeModal(null); return; }
      if (!m.$('settings').classList.contains('hidden')) { m.closeSettings(); return; }
      if (m.panelOpen) { this.closePanel(); return; }
      return;
    }
    if (this.mode !== 'playing' || !m.$('settings').classList.contains('hidden') || !m.$('modal').classList.contains('hidden')) return;
    if (code === 'KeyK') this.togglePanel('cultivation');
    else if (code === 'KeyJ') this.togglePanel('bounties');
    else if (code === 'KeyH') this.togglePanel('guide');
    else if (code === 'KeyN') this.hud.notify(this.sound.toggleMute() ? 'Sound muted.' : 'Sound on.');
  }

  togglePanel(kind, tab) {
    if (this.menus.panelKind === kind && (!tab || this.menus.panelTab === tab)) {
      this.closePanel();
      return;
    }
    this.menus.openPanel(kind, tab);
    this.input.unlock();
    this.sound.ui();
  }

  closePanel() {
    this.menus.closePanel();
    if (!this.inGame) return;
    this.input.lock();
    setTimeout(() => {
      if (!this.input.locked && !this.menus.overlayOpen && this.inGame) this.menus.showPause(true);
    }, 300);
  }

  get atStation() {
    return !!this.interact && (this.interact.kind === 'service' || this.interact.kind === 'station');
  }

  // ------------------------------------------------------------ frame --
  frameLoop() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 1) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.adaptResolution(this.fpsAcc / this.fpsFrames);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    if (!this.system) return;
    if (this.mode === 'title' || this.mode === 'loading') this.updateTitle(dt);
    else if (this.mode === 'warping') this.updateWarp(dt);
    else {
      const paused = this.menus.overlayOpen || (!this.input.locked && this.mode === 'playing');
      if (!paused) {
        this.update(dt);
        this.state.playtime += dt;
      } else {
        this.input.consumeMouse();
      }
    }
    this.sound.setListener(this.camera);
    this.post.render(this.time);
    this.input.endFrame();
  }

  adaptResolution(avg) {
    if (!settings.get('dynamicRes') || this.mode !== 'playing') return;
    let next = this.dynScale;
    if (avg > 1 / 45) next = Math.max(0.6, this.dynScale - 0.1);
    else if (avg < 1 / 58 && this.dynScale < 1) next = Math.min(1, this.dynScale + 0.05);
    if (Math.abs(next - this.dynScale) > 0.001) {
      this.dynScale = next;
      this.resize();
    }
  }

  updateTitle(dt) {
    this.titleAngle += dt * 0.04;
    const p = this.player;
    const target = this.rt.inShip && this.shipObj ? this.shipObj.pos : p.pos;
    const up = this.frame ? target.clone().normalize() : Y.clone();
    const ref = Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : Y;
    const east = new THREE.Vector3().crossVectors(ref, up).normalize();
    const north = new THREE.Vector3().crossVectors(east, up).normalize();
    const R = this.frame ? 420 : 900;
    const eye = target.clone().addScaledVector(up, this.frame ? 160 : 300).addScaledVector(east, Math.cos(this.titleAngle) * R).addScaledVector(north, Math.sin(this.titleAngle) * R);
    if (this.frame && this.frame.terrain) {
      const d = eye.clone().normalize();
      const floor = this.frame.floorRadius(d.x, d.y, d.z) + 60;
      if (eye.length() < floor) eye.setLength(floor);
    }
    this.camera.position.copy(eye);
    tM.lookAt(eye, target.clone().addScaledVector(up, 40), up);
    this.camera.quaternion.setFromRotationMatrix(tM);
    this.camera.updateMatrixWorld();
    this.state.worldTime += dt;
    this.system.update(dt, this.state.worldTime, this.camera, this.playerWorld());
    this.particles.update(dt);
    this.dust.update(this.camera.position, tB.set(0, 0, 0), 0);
    this.updateAtmosphereLighting();
    this.flare.update(this.camera, this.system.root.position, this.system.starRadius, this.flareOccluders(), dt);
    Object.assign(this.post.fx, { speed: 0, damage: 0, tintAmt: 0, glitch: 0, flash: 0 });
  }

  // ----------------------------------------------------------- update --
  update(dt) {
    const s = this.state, rt = this.rt, p = this.player, inp = this.input;
    const alive = this.mode === 'playing';
    let st = this.stats;
    s.worldTime += dt;

    // ---- input
    const mouse = inp.consumeMouse();
    const sens = 0.0021 * settings.get('sensitivity');
    const look = { x: mouse.x * sens, y: mouse.y * sens * (settings.get('invertY') ? -1 : 1) };
    this.lastMouse = mouse;
    const move = { x: 0, y: 0, z: 0 };
    if (alive) {
      if (inp.down('KeyW') || inp.down('ArrowUp')) move.z += 1;
      if (inp.down('KeyS') || inp.down('ArrowDown')) move.z -= 1;
      if (inp.down('KeyD') || inp.down('ArrowRight')) move.x += 1;
      if (inp.down('KeyA') || inp.down('ArrowLeft')) move.x -= 1;
      if (inp.down('Space')) move.y += 1;
      if (inp.down('KeyX')) move.y -= 1;
      if (inp.pressed.has('KeyP')) {
        this.camMode = this.camMode === 'first' ? 'third' : 'first';
        settings.set('camera', this.camMode);
        this.applyCamMode();
      }
    }
    const manual = move.x !== 0 || move.y !== 0 || move.z !== 0;
    rt.medBlock = Math.max(0, rt.medBlock - dt);
    rt.meditating = alive && !rt.inShip && inp.down('KeyC') && !manual && !rt.trib && rt.medBlock <= 0;

    // ---- sword control
    if (!inp.right) rt.spiritLock = false;
    rt.controlling = alive && !rt.inShip && inp.right && !rt.spiritLock && !rt.meditating && rt.spirit > 0;
    if (rt.controlling) {
      rt.spirit -= (8 + st.swords * 0.6) * dt;
      if (rt.spirit <= 0) {
        rt.spirit = 0;
        rt.spiritLock = true;
        rt.controlling = false;
        this.denied('Spirit sense exhausted. Your swords return.');
      }
    }
    this.swords.controlling = rt.controlling;
    if (alive && !rt.controlling && inp.wheel && (this.camMode === 'third' || rt.inShip)) this.zoom = clamp(this.zoom + inp.wheel * 0.12, 0.5, 3);

    // ---- movement
    const env = this.computeEnv(rt.inShip && this.shipObj ? this.shipObj.pos : p.pos);
    this.env = env;
    if (rt.inShip && this.shipObj) this.controlShip(dt, move, look, env, alive);
    else this.controlPlayer(dt, move, look, env, alive, manual);
    this.positionCamera(dt);

    // ---- world update (moves planets, refreshes terrain detail)
    this.system.update(dt, s.worldTime, this.camera, this.playerWorld());
    this.checkFrame();

    // ---- aim and targeting
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.aimTarget = this.pickAimTarget(camFwd);
    if (rt.lock && (!rt.lock.alive || rt.lock.pos.distanceTo(p.pos) > 2500)) rt.lock = null;
    if (alive && inp.pressed.has('Tab')) this.cycleLock(camFwd);
    const aimBeast = this.aimTarget || rt.lock;
    const aimPoint = this.aimTarget
      ? this.aimTarget.pos.clone().addScaledVector(this.aimTarget.vel, this.aimTarget.pos.distanceTo(p.pos) / 700)
      : this.camera.position.clone().addScaledVector(camFwd, 1500);

    // ---- techniques
    for (const k of ACTIVE_TECHNIQUES) rt.cooldowns[k] = Math.max(0, rt.cooldowns[k] - dt);
    rt.shieldT = Math.max(0, rt.shieldT - dt);
    rt.invuln = Math.max(0, rt.invuln - dt);
    rt.firingT = Math.max(0, rt.firingT - dt);
    const swordDamage = st.atk * SWORD_GRADES[s.swordGrade].mult * masteryMult(s.mastery.swords);
    if (alive && !rt.meditating) {
      if (inp.left && rt.cooldowns.bolt <= 0 && (rt.inShip || rt.energy >= TECHNIQUES.bolt.cost)) this.fireBolt(aimPoint, st);
      if (!rt.inShip) {
        if (inp.pressed.has('KeyQ')) this.castLaunch(camFwd, swordDamage * 1.6);
        if (inp.pressed.has('KeyZ')) this.hud.notify(`Sword formation: <b>${this.swords.toggleFormation() === 'swarm' ? 'Swarm' : 'Lance'}</b>.`, 'violet');
        if (inp.pressed.has('KeyR')) this.castBurst();
        if (inp.pressed.has('KeyF')) this.castBody();
        if (inp.pressed.has('KeyV')) this.castStorm(swordDamage * 2.2);
      }
      if (inp.pressed.has('Digit1')) this.usePill('heal');
      if (inp.pressed.has('Digit2')) this.usePill('energy');
      if (inp.pressed.has('Digit3')) this.usePill('cult');
    }
    if (alive) {
      if (inp.pressed.has('KeyB')) this.tryBreakthrough();
      if (inp.pressed.has('KeyT')) this.setTarget();
      if (inp.pressed.has('KeyG')) this.engage();
    }

    // ---- regeneration & cultivation
    const density = this.densityHere();
    const tier = this.locTier();
    const medRate = 1.0 * xpScale(tier) * density * (s.devour ? 1.5 : 1);
    if (alive) {
      if (!p.boosting) rt.energy = Math.min(st.maxEnergy, rt.energy + st.regen * dt * (rt.meditating ? 2.2 : 1));
      if (!rt.controlling) rt.spirit = Math.min(st.maxSpirit, rt.spirit + st.spiritRegen * dt * (rt.meditating ? 2 : 1));
      if (this.time - rt.lastHurt > 6) rt.hp = Math.min(st.maxHp, rt.hp + st.maxHp * 0.012 * dt);
      if (rt.meditating) {
        rt.hp = Math.min(st.maxHp, rt.hp + st.maxHp * 0.035 * dt);
        const gained = medRate * dt;
        this.addXp(gained);
        this.applyBounties(progressBounties(s, { kind: 'cultivate', amount: gained }));
        st = this.stats;
        const reg = REGIONS[this.star.region];
        const c = new THREE.Color(Math.random() < 0.5 ? reg.sky[0] : reg.sky[3]).lerp(p.auraColor, 0.4).multiplyScalar(1.5);
        const center = this.camMode === 'first' ? this.camera.position.clone().addScaledVector(camFwd, 2.5).addScaledVector(p.localUp(tA), -0.6) : p.pos;
        this.particles.converge(center, c, Math.round(1 + density * 1.2), 18 + density * 4, 26, 0.45);
      }
      if (this.shipObj && rt.inShip && this.shipObj.hull < this.shipObj.maxHull) this.shipObj.hull = Math.min(this.shipObj.maxHull, this.shipObj.hull + this.shipObj.maxHull * 0.005 * dt);
    }
    rt.hurtFlash = Math.max(0, rt.hurtFlash - dt);

    // ---- beasts, swords, combat, loot
    this.beasts.setEnv(this.beastEnv(tier));
    const ctx = { player: p, playerAlive: alive && rt.invuln <= 0, time: this.time, hurtPlayer: (d, pos, knock) => this.hurtPlayer(d, pos, knock) };
    this.beasts.update(dt, ctx);
    this.swords.setup(st.swords, s.swordGrade);
    this.swords.update(dt, {
      player: p, camera: this.camera, aimDir: camFwd, aimTarget: aimBeast, beasts: this.beasts.beasts, realm: s.realm,
      enemyShots: this.combat.enemyShots, wheel: rt.controlling ? inp.wheel : 0, swordDamage, up: env.up || p.localUp(),
      hit: (b, dmg, pos, kind, knock) => this.hitBeast(b, dmg, pos, kind, knock),
    });
    this.combat.update(dt, {
      beasts: this.beasts.beasts, player: p, playerAlive: alive && rt.invuln <= 0,
      solid: (pos) => this.isSolid(pos),
      hitBeast: (b, dmg, pos, kind, knock) => this.hitBeast(b, dmg, pos, kind, knock),
      hurtPlayer: (d, pos) => this.hurtPlayer(d, pos),
    });
    this.loot.update(dt, p, 70 + s.realm * 12, (it) => {
      if (it.kind === 'ore') {
        s.ore += Math.round(it.amount);
        this.dmgNum(p.pos.clone().addScaledVector(camFwd, 6), `+${Math.round(it.amount)} ⬢`, 'xp');
      } else {
        s.essence += it.amount;
        this.dmgNum(p.pos.clone().addScaledVector(camFwd, 6), `+${fmt(it.amount)} ✦`, 'xp');
      }
    });
    this.particles.update(dt);
    this.dust.update(this.camera.position, rt.inShip && this.shipObj ? this.shipObj.vel : p.vel, 0);
    this.updatePlanetFeatures();
    if (rt.trib) this.updateTribulation(dt);
    if (this.mode === 'dead') {
      rt.deadT -= dt;
      this.menus.setDeathCount(`REFORMING BODY IN ${Math.max(0, Math.ceil(rt.deadT))}`);
      if (rt.deadT <= 0) this.respawn();
    }
    this.updateWarpCharge(dt);
    this.updateInteraction(dt, alive);
    this.updatePresentation(dt, camFwd, density, medRate);
    this.saveTimer += dt;
    if (this.saveTimer > 10) {
      this.saveTimer = 0;
      this.save();
    }
  }

  // ------------------------------------------------------- environment --
  computeEnv(pos) {
    const planet = this.frame;
    if (!planet) return { planet: null, up: null, floorR: null, inAtmo: false, alt: null, D: 0 };
    const D = pos.length();
    const up = pos.clone().divideScalar(Math.max(D, 1e-6));
    if (!planet.body.landable) return { planet, up, floorR: null, inAtmo: D < planet.atmoR, alt: D - planet.R, D, gas: true };
    let floorR = planet.floorRadius(up.x, up.y, up.z);
    const roof = planet.collide(pos, this.rt.inShip ? 10 : this.player.radius);
    if (roof && roof > floorR && D > roof - 2) floorR = roof;
    return { planet, up, floorR, inAtmo: D < planet.atmoR, alt: D - floorR - (this.rt.inShip ? 0 : EYE), D };
  }

  locTier() {
    const f = this.frame;
    if (f && f.body.landable) {
      let t = f.body.tier;
      const city = f.body.sites.city;
      if (city && city.main && this.env.up) {
        // danger grows with distance from the home city
        const ang = Math.acos(clamp(this.env.up.dot(tA.set(city.x, city.y, city.z).normalize()), -1, 1));
        t = Math.max(t, Math.min(1.6, (ang / Math.PI) * 2.2));
      }
      return t;
    }
    return f ? f.body.tier : this.star.tier;
  }

  densityHere() {
    let d;
    if (this.frame && this.frame.body.landable && this.env.alt !== null && this.env.alt < 3000) d = 1.2;
    else d = this.system.densityAt(this.playerWorld());
    const details = this.frame && this.frame.details;
    if (details) {
      for (const poi of details.pois) {
        if (poi.poi.kind === 'spring' && poi.pos.distanceTo(this.player.pos) < poi.obj.range) d += 4;
      }
    }
    return d;
  }

  isSolid(pos) {
    const f = this.frame;
    if (!f || !f.body.landable) return false;
    const D = pos.length();
    if (D > f.R + f.body.amp + 50) return false;
    return D < f.groundRadius(pos.x / D, pos.y / D, pos.z / D);
  }

  beastEnv(tier) {
    const f = this.frame;
    if (f && f.body.landable && this.env.inAtmo) {
      const settlements = f.details && f.details.settlements;
      return {
        max: 6 + Math.round(tier * 2.5),
        interval: 5,
        despawn: 2200,
        ground: (pos) => {
          const D = pos.length();
          const up = pos.clone().divideScalar(D);
          return { up, floorR: f.floorRadius(up.x, up.y, up.z) };
        },
        resolve: (pos, r) => f.collide(pos, r),
        spawn: (pp) => {
          const up = pp.clone().normalize();
          const ref = Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : Y;
          const east = new THREE.Vector3().crossVectors(ref, up).normalize();
          const north = new THREE.Vector3().crossVectors(east, up).normalize();
          const a = Math.random() * Math.PI * 2, d = 160 + Math.random() * 320;
          const dir = up.clone().multiplyScalar(f.R).addScaledVector(east, Math.cos(a) * d).addScaledVector(north, Math.sin(a) * d).normalize();
          const terr = f.terrain;
          if (terr && terr.sea !== null && terr.height(dir.x, dir.y, dir.z) < terr.sea) return null;
          const pos = dir.clone().multiplyScalar(f.floorRadius(dir.x, dir.y, dir.z) + 6);
          if (settlements) for (const s of settlements) if (pos.distanceTo(s.group.position) < s.radius * 1.4) return null;
          return { pos, kind: 'ground', tier };
        },
      };
    }
    // open space: beasts near belts, nebulae and planets
    const field = this.system.field;
    const inBelt = field && field.inBelt > 0;
    return {
      max: inBelt ? 8 + Math.round(tier) : 4 + Math.round(tier),
      interval: 8,
      despawn: 5000,
      ground: null,
      resolve: null,
      spawn: (pp) => {
        const dir = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).normalize();
        return { pos: pp.clone().addScaledVector(dir, 700 + Math.random() * 900), kind: inBelt ? 'belt' : 'open', tier };
      },
    };
  }

  checkFrame() {
    const world = this.toWorld(this.rt.inShip && this.shipObj ? this.shipObj.pos : this.player.pos);
    let target = this.system.frameAt(world);
    if (!target && this.frame && world.distanceTo(this.frame.worldPos) < this.frame.soi * 1.08) target = this.frame;
    if (target !== this.frame) {
      const was = this.frame;
      this.setFrame(target, true);
      if (target) this.hud.notify(`Entering the sphere of <b>${esc(target.body.name)}</b>.`, 'violet');
      else if (was) this.hud.notify(`Leaving ${esc(was.body.name)} for open space.`, '');
    }
  }

  // ---------------------------------------------------------- control --
  controlPlayer(dt, move, look, env, alive, manual) {
    const p = this.player, rt = this.rt, st = this.stats, s = this.state;
    const canFly = FLIGHT.canFly(s.realm), canSpace = FLIGHT.canSpace(s.realm);
    const onWorld = env.planet && env.planet.body.landable;
    if (onWorld && env.inAtmo) {
      if (p.mode === 'space') p.mode = 'fly';
      if (!canFly) p.mode = 'ground';
    } else if (canSpace || !env.planet) {
      p.mode = 'space';
    }
    // a double tap on Space toggles flight on a world
    let jump = false;
    if (alive && this.input.pressed.has('Space')) {
      if (onWorld && env.inAtmo && canFly && this.time - this.lastSpace < 0.32) {
        p.mode = p.mode === 'fly' ? 'ground' : 'fly';
        this.hud.notify(p.mode === 'fly' ? 'You take to the sky.' : 'You drop back to the ground.', 'violet');
        this.lastSpace = -1;
      } else {
        if (!canFly && onWorld && !p.grounded && this.time - (this.notifyGate.flyHint || -99) > 25) {
          this.notifyGate.flyHint = this.time;
          this.hud.notify('Warriors cannot fly. Reach the <b>War God</b> realm to take to the sky.', 'violet');
        }
        this.lastSpace = this.time;
        jump = p.mode === 'ground';
      }
    }
    if (p.mode === 'fly' && onWorld && p.grounded && move.y < 0) p.mode = 'ground';

    let speed;
    let boost = alive && (this.input.down('ShiftLeft') || this.input.down('ShiftRight')) && manual && (p.mode === 'ground' || rt.energy > 1);
    if (p.mode === 'ground') speed = st.walk;
    else if (p.mode === 'fly') speed = onWorld ? Math.min(st.flySpeed, 160 + s.realm * 60) : st.flySpeed;
    else speed = st.spaceSpeed;
    if (rt.cruise) {
      if (!alive || (manual && move.z < 0) || p.mode !== 'space' || rt.meditating) {
        rt.cruise = false;
      } else {
        speed = this.cruiseSpeed(st.spaceSpeed, st.cruiseCap);
        boost = false;
        this.steerCruise(dt, look, move, p);
      }
    }
    if (boost && p.mode !== 'ground') rt.energy = Math.max(0, rt.energy - 9 * dt);
    p.look(look.x, look.y, { up: p.mode !== 'space' && env.up ? env.up : null });
    p.update(dt, move, {
      up: p.mode !== 'space' ? env.up : null,
      floorR: onWorld ? env.floorR : null,
      gravity: 18,
      jumpSpeed: st.jump,
      jump,
      speed,
      boost,
      accel: rt.cruise ? 1.6 : 2.6,
      meditating: rt.meditating,
      time: this.time,
      shield: rt.shieldT > 0,
      hidden: !alive || this.camMode === 'first',
      align: 4,
    });
    if (onWorld && !canSpace) {
      const pl = env.planet;
      const cap = Math.min(pl.atmoR * 0.985, pl.R + Math.max(pl.body.amp * 1.25, (pl.atmoR - pl.R) * 0.85));
      if (p.pos.length() > cap) {
        p.pos.setLength(cap);
        const up = p.pos.clone().normalize();
        const vn = p.vel.dot(up);
        if (vn > 0) p.vel.addScaledVector(up, -vn * 1.5);
        p.syncRoot();
        if (this.time > (this.notifyGate.void || 0)) {
          this.notifyGate.void = this.time + 8;
          this.hud.notify('The void would crush your body. Reach the <b>Planetary</b> realm to leave the planet.', 'red');
        }
      }
    }
    // settlements: walls and buildings push you out
    if (onWorld && env.D < env.planet.R + env.planet.body.amp + 400) env.planet.collide(p.pos, p.radius);
    this.hazards(dt, p.pos, env);
  }

  controlShip(dt, move, look, env, alive) {
    const ship = this.shipObj, rt = this.rt, p = this.player;
    const onWorld = env.planet && env.planet.body.landable;
    let speed = env.inAtmo ? Math.min(600, ship.def.speed) : ship.def.speed;
    const boost = alive && (this.input.down('ShiftLeft') || this.input.down('ShiftRight'));
    if (rt.cruise) {
      if (!alive || move.z < 0 || env.inAtmo) rt.cruise = false;
      else {
        speed = this.cruiseSpeed(ship.def.speed, ship.def.cruise);
        this.steerCruise(dt, look, move, ship);
      }
    }
    ship.look(look.x, look.y, { up: env.inAtmo ? env.up : null });
    ship.update(dt, alive ? move : { x: 0, y: 0, z: 0 }, { up: env.up, floorR: onWorld ? env.floorR : null, speed, boost: boost && !rt.cruise, inAtmo: env.inAtmo, accel: rt.cruise ? 1.4 : 1.2 });
    if (rt.warpCharge > 0) {
      ship.pos.add(tA.set((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3));
      ship.sync();
    }
    this.hazards(dt, ship.pos, env);
    p.pos.copy(ship.pos);
    p.vel.copy(ship.vel);
    p.quat.copy(ship.quat);
    p.boosting = boost;
    p.syncRoot();
  }

  hazards(dt, pos, env) {
    const st = this.stats;
    if (env.gas && env.D < env.planet.R * 1.04) {
      pos.setLength(env.planet.R * 1.04);
      this.hurtPlayer(st.maxHp * 0.15 * dt, null, null, true);
      if (this.time > (this.notifyGate.gas || 0)) {
        this.notifyGate.gas = this.time + 4;
        this.hud.notify('Crushing pressure! Gas giants have no surface to stand on.', 'red');
      }
    }
    const world = this.toWorld(pos);
    if (world.length() < this.system.starRadius * 1.4) {
      this.hurtPlayer(st.maxHp * 0.2 * dt, null, null, true);
      if (this.time > (this.notifyGate.burn || 0)) {
        this.notifyGate.burn = this.time + 4;
        this.hud.notify('The star’s corona is burning through you. Pull back!', 'red');
      }
    }
    // asteroid collisions in open space
    if (!this.frame) {
      const pad = this.rt.inShip && this.shipObj ? this.shipObj.radius : 2;
      for (const c of this.system.rockColliders(world, 400)) {
        const d = world.distanceTo(c.pos);
        const min = c.radius + pad;
        if (d < min && d > 1e-3) {
          // no rotation between the system root and the local frame here
          pos.addScaledVector(world.clone().sub(c.pos).divideScalar(d), min - d);
        }
      }
    }
  }

  // Speed grows with distance from anything massive, so you can't overshoot.
  cruiseSpeed(base, cap) {
    const world = this.playerWorld();
    let clear = world.length() - this.system.starRadius * 2;
    for (const p of this.system.planets) clear = Math.min(clear, world.distanceTo(p.worldPos) - p.atmoR);
    return clamp(clear * 0.55, base, cap);
  }

  steerCruise(dt, look, move, body) {
    const rt = this.rt;
    const nav = rt.nav;
    move.z = 1;
    if (!nav || nav.kind === 'star') return;
    const targetWorld = nav.world();
    const dir = this.toLocal(targetWorld).sub(body.pos).normalize();
    tM.lookAt(new THREE.Vector3(), dir, body.localUp(tA));
    tQ.setFromRotationMatrix(tM);
    body.quat.slerp(tQ, 1 - Math.exp(-dt * 2.5));
    look.x *= 0.15;
    look.y *= 0.15;
    const dist = targetWorld.distanceTo(this.playerWorld());
    if (dist < nav.arrive) {
      rt.cruise = false;
      this.hud.notify(`Arrived at <b>${esc(nav.label)}</b>.`, 'yl');
    }
  }

  positionCamera(dt) {
    const p = this.player, rt = this.rt;
    if (rt.inShip && this.shipObj) {
      const ship = this.shipObj;
      this.camQuat.slerp(ship.quat, 1 - Math.exp(-dt * 6));
      const off = tA.set(0, 7 * ship.scale, 30 * ship.scale).multiplyScalar(this.zoom).applyQuaternion(this.camQuat);
      this.camera.position.copy(ship.pos).add(off);
      this.camera.quaternion.copy(this.camQuat);
    } else if (this.camMode === 'first') {
      this.camQuat.slerp(p.quat, 1 - Math.exp(-dt * 30));
      const yawRate = (this.lastMouse.x * 0.0021) / Math.max(dt, 0.001);
      const localX = tA.copy(p.vel).applyQuaternion(this.camQuat.clone().invert()).x;
      const target = p.mode === 'ground' ? 0 : clamp(-localX * 0.0009 - yawRate * 0.004, -0.12, 0.12);
      this.roll += (target - this.roll) * (1 - Math.exp(-dt * 4));
      this.camera.position.copy(p.pos);
      if (p.mode === 'ground' && p.grounded) {
        const bob = Math.sin(p.walkPhase * 2) * Math.min(1, p.vel.length() / 8) * 0.05;
        this.camera.position.addScaledVector(p.up, bob);
      }
      this.camera.quaternion.copy(this.camQuat).multiply(tQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.roll));
    } else {
      this.camQuat.slerp(p.quat, 1 - Math.exp(-dt * 14));
      const off = tA.set(0, 1.4, 5.2).multiplyScalar(this.zoom).applyQuaternion(this.camQuat);
      this.camera.position.copy(p.pos).add(off);
      this.camera.quaternion.copy(this.camQuat);
    }
    // keep the camera above ground
    const f = this.frame;
    if (f && f.terrain) {
      const D = this.camera.position.length();
      const d = this.camera.position.clone().divideScalar(D);
      const floor = f.floorRadius(d.x, d.y, d.z) + 0.6;
      if (D < floor) this.camera.position.multiplyScalar(floor / D);
    }
    if (rt.shake > 0) {
      rt.shake = Math.max(0, rt.shake - dt * 3);
      if (settings.get('shake')) {
        const m = rt.shake * (this.camMode === 'first' ? 0.5 : 1.5);
        this.camera.position.add(tA.set((Math.random() - 0.5) * m, (Math.random() - 0.5) * m, (Math.random() - 0.5) * m));
      }
    }
    if (this.mode !== 'warping') {
      const base = settings.get('fov');
      const targetFov = base + (p.boosting ? 9 : 0) + (rt.cruise ? 10 : 0);
      if (Math.abs(this.camera.fov - targetFov) > 0.05) {
        this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-dt * 3));
        this.camera.updateProjectionMatrix();
        this.particles.setScale(this.height * this.pixelRatio(), this.camera.fov);
      }
    }
    this.camera.updateMatrixWorld();
  }

  pickAimTarget(camFwd) {
    let best = null, bestScore = Infinity;
    for (const b of this.beasts.beasts) {
      const to = tA.subVectors(b.pos, this.camera.position);
      const along = to.dot(camFwd);
      if (along < 0 || along > 1800) continue;
      const perp = Math.sqrt(Math.max(0, to.lengthSq() - along * along));
      if (perp < b.radius + along * 0.035) {
        const score = perp / (b.radius + along * 0.035) + along / 4000;
        if (score < bestScore) { bestScore = score; best = b; }
      }
    }
    return best;
  }

  cycleLock(camFwd) {
    const cands = this.beasts.beasts
      .map((b) => ({ b, ang: tA.subVectors(b.pos, this.camera.position).normalize().angleTo(camFwd), d: b.pos.distanceTo(this.player.pos) }))
      .filter((c) => c.ang < 0.9 && c.d < 1800)
      .sort((a, b) => a.ang - b.ang);
    if (!cands.length) { this.rt.lock = null; return; }
    const idx = cands.findIndex((c) => c.b === this.rt.lock);
    this.rt.lock = cands[(idx + 1) % cands.length].b;
    this.sound.lock();
  }

  // ------------------------------------------------------- techniques --
  fireBolt(aimPoint, st) {
    const rt = this.rt, T = TECHNIQUES.bolt;
    rt.cooldowns.bolt = T.cd * (rt.inShip ? 0.6 : 1);
    if (!rt.inShip) rt.energy -= T.cost;
    rt.firingT = 0.12;
    const cam = this.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(cam.quaternion);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    let origin;
    rt.hand = -rt.hand;
    if (rt.inShip && this.shipObj) {
      const sf = this.shipObj.forward();
      const sr = new THREE.Vector3(1, 0, 0).applyQuaternion(this.shipObj.quat);
      origin = this.shipObj.pos.clone().addScaledVector(sf, 14 * this.shipObj.scale).addScaledVector(sr, rt.hand * 3 * this.shipObj.scale);
    } else if (this.camMode === 'first') {
      if (rt.controlling) rt.hand = 1;
      origin = cam.position.clone().addScaledVector(fwd, 1.4).addScaledVector(right, rt.hand * 0.55).addScaledVector(down, 0.42);
      if (rt.hand > 0) this.viewmodel.castRight();
      else this.viewmodel.castLeft();
    } else {
      origin = this.player.pos.clone().addScaledVector(fwd, 1.5).addScaledVector(right, rt.hand * 0.5);
    }
    const dir = aimPoint.clone().sub(origin).normalize();
    const shipK = rt.inShip && this.shipObj ? 1.2 + this.shipObj.tier * 0.4 : 1;
    const dmg = st.atk * masteryMult(this.state.mastery.bolt) * shipK;
    const color = rt.inShip && this.shipObj ? SHIPS[this.shipObj.tier].color : REALMS[this.state.realm].color;
    this.combat.firePlayerBolt(origin, dir, dmg, color, rt.inShip ? 1400 : 700);
    this.sound.bolt();
  }

  castLaunch(camFwd, damage) {
    const s = this.state, rt = this.rt, T = TECHNIQUES.swords;
    if (rt.cooldowns.swords > 0) return;
    if (rt.spirit < T.cost) return this.denied('Not enough spirit sense.');
    rt.cooldowns.swords = T.cd;
    rt.spirit -= T.cost;
    const p = this.player;
    let targets = [];
    if (rt.lock && rt.lock.alive) targets.push(rt.lock);
    const range = (260 + 50 * s.realm) * 1.6;
    const cands = this.beasts.beasts
      .filter((b) => b !== rt.lock)
      .map((b) => ({ b, d: b.pos.distanceTo(p.pos), ang: tA.subVectors(b.pos, p.pos).normalize().angleTo(camFwd) }))
      .filter((c) => c.d < range && c.ang < 0.75)
      .sort((a, b) => a.ang - b.ang);
    targets = targets.concat(cands.map((c) => c.b));
    if (!targets.length) {
      const n = this.beasts.nearest(p.pos, 900);
      if (n) targets = [n];
    }
    targets = targets.slice(0, Math.max(1, Math.ceil(this.swords.swords.length / 2)));
    this.swords.launch(targets, damage);
    if (this.camMode === 'first') this.viewmodel.throwLeft();
  }

  castBurst() {
    const s = this.state, rt = this.rt, T = TECHNIQUES.burst;
    if (s.realm < T.unlockRealm) return this.denied(`Domain Burst unlocks at the ${REALMS[T.unlockRealm].name} realm.`);
    if (rt.cooldowns.burst > 0) return;
    if (rt.energy < T.cost) return this.denied('Not enough energy.');
    rt.cooldowns.burst = T.cd;
    rt.energy -= T.cost;
    const p = this.player;
    const radius = 60 + s.realm * 12;
    const dmg = this.stats.atk * 3.2 * masteryMult(s.mastery.burst);
    for (const b of [...this.beasts.beasts]) {
      if (b.pos.distanceTo(p.pos) < radius + b.radius) this.hitBeast(b, dmg, b.pos.clone(), 'burst', b.pos.clone().sub(p.pos).normalize().multiplyScalar(160));
    }
    this.combat.shockwave(p.pos, radius, REALMS[s.realm].color, 0.6);
    rt.shake = 0.8;
    this.post.fx.flash = 0.25;
    this.sound.burst();
  }

  castBody() {
    const s = this.state, rt = this.rt, T = TECHNIQUES.body;
    if (s.realm < T.unlockRealm) return this.denied(`Golden Body unlocks at the ${REALMS[T.unlockRealm].name} realm.`);
    if (rt.cooldowns.body > 0) return;
    if (rt.energy < T.cost) return this.denied('Not enough energy.');
    rt.cooldowns.body = T.cd;
    rt.energy -= T.cost;
    rt.shieldT = T.duration;
    this.particles.burst(this.player.pos, new THREE.Color(2, 1.6, 0.5), 50, 20, 0.6, 0.7);
    this.sound.shield();
  }

  castStorm(damage) {
    const s = this.state, rt = this.rt, T = TECHNIQUES.storm;
    if (s.realm < T.unlockRealm) return this.denied(`Ten Thousand Swords unlocks at the ${REALMS[T.unlockRealm].name} realm.`);
    if (rt.cooldowns.storm > 0) return;
    if (rt.energy < T.cost) return this.denied('Not enough energy.');
    rt.cooldowns.storm = T.cd;
    rt.energy -= T.cost;
    this.swords.storm(this.player.pos, this.beasts.beasts.filter((b) => !b.static), damage * masteryMult(s.mastery.storm), SWORD_GRADES[s.swordGrade].glow);
    this.hud.banner('ULTIMATE', 'Ten Thousand Swords', '<span class="cn">万剑归宗</span>', '#ffe44d', 2, true);
  }

  denied(msg) {
    if (this.time < (this.notifyGate[msg] || 0)) return;
    this.notifyGate[msg] = this.time + 2.5;
    this.hud.notify(msg, 'red');
    this.sound.deny();
  }

  usePill(k) {
    const s = this.state, rt = this.rt;
    if (s.pills[k] <= 0) return this.denied(`No ${PILLS[k].name}s left. Buy more at an exchange.`);
    s.pills[k]--;
    if (k === 'heal') rt.hp = Math.min(this.stats.maxHp, rt.hp + this.stats.maxHp * 0.6);
    else if (k === 'energy') { rt.energy = this.stats.maxEnergy; rt.spirit = this.stats.maxSpirit; }
    else if (k === 'cult') this.addXp(this.stats.xpNeed / 3);
    this.particles.burst(this.player.pos, new THREE.Color(k === 'heal' ? 0x5dffa8 : k === 'energy' ? 0x3ef2ff : 0xffc857).multiplyScalar(2), 40, 12, 0.5, 0.8);
    this.sound.pickup();
    this.hud.notify(`Consumed a ${PILLS[k].name} <span class="cn">${PILLS[k].cn}</span>.`, 'green');
  }

  // ----------------------------------------------------------- combat --
  dmgNum(localPos, text, kind) {
    this.hud.damageNumber(this.toWorld(localPos), text, kind);
  }

  hitBeast(b, dmg, pos, kind, knock) {
    if (!b.alive) return;
    const crit = Math.random() < 0.12;
    const amount = dmg * (crit ? 2 : 1) * (0.9 + Math.random() * 0.2);
    this.dmgNum(pos, fmt(amount), crit ? 'crit' : kind === 'sword' || kind === 'storm' ? 'sword' : '');
    if (kind === 'bolt') this.sound.hit(pos);
    if (b.static && b.def.color) this.particles.burst(pos, new THREE.Color(b.def.color).multiplyScalar(2), 8, 20, 0.5, 0.4);
    const killed = this.beasts.damage(b, amount, this.time, knock);
    this.hud.hitmarker(killed);
  }

  hurtPlayer(amount, pos, knock, silent = false) {
    const rt = this.rt;
    if (this.mode !== 'playing' || rt.invuln > 0) return;
    if (rt.inShip && this.shipObj) {
      // the hull soaks damage until it fails
      this.shipObj.hull -= amount * 0.6;
      if (!silent) {
        rt.shake = Math.min(1.2, rt.shake + 0.4);
        this.post.fx.damage = Math.min(1, this.post.fx.damage + 0.3);
        this.sound.hurt();
      }
      if (this.shipObj.hull > 0) return;
      this.shipObj.hull = this.shipObj.maxHull * 0.25;
      this.hud.notify('Hull breach! You are thrown from your ship.', 'red');
      this.exitShip(true);
      amount *= 0.5;
    }
    if (rt.shieldT > 0) amount *= 0.3;
    rt.hp -= amount;
    rt.lastHurt = this.time;
    if (!silent) {
      rt.hurtFlash = 0.4;
      rt.medBlock = 0.8;
      rt.shake = Math.min(1.2, rt.shake + 0.5);
      this.post.fx.damage = Math.min(1, this.post.fx.damage + 0.6);
      this.viewmodel.hit();
      this.sound.hurt();
      this.dmgNum(this.player.pos.clone().addScaledVector(this.player.forward(tA), 4), `-${fmt(amount)}`, 'player');
      rt.cruise = false;
    }
    if (knock) this.player.vel.add(knock);
    if (rt.hp <= 0) this.die();
  }

  die() {
    const s = this.state, rt = this.rt;
    rt.hp = 0;
    this.mode = 'dead';
    rt.deadT = 3.5;
    rt.meditating = false;
    rt.cruise = false;
    rt.controlling = false;
    rt.warpCharge = 0;
    this.swords.controlling = false;
    if (rt.inShip) this.exitShip(true);
    this.combat.explosion(this.player.pos, REALMS[s.realm].color, 1.5);
    this.player.setVisible(false);
    this.viewmodel.setVisible(false);
    this.swords.setVisible(false);
    this.sound.death();
    let text;
    if (rt.trib) {
      this.endTribulation();
      const lost = s.xp * 0.3;
      s.xp -= lost;
      text = `The tribulation lightning shatters your body. The breakthrough fails and you lose ${fmt(lost)} experience.`;
    } else {
      const lost = s.xp * 0.2;
      s.xp -= lost;
      text = `Your cultivation wavers. You lose ${fmt(lost)} experience.`;
    }
    this.menus.showDeath(true, text);
    this.hud.setPrompt(null);
    this.hud.alert(null);
    this.save();
  }

  respawn() {
    this.rt = this.freshRuntime();
    this.rt.invuln = 3;
    this.mode = 'playing';
    this.beasts.clear();
    this.combat.clear();
    this.loot.clear();
    this.statics.clear();
    const bind = this.state.bind;
    let planet = null;
    if (bind && bind.star === this.star.key && bind.body) planet = this.system.byId.get(bind.body) || null;
    this.spawnAtSettlement(planet);
    this.applyCamMode();
    this.swords.setVisible(true);
    this.swords.reset(this.player);
    this.menus.showDeath(false);
    this.particles.converge(this.player.pos, this.player.auraColor.clone().multiplyScalar(2), 120, 12, 14, 0.6);
    this.hud.notify(`Your body reforms at <b>${esc(this.locationLabel())}</b>.`, 'gold');
  }

  onBeastKilled(b) {
    const s = this.state, rt = this.rt;
    if (b.static) return;
    s.kills++;
    let xp = 18 * xpScale(b.tier) * b.def.xp * b.xpMult;
    if (!b.boss && b.tier < s.realm - 1) xp *= 0.25;
    if (s.devour) {
      xp *= 1.2;
      rt.hp = Math.min(this.stats.maxHp, rt.hp + this.stats.maxHp * 0.04);
    }
    const coins = Math.round(5 * Math.pow(2.2, b.tier) * b.def.coins * b.coinMult);
    s.coins += coins;
    const cores = Math.max(1, Math.round((b.def.cores || 1) * (b.elite ? 3 : 1)));
    this.loot.spawn(b.pos, essenceFor(b.tier) * cores, b.boss ? b.def.accent : 0xff3c7d, Math.min(cores, 12));
    const up = this.env.up || Y;
    this.dmgNum(b.pos.clone().addScaledVector(up, b.radius), `+${fmt(xp)} EXP`, 'xp');
    if (b.boss) {
      const key = b.bossIndex === FINAL_BOSS ? CORE_KEY : this.star.key;
      if (!s.bosses.includes(key)) s.bosses.push(key);
      if (!s.bosses.includes(this.star.key)) s.bosses.push(this.star.key);
      const ratio = rt.hp / this.stats.maxHp;
      this.stats = derive(s);
      rt.hp = ratio * this.stats.maxHp;
      const k = this.randomUpgradableTech();
      let extra = '';
      if (k) {
        s.mastery[k]++;
        extra = ` · ${TECHNIQUES[k].name} mastery ${s.mastery[k]}`;
      }
      this.hud.banner('OVERLORD SLAIN', b.def.name, `<span class="cn">${b.def.cn}</span>+10% life and attack${extra}`, hex(b.def.accent), 5);
      this.post.fx.flash = 0.5;
      if (b.bossIndex === FINAL_BOSS) setTimeout(() => this.hud.notify('The Primordial Devourer is gone. Nothing bars your path to <b>Universe Master</b>.', 'gold'), 2500);
    }
    this.applyBounties(progressBounties(s, { kind: 'kill', type: b.type, elite: b.elite, region: this.star.region, bossStar: b.boss ? this.star.key : null }));
    this.addXp(xp);
    if (b.boss) this.save();
  }

  // ------------------------------------------------------ progression --
  addXp(amount) {
    const s = this.state;
    s.xp += amount;
    let guard = 0;
    while (s.xp >= this.stats.xpNeed && guard++ < 20) {
      if (s.stage < 3) {
        s.xp -= this.stats.xpNeed;
        const ratio = this.rt.hp / this.stats.maxHp;
        s.stage++;
        this.stats = derive(s);
        this.rt.hp = Math.min(this.stats.maxHp, ratio * this.stats.maxHp + this.stats.maxHp * 0.2);
        this.hud.notify(`Advanced to <b>${REALMS[s.realm].name} · ${STAGES[s.stage].name}</b> <span class="cn">${REALMS[s.realm].cn}${STAGES[s.stage].cn}</span>`, 'gold');
        this.particles.burst(this.player.pos, this.player.auraColor.clone().multiplyScalar(2), 60, 16, 0.6, 1);
        this.sound.stageUp();
        this.save();
      } else {
        s.xp = this.stats.xpNeed;
        if (!this.peakNotified) {
          this.peakNotified = true;
          const bt = this.breakthroughStatus();
          if (bt.ready) this.hud.notify('Your cultivation has reached its <b>Peak</b>. Press <kbd>B</kbd> to face the Heavenly Tribulation.', 'gold');
          else if (bt.blocked) this.hud.notify(bt.blocked, 'violet');
        }
        break;
      }
    }
  }

  applyBounties(done) {
    for (const b of done) {
      const s = this.state;
      s.coins += b.reward.coins || 0;
      s.essence += b.reward.essence || 0;
      if (b.reward.xp) this.addXp(b.reward.xp);
      s.completedBounties++;
      this.hud.notify(`Bounty complete: <b>${esc(b.title)}</b>. +${fmt(b.reward.coins)} ◈ · +${fmt(b.reward.essence)} ✦${b.reward.xp ? ` · +${fmt(b.reward.xp)} exp` : ''}`, 'yl');
      this.sound.reward();
      this.save();
    }
  }

  breakthroughStatus() {
    const s = this.state;
    const full = s.stage === 3 && s.xp >= this.stats.xpNeed;
    if (!full || s.realm >= MAX_REALM || this.rt.trib) return { ready: false, blocked: null };
    if (s.realm === MAX_REALM - 1 && !s.bosses.includes(CORE_KEY)) return { ready: false, blocked: 'PEAK · SLAY THE PRIMORDIAL DEVOURER TO ASCEND' };
    return { ready: true, blocked: null };
  }

  tryBreakthrough() {
    const bt = this.breakthroughStatus();
    if (bt.blocked) return this.denied(bt.blocked);
    if (!bt.ready) {
      if (!this.rt.trib) this.denied('Reach Peak stage with full experience before breaking through.');
      return;
    }
    if (this.rt.inShip) return this.denied('Leave your ship to face the tribulation.');
    this.startTribulation();
  }

  tribUp() {
    return this.env.up ? this.env.up.clone() : this.player.localUp();
  }

  startTribulation() {
    const s = this.state, rt = this.rt;
    const clouds = new THREE.Group();
    const puff = puffTexture();
    for (let i = 0; i < 22; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: new THREE.Color(0.1, 0.06, 0.18), transparent: true, opacity: 0.92, depthWrite: false }));
      const a = (i / 22) * Math.PI * 2 + Math.random() * 0.3;
      const r = 20 + Math.random() * 170;
      sp.position.set(Math.cos(a) * r, (Math.random() - 0.5) * 30, Math.sin(a) * r);
      sp.scale.setScalar(120 + Math.random() * 100);
      clouds.add(sp);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0.8, 0.6, 2), blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false }));
    glow.scale.setScalar(220);
    clouds.add(glow);
    const up = this.tribUp();
    clouds.quaternion.setFromUnitVectors(Y, up);
    clouds.position.copy(this.player.pos).addScaledVector(up, 115);
    this.localRoot.add(clouds);
    rt.trib = { t: 0, dur: 16 + s.realm * 1.2, next: 2.2, interval: Math.max(0.5, 1.35 - s.realm * 0.08), pending: [], clouds, glow };
    rt.meditating = false;
    rt.cruise = false;
    this.hud.banner('WARNING', 'Heavenly Tribulation', '<span class="cn">天劫降临</span>The heavens test you. Keep moving.', '#d8c8ff', 3.5);
    this.sound.thunder();
  }

  updateTribulation(dt) {
    const tr = this.rt.trib, p = this.player, s = this.state;
    tr.t += dt;
    const up = this.tribUp();
    tr.clouds.position.lerp(tA.copy(p.pos).addScaledVector(up, 115), 1 - Math.exp(-dt * 2));
    tr.clouds.quaternion.slerp(tQ.setFromUnitVectors(Y, up), 1 - Math.exp(-dt * 2));
    tr.glow.material.opacity = Math.max(0, tr.glow.material.opacity - dt * 3);
    if (Math.random() < dt * 1.5) tr.glow.material.opacity = 0.25;
    tr.next -= dt;
    if (tr.next <= 0 && tr.t < tr.dur - 1.3) {
      tr.next = tr.interval * (0.75 + Math.random() * 0.5);
      const radius = 10 + s.realm * 0.6;
      const strike = (pos) => {
        this.combat.warning(pos, radius, 1.15);
        tr.pending.push({ pos, t: 1.15, radius });
      };
      const jitter = (h, v) => new THREE.Vector3((Math.random() - 0.5) * h, (Math.random() - 0.5) * h, (Math.random() - 0.5) * h).projectOnPlane(up).addScaledVector(up, (Math.random() - 0.5) * v);
      const lead = p.vel.clone().multiplyScalar(0.8 + Math.random() * 0.5);
      strike(p.pos.clone().add(lead).add(jitter(10, 5)));
      if (tr.t > tr.dur * 0.45 && Math.random() < 0.55) strike(p.pos.clone().add(jitter(40, 12)));
      this.sound.warn();
    }
    let danger = false;
    for (let i = tr.pending.length - 1; i >= 0; i--) {
      const k = tr.pending[i];
      k.t -= dt;
      if (k.t > 0) {
        if (p.pos.distanceTo(k.pos) < k.radius + p.radius + 2) danger = true;
        continue;
      }
      tr.pending.splice(i, 1);
      this.combat.lightning(k.pos, 0xc8b8ff, 420, up);
      this.sound.thunder(k.pos);
      tr.glow.material.opacity = 0.4;
      this.post.fx.flash = Math.max(this.post.fx.flash, 0.18);
      if (this.mode === 'playing' && p.pos.distanceTo(k.pos) < k.radius + p.radius) {
        this.hurtPlayer(this.stats.maxHp * 0.2, k.pos, p.pos.clone().sub(k.pos).normalize().multiplyScalar(60));
        this.rt.shake = 1.5;
      } else {
        this.rt.shake = Math.max(this.rt.shake, 0.4);
      }
      if (!this.rt.trib) return;
    }
    this.hud.alert(danger ? '⚠ STRIKE INCOMING · MOVE' : null);
    if (tr.t >= tr.dur && tr.pending.length === 0 && this.mode === 'playing') this.completeBreakthrough();
  }

  endTribulation() {
    const tr = this.rt && this.rt.trib;
    if (!tr) return;
    if (tr.clouds.parent) tr.clouds.parent.remove(tr.clouds);
    tr.clouds.traverse((o) => { if (o.material) o.material.dispose(); });
    this.rt.trib = null;
    this.hud.alert(null);
  }

  completeBreakthrough() {
    this.endTribulation();
    const s = this.state, rt = this.rt;
    s.realm++;
    s.stage = 0;
    s.xp = 0;
    this.peakNotified = false;
    this.stats = derive(s);
    rt.hp = this.stats.maxHp;
    rt.energy = this.stats.maxEnergy;
    rt.spirit = this.stats.maxSpirit;
    const realm = REALMS[s.realm];
    this.player.setRealm(s.realm);
    this.viewmodel.setColor(realm.color);
    this.combat.shockwave(this.player.pos, 140, realm.color, 1.4);
    this.particles.burst(this.player.pos, new THREE.Color(realm.color).multiplyScalar(1.6), 160, 60, 1, 1.6, 1);
    for (const b of [...this.beasts.beasts]) {
      if (!b.static && b.pos.distanceTo(this.player.pos) < 140 + b.radius) this.hitBeast(b, this.stats.atk * 5, b.pos.clone(), 'burst');
    }
    this.sound.breakthrough();
    rt.shake = 1.2;
    this.post.fx.flash = 0.7;
    this.hud.banner('BREAKTHROUGH', realm.name, `<span class="cn">${realm.cn}</span>${esc(realm.blurb)}`, hex(realm.color), 5);
    if (this.stats.swords > derive({ ...s, realm: s.realm - 1 }).swords) setTimeout(() => this.hud.notify(`A new flying sword answers your call. You now command <b>${this.stats.swords}</b>.`, 'violet'), 2000);
    for (const t of Object.values(TECHNIQUES)) {
      if (t.unlockRealm === s.realm) setTimeout(() => this.hud.notify(`New technique: <b>${t.name}</b> <span class="cn">${t.cn}</span>. Press <kbd>${t.key}</kbd>.`, 'violet'), 3000);
    }
    if (s.realm === 1) setTimeout(() => this.hud.notify('You can fly! <b>Double-tap Space</b> to take to the sky.', 'gold'), 4000);
    if (s.realm === 2) setTimeout(() => this.hud.notify('Your body can survive the void. Fly up and out of the atmosphere, and build a <b>starship</b> at a shipyard to reach other stars.', 'gold'), 4000);
    if (s.realm === MAX_REALM && !s.won) {
      s.won = true;
      setTimeout(() => this.hud.banner('ASCENDED', 'Universe Master', '<span class="cn">宇宙之主</span>You stand at the summit of the cosmos.', '#fff0b8', 8), 5200);
    }
    this.save();
  }

  // --------------------------------------------------- planet features --
  updatePlanetFeatures() {
    const f = this.frame;
    const p = this.player;
    const s = this.state;
    if (!f || !f.details) return;
    const tier = this.locTier();
    for (const poi of f.details.pois) {
      const id = poi.poi.id;
      const d = poi.pos.distanceTo(p.pos);
      if (d < 260 && !s.discovered.includes(id)) {
        s.discovered.push(id);
        this.hud.notify(`Discovered: <b>${POI_LABEL[poi.poi.kind]}</b> on ${esc(f.body.name)}.`, 'yl');
        this.applyBounties(progressBounties(s, { kind: 'discover' }));
      }
      if (poi.poi.kind === 'ore') {
        const mined = s.explored.includes(id);
        if (mined && poi.obj.group.visible) poi.obj.group.visible = false;
        const has = this.statics.get(id);
        if (!mined && d < 700 && !has) {
          const hp = 60 * Math.pow(2.6, tier) * 4;
          const b = this.beasts.spawnStatic({
            pos: poi.pos.clone().addScaledVector(poi.up, 3), radius: 7, hp, name: 'Star Metal Deposit', cn: '星金矿', color: 0x3ef2ff, tier,
            onKill: () => {
              if (!s.explored.includes(id)) s.explored.push(id);
              poi.obj.group.visible = false;
              this.statics.delete(id);
              const amount = Math.round(6 + tier * 5 + Math.random() * 6);
              this.loot.spawn(poi.pos.clone().addScaledVector(poi.up, 4), amount, 0x3ef2ff, 5, 'ore');
              this.applyBounties(progressBounties(s, { kind: 'mine' }));
              this.hud.notify('The deposit shatters into <b>star metal</b>.', 'green');
            },
          });
          this.statics.set(id, b);
        } else if (has && d > 1000) {
          this.beasts.removeBeast(has);
          this.statics.delete(id);
        }
      } else if (poi.poi.kind === 'nest' && d < 130 && !this.nestTriggered.has(id) && this.mode === 'playing') {
        this.nestTriggered.add(id);
        const type = tier >= 1 && Math.random() < 0.4 ? 'ray' : 'mite';
        const group = this.beasts.spawnGroup(type, poi.pos.clone().addScaledVector(poi.up, 8), type === 'ray' ? 3 : 5, tier + 0.3, true);
        group.forEach((b) => { if (Math.random() < 0.3) b.elite = true; });
        this.hud.notify('The nest stirs. Beasts pour out!', 'red');
      } else if (poi.poi.kind === 'lair' && d < 900 && this.star.boss !== null && this.star.boss !== undefined && !s.bosses.includes(this.star.key) && !this.beasts.liveBoss && this.mode === 'playing') {
        this.beasts.spawnBoss(this.star.boss, poi.pos.clone().addScaledVector(poi.up, 120), this.star.tier);
        const def = BOSSES[this.star.boss];
        this.hud.banner('OVERLORD', def.name, `<span class="cn">${def.cn}</span>has awakened`, hex(def.color), 4);
      }
    }
  }

  // ------------------------------------------------------ interaction --
  gatherInteractables() {
    const list = [];
    if (this.shipObj && !this.rt.inShip) list.push({ kind: 'ship', name: 'your ship', pos: this.shipObj.pos, range: 18 * this.shipObj.scale });
    const f = this.frame;
    if (f && f.details) {
      for (const sv of f.details.services) list.push({ kind: 'service', service: sv, name: sv.name, pos: sv.pos, range: sv.range });
      for (const poi of f.details.pois) {
        if (poi.poi.kind === 'ruin' || poi.poi.kind === 'wreck') list.push({ kind: 'poi', poi, name: POI_LABEL[poi.poi.kind], pos: poi.pos, range: poi.obj.range || 30 });
      }
    }
    for (const st of this.system.stations) {
      list.push({ kind: 'station', station: st, name: st.def.name, pos: this.toLocal(st.worldPos), range: 350 });
    }
    return list;
  }

  updateInteraction(dt, alive) {
    const p = this.player, rt = this.rt, inp = this.input;
    this.interact = null;
    if (alive) {
      const ref = rt.inShip && this.shipObj ? this.shipObj.pos : p.pos;
      let bd = Infinity;
      for (const it of this.gatherInteractables()) {
        if (rt.inShip && it.kind !== 'station') continue;
        const d = ref.distanceTo(it.pos);
        if (d < it.range && d < bd) { bd = d; this.interact = it; }
      }
      if (rt.inShip && !this.interact) this.interact = { kind: 'leave' };
    }
    const it = this.interact;
    let progress = 0;
    if (it && it.kind === 'poi' && !this.state.explored.includes(it.poi.poi.id) && inp.down('KeyE')) {
      rt.scanT += dt;
      progress = rt.scanT / SCAN_TIME;
      this.sound.scanTick();
      if (rt.scanT >= SCAN_TIME) {
        rt.scanT = 0;
        this.searchPoi(it.poi);
      }
    } else {
      rt.scanT = 0;
      if (it && inp.pressed.has('KeyE')) this.doInteract(it);
    }
    this.hud.setPrompt(this.promptText(it), progress);
  }

  promptText(it) {
    if (!it) return null;
    if (it.kind === 'leave') return this.canExitShip() ? '<kbd>E</kbd> LEAVE SHIP' : null;
    if (it.kind === 'ship') return '<kbd>E</kbd> BOARD YOUR SHIP';
    if (it.kind === 'service') return `<kbd>E</kbd> ${esc(it.name.toUpperCase())}`;
    if (it.kind === 'station') return `<kbd>E</kbd> DOCK AT ${esc(it.name.toUpperCase())}`;
    if (it.kind === 'poi') {
      if (this.state.explored.includes(it.poi.poi.id)) return `${esc(it.name.toUpperCase())} · ALREADY SEARCHED`;
      return `HOLD <kbd>E</kbd> ${it.poi.poi.kind === 'wreck' ? 'SALVAGE THE WRECK' : 'SEARCH THE RUINS'}`;
    }
    return null;
  }

  canExitShip() {
    const env = this.env;
    if (!this.shipObj) return false;
    if (this.shipObj.landed) return true;
    if (env.planet && env.planet.body.landable && env.inAtmo) return FLIGHT.canFly(this.state.realm);
    return FLIGHT.canSpace(this.state.realm);
  }

  doInteract(it) {
    const s = this.state;
    if (it.kind === 'leave') {
      if (this.canExitShip()) this.exitShip();
      else this.denied('You cannot leave the ship here. Land first.');
    } else if (it.kind === 'ship') {
      this.boardShip();
    } else if (it.kind === 'service' || it.kind === 'station') {
      this.rt.hp = this.stats.maxHp;
      this.rt.energy = this.stats.maxEnergy;
      this.rt.spirit = this.stats.maxSpirit;
      if (this.shipObj && this.rt.inShip) this.shipObj.hull = this.shipObj.maxHull;
      this.lastService = it;
      s.bind = { star: this.star.key, body: this.frame ? this.frame.body.id : null };
      if (s.offers.length < 3) s.offers.push(...generateOffers(s, { star: this.star }, 3 - s.offers.length));
      const kind = it.kind === 'station' ? 'shop' : it.service.kind === 'hall' ? 'bounties' : it.service.kind === 'shipyard' ? 'shipyard' : 'shop';
      this.menus.openPanel(kind);
      this.input.unlock();
      this.sound.confirm();
      this.save();
    }
  }

  boardShip() {
    if (!this.shipObj) return;
    this.rt.inShip = true;
    this.rt.meditating = false;
    this.rt.controlling = false;
    this.swords.controlling = false;
    this.swords.setVisible(false);
    this.applyCamMode();
    this.camQuat.copy(this.shipObj.quat);
    this.sound.confirm();
    if (!this.notifyGate.shipHelp) {
      this.notifyGate.shipHelp = 1;
      this.hud.notify('Systems online. <kbd>W</kbd> to fly, <kbd>T</kbd> to target, <kbd>G</kbd> to cruise or warp, <kbd>E</kbd> to leave.', 'yl');
    }
  }

  exitShip(forced = false) {
    const ship = this.shipObj, p = this.player;
    this.rt.inShip = false;
    this.rt.cruise = false;
    this.rt.warpCharge = 0;
    this.hud.alert(null);
    const up = this.env.up || ship.localUp();
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.quat);
    let pos = ship.pos.clone().addScaledVector(side, 12 * ship.scale).addScaledVector(up, 2);
    const onWorld = this.env.planet && this.env.planet.body.landable && this.env.inAtmo;
    if (onWorld && ship.landed) {
      const d = pos.clone().normalize();
      pos = d.multiplyScalar(this.env.planet.floorRadius(d.x, d.y, d.z) + EYE + 0.3);
    }
    p.placeAt(pos, pos.clone().add(ship.forward()), up);
    p.vel.copy(forced ? ship.vel.clone().multiplyScalar(0.3) : new THREE.Vector3());
    p.mode = onWorld ? (ship.landed ? 'ground' : 'fly') : 'space';
    if (onWorld && !FLIGHT.canFly(this.state.realm)) p.mode = 'ground';
    this.swords.setVisible(this.mode === 'playing');
    this.swords.reset(p);
    this.applyCamMode();
    this.camQuat.copy(p.quat);
  }

  searchPoi(poiRec) {
    const s = this.state;
    const id = poiRec.poi.id;
    if (!s.explored.includes(id)) s.explored.push(id);
    const tier = this.locTier();
    this.sound.reward();
    this.particles.converge(this.player.pos, new THREE.Color(0xffe08a).multiplyScalar(2), 60, 12, 16, 0.5);
    if (poiRec.poi.kind === 'wreck') {
      const c = Math.round(60 * Math.pow(2.2, tier) * (1 + Math.random()));
      const ore = Math.round(4 + tier * 3 + Math.random() * 5);
      s.coins += c;
      s.ore += ore;
      this.hud.notify(`You salvage the wreck: +${fmt(c)} star coins and ${ore} star metal.`, 'gold');
      if (Math.random() < 0.4) {
        const k = Math.random() < 0.6 ? 'heal' : 'energy';
        s.pills[k]++;
        this.hud.notify(`A sealed medkit holds a ${PILLS[k].name}.`, 'green');
      }
      this.save();
      return;
    }
    const xp = 135 * xpScale(tier) * (1 + Math.random() * 1.5);
    if (!s.devour) {
      s.devour = true;
      this.hud.banner('INHERITANCE', 'Devouring Art', '<span class="cn">吞噬秘法</span>Slain beasts restore life. Cultivation +50%.', '#ff9ad8', 5.5);
    } else {
      const k = this.randomUpgradableTech();
      if (k) {
        s.mastery[k]++;
        this.hud.notify(`The ruins hold a manual. <b>${TECHNIQUES[k].name}</b> mastery rises to ${s.mastery[k]}.`, 'violet');
      }
    }
    this.hud.notify(`Ancient energy flows from the ruins: +${fmt(xp)} experience.`, 'gold');
    this.addXp(xp);
    s.essence += essenceFor(tier) * 10;
    this.save();
  }

  randomUpgradableTech() {
    const s = this.state;
    const list = ACTIVE_TECHNIQUES.filter((k) => s.realm >= TECHNIQUES[k].unlockRealm && s.mastery[k] < 5);
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }

  buy(item, tech) {
    const s = this.state;
    let price;
    if (item === 'manual') {
      if (!tech || s.mastery[tech] >= 5) return;
      price = priceFor(MANUAL_PRICE * s.mastery[tech], s.realm);
    } else {
      price = priceFor(PILLS[item].price, s.realm);
    }
    if (s.coins < price) return this.sound.deny();
    s.coins -= price;
    if (item === 'manual') {
      s.mastery[tech]++;
      this.hud.notify(`<b>${TECHNIQUES[tech].name}</b> mastery rises to ${s.mastery[tech]}.`, 'violet');
    } else {
      s.pills[item]++;
    }
    this.sound.pickup();
    this.save();
  }

  forge() {
    const s = this.state;
    const next = SWORD_GRADES[s.swordGrade + 1];
    if (!next || s.coins < next.coins || s.essence < next.essence) return this.sound.deny();
    s.coins -= next.coins;
    s.essence -= next.essence;
    s.swordGrade++;
    this.swords.setup(this.stats.swords, s.swordGrade);
    this.swords.reset(this.player);
    this.sound.breakthrough();
    this.hud.notify(`Your swords are reforged as <b>${next.name}</b> <span class="cn">${next.cn}</span>. Damage ×${next.mult}.`, 'violet');
    this.save();
  }

  refine(frac) {
    const s = this.state;
    const amount = Math.floor(s.essence * frac);
    if (amount <= 0) return;
    s.essence -= amount;
    this.addXp(amount);
    this.sound.stageUp();
    this.hud.notify(`Refined ${fmt(amount)} essence into experience.`, 'gold');
    this.save();
  }

  buildShip(tier) {
    const s = this.state;
    const def = SHIPS[tier];
    const cur = s.ship ? s.ship.tier : -1;
    if (!def || s.realm < 2 || tier !== cur + 1) return this.sound.deny();
    if (s.coins < def.coins || s.ore < def.ore || s.essence < def.essence) return this.sound.deny();
    s.coins -= def.coins;
    s.ore -= def.ore;
    s.essence -= def.essence;
    const f = this.frame;
    const svc = this.lastService && this.lastService.service;
    const settlement = f && f.details && f.details.settlements.find((st) => st.services.includes(svc));
    if (this.shipObj) {
      this.shipObj.setTier(tier);
      this.shipObj.hull = this.shipObj.maxHull;
    } else {
      this.shipObj = new Ship(this.localRoot, tier);
    }
    // a new or upgraded hull is delivered to the pad here
    if (settlement && !this.rt.inShip) {
      const up = settlement.padLocal.clone().normalize();
      const look = settlement.group.position.clone();
      this.shipObj.landed = true;
      this.shipObj.placeAt(settlement.padLocal.clone().addScaledVector(up, this.shipObj.gearHeight), look, up);
    } else if (!this.rt.inShip) {
      const p = this.player;
      this.shipObj.placeAt(p.pos.clone().add(p.forward().multiplyScalar(80)), p.pos, p.localUp());
    }
    s.ship = { tier, star: this.star.key, body: f ? f.body.id : null, pos: this.shipObj.pos.toArray(), quat: this.shipObj.quat.toArray(), landed: this.shipObj.landed, hull: this.shipObj.hull };
    this.sound.breakthrough();
    this.hud.banner('SHIPYARD', def.name, `<span class="cn">${def.cn}</span>Warp range ${def.range} light years · waiting on the pad`, hex(def.color), 4);
    this.save();
  }

  acceptBounty(id) {
    const s = this.state;
    if (s.bounties.length >= MAX_BOUNTIES) return this.sound.deny();
    const i = s.offers.findIndex((b) => b.id === id);
    if (i < 0) return;
    s.bounties.push(s.offers[i]);
    s.offers.splice(i, 1);
    this.sound.confirm();
    this.save();
  }

  abandonBounty(id) {
    const s = this.state;
    s.bounties = s.bounties.filter((b) => b.id !== id);
    this.sound.ui();
    this.save();
  }

  // ------------------------------------------------------- navigation --
  markerTargets() {
    const list = [];
    for (const m of this.markerList) {
      let arrive = 2000;
      if (m.planet) arrive = m.planet.atmoR + 1500;
      else if (m.kind === 'star') arrive = this.system.starRadius * 4;
      else if (m.kind === 'station') arrive = 600;
      else if (m.radius) arrive = m.radius * 0.5;
      list.push({ key: m.key, kind: m.kind, label: m.label, world: () => m.ref.worldPos, arrive, pos: m.ref.worldPos });
    }
    if (this.shipObj && !this.rt.inShip) {
      const ship = this.shipObj;
      list.push({ key: 'ship', kind: 'ship', label: 'Your ship', world: () => this.toWorld(ship.pos), arrive: 60, pos: this.toWorld(ship.pos) });
    }
    return list;
  }

  setTarget() {
    const rt = this.rt;
    const cam = this.camera;
    const camWorld = cam.getWorldPosition(new THREE.Vector3());
    let best = null, bd = 0.2;
    for (const c of this.markerTargets()) {
      if (this.frame && c.key === this.frame.body.id) continue;
      tA.copy(c.pos).applyMatrix4(cam.matrixWorldInverse);
      if (tA.z > 0) continue;
      tA.copy(c.pos).project(cam);
      const d = Math.hypot(tA.x * cam.aspect, tA.y);
      if (d < bd) { bd = d; best = { ...c, kind: 'marker' }; }
    }
    if (!best) {
      let sd = 0.08;
      for (const { star, dist } of this.nearStars) {
        const dir = star.pos.clone().sub(this.star.pos).normalize();
        const far = camWorld.clone().addScaledVector(dir, 1e8);
        tA.copy(far).applyMatrix4(cam.matrixWorldInverse);
        if (tA.z > 0) continue;
        tA.copy(far).project(cam);
        const d = Math.hypot(tA.x * cam.aspect, tA.y);
        if (d < sd) { sd = d; best = { kind: 'star', star, dist, label: star.name }; }
      }
    }
    if (!best || (rt.nav && rt.nav.label === best.label)) {
      if (rt.nav) {
        rt.nav = null;
        rt.cruise = false;
        rt.warpCharge = 0;
        this.hud.notify('Target cleared.');
      } else {
        this.denied('Look toward a marker or a star and press T to target it.');
      }
      return;
    }
    rt.nav = best;
    rt.warpCharge = 0;
    if (best.kind === 'star') {
      const range = this.shipObj ? SHIPS[this.shipObj.tier].range : 0;
      const tail = this.shipObj
        ? best.dist <= range ? '. Press <kbd>G</kbd> in your ship to warp.' : `, beyond your ${range} ly range.`
        : '. You need a starship to go there.';
      this.hud.notify(`Star targeted: <b>${esc(best.star.name)}</b>, ${best.dist.toFixed(1)} light years${tail}`, 'yl');
    } else {
      this.hud.notify(`Course set: <b>${esc(best.label)}</b>. Press <kbd>G</kbd> to cruise.`, 'yl');
    }
    this.sound.lock();
  }

  engage() {
    const rt = this.rt;
    if (rt.warpCharge > 0) {
      rt.warpCharge = 0;
      this.hud.alert(null);
      this.hud.notify('Warp aborted.', 'red');
      return;
    }
    if (rt.nav && rt.nav.kind === 'star') return this.tryWarp(rt.nav.star, rt.nav.dist);
    if (rt.cruise) {
      rt.cruise = false;
      return;
    }
    const env = this.env;
    const inSpace = rt.inShip ? !env.inAtmo : this.player.mode === 'space';
    if (!inSpace) return this.denied(rt.inShip ? 'Leave the atmosphere before engaging the cruise drive.' : 'You can only cruise through open space.');
    rt.cruise = true;
    rt.meditating = false;
    if (!rt.nav) this.hud.notify('Cruise engaged. Steer with the mouse. Speed rises away from planets.', 'yl');
  }

  tryWarp(star, dist) {
    const rt = this.rt;
    if (!rt.inShip || !this.shipObj) return this.denied('You need a starship to cross the void between stars. Build one at a shipyard.');
    const range = SHIPS[this.shipObj.tier].range;
    if (dist > range) return this.denied(`${star.name} lies ${dist.toFixed(1)} light years away, beyond your ${range} ly warp range.`);
    const env = this.env;
    if (env.planet && env.D < env.planet.atmoR * 1.6) return this.denied('Too deep in a gravity well. Fly further from the planet before warping.');
    if (rt.trib) return this.denied('You cannot warp during a tribulation.');
    rt.warpCharge = 3;
    rt.warpTarget = star;
    rt.cruise = false;
    this.sound.warp();
  }

  updateWarpCharge(dt) {
    const rt = this.rt;
    if (rt.warpCharge <= 0) return;
    if (!rt.inShip || this.mode !== 'playing') {
      rt.warpCharge = 0;
      this.hud.alert(null);
      return;
    }
    rt.warpCharge -= dt;
    rt.shake = Math.max(rt.shake, 0.3);
    this.hud.alert(`WARP DRIVE CHARGING · ${Math.max(0, rt.warpCharge).toFixed(1)}`);
    if (rt.warpCharge <= 0) {
      this.hud.alert(null);
      this.startWarp(rt.warpTarget);
    }
  }

  startWarp(star) {
    this.mode = 'warping';
    this.warp = { t: 0, t2: 0, star, from: this.star, sys: null, swapped: false, failed: false };
    this.rt.meditating = false;
    this.rt.cruise = false;
    this.rt.controlling = false;
    this.swords.controlling = false;
    this.warpLines.visible = true;
    this.hud.setPrompt(null);
    this.hud.alert(null);
    this.buildSystem(star).then((sys) => { this.warp.sys = sys; }).catch((err) => {
      console.error(err);
      this.warp.failed = true;
    });
  }

  updateWarp(dt) {
    const w = this.warp, p = this.player;
    let inten, fade;
    if (!w.swapped) {
      w.t += dt;
      inten = Math.min(1, w.t / 1.0);
      fade = THREE.MathUtils.smoothstep(w.t, 0.7, 1.15);
      if (w.failed) {
        w.swapped = true;
        this.hud.notify('The warp corridor collapsed. Try again.', 'red');
      } else if (w.t >= 1.3 && w.sys) {
        w.swapped = true;
        this.arriveInSystem(w.sys, w.from);
      }
    } else {
      w.t2 += dt;
      inten = Math.max(0, 1 - w.t2 / 1.0);
      fade = 1 - THREE.MathUtils.smoothstep(w.t2, 0.05, 0.8);
    }
    document.getElementById('fade').style.opacity = fade;
    this.camera.fov = settings.get('fov') + inten * 40;
    this.camera.updateProjectionMatrix();
    const arr = this.warpLines.geometry.attributes.position.array;
    const speed = 500 + inten * 2600;
    for (let i = 0; i < this.warpData.length; i++) {
      const d = this.warpData[i];
      d.z += speed * dt;
      if (d.z > -10) d.z -= 700;
      const len = 4 + inten * 110;
      arr[i * 6] = d.x; arr[i * 6 + 1] = d.y; arr[i * 6 + 2] = d.z;
      arr[i * 6 + 3] = d.x; arr[i * 6 + 4] = d.y; arr[i * 6 + 5] = d.z - len;
    }
    this.warpLines.geometry.attributes.position.needsUpdate = true;
    this.warpLines.material.opacity = inten;
    if (this.shipObj) {
      this.shipObj.vel.copy(this.shipObj.forward()).multiplyScalar(w.swapped ? 400 * inten : 2000 + inten * 20000);
      this.shipObj.pos.addScaledVector(this.shipObj.vel, dt);
      this.shipObj.model.setThrust(1);
      this.shipObj.sync();
      p.pos.copy(this.shipObj.pos);
      p.quat.copy(this.shipObj.quat);
      p.syncRoot();
    }
    this.positionCamera(dt);
    this.state.worldTime += dt;
    this.system.update(dt, this.state.worldTime, this.camera, this.playerWorld());
    this.particles.update(dt);
    this.dust.update(this.camera.position, this.shipObj ? this.shipObj.vel : p.vel, inten);
    this.updateAtmosphereLighting();
    this.flare.update(this.camera, this.system.root.position, this.system.starRadius, this.flareOccluders(), dt);
    this.post.fx.speed = settings.get('speedBlur') ? inten : 0;
    this.post.fx.damage = 0;
    this.post.fx.flash = 0;
    this.post.fx.glitch = 0;
    this.input.consumeMouse();
    if (w.swapped && w.t2 >= 1.1) {
      this.mode = 'playing';
      this.warpLines.visible = false;
      document.getElementById('fade').style.opacity = 0;
      this.camera.fov = settings.get('fov');
      this.camera.updateProjectionMatrix();
      this.particles.setScale(this.height * this.pixelRatio(), this.camera.fov);
      this.rt.nav = null;
      if (!this.input.locked && !this.menus.overlayOpen) this.menus.showPause(true);
    }
  }

  // Swap in the destination system and drop out of warp facing its star.
  arriveInSystem(sys, from) {
    const p = this.player;
    this.installSystem(sys);
    const dir = from.pos.clone().sub(this.star.pos);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.y *= 0.2;
    dir.normalize();
    const arrive = dir.multiplyScalar(this.system.starRadius * 14 + 250000);
    this.shipObj = new Ship(this.localRoot, this.state.ship.tier);
    this.shipObj.placeAt(arrive, new THREE.Vector3(), Y);
    this.rt.inShip = true;
    p.pos.copy(arrive);
    p.quat.copy(this.shipObj.quat);
    p.vel.set(0, 0, 0);
    p.mode = 'space';
    p.syncRoot();
    this.camQuat.copy(this.shipObj.quat);
    this.save();
    const reg = REGIONS[this.star.region];
    const lair = this.star.boss !== null && this.star.boss !== undefined && !this.state.bosses.includes(this.star.key);
    const kicker = this.star.key === HOME_KEY ? 'HOMECOMING' : 'WARP COMPLETE';
    this.hud.banner(kicker, this.star.name, `<span class="cn">${reg.cn}</span>${esc(reg.name)} · ${esc(realmOf(this.star.tier).name)}-level threat${lair ? ` · ${esc(BOSSES[this.star.boss].name)} lairs here` : ''}`, reg.sky[3], 4.5);
    this.sound.arrive();
    this.clock.getDelta();
  }

  // ----------------------------------------------------- presentation --
  flareOccluders() {
    return this.system.planets.map((p) => ({ kind: 'planet', pos: p.worldPos, radius: p.R }));
  }

  updateAtmosphereLighting() {
    const f = this.frame;
    const sky = f && f.body.atmo ? f.skyState(this.system.root.position) : null;
    const fog = this.scene.fog;
    if (sky) {
      const thick = f.body.type === 'toxic' ? 2.4 : f.body.type === 'desert' ? 1.4 : 1;
      fog.density = 0.00011 * thick * Math.pow(1 - Math.min(1, sky.alt), 2);
      fog.color.copy(sky.color).multiplyScalar(0.06 + 0.85 * sky.day);
      this.hemi.intensity = 0.12 + 0.55 * sky.day;
      this.hemi.color.copy(sky.color).lerp(new THREE.Color(1, 1, 1), 0.3);
      this.ambient.intensity = 0.16 + 0.1 * sky.day;
    } else {
      fog.density = 0;
      this.hemi.intensity = 0.1;
      this.ambient.intensity = 0.2;
    }
    if (f) this.hemi.position.copy(this.camera.getWorldPosition(tA).sub(f.worldPos).normalize());
    else this.hemi.position.set(0, 1, 0);
  }

  locationLabel() {
    const f = this.frame;
    return f ? `${f.body.name} · ${this.star.name}` : `${this.star.name} system`;
  }

  updatePresentation(dt, camFwd, density, medRate) {
    const s = this.state, rt = this.rt, p = this.player;
    const fx = this.post.fx;
    fx.damage = Math.max(0, fx.damage - dt * 2.2);
    fx.flash = Math.max(0, fx.flash - dt * 1.6);
    const hpFrac = rt.hp / this.stats.maxHp;
    fx.glitch = this.mode === 'playing' && hpFrac < 0.3 ? ((0.3 - hpFrac) / 0.3) * 0.8 : 0;
    fx.tintAmt += ((rt.trib ? 0.55 : 0) - fx.tintAmt) * Math.min(1, dt * 3);
    const vel = rt.inShip && this.shipObj ? this.shipObj.vel : p.vel;
    const speed = vel.length();
    fx.speed = settings.get('speedBlur') ? (rt.cruise ? Math.min(0.8, speed / 60000) : p.boosting && p.mode !== 'ground' ? 0.35 : 0) : 0;
    this.updateAtmosphereLighting();

    const camWorld = this.camera.getWorldPosition(new THREE.Vector3());
    const sunDirView = this.system.root.position.clone().sub(camWorld).normalize().transformDirection(this.camera.matrixWorldInverse);
    this.viewmodel.update(dt, {
      mouseX: this.lastMouse.x, mouseY: this.lastMouse.y, speed: p.mode === 'ground' ? speed * 8 : speed, boost: p.boosting && !rt.controlling && p.mode !== 'ground',
      meditating: rt.meditating, controlling: rt.controlling, energyFrac: rt.energy / this.stats.maxEnergy, sunDirView, sunColor: this.system.sunColor,
    });
    this.viewmodel.updateThread(dt, this.camera, this.toWorld(this.swords.controlPoint), rt.controlling && this.camMode === 'first', this.time);
    this.flare.update(this.camera, this.system.root.position, this.system.starRadius, this.flareOccluders(), dt);
    this.sound.setIntensity(Math.min(1, this.beasts.aggroCount() / 5), !!rt.trib);
    this.sound.updateLoops({ swordSpeed: this.swords.avgSpeed, boost: p.boosting ? 1 : 0, speed: Math.min(speed, 2000) });

    const items = this.updateMarkers(camWorld);
    const target = rt.lock || this.aimTarget;
    this.hud.placeLock(rt.lock ? { pos: this.toWorld(rt.lock.pos), radius: rt.lock.radius } : null, this.camera, this.width, this.height);
    this.hud.placeCtrl(this.toWorld(this.swords.controlPoint), this.camera, this.width, this.height, rt.controlling, this.time);
    this.hud.updateDamageNumbers(dt, this.camera, this.width, this.height);
    this.drawNavInstruments(items, dt);

    const env = this.env;
    let modeLabel;
    if (rt.inShip && this.shipObj) modeLabel = rt.warpCharge > 0 ? 'WARP CHARGE' : rt.cruise ? 'CRUISE' : this.shipObj.landed ? 'SHIP · LANDED' : 'SHIP';
    else modeLabel = rt.cruise ? 'CRUISE' : { ground: 'ON FOOT', fly: 'FLIGHT', space: 'VOID' }[p.mode];
    const f = this.frame;
    const surface = f && f.body.landable && (env.inAtmo || (env.alt !== null && env.alt < 2000));
    const loc = {
      region: REGIONS[this.star.region].name,
      system: this.star.name,
      body: f ? `${f.body.name}${surface || env.inAtmo ? '' : ' · ORBIT'}` : 'Deep space',
      tier: this.locTier(),
      alt: f && f.body.landable && env.alt !== null ? Math.max(0, env.alt) : null,
      mode: modeLabel,
    };
    let starTarget = null;
    if (rt.nav && rt.nav.kind === 'star') {
      const st = rt.nav.star;
      starTarget = {
        name: st.name, dist: rt.nav.dist, tier: st.tier, boss: st.boss !== null && st.boss !== undefined && !s.bosses.includes(st.key), visited: s.visited.includes(st.key),
        inRange: this.shipObj ? rt.nav.dist <= SHIPS[this.shipObj.tier].range : null, range: this.shipObj ? SHIPS[this.shipObj.tier].range : 0,
      };
    }
    const nav = rt.nav && rt.nav.kind !== 'star' ? rt.nav : null;
    this.hud.update(dt, {
      state: s, stats: this.stats, rt, loc, density, medRate, bt: this.breakthroughStatus(),
      boss: this.beasts.liveBoss, target, locked: !!rt.lock && target === rt.lock, targetDist: target ? target.pos.distanceTo(p.pos) : 0,
      nav, navDist: nav ? Math.max(0, nav.world().distanceTo(camWorld) - nav.arrive * 0.5) : 0, cruise: rt.cruise,
      swordStates: this.swords.states(), formation: this.swords.formation, controlRange: 260 + 50 * s.realm, speed,
      controlling: rt.controlling, firing: rt.firingT > 0, aimTarget: this.aimTarget, camMode: rt.inShip ? 'ship' : this.camMode, fps: this.fps, renderScale: this.dynScale * settings.get('renderScale'),
      hull: rt.inShip && this.shipObj ? this.shipObj.hull / this.shipObj.maxHull : null, starTarget,
    });
  }

  // Heading and radar axes: north follows the planet's spin axis on a world.
  navAxes() {
    const p = this.player;
    const up = this.env.up ? this.env.up.clone() : p.localUp();
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y);
    if (north.lengthSq() < 1e-6) north.set(0, 0, -1).addScaledVector(up, -up.z);
    north.normalize();
    const east = new THREE.Vector3().crossVectors(north, up).normalize();
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const fh = f.clone().addScaledVector(up, -f.dot(up));
    if (fh.lengthSq() < 1e-6) fh.copy(p.localUp()).negate().addScaledVector(up, -p.localUp().dot(up));
    if (fh.lengthSq() < 1e-6) fh.copy(north);
    fh.normalize();
    const rh = new THREE.Vector3().crossVectors(fh, up).normalize();
    return { up, north, east, fh, rh };
  }

  drawNavInstruments(items, dt) {
    const ax = this.navAxes();
    const heading = Math.atan2(ax.fh.dot(ax.east), ax.fh.dot(ax.north));
    const origin = this.rt.inShip && this.shipObj ? this.shipObj.pos : this.player.pos;
    const bearing = (local) => {
      const d = local.clone().sub(origin);
      return Math.atan2(d.dot(ax.east), d.dot(ax.north));
    };
    const compass = [];
    const radar = [];
    const add = (local, color, size, shape, edge) => {
      const d = local.clone().sub(origin);
      radar.push({ f: d.dot(ax.fh), r: d.dot(ax.rh), u: d.dot(ax.up), color, size, shape, edge });
    };
    for (const it of items) {
      if (!it.compass) continue;
      const local = this.toLocal(it.pos);
      compass.push({ bearing: bearing(local), color: it.compass });
      add(local, it.compass, 5, 'diamond', true);
    }
    for (const b of this.beasts.beasts) {
      if (b.static) add(b.pos, '#3ef2ff', 3, 'diamond', false);
      else if (b.boss) {
        compass.push({ bearing: bearing(b.pos), color: '#ff3c7d' });
        add(b.pos, '#ff3c7d', 7, 'diamond', true);
      } else add(b.pos, b.elite ? '#ffe44d' : b.aggro ? '#ff4466' : '#ff8aa4', b === this.rt.lock ? 5 : 3);
    }
    for (const it of this.loot.items) add(it.g.position, it.kind === 'ore' ? '#3ef2ff' : '#ff3c7d', 2);
    this.hud.drawCompass(heading, compass);
    this.hud.drawRadar(dt, radar, this.frame && this.env.inAtmo ? 600 : 4000);
  }

  updateMarkers(camWorld) {
    const p = this.player, s = this.state, rt = this.rt;
    const origin = rt.inShip && this.shipObj ? this.shipObj.pos : p.pos;
    const list = [];
    const fmtKm = (d) => (d >= 1e9 ? `${(d / 1e9).toFixed(2)} GM` : d >= 1e6 ? `${(d / 1e6).toFixed(1)} MM` : d >= 1000 ? `${(d / 1000).toFixed(1)} KM` : `${Math.round(d)} M`);
    for (const m of this.markerList) {
      const world = m.ref.worldPos;
      const dist = camWorld.distanceTo(world);
      if (m.planet && m.planet === this.frame && dist < m.planet.atmoR * 1.3) continue;
      if (m.kind === 'hotspot' && dist > 2e7) continue;
      const surf = Math.max(0, dist - (m.radius || 0));
      const nav = !!rt.nav && rt.nav.kind === 'marker' && rt.nav.key === m.key;
      list.push({ key: m.key, kind: m.kind === 'moon' ? 'planet' : m.kind, label: esc(m.label), sub: fmtKm(surf), pos: world, dist, edge: nav, nav, compass: nav ? '#ffe44d' : null });
    }
    const f = this.frame;
    if (f && f.details) {
      for (const sv of f.details.services) {
        const d = sv.pos.distanceTo(origin);
        if (d > 3000) continue;
        list.push({ key: `svc:${sv.name}`, kind: 'station', label: esc(sv.name), sub: fmtKm(d), pos: this.toWorld(sv.pos.clone().addScaledVector(sv.pos.clone().normalize(), 8)), dist: d, edge: false, compass: d < 1500 ? '#3ef2ff' : null });
      }
      for (const poi of f.details.pois) {
        const d = poi.pos.distanceTo(origin);
        const known = s.discovered.includes(poi.poi.id);
        if (d > (known ? 4000 : 1200)) continue;
        if (poi.poi.kind === 'ore' && s.explored.includes(poi.poi.id)) continue;
        const done = (poi.poi.kind === 'ruin' || poi.poi.kind === 'wreck') && s.explored.includes(poi.poi.id);
        const color = POI_COLOR[poi.poi.kind];
        list.push({ key: poi.poi.id, kind: 'hotspot', label: `<span style="color:${color}">${POI_LABEL[poi.poi.kind].toUpperCase()}${done ? ' ✓' : ''}</span>`, sub: fmtKm(d), pos: this.toWorld(poi.pos.clone().addScaledVector(poi.up, 10)), dist: d, edge: false, compass: d < 1500 ? color : null });
      }
    }
    if (this.shipObj && !rt.inShip) {
      const d = this.shipObj.pos.distanceTo(p.pos);
      list.push({ key: 'ship', kind: 'gate', label: 'YOUR SHIP', sub: fmtKm(d), pos: this.toWorld(this.shipObj.pos), dist: d, edge: true, compass: '#b98cff' });
    }
    if (rt.nav && rt.nav.kind === 'star') {
      const dir = rt.nav.star.pos.clone().sub(this.star.pos).normalize();
      list.push({ key: 'navstar', kind: 'nav', label: esc(rt.nav.star.name), sub: `${rt.nav.dist.toFixed(1)} LY`, pos: camWorld.clone().addScaledVector(dir, 1e8), dist: 1e8, edge: true, nav: true, compass: '#ffe44d' });
    }
    const boss = this.beasts.liveBoss;
    if (boss) list.push({ key: 'boss', kind: 'boss', label: esc(boss.name), pos: this.toWorld(boss.pos), dist: boss.pos.distanceTo(origin), edge: true, hp: boss.hp / boss.maxHp });
    if (this.mode === 'playing') {
      const near = [];
      for (const b of this.beasts.beasts) {
        if (b.boss) continue;
        const d = b.pos.distanceTo(origin);
        if (d < 450 || this.time - b.lastHit < 4 || b === this.aimTarget || b === rt.lock) near.push([d, b]);
      }
      near.sort((a, b) => a[0] - b[0]);
      const up = this.env.up || Y;
      for (const [d, b] of near.slice(0, 12)) {
        const mp = b.pos.clone().addScaledVector(up, b.radius + 2);
        const rcls = b.static ? '#3ef2ff' : b.tier - s.realm > 1.01 ? '#ff4466' : b.tier - s.realm > 0.25 ? '#ffe44d' : '#ff9aac';
        const focus = b === this.aimTarget || b === rt.lock || this.time - b.lastHit < 2.5 || d < 60;
        list.push({ key: `b:${b.uid}`, kind: 'beast', label: focus ? `<span style="color:${rcls}">${esc(b.name)}</span>` : '', sub: focus ? `${realmOf(b.tier).name.toUpperCase()} · ${Math.round(d)}` : '', pos: this.toWorld(mp), dist: d, edge: false, hp: b.hp / b.maxHp });
      }
    }
    this.hud.updateMarkers(list, this.camera, this.width, this.height);
    return list;
  }

  // -------------------------------------------------------------- save --
  save() {
    const s = this.state;
    if (this.mode === 'loading' || this.mode === 'warping' || !this.system) return;
    const p = this.player;
    s.loc = {
      star: this.star.key,
      body: this.frame ? this.frame.body.id : null,
      pos: p.pos.toArray(),
      quat: p.quat.toArray(),
      mode: p.mode,
      inShip: this.rt.inShip,
      label: this.locationLabel(),
    };
    if (this.shipObj) {
      s.ship = {
        tier: this.shipObj.tier, star: this.star.key, body: this.frame ? this.frame.body.id : null,
        pos: this.shipObj.pos.toArray(), quat: this.shipObj.quat.toArray(), landed: this.shipObj.landed, hull: this.shipObj.hull,
      };
    }
    saveState(s);
  }
}
