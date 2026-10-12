# Starsea Ascension · 星海飞升

A first-person 3D cultivation game that runs in the browser. You start as a Warrior in the Solace system with three spirit swords. You steer them with your mind, hunt cosmic beasts, absorb the energy of stars, and break through ten realms. In time you cross Universe Gates into new galaxies and challenge their Overlords. Inspired by xianxia space epics like 吞噬星空 (Swallowed Star).

Built with [Three.js](https://threejs.org/) and Vite. Every planet, star, nebula, beast, sword, station and sound is generated in code at runtime, so there are no asset downloads.

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # static build in dist/, works from any host or subfolder
npm run preview  # serve the production build
```

It needs a desktop browser with WebGL 2, a keyboard and a mouse. Progress and settings save to local storage.

## Controls

| Action | Input |
| --- | --- |
| Look / steer | Mouse |
| Fly · rise / sink · boost | W A S D · Space / X · Shift |
| Star Bolt | Left mouse (hold) |
| Steer flying swords | Right mouse (hold), wheel sets distance |
| Loose swords at targets · formation | Q · Z |
| Domain Burst · Golden Body · Ten Thousand Swords | R · F · V |
| Lock / cycle target | Tab |
| Cultivate · breakthrough | C (hold) · B |
| Interact · scan planet | E · hold E |
| Pills | 1 2 3 |
| Set course · cruise | T · G |
| First / third person | P |
| Star map · cultivation · bounties · guide | M · K · J · H |
| Mute · pause | N · Esc |

## Features

- **Flying swords.** Idle swords fly beside you and knock enemy shots out of the air. Hold right mouse and they follow your crosshair, cutting anything they pass. Swarm formation whirls them around the aim point. Lance formation lines them into a spear. A glowing spirit thread links your fingertips to the blades. You gain a sword every realm, up to twelve, and can reforge them through five grades.
- **Ten realms.** They run from Warrior 战士 to Universe Master 宇宙之主, with four stages each. A Heavenly Tribulation 天劫 guards every breakthrough.
- **Five galaxies.** Each is a chain of procedurally generated star systems with planets, rings, asteroid belts, energy nebulae, stations and Universe Gates. Each galaxy has its own Overlord boss.
- **Stations.** Dock to heal, buy pills and technique manuals, take bounties, forge swords and refine beast essence into experience.
- **Presentation.** The game has first-person cyber gauntlets and a holographic HUD with compass, radar, target lock and hit markers. Rendering includes a baked skybox with reflections, lens flares, bloom, chromatic aberration, speed blur and film grain. The music is generative and intensifies in combat.
- **Settings.** You can choose a quality preset from Low to Ultra, set the render scale, and turn on dynamic resolution. You can also adjust FOV, sensitivity, invert-Y, volume levels and post effects.

## Code map

| Folder | Contents |
| --- | --- |
| `src/core/` | Settings, input, audio engine, post-processing, noise helpers |
| `src/world/` | Star systems, planet texture workers, skybox baker, station and gate models, lens flare, space dust |
| `src/game/` | Game loop, player, flying swords, first-person arms, beasts, combat, loot, bounties, data, save state |
| `src/ui/` | HUD, menus and in-game panels |
