import * as THREE from 'three';
import {
  REALMS, STAGES, MAX_REALM, TECHNIQUES, ACTIVE_TECHNIQUES, PILLS, GALAXIES, BOSSES, FINAL_BOSS, SWORD_GRADES,
  getGalaxySystems, xpScale, masteryMult, priceFor, MANUAL_PRICE, realmOf, essenceFor,
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
import { LensFlare } from '../world/flare.js';
import { SpaceDust } from '../world/dust.js';
import { puffTexture, glowTexture } from '../world/textures.js';
import { Particles } from './particles.js';
import { Combat } from './combat.js';
import { BeastManager } from './beasts.js';
import { Player } from './player.js';
import { SwordArray } from './swords.js';
import { ViewModel } from './viewmodel.js';
import { Loot } from './loot.js';
import { HUD, fmt, esc, hex } from '../ui/hud.js';
import { Menus } from '../ui/menus.js';

const tmpV = new THREE.Vector3();
const tmpW = new THREE.Vector3();
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const SCAN_TIME = 1.6;

export class Game {
  constructor(canvas) {
    applyShaderFixes();
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.dynScale = 1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020308);
    this.camera = new THREE.PerspectiveCamera(settings.get('fov'), 1, 0.5, 40000);
    this.scene.add(this.camera);
    this.scene.add(new THREE.AmbientLight(0x6070a0, 0.25));
    this.scene.add(new THREE.HemisphereLight(0x8090ff, 0x1a1208, 0.2));
    this.scene.environmentIntensity = 0.55;

    this.viewmodel = new ViewModel(this.scene);
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.viewmodel.scene, this.viewmodel.camera);
    this.flare = new LensFlare();
    this.post.overlays.push(this.flare);
    this.skyBaker = new SkyBaker(this.renderer);
    const preset = settings.preset;
    this.particles = new Particles(this.scene, preset.particles);
    this.dust = new SpaceDust(this.scene, preset.dust);
    this.sound = new AudioEngine();
    this.combat = new Combat(this.scene, this.particles, this.sound);
    this.beasts = new BeastManager(this.scene, this.particles, this.combat, this.sound);
    this.beasts.onKill = (b) => this.onBeastKilled(b);
    this.loot = new Loot(this.scene, this.particles, this.sound);
    this.swords = new SwordArray(this.scene, this.particles, this.combat, this.sound);
    this.player = new Player(this.scene, this.particles);
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
    this.skyGalaxy = -1;
    this.interact = null;
    this.aimTarget = null;
    this.notifyGate = {};
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.fps = 60;
    this.qualityChangePending = false;
    this.lastMouse = { x: 0, y: 0 };

    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onKey = (code) => this.onKey(code);
    canvas.addEventListener('click', () => {
      if (this.mode === 'playing' && !this.input.locked && !this.menus.overlayOpen) this.resume();
    });
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.inGame) saveState(this.state);
    });
    window.addEventListener('beforeunload', () => {
      if (this.inGame) saveState(this.state);
    });
    settings.onChange((k) => this.onSetting(k));
    this.resize();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
    this.boot();
  }

  get inGame() {
    return this.mode === 'playing' || this.mode === 'dead' || this.mode === 'warping';
  }

  freshRuntime() {
    return {
      hp: this.stats.maxHp,
      energy: this.stats.maxEnergy,
      spirit: this.stats.maxSpirit,
      cooldowns: { bolt: 0, swords: 0, burst: 0, body: 0, storm: 0 },
      shieldT: 0, meditating: false, medBlock: 0, hurtFlash: 0, lastHurt: -99,
      trib: null, deadT: 0, invuln: 0, nav: null, cruise: false, shake: 0, hand: 1,
      burnNotify: 0, lock: null, controlling: false, spiritLock: false, scanT: 0, flash: 0, firingT: 0,
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
    for (let i = 0; i < n; i++) {
      const c = Math.random() < 0.3 ? [1, 0.25, 0.55] : [0.25, 0.95, 1];
      col.set([...c, 0, 0, 0], i * 6);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.warpLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.warpLines.frustumCulled = false;
    this.warpLines.visible = false;
    this.camera.add(this.warpLines);
  }

  async boot() {
    this.menus.showLoading(true);
    this.menus.setLoading(0.04, 'CALIBRATING SENSORS');
    await new Promise((r) => setTimeout(r, 60));
    try {
      const sys = await this.buildSystem(this.state.galaxy, this.state.system, (p) => this.menus.setLoading(0.08 + p * 0.8, 'GENERATING STAR SYSTEM'));
      this.menus.setLoading(0.9, 'BAKING STARFIELD');
      await new Promise((r) => setTimeout(r, 30));
      this.installSystem(sys, this.state.galaxy, this.state.system);
      this.menus.setLoading(0.96, 'COMPILING SHADERS');
      await new Promise((r) => setTimeout(r, 30));
      this.swords.setup(this.stats.swords, this.state.swordGrade);
      this.swords.setVisible(false);
      try { this.renderer.compile(this.scene, this.camera); } catch { /* optional warm-up */ }
      this.menus.setLoading(1, 'READY');
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      console.error(err);
      this.menus.setLoading(1, 'FAILED TO START · SEE CONSOLE');
      return;
    }
    this.menus.showLoading(false);
    this.enterTitle();
  }

  async buildSystem(gi, si, onProgress) {
    const def = getGalaxySystems(gi)[si];
    return StarSystem.create(this.scene, def, settings.preset, (d, t) => onProgress && onProgress(d / t));
  }

  installSystem(sys, gi, si) {
    if (this.system) this.system.dispose();
    this.combat.clear();
    this.particles.clear();
    this.loot.clear();
    this.swords.clearPhantoms();
    this.qualityChangePending = false;
    this.system = sys;
    this.systemDef = sys.def;
    sys.attach();
    if (this.skyGalaxy !== gi) {
      const baked = this.skyBaker.bake(gi, settings.preset.skyRes);
      this.scene.background = baked.background;
      this.scene.environment = baked.env;
      this.viewmodel.setEnv(baked.env);
      this.skyGalaxy = gi;
      this.dust.setTint(GALAXIES[gi].sky[3]);
    }
    this.flare.setColor(sys.starType.glow);
    this.sound.setGalaxy(gi);
    this.hud.clearMarkers();
    this.hud.clearDamageNumbers();
    const spawn = sys.station ? sys.station.spawn : sys.entryPoint;
    const look = sys.station ? sys.station.look : new THREE.Vector3();
    this.player.placeAt(spawn, look);
    this.camQuat.copy(this.player.quat);
    this.beasts.setSystem(sys, sys.def, this.state.bosses.includes(sys.def.boss), spawn);
    this.markerList = sys.markers();
    this.rt.nav = null;
    this.rt.cruise = false;
    this.rt.lock = null;
    this.swords.reset(this.player);
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
    if (this.systemDef.galaxy !== 0 || this.systemDef.index !== 0) {
      this.menus.showTitle(false);
      this.menus.showLoading(true);
      const sys = await this.buildSystem(0, 0, (p) => this.menus.setLoading(p * 0.95, 'GENERATING STAR SYSTEM'));
      this.installSystem(sys, 0, 0);
      this.menus.showLoading(false);
    } else {
      this.installSystem(this.system, 0, 0);
    }
    this.swords.setup(this.stats.swords, 0);
    saveState(this.state);
    this.hasSave = true;
    this.startPlaying();
  }

  continueGame() {
    this.stats = derive(this.state);
    this.rt = this.freshRuntime();
    this.player.setRealm(this.state.realm);
    this.swords.setup(this.stats.swords, this.state.swordGrade);
    const spawn = this.system.station ? this.system.station.spawn : this.system.entryPoint;
    this.player.placeAt(spawn, this.system.station ? this.system.station.look : new THREE.Vector3());
    this.camQuat.copy(this.player.quat);
    this.startPlaying();
  }

  startPlaying() {
    this.mode = 'playing';
    this.camMode = settings.get('camera');
    this.menus.showTitle(false);
    this.hud.show(true);
    this.applyCamMode();
    this.swords.setVisible(true);
    this.swords.reset(this.player);
    this.viewmodel.setColor(REALMS[this.state.realm].color);
    this.sound.init();
    this.input.lock();
    this.camera.fov = settings.get('fov');
    this.camera.updateProjectionMatrix();
    if (!this.state.intro) {
      this.state.intro = true;
      const tips = [
        ['Welcome to <b>Solace</b>, Warrior. The Martial Hall station hangs before you.', 'gold'],
        ['Hold <kbd>RMB</kbd> to steer your flying swords with your mind. Sweep them through beasts.', 'violet'],
        ['<kbd>LMB</kbd> fires Star Bolts. <kbd>Q</kbd> looses your swords at targets. <kbd>Z</kbd> switches formation.', ''],
        ['Hold <kbd>C</kbd> to cultivate. Energy is richest near the star and inside glowing nebulae.', 'gold'],
        ['Fly to the station and press <kbd>E</kbd> to dock for bounties and the sword forge. <kbd>M</kbd> opens the star map.', 'yl'],
      ];
      tips.forEach(([t, k], i) => setTimeout(() => this.inGame && this.hud.notify(t, k), 900 + i * 3200));
      this.hud.banner('SYSTEM ONLINE', 'Solace', '<span class="cn">青旋星系</span>Azure Spiral', '#3ef2ff', 4);
    } else {
      this.hud.notify(`Returned to the <b>${esc(this.systemDef.name)}</b> system.`, 'gold');
    }
  }

  applyCamMode() {
    const fp = this.camMode === 'first';
    this.player.setVisible(!fp && this.mode !== 'dead');
    this.viewmodel.setVisible(fp && this.mode !== 'dead');
    this.post.vmEnabled = fp;
  }

  resume() {
    this.menus.showPause(false);
    this.sound.init();
    this.input.lock();
  }

  async quitToTitle() {
    saveState(this.state);
    this.loaded = this.state;
    this.hasSave = true;
    this.menus.showPause(false);
    this.endTribulation();
    this.rt.controlling = false;
    this.swords.controlling = false;
    this.enterTitle();
  }

  onLockChange(locked) {
    if (locked) {
      this.menus.showPause(false);
    } else if (this.inGame && !this.menus.overlayOpen) {
      this.menus.showPause(true);
      saveState(this.state);
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
    if (this.mode !== 'playing' || m.$('settings').classList.contains('hidden') === false || !m.$('modal').classList.contains('hidden')) return;
    if (code === 'KeyM') this.togglePanel('map', 'galaxy');
    else if (code === 'KeyK') this.togglePanel('cultivation');
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
    return this.interact && this.interact.kind === 'station';
  }

  get atGate() {
    return this.interact && this.interact.kind === 'gate';
  }

  // ------------------------------------------------------------ frame --
  frame() {
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
    this.titleAngle += dt * 0.03;
    const sys = this.system;
    const center = sys.station ? sys.station.pos : new THREE.Vector3(Math.cos(sys.entryAngle) * (sys.starRadius + 1200), 0, Math.sin(sys.entryAngle) * (sys.starRadius + 1200));
    const R = 520;
    const a = this.titleAngle;
    this.camera.position.set(center.x + Math.cos(a) * R, center.y + 140 + Math.sin(a * 0.7) * 60, center.z + Math.sin(a) * R);
    this.camera.lookAt(center);
    this.camera.rotateY(0.42);
    this.camera.rotateX(0.06);
    this.camera.updateMatrixWorld();
    sys.update(dt, this.camera);
    this.particles.update(dt);
    this.dust.update(this.camera.position, tmpV.set(0, 0, 0), 0);
    this.flare.update(this.camera, sys.colliders[0].pos, sys.starRadius, sys.colliders, dt);
    this.post.fx.speed = 0;
    this.post.fx.damage = 0;
    this.post.fx.tintAmt = 0;
    this.post.fx.glitch = 0;
    this.post.fx.flash = 0;
  }

  // ----------------------------------------------------------- update --
  update(dt) {
    const s = this.state, rt = this.rt, p = this.player, inp = this.input;
    const alive = this.mode === 'playing';
    let st = this.stats;

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
    rt.meditating = alive && inp.down('KeyC') && !manual && !rt.trib && rt.medBlock <= 0;

    // ---- sword control (RMB)
    if (!inp.right) rt.spiritLock = false;
    rt.controlling = alive && inp.right && !rt.spiritLock && !rt.meditating && rt.spirit > 0;
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
    if (alive && !rt.controlling && inp.wheel && this.camMode === 'third') this.zoom = clamp(this.zoom + inp.wheel * 0.12, 0.55, 2.6);

    // ---- cruise autopilot
    let speedMult = 1;
    let boost = alive && (inp.down('ShiftLeft') || inp.down('ShiftRight')) && rt.energy > 1 && manual;
    if (rt.cruise) {
      if (!alive || manual || !rt.nav || rt.meditating) {
        rt.cruise = false;
      } else {
        const target = this.cruiseWaypoint(rt.nav.pos);
        const dir = tmpV.subVectors(target, p.pos).normalize();
        const k = 1 - Math.exp(-dt * 3.5);
        p.yaw += wrapAngle(Math.atan2(-dir.x, -dir.z) - p.yaw) * k;
        p.pitch += (Math.asin(clamp(dir.y, -1, 1)) - p.pitch) * k;
        look.x *= 0.15;
        look.y *= 0.15;
        move.z = 1;
        boost = true;
        speedMult = 1.45;
        if (p.pos.distanceTo(rt.nav.pos) < rt.nav.arrive + Math.max(40, p.vel.length() * 0.6)) {
          rt.cruise = false;
          this.hud.notify(`Arrived at <b>${esc(rt.nav.label)}</b>.`, 'yl');
        }
      }
    }
    if (boost && !rt.cruise) rt.energy = Math.max(0, rt.energy - 9 * dt);

    p.update(dt, move, look, { speed: st.speed * speedMult, boost, meditating: rt.meditating, time: this.time, shield: rt.shieldT > 0, hidden: !alive || this.camMode === 'first' });
    if (alive) this.worldConstraints(dt, st);
    this.updateCamera(dt, move);

    // ---- aim and targeting
    const camFwd = tmpW.set(0, 0, -1).applyQuaternion(this.camera.quaternion).clone();
    this.aimTarget = this.pickAimTarget(camFwd);
    if (rt.lock && (!rt.lock.alive || rt.lock.pos.distanceTo(p.pos) > 2200)) rt.lock = null;
    if (alive && inp.pressed.has('Tab')) this.cycleLock(camFwd);
    const aimBeast = this.aimTarget || rt.lock;
    let aimPoint;
    if (this.aimTarget) {
      const b = this.aimTarget;
      aimPoint = b.pos.clone().addScaledVector(b.vel, b.pos.distanceTo(p.pos) / 700);
    } else {
      aimPoint = this.camera.position.clone().addScaledVector(camFwd, 1500);
    }

    // ---- techniques
    for (const k of ACTIVE_TECHNIQUES) rt.cooldowns[k] = Math.max(0, rt.cooldowns[k] - dt);
    rt.shieldT = Math.max(0, rt.shieldT - dt);
    rt.invuln = Math.max(0, rt.invuln - dt);
    rt.firingT = Math.max(0, rt.firingT - dt);
    const swordDamage = st.atk * SWORD_GRADES[s.swordGrade].mult * masteryMult(s.mastery.swords);
    if (alive && !rt.meditating) {
      const T = TECHNIQUES;
      if (inp.left && rt.cooldowns.bolt <= 0 && rt.energy >= T.bolt.cost) this.fireBolt(aimPoint, st);
      if (inp.pressed.has('KeyQ')) this.castLaunch(camFwd, swordDamage * 1.6);
      if (inp.pressed.has('KeyZ')) this.hud.notify(`Sword formation: <b>${this.swords.toggleFormation() === 'swarm' ? 'Swarm' : 'Lance'}</b>.`, 'violet');
      if (inp.pressed.has('KeyR')) this.castBurst();
      if (inp.pressed.has('KeyF')) this.castBody();
      if (inp.pressed.has('KeyV')) this.castStorm(swordDamage * 2.2);
      if (inp.pressed.has('Digit1')) this.usePill('heal');
      if (inp.pressed.has('Digit2')) this.usePill('energy');
      if (inp.pressed.has('Digit3')) this.usePill('cult');
    }
    if (alive) {
      if (inp.pressed.has('KeyB')) this.tryBreakthrough();
      if (inp.pressed.has('KeyT')) this.setCourse();
      if (inp.pressed.has('KeyG')) this.toggleCruise();
    }

    // ---- regeneration & cultivation
    const density = this.system.densityAt(p.pos);
    const medRate = 1.0 * xpScale(this.systemDef.tier) * density * (s.devour ? 1.5 : 1);
    if (alive) {
      if (!boost) rt.energy = Math.min(st.maxEnergy, rt.energy + st.regen * dt * (rt.meditating ? 2.2 : 1));
      if (!rt.controlling) rt.spirit = Math.min(st.maxSpirit, rt.spirit + st.spiritRegen * dt * (rt.meditating ? 2 : 1));
      if (this.time - rt.lastHurt > 6) rt.hp = Math.min(st.maxHp, rt.hp + st.maxHp * 0.012 * dt);
      if (rt.meditating) {
        rt.hp = Math.min(st.maxHp, rt.hp + st.maxHp * 0.035 * dt);
        const gained = medRate * dt;
        this.addXp(gained);
        this.applyBounties(progressBounties(s, { kind: 'cultivate', amount: gained }));
        st = this.stats;
        const ga = GALAXIES[s.galaxy];
        const c = new THREE.Color(Math.random() < 0.5 ? ga.sky[0] : ga.sky[3]).lerp(p.auraColor, 0.4).multiplyScalar(1.5);
        const center = this.camMode === 'first' ? this.camera.position.clone().addScaledVector(camFwd, 2.5).add(tmpV.set(0, -0.6, 0)) : p.pos;
        this.particles.converge(center, c, Math.round(1 + density * 1.2), 18 + density * 4, 26, 0.45);
      }
    }
    rt.hurtFlash = Math.max(0, rt.hurtFlash - dt);

    // ---- world
    const ctx = { player: p, playerAlive: alive && rt.invuln <= 0, time: this.time, hurtPlayer: (d, pos, knock) => this.hurtPlayer(d, pos, knock) };
    this.beasts.update(dt, ctx);
    this.swords.setup(st.swords, s.swordGrade);
    this.swords.update(dt, {
      player: p, camera: this.camera, aimDir: camFwd, aimTarget: aimBeast, beasts: this.beasts.beasts, realm: s.realm,
      enemyShots: this.combat.enemyShots, wheel: rt.controlling ? inp.wheel : 0, swordDamage,
      hit: (b, dmg, pos, kind, knock) => this.hitBeast(b, dmg, pos, kind, knock),
    });
    this.combat.update(dt, {
      beasts: this.beasts.beasts, player: p, playerAlive: alive && rt.invuln <= 0, system: this.system,
      hitBeast: (b, dmg, pos, kind, knock) => this.hitBeast(b, dmg, pos, kind, knock),
      hurtPlayer: (d, pos) => this.hurtPlayer(d, pos),
    });
    this.loot.update(dt, p, 70 + s.realm * 12, (it) => {
      s.essence += it.amount;
      this.hud.damageNumber(p.pos.clone().addScaledVector(camFwd, 6), `+${fmt(it.amount)} ✦`, 'xp');
    });
    this.system.update(dt, this.camera);
    this.particles.update(dt);
    this.dust.update(this.camera.position, p.vel, 0);
    if (rt.trib) this.updateTribulation(dt);
    if (this.mode === 'dead') {
      rt.deadT -= dt;
      this.menus.setDeathCount(`REFORMING BODY IN ${Math.max(0, Math.ceil(rt.deadT))}`);
      if (rt.deadT <= 0) this.respawn();
    }

    // ---- interaction (hold E to scan planets)
    this.updateInteraction(dt, alive);

    // ---- presentation
    this.updatePresentation(dt, camFwd, density, medRate, aimBeast);
    this.saveTimer += dt;
    if (this.saveTimer > 10) {
      this.saveTimer = 0;
      saveState(s);
    }
  }

  worldConstraints(dt, st) {
    const p = this.player, rt = this.rt;
    const hit = this.system.resolveCollision(p.pos, p.radius);
    if (hit) {
      tmpV.subVectors(p.pos, hit.pos).normalize();
      const into = p.vel.dot(tmpV);
      if (into < 0) p.vel.addScaledVector(tmpV, -into * 1.2);
    }
    const ds = p.pos.length();
    if (ds < this.system.starRadius * 1.3) {
      this.hurtPlayer(st.maxHp * 0.12 * dt, null, null, true);
      if (this.time > rt.burnNotify) {
        rt.burnNotify = this.time + 4;
        this.hud.notify('The star’s corona is burning through your body. Pull back!', 'red');
      }
    }
    const limit = this.system.outerOrbit + 2600;
    if (ds > limit) {
      p.vel.addScaledVector(tmpV.copy(p.pos).normalize(), -(ds - limit) * 2 * dt - 60 * dt);
      if (this.time > (this.notifyGate.edge || 0)) {
        this.notifyGate.edge = this.time + 6;
        this.hud.notify('You have reached the edge of the system. Open the star map (M) to warp.', 'violet');
      }
    }
  }

  updateCamera(dt, move = { x: 0 }) {
    const p = this.player, rt = this.rt;
    if (this.camMode === 'first') {
      this.camQuat.slerp(p.quat, 1 - Math.exp(-dt * 30));
      const yawRate = this.lastMouse.x * 0.0021 / Math.max(dt, 0.001);
      const localX = tmpV.copy(p.vel).applyQuaternion(this.camQuat.clone().invert()).x;
      const target = clamp(-localX * 0.0009 - yawRate * 0.004, -0.12, 0.12);
      this.roll += (target - this.roll) * (1 - Math.exp(-dt * 4));
      this.camera.position.copy(p.pos);
      this.camera.quaternion.copy(this.camQuat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.roll));
    } else {
      this.camQuat.slerp(p.quat, 1 - Math.exp(-dt * 14));
      const off = tmpV.set(0, 3.4 * this.zoom, 13 * this.zoom).applyQuaternion(this.camQuat);
      this.camera.position.copy(p.pos).add(off);
      this.camera.quaternion.copy(this.camQuat);
    }
    if (rt.shake > 0) {
      rt.shake = Math.max(0, rt.shake - dt * 3);
      if (settings.get('shake')) {
        const m = rt.shake * (this.camMode === 'first' ? 0.6 : 2);
        this.camera.position.add(tmpV.set((Math.random() - 0.5) * m, (Math.random() - 0.5) * m, (Math.random() - 0.5) * m));
      }
    }
    const base = settings.get('fov');
    const targetFov = base + (p.boosting ? 10 : 0) + (rt.cruise ? 6 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
      this.particles.setScale(this.height * this.pixelRatio(), this.camera.fov);
    }
    this.camera.updateMatrixWorld();
  }

  pickAimTarget(camFwd) {
    let best = null, bestScore = Infinity;
    for (const b of this.beasts.beasts) {
      const to = tmpV.subVectors(b.pos, this.camera.position);
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
      .map((b) => ({ b, ang: tmpV.subVectors(b.pos, this.camera.position).normalize().angleTo(camFwd), d: b.pos.distanceTo(this.player.pos) }))
      .filter((c) => c.ang < 0.9 && c.d < 1800)
      .sort((a, b) => a.ang - b.ang);
    if (!cands.length) {
      this.rt.lock = null;
      return;
    }
    const idx = cands.findIndex((c) => c.b === this.rt.lock);
    this.rt.lock = cands[(idx + 1) % cands.length].b;
    this.sound.lock();
  }

  // Steer around the star if it lies between us and the target.
  cruiseWaypoint(target) {
    const p = this.player.pos;
    const ab = tmpW.subVectors(target, p);
    const len2 = ab.lengthSq();
    const t = len2 > 0 ? clamp(-p.dot(ab) / len2, 0, 1) : 0;
    const closest = p.clone().addScaledVector(ab, t);
    const safe = this.system.starRadius + 320;
    if (t > 0.02 && t < 0.98 && closest.length() < safe) {
      if (closest.lengthSq() < 1) closest.set(0, 1, 0);
      return closest.normalize().multiplyScalar(safe + 300);
    }
    return target;
  }

  // ------------------------------------------------------- techniques --
  fireBolt(aimPoint, st) {
    const rt = this.rt, T = TECHNIQUES.bolt;
    rt.cooldowns.bolt = T.cd;
    rt.energy -= T.cost;
    rt.firingT = 0.12;
    const cam = this.camera;
    const right = tmpV.set(1, 0, 0).applyQuaternion(cam.quaternion).clone();
    const down = tmpW.set(0, -1, 0).applyQuaternion(cam.quaternion).clone();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    let origin;
    if (this.camMode === 'first') {
      if (!rt.controlling) rt.hand = -rt.hand;
      else rt.hand = 1;
      origin = cam.position.clone().addScaledVector(fwd, 1.4).addScaledVector(right, rt.hand * 0.55).addScaledVector(down, 0.42);
      if (rt.hand > 0) this.viewmodel.castRight();
      else this.viewmodel.castLeft();
    } else {
      rt.hand = -rt.hand;
      origin = this.player.pos.clone().addScaledVector(fwd, 2.5).addScaledVector(right, rt.hand * 0.7);
    }
    const dir = aimPoint.clone().sub(origin).normalize();
    this.combat.firePlayerBolt(origin, dir, st.atk * masteryMult(this.state.mastery.bolt), REALMS[this.state.realm].color);
    this.particles.burst(origin, new THREE.Color(REALMS[this.state.realm].color).multiplyScalar(1.5), 4, 10, 0.18, 0.15, 4);
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
      .map((b) => ({ b, d: b.pos.distanceTo(p.pos), ang: tmpV.subVectors(b.pos, p.pos).normalize().angleTo(camFwd) }))
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
    const radius = 110 + s.realm * 15;
    const dmg = this.stats.atk * 3.2 * masteryMult(s.mastery.burst);
    for (const b of [...this.beasts.beasts]) {
      const d = b.pos.distanceTo(p.pos);
      if (d < radius + b.radius) this.hitBeast(b, dmg, b.pos.clone(), 'burst', b.pos.clone().sub(p.pos).normalize().multiplyScalar(220));
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
    this.particles.burst(this.player.pos, new THREE.Color(2, 1.6, 0.5), 50, 30, 1, 0.7);
    this.sound.shield();
  }

  castStorm(damage) {
    const s = this.state, rt = this.rt, T = TECHNIQUES.storm;
    if (s.realm < T.unlockRealm) return this.denied(`Ten Thousand Swords unlocks at the ${REALMS[T.unlockRealm].name} realm.`);
    if (rt.cooldowns.storm > 0) return;
    if (rt.energy < T.cost) return this.denied('Not enough energy.');
    rt.cooldowns.storm = T.cd;
    rt.energy -= T.cost;
    this.swords.storm(this.player.pos, this.beasts.beasts, damage * masteryMult(s.mastery.storm), SWORD_GRADES[s.swordGrade].glow);
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
    if (s.pills[k] <= 0) return this.denied(`No ${PILLS[k].name}s left. Buy more at a station.`);
    s.pills[k]--;
    if (k === 'heal') rt.hp = Math.min(this.stats.maxHp, rt.hp + this.stats.maxHp * 0.6);
    else if (k === 'energy') { rt.energy = this.stats.maxEnergy; rt.spirit = this.stats.maxSpirit; }
    else if (k === 'cult') this.addXp(this.stats.xpNeed / 3);
    this.particles.burst(this.player.pos, new THREE.Color(k === 'heal' ? 0x5dffa8 : k === 'energy' ? 0x3ef2ff : 0xffc857).multiplyScalar(2), 40, 25, 1, 0.8);
    this.sound.pickup();
    this.hud.notify(`Consumed a ${PILLS[k].name} <span class="cn">${PILLS[k].cn}</span>.`, 'green');
  }

  // ----------------------------------------------------------- combat --
  hitBeast(b, dmg, pos, kind, knock) {
    if (!b.alive) return;
    const crit = Math.random() < 0.12;
    const amount = dmg * (crit ? 2 : 1) * (0.9 + Math.random() * 0.2);
    this.hud.damageNumber(pos, fmt(amount), crit ? 'crit' : kind === 'sword' || kind === 'storm' ? 'sword' : '');
    if (kind === 'bolt') this.sound.hit(pos);
    const killed = this.beasts.damage(b, amount, this.time, knock);
    this.hud.hitmarker(killed);
  }

  hurtPlayer(amount, pos, knock, silent = false) {
    const rt = this.rt;
    if (this.mode !== 'playing' || rt.invuln > 0) return;
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
      this.hud.damageNumber(this.player.pos.clone().add(tmpV.set(0, 0, -6).applyQuaternion(this.camera.quaternion)), `-${fmt(amount)}`, 'player');
    }
    if (knock) this.player.vel.add(knock);
    rt.cruise = false;
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
    this.swords.controlling = false;
    this.combat.explosion(this.player.pos, REALMS[s.realm].color, 2.5);
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
    saveState(s);
  }

  respawn() {
    this.rt = this.freshRuntime();
    this.rt.invuln = 3;
    this.mode = 'playing';
    const sys = this.system;
    this.player.placeAt(sys.station ? sys.station.spawn : sys.entryPoint.clone(), sys.station ? sys.station.look : new THREE.Vector3());
    this.camQuat.copy(this.player.quat);
    this.applyCamMode();
    this.swords.setVisible(true);
    this.swords.reset(this.player);
    this.menus.showDeath(false);
    this.particles.converge(this.player.pos, this.player.auraColor.clone().multiplyScalar(2), 120, 30, 30, 1.2);
  }

  onBeastKilled(b) {
    const s = this.state, rt = this.rt;
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
    this.hud.damageNumber(b.pos.clone().add(new THREE.Vector3(0, b.radius, 0)), `+${fmt(xp)} EXP`, 'xp');
    if (b.boss) {
      if (!s.bosses.includes(b.bossIndex)) s.bosses.push(b.bossIndex);
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
    this.applyBounties(progressBounties(s, { kind: 'kill', type: b.type, elite: b.elite, boss: b.boss ? b.bossIndex : undefined }));
    this.addXp(xp);
    if (b.boss) saveState(s);
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
        this.particles.burst(this.player.pos, this.player.auraColor.clone().multiplyScalar(2), 60, 40, 1.2, 1);
        this.sound.stageUp();
        saveState(s);
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
      saveState(s);
    }
  }

  breakthroughStatus() {
    const s = this.state;
    const full = s.stage === 3 && s.xp >= this.stats.xpNeed;
    if (!full || s.realm >= MAX_REALM || this.rt.trib) return { ready: false, blocked: null };
    if (s.realm === MAX_REALM - 1 && !s.bosses.includes(FINAL_BOSS)) return { ready: false, blocked: 'PEAK · SLAY THE PRIMORDIAL DEVOURER TO ASCEND' };
    return { ready: true, blocked: null };
  }

  tryBreakthrough() {
    const bt = this.breakthroughStatus();
    if (bt.blocked) return this.denied(bt.blocked);
    if (!bt.ready) {
      if (!this.rt.trib) this.denied('Reach Peak stage with full experience before breaking through.');
      return;
    }
    this.startTribulation();
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
    clouds.position.copy(this.player.pos).add(new THREE.Vector3(0, 115, 0));
    this.scene.add(clouds);
    rt.trib = { t: 0, dur: 16 + s.realm * 1.2, next: 2.2, interval: Math.max(0.5, 1.35 - s.realm * 0.08), pending: [], clouds, glow };
    rt.meditating = false;
    rt.cruise = false;
    this.hud.banner('WARNING', 'Heavenly Tribulation', '<span class="cn">天劫降临</span>The heavens test you. Keep moving.', '#d8c8ff', 3.5);
    this.sound.thunder();
  }

  updateTribulation(dt) {
    const tr = this.rt.trib, p = this.player, s = this.state;
    tr.t += dt;
    tr.clouds.position.lerp(tmpV.copy(p.pos).add(new THREE.Vector3(0, 115, 0)), 1 - Math.exp(-dt * 2));
    tr.clouds.rotation.y += dt * 0.1;
    tr.glow.material.opacity = Math.max(0, tr.glow.material.opacity - dt * 3);
    if (Math.random() < dt * 1.5) tr.glow.material.opacity = 0.25;
    tr.next -= dt;
    if (tr.next <= 0 && tr.t < tr.dur - 1.3) {
      tr.next = tr.interval * (0.75 + Math.random() * 0.5);
      const radius = 15 + s.realm * 0.8;
      const strike = (pos) => {
        this.combat.warning(pos, radius, 1.15);
        tr.pending.push({ pos, t: 1.15, radius });
      };
      const lead = p.vel.clone().multiplyScalar(0.8 + Math.random() * 0.5);
      strike(p.pos.clone().add(lead).add(new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 16)));
      if (tr.t > tr.dur * 0.45 && Math.random() < 0.55) strike(p.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 70)));
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
      this.combat.lightning(k.pos);
      this.sound.thunder(k.pos);
      tr.glow.material.opacity = 0.4;
      this.post.fx.flash = Math.max(this.post.fx.flash, 0.18);
      if (this.mode === 'playing' && p.pos.distanceTo(k.pos) < k.radius + p.radius) {
        this.hurtPlayer(this.stats.maxHp * 0.2, k.pos, p.pos.clone().sub(k.pos).normalize().multiplyScalar(120));
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
    const tr = this.rt.trib;
    if (!tr) return;
    this.scene.remove(tr.clouds);
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
    this.combat.shockwave(this.player.pos, 280, realm.color, 1.4);
    this.particles.burst(this.player.pos, new THREE.Color(realm.color).multiplyScalar(1.6), 160, 140, 1.4, 1.6, 1);
    for (const b of [...this.beasts.beasts]) {
      if (b.pos.distanceTo(this.player.pos) < 280 + b.radius) this.hitBeast(b, this.stats.atk * 5, b.pos.clone(), 'burst');
    }
    this.sound.breakthrough();
    rt.shake = 1.2;
    this.post.fx.flash = 0.7;
    this.hud.banner('BREAKTHROUGH', realm.name, `<span class="cn">${realm.cn}</span>${esc(realm.blurb)}`, hex(realm.color), 5);
    if (this.stats.swords > derive({ ...s, realm: s.realm - 1 }).swords) setTimeout(() => this.hud.notify(`A new flying sword answers your call. You now command <b>${this.stats.swords}</b>.`, 'violet'), 2000);
    for (const t of Object.values(TECHNIQUES)) {
      if (t.unlockRealm === s.realm) setTimeout(() => this.hud.notify(`New technique: <b>${t.name}</b> <span class="cn">${t.cn}</span>. Press <kbd>${t.key}</kbd>.`, 'violet'), 3000);
    }
    GALAXIES.forEach((g, i) => {
      if (i > 0 && g.reqRealm === s.realm) setTimeout(() => this.hud.notify(`You are strong enough to enter the <b>${g.name}</b>. Travel there through a Universe Gate.`, 'violet'), 4000);
    });
    if (s.realm === MAX_REALM && !s.won) {
      s.won = true;
      setTimeout(() => this.hud.banner('ASCENDED', 'Universe Master', '<span class="cn">宇宙之主</span>You stand at the summit of the cosmos.', '#fff0b8', 8), 5200);
    }
    saveState(s);
  }

  // ------------------------------------------------------ interaction --
  updateInteraction(dt, alive) {
    const p = this.player, rt = this.rt, inp = this.input;
    this.interact = null;
    if (alive) {
      let bd = Infinity;
      for (const it of this.system.interactables()) {
        const d = p.pos.distanceTo(it.pos);
        if (d < it.range && d < bd) { bd = d; this.interact = it; }
      }
    }
    const it = this.interact;
    let progress = 0;
    if (it && it.kind === 'planet' && !this.state.explored.includes(it.planet.id) && inp.down('KeyE')) {
      rt.scanT += dt;
      progress = rt.scanT / SCAN_TIME;
      this.sound.scanTick();
      if (Math.random() < 0.6) {
        const from = it.pos.clone().add(tmpV.subVectors(p.pos, it.pos).normalize().multiplyScalar(it.planet.radius));
        const v = p.pos.clone().sub(from);
        const life = 0.5;
        this.particles.emit(from.x, from.y, from.z, v.x / life, v.y / life, v.z / life, new THREE.Color(0.4, 1.6, 2), 1.2, life, 0);
      }
      if (rt.scanT >= SCAN_TIME) {
        rt.scanT = 0;
        this.explorePlanet(it.planet);
      }
    } else {
      rt.scanT = 0;
      if (it && inp.pressed.has('KeyE')) this.doInteract(it);
    }
    this.hud.setPrompt(this.promptText(it), progress);
  }

  promptText(it) {
    if (!it) return null;
    if (it.kind === 'station') return `<kbd>E</kbd> DOCK AT ${esc(it.name.toUpperCase())}`;
    if (it.kind === 'gate') return '<kbd>E</kbd> ACTIVATE UNIVERSE GATE';
    const pl = it.planet;
    if (this.state.explored.includes(pl.id)) return `${esc(pl.name.toUpperCase())} · ALREADY SURVEYED`;
    return `HOLD <kbd>E</kbd> ${pl.ruin ? 'SEARCH THE RUINS OF' : 'SCAN'} ${esc(pl.name.toUpperCase())}`;
  }

  doInteract(it) {
    if (it.kind === 'station') {
      this.rt.hp = this.stats.maxHp;
      this.rt.energy = this.stats.maxEnergy;
      this.rt.spirit = this.stats.maxSpirit;
      if (this.state.offers.length < 3) this.state.offers.push(...generateOffers(this.state, 3 - this.state.offers.length));
      this.menus.openPanel('shop');
      this.input.unlock();
      this.sound.confirm();
      saveState(this.state);
    } else if (it.kind === 'gate') {
      this.menus.openPanel('map', 'universe');
      this.input.unlock();
      this.sound.ui();
    }
  }

  explorePlanet(pl) {
    const s = this.state;
    s.explored.push(pl.id);
    this.applyBounties(progressBounties(s, { kind: 'explore' }));
    const tier = this.systemDef.tier;
    const crystals = () => 45 * xpScale(tier) * (1 + Math.random() * 1.5);
    const name = `<b>${esc(pl.name)}</b>`;
    this.sound.reward();
    this.particles.converge(this.player.pos, new THREE.Color(0xffe08a).multiplyScalar(2), 60, 30, 40, 1);
    if (pl.ruin) {
      const xp = crystals() * 3;
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
      this.hud.notify(`Ancient energy flows from the ruins of ${name}: +${fmt(xp)} experience.`, 'gold');
      this.addXp(xp);
      s.essence += essenceFor(tier) * 10;
      saveState(s);
      return;
    }
    const roll = Math.random();
    if (roll < 0.3) {
      const xp = crystals();
      this.hud.notify(`Energy crystals on ${name}: +${fmt(xp)} experience.`, 'gold');
      this.addXp(xp);
    } else if (roll < 0.5) {
      const c = Math.round(25 * Math.pow(2.2, tier) * (1 + Math.random()));
      s.coins += c;
      this.hud.notify(`A lost cache on ${name}: +${fmt(c)} star coins.`, 'gold');
    } else if (roll < 0.62) {
      const e = essenceFor(tier) * (6 + Math.floor(Math.random() * 8));
      s.essence += e;
      this.hud.notify(`A fossilized beast core on ${name}: +${fmt(e)} essence.`, 'green');
    } else if (roll < 0.76) {
      const r = Math.random();
      const k = r < 0.45 ? 'heal' : r < 0.8 ? 'energy' : 'cult';
      const n = 1 + Math.floor(Math.random() * 2);
      s.pills[k] += n;
      this.hud.notify(`Medicinal herbs on ${name}: +${n} ${PILLS[k].name}.`, 'green');
    } else if (roll < 0.85) {
      const k = this.randomUpgradableTech();
      if (k) {
        s.mastery[k]++;
        this.hud.notify(`A technique manual lies buried on ${name}. <b>${TECHNIQUES[k].name}</b> mastery rises to ${s.mastery[k]}.`, 'violet');
      } else {
        const c = Math.round(40 * Math.pow(2.2, tier));
        s.coins += c;
        this.hud.notify(`Relics on ${name}: +${fmt(c)} star coins.`, 'gold');
      }
    } else {
      const center = pl.worldPos.clone().add(this.player.pos.clone().sub(pl.worldPos).normalize().multiplyScalar(pl.radius + 40));
      const type = tier >= 1 && Math.random() < 0.5 ? 'ray' : 'mite';
      this.beasts.spawnGroup(type, center, type === 'ray' ? 3 : 6, tier, true);
      this.hud.notify(`You disturbed a beast nest on ${name}!`, 'red');
      this.addXp(crystals() * 0.4);
    }
    saveState(s);
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
    saveState(s);
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
    saveState(s);
  }

  refine(frac) {
    const s = this.state;
    const amount = Math.floor(s.essence * frac);
    if (amount <= 0) return;
    s.essence -= amount;
    this.addXp(amount);
    this.sound.stageUp();
    this.hud.notify(`Refined ${fmt(amount)} essence into experience.`, 'gold');
    saveState(s);
  }

  acceptBounty(id) {
    const s = this.state;
    if (s.bounties.length >= MAX_BOUNTIES) return this.sound.deny();
    const i = s.offers.findIndex((b) => b.id === id);
    if (i < 0) return;
    s.bounties.push(s.offers[i]);
    s.offers.splice(i, 1);
    this.sound.confirm();
    saveState(s);
  }

  abandonBounty(id) {
    const s = this.state;
    s.bounties = s.bounties.filter((b) => b.id !== id);
    this.sound.ui();
    saveState(s);
  }

  // ------------------------------------------------------- navigation --
  setCourse() {
    const rt = this.rt;
    const candidates = this.markerList.map((m) => ({ key: m.key, label: m.label, pos: m.pos, kind: m.kind, planet: m.planet }));
    const boss = this.beasts.liveBoss;
    if (boss) candidates.push({ key: 'boss', label: boss.name, pos: boss.pos, kind: 'boss' });
    let best = null, bd = 0.22;
    for (const c of candidates) {
      tmpV.copy(c.pos).applyMatrix4(this.camera.matrixWorldInverse);
      if (tmpV.z > 0) continue;
      tmpV.copy(c.pos).project(this.camera);
      const d = Math.hypot(tmpV.x * this.camera.aspect, tmpV.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best || (rt.nav && rt.nav.key === best.key)) {
      if (rt.nav) {
        rt.nav = null;
        rt.cruise = false;
        this.hud.notify('Course cleared.');
      } else {
        this.denied('Look toward a marker and press T to set a course.');
      }
      return;
    }
    const surface = best.kind === 'planet' ? best.planet.radius : best.kind === 'star' ? this.system.starRadius : 0;
    const arrive = best.kind === 'planet' ? best.planet.radius + 60 : best.kind === 'star' ? this.system.starRadius + 600 : best.kind === 'gate' ? 160 : best.kind === 'boss' ? 380 : best.kind === 'hotspot' ? 40 : best.kind === 'station' ? 160 : 90;
    rt.nav = { key: best.key, label: best.label, pos: best.pos, arrive, surface };
    this.hud.notify(`Course set: <b>${esc(best.label)}</b>. Press <kbd>G</kbd> to cruise.`, 'yl');
    this.sound.lock();
  }

  toggleCruise() {
    const rt = this.rt;
    if (rt.cruise) { rt.cruise = false; return; }
    if (!rt.nav) return this.denied('Set a course first: look at a marker and press T.');
    rt.cruise = true;
    rt.meditating = false;
  }

  canWarpTo(gi, si) {
    if (this.rt.trib) return { ok: false, reason: 'You cannot warp during a tribulation.' };
    const def = getGalaxySystems(gi)[si];
    if (def.tier > this.state.realm + 1.01) return { ok: false, reason: `Too dangerous. Reach the ${realmOf(def.tier - 1).name} realm first.` };
    return { ok: true };
  }

  canTravelGalaxy(gi) {
    const g = GALAXIES[gi];
    if (gi === this.state.galaxy) return { ok: false, reason: 'You are already here.' };
    if (this.state.realm < g.reqRealm) return { ok: false, reason: `Requires ${REALMS[g.reqRealm].name} realm` };
    if (!this.atGate) return { ok: false, reason: 'Fly to a Universe Gate first' };
    if (this.rt.trib) return { ok: false, reason: 'Not during a tribulation' };
    return { ok: true };
  }

  requestWarp(gi, si) {
    const check = gi === this.state.galaxy ? this.canWarpTo(gi, si) : this.canTravelGalaxy(gi);
    if (!check.ok) return this.sound.deny();
    this.menus.closePanel();
    this.input.lock();
    this.startWarp(gi, si);
  }

  startWarp(gi, si) {
    this.mode = 'warping';
    this.warp = { t: 0, t2: 0, gi, si, sys: null, swapped: false, failed: false };
    this.rt.meditating = false;
    this.rt.cruise = false;
    this.rt.controlling = false;
    this.swords.controlling = false;
    this.warpLines.visible = true;
    this.sound.warp();
    this.hud.setPrompt(null);
    this.hud.alert(null);
    this.buildSystem(gi, si).then((sys) => { this.warp.sys = sys; }).catch((err) => {
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
      } else if (w.t >= 1.2 && w.sys) {
        w.swapped = true;
        const galaxyChanged = w.gi !== this.state.galaxy;
        this.state.galaxy = w.gi;
        this.state.system = w.si;
        this.installSystem(w.sys, w.gi, w.si);
        saveState(this.state);
        const def = this.systemDef;
        const g = GALAXIES[w.gi];
        if (galaxyChanged) this.hud.banner('GALAXY JUMP', g.name, `<span class="cn">${g.cn}</span>${esc(def.name)} system`, g.sky[3], 4);
        else this.hud.banner('WARP COMPLETE', def.name, `${esc(realmOf(def.tier).name)}-level threat${def.boss !== null && !this.state.bosses.includes(def.boss) ? ` · ${esc(BOSSES[def.boss].name)} lurks here` : ''}`, '#e8f4ff', 3);
        this.sound.arrive();
        this.clock.getDelta();
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
    if (!w.swapped) p.pos.addScaledVector(p.forward(), (300 + inten * 1500) * dt);
    p.root.position.copy(p.pos);
    this.updateCamera(dt);
    this.system.update(dt, this.camera);
    this.particles.update(dt);
    this.dust.update(this.camera.position, p.vel, inten);
    this.viewmodel.update(dt, { mouseX: 0, mouseY: 0, speed: 600, boost: true, meditating: false, controlling: false, energyFrac: 1, sunDirView: tmpV.set(0, 1, 0), sunColor: new THREE.Color(1, 1, 1) });
    this.post.fx.speed = settings.get('speedBlur') ? inten : 0;
    this.post.fx.damage = 0;
    this.post.fx.flash = 0;
    if (w.swapped && w.t2 >= 1.1) {
      this.mode = 'playing';
      this.warpLines.visible = false;
      document.getElementById('fade').style.opacity = 0;
      this.camera.fov = settings.get('fov');
      this.camera.updateProjectionMatrix();
      this.particles.setScale(this.height * this.pixelRatio(), this.camera.fov);
      if (!this.input.locked && !this.menus.overlayOpen) this.menus.showPause(true);
    }
  }

  // ----------------------------------------------------- presentation --
  updatePresentation(dt, camFwd, density, medRate, aimBeast) {
    const s = this.state, rt = this.rt, p = this.player;
    const fx = this.post.fx;
    fx.damage = Math.max(0, fx.damage - dt * 2.2);
    fx.flash = Math.max(0, fx.flash - dt * 1.6);
    const hpFrac = rt.hp / this.stats.maxHp;
    fx.glitch = this.mode === 'playing' && hpFrac < 0.3 ? (0.3 - hpFrac) / 0.3 * 0.8 : 0;
    fx.tintAmt += ((rt.trib ? 0.55 : 0) - fx.tintAmt) * Math.min(1, dt * 3);
    const speed = p.vel.length();
    fx.speed = p.boosting || rt.cruise ? Math.min(1, speed / (this.stats.speed * 2.7)) * 0.85 : 0;

    // first-person arms
    const sunDirView = tmpV.copy(p.pos).negate().normalize().transformDirection(this.camera.matrixWorldInverse).clone();
    this.viewmodel.update(dt, {
      mouseX: this.lastMouse.x, mouseY: this.lastMouse.y, speed, boost: p.boosting && !rt.controlling, meditating: rt.meditating,
      controlling: rt.controlling, energyFrac: rt.energy / this.stats.maxEnergy, sunDirView, sunColor: this.system.sunColor,
    });
    this.viewmodel.updateThread(dt, this.camera, this.swords.controlPoint, rt.controlling && this.camMode === 'first', this.time);

    this.flare.update(this.camera, this.system.colliders[0].pos, this.system.starRadius, this.system.colliders, dt);
    const aggro = this.beasts.aggroCount();
    this.sound.setIntensity(Math.min(1, aggro / 5), !!rt.trib);
    this.sound.updateLoops({ swordSpeed: this.swords.avgSpeed, boost: p.boosting ? 1 : 0, speed });

    this.updateMarkers();
    const target = rt.lock || this.aimTarget;
    this.hud.placeLock(rt.lock, this.camera, this.width, this.height);
    this.hud.placeCtrl(this.swords.controlPoint, this.camera, this.width, this.height, rt.controlling, this.time);
    this.hud.updateDamageNumbers(dt, this.camera, this.width, this.height);
    const compass = [];
    const radar = [];
    const bearing = (pos) => Math.atan2(-(pos.x - p.pos.x), -(pos.z - p.pos.z));
    if (this.system.station) {
      compass.push({ bearing: bearing(this.system.station.pos), color: '#3ef2ff' });
      radar.push({ pos: this.system.station.pos, color: '#3ef2ff', size: 5, shape: 'diamond', edge: true });
    }
    if (this.system.gate) {
      compass.push({ bearing: bearing(this.system.gate.pos), color: '#b98cff' });
      radar.push({ pos: this.system.gate.pos, color: '#b98cff', size: 5, shape: 'diamond', edge: true });
    }
    if (rt.nav) {
      compass.push({ bearing: bearing(rt.nav.pos), color: '#ffe44d' });
      radar.push({ pos: rt.nav.pos, color: '#ffe44d', size: 5, shape: 'diamond', edge: true });
    }
    for (const pl of this.system.planets) radar.push({ pos: pl.worldPos, color: '#6f9cff', size: 4, shape: 'diamond' });
    for (const b of this.beasts.beasts) {
      if (b.boss) {
        compass.push({ bearing: bearing(b.pos), color: '#ff3c7d' });
        radar.push({ pos: b.pos, color: '#ff3c7d', size: 7, shape: 'diamond', edge: true });
      } else {
        radar.push({ pos: b.pos, color: b.elite ? '#ffe44d' : b.aggro ? '#ff4466' : '#ff8aa4', size: b === rt.lock ? 5 : 3 });
      }
    }
    for (const it of this.loot.items) radar.push({ pos: it.g.position, color: '#ff3c7d', size: 2 });
    this.hud.drawCompass(p.yaw, compass);
    this.hud.drawRadar(dt, p, radar, 1500);
    this.hud.update(dt, {
      state: s, stats: this.stats, rt, systemDef: this.systemDef, density, medRate, bt: this.breakthroughStatus(),
      boss: this.beasts.liveBoss, target, locked: !!rt.lock && target === rt.lock, targetDist: target ? target.pos.distanceTo(p.pos) : 0,
      nav: rt.nav, navDist: rt.nav ? Math.max(0, p.pos.distanceTo(rt.nav.pos) - rt.nav.surface) : 0, cruise: rt.cruise,
      swordStates: this.swords.states(), formation: this.swords.formation, controlRange: 260 + 50 * s.realm, speed,
      controlling: rt.controlling, firing: rt.firingT > 0, aimTarget: this.aimTarget, camMode: this.camMode, fps: this.fps, renderScale: this.dynScale * settings.get('renderScale'),
    });
  }

  updateMarkers() {
    const p = this.player, s = this.state, rt = this.rt;
    const list = [];
    for (const m of this.markerList) {
      const dist = p.pos.distanceTo(m.pos);
      if (m.kind === 'hotspot' && dist > 2600) continue;
      let label = esc(m.label);
      let sub;
      if (m.kind === 'planet') {
        const pl = m.planet;
        const explored = s.explored.includes(pl.id);
        if (pl.ruin && !explored) label += ' <span style="color:#ffc857">◈ RUINS</span>';
        if (explored) label += ' <span style="color:#5dffa8">✓</span>';
        const surf = Math.max(0, dist - pl.radius);
        sub = surf >= 1000 ? `${(surf / 1000).toFixed(1)}K` : `${Math.round(surf)}`;
      } else if (m.kind === 'star') {
        sub = `${((dist - this.system.starRadius) / 1000).toFixed(1)}K`;
      }
      const nav = rt.nav && rt.nav.key === m.key;
      list.push({ key: m.key, kind: m.kind, label, sub, pos: m.pos, dist, edge: m.kind === 'station' || m.kind === 'gate' || nav, nav });
    }
    const boss = this.beasts.liveBoss;
    if (boss) list.push({ key: 'boss', kind: 'boss', label: esc(boss.name), pos: boss.pos, dist: p.pos.distanceTo(boss.pos), edge: true, nav: rt.nav && rt.nav.key === 'boss', hp: boss.hp / boss.maxHp });
    if (this.mode === 'playing') {
      const near = [];
      for (const b of this.beasts.beasts) {
        if (b.boss) continue;
        const d = b.pos.distanceTo(p.pos);
        if (d < 650 || this.time - b.lastHit < 4 || b === this.aimTarget || b === rt.lock) near.push([d, b]);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (const [d, b] of near.slice(0, 12)) {
        if (!b.markPos) b.markPos = new THREE.Vector3();
        b.markPos.copy(b.pos).y += b.radius + 3;
        const rcls = b.tier - s.realm > 1.01 ? '#ff4466' : b.tier - s.realm > 0.25 ? '#ffe44d' : '#ff9aac';
        const focus = b === this.aimTarget || b === rt.lock || this.time - b.lastHit < 2.5 || d < 110;
        list.push({ key: `b:${b.uid}`, kind: 'beast', label: focus ? `<span style="color:${rcls}">${esc(b.name)}</span>` : '', sub: focus ? `${realmOf(b.tier).name.toUpperCase()} · ${Math.round(d)}` : '', pos: b.markPos, dist: d, edge: false, hp: b.hp / b.maxHp });
      }
    }
    this.hud.updateMarkers(list, this.camera, this.width, this.height);
  }
}
