# Starsea Ascension · 星海飞升

A 3D cultivation game that runs in the browser. You start as a lowly Warrior in the Solace system and fly through space absorbing cosmic energy, hunting cosmic beasts, and exploring planets. You break through realm after realm until you can cross the Universe Gates to new galaxies and challenge their Overlords. Inspired by cultivation novels like 吞噬星空 (Swallowed Star).

Built with [Three.js](https://threejs.org/) and Vite. Every planet, star, nebula, beast and sound is generated in code, so there are no asset downloads.

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # static build in dist/, host it anywhere
```

Open the page, click **Begin Cultivation**, and the game captures the mouse. Progress saves to the browser's local storage.

## Controls

| Action | Key |
| --- | --- |
| Steer | Mouse |
| Fly / strafe | W A S D |
| Rise / sink | Space / X |
| Boost (uses energy) | Shift |
| Star Bolt | Left click (hold) |
| Flying Swords · Domain Burst · Golden Body | Q · R · F |
| Cultivate | Hold C |
| Break through at Peak | B |
| Explore planet / dock / use gate | E |
| Pills | 1 2 3 |
| Set course to marker near crosshair / cruise there | T / G |
| Star map · Cultivation · Guide | M · K · H |
| Zoom camera | Mouse wheel |
| Mute · Pause | N · Esc |

## How it plays

- **Realms.** Warrior 战士, War God 战神, Planetary 行星级, Stellar 恒星级, Cosmic 宇宙级, Domain Lord 域主, Realm Lord 界主, Immortal 不朽, Venerable 尊者, Universe Master 宇宙之主. Each realm has Early, Middle, Late and Peak stages.
- **Cultivating.** Hold C to absorb energy. Energy is denser near stars, inside glowing nebulae, and in more dangerous systems.
- **Tribulation.** At Peak, press B to call down the Heavenly Tribulation 天劫. Dodge the red markers until it ends to enter the next realm. If you die, the breakthrough fails and you lose some experience.
- **Beasts.** Void Mites swarm, Star Rays shoot from range, Rockback Devourers charge, and Nebula Wraiths teleport. Beasts far below your realm give little experience.
- **Planets.** Press E near a planet to explore it once. You may find crystals, coins, pills, manuals, or an angry nest. Ruins hold inheritances, including the Devouring Art 吞噬秘法.
- **Travel.** The star map warps you between systems in a galaxy. Each galaxy's first system has a station for healing and shopping, plus a Universe Gate to other galaxies once your realm allows.
- **Overlords.** Each galaxy's last system holds a boss. Slaying one grants +10% life and attack for good. The Primordial Devourer guards the final breakthrough.

## Code map

| File | Role |
| --- | --- |
| `src/game/game.js` | Game loop, progression, tribulation, warping, interaction |
| `src/game/data.js` | Realms, techniques, beasts, bosses, galaxies, system generation |
| `src/game/system.js` | Builds a star system: star shader, planets, belts, nebulae, station, gate |
| `src/game/beasts.js` | Beast and boss models, AI, spawning |
| `src/game/combat.js` | Projectiles, flying swords, shockwaves, lightning |
| `src/game/player.js` | Player figure, flight physics, poses |
| `src/game/ui.js` | HUD, markers, damage numbers, map, cultivation, shop and guide panels |
| `src/game/textures.js` | Procedural planet, ring, glow and galaxy textures |
| `src/game/sky.js` | Nebula skybox, starfield, distant galaxies |
| `src/game/particles.js`, `audio.js`, `input.js`, `state.js` | Particles, synthesized sound, input, save data |
