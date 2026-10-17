import * as THREE from 'three';
import {
  REALMS, STAGES, MAX_REALM, PILLS, REGIONS, BOSSES, FINAL_BOSS, SWORD_GRADES, SHIPS, FLIGHT, SELL, RADARS,
  xpScale, masteryMult, priceFor, MANUAL_PRICE, realmOf, essenceFor,
} from './data.js';
import { PATHS, TECHS, REALM_PERKS, canLearn, nodeById, activePath, ownedPaths, owns, knows } from './paths.js';
import { Arts } from './arts.js';
import { Companion } from './companion.js';
import { LORE, RUIN_NAMES } from './lore.js';
import { VirtualWorld } from './virtual.js';
import { Cutscene } from './cutscene.js';
import { Campaign } from './campaign.js';
import { speciesForBody, AQUATIC } from './bestiary.js';
import { codeLabel } from '../core/bindings.js';
import { newState, loadState, saveState, clearSave, derive } from './state.js';
import { generateOffers, progressBounties, insightTrial, MAX_BOUNTIES } from './missions.js';
import { settings, detectGpu, QUALITY_ORDER } from '../core/settings.js';
import { applyShaderFixes } from '../core/shaderfix.js';
import { initPrecompile } from '../core/precompile.js';
import { Input } from '../core/input.js';
import { AudioEngine } from '../core/audio.js';
import { PostFX } from '../core/post.js';
import { clamp } from '../core/rng.js';
import { SkyBaker } from '../world/sky.js';
import { StarSystem } from '../world/system.js';
import { getStar, starsNear, HOME_KEY, CORE_KEY } from '../world/galaxy.js';
import { recordJump } from './starmap.js';
import { WorldEater } from './worldeater.js';
import { propWind } from '../world/props.js';
import { Grass } from '../world/grass.js';
import { texPool } from '../world/texpool.js';
import { LensFlare } from '../world/flare.js';
import { SpaceDust } from '../world/dust.js';
import { puffTexture, glowTexture } from '../world/textures.js';
import { Particles } from './particles.js';
import { Combat } from './combat.js';
import { BeastManager } from './beasts.js';
import { Player, EYE } from './player.js';
import { Ship } from './ship.js';
import { Vehicle, VEHICLES } from './vehicle.js';
import { RING_TIERS, ITEMS, RECIPES, MAX_TEMPER, temperCost, armorCost, hasRing, ringOf, capacity, slotsUsed, canFit, addItem, removeItem, count, partFor, pay, affordable } from './ring.js';
import { Structures, buildStructure } from './structures.js';
import { Pets, petDef } from './pets.js';
import { FEATURES } from './features.js';
import { beginDodge, DODGE } from './evasion.js';
import { TrainingGround } from './training.js';
import { SwordArray } from './swords.js';
import { ViewModel } from './viewmodel.js';
import { Loot } from './loot.js';
import { HUD, fmt, esc, hex } from '../ui/hud.js';
import { Menus } from '../ui/menus.js';

const tA = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1), MOONLIGHT = new THREE.Color(0.55, 0.68, 1.0), NIGHT_FOG = new THREE.Color(0.05, 0.08, 0.16);
const GROUND_NIGHT = new THREE.Color(0x3a3020), GROUND_DAY = new THREE.Color(0x8a7a62);
const tB = new THREE.Vector3();
const tQ = new THREE.Quaternion();
const tM = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);
const SCAN_TIME = 1.6;
const POI_LABEL = { ruin: 'Ancient Ruins', spring: 'Energy Spring', ore: 'Star Metal Deposit', nest: 'Beast Nest', wreck: 'Wreck', lair: 'Overlord Lair', obelisk: 'Trial Obelisk', camp: 'Hunters Camp' };
const POI_COLOR = { ruin: '#ffc857', spring: '#7affd8', ore: '#3ef2ff', nest: '#ff4466', wreck: '#b98cff', lair: '#ff3c7d', obelisk: '#c08cff', camp: '#9affc8' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n0 = (v) => v.clone().normalize();

export class Game {
  constructor(canvas) {
    applyShaderFixes();
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, logarithmicDepthBuffer: true });
    this.gpu = detectGpu(this.renderer);
    if (settings.fresh) {
      // first launch: start from a preset that suits this GPU (before anything reads it)
      settings.data.quality = this.gpu.quality;
      settings.persist();
    }
    this.lowFps = 0;
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
    // one warm light that follows the nearest settlement; the light count never changes
    this.cityLight = new THREE.PointLight(0xffb070, 0, 700, 1.4);
    // your lantern, lit only underground (always present so the light count never changes)
    this.lantern = new THREE.PointLight(0xffe2b0, 0, 50, 1.6);
    // Everything the player touches lives in this group. It is re-parented
    // between the star system and a planet's rotating surface.
    this.localRoot = new THREE.Group();
    this.grass = new Grass(this.localRoot);
    this.localRoot.name = 'local';
    this.scene.add(this.localRoot);
    this.localRoot.add(this.camera);
    this.localRoot.add(this.cityLight);
    this.localRoot.add(this.lantern);

    this.viewmodel = new ViewModel(this.scene);
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.viewmodel.scene, this.viewmodel.camera);
    initPrecompile(this.renderer, this.camera, this.scene, () => this.post.composer && this.post.composer.renderTarget1);
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
    this.arts = new Arts(this);
    this.nix = new Companion(this);
    this.vu = new VirtualWorld();
    this.cutscene = new Cutscene(this);
    this.structures = new Structures(this);
    this.pets = new Pets(this);
    this.campaign = new Campaign(this);
    this.training = new TrainingGround(this);
    this.pods = [];
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
    this.prevVel = new THREE.Vector3();
    this.wasGrounded = true;
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
    return this.mode === 'playing' || this.mode === 'dead' || this.mode === 'warping' || this.mode === 'virtual' || this.mode === 'cutscene';
  }

  freshRuntime() {
    return {
      hp: this.stats.maxHp, energy: this.stats.maxEnergy, spirit: this.stats.maxSpirit,
      cooldowns: {}, willT: 0, guarding: false, guardStart: -9, blinkCd: 0, undyingCd: 0, medToggle: false, chamber: false,
      shieldT: 0, meditating: false, medBlock: 0, hurtFlash: 0, lastHurt: -99,
      trib: null, deadT: 0, invuln: 0, nav: null, cruise: false, shake: 0, hand: 1,
      lock: null, controlling: false, spiritLock: false, scanT: 0, firingT: 0,
      dodgeT: 0, dodgeCd: 0, dodgeDir: null, dodgeSpeed: 0,
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
    if (this.vu) this.vu.setAspect(w / h);
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
  async warmTerrain(onProgress, cancelled = () => false) {
    const start = performance.now();
    for (;;) {
      if (cancelled()) return;
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
    this.arts.reset();
    this.arena = null;
    this.trial = null;
    this.deck = null;
    this.clearPods();
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
    this.dismount(true);
    if (this.vehicleObj) { this.vehicleObj.dispose(); this.vehicleObj = null; }
    this.pets.despawn();
    if (carry && this.localRoot.parent) {
      this.localRoot.updateWorldMatrix(true, false);
      parent.updateWorldMatrix(true, false);
      const m = new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(this.localRoot.matrixWorld);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      this.player.rebase(m, q);
      if (this.rt.dodgeDir) this.rt.dodgeDir.applyQuaternion(q);
      if (this.shipObj) this.shipObj.rebase(m, q);
      this.beasts.rebase(m, q);
      this.combat.rebase(m, q);
      this.swords.rebase(m, q);
      this.loot.rebase(m, q);
      this.particles.rebase(m, q);
      this.arts.rebase(m);
      this.campaign.rebase(m, q);
      this.worldEater?.rebase(m, q);
      this.structures.rebase(m, q);
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
    for (const st of this.system.stations) st.prevM = null;
    this.clearPods();
    this.syncVehicleFrame();
    this.structures.sync();
    this.syncDigs();
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
      || ps.find((p) => p.body.landable && p.allSites().length);
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
      this.updateStations();
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
    this.syncVehicleFrame();
    this.structures.sync();
    this.syncDigs();
    this.camQuat.copy(p.quat);
  }

  spawnAtSettlement(preferred, siteName) {
    const planet = preferred && preferred.body.landable && preferred.allSites().length ? preferred : this.homePlanet();
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
    const sites = planet.allSites();
    const site = (siteName && sites.find((x) => x.name === siteName)) || sites[0];
    const s = planet.ensureSettlement(site);
    const up = s.spawnLocal.clone().normalize();
    const pos = s.spawnLocal.clone().addScaledVector(up, EYE + 0.5);
    p.placeAt(pos, s.group.position.clone().addScaledVector(up, 30), up);
    p.mode = 'ground';
    this.camQuat.copy(p.quat);
  }

  // ------------------------------------------------------- lifecycle --
  enterTitle() {
    this.mode = 'title';
    this.nix.queue = [];
    this.nix.current = null;
    document.getElementById('nix').classList.add('hidden');
    this.hud.show(false);
    this.player.setVisible(false);
    this.viewmodel.setVisible(false);
    this.swords.setVisible(false);
    this.post.vmEnabled = false;
    this.menus.showTitle(true, this.hasSave ? this.state : null);
    this.menus.showPause(false);
  }

  async requestNewGame(mode) {
    if (this.hasSave) {
      const ok = await this.menus.confirm('Begin a new journey?', 'This erases your current save for good. (Choose Continue to keep playing it.)', 'Start over', true);
      if (!ok) return;
    }
    this.newGame(mode);
  }

  async newGame(mode = null) {
    const story = mode || (await this.menus.chooseMode());
    if (!story) return;
    clearSave();
    this.state = newState();
    if (story === 'story') {
      this.state.nixAwake = false;
      this.state.intro = true;
    }
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
    this.campaign.cleanup();
    this.startPlaying();
    if (story === 'story') this.campaign.begin();
  }

  async continueGame() {
    this.stats = derive(this.state);
    const inShip = this.rt.inShip;
    this.rt = this.freshRuntime();
    this.rt.inShip = inShip && !!this.shipObj;
    this.player.setRealm(this.state.realm);
    this.swords.setup(this.stats.swords, this.state.swordGrade);
    this.campaign.cleanup();
    this.startPlaying();
    if (this.state.campaign && this.state.campaign.started) this.campaign.resume();
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
    this.applyWeapon();
    this.arts.reset();
    this.sound.init();
    this.resume();
    this.camera.fov = settings.get('fov');
    this.camera.updateProjectionMatrix();
    this.camQuat.copy(this.rt.inShip && this.shipObj ? this.shipObj.quat : this.player.quat);
    if (this.state.nixAwake === false) {
      // story mode: Nix has not been found yet
    } else if (!this.state.intro) {
      setTimeout(() => this.inGame && this.nix.event('intro', {}, 2), 1500);
    } else {
      setTimeout(() => this.inGame && this.nix.event('resume', {}, 1), 1200);
    }
    if (this.gpu.software && !this.warnedSoftware) {
      this.warnedSoftware = true;
      setTimeout(() => this.hud.notify('Your browser is drawing the game <b>without your graphics card</b>, so it will be slow. Turn on <b>hardware acceleration</b> in your browser settings and restart it.', 'red'), 2500);
    }
    if (!this.state.intro) {
      this.state.intro = true;
      const tips = [
        ['Welcome to <b>Base City 07</b>, Warrior. Beasts roam the wilds beyond the walls.', 'gold'],
        ['Your body is still bound to Terra. Reach the <b>War God</b> realm to fly, and <b>Planetary</b> to leave the planet.', 'violet'],
        [this.pathTip(), ''],
        [`Move and press <kbd>${codeLabel(settings.key('dodge'))}</kbd> to dodge an attack. Watch your energy and the Dodge cooldown on the skill bar.`, ''],
        [`Press <kbd>${codeLabel(settings.key('cultivate'))}</kbd> to cultivate. Energy springs, the beams of light in the wilds, are the richest places.`, 'gold'],
        ['Many city buildings are open. Walk in through any glowing door to shop, train, take jobs or fight in the arena.', 'yl'],
        ['Visit the <b>Martial Hall</b> and <b>Exchange</b> in the city with <kbd>E</kbd> for bounties, pills and the sword forge.', 'yl'],
      ];
      // the welcome tips belong to the real city, not the training world or a boss fight
      tips.forEach(([t, k], i) => setTimeout(() => this.inGame && !this.training?.active && !this.hud.quiet && this.hud.notify(t, k), 900 + i * 3400));
      const home = this.homePlanet();
      const cityName = home && home.body.sites.city ? home.body.sites.city.name : 'Base City 07';
      this.hud.banner('SYSTEM ONLINE', cityName, `<span class="cn">基地市</span>${esc(home ? home.body.name : '')} · ${esc(this.star.name)} System`, '#3ef2ff', 4);
    } else {
      this.hud.notify(`Resumed at <b>${esc(this.locationLabel())}</b>.`, 'gold');
    }
  }

  applyCamMode() {
    const fp = this.camMode === 'first' && !this.rt.inShip;
    if (this.rt.inVehicle) {
      this.player.setVisible(!fp);
      this.viewmodel.setVisible(fp);
      this.post.vmEnabled = fp;
      return;
    }
    this.player.setVisible(!fp && !this.rt.inShip && this.mode !== 'dead');
    this.viewmodel.setVisible(fp && this.mode !== 'dead');
    this.post.vmEnabled = fp;
  }

  resume() {
    this.menus.showPause(false);
    this.sound.init();
    this.input.clear();
    const request = this.resumeRequest = (this.resumeRequest || 0) + 1;
    return this.input.lock().then((locked) => {
      if (!locked && request === this.resumeRequest && this.inGame && !this.menus.overlayOpen && !this.training.busy) this.menus.showPause(true);
      return locked;
    });
  }

  pause() {
    this.resumeRequest = (this.resumeRequest || 0) + 1;
    this.input.clear();
    this.menus.showPause(true);
    this.input.unlock();
    this.save();
  }

  async quitToTitle() {
    this.campaign?.planetary?.dispose();
    if (this.training.active) this.training.leave();
    this.exitVirtual();
    this.dismount(true);
    if (this.cutscene.playing) this.cutscene.skip();
    this.cutscene.talk = null;
    this.cutscene.hideSub();
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
    if (this.training.busy) return;
    if (!locked && this.mode === 'cutscene') {
      this.cutscene.skip();
      return;
    }
    if (locked && this.menus.overlayOpen) { this.input.unlock(); return; }
    if (locked) this.menus.showPause(false);
    else if (this.inGame && !this.menus.overlayOpen) {
      this.menus.showPause(true);
      this.save();
    }
  }

  onKey(code) {
    const m = this.menus;
    if (code === settings.key('returnBody')) {
      if (this.training.active) { this.training.leave({ returnToBody: true }); return; }
      if (this.mode === 'virtual') { m.closePanel(); m.closeModal(null); m.closeSettings(); this.exitVirtual(); this.resume(); return; }
    }
    if (this.training.busy) { if (code === 'Escape') this.training.pauseOnArrival = true; return; }
    if (this.mode === 'cutscene') {
      if (code === 'Escape' || code === 'Enter') this.cutscene.skip();
      return;
    }
    if (code === 'Escape') {
      if (!m.$('modal').classList.contains('hidden')) { m.closeModal(null); return; }
      if (!m.$('settings').classList.contains('hidden')) { m.closeSettings(); return; }
      if (m.panelOpen) { m.closePanel(); this.pause(); return; }
      // browsers only let a click recapture the mouse, so Esc can't resume: point at the button instead
      if (this.inGame) {
        if (m.pauseOpen) m.flashPauseHint?.();
        else this.pause();
      }
      return;
    }
    if (this.mode !== 'playing' || !m.$('settings').classList.contains('hidden') || !m.$('modal').classList.contains('hidden')) return;
    const k = (a) => code === settings.key(a);
    if (k('panelTraining') && this.training.active) { this.togglePanel('training'); return; }
    if (k('panelCult')) this.togglePanel('cultivation');
    else if (k('panelSkills')) this.togglePanel('skills');
    else if (k('panelBounty')) this.togglePanel('bounties');
    else if (k('panelGuide')) this.togglePanel('guide');
    else if (k('panelRing')) this.togglePanel('ring');
    else if (k('panelMap')) this.togglePanel('map');
    else if (k('mute')) this.hud.notify(this.sound.toggleMute() ? 'Sound muted.' : 'Sound on.');
  }

  togglePanel(kind, tab) {
    this.resumeRequest = (this.resumeRequest || 0) + 1;
    this.input.clear();
    this.menus.showPause(false);
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
    this.resume();
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
      this.adaptQuality();
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    if (this.training.active && !this.menus.pauseOpen && this.menus.$('settings').classList.contains('hidden')) this.training.updatePhysical(dt);
    if (this.mode === 'transferring') {
      this.training.transfer.update(dt);
      this.sound.setListener(this.post.renderPass.camera);
      this.post.render(this.time);
      this.input.endFrame();
      return;
    }
    if (!this.system) return;
    if (this.mode === 'title' || this.mode === 'loading') this.updateTitle(dt);
    else if (this.mode === 'warping') this.updateWarp(dt);
    else if (this.mode === 'virtual') {
      // only the pause screen stops time; your body lives on while you're logged in
      const pauseShown = !this.menus.$('pause').classList.contains('hidden') || !this.menus.$('settings').classList.contains('hidden');
      if (!pauseShown) {
        if (!this.menus.overlayOpen && this.input.locked) this.updateVirtual(dt);
        if (this.mode === 'virtual') {
          this.update(dt);
          this.updateBodyStatus();
        }
        this.state.playtime += dt;
      } else this.input.consumeMouse();
    } else {
      const paused = this.mode === 'campaign-defeat' || this.menus.pauseOpen || (this.menus.overlayOpen && this.mode !== 'cutscene') || (!this.input.locked && this.mode === 'playing');
      if (!paused) {
        this.update(dt);
        this.state.playtime += dt;
      } else {
        this.input.consumeMouse();
      }
    }
    this.sound.setListener(this.mode === 'virtual' ? this.vu.camera : this.camera);
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

  // If the frame rate stays low even at the lowest dynamic resolution, drop a preset.
  adaptQuality() {
    if (!settings.get('autoQuality') || this.mode !== 'playing' || this.menus.overlayOpen || !this.input.locked) {
      this.lowFps = 0;
      return;
    }
    const floor = !settings.get('dynamicRes') || this.dynScale <= 0.61;
    this.lowFps = this.fps < 30 && floor ? this.lowFps + 1 : 0;
    if (this.lowFps < 5) return;
    this.lowFps = -10;
    const i = QUALITY_ORDER.indexOf(settings.get('quality'));
    if (i <= 0) return;
    const next = QUALITY_ORDER[i - 1];
    settings.set('quality', next);
    if (next === 'minimal' || next === 'low') settings.set('propDensity', Math.min(settings.get('propDensity'), 0.5));
    this.dynScale = 1;
    this.resize();
    this.hud.notify(`Graphics lowered to <b>${next.toUpperCase()}</b> to keep the game smooth. You can change this in Settings.`, 'yl');
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
    this.updateAtmosphereLighting(dt);
    this.flare.update(this.camera, this.system.root.position, this.system.starRadius, this.flareOccluders(), dt);
    Object.assign(this.post.fx, { speed: 0, damage: 0, tintAmt: 0, glitch: 0, flash: 0 });
  }

  // ----------------------------------------------------------- update --
  update(dt) {
    const s = this.state, rt = this.rt, p = this.player, inp = this.input;
    const alive = this.mode === 'playing';
    const siege = this.campaign.planetary.active && !rt.inShip && !rt.inVehicle;
    if (siege !== !!this.siegeCam) {
      this.siegeCam = siege;
      if (siege) { this.siegePrev = { camMode: this.camMode, zoom: this.zoom }; this.camMode = 'third'; this.zoom = 2.8; }
      else if (this.siegePrev) { this.camMode = this.siegePrev.camMode; this.zoom = this.siegePrev.zoom; this.siegePrev = null; }
      this.applyCamMode();
    }
    // no tutorial tips in the middle of a boss fight
    this.hud.quiet = siege || !!this.beasts.liveBoss;
    // logged into the Virtual Universe your body takes no orders, but it still lives
    const body = alive || this.mode === 'virtual';
    let st = this.stats;
    if (this.training.active) this.training.update();
    rt.dodgeT = Math.max(0, rt.dodgeT - dt);
    rt.dodgeCd = Math.max(0, rt.dodgeCd - dt);
    s.worldTime += dt;

    // ---- input
    const mouse = inp.consumeMouse();
    const sens = 0.0021 * settings.get('sensitivity');
    const look = { x: mouse.x * sens, y: mouse.y * sens * (settings.get('invertY') ? -1 : 1) };
    this.lastMouse = mouse;
    const move = { x: 0, y: 0, z: 0 };
    if (alive) {
      if (inp.act('forward') || inp.down('ArrowUp')) move.z += 1;
      if (inp.act('back') || inp.down('ArrowDown')) move.z -= 1;
      if (inp.act('right') || inp.down('ArrowRight')) move.x += 1;
      if (inp.act('left') || inp.down('ArrowLeft')) move.x -= 1;
      // in flight (or swimming) Space rises only once held a moment, so the
      // double tap that drops you back to the ground doesn't lift you first
      if (inp.act('jump') && inp.heldFor('jump') > 0.22) move.y += 1;
      if (inp.act('down')) move.y -= 1;
      if (inp.hit('camera')) {
        this.camMode = this.camMode === 'first' ? 'third' : 'first';
        settings.set('camera', this.camMode);
        this.applyCamMode();
      }
    }
    const manual = move.x !== 0 || move.y !== 0 || move.z !== 0;
    rt.medBlock = Math.max(0, rt.medBlock - dt);
    // cultivation: tap to toggle (or hold, per settings); moving or fighting breaks it
    const canMed = alive && !rt.inShip && !rt.trib && rt.medBlock <= 0;
    if (settings.get('cultivateMode') === 'hold') {
      rt.meditating = canMed && inp.act('cultivate') && !manual;
    } else {
      if (inp.hit('cultivate')) rt.medToggle = !rt.meditating;
      if (inp.rel('cultivate') && inp.heldFor('cultivate') > 0.45) rt.medToggle = false;
      if (manual || !canMed || inp.act('fire')) rt.medToggle = false;
      rt.meditating = canMed && (rt.medToggle || (inp.act('cultivate') && !manual));
    }

    // ---- sword control
    if (!inp.right) rt.spiritLock = false;
    rt.controlling = alive && !rt.inShip && activePath(s) === 'mind' && inp.right && !rt.spiritLock && !rt.meditating && rt.spirit > 0;
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
    // the wheel cycles weapons and the radar on foot; it zooms in a ship, or with sprint held in third person
    const zoomWheel = rt.inShip || (this.camMode === 'third' && inp.act('sprint'));
    if (alive && !rt.controlling && inp.wheel && zoomWheel) this.zoom = clamp(this.zoom + inp.wheel * 0.12, 0.5, 3);
    else if (alive && !rt.controlling && !rt.inShip && !this.placing && inp.wheel && this.time > (this.wheelCd || 0)) {
      this.wheelCd = this.time + 0.15;
      this.cycleWeapon(Math.sign(inp.wheel));
    }
    if (alive && !rt.inShip && inp.hit('weaponNext')) this.cycleWeapon(1);

    // ---- movement
    const env = this.computeEnv(rt.inShip && this.shipObj ? this.shipObj.pos : p.pos);
    this.env = env;
    if (rt.inVehicle && this.vehicleObj) this.controlVehicle(dt, move, look, env, alive);
    else if (rt.inShip && this.shipObj) this.controlShip(dt, move, look, env, alive);
    else this.controlPlayer(dt, move, look, env, alive, manual);
    if (this.mode === 'cutscene') this.cutscene.update(dt);
    else this.positionCamera(dt);

    // ---- world update (moves planets, refreshes terrain detail)
    this.system.update(dt, s.worldTime, this.camera, this.playerWorld());
    this.checkFrame();
    this.updateStations();
    this.updateVenue(dt);
    this.updateCityLight();

    // ---- aim and targeting
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.aimTarget = this.pickAimTarget(camFwd);
    if (rt.lock && (!rt.lock.alive || rt.lock.pos.distanceTo(p.pos) > 2500)) rt.lock = null;
    if (alive && inp.hit('lock')) this.cycleLock(camFwd);
    const aimBeast = this.aimTarget || rt.lock;
    const aimPoint = this.aimTarget
      ? this.aimTarget.pos.clone().addScaledVector(this.aimTarget.vel, this.aimTarget.pos.distanceTo(p.pos) / 700)
      : this.camera.position.clone().addScaledVector(camFwd, 1500);

    // ---- techniques
    rt.shieldT = Math.max(0, rt.shieldT - dt);
    rt.invuln = Math.max(0, rt.invuln - dt);
    rt.firingT = Math.max(0, rt.firingT - dt);
    const swordDamage = st.atk * SWORD_GRADES[s.swordGrade].mult * masteryMult(s.mastery.volley || 1) * st.swordDmg;
    this.arts.update(dt, { alive: alive && !rt.scanner && !this.placing && rt.dodgeT <= 0, camFwd, aimPoint, aimBeast, swordDamage });
    if (alive && !rt.meditating) {
      if (inp.hit('pill1')) this.usePill('heal');
      if (inp.hit('pill2')) this.usePill('energy');
      if (inp.hit('pill3')) this.usePill('cult');
    }
    if (alive) {
      if (inp.hit('breakthrough')) this.tryBreakthrough();
      if (inp.hit('target')) this.setTarget();
      if (rt.scanner && inp.hit('fire')) { rt.pingCd = Math.min(rt.pingCd, 0); this.radarPing(); }
      if (inp.hit('virtual')) this.enterVirtual();
      if (inp.hit('engage')) this.engage();
    }

    // ---- regeneration & cultivation
    const density = this.densityHere();
    const tier = this.locTier();
    const medRate = 0.5 * xpScale(tier) * density * (s.devour ? 1.5 : 1) * st.cultivate * (rt.chamber ? 2.5 : 1) * (this.structures.totemNear(p.pos) ? 1.6 : 1);
    if (body) {
      const brew = this.mealActive('broth') ? 1.5 : 1;
      if (!p.boosting) rt.energy = Math.min(st.maxEnergy, rt.energy + st.regen * dt * (rt.meditating ? 2.2 : 1) * brew);
      if (!rt.controlling) rt.spirit = Math.min(st.maxSpirit, rt.spirit + st.spiritRegen * dt * (rt.meditating ? 2 : 1) * brew);
      if (this.time - rt.lastHurt > 6) rt.hp = Math.min(st.maxHp, rt.hp + st.maxHp * 0.012 * dt);
      if (rt.meditating) {
        rt.hp = Math.min(st.maxHp, rt.hp + st.maxHp * 0.035 * dt);
        const gained = medRate * dt;
        this.addXp(gained);
        this.applyBounties(progressBounties(s, { kind: 'cultivate', amount: gained }));
        this.campaign.event('cultivate', gained);
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
    const beastEnvironment = this.beastEnv(tier);
    if (this.training.active || this.campaign.planetary.active) { beastEnvironment.max = 0; beastEnvironment.spawn = () => null; }
    this.beasts.setEnv(beastEnvironment);
    // beasts keep chasing through a dodge or a brief invulnerability (hurtPlayer ignores the hits);
    // only a dead or absent player makes them give up
    const ctx = { player: p, playerAlive: body, time: this.time, hurtPlayer: (d, pos, knock) => this.hurtPlayer(d, pos, knock), slowAt: (b) => this.arts.slowAt(b) };
    if (!this.training.active || !this.training.options.freeze) this.beasts.update(dt, ctx);
    this.updateWorldEater(dt);
    propWind.value = this.time;
    this.grass.update(this.frame, this.player.pos, settings.get('quality') !== 'minimal' && this.env.inAtmo && !this.training.active);
    if (this.training.active) this.training.duel.update(dt);
    this.swords.setup(activePath(s) === 'mind' ? st.swords : 0, s.swordGrade);
    this.swords.update(dt, {
      player: p, camera: this.camera, aimDir: camFwd, aimTarget: aimBeast, beasts: this.beasts.beasts, realm: s.realm,
      enemyShots: this.combat.enemyShots, wheel: rt.controlling ? inp.wheel : 0, swordDamage, up: env.up || p.localUp(),
      hit: (b, dmg, pos, kind, knock) => this.hitBeast(b, dmg, pos, kind, knock),
    });
    this.combat.update(dt, {
      beasts: this.beasts.beasts, player: p, playerAlive: body && rt.invuln <= 0,
      solid: (pos) => this.isSolid(pos),
      breakAt: (pos, r, dir) => this.breakAt(pos, r, dir),
      scorch: (pos, size) => this.scorch(pos, size),
      dig: (pos, r) => this.dig(pos, r),
      hitBeast: (b, dmg, pos, kind, knock) => this.hitBeast(b, dmg, pos, kind, knock),
      hurtPlayer: (d, pos, shot) => this.hurtPlayer(d, pos, null, false, shot),
    });
    if (this.training.active) this.training.duel.flush();
    this.loot.update(dt, p, 70 + s.realm * 12, (it) => {
      if (it.kind === 'part') {
        if (!addItem(s, it.data)) {
          if (this.time > (this.notifyGate.ringFull || 0)) {
            this.notifyGate.ringFull = this.time + 8;
            this.hud.notify('Your ring is <b>full</b>. Sell or use parts, or expand it at a Star Exchange.', 'red');
          }
          return false;
        }
        this.dmgNum(p.pos.clone().addScaledVector(camFwd, 6), `+ ${it.data.name}`, it.data.rare ? 'crit' : 'xp');
        this.campaign.event('part');
        return true;
      }
      if (it.kind === 'ore') {
        s.ore += Math.round(it.amount);
        this.dmgNum(p.pos.clone().addScaledVector(camFwd, 6), `+${Math.round(it.amount)} ⬢`, 'xp');
      } else {
        s.essence += it.amount;
        this.dmgNum(p.pos.clone().addScaledVector(camFwd, 6), `+${fmt(it.amount)} ✦`, 'xp');
      }
    }, (it) => it.kind !== 'part' || canFit(s, it.data.id, ITEMS[it.data.id] ? ITEMS[it.data.id].slots : 1));
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
    rt.pingCd = Math.max(0, (rt.pingCd || 0) - dt);
    if (rt.scanner) this.updateScanner(dt);
    if (rt.scanner && rt.inShip) this.putAwayScanner();
    this.updateDeliveries(dt);
    if (!this.training.duel.active) this.structures.update(dt, this.time);
    this.updateDigs(dt);
    if (body) this.pets.update(dt, this.time);
    if (this.placing) this.updatePlacing(dt, alive);
    this.updateWater(dt, body);
    this.updateScorch(dt);
    if (this.mode !== 'cutscene') this.cutscene.update(dt);
    this.campaign.update(dt);
    if (this.mode !== 'cutscene') this.nix.update(dt, { manual });
    this.nixWatch();
    this.saveTimer += dt;
    if (this.saveTimer > 10) {
      this.saveTimer = 0;
      this.save();
    }
  }

  // ------------------------------------------------------- environment --
  computeEnv(pos) {
    const planet = this.frame;
    const dk = this.deck;
    if (dk && !this.rt.inShip) {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(dk.q).normalize();
      const sp = pos.clone().applyMatrix4(dk.inv);
      return { planet, up, floorR: null, inAtmo: false, alt: Math.max(0, sp.y - EYE), D: pos.length(), deck: dk };
    }
    if (!planet) return { planet: null, up: null, floorR: null, inAtmo: false, alt: null, D: 0 };
    const D = pos.length();
    const up = pos.clone().divideScalar(Math.max(D, 1e-6));
    if (!planet.body.landable) return { planet, up, floorR: null, inAtmo: D < planet.atmoR, alt: D - planet.R, D, gas: true };
    let floorR = planet.floorRadius(up.x, up.y, up.z);
    const water = this.waterAt(pos);
    if (water && !this.rt.inShip && !this.rt.inVehicle) floorR = water.bedR;
    // dug holes and caves
    if (planet.digsSys && planet.digsSys.inZone(pos)) floorR = planet.digsSys.groundBelow(pos);
    const roof = planet.collide(pos, this.rt.inShip ? 10 : this.player.radius, this.rt.inShip ? 0 : EYE);
    if (roof && roof > floorR && D > roof - 4) floorR = roof;
    return { planet, up, floorR, inAtmo: D < planet.atmoR, alt: D - floorR - (this.rt.inShip ? 0 : EYE), D, water };
  }

  maxBreath() {
    return 40 + this.state.realm * 25;
  }

  updateWater(dt, alive) {
    const rt = this.rt, p = this.player;
    const w = this.waterAt(p.pos);
    const under = !!w && !rt.inShip && !rt.inVehicle && p.pos.length() < w.seaR - 0.1;
    if (rt.breath === undefined) rt.breath = this.maxBreath();
    if (under && alive) {
      rt.breath = Math.max(0, rt.breath - dt);
      if (rt.breath <= 0) {
        rt.drownT = (rt.drownT || 0) - dt;
        if (rt.drownT <= 0) {
          rt.drownT = 1;
          this.hurtPlayer(this.stats.maxHp * 0.08, null, null, true);
          if (this.time > (this.notifyGate.drown || 0)) {
            this.notifyGate.drown = this.time + 6;
            this.hud.notify('You are <b>drowning</b>. Swim up!', 'red');
          }
        }
      }
    } else rt.breath = Math.min(this.maxBreath(), rt.breath + dt * 10);
    rt.underwater = under;
    // beasts of the deep
    this.seaSpawnT = (this.seaSpawnT || 0) - dt;
    if (w && rt.swimming && this.seaSpawnT <= 0) {
      this.seaSpawnT = 5;
      const near = this.beasts.beasts.filter((b) => b.def.aquatic && b.pos.distanceTo(p.pos) < 400).length;
      if (near < 6) this.spawnSeaBeasts(w);
    }
  }

  spawnSeaBeasts(w) {
    const p = this.player, f = this.frame;
    const up = p.pos.clone().normalize();
    const e = new THREE.Vector3(1, 0, 0).projectOnPlane(up).normalize();
    const n = new THREE.Vector3().crossVectors(e, up);
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * Math.PI * 2, r = 50 + Math.random() * 70;
      const at = p.pos.clone().addScaledVector(e, Math.cos(a) * r).addScaledVector(n, Math.sin(a) * r);
      const ww = this.waterAt(at);
      if (!ww || ww.seaR - ww.bedR < 7) continue;
      const tier = Math.max(0, this.locTier() - 0.2);
      const list = AQUATIC.filter((s) => s.minTier <= tier + 0.3);
      const def = list[Math.floor(Math.random() * list.length)] || AQUATIC[0];
      this.beasts.species.set(def.id, def);
      const count = def.pack[0] + Math.floor(Math.random() * (def.pack[1] - def.pack[0] + 1));
      for (let i = 0; i < count; i++) {
        const pos = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12));
        pos.setLength(ww.bedR + 2 + Math.random() * Math.max(1, ww.seaR - ww.bedR - 5));
        this.beasts.spawn(def.id, pos, tier, { aggro: false, elite: Math.random() < 0.06 });
      }
      if (!this.notifyGate.seaBeasts) {
        this.notifyGate.seaBeasts = 1;
        this.nix.say('Something big just moved down there. I\u2019d swim faster.', 1);
      }
      return;
    }
  }

  // Underwater: thick blue fog and a tint; the surface glimmers overhead.
  applyUnderwater() {
    const f = this.frame;
    const tint = document.getElementById('water-tint');
    let under = false;
    if (f && f.terrain && f.terrain.sea !== null && f.body.ocean && !f.body.ocean.lava && this.localRoot.parent === f.spin) {
      const c = this.camera.position;
      const w = this.waterAt(c);
      under = !!w && c.length() < w.seaR - 0.05;
    }
    if (under) {
      const fog = this.scene.fog;
      const deep = this.waterAt(this.camera.position);
      const depth = deep ? deep.seaR - this.camera.position.length() : 0;
      fog.color.set(f.body.ocean.color).multiplyScalar(0.35 * Math.max(0.25, 1 - depth / 120));
      fog.density = 0.018 + Math.min(0.02, depth * 0.0004);
    }
    if (tint) tint.style.opacity = '0';
    const fx = this.post.fx;
    if (under) {
      const w = this.waterAt(this.camera.position);
      const depth = w ? w.seaR - this.camera.position.length() : 0;
      fx.waterCol.set(f.body.ocean.color).lerp(new THREE.Color(0.05, 0.32, 0.45), 0.6).multiplyScalar(Math.max(0.3, 1 - depth / 90));
    }
    fx.water = under ? 0.6 + Math.min(0.4, (this.waterAt(this.camera.position) ? this.waterAt(this.camera.position).seaR - this.camera.position.length() : 0) / 40) : 0;
  }

  // Sea level and seabed under a local point, if it is over water.
  waterAt(pos) {
    const f = this.frame;
    if (!f || !f.terrain || f.terrain.sea === null || !f.body.ocean || f.body.ocean.lava) return null;
    const n = pos.clone().normalize();
    const bedR = f.groundRadius(n.x, n.y, n.z);
    const seaR = f.R + f.terrain.sea;
    return bedR < seaR - 0.3 ? { seaR, bedR } : null;
  }

  locTier() {
    const f = this.frame;
    if (f && f.body.landable) {
      let t = f.body.tier;
      const city = f.body.sites.city;
      if (city && city.main && this.env.up) {
        // danger grows with distance from the nearest city
        let ang = Math.PI;
        for (const st of f.allSites()) {
          if (st.size === 'outpost') continue;
          ang = Math.min(ang, Math.acos(clamp(this.env.up.dot(tA.set(st.x, st.y, st.z).normalize()), -1, 1)));
        }
        t = Math.max(t, Math.min(1.6, (ang / Math.PI) * 4));
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
    return f.solidAt(pos);
  }

  beastEnv(tier) {
    const f = this.frame;
    if (f && f.body.landable && this.env.inAtmo) {
      const sites = f.allSites();
      return {
        max: 6 + Math.round(tier * 2.5),
        species: speciesForBody(f.body),
        interval: 5,
        despawn: 2200,
        ground: (pos) => {
          const D = pos.length();
          const up = pos.clone().divideScalar(D);
          return { up, floorR: f.groundBelow(pos) };
        },
        resolve: (pos, r) => f.collide(pos, r),
        water: (pos) => this.waterAt(pos),
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
          for (const st of sites) {
            const ang = Math.acos(clamp(dir.dot(tB.set(st.x, st.y, st.z).normalize()), -1, 1)) * f.R;
            if (ang < st.radius * 1.5) return null;
          }
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
    const onDeck = !!env.deck;
    const onWorld = !onDeck && env.planet && env.planet.body.landable;
    if (onDeck) {
      if (p.mode === 'space') p.mode = 'ground';
    } else if (onWorld && env.inAtmo) {
      if (p.mode === 'space') p.mode = 'fly';
      if (!canFly) p.mode = 'ground';
    } else if (canSpace || !env.planet) {
      p.mode = 'space';
    }
    // in deep water you swim: free movement in three dimensions at swimming pace
    const water = onWorld && env.inAtmo ? env.water : null;
    const D0 = p.pos.length();
    const swimming = !!water && D0 < water.seaR + EYE * 0.6 && water.bedR + EYE * 1.2 < water.seaR && !(canFly && p.mode === 'fly' && D0 > water.seaR + 0.5);
    if (swimming && !rt.swimming) {
      p.vel.multiplyScalar(0.3);
      this.particles.burst(p.pos.clone().setLength(water.seaR), new THREE.Color(1.6, 2.2, 2.6), 30, 10, 0.8, 0.6);
      if (!this.notifyGate.swimHelp) {
        this.notifyGate.swimHelp = 1;
        this.hud.notify(`You are swimming. Look and move to dive; ${esc(codeLabel(settings.key('jump')))} rises, ${esc(codeLabel(settings.key('down')))} sinks. Watch your breath.`, 'cy');
      }
    }
    rt.swimming = swimming;
    if (swimming) p.mode = 'fly';
    else if (onWorld && p.mode === 'fly' && !canFly) p.mode = 'ground';
    // a double tap on Space toggles flight on a world
    let jump = false;
    if (alive && this.input.hit('jump')) {
      if (((onWorld && env.inAtmo) || onDeck) && canFly && this.time - this.lastSpace < 0.32) {
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
    } else if (alive && this.input.act('jump') && p.mode === 'ground' && p.grounded && this.input.heldFor('jump') > 0.2) {
      // hold Space to keep hopping
      jump = true;
    }
    if (p.mode === 'fly' && onWorld && p.grounded && move.y < 0) p.mode = 'ground';

    let speed;
    const sprintKey = this.input.act('sprint') || this.input.down('ShiftRight');
    let boost = alive && (settings.get('autoSprint') ? !sprintKey : sprintKey) && manual && (p.mode === 'ground' || rt.energy > 1);
    if (p.mode === 'ground') speed = st.walk;
    else if (swimming) speed = st.walk * 0.8;
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
    if (alive && !this.placing && !this.arts.dash && this.input.hit('dodge') && s.realm >= 3) {
      // from the Stellar realm the dodge becomes Star Step
      this.arts.blink({ camFwd: new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion) });
    } else if (alive && !swimming && !this.placing && !this.arts.dash && this.input.hit('dodge')) {
      if (beginDodge(rt, p, move, env.up, st.walk)) {
        jump = false;
        this.particles.burst(p.pos.clone().addScaledVector(env.up, -EYE + 0.2), p.trailColor, 12, 8, 0.3, 0.4);
      } else if (rt.energy < DODGE.cost) this.denied('Not enough energy to dodge.');
    }
    p.update(dt, move, {
      up: p.mode !== 'space' ? env.up : null,
      floorR: onWorld ? env.floorR : null,
      gravity: 18,
      jumpSpeed: st.jump,
      jump,
      dodge: alive && !swimming && rt.dodgeT > 0 ? { dir: rt.dodgeDir, speed: rt.dodgeSpeed } : null,
      speed,
      boost,
      accel: rt.cruise ? 1.6 : 2.6,
      meditating: rt.meditating,
      swimming,
      time: this.time,
      shield: rt.shieldT > 0,
      hidden: !alive || this.camMode === 'first',
      align: 4,
    });
    // near the surface you bob up unless you swim down on purpose
    if (swimming && move.y <= 0 && move.z === 0) {
      const D = p.pos.length();
      if (D > water.seaR - 2.5 && D < water.seaR + EYE * 0.35) p.pos.setLength(D + (water.seaR + EYE * 0.35 - D) * Math.min(1, dt * 2.5));
    }
    // walk into the wall of a dug hole or cave to climb it
    rt.climbing = false;
    const dsys = onWorld && env.planet.digsSys;
    if (dsys && alive && p.mode === 'ground' && move.z > 0 && dsys.inZone(p.pos)) {
      const up = env.up;
      const fwd = p.forward().projectOnPlane(up).normalize();
      // chest and feet: keep climbing until your feet clear the lip
      const chest = p.pos.clone().addScaledVector(up, -0.9).addScaledVector(fwd, 1.0);
      const feet = p.pos.clone().addScaledVector(up, -1.6).addScaledVector(fwd, 1.1);
      if (dsys.sdf(chest.x, chest.y, chest.z) > -0.15 || dsys.sdf(feet.x, feet.y, feet.z) > -0.15) {
        const climb = sprintKey ? 8 : 5.5;
        const vn = p.vel.dot(up);
        if (vn < climb) p.vel.addScaledVector(up, climb - vn);
        p.grounded = false;
        rt.climbing = true;
        if (!this.notifyGate.climbHint) {
          this.notifyGate.climbHint = 1;
          this.hud.notify(`Climbing. Keep holding <kbd>W</kbd> against the wall (with ${esc(codeLabel(settings.key('sprint')))} to climb faster).`, 'yl');
        }
      } else if (p.vel.dot(up) > 2) {
        // over the lip: a little shove forward so you land on the edge
        p.vel.addScaledVector(fwd, 4 * dt * 10);
      }
    }
    // a swimmer who can't fly floats with their head just above the surface
    if (swimming && !canFly && p.pos.length() > water.seaR + EYE * 0.35) {
      p.pos.setLength(water.seaR + EYE * 0.35);
      const vn = p.vel.dot(env.up);
      if (vn > 0) p.vel.addScaledVector(env.up, -vn);
    }
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
    if (onWorld && env.D < env.planet.R + env.planet.body.amp + 400) env.planet.collide(p.pos, p.radius, EYE);
    // a hard landing from a War God or stronger cracks the ground
    if (onWorld && env.up) {
      const vDown = -this.prevVel.dot(env.up);
      if (p.grounded && !this.wasGrounded && vDown > 22 && s.realm >= 1) {
        const radius = 6 + s.realm * 2.5;
        this.combat.shockwave(p.pos.clone().addScaledVector(env.up, -EYE + 0.3), radius, REALMS[s.realm].color, 0.5);
        this.breakAt(p.pos, radius * 0.6, null);
        this.scorch(p.pos, radius * 0.35);
        for (const b of [...this.beasts.beasts]) if (!b.static && b.pos.distanceTo(p.pos) < radius + b.radius) this.hitBeast(b, st.atk * (1 + vDown / 30), b.pos.clone(), 'burst', b.pos.clone().sub(p.pos).normalize().multiplyScalar(60));
        rt.shake = Math.max(rt.shake, Math.min(1, vDown / 60));
        this.sound.burst();
      }
      this.wasGrounded = p.grounded;
      this.prevVel.copy(p.vel);
    }
    if (onDeck) {
      // the deck is a plane at y = 0 in the station frame; booths block movement
      const dk = env.deck;
      const sp = p.pos.clone().applyMatrix4(dk.inv);
      const top = dk.st.model.collide(sp, p.radius, EYE);
      const floorY = Math.max(0, top ?? 0);
      p.grounded = false;
      if (sp.y - EYE <= floorY + 0.02) {
        sp.y = floorY + EYE;
        const vn = p.vel.dot(env.up);
        if (vn < 0) p.vel.addScaledVector(env.up, -vn);
        p.grounded = true;
        if (p.mode === 'fly' && move.y < 0) p.mode = 'ground';
      }
      p.pos.copy(sp.applyMatrix4(dk.M));
      p.syncRoot();
    }
    this.updateFootsteps(dt, env);
    this.hazards(dt, p.pos, env);
  }

  updateFootsteps(dt, env) {
    const p = this.player, rt = this.rt;
    if (!p.grounded || p.mode !== 'ground' || rt.inShip || rt.inVehicle || rt.hp <= 0) { rt.footDistance = 0; return; }
    const velocity = p.vel.clone();
    if (env.up) velocity.projectOnPlane(env.up);
    const speed = velocity.length();
    if (speed < 0.8) { rt.footDistance = 0; return; }
    rt.footDistance = (rt.footDistance || 0) + Math.min(speed, 18) * dt;
    const stride = 1.35 + Math.min(speed, 18) * 0.035;
    if (rt.footDistance < stride) return;
    rt.footDistance %= stride;
    let surface = this.inVenue ? 'interior' : 'ground';
    if (!this.inVenue && this.frame?.details) for (const st of this.frame.details.settlements) {
      const local = st.toCity(p.pos);
      if (st.block?.surfaceAt(local) || st.architecture?.surfaceAt(local) || st.streets?.surfaceAt(local)) { surface = 'paving'; break; }
    }
    this.sound.footstep?.(surface, speed);
  }

  controlShip(dt, move, look, env, alive) {
    const ship = this.shipObj, rt = this.rt, p = this.player;
    const onWorld = env.planet && env.planet.body.landable;
    let speed = env.inAtmo ? Math.min(600, ship.def.speed) : ship.def.speed;
    const boost = alive && (this.input.act('sprint') || this.input.down('ShiftRight'));
    if (rt.cruise) {
      if (!alive || move.z < 0 || env.inAtmo) rt.cruise = false;
      else {
        speed = this.cruiseSpeed(ship.def.speed, ship.def.cruise);
        this.steerCruise(dt, look, move, ship);
      }
    }
    if (ship.dockedAt) {
      if (alive && (move.y > 0 || move.z !== 0)) {
        const st = ship.dockedAt;
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(st.localM || new THREE.Matrix4()));
        ship.dockedAt = null;
        ship.landed = false;
        ship.vel.copy(up).multiplyScalar(18);
        this.hud.notify('Clamps released. You lift off the pad.', 'yl');
      } else {
        ship.look(0, 0, {});
        p.pos.copy(ship.pos);
        p.quat.copy(ship.quat);
        p.vel.set(0, 0, 0);
        p.syncRoot();
        return;
      }
    }
    ship.look(look.x, look.y, { up: env.inAtmo ? env.up : null });
    ship.update(dt, alive ? move : { x: 0, y: 0, z: 0 }, { up: env.up, floorR: onWorld ? env.floorR : null, speed, boost: boost && !rt.cruise, inAtmo: env.inAtmo, accel: rt.cruise ? 1.4 : 1.2 });
    if (rt.warpCharge > 0) {
      ship.pos.add(tA.set((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3));
      ship.sync();
    }
    // until the Planetary realm your body can't take the void, even in a hull
    if (onWorld && !FLIGHT.canSpace(this.state.realm)) {
      const pl = env.planet;
      const cap = Math.min(pl.atmoR * 0.985, pl.R + Math.max(pl.body.amp * 1.25, (pl.atmoR - pl.R) * 0.85));
      if (ship.pos.length() > cap) {
        ship.pos.setLength(cap);
        const upv = ship.pos.clone().normalize();
        const vn = ship.vel.dot(upv);
        if (vn > 0) ship.vel.addScaledVector(upv, -vn * 1.5);
        ship.sync();
        if (this.time > (this.notifyGate.void || 0)) {
          this.notifyGate.void = this.time + 8;
          this.hud.notify('The hull would hold, but your body would not. Reach the <b>Planetary</b> realm to fly into space.', 'red');
        }
      }
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
    if (rt.inVehicle && this.vehicleObj && this.camMode === 'first') {
      // from the saddle
      this.camQuat.slerp(p.quat, 1 - Math.exp(-dt * 30));
      this.camera.position.copy(p.pos);
      this.camera.quaternion.copy(this.camQuat);
    } else if (rt.inVehicle && this.vehicleObj) {
      const v = this.vehicleObj;
      this.camQuat.slerp(p.quat, 1 - Math.exp(-dt * 12));
      const off = tA.set(0, v.def.cam, v.def.dist).multiplyScalar(this.zoom).applyQuaternion(this.camQuat);
      this.camera.position.copy(v.pos).add(off);
      this.camera.quaternion.copy(this.camQuat);
    } else if (rt.inShip && this.shipObj) {
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
      if (p.mode === 'ground' && p.grounded && settings.get('headBob')) {
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
    // keep the camera above ground (and out of the rock in holes and caves)
    const f = this.frame;
    if (f && f.terrain && f.digsSys && f.digsSys.inZone(this.camera.position)) {
      const eye = rt.inVehicle && this.vehicleObj ? this.vehicleObj.pos.clone().addScaledVector(this.vehicleObj.pos.clone().normalize(), 1.5) : p.pos;
      const cam = this.camera.position;
      if (f.digsSys.sdf(cam.x, cam.y, cam.z) > -0.3) {
        const from = cam.clone();
        for (let t = 0.1; t <= 1; t += 0.1) {
          cam.lerpVectors(from, eye, t);
          if (f.digsSys.sdf(cam.x, cam.y, cam.z) < -0.3) break;
        }
      }
    } else if (f && f.terrain) {
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
      const targetFov = rt.aiming ? base * 0.55 : base + (p.boosting ? 9 : 0) + (rt.cruise ? 10 : 0);
      if (Math.abs(this.camera.fov - targetFov) > 0.05) {
        this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-dt * (rt.aiming ? 12 : 3)));
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
      const tol = b.radius * 1.05 + Math.min(4, along * 0.006);
      if (perp < tol) {
        const score = perp / tol + along / 4000;
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
    // a titan is struck through its body parts
    if (b.type === 'titanpart') return this.hitTitan(b, dmg, pos, kind);
    const backstab = kind !== 'poison' && kind !== 'pressure' && this.arts.consumeBackstab();
    const crit = backstab || (kind !== 'pressure' && kind !== 'poison' && Math.random() < this.stats.crit + this.arts.critBonus(kind));
    const temper = kind === 'turret' || kind === 'pet' || kind === 'pressure' || kind === 'ram' ? 0 : ((this.state.gear && this.state.gear.temper[activePath(this.state)]) || 0);
    let amount = dmg * (backstab ? 3 : crit ? 2 : 1) * (0.9 + Math.random() * 0.2) * this.arts.damageMult(b, kind) * (1 + 0.15 * temper);
    if (b.duelist) {
      amount = this.training.duel.reduceIncoming(amount, kind);
      if (amount <= 0) { this.dmgNum(pos, this.training.duel.countdown > 0 ? 'GET READY' : 'EVADE', 'xp'); return; }
    }
    const steal = this.arts.lifesteal();
    if (steal > 0 && !b.static) this.rt.hp = Math.min(this.stats.maxHp, this.rt.hp + amount * steal);
    this.dmgNum(pos, fmt(amount), crit ? 'crit' : kind === 'sword' || kind === 'storm' ? 'sword' : kind === 'poison' ? 'xp' : '');
    if (kind === 'bolt') this.sound.hit(pos);
    if (b.static && b.def.color) this.particles.burst(pos, new THREE.Color(b.def.color).multiplyScalar(2), 8, 20, 0.5, 0.4);
    const killed = this.beasts.damage(b, amount, this.time, knock);
    this.arts.onHit(b, kind, killed);
    if (!killed && !b.static && kind !== 'poison' && kind !== 'pressure') this.wound(b, pos, amount);
    if (kind !== 'poison') this.hud.hitmarker(killed);
  }

  hitTitan(part, dmg, pos, kind) {
    const titan = part.owner, boss = titan.boss;
    if (!boss.alive) return;
    const crit = kind !== 'pressure' && kind !== 'poison' && Math.random() < this.stats.crit + this.arts.critBonus(kind);
    const temper = (this.state.gear && this.state.gear.temper[activePath(this.state)]) || 0;
    let amount = dmg * (crit ? 2 : 1) * (0.9 + Math.random() * 0.2) * this.arts.damageMult(boss, kind) * (1 + 0.15 * temper);
    amount = titan.hitPart(part, amount);
    this.dmgNum(pos, fmt(amount), part.weak && !part.broken ? 'crit' : crit ? 'crit' : '');
    this.particles.burst(pos, new THREE.Color(part.weak && !part.broken ? titan.def.accent : 0xffffff).multiplyScalar(1.6), part.weak ? 14 : 6, 30, 0.8, 0.4);
    const killed = this.beasts.damage(boss, amount, this.time, null);
    this.arts.onHit(boss, kind, killed);
    if (kind !== 'poison') this.hud.hitmarker(killed);
  }

  // A visible wound where a beast was hit, and bits of it flying off.
  wound(b, pos, amount) {
    const heavy = amount > b.maxHp * 0.12;
    const col = b.def.color || 0x884444;
    this.combat.debris(pos, heavy ? 0x7a1a14 : col, heavy ? 5 : 2, Math.max(0.25, b.radius * (heavy ? 0.14 : 0.08)));
    this.particles.burst(pos, new THREE.Color(1.4, 0.15, 0.1), heavy ? 18 : 8, 18 + b.radius * 3, 0.5, 0.45, 2);
    if (!b.mesh || (b.wounds || 0) >= 7 || amount < b.maxHp * 0.04) return;
    b.wounds = (b.wounds || 0) + 1;
    if (!this.woundMat) this.woundMat = new THREE.MeshStandardMaterial({ color: 0x2a0806, roughness: 0.9, emissive: 0x3a0400, emissiveIntensity: 0.6 });
    if (!this.woundGeo) this.woundGeo = new THREE.IcosahedronGeometry(1, 0);
    const m = new THREE.Mesh(this.woundGeo, this.woundMat);
    b.mesh.updateMatrixWorld();
    const local = b.mesh.worldToLocal(this.toWorld(pos).clone());
    // wounds sit on the surface: pull the point in toward the centre a little
    m.position.copy(local).multiplyScalar(0.92);
    const s = (0.18 + Math.min(0.5, amount / b.maxHp)) * b.radius * 0.45 / Math.max(0.001, b.mesh.scale.x);
    m.scale.set(s, s * 0.45, s);
    m.lookAt(local.clone().multiplyScalar(2));
    m.userData.shared = true;
    b.mesh.add(m);
  }

  hurtPlayer(amount, pos, knock, silent = false, shot = null) {
    if (this.training?.duel?.active && this.training.duel.countdown > 0) return null;
    if (this.training?.active && this.training.options.god) return null;
    const rt = this.rt;
    if ((this.mode !== 'playing' && this.mode !== 'virtual') || rt.invuln > 0) return null;
    if (!rt.inShip && !silent) {
      const d = this.arts.defend(amount, pos, shot);
      if (d.reflect) return 'reflect';
      if (d.parried) return null;
      amount = d.amount;
      if (amount <= 0) return null;
    }
    if (rt.inVehicle && this.vehicleObj) amount /= this.vehicleObj.def.hull;
    if (this.mode === 'virtual' && !silent) this.post.fx.glitch = Math.min(1, this.post.fx.glitch + 0.35);
    if (rt.inShip && this.shipObj) {
      // the hull soaks damage until it fails
      this.shipObj.hull -= amount * 0.6;
      if (!silent) {
        rt.shake = Math.min(1.2, rt.shake + 0.4);
        if (this.training?.active) this.hud.simulationHit();
        else { this.post.fx.damage = Math.min(1, this.post.fx.damage + 0.3); if (this.mode === 'virtual') this.hud.physicalHit(); }
        this.sound.hurt();
      }
      if (this.shipObj.hull > 0) return null;
      this.shipObj.hull = this.shipObj.maxHull * 0.25;
      this.hud.notify('Hull breach! You are thrown from your ship.', 'red');
      this.exitShip(true);
      amount *= 0.5;
    }
    if (rt.hp - amount <= 0 && this.state.realm >= 7 && rt.undyingCd <= 0) {
      // Immortal realm: death hesitates
      rt.undyingCd = 300;
      rt.hp = this.stats.maxHp * 0.3;
      rt.invuln = 2;
      this.hud.banner('UNDYING', 'Death Hesitates', '<span class="cn">不朽</span>Your soul refuses to fall', '#b69cff', 2.5, true);
      this.particles.burst(this.player.pos, new THREE.Color(1.6, 1.2, 2.4), 120, 30, 1.2, 1);
      return null;
    }
    if (this.training?.duel?.active && rt.hp - amount <= 0) { this.training.duel.finish('lost'); return null; }
    rt.hp -= amount;
    rt.lastHurt = this.time;
    if (!silent) {
      rt.hurtFlash = 0.4;
      rt.medBlock = 0.8;
      rt.shake = Math.min(1.2, rt.shake + 0.5);
      if (this.training?.active) this.hud.simulationHit();
      else { this.post.fx.damage = Math.min(1, this.post.fx.damage + 0.6); if (this.mode === 'virtual') this.hud.physicalHit(); }
      this.viewmodel.hit();
      this.player.act(amount > this.stats.maxHp * 0.2 ? 'knockback' : 'hit');
      this.sound.hurt();
      this.dmgNum(this.player.pos.clone().addScaledVector(this.player.forward(tA), 4), `-${fmt(amount)}`, 'player');
      rt.cruise = false;
    }
    if (knock) {
      // a shove, mostly sideways with a little hop: never a launch into the sky
      const k = knock.clone();
      const up = this.env.up;
      if (up) {
        k.addScaledVector(up, -k.dot(up));
        k.multiplyScalar(this.player.mode === 'ground' ? 0.3 : 0.4);
        if (this.player.mode === 'ground') k.addScaledVector(up, 4);
      } else k.multiplyScalar(0.4);
      this.player.vel.add(k);
    }
    if (rt.hp <= 0) this.die();
    return null;
  }

  die() {
    if (this.campaign?.planetary?.onDeath()) return;
    if (this.mode === 'virtual') {
      // killed while logged in: you're torn out of the Virtual Universe
      this.exitVirtual();
      this.hud.notify('Your body was killed while you were logged in to the Virtual Universe.', 'red');
    }
    this.dismount();
    this.player.fall();
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
    this.nix.event('death', {}, 2);
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
    this.player.revive();
    this.rt = this.freshRuntime();
    this.rt.invuln = 3;
    this.arts.reset();
    this.arena = null;
    this.mode = 'playing';
    this.beasts.clear();
    this.combat.clear();
    this.loot.clear();
    this.statics.clear();
    const bind = this.state.bind;
    let planet = null;
    if (bind && bind.star === this.star.key && bind.body) planet = this.system.byId.get(bind.body) || null;
    this.spawnAtSettlement(planet, bind && bind.site);
    // a tent you rested in takes precedence
    const tent = (this.state.placed || []).find((r) => r.id === this.state.respawnAt);
    if (tent && tent.star === this.star.key && this.frame && tent.body === this.frame.body.id) {
      const at = new THREE.Vector3().fromArray(tent.pos);
      const up = at.clone().normalize();
      const side = new THREE.Vector3(1, 0, 0).projectOnPlane(up).normalize();
      const pos = at.clone().addScaledVector(side, 3.5);
      const n = pos.clone().normalize();
      pos.copy(n.multiplyScalar(this.frame.floorRadius(n.x, n.y, n.z) + EYE));
      this.player.placeAt(pos, at, up);
      this.camQuat.copy(this.player.quat);
    }
    this.applyCamMode();
    this.swords.setVisible(true);
    this.swords.reset(this.player);
    this.menus.showDeath(false);
    this.particles.converge(this.player.pos, this.player.auraColor.clone().multiplyScalar(2), 120, 12, 14, 0.6);
    this.hud.notify(`Your body reforms at <b>${esc(this.locationLabel())}</b>.`, 'gold');
    this.nix.event('respawn');
  }

  onBeastKilled(b) {
    if (b.duelist) { this.training.duel.finish('won'); return; }
    const s = this.state, rt = this.rt;
    if (b.static) return;
    s.kills++;
    let xp = 18 * xpScale(b.tier) * b.def.xp * b.xpMult;
    if (!b.boss && b.tier < s.realm - 1) xp *= 0.25;
    if (s.devour) {
      xp *= 1.2;
      rt.hp = Math.min(this.stats.maxHp, rt.hp + this.stats.maxHp * 0.04);
    }
    const coins = Math.round(12 * Math.pow(2.2, b.tier) * b.def.coins * b.coinMult * this.stats.loot);
    s.coins += coins;
    const cores = Math.max(1, Math.round((b.def.cores || 1) * (b.elite ? 3 : 1)));
    this.loot.spawn(b.pos, essenceFor(b.tier) * cores * this.stats.loot, b.boss ? b.def.accent : 0xff3c7d, Math.min(cores, 12));
    const up = this.env.up || Y;
    this.dmgNum(b.pos.clone().addScaledVector(up, b.radius), `+${fmt(xp)} EXP`, 'xp');
    if (b.boss && !b.planetary) {
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
        extra = ` · ${TECHS[k].name} mastery ${s.mastery[k]}`;
      }
      this.hud.banner('OVERLORD SLAIN', b.def.name, `<span class="cn">${b.def.cn}</span>+10% life and attack${extra}`, hex(b.def.accent), 5);
      this.post.fx.flash = 0.5;
      if (b.bossIndex === FINAL_BOSS) setTimeout(() => this.hud.notify('The Primordial Devourer is gone. Nothing bars your path to <b>Universe Master</b>.', 'gold'), 2500);
    }
    if (hasRing(s) && b.def && b.def.name && b.type !== 'boss') {
      const n = b.elite ? 2 : Math.random() < 0.65 ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const part = partFor(b.def, b.tier, Math.random() < (b.elite ? 0.5 : 0.22));
        this.loot.spawn(b.pos, 1, part.color, 1, 'part', part);
      }
    }
    this.applyBounties(progressBounties(s, { kind: 'kill', type: b.type, elite: b.elite, region: this.star.region, bossStar: b.boss && !b.planetary ? this.star.key : null, tier: b.tier, realm: s.realm }));
    this.nix.onKill(b);
    this.campaign.event('kill', b);
    // planetary bosses are rewarded by their story mission, not here
    if (b.boss && !b.planetary) this.gainInsight('the fallen Overlord');
    this.addXp(xp);
    if (b.boss) this.save();
  }

  // ------------------------------------------------------ progression --
  addXp(amount) {
    if (this.training?.active) return;
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
        this.nix.event('stageUp');
        this.save();
      } else {
        s.xp = this.stats.xpNeed;
        if (!this.peakNotified) {
          this.peakNotified = true;
          const bt = this.breakthroughStatus();
          if (bt.ready) {
            this.hud.notify(`Your cultivation has reached its <b>Peak</b>. Press <kbd>${codeLabel(settings.key('breakthrough'))}</kbd> to face the Heavenly Tribulation.`, 'gold');
            this.nix.event('btReady', {}, 1);
          } else if (bt.bottleneck) {
            this.hud.notify('You have hit a <b>bottleneck</b>. Experience alone will not carry you further: you need a <b>Realm Insight</b>.', 'violet');
            this.nix.event('bottleneck', {}, 2);
          } else if (bt.blocked) this.hud.notify(bt.blocked, 'violet');
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
      if (b.reward.insight) this.gainInsight('the Martial Hall trial');
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
    if (s.realm === MAX_REALM - 1 && !s.bosses.includes(CORE_KEY) && !this.training?.active) return { ready: false, blocked: 'PEAK · SLAY THE PRIMORDIAL DEVOURER TO ASCEND' };
    if ((s.insight || 0) < 1) return { ready: false, blocked: 'BOTTLENECK · SEEK A REALM INSIGHT', bottleneck: true };
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
    s.insight = Math.max(0, (s.insight || 0) - 1);
    this.nix.event('trib', {}, 2);
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
    this.nix.event('breakthrough', {}, 2);
    if (s.realm === 1) this.nix.once('fly', 'firstFly', {}, 1);
    this.hud.banner('BREAKTHROUGH', realm.name, `<span class="cn">${realm.cn}</span>${esc(realm.blurb)}`, hex(realm.color), 5);
    if (this.stats.swords > derive({ ...s, realm: s.realm - 1 }).swords) setTimeout(() => this.hud.notify(`A new flying sword answers your call. You now command <b>${this.stats.swords}</b>.`, 'violet'), 2000);
    const fresh = ownedPaths(s).flatMap((id) => PATHS[id].skills).filter((id) => TECHS[id].unlockRealm === s.realm && !knows(s, id));
    if (fresh.length) setTimeout(() => this.hud.notify(`New techniques can be learned: <b>${fresh.map((id) => TECHS[id].name).join(', ')}</b>. Open your skill tree.`, 'violet'), 3000);
    const perk = REALM_PERKS.find((pk) => pk.realm === s.realm);
    if (perk && s.realm > 2) setTimeout(() => this.hud.notify(`Realm power: <b>${perk.name}</b>. ${perk.desc}`, 'gold'), 4500);
    setTimeout(() => this.hud.notify(`You earned skill points. Press <kbd>${codeLabel(settings.key('panelSkills'))}</kbd> to open your skill tree.`, 'yl'), 6000);
    if (s.realm === 1) setTimeout(() => this.hud.notify(`You can fly! <b>Double-tap ${codeLabel(settings.key('jump'))}</b> to take to the sky.`, 'gold'), 4000);
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
        this.nix.once(`disc_${poi.poi.kind}`, `discover.${poi.poi.kind}`, {}, 0);
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
              this.campaign.event('mine');
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
      } else if (false && poi.poi.kind === 'lair') {
        this.beasts.spawnBoss(this.star.boss, poi.pos.clone().addScaledVector(poi.up, 120), this.star.tier);
        const def = BOSSES[this.star.boss];
        this.hud.banner('OVERLORD', def.name, `<span class="cn">${def.cn}</span>has awakened`, hex(def.color), 4);
      }
    }
  }

  // The World-Eater of a boss system: it sleeps coiled round the lair world, wakes
  // when you come close and goes back to sleep (whole again) if you die or leave.
  updateWorldEater(dt) {
    const we = this.worldEater;
    if (we) {
      if (!we.boss.alive) {
        if ((we.dying || 0) > 6.5) { we.dispose(); this.worldEater = null; }
        return;
      }
      const far = this.playerWorld ? we.centre().distanceTo(this.player.pos) > we.R * 14 : false;
      if (we.system !== this.system || this.mode === 'dead' || far || this.training.active) { we.dispose(); this.worldEater = null; return; }
      if (this.mode === 'playing') we.update(dt);
      return;
    }
    const st = this.star;
    if (this.mode !== 'playing' || this.training.active || st.boss === null || st.boss === undefined || this.state.bosses.includes(st.key)) return;
    const lair = this.system?.gen?.lairBody;
    const planet = lair && this.system.planets.find((p) => p.body.id === lair);
    if (!planet) return;
    const c = planet.spin.getWorldPosition(new THREE.Vector3());
    this.localRoot.worldToLocal(c);
    if (c.distanceTo(this.player.pos) > planet.R * 12) return;
    this.worldEater = new WorldEater(this, st.boss, planet);
    this.worldEater.system = this.system;
  }

  // ------------------------------------------------------ interaction --
  gatherInteractables() {
    const list = [];
    for (const pod of this.pods) if (pod.landed) list.push({ kind: 'pod', pod, name: 'Delivery pod', pos: pod.pos, range: 5 });
    if (this.shipObj && !this.rt.inShip) list.push({ kind: 'ship', name: 'your ship', pos: this.shipObj.pos, range: 18 * this.shipObj.scale });
    if (this.vehicleObj && !this.rt.inVehicle && !this.rt.inShip) list.push({ kind: 'vehicle', name: this.vehicleObj.def.name, pos: this.vehicleObj.pos, range: this.vehicleObj.def.radius + 3 });
    for (const e of this.structures.list) if (e.rec.type === 'tent') list.push({ kind: 'tent', entry: e, name: 'Camp Tent', pos: e.pos, range: 5 });
    if (count(this.state, 'collar') && !this.rt.inShip && !this.rt.inVehicle) {
      for (const b of this.beasts.beasts) {
        if (!b.alive || b.static || b.boss || b.tag || !b.def || !b.def.arch || b.def.aquatic) continue;
        if (b.hp > b.maxHp / 3) continue;
        list.push({ kind: 'tame', beast: b, name: b.name, pos: b.pos, range: b.radius + 4 });
      }
    }
    const f = this.frame;
    if (f && f.details) {
      for (const sv of f.details.services) list.push({ kind: 'service', service: sv, name: sv.name, pos: sv.pos, range: sv.range });
      for (const poi of f.details.pois) {
        if (poi.poi.kind === 'ruin' || poi.poi.kind === 'wreck' || poi.poi.kind === 'obelisk') list.push({ kind: 'poi', poi, name: POI_LABEL[poi.poi.kind], pos: poi.pos, range: poi.obj.range || 30 });
      }
    }
    for (const st of this.system.stations) {
      if (!st.localM) continue;
      const center = new THREE.Vector3().applyMatrix4(st.localM);
      if (this.rt.inShip) {
        if (!this.shipObj.dockedAt) list.push({ kind: 'dock', station: st, name: st.def.name, pos: center, range: 600 });
        continue;
      }
      if (!this.deck || this.deck.st !== st) continue;
      for (const sv of st.model.services) {
        list.push({ kind: 'service', service: { ...sv, city: st.def.name, station: st }, name: sv.name, pos: sv.local.clone().applyMatrix4(st.localM), range: sv.range });
      }
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
        if (rt.inShip && it.kind !== 'dock') continue;
        const d = ref.distanceTo(it.pos);
        if (d < it.range && d < bd) { bd = d; this.interact = it; }
      }
      if (rt.inShip && !this.interact) this.interact = { kind: 'leave' };
      if (rt.inVehicle) this.interact = { kind: 'dismount' };
    }
    const it = this.interact;
    let progress = 0;
    if (it && it.kind === 'poi' && !this.state.explored.includes(it.poi.poi.id) && inp.act('interact')) {
      rt.scanT += dt;
      progress = rt.scanT / SCAN_TIME;
      this.sound.scanTick();
      if (rt.scanT >= SCAN_TIME) {
        rt.scanT = 0;
        this.searchPoi(it.poi);
      }
    } else {
      rt.scanT = 0;
      if (it && inp.hit('interact')) this.doInteract(it);
    }
    this.hud.setPrompt(this.promptText(it), progress);
  }

  promptText(it) {
    if (!it) return null;
    if (it.kind === 'leave') return this.canExitShip() ? '<kbd>E</kbd> LEAVE SHIP' : null;
    if (it.kind === 'ship') return '<kbd>E</kbd> BOARD YOUR SHIP';
    if (it.kind === 'vehicle') return `<kbd>E</kbd> RIDE YOUR ${esc(it.name.toUpperCase())}`;
    if (it.kind === 'tent') return '<kbd>E</kbd> REST IN THE TENT';
    if (it.kind === 'tame') return `<kbd>E</kbd> TAME THE ${esc(it.name.toUpperCase())}`;
    if (it.kind === 'dismount') return null;
    if (it.kind === 'pod') return '<kbd>E</kbd> OPEN THE DELIVERY POD';
    if (it.kind === 'service' && it.service.kind === 'lore') return `<kbd>E</kbd> ACCESS THE OLD TERMINAL${this.state.lore.includes(it.service.lore) ? ' · READ' : ''}`;
    if (it.kind === 'service') return `<kbd>E</kbd> ${esc(it.name.toUpperCase())}`;
    if (it.kind === 'dock') return `<kbd>E</kbd> LAND ON ${esc(it.name.toUpperCase())}`;
    if (it.kind === 'poi') {
      if (this.state.explored.includes(it.poi.poi.id)) return `${esc(it.name.toUpperCase())} · ALREADY SEARCHED`;
      if (it.poi.poi.kind === 'obelisk' && this.trial) return 'THE TRIAL IS UNDER WAY';
      return `HOLD <kbd>E</kbd> ${it.poi.poi.kind === 'wreck' ? 'SALVAGE THE WRECK' : it.poi.poi.kind === 'obelisk' ? 'TOUCH THE OBELISK · BEGIN THE TRIAL' : 'SEARCH THE RUINS'}`;
    }
    return null;
  }

  canExitShip() {
    const env = this.env;
    if (!this.shipObj) return false;
    if (this.shipObj.dockedAt) return true;
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
    } else if (it.kind === 'vehicle') {
      this.mountVehicle();
    } else if (it.kind === 'tent') {
      this.restInTent(it.entry);
    } else if (it.kind === 'tame') {
      this.tame(it.beast);
    } else if (it.kind === 'dismount') {
      this.dismount();
    } else if (it.kind === 'pod') {
      this.openPod(it.pod);
    } else if (it.kind === 'dock') {
      this.dockShip(it.station);
    } else if (it.kind === 'service' && it.service.kind === 'lore') {
      this.readLore(it.service.lore);
    } else if (it.kind === 'service' || it.kind === 'station') {
      const vk = it.kind === 'station' ? 'station' : it.service.kind;
      this.rt.hp = this.stats.maxHp;
      this.rt.energy = this.stats.maxEnergy;
      this.rt.spirit = this.stats.maxSpirit;
      if (this.shipObj && this.rt.inShip) this.shipObj.hull = this.shipObj.maxHull;
      this.lastService = it;
      this.venueKind = vk;
      const city = it.service && it.service.city;
      if (!s.home || s.home.star !== this.star.key) s.bind = { star: this.star.key, body: this.frame ? this.frame.body.id : null, site: city || null };
      if (city) this.applyBounties(progressBounties(s, { kind: 'arrive', city }));
      if (s.offers.length < 3) s.offers.push(...generateOffers(s, this.offerContext(), 3 - s.offers.length));
      // bottlenecked cultivators can always earn an insight at a Martial Hall
      const needs = s.stage === 3 && (s.insight || 0) < 1;
      if (vk === 'hall' && needs && ![...s.offers, ...s.bounties].some((b) => b.type === 'insight')) s.offers.unshift(insightTrial(s));
      const panel = {
        station: 'shop', hall: 'bounties', shipyard: 'shipyard', exchange: 'shop', pills: 'shop', forge: 'forge',
        clinic: 'clinic', chamber: 'chamber', bar: 'bar', food: 'food', home: 'home', arena: 'arena', camp: 'shop', lore: 'archive', dealer: 'dealer',
      }[vk] || 'shop';
      this.menus.openPanel(panel);
      this.input.unlock();
      this.sound.confirm();
      this.save();
    }
  }

  // ---------------------------------------------------- stations --
  // Orbital stations are moving platforms: whatever stands or rests on a deck
  // is carried along by the station's motion in our frame.
  updateStations() {
    const p = this.player, rt = this.rt, ship = this.shipObj;
    this.localRoot.updateWorldMatrix(true, false);
    const invRoot = this.localRoot.matrixWorld.clone().invert();
    const ref = rt.inShip && ship ? ship.pos : p.pos;
    let deck = null;
    let moved = false;
    for (const st of this.system.stations) {
      st.group.updateWorldMatrix(true, false);
      const M = invRoot.clone().multiply(st.group.matrixWorld);
      const prev = st.prevM;
      st.prevM = M;
      st.localM = M;
      const inv = M.clone().invert();
      const here = ref.clone().applyMatrix4(inv);
      if (here.length() > 900) { st.prevM = M; continue; }
      if (prev) {
        const D = M.clone().multiply(prev.clone().invert());
        const q = new THREE.Quaternion().setFromRotationMatrix(D);
        if (this.deck && this.deck.st === st && !rt.inShip) {
          p.pos.applyMatrix4(D);
          p.vel.applyQuaternion(q);
          p.quat.premultiply(q);
          p.up.applyQuaternion(q);
          this.camQuat.premultiply(q);
          p.syncRoot();
          moved = true;
        }
        if (ship && ship.dockedAt === st) {
          ship.pos.applyMatrix4(D);
          ship.quat.premultiply(q);
          ship.sync();
          if (rt.inShip) {
            p.pos.copy(ship.pos);
            p.quat.copy(ship.quat);
            this.camQuat.premultiply(q);
            p.syncRoot();
            moved = true;
          }
        }
      }
      if (ship && ship.landed && !ship.dockedAt && st.model.onDeck(ship.pos.clone().applyMatrix4(inv))) ship.dockedAt = st;
      if (!rt.inShip && st.model.onDeck(p.pos.clone().applyMatrix4(inv))) {
        deck = { st, M, inv, q: new THREE.Quaternion().setFromRotationMatrix(M) };
      }
    }
    if (deck && (!this.deck || this.deck.st !== deck.st)) {
      this.hud.notify(`You set foot on <b>${esc(deck.st.def.name)}</b>.`, 'yl');
      this.nix.once('station', 'station', {}, 0);
    }
    this.deck = deck;
    if (moved) this.positionCamera(0);
  }

  dockShip(st) {
    const ship = this.shipObj, p = this.player;
    if (!ship || !st.localM) return;
    const M = st.localM;
    const q = new THREE.Quaternion().setFromRotationMatrix(M);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize();
    const padL = st.model.pads[Math.floor(Math.random() * st.model.pads.length)];
    const pad = padL.clone().applyMatrix4(M);
    const center = new THREE.Vector3(0, 0, 0).applyMatrix4(M);
    ship.placeAt(pad.clone().addScaledVector(up, ship.gearHeight), center.clone().addScaledVector(up, ship.gearHeight), up);
    ship.vel.set(0, 0, 0);
    ship.landed = true;
    ship.dockedAt = st;
    this.rt.inShip = false;
    this.rt.cruise = false;
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.quat);
    const at = ship.pos.clone().addScaledVector(side, 16 * ship.scale).addScaledVector(up, EYE - ship.gearHeight + 0.2);
    p.placeAt(at, center.clone().addScaledVector(up, EYE), up);
    p.vel.set(0, 0, 0);
    p.mode = 'ground';
    this.swords.setVisible(true);
    this.swords.reset(p);
    this.applyCamMode();
    this.camQuat.copy(p.quat);
    this.hud.notify(`Docked at <b>${esc(st.def.name)}</b>. The booths around the spire are open for business.`, 'yl');
    this.sound.confirm();
  }

  // ------------------------------------------------------- city life --
  mealActive(kind) {
    const m = this.state.meal;
    return !!m && m.kind === kind && this.state.playtime < m.until;
  }

  updateVenue(dt) {
    const p = this.player, rt = this.rt, s = this.state;
    const f = this.frame;
    let found = null;
    if (f && f.details && !rt.inShip) {
      for (const st of f.details.settlements) {
        if (p.pos.distanceTo(st.group.position) > st.radius + 60) continue;
        const v = st.venueAt(p.pos);
        if (v) { found = { v, st }; break; }
      }
    }
    const prev = this.inVenue;
    this.inVenue = found;
    if (found && (!prev || prev.v !== found.v) && found.v.kind !== 'lobby') {
      this.nix.once(`venue_${found.v.kind}`, `venue.${found.v.kind}`, {}, 0);
      this.hud.notify(`<b>${esc(found.v.name)}</b> <span class="cn">${found.v.cn}</span>`, 'yl');
    }
    rt.chamber = !!found && found.v.kind === 'chamber' && s.chamberUntil > s.playtime;
    this.updateArena(dt);
    this.updateTrial();
  }

  sell(kind, frac) {
    const s = this.state;
    if (kind === 'ore') {
      const n = Math.floor(s.ore * frac);
      if (n <= 0) return this.sound.deny();
      s.ore -= n;
      const coins = n * SELL.ore(Math.min(s.realm, this.star.tier + 1));
      s.coins += coins;
      this.hud.notify(`Sold ${n} star metal for <b>${fmt(coins)} ◈</b>.`, 'gold');
    } else {
      const n = Math.floor(s.essence * frac);
      if (n <= 0) return this.sound.deny();
      s.essence -= n;
      const coins = Math.max(1, Math.round(n * SELL.essence));
      s.coins += coins;
      this.hud.notify(`Sold ${fmt(n)} essence for <b>${fmt(coins)} ◈</b>.`, 'gold');
    }
    this.sound.pickup();
    this.save();
  }

  geneCost() {
    return priceFor(220 * Math.pow(1.45, this.state.gene || 0), Math.max(0, this.state.realm - 1));
  }

  geneCap() {
    return 3 + this.state.realm * 2;
  }

  updateCityLight() {
    const f = this.frame, L = this.cityLight;
    let best = null, bd = Infinity;
    if (f && f.details && this.localRoot.parent === f.spin) {
      for (const st of f.details.settlements) {
        const d = st.group.position.distanceTo(this.player.pos);
        if (d < bd) { bd = d; best = st; }
      }
    }
    if (!best || bd > best.glow.distance + 600) {
      L.intensity = 0;
      return;
    }
    L.position.copy(best.group.position).addScaledVector(tA.copy(best.group.position).normalize(), 120);
    L.intensity = best.glow.intensity;
    L.distance = best.glow.distance;
  }

  // ------------------------------------------------------- story --
  async playCutscene(script) {
    const rt = this.rt;
    this.mode = 'cutscene';
    rt.meditating = false;
    rt.medToggle = false;
    rt.controlling = false;
    this.menus.closePanel();
    this.hud.show(false);
    document.getElementById('nix').classList.add('hidden');
    this.viewmodel.setVisible(false);
    this.post.vmEnabled = false;
    this.swords.setVisible(false);
    this.player.setVisible(!!script.showPlayer);
    const fov = this.camera.fov;
    this.cutscene.talk = null;
    await this.cutscene.play(script);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    if (this.mode !== 'cutscene') return;
    this.mode = 'playing';
    rt.invuln = Math.max(rt.invuln, 1.5);
    this.hud.show(true);
    this.swords.setVisible(!rt.inShip);
    this.swords.reset(this.player);
    this.applyCamMode();
    this.camQuat.copy(this.player.quat);
    if (!this.input.locked && !this.menus.overlayOpen) this.menus.showPause(true);
  }

  // Act I is the start of a journey (you are seventeen, with two years of savings),
  // so it can only begin on a character who hasn't got far yet.
  canBeginStory() { return this.state.realm < 2 && !this.state.ship; }

  // Set the story down (for a character who started it after they'd already got far).
  async leaveStory() {
    if (this.campaign?.planetary?.active) return this.denied('Not in the middle of a planetary siege.');
    const ok = await this.menus.confirm('Leave the story?', 'Your story progress is cleared. Your character, items and everything else stay as they are.', 'Leave the story', true);
    if (!ok) return;
    this.campaign.cleanup();
    this.state.campaign = null;
    this.campaign.render();
    this.save();
    this.hud.notify('You left the story. The galaxy is yours to roam.', 'gold');
    if (this.menus.panelKind) this.menus.render();
  }

  beginStory() {
    if (this.training.active) return this.denied('Return to your real character to begin the story.');
    if (!this.canBeginStory()) return this.denied('The story starts a new journey. Start a Campaign from the title screen to play it.');
    this.closePanel();
    this.state.nixAwake = false;
    this.campaign.begin();
    if (!this.campaign.onTerra()) this.hud.notify('The story begins on <b>Terra</b>. Head home to Base City 07.', 'gold');
  }

  // ------------------------------------------------ virtual universe --
  enterVirtual() {
    if (this.campaign?.planetary?.active) return this.denied('The planetary siege is live. You cannot leave your body undefended.');
    if (this.training.active) { this.training.leave(); return; }
    const rt = this.rt;
    if (this.mode !== 'playing') return;
    rt.meditating = false;
    rt.cruise = false;
    this.mode = 'virtual';
    this.vu.enter(this.width / this.height);
    this.post.renderPass.scene = this.vu.scene;
    this.post.renderPass.camera = this.vu.camera;
    this.post.vmEnabled = false;
    this.flare.visible = false;
    this.hud.show(false);
    this.hud.setPrompt(null);
    document.getElementById('vu-hud').classList.remove('hidden');
    document.getElementById('vu-sub').textContent = `BODY AT ${this.locationLabel().toUpperCase()}`;
    rt.vuHurtT = -99;
    this.sound.warp();
    const fade = document.getElementById('fade');
    fade.style.opacity = 0.8;
    setTimeout(() => { fade.style.opacity = 0; }, 250);
    this.nix.once('vu', 'vuIntro', {}, 1);
    this.campaign.event('vuEnter');
    this.save();
  }

  exitVirtual() {
    if (this.mode !== 'virtual') return;
    this.mode = 'playing';
    // a training world built for a session that never started is thrown away
    if (!this.training.active) this.training.release();
    this.vu.clearTargets();
    this.post.renderPass.scene = this.scene;
    this.post.renderPass.camera = this.camera;
    this.flare.visible = true;
    document.getElementById('vu-hud').classList.add('hidden');
    this.hud.show(true);
    this.applyCamMode();
    this.sound.warp();
    this.clock.getDelta();
  }

  updateVirtual(dt) {
    const inp = this.input;
    const mouse = inp.consumeMouse();
    const sens = 0.0021 * settings.get('sensitivity');
    const res = this.vu.update(dt, inp, { x: mouse.x, y: mouse.y * (settings.get('invertY') ? -1 : 1) }, sens);
    const prompt = document.getElementById('vu-prompt');
    const k = res.interact;
    if (k) {
      prompt.classList.remove('hidden');
      prompt.innerHTML = `<kbd>${codeLabel(settings.key('interact'))}</kbd> ${k.id === 'exit' ? 'LOG OUT' : k.name.toUpperCase()}`;
    } else prompt.classList.add('hidden');
    const simEl = document.getElementById('vu-sim');
    simEl.classList.toggle('hidden', !this.vu.sim);
    if (this.vu.sim) simEl.textContent = `TARGETS ${this.vu.sim.left} · ${this.vu.sim.t.toFixed(1)} s`;
    if (res.simDone !== null) this.finishSim(res.simDone);
    if (inp.hit('virtual')) return this.exitVirtual();
    if (k && inp.hit('interact')) {
      if (k.id === 'exit') return this.exitVirtual();
      this.venueKind = 'virtual';
      this.lastService = { kind: 'service', service: { kind: 'virtual' } };
      if (k.id === 'bounties' && this.state.offers.length < 3) this.state.offers.push(...generateOffers(this.state, this.offerContext(), 3 - this.state.offers.length));
      this.interact = { kind: 'service', service: { kind: 'virtual' } };
      // walking up to the simulator: start building the training world in the background
      if (k.id === 'sim') this.training.prepare().catch(() => {});
      this.menus.openPanel({ shop: 'vshop', bounties: 'bounties', sim: 'vsim', fame: 'fame' }[k.id]);
      this.input.unlock();
      this.sound.confirm();
    }
  }

  // While logged in: how your body is doing out in the world.
  updateBodyStatus() {
    const rt = this.rt, el = document.getElementById('vu-body');
    if (!el) return;
    const frac = Math.max(0, rt.hp) / this.stats.maxHp;
    const hurt = this.time - rt.lastHurt < 2;
    el.classList.toggle('alert', hurt || frac < 0.35);
    el.innerHTML = `<span>${hurt ? '⚠ YOUR BODY IS UNDER ATTACK' : 'BODY'}</span><div class="vu-hp"><i style="width:${(frac * 100).toFixed(1)}%"></i></div><span>${Math.ceil(Math.max(0, rt.hp))} / ${this.stats.maxHp}</span>`;
  }

  startSim() {
    this.menus.closePanel();
    this.resume();
    this.vu.startSim();
    this.hud.notify('Simulation running. Hit every target as fast as you can.', 'violet');
  }

  finishSim(t) {
    const s = this.state;
    const key = `r${s.realm}`;
    const best = s.simBest[key];
    const first = best === undefined;
    if (first || t < best) s.simBest[key] = t;
    let reward = '';
    if (first) {
      const xp = this.stats.xpNeed * 0.08;
      const coins = Math.round(30 * Math.pow(2.2, s.realm));
      this.addXp(xp);
      s.coins += coins;
      reward = ` First clear at this realm: +${fmt(xp)} experience, +${fmt(coins)} ◈.`;
    }
    this.sound.reward();
    document.getElementById('vu-sim').classList.add('hidden');
    this.hud.notify(`Simulation complete in <b>${t.toFixed(2)} s</b>${!first && t < best ? ' · new record!' : ''}.${reward}`, 'gold');
    this.save();
  }

  // ---- deliveries from the Star Mall
  deliveryEta() {
    const f = this.frame;
    if (f && f.body.landable) {
      let best = Infinity;
      const up = this.player.pos.clone().normalize();
      for (const st of f.allSites()) best = Math.min(best, Math.acos(clamp(up.dot(new THREE.Vector3(st.x, st.y, st.z).normalize()), -1, 1)) * f.R);
      return Math.round(Math.min(150, 8 + best / 350));
    }
    return this.system.stations.length ? 45 : 90;
  }

  orderDelivery(item) {
    const s = this.state;
    const cat = this.mallCatalog().find((c) => c.id === item);
    if (!cat || s.coins < cat.price) return this.sound.deny();
    s.coins -= cat.price;
    setTimeout(() => this.campaign.event('order'), 0);
    const eta = this.deliveryEta();
    s.deliveries.push({ id: `d${Date.now()}-${s.deliveries.length}`, item, label: cat.name, due: s.playtime + eta, price: cat.price,
      ...(item === 'radar' ? { radarTier: (s.radar ?? -1) + 1 } : {}) });
    this.hud.notify(`Ordered <b>${esc(cat.name)}</b>. A drop pod will reach you in about ${eta} s.`, 'yl');
    this.nix.event('delivery', {}, 0);
    this.sound.confirm();
    this.save();
  }

  mallCatalog() {
    const s = this.state, r = s.realm;
    const fee = 1.15;
    const pill = (k, n) => Math.round(priceFor(PILLS[k].price, r) * n * fee);
    const items = [
      { id: 'heal3', name: '3 × Rejuvenation Pill', desc: 'Restore 60% of your life each.', price: pill('heal', 3) },
      { id: 'energy3', name: '3 × Primal Elixir', desc: 'Restore all energy and spirit.', price: pill('energy', 3) },
      { id: 'cult1', name: 'Cultivation Pill', desc: 'A third of a stage of experience.', price: pill('cult', 1) },
      { id: 'ore10', name: 'Crate of star metal (10)', desc: 'Pricier than mining, but no smashing required.', price: Math.round(SELL.ore(Math.max(r, 1)) * 10 * 2.6) },
    ];
    const rn = RADARS[(s.radar ?? -1) + 1];
    if (rn && !s.deliveries?.some(d => d.item === 'radar')) items.push({ id: 'radar', name: rn.name, desc: rn.desc, price: Math.round(rn.price * fee) });
    return items;
  }

  updateDeliveries(dt = 0.016) {
    const s = this.state;
    if (this.mode !== 'playing' || !s.deliveries || !s.deliveries.length) {
      return;
    }
    for (const d of s.deliveries) {
      if (d.due > s.playtime) continue;
      // Couriers rendezvous with a piloted ship instead of stranding its
      // cargo on the planet below. This also recovers existing overdue pods.
      if (this.rt.inShip && this.shipObj) { this.receiveDelivery(d, true); continue; }
      if (this.pods.some((p) => p.delivery === d)) continue;
      this.spawnPod(d);
      this.nix.event('podIncoming', {}, 0);
    }
    for (const pod of this.pods) this.animatePod(pod, dt);
  }

  spawnPod(d) {
    const p = this.player, f = this.frame;
    const up = this.env.up ? this.env.up.clone() : p.localUp();
    const side = new THREE.Vector3(Math.abs(up.x) < 0.9 ? 1 : 0, Math.abs(up.x) < 0.9 ? 0 : 1, 0).projectOnPlane(up).normalize().applyAxisAngle(up, Math.random() * 6.28);
    let land = p.pos.clone().addScaledVector(side, 12);
    if (f && f.terrain) {
      const dd = land.clone().normalize();
      land = dd.multiplyScalar(f.floorRadius(dd.x, dd.y, dd.z) + 1.4);
    }
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 2.6, 10), new THREE.MeshStandardMaterial({ color: 0xc8ccd6, metalness: 0.7, roughness: 0.35 }));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 10), body.material);
    cap.position.y = 1.8;
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.08, 6, 20).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.0, 0.4) }));
    const light = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(2.4, 2.0, 0.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    light.position.y = 2.6;
    light.scale.setScalar(4);
    g.add(body, cap, band, light);
    g.quaternion.setFromUnitVectors(Y, up);
    const start = land.clone().addScaledVector(up, 420);
    g.position.copy(start);
    this.localRoot.add(g);
    this.pods.push({ delivery: d, group: g, light, pos: land.clone(), start, up, t: 0, landed: false });
  }

  animatePod(pod, dt) {
    pod.light.material.opacity = 0.6 + 0.4 * Math.sin(this.time * 5);
    if (pod.landed) return;
    pod.t += dt;
    const k = Math.min(1, pod.t / 2.2);
    pod.group.position.lerpVectors(pod.start, pod.pos, k * k);
    this.particles.emit(pod.group.position.x, pod.group.position.y, pod.group.position.z, 0, 0, 0, new THREE.Color(2.4, 1.4, 0.4), 1.6, 0.6, 0, 0.6);
    if (k >= 1) {
      pod.landed = true;
      this.particles.burst(pod.pos, new THREE.Color(0.7, 0.6, 0.5), 50, 20, 1.2, 1);
      this.combat.shockwave(pod.pos, 10, 0xffe44d, 0.5);
      this.sound.explosion(pod.pos, false);
      this.hud.notify(`Your delivery has landed: <b>${esc(pod.delivery.label)}</b>.`, 'yl');
    }
  }

  openPod(pod) {
    if (!this.pods.includes(pod) || !pod.landed) return;
    this.receiveDelivery(pod.delivery);
  }

  redirectDelivery(id) {
    const d = this.state.deliveries.find(d => d.id === id);
    if (!d || d.due > this.state.playtime) return;
    for (const pod of [...this.pods]) if (pod.delivery === d) this.removePod(pod);
    this.hud.notify('Delivery redirected. Return to your body to receive it; ships receive cargo automatically.', 'yl');
  }

  receiveDelivery(d, inShip = false) {
    const s = this.state;
    if (!s.deliveries.includes(d)) return;
    if (d.item === 'heal3') s.pills.heal += 3;
    else if (d.item === 'energy3') s.pills.energy += 3;
    else if (d.item === 'cult1') s.pills.cult += 1;
    else if (d.item === 'ore10') s.ore += 10;
    else if (d.item === 'radar') {
      // Old saves only stored the purchased radar's label. Recover that
      // exact tier instead of silently upgrading whatever is equipped now.
      const legacyTier = RADARS.findIndex(r => r.name === d.label);
      const tier = Number.isInteger(d.radarTier) ? d.radarTier : legacyTier >= 0 ? legacyTier : (s.radar ?? -1) + 1;
      if (RADARS[tier]) {
        s.radar = Math.max(s.radar ?? -1, tier);
        this.hud.notify(`Installed the <b>${RADARS[s.radar].name}</b>.`, 'violet');
        this.campaign.event('radar');
      } else {
        // nothing better to install: send the money back rather than leave the order hanging
        if (d.price) s.coins += d.price;
        this.hud.notify(`Your radar is already the best there is. The <b>${esc(d.label)}</b> order was returned${d.price ? ' and refunded' : ''}.`, 'yl');
      }
    }
    s.deliveries = s.deliveries.filter((x) => x !== d);
    for (const pod of [...this.pods]) if (pod.delivery === d) this.removePod(pod);
    this.campaign.event('pod');
    this.sound.pickup();
    this.hud.notify(`${inShip ? 'Received aboard your ship' : 'Unpacked'} <b>${esc(d.label)}</b>.`, 'green');
    this.save();
  }

  removePod(pod) {
    this.localRoot.remove(pod.group);
    pod.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.pods = this.pods.filter((p) => p !== pod);
  }

  // Frames changed: drop pods; undelivered orders respawn near you later.
  clearPods() {
    for (const pod of [...(this.pods || [])]) this.removePod(pod);
  }

  // ------------------------------------------------------------ lore --
  readLore(i) {
    const s = this.state;
    const log = LORE[i];
    if (!log) return;
    const fresh = !s.lore.includes(i);
    if (fresh) {
      s.lore.push(i);
      this.addXp(this.stats.xpNeed * 0.12);
      s.coins += Math.round(40 * Math.pow(2.2, s.realm));
      this.hud.notify(`Recovered an archive log: <b>${esc(log.title)}</b>. (${s.lore.length}/${LORE.length})`, 'yl');
      this.sound.reward();
      this.save();
    }
    this.campaign.event('lore', i);
    this.menus.loreFocus = i;
    this.menus.openPanel('archive');
    this.input.unlock();
    if (fresh && log.nix) setTimeout(() => this.nix.say(log.nix, 1), 600);
  }

  // Ruin fields: discovery and markers.
  updateRuinFields(list, origin, fmtKm) {
    const f = this.frame, s = this.state;
    if (!f || !f.details || !f.details.ruins) return;
    for (const e of f.details.ruins) {
      const center = e.dir.clone().multiplyScalar(f.R + 30);
      const d = center.distanceTo(origin);
      const id = `ruinfield:${e.site.index}`;
      const known = s.discovered.includes(id);
      if (d < e.site.radius && !known) {
        s.discovered.push(id);
        this.hud.notify(`Discovered the ruins of <b>${esc(RUIN_NAMES[e.site.index] || 'a lost city')}</b>.`, 'yl');
        this.applyBounties(progressBounties(s, { kind: 'discover' }));
        this.nix.once('ruinfield', 'discover.ruin', {}, 0);
      }
      if (d < e.site.radius * 0.7 || d > (known ? 12000 : 5000)) continue;
      list.push({ key: id, kind: 'hotspot', label: `<span style="color:#c8b89a">${esc((RUIN_NAMES[e.site.index] || 'Ruins').toUpperCase())}${known ? '' : ' ?'}</span>`, sub: fmtKm(d), pos: this.toWorld(center), dist: d, edge: false, compass: d < 3000 ? '#c8b89a' : null });
    }
  }

  // --------------------------------------------------- destruction --
  // Attacks break nearby trees, rocks and street lamps, and scare people.
  breakAt(local, radius, dir) {
    const f = this.frame;
    if (!f || !f.body.landable || !this.env.inAtmo) return;
    const broken = f.breakProps(local, radius, dir);
    for (const b of broken) {
      const col = b.top ? new THREE.Color(0.5, 0.48, 0.44) : b.type === 4 ? new THREE.Color(1.6, 1.2, 2.4) : new THREE.Color(0.35, 0.5, 0.25);
      this.particles.burst(b.pos, col, 24, 14, 0.9, 1.2, 1.2);
    }
    if (broken.length && this.time - (this.lastCrack || 0) > 0.15) {
      this.lastCrack = this.time;
      this.sound.explosion(local, false);
    }
    if (f.details) {
      for (const st of f.details.settlements) {
        if (local.distanceTo(st.group.position) > st.radius + 80) continue;
        st.panic(local);
        for (const pos of st.breakAt(local, radius)) this.particles.burst(pos, new THREE.Color(2.4, 2.0, 1.4), 20, 18, 0.6, 0.6);
      }
    }
  }

  // A fading scorch mark on the ground.
  scorch(local, size) {
    const f = this.frame;
    if (!f || !f.terrain || !this.env.inAtmo) return;
    // clods of earth thrown up by the blow
    this.combat.debris(local, 0x4a3c2e, Math.min(10, Math.round(2 + size)), 0.25 + Math.min(1.2, size * 0.08));
    if (!this.scorchPool) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d');
      const grd = x.createRadialGradient(32, 32, 2, 32, 32, 31);
      grd.addColorStop(0, 'rgba(10,6,4,0.95)');
      grd.addColorStop(0.6, 'rgba(20,12,8,0.6)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = grd;
      x.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(c);
      this.scorchGeo = new THREE.CircleGeometry(1, 20);
      this.scorchPool = [];
      for (let i = 0; i < 40; i++) {
        const m = new THREE.Mesh(this.scorchGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: true }));
        m.visible = false;
        m.userData.life = 0;
        this.localRoot.add(m);
        this.scorchPool.push(m);
      }
      this.scorchIdx = 0;
    }
    const d = local.clone().normalize();
    const m = this.scorchPool[this.scorchIdx++ % this.scorchPool.length];
    m.position.copy(d).multiplyScalar(f.floorRadius(d.x, d.y, d.z) + 0.06);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    m.rotateZ(Math.random() * 6.28);
    m.scale.setScalar(size);
    m.material.opacity = 1;
    m.userData.life = 30;
    m.visible = true;
  }

  updateScorch(dt) {
    if (!this.scorchPool) return;
    for (const m of this.scorchPool) {
      if (!m.visible) continue;
      m.userData.life -= dt;
      m.material.opacity = Math.min(1, m.userData.life / 8);
      if (m.userData.life <= 0) m.visible = false;
    }
  }

  // ---------------------------------------------- insight and radar --
  gainInsight(source) {
    const s = this.state;
    s.insight = (s.insight || 0) + 1;
    this.hud.notify(`You gain a <b>Realm Insight</b> from ${esc(source)}. It will carry you through your next breakthrough.`, 'gold');
    this.peakNotified = false;
    if (s.stage === 3 && s.xp >= this.stats.xpNeed) this.addXp(0);
    this.save();
  }

  buyRadar() {
    const s = this.state;
    const next = RADARS[(s.radar ?? -1) + 1];
    if (!next || s.coins < next.price) return this.sound.deny();
    s.coins -= next.price;
    s.radar = (s.radar ?? -1) + 1;
    this.sound.confirm();
    this.hud.notify(`Installed the <b>${next.name}</b> <span class="cn">${next.cn}</span>. ${next.desc}`, 'violet');
    this.campaign.event('radar');
    this.nix.event('shop');
    this.save();
  }

  // Pulse the radar: undiscovered sites in range show on the compass.
  // Take the radar out (it pulses every few seconds while held) or put it away.
  takeOutScanner() {
    const rt = this.rt;
    if (rt.inShip) return this.radarPing();
    if (rt.scanner) return;
    rt.scanner = true;
    rt.guarding = false;
    rt.aiming = false;
    rt.controlling = false;
    rt.pingCd = 0;
    this.scanSweep = 0;
    this.radarPing();
    const R = RADARS[Math.max(0, this.state.radar ?? -1)];
    const wl = document.getElementById('weapon-label');
    if (wl) wl.innerHTML = `<span class="mono dim">${esc(codeLabel(settings.key('weaponNext')))} / WHEEL · ITEM</span> <b style="color:#7affd8">${esc(R.name)}</b> <span class="cn">${R.cn}</span> <span class="mono dim">· ${esc(codeLabel(settings.key('fire')))} PULSE</span>`;
    this.sound.ui();
  }

  putAwayScanner() {
    if (!this.rt.scanner) return;
    this.rt.scanner = false;
    this.hud.buildSkills(activePath(this.state));
  }

  updateScanner(dt) {
    const rt = this.rt;
    if (rt.pingCd <= 0) this.radarPing(true);
    this.scanSweep = (this.scanSweep || 0) + dt * 2.4;
    this.scanDraw = (this.scanDraw || 0) - dt;
    if (this.scanDraw > 0 || this.camMode !== 'first') return;
    this.scanDraw = 1 / 15;
    this.drawScanner();
  }

  // The scanner's screen: sweep, range rings, blips for finds and beasts, and the nearest find.
  drawScanner() {
    const s = this.state, f = this.frame, p = this.player;
    const R = RADARS[Math.max(0, s.radar ?? -1)];
    const cv = this.viewmodel.scanCanvas, c = cv.getContext('2d');
    const W = cv.width, cx = W / 2, cy = W / 2 + 8, rad = W * 0.4;
    c.fillStyle = '#05261d';
    c.fillRect(0, 0, W, W);
    c.strokeStyle = 'rgba(120, 255, 210, 0.5)';
    c.lineWidth = 2;
    for (const k of [0.33, 0.66, 1]) { c.beginPath(); c.arc(cx, cy, rad * k, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.moveTo(cx - rad, cy); c.lineTo(cx + rad, cy); c.moveTo(cx, cy - rad); c.lineTo(cx, cy + rad); c.stroke();
    // sweep wedge
    const a = this.scanSweep % (Math.PI * 2);
    const grad = c.createConicGradient ? c.createConicGradient(a - 0.6, cx, cy) : null;
    if (grad) {
      grad.addColorStop(0, 'rgba(80,255,200,0)');
      grad.addColorStop(0.095, 'rgba(120,255,210,0.6)');
      grad.addColorStop(0.1, 'rgba(80,255,200,0)');
      c.fillStyle = grad;
      c.beginPath(); c.arc(cx, cy, rad, 0, Math.PI * 2); c.fill();
    }
    const scale = R.ping;
    const ax = this.navAxes();
    const plot = (local, color, size, label) => {
      const d = local.clone().sub(p.pos);
      const fx = d.dot(ax.fh), rx = d.dot(ax.rh);
      const dist = Math.hypot(fx, rx);
      const k = Math.min(1, dist / scale);
      const ang = Math.atan2(rx, fx);
      const x = cx + Math.sin(ang) * k * rad, y = cy - Math.cos(ang) * k * rad;
      c.fillStyle = color;
      c.beginPath(); c.arc(x, y, size, 0, Math.PI * 2); c.fill();
      if (label && dist <= scale) { c.font = '13px monospace'; c.fillText(label, x + size + 2, y + 4); }
    };
    let nearest = null;
    if (f && f.details) {
      for (const r of f.details.pois) {
        const k = r.poi.kind;
        if (!R.finds.includes(k)) continue;
        const id = r.poi.id;
        const known = s.rumors.includes(id) || s.discovered.includes(id);
        if (!known || (s.explored.includes(id) && (k === 'ore' || k === 'wreck' || k === 'ruin'))) continue;
        const d = r.pos.distanceTo(p.pos);
        plot(r.pos, POI_COLOR[k], 6, null);
        if (!nearest || d < nearest.d) nearest = { d, k, pos: r.pos };
      }
    }
    for (const b of this.beasts.beasts) if (!b.static && b.pos.distanceTo(p.pos) < scale) plot(b.pos, b.boss ? '#ff3c7d' : '#ff5a5a', b.boss ? 6 : 3);
    // you
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(cx, cy - 9); c.lineTo(cx - 6, cy + 6); c.lineTo(cx + 6, cy + 6); c.closePath(); c.fill();
    c.fillStyle = '#7affd8';
    c.font = 'bold 15px monospace';
    c.fillText(R.name.toUpperCase(), 10, 20);
    c.fillText(scale >= 1000 ? `${scale / 1000} KM` : `${scale} M`, W - 66, 20);
    const names = { ore: 'ORE VEIN', wreck: 'WRECK', camp: 'CAMP', ruin: 'RUIN', spring: 'SPRING', obelisk: 'OBELISK', nest: 'NEST', lair: 'LAIR' };
    c.font = 'bold 16px monospace';
    if (nearest) {
      const d = nearest.d;
      c.fillStyle = POI_COLOR[nearest.k];
      c.fillText(`${names[nearest.k]} ${d >= 1000 ? `${(d / 1000).toFixed(1)} KM` : `${Math.round(d)} M`}`, 10, W - 10);
    } else {
      c.fillStyle = 'rgba(122,255,216,0.6)';
      c.fillText('NOTHING IN RANGE', 10, W - 10);
    }
    this.viewmodel.scanTex.needsUpdate = true;
  }

  radarPing(quiet = false) {
    const s = this.state, rt = this.rt, p = this.player, f = this.frame;
    if (rt.pingCd > 0) return;
    if ((s.radar ?? -1) < 0) return;
    rt.pingCd = rt.scanner ? 4 : 6;
    const R = RADARS[s.radar];
    this.hud.pulse();
    this.campaign.event('ping');
    if (!quiet) this.combat.shockwave(p.pos, Math.min(R.ping, 120), 0x3ef2ff, 1.2);
    this.sound.lock();
    if (!f || !f.details) {
      if (!quiet) this.nix.event('ping.none', {}, 1);
      return;
    }
    const counts = {};
    let n = 0;
    for (const r of f.details.pois) {
      const k = r.poi.kind;
      if (!R.finds.includes(k)) continue;
      if (s.discovered.includes(r.poi.id) || s.explored.includes(r.poi.id) || s.rumors.includes(r.poi.id)) continue;
      if (r.pos.distanceTo(p.pos) > R.ping) continue;
      s.rumors.push(r.poi.id);
      counts[k] = (counts[k] || 0) + 1;
      n++;
    }
    if (!n) {
      if (!quiet) this.nix.event('ping.none', {}, 1);
      return;
    }
    this.hud.notify(`Radar: found ${Object.entries(counts).map(([k, c]) => `${c} ${POI_LABEL[k].toLowerCase()}${c > 1 ? 's' : ''}`).join(', ')}. They are marked on your HUD.`, 'cy');
    const names = { ore: 'ore vein', wreck: 'wreck', camp: 'camp', ruin: 'ruin', spring: 'spring', obelisk: 'obelisk', nest: 'nest', lair: 'lair' };
    const what = Object.entries(counts).map(([k, c]) => `${c} ${names[k]}${c > 1 ? 's' : ''}`).join(', ');
    this.nix.cool['ping.some'] = -1e9;
    this.nix.event('ping.some', { n, s: n > 1 ? 's' : '', what }, 1);
    this.save();
  }

  // Situations Nix comments on that aren't tied to a single event.
  nixWatch() {
    const s = this.state, p = this.player, f = this.frame;
    if (s.playtime > 200) this.nix.once('radar', 'radarHint', {}, 0);
    if (s.playtime > 30 && activePath(s) !== 'fist') this.nix.once(`path_${activePath(s)}`, `path.${activePath(s)}`, {}, 0);
    if (p.mode === 'space') this.nix.once('space', 'firstSpace', {}, 1);
    if (f && f.body.landable && this.env.up && f.body.sites.city && f.body.sites.city.main) {
      const tier = this.locTier();
      if (tier > 0.15) this.nix.once('wilds', 'wilds', {}, 0);
      if (tier > s.realm + 0.7) this.nix.event('dangerRising');
    }
  }

  buyGene() {
    const s = this.state;
    const cost = this.geneCost();
    if (s.coins < cost || (s.gene || 0) >= this.geneCap()) return this.sound.deny();
    s.coins -= cost;
    s.gene = (s.gene || 0) + 1;
    const ratio = this.rt.hp / this.stats.maxHp;
    this.stats = derive(s);
    this.rt.hp = ratio * this.stats.maxHp;
    this.particles.burst(this.player.pos, new THREE.Color(2.4, 0.6, 1.2), 60, 16, 0.6, 0.9);
    this.sound.breakthrough();
    this.hud.notify(`Gene enhancement level <b>${s.gene}</b>: +6% life and attack.`, 'violet');
    this.save();
  }

  chamberCost() {
    return priceFor(25, this.state.realm);
  }

  rentChamber() {
    const s = this.state;
    const cost = this.chamberCost();
    if (s.coins < cost) return this.sound.deny();
    s.coins -= cost;
    s.chamberUntil = Math.max(s.chamberUntil, s.playtime) + 300;
    this.sound.confirm();
    this.hud.notify('The gravity chamber hums to life. Cultivate inside for <b>2.5×</b> experience for 5 minutes.', 'violet');
    this.save();
  }

  mealCost(kind) {
    return priceFor({ spicy: 12, broth: 10, dumpling: 14 }[kind] || 10, this.state.realm);
  }

  buyMeal(kind) {
    const s = this.state;
    const cost = this.mealCost(kind);
    if (s.coins < cost) return this.sound.deny();
    s.coins -= cost;
    s.meal = { kind, until: s.playtime + 600 };
    if (kind === 'dumpling') this.rt.hp = this.stats.maxHp;
    this.sound.pickup();
    const txt = { spicy: '+25% damage for 10 minutes', broth: '+50% energy and spirit recovery for 10 minutes', dumpling: 'full life and +30% defence for 10 minutes' }[kind];
    this.hud.notify(`You eat well: ${txt}.`, 'green');
    this.save();
  }

  rumorCost() {
    return priceFor(18, this.state.realm);
  }

  buyRumor() {
    const s = this.state, f = this.frame;
    const cost = this.rumorCost();
    if (s.coins < cost || !f || !f.details) return this.sound.deny();
    const p = this.player;
    const cands = f.details.pois
      .filter((r) => !s.discovered.includes(r.poi.id) && !s.rumors.includes(r.poi.id) && r.poi.kind !== 'nest')
      .sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos));
    if (!cands.length) {
      this.hud.notify('“Nothing new out there, friend. You’ve seen it all.”', '');
      return this.sound.deny();
    }
    s.coins -= cost;
    const pick = cands[Math.floor(Math.random() * Math.min(3, cands.length))];
    s.rumors.push(pick.poi.id);
    const names = { ruin: 'ancient ruins', spring: 'an energy spring', ore: 'a rich star metal vein', wreck: 'a crashed wreck', lair: 'an Overlord’s lair' };
    this.hud.notify(`“They say there’s ${names[pick.poi.kind] || 'something'} out past the walls.” It now shows on your compass.`, 'yl');
    this.sound.confirm();
    this.save();
  }

  homeCost() {
    return priceFor(150, this.state.realm);
  }

  rentHome() {
    const s = this.state;
    const city = this.lastService && this.lastService.service && this.lastService.service.city;
    if (!city || !this.frame) return;
    const cost = this.homeCost();
    if (s.coins < cost) return this.sound.deny();
    s.coins -= cost;
    s.home = { star: this.star.key, body: this.frame.body.id, site: city };
    s.bind = { ...s.home };
    this.sound.confirm();
    this.hud.notify(`You rent a room in <b>${esc(city)}</b>. You will wake here if you fall.`, 'gold');
    this.save();
  }

  // Sleep until the local sun is up.
  sleep() {
    const s = this.state, f = this.frame;
    if (!f || !this.env.up) return;
    const period = f.body.spin.period;
    const up = this.env.up.clone();
    // sample the planet's real rotation over one day to find the next sunrise
    const sunLocalAt = (t) => {
      f.prepare(t);
      f.spin.updateMatrixWorld(true);
      return f.spin.worldToLocal(this.system.root.position.clone()).normalize();
    };
    let best = 0;
    const nowUp = sunLocalAt(s.worldTime).dot(up);
    if (nowUp < 0.3) {
      for (let k = 1; k <= 144; k++) {
        const dtk = (period * k) / 144;
        if (sunLocalAt(s.worldTime + dtk).dot(up) > 0.35) { best = dtk; break; }
      }
    }
    f.prepare(s.worldTime);
    f.spin.updateMatrixWorld(true);
    if (best < 60) {
      this.hud.notify('It is already day outside.', '');
      return;
    }
    s.worldTime += best;
    this.rt.hp = this.stats.maxHp;
    this.rt.energy = this.stats.maxEnergy;
    this.rt.spirit = this.stats.maxSpirit;
    const fade = document.getElementById('fade');
    fade.style.opacity = 1;
    setTimeout(() => { fade.style.opacity = 0; }, 700);
    this.hud.notify('You sleep through the night and wake rested.', 'gold');
    this.save();
  }

  // ---- obelisk trials: two waves of guardians for a bonus skill point
  startTrial(poiRec) {
    if (this.trial) return;
    this.trial = { poi: poiRec, wave: 0, beasts: [] };
    this.nextTrialWave();
    this.hud.banner('TRIAL', 'Trial of the Obelisk', '<span class="cn">试炼</span>Defeat the guardians', '#c08cff', 3);
    this.sound.thunder();
  }

  nextTrialWave() {
    const tr = this.trial, f = this.frame;
    tr.wave++;
    const species = speciesForBody(f.body);
    const tier = this.locTier() + 0.3 + tr.wave * 0.25;
    const up = tr.poi.up;
    const n = tr.wave === 1 ? 4 : 3;
    tr.beasts = [];
    for (let i = 0; i < n; i++) {
      const sp = tr.wave === 2 && i === 0 ? species.reduce((a, b) => (b.hp > a.hp ? b : a)) : species[Math.floor(Math.random() * species.length)];
      this.beasts.species.set(sp.id, sp);
      const a = (i / n) * Math.PI * 2;
      const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).projectOnPlane(up).normalize();
      const pos = tr.poi.pos.clone().addScaledVector(side, 24).addScaledVector(up, 4);
      const b = this.beasts.spawn(sp.id, pos, tier, { aggro: true, elite: tr.wave === 2 && i === 0 });
      tr.beasts.push(b);
    }
    this.combat.shockwave(tr.poi.pos.clone().addScaledVector(up, 2), 40, 0xc08cff, 1);
  }

  updateTrial() {
    const tr = this.trial;
    if (!tr) return;
    const far = !this.frame || !this.frame.details || tr.poi.pos.distanceTo(this.player.pos) > 400;
    if (this.mode === 'dead' || far) {
      for (const b of tr.beasts) if (b.alive) this.beasts.removeBeast(b);
      this.hud.notify('The obelisk falls silent. The trial is lost; you may try again.', 'red');
      this.trial = null;
      return;
    }
    if (tr.beasts.some((b) => b.alive)) return;
    if (tr.wave < 2) {
      this.nextTrialWave();
      this.hud.notify('A greater guardian answers the obelisk’s call!', 'red');
      return;
    }
    const s = this.state;
    s.explored.push(tr.poi.poi.id);
    s.bonusPoints = (s.bonusPoints || 0) + 1;
    this.gainInsight('the obelisk');
    this.nix.event('trialWin', {}, 1);
    this.campaign.event('trialWin');
    const k = this.randomUpgradableTech();
    if (k) s.mastery[k] = (s.mastery[k] || 1) + 1;
    this.addXp(this.stats.xpNeed * 0.25);
    this.hud.banner('TRIAL COMPLETE', 'The Obelisk Yields', `<span class="cn">传承</span>+1 skill point${k ? ` · ${TECHS[k].name} mastery ${s.mastery[k]}` : ''}`, '#c08cff', 4);
    this.sound.reward();
    this.trial = null;
    this.save();
  }

  // ---- arena: waves of local beasts inside the ring
  startArena() {
    const it = this.lastService;
    if (!it || !it.service || !it.service.venue || it.service.venue.kind !== 'arena') return;
    const f = this.frame;
    const st = f && f.details && f.details.settlements.find((x) => x.services.includes(it.service));
    if (!st) return;
    if (this.arena) return this.denied('A match is already under way.');
    const s = this.state;
    const wave = (s.arena || 0) + 1;
    const v = it.service.venue;
    const species = speciesForBody(f.body);
    const tier = Math.max(0, s.realm - 0.6 + Math.min(1.2, wave * 0.12));
    const n = Math.min(10, 2 + Math.floor(wave / 2));
    const center = v.center.clone();
    const beasts = [];
    for (let i = 0; i < n; i++) {
      const sp = species[Math.min(species.length - 1, Math.floor(Math.random() * Math.min(species.length, 2 + wave / 3)))];
      this.beasts.species.set(sp.id, sp);
      const a = (i / n) * Math.PI * 2;
      const pos = st.toLocal(v.x + Math.cos(a) * 18, 3, v.z + Math.sin(a) * 18);
      const b = this.beasts.spawn(sp.id, pos, tier, { aggro: true, elite: wave >= 5 && i === 0 });
      b.home.copy(center);
      b.arena = true;
      beasts.push(b);
    }
    this.arena = { wave, beasts, venue: v, settlement: st, prize: Math.round(priceFor(40, s.realm) * (1 + wave * 0.35)) };
    this.menus.closePanel();
    this.resume();
    this.hud.banner('ARENA', `Wave ${wave}`, `<span class="cn">竞技场</span>${n} beasts · prize ${fmt(this.arena.prize)} ◈`, '#ff3c7d', 2.5);
    this.sound.thunder();
  }

  updateArena() {
    const a = this.arena;
    if (!a) return;
    const left = a.beasts.filter((b) => b.alive);
    const inside = this.inVenue && this.inVenue.v === a.venue;
    if (!left.length) {
      const s = this.state;
      s.arena = a.wave;
      if (a.wave % 5 === 0) this.gainInsight(`arena wave ${a.wave}`);
      this.nix.event('arenaWin');
      this.campaign.event('arenaWave');
      s.coins += a.prize;
      this.addXp(this.stats.xpNeed * 0.08);
      this.hud.banner('VICTORY', `Wave ${a.wave} cleared`, `+${fmt(a.prize)} ◈ · the crowd roars`, '#ffe44d', 3);
      this.sound.reward();
      this.arena = null;
      this.save();
    } else if (!inside && this.mode === 'playing') {
      for (const b of left) this.beasts.removeBeast(b);
      this.hud.notify('You left the ring. The match is forfeit.', 'red');
      this.arena = null;
    } else if (this.mode === 'dead') {
      for (const b of left) this.beasts.removeBeast(b);
      this.arena = null;
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
    if (ship.dockedAt && !forced) {
      this.dockShip(ship.dockedAt);
      return;
    }
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
    if (poiRec.poi.kind === 'obelisk') return this.startTrial(poiRec);
    if (!s.explored.includes(id)) s.explored.push(id);
    this.campaign.event('search', poiRec.poi.kind);
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
        this.hud.notify(`The ruins hold a manual. <b>${TECHS[k].name}</b> mastery rises to ${s.mastery[k]}.`, 'violet');
      }
    }
    this.hud.notify(`Ancient energy flows from the ruins: +${fmt(xp)} experience.`, 'gold');
    this.addXp(xp);
    s.essence += essenceFor(tier) * 10;
    this.save();
  }

  // -------------------------------------------------------- paths --
  pathTip() {
    const key = (a) => `<kbd>${codeLabel(settings.key(a))}</kbd>`;
    const p = activePath(this.state);
    if (p === 'fist') return `${key('fire')} throws punches; every fourth in a row knocks beasts back. Hold ${key('focus')} to guard. Buy weapons at an <b>Armory</b>.`;
    if (p === 'spear') return `${key('fire')} thrusts your spear through everything in a line. Hold ${key('focus')} to guard.`;
    if (p === 'knives') return `${key('fire')} throws knives. Hold ${key('focus')} to aim: zoomed shots hit harder and crit more.`;
    if (p === 'bow') return `${key('fire')} looses heavy arrows. Hold ${key('focus')} to aim: zoomed shots hit harder and crit more.`;
    if (p === 'blade') return `${key('fire')} swings your saber. Hold ${key('focus')} to guard, and tap it just before a hit to parry. ${key('skill1')} is Flash Cut.`;
    if (p === 'psychic') return `${key('fire')} fires Mind Spikes that never miss. Hold ${key('focus')} to seize a beast with your mind. ${key('skill1')} throws a Soul Lance.`;
    return `Hold ${key('focus')} to steer your flying swords. ${key('fire')} fires Star Bolts. ${key('skill1')} looses your swords.`;
  }

  learnSkill(id) {
    const s = this.state;
    const nd = nodeById(id);
    if (!nd) return;
    if (!canLearn(s, nd).ok) return this.sound.deny();
    s.skills[id] = (s.skills[id] || 0) + 1;
    if (nd.tech) {
      const P = PATHS[nd.disc];
      const i = P.skills.indexOf(nd.tech);
      this.hud.notify(`Learned <b>${TECHS[nd.tech].name}</b> <span class="cn">${TECHS[nd.tech].cn}</span>. With the ${esc(P.weapon.name)} in hand, press <kbd>${codeLabel(settings.key(`skill${i + 1}`))}</kbd>.`, 'violet');
      this.hud.buildSkills(activePath(s));
      if (this.campaign) this.campaign.event('learn', nd.tech);
    }
    const ratio = this.rt.hp / this.stats.maxHp;
    this.stats = derive(s);
    this.rt.hp = ratio * this.stats.maxHp;
    this.swords.setup(this.stats.swords, s.swordGrade);
    this.sound.stageUp();
    this.save();
  }

  // ---------------------------------------------------------- vehicles --
  // Climb onto your parked vehicle (from E when standing beside it).
  mountVehicle() {
    const rt = this.rt, v = this.vehicleObj;
    if (!v || rt.inVehicle || rt.inShip) return;
    rt.inVehicle = true;
    rt.meditating = false;
    rt.medToggle = false;
    rt.controlling = false;
    this.putAwayScanner();
    this.applyCamMode();
    this.sound.confirm();
    this.campaign.event('ride');
    if (!this.notifyGate.rideHelp) {
      this.notifyGate.rideHelp = 1;
      this.hud.notify(`Steer with the mouse. <kbd>W</kbd> throttle, <kbd>S</kbd> brake, ${esc(codeLabel(settings.key('sprint')))} boost, hold ${esc(codeLabel(settings.key('jump')))} to hop. You can fight from the saddle. ${esc(codeLabel(settings.key('interact')))} to get off.`, 'yl');
    }
  }

  // Put your current vehicle at the kerb outside a Vehicle Dealer.
  deliverVehicle(id, home = false) {
    const f = this.frame, s = this.state;
    if (!f || !f.terrain) return;
    if (home && f.body.sites.city) f.ensureSettlement(f.body.sites.city);
    if (!f.details) return;
    const svc = this.lastService && this.lastService.service;
    let venue = !home && svc && svc.venue && svc.venue.kind === 'dealer' ? svc.venue : null;
    if (!venue && home && f.body.sites.city) {
      const st = f.ensureSettlement(f.body.sites.city);
      venue = st && st.venues.find((v) => v.kind === 'dealer' && v.curb);
    }
    if (!venue) {
      let bd = Infinity;
      for (const st of f.details.settlements) for (const v of st.venues) {
        if (v.kind !== 'dealer' || !v.curb) continue;
        const d = v.curb.distanceTo(this.player.pos);
        if (d < bd) { bd = d; venue = v; }
      }
    }
    if (!venue || !venue.curb) return;
    if (this.vehicleObj) this.vehicleObj.dispose();
    this.vehicleObj = new Vehicle(this.localRoot, id);
    const n = venue.curb.clone().normalize();
    this.vehicleObj.place(n.multiplyScalar(f.floorRadius(n.x, n.y, n.z) + this.vehicleObj.def.hover), venue.curbDir);
    s.vehicleLoc = { star: this.star.key, body: f.body.id, pos: this.vehicleObj.pos.toArray(), fwd: this.vehicleObj.fwd.toArray() };
  }

  // Keep the vehicle object only while you're on the world it's parked on.
  syncVehicleFrame() {
    const s = this.state, f = this.frame, loc = s.vehicleLoc;
    // a vehicle with no parking spot (bought before vehicles stayed parked) waits at the home city's dealer
    if (s.vehicle && VEHICLES[s.vehicle] && !s.vehicleStored && !loc && f && f.terrain && f === this.homePlanet() && !this.rt.inVehicle) {
      this.deliverVehicle(s.vehicle, true);
      if (this.vehicleObj) setTimeout(() => this.hud.notify(`Your <b>${esc(VEHICLES[s.vehicle].name)}</b> is parked outside the Vehicle Dealer in ${esc(f.body.sites.city.name)}. Follow the orange marker.`, 'yl'), 2500);
      return;
    }
    const here = !s.vehicleStored && loc && f && loc.star === this.star.key && loc.body === f.body.id && s.vehicle && VEHICLES[s.vehicle];
    if (!here) {
      if (this.vehicleObj && !this.rt.inVehicle) { this.vehicleObj.dispose(); this.vehicleObj = null; }
      return;
    }
    if (!this.vehicleObj || this.vehicleObj.id !== s.vehicle) {
      if (this.vehicleObj) this.vehicleObj.dispose();
      this.vehicleObj = new Vehicle(this.localRoot, s.vehicle);
      this.vehicleObj.place(new THREE.Vector3().fromArray(loc.pos), new THREE.Vector3().fromArray(loc.fwd));
    }
  }

  dismount(silent = false) {
    const rt = this.rt, v = this.vehicleObj, p = this.player;
    if (!rt.inVehicle) return;
    rt.inVehicle = false;
    if (v) {
      const up = v.pos.clone().normalize();
      const side = new THREE.Vector3().crossVectors(v.fwd, up).normalize();
      let at = v.pos.clone().addScaledVector(side, v.def.radius + 1.2);
      const f = this.frame;
      if (f && f.terrain) {
        const n = at.clone().normalize();
        at = n.multiplyScalar(f.floorRadius(n.x, n.y, n.z) + EYE + 0.2);
      }
      p.placeAt(at, at.clone().add(v.fwd), up);
      p.vel.set(0, 0, 0);
      p.mode = 'ground';
      v.speed = 0;
      v.vUp = 0;
      if (this.frame) this.state.vehicleLoc = { star: this.star.key, body: this.frame.body.id, pos: v.pos.toArray(), fwd: v.fwd.toArray() };
    }
    this.applyCamMode();
    this.swords.setVisible(true);
    this.swords.reset(p);
    this.camQuat.copy(p.quat);
  }

  controlVehicle(dt, move, look, env, alive) {
    const v = this.vehicleObj, p = this.player, rt = this.rt, inp = this.input, f = env.planet;
    if (!f || !f.terrain) return this.dismount();
    p.look(look.x, look.y, { up: env.up });
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quat);
    const boost = alive && inp.act('sprint');
    v.update(dt, {
      planet: f, look: camFwd, move: alive ? move : { x: 0, z: 0 }, boost, jump: alive && inp.act('jump'),
      collide: (pos, r) => f.collide(pos, r, 0),
    });
    if (v.crash > 18) {
      rt.shake = Math.max(rt.shake, Math.min(1, v.crash / 50));
      this.sound.explosion(v.pos, false);
    }
    v.crash = 0;
    if (v.landed) {
      rt.shake = Math.max(rt.shake, Math.min(0.8, v.landed / 30));
      v.landed = 0;
    }
    // smash through trees and lamps at speed
    if (Math.abs(v.speed) > 16) {
      // sweep the path ahead every frame so nothing slips between checks
      const ahead = v.def.radius + Math.abs(v.speed) * dt * 2;
      this.breakAt(v.pos.clone().addScaledVector(v.fwd, ahead * 0.5), v.def.radius + 0.8 + ahead * 0.5, v.fwd);
    }
    // ram beasts
    for (const b of [...this.beasts.beasts]) {
      if (b.static || !b.alive || Math.abs(v.speed) < 10) continue;
      if (b.pos.distanceTo(v.pos) > b.radius + v.def.radius + 0.5) continue;
      if (this.time < (b.ramT || 0)) continue;
      b.ramT = this.time + 0.6;
      const dmg = this.stats.atk * v.def.ram * (Math.abs(v.speed) / 12);
      this.hitBeast(b, dmg, this.arts.hitPoint(b, v.pos), 'ram', v.fwd.clone().multiplyScalar(Math.abs(v.speed) * 1.5).addScaledVector(env.up, 20));
      v.speed *= b.radius > v.def.radius * 2 ? 0.2 : 0.7;
      rt.shake = Math.max(rt.shake, 0.5);
    }
    p.pos.copy(v.seat());
    p.vel.copy(v.fwd).multiplyScalar(v.speed);
    p.boosting = boost && v.speed > v.def.speed * 0.9;
    p.grounded = true;
    p.ride(dt, this.time, v);
  }

  buyVehicle(id) {
    const s = this.state, d = VEHICLES[id];
    if (!d) return;
    if (!(s.vehicles || []).includes(id)) {
      if (s.coins < d.price) return this.sound.deny();
      s.coins -= d.price;
      s.vehicles = [...(s.vehicles || []), id];
      this.sound.reward();
      this.hud.notify(`The <b>${esc(d.name)}</b> is yours. It\u2019s parked outside the door: walk up to it and press <kbd>${esc(codeLabel(settings.key('interact')))}</kbd> to ride.`, 'gold');
      this.campaign.event('vehicle', id);
    } else this.hud.notify(`Your <b>${esc(d.name)}</b> is brought round to the door.`, '');
    s.vehicle = id;
    if (!this.rt.inVehicle) { s.vehicleStored = false; this.deliverVehicle(id); }
    this.save();
  }

  // ------------------------------------------------------------- ring --
  restInTent(e) {
    const rt = this.rt, st = this.stats;
    rt.hp = st.maxHp;
    rt.energy = st.maxEnergy;
    rt.spirit = st.maxSpirit;
    this.state.respawnAt = e.rec.id;
    this.sound.reward();
    this.hud.notify('You rest by the fire. Fully healed, and if you fall, your body will reform at this tent.', 'gold');
    this.save();
  }

  tame(b) {
    const s = this.state;
    if (!b.alive || !count(s, 'collar')) return;
    removeItem(s, 'collar');
    const frac = b.hp / b.maxHp;
    if (Math.random() > Math.min(0.95, 0.6 + (1 / 3 - frac) * 1.5)) {
      b.aggro = true;
      b.stunT = 0;
      this.hud.notify(`The collar snaps. The <b>${esc(b.name)}</b> is furious.`, 'red');
      this.sound.deny();
      return;
    }
    // it slips into the ring if there's room, and comes out to walk with you
    const id = `pet${(s.placeSeq = (s.placeSeq || 0) + 1)}`;
    const rec = { id, name: b.def.name, def: petDef(b.def), tier: b.tier, hp: 1, knockedUntil: 0 };
    s.pets = [...(s.pets || []), rec];
    if (slotsUsed(s) > capacity(s)) {
      s.pets.pop();
      addItem(s, { id: 'collar', name: ITEMS.collar.name, cn: ITEMS.collar.cn, kind: 'tool' });
      return this.denied('Your ring has no room for a beast. Free a slot first.');
    }
    this.particles.burst(b.pos, new THREE.Color(1.4, 1, 2.4), 50, 10, 0.8, 0.6);
    this.beasts.removeBeast(b);
    this.pets.despawn();
    s.petOut = id;
    this.pets.sync();
    this.sound.reward();
    this.hud.notify(`You tamed the <b>${esc(rec.name)}</b>. It fights at your side; manage your beasts in the ring.`, 'gold');
    this.nix.say('It likes you. Or it\u2019s plotting. Hard to tell with wolves.', 1);
    this.campaign.event('tame');
    this.save();
  }

  callPet(id) {
    const s = this.state, rec = (s.pets || []).find((p) => p.id === id);
    if (!rec) return;
    if (rec.knockedUntil > s.playtime) return this.denied(`Your ${rec.name} is still recovering.`);
    if (rec.def.aquatic) return this.denied('It can only live in the water.');
    this.pets.despawn();
    s.petOut = id;
    this.pets.sync();
    this.closePanel();
  }

  putAwayPet() {
    this.pets.despawn();
    this.state.petOut = null;
  }

  releasePet(id) {
    const s = this.state;
    if (s.petOut === id) this.putAwayPet();
    s.pets = (s.pets || []).filter((p) => p.id !== id);
    this.save();
  }

  upgradeRing() {
    const s = this.state, r = ringOf(s), next = RING_TIERS[r.tier + 1];
    if (!hasRing(s) || !next) return;
    if (s.coins < next.coins || s.ore < next.ore || s.essence < next.essence) return this.sound.deny();
    s.coins -= next.coins;
    s.ore -= next.ore;
    s.essence -= next.essence;
    r.tier++;
    this.sound.reward();
    this.hud.notify(`Your ring is now a <b>${next.name}</b> <span class="cn">${next.cn}</span>: ${next.slots === Infinity ? 'endless' : next.slots} slots.`, 'gold');
    this.nix.say(r.tier >= 4 ? 'A whole pocket universe. I have room to stretch. Finally.' : 'More room. I was getting cramped in here with all those fangs.', 1);
    this.save();
  }

  craft(id) {
    const s = this.state, rec = RECIPES.find((r) => r.id === id);
    if (!rec || !hasRing(s)) return;
    if (rec.out.item && slotsUsed(s) >= capacity(s) && !count(s, rec.out.item)) return this.denied('Your ring is full.');
    if (!pay(s, rec.need)) return this.sound.deny();
    if (rec.out.pill) s.pills[rec.out.pill]++;
    if (rec.out.item) addItem(s, { id: rec.out.item, name: ITEMS[rec.out.item].name, cn: ITEMS[rec.out.item].cn, kind: ITEMS[rec.out.item].kind });
    this.sound.confirm();
    this.hud.notify(`Crafted: <b>${rec.name}</b> <span class="cn">${rec.cn}</span>.`, 'gold');
    if (id === 'collar') this.hud.notify(`To tame a beast, beat it below a third of its life, then press ${esc(codeLabel(settings.key('interact')))} beside it.`, 'yl');
    this.campaign.event('craft', id);
    this.save();
  }

  temper(pathId) {
    const s = this.state;
    s.gear = s.gear || { armor: 0, temper: {} };
    const lv = s.gear.temper[pathId] || 0;
    if (lv >= MAX_TEMPER || !owns(s, pathId)) return;
    if (!pay(s, temperCost(lv))) return this.sound.deny();
    s.gear.temper[pathId] = lv + 1;
    this.sound.breakthrough();
    this.hud.notify(`Your <b>${esc(PATHS[pathId].weapon.name)}</b> is tempered to level ${lv + 1}: +${(lv + 1) * 15}% damage.`, 'gold');
    this.campaign.event('craft', 'temper');
    this.save();
  }

  forgeArmor() {
    const s = this.state;
    s.gear = s.gear || { armor: 0, temper: {} };
    const lv = s.gear.armor || 0;
    if (lv >= MAX_TEMPER) return;
    if (!pay(s, armorCost(lv))) return this.sound.deny();
    s.gear.armor = lv + 1;
    this.stats = derive(s);
    this.sound.breakthrough();
    this.hud.notify(`Beast-hide armour level ${lv + 1}: you take ${(lv + 1) * 6}% less damage.`, 'gold');
    this.campaign.event('craft', 'armor');
    this.save();
  }

  sellParts() {
    const s = this.state, r = ringOf(s);
    let coins = 0;
    for (const [id, it] of Object.entries(r.items)) {
      if (!id.startsWith('part:')) continue;
      coins += it.qty * Math.round((it.rare ? 30 : 10) * Math.pow(2.2, it.grade || 0));
      delete r.items[id];
    }
    if (!coins) return;
    s.coins += coins;
    this.sound.reward();
    this.hud.notify(`Sold your beast parts for <b>${fmt(coins)} ◈</b>.`, 'gold');
    this.save();
  }

  // Building: pick a spot in front of you and set a structure down.
  startPlacing(id) {
    const s = this.state, f = this.frame, rt = this.rt;
    if (!count(s, id) || !ITEMS[id] || ITEMS[id].kind !== 'place') return;
    if (!f || !f.terrain || !this.env.inAtmo || rt.inShip || rt.inVehicle || this.inVenue) return this.denied('Build outside, on the ground of a world.');
    this.closePanel();
    this.cancelPlacing();
    const obj = buildStructure(id);
    obj.ghost(true);
    this.localRoot.add(obj.group);
    this.placing = { id, obj, rot: 0, pos: null, ok: false };
    this.hud.notify(`Placing a <b>${ITEMS[id].name}</b>: ${esc(codeLabel(settings.key('fire')))} to build, ${esc(codeLabel(settings.key('focus')))} to cancel, mouse wheel to turn it.`, 'yl');
  }

  cancelPlacing() {
    if (!this.placing) return;
    this.localRoot.remove(this.placing.obj.group);
    this.placing.obj.dispose();
    this.placing = null;
  }

  updatePlacing(dt, alive) {
    const pl = this.placing, f = this.frame, inp = this.input, p = this.player;
    if (!alive || !f || !f.terrain) return this.cancelPlacing();
    // where the crosshair meets the ground, within reach
    const cam = this.camera.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    let spot = null;
    for (let d = 2; d < 24; d += 0.5) {
      const q = cam.clone().addScaledVector(fwd, d);
      const n = q.clone().normalize();
      if (q.length() < f.floorRadius(n.x, n.y, n.z)) { spot = q; break; }
    }
    if (!spot) spot = p.pos.clone().addScaledVector(fwd.clone().projectOnPlane(p.pos.clone().normalize()).normalize(), 8);
    const n = spot.clone().normalize();
    spot.copy(n).multiplyScalar(f.floorRadius(n.x, n.y, n.z));
    if (inp.wheel) pl.rot += Math.sign(inp.wheel) * 0.25;
    pl.pos = spot;
    pl.obj.group.position.copy(spot);
    pl.obj.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    pl.obj.group.rotateY(pl.rot);
    if (inp.hit('focus')) return this.cancelPlacing();
    if (inp.hit('fire')) {
      const s = this.state;
      if (!removeItem(s, pl.id)) return this.cancelPlacing();
      s.placeSeq = (s.placeSeq || 0) + 1;
      const rec = { id: `b${s.placeSeq}`, type: pl.id, star: this.star.key, body: f.body.id, pos: spot.toArray(), rot: pl.rot };
      s.placed = [...(s.placed || []), rec];
      this.structures.add(rec);
      this.particles.burst(spot, new THREE.Color(2, 1.6, 1), 30, 8, 0.8, 0.5);
      this.sound.confirm();
      this.hud.notify(`Built a <b>${ITEMS[pl.id].name}</b>.`, 'gold');
      this.campaign.event('build', pl.id);
      this.cancelPlacing();
      this.save();
    }
  }

  // Take a structure back into the ring.
  pickUp(recId) {
    const s = this.state;
    const e = this.structures.list.find((x) => x.rec.id === recId);
    if (!e || e.pos.distanceTo(this.player.pos) > 25) return;
    if (!addItem(s, { id: e.rec.type, name: ITEMS[e.rec.type].name, cn: ITEMS[e.rec.type].cn, kind: 'place' })) return this.denied('Your ring is full.');
    this.structures.remove(e);
    s.placed = s.placed.filter((r) => r.id !== recId);
    if (s.respawnAt === recId) s.respawnAt = null;
    this.sound.confirm();
    this.save();
  }

  // Fold your vehicle into the ring, or unfold it beside you.
  storeVehicle() {
    const s = this.state, v = this.vehicleObj;
    if (!v || this.rt.inVehicle) return;
    if (v.pos.distanceTo(this.player.pos) > 12) return this.denied('Walk up to your vehicle first.');
    if (ringOf(s).tier < 1) return this.denied('A vehicle needs an Iron Storage Ring or better.');
    if (slotsUsed(s) + 4 > capacity(s)) return this.denied('Your ring needs 4 free slots for a vehicle.');
    v.dispose();
    this.vehicleObj = null;
    s.vehicleStored = true;
    s.vehicleLoc = null;
    this.particles.burst(v.pos, new THREE.Color(1.4, 1, 2.4), 40, 10, 0.8, 0.6);
    this.sound.warp();
    this.save();
  }

  takeOutVehicle() {
    const s = this.state, f = this.frame, p = this.player;
    if (!s.vehicleStored || !s.vehicle) return;
    if (!f || !f.terrain || !this.env.inAtmo || this.inVenue || this.rt.inShip) return this.denied('Unfold your vehicle outside, on the ground.');
    const fwd = p.forward().projectOnPlane(p.pos.clone().normalize()).normalize();
    const at = p.pos.clone().addScaledVector(fwd, 4);
    const n = at.clone().normalize();
    this.vehicleObj = new Vehicle(this.localRoot, s.vehicle);
    this.vehicleObj.place(n.multiplyScalar(f.floorRadius(n.x, n.y, n.z) + this.vehicleObj.def.hover), fwd);
    s.vehicleStored = false;
    s.vehicleLoc = { star: this.star.key, body: f.body.id, pos: this.vehicleObj.pos.toArray(), fwd: this.vehicleObj.fwd.toArray() };
    this.particles.burst(this.vehicleObj.pos, new THREE.Color(1.4, 1, 2.4), 40, 10, 0.8, 0.6);
    this.sound.warp();
    this.closePanel();
    this.save();
  }

  // -------------------------------------------------------------- digs --
  digKey() {
    return this.frame ? `${this.star.key}:${this.frame.body.id}` : null;
  }

  // Hand the current world its saved holes.
  syncDigs() {
    if (!FEATURES.digging) return;
    const f = this.frame, s = this.state;
    if (!f || !f.digsSys) return;
    s.digs = s.digs || {};
    const k = this.digKey();
    s.digs[k] = s.digs[k] || [];
    f.digsSys.setDigs(s.digs[k]);
    f.digsSys.onVein = (cellKey, veins) => this.spawnVeins(cellKey, veins);
  }

  // Blast a hole of radius r at a local point.
  dig(pos, r) {
    if (!FEATURES.digging) return;
    const f = this.frame;
    if (!f || !f.terrain || !f.digsSys || !this.env.inAtmo || this.localRoot.parent !== f.spin) return;
    // the cities are built to last
    if (f.details) for (const st of f.details.settlements) if (pos.distanceTo(st.group.position) < st.radius + r + 2) return;
    if (!f.digsSys.digs.length) this.syncDigs();
    const g = f.digsSys.add(Math.round(pos.x * 100) / 100, Math.round(pos.y * 100) / 100, Math.round(pos.z * 100) / 100, Math.round(r * 100) / 100, Math.round(this.state.playtime));
    if (!g) return;
    const list = f.digsSys.digs;
    if (list.length > 1500) list.splice(0, list.length - 1500);
    this.breakAt(pos, r + 1, null);
    this.combat.debris(pos, 0x5a5248, Math.min(14, Math.round(3 + r * 1.5)), 0.3 + Math.min(1.4, r * 0.12));
    this.digsDirty = true;
  }

  updateDigs(dt) {
    if (!FEATURES.digging) return;
    const f = this.frame, s = this.state;
    if (!f || !f.digsSys || this.localRoot.parent !== f.spin) return;
    const p = this.player;
    f.digsSys.update(this.rt.inShip && this.shipObj ? this.shipObj.pos : p.pos);
    // in Free Play the land heals after ten minutes; the campaign remembers
    this.digHealT = (this.digHealT || 0) - dt;
    if (this.digHealT <= 0) {
      this.digHealT = 5;
      const story = s.campaign && s.campaign.started;
      if (!story) f.digsSys.remove((g) => g[4] < s.playtime - 600);
    }
  }

  // Crystal veins in cave walls can be mined for star metal.
  spawnVeins(cellKey, veins) {
    const s = this.state;
    this.veinStatics = this.veinStatics || new Map();
    veins.forEach((v, i) => {
      const id = `vein:${this.digKey()}:${cellKey}:${i}`;
      if (s.explored.includes(id) || this.veinStatics.has(id)) return;
      const pos = new THREE.Vector3(v[0], v[1], v[2]).addScaledVector(new THREE.Vector3(v[3], v[4], v[5]), -0.6);
      const tier = Math.max(0, this.locTier());
      const b = this.beasts.spawnStatic({
        pos, radius: 1.6, hp: 60 * Math.pow(2.6, tier) * 1.5, name: 'Star Metal Vein', cn: '星金矿脉', color: 0x3ef2ff, tier,
        onKill: () => {
          if (!s.explored.includes(id)) s.explored.push(id);
          this.veinStatics.delete(id);
          this.loot.spawn(pos, Math.round(4 + tier * 4 + Math.random() * 5), 0x3ef2ff, 4, 'ore');
          this.campaign.event('mine');
        },
      });
      this.veinStatics.set(id, b);
    });
  }

  // Deep underground the sky's light fades and your lantern takes over.
  applyUnderground() {
    const f = this.frame, cam = this.camera.position;
    let k = 0;
    if (f && f.terrain && this.localRoot.parent === f.spin) {
      const D = cam.length();
      const n = tA.copy(cam).divideScalar(D);
      const depth = f.R + f.terrain.height(n.x, n.y, n.z) - D;
      k = Math.max(0, Math.min(1, (depth - 1.5) / 6));
    }
    if (this.sunBase === undefined) this.sunBase = this.system.light.intensity;
    this.system.light.intensity = this.sunBase * (1 - 0.88 * k);
    if (k > 0) {
      this.hemi.intensity *= 1 - 0.8 * k;
      this.ambient.intensity *= 1 - 0.6 * k;
      this.scene.fog.density = Math.max(this.scene.fog.density, 0.004 * k);
      this.scene.fog.color.multiplyScalar(1 - 0.8 * k);
    }
    this.lantern.intensity = 18 * k;
    // held up and to one side, so walls get some shape from the light
    const pu = n0(this.player.pos);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.lantern.position.copy(this.player.pos).addScaledVector(pu, 1.2).addScaledVector(side, 1.1);
    this.underground = k > 0.3;
  }

  // ----------------------------------------------------------- weapons --
  applyWeapon() {
    const s = this.state;
    const id = activePath(s);
    this.viewmodel.setPath(id, PATHS[id].color);
    this.hud.buildSkills(id);
    this.arts.reset();
    this.rt.guarding = false;
    this.rt.aiming = false;
  }

  equipWeapon(id) {
    const s = this.state;
    if (id === 'radar') return this.takeOutScanner();
    if (!owns(s, id) || (activePath(s) === id && !this.rt.scanner)) return;
    this.putAwayScanner();
    s.weapon = id;
    this.applyWeapon();
    if (this.rt.controlling) this.rt.controlling = false;
    this.swords.reset(this.player);
    this.hud.notify(`<b>${esc(PATHS[id].weapon.name)}</b> <span class="cn">${PATHS[id].cn}</span> in hand.`, '');
    this.sound.ui();
  }

  // The wheel / next-weapon key cycles through owned weapons and the radar.
  cycleWeapon(dir) {
    const list = [...ownedPaths(this.state), ...((this.state.radar ?? -1) >= 0 ? ['radar'] : [])];
    const i = this.rt.scanner ? list.length - 1 : list.indexOf(activePath(this.state));
    this.equipWeapon(list[(i + dir + list.length) % list.length]);
  }

  buyWeapon(id) {
    const s = this.state, P = PATHS[id];
    if (!P || owns(s, id)) return;
    if (s.coins < P.weapon.price) return this.sound.deny();
    s.coins -= P.weapon.price;
    s.weapons = [...(s.weapons || []), id];
    this.stats = derive(s);
    this.sound.reward();
    this.hud.notify(`Bought the <b>${esc(P.weapon.name)}</b>. Its <b>${esc(P.name)}</b> skill tree is open: learn its techniques with skill points.`, 'gold');
    this.equipWeapon(id);
    this.campaign.event('weapon', id);
    this.save();
  }

  // A heavy blow on the land: broken props, scorch, and (when asked) a crater.
  impact(pos, radius, crater = false) {
    this.breakAt(pos, radius, null);
    this.scorch(pos, Math.max(1.5, radius * 0.7));
    if (crater && FEATURES.digging) this.dig(pos.clone().addScaledVector(pos.clone().normalize(), -radius * 0.3), Math.min(18, radius * 1.1));
  }

  respecCost() {
    return priceFor(60, this.state.realm);
  }

  // Refund every skill point.
  respec() {
    const s = this.state;
    const cost = this.respecCost();
    if (s.coins < cost) return this.sound.deny();
    s.coins -= cost;
    s.skills = {};
    this.stats = derive(s);
    this.rt.hp = Math.min(this.rt.hp, this.stats.maxHp);
    this.arts.reset();
    this.swords.setup(this.stats.swords, s.swordGrade);
    this.swords.reset(this.player);
    this.applyWeapon();
    this.sound.confirm();
    this.hud.notify('Your skill points have been refunded.', 'violet');
    this.save();
  }

  offerContext() {
    const f = this.frame;
    const cities = [];
    for (const p of this.system.planets) {
      const sites = [p.body.sites.city, ...p.body.sites.outposts, ...(p.body.sites.towns || [])].filter(Boolean);
      for (const site of sites) cities.push({ name: site.name, body: p.body.id, bodyName: p.body.name, dist: p === f ? 2000 : 20000 });
    }
    return { star: this.star, species: f && f.body.landable ? speciesForBody(f.body) : null, cities, here: this.interact && this.interact.city };
  }

  randomUpgradableTech() {
    const s = this.state;
    const list = ownedPaths(s).flatMap((id) => [PATHS[id].primary, ...PATHS[id].skills]).filter((k) => knows(s, k) && s.realm >= TECHS[k].unlockRealm && (s.mastery[k] || 1) < 5);
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
      this.hud.notify(`<b>${TECHS[tech].name}</b> mastery rises to ${s.mastery[tech]}.`, 'violet');
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
    const replacement = cur >= 0 && tier === cur;
    if (!def || !Number.isInteger(tier) || (!replacement && tier > 0 && s.realm < 2) || (!replacement && tier !== cur + 1)) return this.sound.deny();
    if (replacement && this.rt.inShip) return this.denied('Leave your ship before building a replacement hull.');
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
    if (!this.rt.inShip) {
      this.shipObj.vel.set(0, 0, 0);
      this.shipObj.thrust = 0;
      this.shipObj.dockedAt = null;
      this.shipObj.landed = false;
    }
    // a new or upgraded hull is delivered to the pad here
    if (settlement && !this.rt.inShip) {
      const up = settlement.padLocal.clone().normalize();
      const look = settlement.group.position.clone();
      this.shipObj.landed = true;
      this.shipObj.placeAt(settlement.padLocal.clone().addScaledVector(up, this.shipObj.gearHeight), look, up);
    } else if (!this.rt.inShip) {
      const p = this.player;
      let pos = p.pos.clone().add(p.forward().multiplyScalar(80));
      const up = f?.terrain ? pos.clone().normalize() : p.localUp();
      if (f?.terrain) {
        pos = up.clone().multiplyScalar(f.floorRadius(up.x, up.y, up.z) + this.shipObj.gearHeight);
        this.shipObj.landed = true;
      }
      this.shipObj.placeAt(pos, p.pos, up);
    }
    s.ship = { tier, star: this.star.key, body: f ? f.body.id : null, pos: this.shipObj.pos.toArray(), quat: this.shipObj.quat.toArray(), landed: this.shipObj.landed, hull: this.shipObj.hull };
    this.campaign.event('ship');
    this.sound.breakthrough();
    this.nix.event('ship', {}, 1);
    this.hud.banner('SHIPYARD', def.name, `<span class="cn">${def.cn}</span>Warp range ${def.range} light years · waiting on the pad`, hex(def.color), 4);
    if (replacement) this.hud.notify(`Built a replacement <b>${esc(def.name)}</b>. Your registered ship is now here, fully repaired.`, 'green');
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
  storyTarget() {
    return this.campaign.target();
  }

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

  targetExpedition(key, fromMap = false) {
    if (this.training.active) return this.denied('Return to your physical body to chart an expedition.');
    const star = getStar(key);
    const dist = star.pos.distanceTo(this.star.pos);
    if (dist < 0.01) return this.hud.notify('You are already in this system. Target one of its planet markers.', 'yl');
    if (fromMap && this.rt.nav && this.rt.nav.kind === 'star' && this.rt.nav.star.key === key) {
      this.rt.nav = null;
      return this.hud.notify('Target cleared.');
    }
    this.rt.nav = { kind: 'star', star, dist, label: star.name };
    this.rt.warpCharge = 0;
    this.rt.cruise = false;
    const range = this.shipObj ? SHIPS[this.shipObj.tier].range : 0;
    this.hud.notify(`Expedition charted: <b>${esc(star.name)}</b> · ${dist.toFixed(1)} light years. ${dist <= range ? 'Board your ship and engage warp.' : 'Use a longer-range ship or reach it through shorter jumps.'}`, 'yl');
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
    if (this.campaign?.planetary?.active) return this.denied('The World Rend disrupts interstellar warp. Defend the planet first.');
    if (this.training.active) return this.denied('Training is limited to the Prism world. Return to the Virtual Universe to leave.');
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
    this.nix.event('warp', {}, 1);
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

  updateWarpLines(dt, intensity) {
    const arr = this.warpLines.geometry.attributes.position.array;
    const speed = 500 + intensity * 2600;
    for (let i = 0; i < this.warpData.length; i++) {
      const d = this.warpData[i];
      d.z += speed * dt;
      if (d.z > -10) d.z -= 700;
      const len = 4 + intensity * 110;
      arr[i * 6] = d.x; arr[i * 6 + 1] = d.y; arr[i * 6 + 2] = d.z;
      arr[i * 6 + 3] = d.x; arr[i * 6 + 4] = d.y; arr[i * 6 + 5] = d.z - len;
    }
    this.warpLines.geometry.attributes.position.needsUpdate = true;
    this.warpLines.material.opacity = intensity;
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
    this.updateWarpLines(dt, inten);
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
    this.updateAtmosphereLighting(dt);
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
    // remember the jump so the star map can draw the route you took
    recordJump(this.state, from.key, this.star.key);
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
    this.nix.event('arrive');
    this.clock.getDelta();
  }

  // ----------------------------------------------------- presentation --
  flareOccluders() {
    return this.system.planets.map((p) => ({ kind: 'planet', pos: p.worldPos, radius: p.R }));
  }

  updateAtmosphereLighting(dt = 0.016) {
    const f = this.frame;
    const sky = f && f.body.atmo ? f.skyState(this.system.root.position) : null;
    const fog = this.scene.fog;
    if (sky) {
      const thick = f.body.type === 'toxic' ? 2.4 : f.body.type === 'desert' ? 1.4 : 1;
      fog.density = 0.00011 * thick * Math.pow(1 - Math.min(1, sky.alt), 2);
      // night is moonlit, not black: a cool blue light the eye can still read shapes by
      const night = 1 - sky.day;
      fog.color.copy(sky.color).multiplyScalar(0.06 + 0.85 * sky.day).lerp(NIGHT_FOG, night * 0.8);
      // daylight fills the shade too: buildings and cliffs away from the sun still read
      this.hemi.intensity = 0.12 + 1.4 * sky.day + 0.6 * night;
      this.hemi.color.copy(sky.color).lerp(WHITE, 0.3).lerp(MOONLIGHT, night);
      this.ambient.intensity = 0.16 + 0.3 * sky.day + 0.2 * night;
      // sunlit ground bounces warm light up onto walls and undersides
      this.hemi.groundColor.copy(GROUND_NIGHT).lerp(GROUND_DAY, sky.day);
      this.scene.environmentIntensity = 0.5 + 0.45 * sky.day;
      // the eye adapts to the dark: nights open up a little instead of going black
      this.exposureTarget = 1 + 0.75 * night * night;
    } else {
      fog.density = 0;
      this.hemi.intensity = 0.1;
      this.ambient.intensity = 0.2;
      this.hemi.groundColor.copy(GROUND_NIGHT);
      this.scene.environmentIntensity = 0.5;
      this.exposureTarget = 1;
    }
    // adapt over a couple of seconds, so stepping out of a lit city into the dark takes a moment
    const ex = this.renderer.toneMappingExposure;
    this.renderer.toneMappingExposure = ex + (this.exposureTarget - ex) * Math.min(1, dt * 0.8);
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
    fx.glitch = Math.max((this.mode === 'playing' || this.mode === 'virtual') && hpFrac < 0.3 ? ((0.3 - hpFrac) / 0.3) * 0.8 : 0, this.mode === 'virtual' ? fx.glitch - dt * 2.5 : 0);
    fx.tintAmt += ((rt.trib ? 0.55 : 0) - fx.tintAmt) * Math.min(1, dt * 3);
    const vel = rt.inShip && this.shipObj ? this.shipObj.vel : p.vel;
    const speed = vel.length();
    fx.speed = settings.get('speedBlur') ? (rt.cruise ? Math.min(0.8, speed / 60000) : p.boosting && p.mode !== 'ground' ? 0.35 : 0) : 0;
    this.updateAtmosphereLighting(dt);
    this.applyUnderground();
    this.applyUnderwater();

    const camWorld = this.camera.getWorldPosition(new THREE.Vector3());
    const sunDirView = this.system.root.position.clone().sub(camWorld).normalize().transformDirection(this.camera.matrixWorldInverse);
    this.viewmodel.update(dt, {
      mouseX: this.lastMouse.x, mouseY: this.lastMouse.y, speed: p.mode === 'ground' ? speed * 8 : speed, boost: p.boosting && !rt.controlling && p.mode !== 'ground',
      meditating: rt.meditating, controlling: rt.controlling, energyFrac: rt.energy / this.stats.maxEnergy, sunDirView, sunColor: this.system.sunColor,
      guarding: rt.guarding, gripping: !!this.arts.grip, aiming: rt.aiming, scanning: rt.scanner && this.camMode === 'first',
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
    if (rt.inVehicle && this.vehicleObj) modeLabel = `${this.vehicleObj.def.name.toUpperCase()} · ${codeLabel(settings.key('interact'))} GET OFF`;
    else if (rt.inShip && this.shipObj) modeLabel = rt.warpCharge > 0 ? 'WARP CHARGE' : rt.cruise ? 'CRUISE' : this.shipObj.landed ? 'SHIP · LANDED' : 'SHIP';
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
      state: s, stats: this.stats, rt, loc, density, medRate, bt: this.breakthroughStatus(), path: activePath(s),
      canDodge: this.mode === 'playing' && p.mode === 'ground' && p.grounded && !rt.swimming && !rt.inShip && !rt.inVehicle && !this.placing && !this.arts.dash,
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
    // the radar display needs a radar
    const hasRadar = (this.state.radar ?? -1) >= 0;
    document.getElementById('radar').style.visibility = !hasRadar || (this.rt.scanner && this.camMode === 'first') ? 'hidden' : '';
    if (hasRadar) this.hud.drawRadar(dt, radar, this.frame && this.env.inAtmo ? RADARS[this.state.radar].range : 4000);
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
      const size = m.planet ? ` · Ø ${(m.planet.R / 500).toLocaleString('en-US', { maximumFractionDigits: 1 })} KM` : '';
      list.push({ key: m.key, kind: m.kind === 'moon' ? 'planet' : m.kind, label: esc(m.label), sub: `${fmtKm(surf)}${size}`, pos: world, dist, edge: nav, nav, compass: nav ? '#ffe44d' : null });
    }
    const f = this.frame;
    if (f && f.details) {
      for (const st of f.details.settlements) {
        for (const v of st.venues) {
          if (v.kind === 'lobby') continue;
          const at = v.door || v.center;
          const d = at.distanceTo(origin);
          const major = v.kind === 'hall' || v.kind === 'arena';
          if (d > (major ? 2500 : 220)) continue;
          if (this.inVenue && this.inVenue.v === v) continue;
          list.push({ key: `v:${st.site.name}:${v.kind}:${v.x | 0}`, kind: 'station', label: esc(v.name), sub: fmtKm(d), pos: this.toWorld(at.clone().addScaledVector(at.clone().normalize(), 7)), dist: d, edge: false, compass: major && d < 2500 ? '#ffe44d' : null });
        }
        for (const sv of st.services) {
          if (sv.kind !== 'shipyard') continue;
          const d = sv.pos.distanceTo(origin);
          if (d > 2500) continue;
          list.push({ key: `svc:${sv.name}`, kind: 'station', label: esc(sv.name), sub: fmtKm(d), pos: this.toWorld(sv.pos.clone().addScaledVector(sv.pos.clone().normalize(), 8)), dist: d, edge: false, compass: d < 1500 ? '#3ef2ff' : null });
        }
      }
      this.updateRuinFields(list, origin, fmtKm);
      for (const e of f.details.sites) {
        const center = e.dir.clone().multiplyScalar(f.R + e.site.height + 40);
        const d = center.distanceTo(origin);
        if (d < e.site.radius * 1.6 || d > 60000) continue;
        list.push({ key: `site:${e.site.name}`, kind: 'planet', label: esc(e.site.name.toUpperCase()), sub: fmtKm(d), pos: this.toWorld(center), dist: d, edge: false, compass: e.site.main ? '#ffe44d' : e.site.size === 'city' ? '#3ef2ff' : null });
      }
      for (const poi of f.details.pois) {
        const d = poi.pos.distanceTo(origin);
        const known = s.discovered.includes(poi.poi.id);
        const rumored = s.rumors && s.rumors.includes(poi.poi.id) && !known;
        if (d > (known ? 4000 : rumored ? 1e9 : (s.radar ?? -1) >= 0 ? RADARS[s.radar].reveal : 350)) continue;
        if (poi.poi.kind === 'ore' && s.explored.includes(poi.poi.id)) continue;
        const done = (poi.poi.kind === 'ruin' || poi.poi.kind === 'wreck' || poi.poi.kind === 'obelisk') && s.explored.includes(poi.poi.id);
        const color = POI_COLOR[poi.poi.kind];
        list.push({ key: poi.poi.id, kind: 'hotspot', label: `<span style="color:${color}">${POI_LABEL[poi.poi.kind].toUpperCase()}${done ? ' ✓' : ''}</span>`, sub: fmtKm(d), pos: this.toWorld(poi.pos.clone().addScaledVector(poi.up, 10)), dist: d, edge: false, compass: d < 1500 ? color : null });
      }
    }
    if (this.pets.active) {
      const a = this.pets.active, d = a.pos.distanceTo(origin);
      list.push({ key: 'pet', kind: 'gate', label: `<span style="color:#9affc8">${esc(a.rec.name.toUpperCase())}</span>`, sub: `${Math.round((100 * a.hp) / a.maxHp)}%`, pos: this.toWorld(a.pos.clone().addScaledVector(a.pos.clone().normalize(), (a.rec.def.radius || 2) * 1.6)), dist: d, edge: false, compass: null });
    }
    if (this.vehicleObj && !rt.inVehicle) {
      const d = this.vehicleObj.pos.distanceTo(p.pos);
      if (d > 8) list.push({ key: 'vehicle', kind: 'gate', label: `YOUR ${esc(this.vehicleObj.def.name.toUpperCase())}`, sub: fmtKm(d), pos: this.toWorld(this.vehicleObj.pos.clone().addScaledVector(this.vehicleObj.pos.clone().normalize(), 2)), dist: d, edge: d < 3000, compass: d < 3000 ? '#ff8a4a' : null });
    }
    if (this.shipObj && !rt.inShip) {
      const d = this.shipObj.pos.distanceTo(p.pos);
      list.push({ key: 'ship', kind: 'gate', label: 'YOUR SHIP', sub: fmtKm(d), pos: this.toWorld(this.shipObj.pos), dist: d, edge: true, compass: '#b98cff' });
    }
    for (const pod of this.pods) {
      const pos = pod.group.position.clone().addScaledVector(pod.up, 3);
      const d = pos.distanceTo(origin);
      list.push({ key: `delivery:${pod.delivery.id}`, kind: 'gate', label: esc(pod.delivery.label),
        sub: `${pod.landed ? 'DELIVERY POD' : 'INCOMING DELIVERY'} · ${fmtKm(d)}`, pos: this.toWorld(pos), dist: d, edge: true, compass: '#ffe44d' });
    }
    const story = this.mode === 'playing' ? this.storyTarget() : null;
    if (story) {
      const d = story.distanceTo(origin);
      list.push({ key: 'story', kind: 'nav', label: '<span style="color:#ffc857">◆ OBJECTIVE</span>', sub: fmtKm(d), pos: this.toWorld(story.clone().addScaledVector(story.clone().normalize(), 4)), dist: d, edge: true, nav: true, compass: '#ffc857' });
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
        if (b.static && b.name === 'Star Metal Vein' && d > 25 && this.time - b.lastHit > 4) continue;
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
    if (this.training?.active) return this.training.physical?.save() ?? false;
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
    if (this.vehicleObj && this.frame) s.vehicleLoc = { star: this.star.key, body: this.frame.body.id, pos: this.vehicleObj.pos.toArray(), fwd: this.vehicleObj.fwd.toArray() };
    if (this.shipObj) {
      s.ship = {
        tier: this.shipObj.tier, star: this.star.key, body: this.frame ? this.frame.body.id : null,
        pos: this.shipObj.pos.toArray(), quat: this.shipObj.quat.toArray(), landed: this.shipObj.landed, hull: this.shipObj.hull,
      };
    }
    const saved = saveState(s);
    if (!saved && !this.saveFailed) {
      this.hud.notify('Progress could not be saved. Browser storage may be full or unavailable. Keep this tab open and free up storage before leaving.', 'red');
    } else if (saved && this.saveFailed) {
      this.hud.notify('Saving restored. Your progress has been saved.', 'green');
    }
    this.saveFailed = !saved;
    return saved;
  }
}
