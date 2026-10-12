import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  REALMS, STAGES, MAX_REALM, TECHNIQUES, ACTIVE_TECHNIQUES, PILLS, GALAXIES, BOSSES, FINAL_BOSS,
  getGalaxySystems, xpScale, masteryMult, priceFor, MANUAL_PRICE, realmOf,
} from './data.js';
import { newState, loadState, saveState, clearSave, derive } from './state.js';
import { Sky } from './sky.js';
import { StarSystem } from './system.js';
import { Particles } from './particles.js';
import { Combat } from './combat.js';
import { BeastManager } from './beasts.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { UI, fmt } from './ui.js';
import { puffTexture, glowTexture } from './textures.js';
import { clamp } from './rng.js';

const BASE_FOV = 68;
const tmpV = new THREE.Vector3();
const tmpW = new THREE.Vector3();
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const hexStr = (n) => `#${n.toString(16).padStart(6, '0')}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 1, 60000);
    this.scene.add(this.camera);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.85, 0.55, 0.7);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.scene.add(new THREE.AmbientLight(0x8090c0, 0.6));
    this.scene.add(new THREE.HemisphereLight(0x8899ff, 0x221a10, 0.4));

    this.sky = new Sky(this.scene);
    this.particles = new Particles(this.scene);
    this.sound = new Sound();
    this.combat = new Combat(this.scene, this.particles, this.sound);
    this.beasts = new BeastManager(this.scene, this.particles, this.combat, this.sound);
    this.beasts.onKill = (b) => this.onBeastKilled(b);
    this.player = new Player(this.scene, this.particles);
    this.input = new Input(canvas);
    this.ui = new UI(this);
    this.buildWarpLines();

    this.loaded = loadState();
    this.hasSave = !!this.loaded;
    this.state = this.loaded || newState();
    this.stats = derive(this.state);
    this.rt = this.freshRuntime();
    this.mode = 'title';
    this.camQuat = new THREE.Quaternion();
    this.zoom = 1;
    this.time = 0;
    this.saveTimer = 0;
    this.titleAngle = 0;
    this.uidSeq = 0;
    this.skyGalaxy = -1;
    this.interact = null;
    this.aimTarget = null;
    this.notifyGate = {};

    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onKey = (code) => this.onKey(code);
    canvas.addEventListener('click', () => {
      if (this.mode === 'playing' && !this.input.locked && !this.ui.panelOpen) this.resume();
    });
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode !== 'title') saveState(this.state);
    });
    window.addEventListener('beforeunload', () => {
      if (this.mode !== 'title') saveState(this.state);
    });
    this.resize();

    this.loadSystem(this.state.galaxy, this.state.system);
    this.player.setRealm(this.state.realm);
    this.player.setVisible(false);
    this.ui.showTitle(true, this.hasSave);
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  freshRuntime() {
    return {
      hp: this.stats.maxHp,
      energy: this.stats.maxEnergy,
      cooldowns: { bolt: 0, swords: 0, burst: 0, body: 0 },
      shieldT: 0,
      meditating: false,
      medBlock: 0,
      hurtFlash: 0,
      lastHurt: -99,
      trib: null,
      deadT: 0,
      invuln: 0,
      nav: null,
      cruise: false,
      shake: 0,
      hand: 1,
      burnNotify: 0,
    };
  }

  // ------------------------------------------------------------ setup --
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.setScale(h * this.pixelRatio, this.camera.fov);
  }

  buildWarpLines() {
    const n = 500;
    const pos = new Float32Array(n * 6);
    this.warpData = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 90;
      this.warpData.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: -20 - Math.random() * 700 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.warpLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(2.2, 2.4, 3.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.warpLines.frustumCulled = false;
    this.warpLines.visible = false;
    this.camera.add(this.warpLines);
  }

  loadSystem(gi, si) {
    if (this.system) this.system.dispose();
    this.combat.clearShots();
    this.particles.clear();
    this.systemDef = getGalaxySystems(gi)[si];
    this.system = new StarSystem(this.scene, this.systemDef);
    if (this.skyGalaxy !== gi) {
      this.sky.setGalaxy(gi);
      this.skyGalaxy = gi;
    }
    this.sound.setDrone(GALAXIES[gi].drone);
    this.ui.clearMarkers();
    const spawn = this.system.station ? this.system.station.pos.clone().add(new THREE.Vector3(0, 30, 160)) : this.system.entryPoint;
    this.player.placeAt(spawn, new THREE.Vector3(0, 0, 0));
    this.camQuat.copy(this.player.quat);
    this.beasts.setSystem(this.system, this.systemDef, this.state.bosses.includes(this.systemDef.boss), spawn);
    this.markerList = this.system.markers();
    this.rt.nav = null;
    this.rt.cruise = false;
  }

  // ------------------------------------------------------- lifecycle --
  newGame() {
    clearSave();
    this.state = newState();
    this.hasSave = false;
    this.stats = derive(this.state);
    this.rt = this.freshRuntime();
    this.player.setRealm(0);
    this.loadSystem(0, 0);
    this.startPlaying();
    saveState(this.state);
    this.hasSave = true;
  }

  continueGame() {
    this.state = this.loaded || this.state;
    this.stats = derive(this.state);
    this.rt = this.freshRuntime();
    this.player.setRealm(this.state.realm);
    this.loadSystem(this.state.galaxy, this.state.system);
    this.startPlaying();
  }

  startPlaying() {
    this.mode = 'playing';
    this.ui.showTitle(false);
    this.ui.showHUD(true);
    this.player.setVisible(true);
    this.sound.init();
    this.sound.setDrone(GALAXIES[this.state.galaxy].drone);
    this.input.lock();
    this.camera.fov = BASE_FOV;
    if (!this.state.hintsShown) {
      this.state.hintsShown = true;
      const tips = [
        ['Welcome to the <b>Solace</b> system, young Warrior. Your ascension begins at the Martial Hall Station.', 'gold'],
        ['Hold <kbd>C</kbd> to cultivate. Cosmic energy is richest near the star and inside glowing nebulae.', ''],
        ['Click to fire Star Bolts at cosmic beasts. They drop experience and star coins.', ''],
        ['Fly to a planet and press <kbd>E</kbd> to explore it. <kbd>T</kbd> sets a course, <kbd>G</kbd> cruises there.', ''],
        ['Open the star map with <kbd>M</kbd>. Press <kbd>H</kbd> for the full guide.', 'violet'],
      ];
      tips.forEach(([t, k], i) => setTimeout(() => this.ui.notify(t, k), 600 + i * 2600));
    } else {
      this.ui.notify(`Returned to the <b>${esc(this.systemDef.name)}</b> system.`, 'gold');
    }
  }

  resume() {
    this.ui.showPause(false);
    this.sound.init();
    this.input.lock();
  }

  resetSave() {
    clearSave();
    window.location.reload();
  }

  onLockChange(locked) {
    if (locked) {
      this.ui.showPause(false);
    } else if ((this.mode === 'playing' || this.mode === 'warping') && !this.ui.panelOpen) {
      this.ui.showPause(true);
      saveState(this.state);
    }
  }

  onKey(code) {
    if (this.mode !== 'playing') return;
    if (code === 'KeyM') this.togglePanel('map', 'galaxy');
    else if (code === 'KeyK') this.togglePanel('cultivation');
    else if (code === 'KeyH') this.togglePanel('help');
    else if (code === 'Escape' && this.ui.panelOpen) this.closePanel();
    else if (code === 'KeyN') {
      const muted = this.sound.toggleMute();
      this.ui.notify(muted ? 'Sound muted.' : 'Sound on.');
    }
  }

  togglePanel(kind, tab) {
    if (this.ui.panelKind === kind && (!tab || this.ui.panelTab === tab)) {
      this.closePanel();
      return;
    }
    this.ui.openPanel(kind, tab);
    this.input.unlock();
    this.sound.ui();
  }

  closePanel() {
    this.ui.closePanel();
    if (this.mode !== 'playing' && this.mode !== 'warping') return;
    this.input.lock();
    setTimeout(() => {
      if (!this.input.locked && !this.ui.panelOpen && (this.mode === 'playing' || this.mode === 'warping')) this.ui.showPause(true);
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
    if (this.mode === 'title') {
      this.updateTitle(dt);
    } else if (this.mode === 'warping') {
      this.updateWarp(dt);
    } else {
      const paused = this.ui.panelOpen || (!this.input.locked && this.mode === 'playing');
      if (!paused) {
        this.update(dt);
        this.state.playtime += dt;
      } else {
        this.input.consumeMouse();
      }
    }
    this.sky.update(this.camera, this.time, this.pixelRatio);
    this.composer.render();
    this.input.endFrame();
  }

  updateTitle(dt) {
    this.titleAngle += dt * 0.025;
    const R = this.system.starRadius;
    const D = R + 2300;
    this.camera.position.set(Math.cos(this.titleAngle) * D, 650 + Math.sin(this.titleAngle * 2) * 80, Math.sin(this.titleAngle) * D);
    this.camera.lookAt(0, 0, 0);
    this.system.update(dt);
    this.particles.update(dt);
  }

  // ----------------------------------------------------------- update --
  update(dt) {
    const s = this.state, rt = this.rt, p = this.player, inp = this.input;
    const alive = this.mode === 'playing';
    let st = this.stats;

    // ---- input
    const mouse = inp.consumeMouse();
    const sens = 0.0021;
    const look = { x: mouse.x * sens, y: mouse.y * sens };
    if (inp.wheel) this.zoom = clamp(this.zoom + inp.wheel * 0.12, 0.55, 2.6);
    const move = { x: 0, y: 0, z: 0 };
    if (alive) {
      if (inp.down('KeyW') || inp.down('ArrowUp')) move.z += 1;
      if (inp.down('KeyS') || inp.down('ArrowDown')) move.z -= 1;
      if (inp.down('KeyD') || inp.down('ArrowRight')) move.x += 1;
      if (inp.down('KeyA') || inp.down('ArrowLeft')) move.x -= 1;
      if (inp.down('Space')) move.y += 1;
      if (inp.down('KeyX')) move.y -= 1;
    }
    const manual = move.x !== 0 || move.y !== 0 || move.z !== 0;
    rt.medBlock = Math.max(0, rt.medBlock - dt);
    rt.meditating = alive && inp.down('KeyC') && !manual && !rt.trib && rt.medBlock <= 0;

    // ---- cruise autopilot
    let speedMult = 1;
    let boost = alive && (inp.down('ShiftLeft') || inp.down('ShiftRight')) && rt.energy > 1 && manual;
    if (rt.cruise) {
      if (!alive || manual || !rt.nav || rt.meditating) {
        rt.cruise = false;
      } else {
        const target = this.cruiseWaypoint(rt.nav.pos);
        const dir = tmpV.subVectors(target, p.pos).normalize();
        const yaw = Math.atan2(-dir.x, -dir.z);
        const pitch = Math.asin(clamp(dir.y, -1, 1));
        const k = 1 - Math.exp(-dt * 3.5);
        p.yaw += wrapAngle(yaw - p.yaw) * k;
        p.pitch += (pitch - p.pitch) * k;
        look.x *= 0.15;
        look.y *= 0.15;
        move.z = 1;
        boost = true;
        speedMult = 1.45;
        const dist = p.pos.distanceTo(rt.nav.pos);
        if (dist < rt.nav.arrive + Math.max(40, p.vel.length() * 0.6)) {
          rt.cruise = false;
          this.ui.notify(`Arrived at <b>${rt.nav.label}</b>.`, 'gold');
        }
      }
    }
    if (boost && !rt.cruise) rt.energy = Math.max(0, rt.energy - 9 * dt);

    p.update(dt, move, look, { speed: st.speed * speedMult, boost, meditating: rt.meditating, time: this.time, shield: rt.shieldT > 0, hidden: !alive });
    if (alive) {
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
          this.ui.notify('The star’s corona scorches you. Pull back!', 'red');
        }
      }
      const limit = this.system.outerOrbit + 2600;
      if (ds > limit) {
        p.vel.addScaledVector(tmpV.copy(p.pos).normalize(), -(ds - limit) * 2 * dt - 60 * dt);
        if (this.time > (this.notifyGate.edge || 0)) {
          this.notifyGate.edge = this.time + 6;
          this.ui.notify('You reach the edge of the system. Use the star map (M) to warp elsewhere.', 'violet');
        }
      }
    }
    this.updateCamera(dt);

    // ---- aim
    const camFwd = tmpW.set(0, 0, -1).applyQuaternion(this.camera.quaternion).clone();
    this.aimTarget = null;
    let bestAlong = Infinity;
    for (const b of this.beasts.beasts) {
      const to = tmpV.subVectors(b.pos, this.camera.position);
      const along = to.dot(camFwd);
      if (along < 0 || along > 1700) continue;
      const perp = Math.sqrt(Math.max(0, to.lengthSq() - along * along));
      if (perp < b.radius + along * 0.04 && along < bestAlong) {
        bestAlong = along;
        this.aimTarget = b;
      }
    }
    let aimPoint;
    if (this.aimTarget) {
      const b = this.aimTarget;
      const t = b.pos.distanceTo(p.pos) / 640;
      aimPoint = b.pos.clone().addScaledVector(b.vel, t);
    } else {
      aimPoint = this.camera.position.clone().addScaledVector(camFwd, 1500);
    }

    // ---- techniques
    for (const k of ACTIVE_TECHNIQUES) rt.cooldowns[k] = Math.max(0, rt.cooldowns[k] - dt);
    rt.shieldT = Math.max(0, rt.shieldT - dt);
    rt.invuln = Math.max(0, rt.invuln - dt);
    if (alive && !rt.meditating) {
      const T = TECHNIQUES;
      if (inp.mouseDown && rt.cooldowns.bolt <= 0 && rt.energy >= T.bolt.cost) {
        rt.cooldowns.bolt = T.bolt.cd;
        rt.energy -= T.bolt.cost;
        rt.hand = -rt.hand;
        const right = tmpV.set(1, 0, 0).applyQuaternion(p.quat);
        const origin = p.pos.clone().addScaledVector(p.forward(), 2.5).addScaledVector(right, rt.hand * 0.7);
        const dir = aimPoint.clone().sub(origin).normalize();
        this.combat.firePlayerBolt(origin, dir, st.atk * masteryMult(s.mastery.bolt), REALMS[s.realm].color);
        this.sound.shot();
      }
      if (inp.pressed.has('KeyQ')) this.castSwords(camFwd);
      if (inp.pressed.has('KeyR')) this.castBurst();
      if (inp.pressed.has('KeyF')) this.castBody();
      if (inp.pressed.has('Digit1')) this.usePill('heal');
      if (inp.pressed.has('Digit2')) this.usePill('energy');
      if (inp.pressed.has('Digit3')) this.usePill('cult');
    }
    if (alive) {
      if (inp.pressed.has('KeyE')) this.doInteract();
      if (inp.pressed.has('KeyB')) this.tryBreakthrough();
      if (inp.pressed.has('KeyT')) this.setCourse();
      if (inp.pressed.has('KeyG')) this.toggleCruise();
    }

    // ---- regeneration & cultivation
    const density = this.system.densityAt(p.pos);
    const medRate = 1.0 * xpScale(this.systemDef.tier) * density * (s.devour ? 1.5 : 1);
    if (alive) {
      if (!boost) rt.energy = Math.min(st.maxEnergy, rt.energy + st.regen * dt * (rt.meditating ? 2.2 : 1));
      if (this.time - rt.lastHurt > 6) rt.hp = Math.min(st.maxHp, rt.hp + st.maxHp * 0.012 * dt);
      if (rt.meditating) {
        rt.hp = Math.min(st.maxHp, rt.hp + st.maxHp * 0.035 * dt);
        this.addXp(medRate * dt);
        st = this.stats;
        const ga = GALAXIES[s.galaxy];
        const c = new THREE.Color(Math.random() < 0.5 ? ga.sky[0] : ga.sky[1]).lerp(p.auraColor, 0.4).multiplyScalar(1.6);
        this.particles.converge(p.pos, c, Math.round(1 + density * 1.3), 26 + density * 5, 38, 1.1);
      }
    }
    rt.hurtFlash = Math.max(0, rt.hurtFlash - dt);

    // ---- world
    const ctx = {
      player: p,
      playerAlive: alive && rt.invuln <= 0,
      time: this.time,
      hurtPlayer: (dmg, pos, knock) => this.hurtPlayer(dmg, pos, knock),
    };
    this.beasts.update(dt, ctx);
    this.combat.update(dt, {
      beasts: this.beasts.beasts,
      player: p,
      playerAlive: alive && rt.invuln <= 0,
      system: this.system,
      hitBeast: (b, dmg, pos, kind) => this.hitBeast(b, dmg, pos, kind),
      hurtPlayer: (dmg, pos) => this.hurtPlayer(dmg, pos),
    });
    this.system.update(dt);
    this.particles.update(dt);
    if (rt.trib) this.updateTribulation(dt);

    if (this.mode === 'dead') {
      rt.deadT -= dt;
      this.ui.setDeathCount(`Reforming your body in ${Math.max(0, Math.ceil(rt.deadT))}…`);
      if (rt.deadT <= 0) this.respawn();
    }

    // ---- interaction prompt
    this.interact = null;
    if (alive) {
      let bd = Infinity;
      for (const it of this.system.interactables()) {
        const d = p.pos.distanceTo(it.pos);
        if (d < it.range && d < bd) {
          bd = d;
          this.interact = it;
        }
      }
    }
    this.ui.setPrompt(this.promptText());

    // ---- markers & HUD
    this.updateMarkers();
    this.ui.updateDamageNumbers(dt, this.camera, this.width, this.height);
    const bt = this.breakthroughStatus();
    this.ui.updateHUD(dt, {
      state: s, stats: this.stats, rt, systemDef: this.systemDef, density, medRate,
      breakthroughReady: bt.ready, breakthroughBlocked: bt.blocked,
      boss: this.beasts.liveBoss, nav: rt.nav, navDist: rt.nav ? Math.max(0, p.pos.distanceTo(rt.nav.pos) - rt.nav.surface) : 0,
      cruise: rt.cruise, aimTarget: this.aimTarget,
    });

    this.saveTimer += dt;
    if (this.saveTimer > 10) {
      this.saveTimer = 0;
      saveState(s);
    }
  }

  updateCamera(dt) {
    const p = this.player, rt = this.rt;
    this.camQuat.slerp(p.quat, 1 - Math.exp(-dt * 14));
    const off = tmpV.set(0, 3.4 * this.zoom, 13 * this.zoom).applyQuaternion(this.camQuat);
    this.camera.position.copy(p.pos).add(off);
    this.camera.quaternion.copy(this.camQuat);
    if (rt.shake > 0) {
      rt.shake = Math.max(0, rt.shake - dt * 3);
      const m = rt.shake * 2;
      this.camera.position.add(tmpV.set((Math.random() - 0.5) * m, (Math.random() - 0.5) * m, (Math.random() - 0.5) * m));
    }
    const targetFov = BASE_FOV + (p.boosting ? 9 : 0) + (rt.cruise ? 6 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
      this.particles.setScale(this.height * this.pixelRatio, this.camera.fov);
    }
    this.camera.updateMatrixWorld();
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
  castSwords(camFwd) {
    const s = this.state, rt = this.rt, T = TECHNIQUES.swords;
    if (s.realm < T.unlockRealm) return this.denied(`Flying Swords unlock at the ${REALMS[T.unlockRealm].name} realm.`);
    if (rt.cooldowns.swords > 0) return;
    if (rt.energy < T.cost) return this.denied('Not enough energy.');
    rt.cooldowns.swords = T.cd;
    rt.energy -= T.cost;
    const p = this.player;
    const count = 3 + Math.floor((s.realm - 1) * 0.75);
    const candidates = this.beasts.beasts
      .map((b) => {
        const to = b.pos.clone().sub(p.pos);
        const d = to.length();
        return { b, d, ang: to.normalize().angleTo(camFwd) };
      })
      .filter((c) => c.d < 1300 && c.ang < 0.7)
      .sort((a, b) => a.ang - b.ang);
    let targets = candidates.map((c) => c.b);
    if (!targets.length) {
      const n = this.beasts.nearest(p.pos, 800);
      if (n) targets = [n];
    }
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(p.quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.quat);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const origin = p.pos.clone().addScaledVector(right, Math.cos(a) * 3).addScaledVector(up, Math.sin(a) * 3 + 1);
      const dir = camFwd.clone().multiplyScalar(0.4).addScaledVector(right, Math.cos(a)).addScaledVector(up, Math.sin(a)).normalize();
      const target = targets.length ? targets[i % Math.min(targets.length, Math.max(1, Math.ceil(count / 2)))] : null;
      this.combat.launchSword(origin, dir, this.stats.atk * 1.5 * masteryMult(s.mastery.swords), target, 0.18 + i * 0.05);
    }
    this.sound.swords();
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
      if (d < radius + b.radius) {
        if (!b.boss) b.vel.add(b.pos.clone().sub(p.pos).normalize().multiplyScalar(220));
        this.hitBeast(b, dmg, b.pos.clone(), 'burst');
      }
    }
    this.combat.shockwave(p.pos, radius, REALMS[s.realm].color, 0.6);
    this.rt.shake = 0.8;
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
    this.particles.burst(this.player.pos, new THREE.Color(2, 1.6, 0.5), 50, 30, 1.5, 0.7);
    this.sound.shieldOn();
  }

  denied(msg) {
    const key = msg;
    if (this.time < (this.notifyGate[key] || 0)) return;
    this.notifyGate[key] = this.time + 2.5;
    this.ui.notify(msg, 'red');
    this.sound.deny();
  }

  usePill(k) {
    const s = this.state, rt = this.rt;
    if (s.pills[k] <= 0) return this.denied(`No ${PILLS[k].name}s left. Buy more at a station.`);
    s.pills[k]--;
    if (k === 'heal') rt.hp = Math.min(this.stats.maxHp, rt.hp + this.stats.maxHp * 0.6);
    else if (k === 'energy') rt.energy = this.stats.maxEnergy;
    else if (k === 'cult') this.addXp(this.stats.xpNeed / 3);
    this.particles.burst(this.player.pos, new THREE.Color(k === 'heal' ? 0x6dffb0 : k === 'energy' ? 0x6fe3ff : 0xffe08a).multiplyScalar(2), 40, 25, 1.4, 0.8);
    this.sound.pickup();
    this.ui.notify(`Consumed a ${PILLS[k].name} <span class="cn">${PILLS[k].cn}</span>.`, 'green');
  }

  // ----------------------------------------------------------- combat --
  hitBeast(b, dmg, pos, kind) {
    if (!b.alive) return;
    const crit = Math.random() < 0.12;
    const amount = dmg * (crit ? 2 : 1) * (0.9 + Math.random() * 0.2);
    this.ui.damageNumber(pos, fmt(amount), crit ? 'crit' : '');
    if (kind !== 'burst') this.sound.hit();
    this.beasts.damage(b, amount, this.time);
  }

  hurtPlayer(amount, pos, knock, silent = false) {
    const rt = this.rt;
    if (this.mode !== 'playing' || rt.invuln > 0) return;
    if (rt.shieldT > 0) amount *= 0.3;
    rt.hp -= amount;
    rt.lastHurt = this.time;
    if (!silent) {
      rt.hurtFlash = 0.35;
      rt.medBlock = 0.8;
      rt.shake = Math.min(1.2, rt.shake + 0.5);
      this.sound.hurt();
      this.ui.damageNumber(this.player.pos, `-${fmt(amount)}`, 'player');
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
    this.combat.explosion(this.player.pos, REALMS[s.realm].color, 2.5);
    this.player.setVisible(false);
    this.sound.death();
    let text;
    if (rt.trib) {
      this.endTribulation();
      const lost = s.xp * 0.3;
      s.xp -= lost;
      text = `The tribulation lightning shatters your body. Your breakthrough fails and you lose ${fmt(lost)} experience.`;
    } else {
      const lost = s.xp * 0.2;
      s.xp -= lost;
      text = `Your cultivation wavers. You lose ${fmt(lost)} experience.`;
    }
    this.ui.showDeath(true, text);
    this.ui.setPrompt(null);
    saveState(s);
  }

  respawn() {
    this.rt = this.freshRuntime();
    this.rt.invuln = 3;
    this.mode = 'playing';
    const spawn = this.system.station ? this.system.station.pos.clone().add(new THREE.Vector3(0, 30, 160)) : this.system.entryPoint.clone();
    this.player.placeAt(spawn, new THREE.Vector3(0, 0, 0));
    this.camQuat.copy(this.player.quat);
    this.player.setVisible(true);
    this.ui.showDeath(false);
    this.particles.converge(this.player.pos, this.player.auraColor.clone().multiplyScalar(2), 120, 30, 30, 2);
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
    this.ui.damageNumber(b.pos.clone().add(new THREE.Vector3(0, b.radius, 0)), `+${fmt(xp)} exp`, 'xp');
    if (this.mode === 'playing') {
      const to = this.player.pos.clone().sub(b.pos);
      const d = to.length();
      to.normalize();
      const c = new THREE.Color(s.devour ? 0xff7ad8 : 0xffe08a).multiplyScalar(2);
      for (let i = 0; i < 24; i++) {
        const sp = 160 + Math.random() * 80;
        this.particles.emit(b.pos.x, b.pos.y, b.pos.z, to.x * sp + (Math.random() - 0.5) * 30, to.y * sp + (Math.random() - 0.5) * 30, to.z * sp + (Math.random() - 0.5) * 30, c, 1.6, d / sp, 0);
      }
    }
    if (b.boss) {
      if (!s.bosses.includes(b.bossIndex)) s.bosses.push(b.bossIndex);
      const hpRatio = rt.hp / this.stats.maxHp;
      this.stats = derive(s);
      rt.hp = hpRatio * this.stats.maxHp;
      const learn = ACTIVE_TECHNIQUES.filter((k) => s.realm >= TECHNIQUES[k].unlockRealm && s.mastery[k] < 5);
      let extra = '';
      if (learn.length) {
        const k = learn[Math.floor(Math.random() * learn.length)];
        s.mastery[k]++;
        extra = ` · ${TECHNIQUES[k].name} mastery ${s.mastery[k]}`;
      }
      this.ui.banner(`${b.def.name} slain`, `<span class="cn">${b.def.cn}</span> · +10% life and attack${extra}`, hexStr(b.def.accent), 5);
      if (b.bossIndex === FINAL_BOSS) {
        setTimeout(() => this.ui.notify('The Primordial Devourer is gone. Nothing now bars your path to <b>Universe Master</b>.', 'gold'), 2500);
      }
      saveState(s);
    }
    this.addXp(xp);
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
        this.ui.notify(`Advanced to <b>${REALMS[s.realm].name} · ${STAGES[s.stage].name}</b> <span class="cn">${REALMS[s.realm].cn}${STAGES[s.stage].cn}</span>`, 'gold');
        this.particles.burst(this.player.pos, this.player.auraColor.clone().multiplyScalar(2), 60, 40, 1.8, 1);
        this.sound.stageUp();
        saveState(s);
      } else {
        s.xp = this.stats.xpNeed;
        if (!this.peakNotified) {
          this.peakNotified = true;
          const bt = this.breakthroughStatus();
          if (bt.ready) this.ui.notify('Your cultivation has reached its <b>Peak</b>. Press <kbd>B</kbd> to face the Heavenly Tribulation.', 'gold');
          else if (bt.blocked) this.ui.notify(bt.blocked, 'violet');
        }
        break;
      }
    }
  }

  breakthroughStatus() {
    const s = this.state;
    const full = s.stage === 3 && s.xp >= this.stats.xpNeed;
    if (!full || s.realm >= MAX_REALM || this.rt.trib) return { ready: false, blocked: null };
    if (s.realm === MAX_REALM - 1 && !s.bosses.includes(FINAL_BOSS)) {
      return { ready: false, blocked: 'Peak reached. Slay the Primordial Devourer to ascend.' };
    }
    return { ready: true, blocked: null };
  }

  tryBreakthrough() {
    const bt = this.breakthroughStatus();
    if (bt.blocked) return this.denied(bt.blocked);
    if (!bt.ready) {
      if (!this.rt.trib) this.denied('You must reach Peak stage with full experience before breaking through.');
      return;
    }
    this.startTribulation();
  }

  startTribulation() {
    const s = this.state, rt = this.rt;
    const clouds = new THREE.Group();
    const puff = puffTexture();
    for (let i = 0; i < 18; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: new THREE.Color(0.12, 0.08, 0.2), transparent: true, opacity: 0.9, depthWrite: false }));
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
      const r = 20 + Math.random() * 150;
      sp.position.set(Math.cos(a) * r, (Math.random() - 0.5) * 30, Math.sin(a) * r);
      sp.scale.setScalar(110 + Math.random() * 90);
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
    this.ui.banner('Heavenly Tribulation', '<span class="cn">天劫降临</span> · The heavens test you. Dodge the lightning!', '#d8c8ff', 3.5);
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
      if (tr.t > tr.dur * 0.45 && Math.random() < 0.55) {
        strike(p.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 70)));
      }
      this.sound.warningTick();
    }
    for (let i = tr.pending.length - 1; i >= 0; i--) {
      const k = tr.pending[i];
      k.t -= dt;
      if (k.t > 0) continue;
      tr.pending.splice(i, 1);
      this.combat.lightning(k.pos);
      this.sound.thunder();
      tr.glow.material.opacity = 0.4;
      if (this.mode === 'playing' && p.pos.distanceTo(k.pos) < k.radius + p.radius) {
        const knock = p.pos.clone().sub(k.pos).normalize().multiplyScalar(120);
        this.hurtPlayer(this.stats.maxHp * 0.2, k.pos, knock);
        this.rt.shake = 1.5;
      } else {
        this.rt.shake = Math.max(this.rt.shake, 0.4);
      }
      if (!this.rt.trib) return;
    }
    if (tr.t >= tr.dur && tr.pending.length === 0 && this.mode === 'playing') this.completeBreakthrough();
  }

  endTribulation() {
    const tr = this.rt.trib;
    if (!tr) return;
    this.scene.remove(tr.clouds);
    tr.clouds.traverse((o) => { if (o.material) o.material.dispose(); });
    this.rt.trib = null;
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
    const realm = REALMS[s.realm];
    this.player.setRealm(s.realm);
    this.combat.shockwave(this.player.pos, 280, realm.color, 1.4);
    this.particles.burst(this.player.pos, new THREE.Color(realm.color).multiplyScalar(1.6), 160, 140, 1.6, 1.6, 1);
    for (const b of [...this.beasts.beasts]) {
      if (b.pos.distanceTo(this.player.pos) < 280 + b.radius) this.hitBeast(b, this.stats.atk * 5, b.pos.clone(), 'burst');
    }
    this.sound.breakthrough();
    this.rt.shake = 1.2;
    this.ui.banner(realm.name, `<span class="cn">${realm.cn}</span> · Breakthrough!`, hexStr(realm.color), 4.5);
    setTimeout(() => this.ui.notify(esc(realm.blurb), 'gold'), 1200);
    for (const [k, t] of Object.entries(TECHNIQUES)) {
      if (t.unlockRealm === s.realm) setTimeout(() => this.ui.notify(`New technique: <b>${t.name}</b> <span class="cn">${t.cn}</span>. Press <kbd>${t.key}</kbd>.`, 'violet'), 2400);
    }
    GALAXIES.forEach((g, i) => {
      if (i > 0 && g.reqRealm === s.realm) {
        setTimeout(() => this.ui.notify(`You are strong enough to enter the <b>${g.name}</b>. Travel there through a Universe Gate.`, 'violet'), 3600);
      }
    });
    if (s.realm === MAX_REALM && !s.won) {
      s.won = true;
      setTimeout(() => this.ui.banner('Universe Master', '<span class="cn">宇宙之主</span> · You stand at the summit of the cosmos. The stars are yours to roam.', '#fff0b8', 8), 4800);
    }
    saveState(s);
  }

  // ------------------------------------------------------ interaction --
  promptText() {
    const it = this.interact;
    if (!it) return null;
    if (it.kind === 'station') return `<kbd>E</kbd> Dock at ${esc(it.name)} · rest and trade`;
    if (it.kind === 'gate') return '<kbd>E</kbd> Activate the Universe Gate';
    const pl = it.planet;
    if (this.state.explored.includes(pl.id)) return `${esc(pl.name)} has already been explored`;
    return pl.ruin ? `<kbd>E</kbd> Search the ancient ruins of ${esc(pl.name)}` : `<kbd>E</kbd> Explore ${esc(pl.name)}`;
  }

  doInteract() {
    const it = this.interact;
    if (!it) return;
    if (it.kind === 'station') {
      this.rt.hp = this.stats.maxHp;
      this.rt.energy = this.stats.maxEnergy;
      this.ui.openPanel('shop');
      this.input.unlock();
      this.sound.pickup();
      saveState(this.state);
    } else if (it.kind === 'gate') {
      this.ui.openPanel('map', 'universe');
      this.input.unlock();
      this.sound.ui();
    } else if (it.kind === 'planet') {
      this.explorePlanet(it.planet);
    }
  }

  explorePlanet(pl) {
    const s = this.state;
    if (s.explored.includes(pl.id)) {
      this.denied(`Nothing more to find on ${pl.name}.`);
      return;
    }
    s.explored.push(pl.id);
    const tier = this.systemDef.tier;
    const crystals = () => 45 * xpScale(tier) * (1 + Math.random() * 1.5);
    const name = `<b>${esc(pl.name)}</b>`;
    const fromPlanet = pl.worldPos.clone().sub(this.player.pos).normalize();
    const streamColor = new THREE.Color(0xffe08a).multiplyScalar(2);
    for (let i = 0; i < 60; i++) {
      const o = this.player.pos.clone().addScaledVector(fromPlanet, 40 + Math.random() * 30).add(new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30));
      const v = this.player.pos.clone().sub(o);
      const life = 0.6 + Math.random() * 0.5;
      v.divideScalar(life);
      this.particles.emit(o.x, o.y, o.z, v.x, v.y, v.z, streamColor, 1.5, life, 0);
    }
    this.sound.pickup();

    if (pl.ruin) {
      const xp = crystals() * 3;
      if (!s.devour) {
        s.devour = true;
        this.ui.banner('Inheritance found', '<span class="cn">吞噬秘法</span> · Devouring Art: slain beasts restore life, cultivation +50%', '#ff9ad8', 5.5);
      } else {
        const k = this.randomUpgradableTech();
        if (k) {
          s.mastery[k]++;
          this.ui.notify(`The ruins hold a manual. <b>${TECHNIQUES[k].name}</b> mastery rises to ${s.mastery[k]}.`, 'violet');
        }
      }
      this.ui.notify(`Ancient energy flows from the ruins of ${name}: +${fmt(xp)} experience.`, 'gold');
      this.addXp(xp);
      saveState(s);
      return;
    }

    const roll = Math.random();
    if (roll < 0.32) {
      const xp = crystals();
      this.ui.notify(`You find energy crystals on ${name}: +${fmt(xp)} experience.`, 'gold');
      this.addXp(xp);
    } else if (roll < 0.55) {
      const c = Math.round(25 * Math.pow(2.2, tier) * (1 + Math.random()));
      s.coins += c;
      this.ui.notify(`You recover a lost cache on ${name}: +${fmt(c)} star coins.`, 'gold');
    } else if (roll < 0.72) {
      const r = Math.random();
      const k = r < 0.45 ? 'heal' : r < 0.8 ? 'energy' : 'cult';
      const n = 1 + Math.floor(Math.random() * 2);
      s.pills[k] += n;
      this.ui.notify(`Medicinal herbs on ${name}: +${n} ${PILLS[k].name}.`, 'green');
    } else if (roll < 0.82) {
      const k = this.randomUpgradableTech();
      if (k) {
        s.mastery[k]++;
        this.ui.notify(`A technique manual lies buried on ${name}. <b>${TECHNIQUES[k].name}</b> mastery rises to ${s.mastery[k]}.`, 'violet');
      } else {
        const c = Math.round(40 * Math.pow(2.2, tier));
        s.coins += c;
        this.ui.notify(`You find relics on ${name}: +${fmt(c)} star coins.`, 'gold');
      }
    } else {
      const center = pl.worldPos.clone().add(this.player.pos.clone().sub(pl.worldPos).normalize().multiplyScalar(pl.radius + 40));
      const type = tier >= 1 && Math.random() < 0.5 ? 'ray' : 'mite';
      this.beasts.spawnGroup(type, center, type === 'ray' ? 3 : 6, tier, true);
      this.ui.notify(`You disturbed a beast nest on ${name}!`, 'red');
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
    if (s.coins < price) {
      this.sound.deny();
      return;
    }
    s.coins -= price;
    if (item === 'manual') {
      s.mastery[tech]++;
      this.ui.notify(`<b>${TECHNIQUES[tech].name}</b> mastery rises to ${s.mastery[tech]}.`, 'violet');
    } else {
      s.pills[item]++;
    }
    this.sound.pickup();
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
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (!best) {
      if (rt.nav) {
        rt.nav = null;
        rt.cruise = false;
        this.ui.notify('Course cleared.');
      } else {
        this.denied('Look toward a marker and press T to set a course.');
      }
      return;
    }
    if (rt.nav && rt.nav.key === best.key) {
      rt.nav = null;
      rt.cruise = false;
      this.ui.notify('Course cleared.');
      return;
    }
    const surface = best.kind === 'planet' ? best.planet.radius : best.kind === 'star' ? this.system.starRadius : 0;
    const arrive = best.kind === 'planet' ? best.planet.radius + 60 : best.kind === 'star' ? this.system.starRadius + 600 : best.kind === 'gate' ? 160 : best.kind === 'boss' ? 380 : best.kind === 'hotspot' ? 40 : 90;
    rt.nav = { key: best.key, label: best.label, pos: best.pos, arrive, surface };
    this.ui.notify(`Course set: <b>${esc(best.label)}</b>. Press <kbd>G</kbd> to cruise.`, 'gold');
    this.sound.ui();
  }

  toggleCruise() {
    const rt = this.rt;
    if (rt.cruise) {
      rt.cruise = false;
      return;
    }
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
    if (!check.ok) {
      this.sound.deny();
      return;
    }
    this.ui.closePanel();
    this.input.lock();
    this.startWarp(gi, si);
  }

  startWarp(gi, si) {
    this.mode = 'warping';
    this.warp = { t: 0, gi, si, swapped: false };
    this.rt.meditating = false;
    this.rt.cruise = false;
    this.warpLines.visible = true;
    this.sound.warp();
    this.ui.setPrompt(null);
  }

  updateWarp(dt) {
    const w = this.warp, p = this.player;
    w.t += dt;
    const mid = 1.15, end = 2.4;
    const inten = w.t < mid ? Math.min(1, w.t / mid) : Math.max(0, 1 - (w.t - mid) / (end - mid));
    const fade = w.t < mid ? THREE.MathUtils.smoothstep(w.t, mid - 0.45, mid) : 1 - THREE.MathUtils.smoothstep(w.t, mid + 0.1, mid + 0.9);
    this.ui.setFade(fade);
    this.camera.fov = BASE_FOV + inten * 45;
    this.camera.updateProjectionMatrix();
    // streaks
    const arr = this.warpLines.geometry.attributes.position.array;
    const speed = 500 + inten * 2500;
    for (let i = 0; i < this.warpData.length; i++) {
      const d = this.warpData[i];
      d.z += speed * dt;
      if (d.z > -10) d.z -= 700;
      const len = 4 + inten * 90;
      arr[i * 6] = d.x; arr[i * 6 + 1] = d.y; arr[i * 6 + 2] = d.z;
      arr[i * 6 + 3] = d.x; arr[i * 6 + 4] = d.y; arr[i * 6 + 5] = d.z - len;
    }
    this.warpLines.geometry.attributes.position.needsUpdate = true;
    this.warpLines.material.opacity = inten;
    if (!w.swapped) p.pos.addScaledVector(p.forward(), (300 + inten * 1500) * dt);
    p.root.position.copy(p.pos);

    if (!w.swapped && w.t >= mid) {
      w.swapped = true;
      const galaxyChanged = w.gi !== this.state.galaxy;
      this.state.galaxy = w.gi;
      this.state.system = w.si;
      this.loadSystem(w.gi, w.si);
      saveState(this.state);
      const def = this.systemDef;
      const g = GALAXIES[w.gi];
      if (galaxyChanged) this.ui.banner(g.name, `<span class="cn">${g.cn}</span> · ${esc(def.name)} system`, g.sky[0], 4);
      else this.ui.banner(def.name, `${esc(realmOf(def.tier).name)}-level danger${def.boss !== null && !this.state.bosses.includes(def.boss) ? ` · ${esc(BOSSES[def.boss].name)} lurks here` : ''}`, '#e9ecf8', 3);
      // clock may jump after heavy texture work; don't let it count
      this.clock.getDelta();
    }
    this.updateCamera(dt);
    this.system.update(dt);
    this.particles.update(dt);
    this.updateMarkers();
    if (w.t >= end) {
      this.mode = 'playing';
      this.warpLines.visible = false;
      this.ui.setFade(0);
      this.camera.fov = BASE_FOV;
      this.camera.updateProjectionMatrix();
      this.particles.setScale(this.height * this.pixelRatio, this.camera.fov);
      if (!this.input.locked && !this.ui.panelOpen) this.ui.showPause(true);
    }
  }

  // ---------------------------------------------------------- markers --
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
        if (pl.ruin && !explored) label += ' <span style="color:#f3cf7a">◈ ruins</span>';
        if (explored) label += ' <span style="color:#6dffb0">✓</span>';
        const surf = Math.max(0, dist - pl.radius);
        sub = surf >= 1000 ? `${(surf / 1000).toFixed(1)}k` : `${Math.round(surf)}`;
      } else if (m.kind === 'star') {
        sub = `${((dist - this.system.starRadius) / 1000).toFixed(1)}k`;
      }
      const nav = rt.nav && rt.nav.key === m.key;
      list.push({ key: m.key, kind: m.kind, label, sub, pos: m.pos, dist, edge: m.kind === 'station' || m.kind === 'gate' || nav, nav });
    }
    const boss = this.beasts.liveBoss;
    if (boss) {
      const d = p.pos.distanceTo(boss.pos);
      list.push({ key: 'boss', kind: 'boss', label: `${esc(boss.name)} · Overlord`, pos: boss.pos, dist: d, edge: true, nav: rt.nav && rt.nav.key === 'boss', hp: boss.hp / boss.maxHp });
    }
    if (this.mode === 'playing') {
      const near = [];
      for (const b of this.beasts.beasts) {
        if (b.boss) continue;
        const d = b.pos.distanceTo(p.pos);
        if (d < 700 || this.time - b.lastHit < 4 || b === this.aimTarget) near.push([d, b]);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (const [d, b] of near.slice(0, 14)) {
        if (!b.uid) b.uid = ++this.uidSeq;
        if (!b.markPos) b.markPos = new THREE.Vector3();
        b.markPos.copy(b.pos).y += b.radius * b.mesh.scale.y + 3;
        const rcls = b.tier - s.realm > 1.01 ? '#ff5a6e' : b.tier - s.realm > 0.25 ? '#ffd166' : '#ff9aa8';
        list.push({ key: `b:${b.uid}`, kind: 'beast', label: `<span style="color:${rcls}">${esc(b.name)} · ${esc(realmOf(b.tier).name)}</span>`, sub: '', pos: b.markPos, dist: d, edge: false, hp: b.hp / b.maxHp });
      }
    }
    this.ui.updateMarkers(list, this.camera, this.width, this.height);
  }
}
