# Starsea Ascension · 星海飞升

A first-person 3D cultivation game that runs in the browser. You start as a Warrior in Base City 07 on the planet Terra, with three spirit swords and a body that cannot yet leave the ground. You hunt beasts in the wilds, absorb energy at springs and break through ten realms. In time you fly, then leave the planet, build a starship and warp to any star you can see in an endless galaxy. Inspired by xianxia space epics like 吞噬星空 (Swallowed Star).

Built with [Three.js](https://threejs.org/) and Vite. Every planet, city, star, nebula, beast, sword, ship and sound is generated in code at runtime, so there are no asset downloads.

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
| Move · sprint or boost | W A S D · Shift |
| Jump · double-tap to fly | Space |
| Rise / sink while flying | Space / X |
| Star Bolt | Left mouse (hold) |
| Steer flying swords | Right mouse (hold), wheel sets distance |
| Loose swords at targets · formation | Q · Z |
| Domain Burst · Golden Body · Ten Thousand Swords | R · F · V |
| Lock / cycle target | Tab |
| Cultivate · breakthrough | C (hold) · B |
| Interact · search ruins · board or leave ship | E · hold E · E |
| Pills | 1 2 3 |
| Target a marker or a star | T |
| Cruise to target · warp to target star | G |
| First / third person | P |
| Cultivation · bounties · guide | K · J · H |
| Mute · pause | N · Esc |

## How the world works

- **Every planet is a whole world.** Rocky planets and moons are full-size spheres you can walk around. Terrain streams in as a level-of-detail quadtree built in web workers. Forests, cacti, crystals and rocks are scattered on top. Each world has a climate: living, desert, ice, lava, toxic, crystal or barren. Gas giants have no surface and crush anyone who dives in.
- **Realms gate where you can go.** A Warrior is bound to the ground. A War God can fly, but only within the atmosphere. At the Planetary realm your body survives the void, so you can fly into space and land anywhere.
- **Real star systems.** Planets follow inclined elliptical orbits around their star and spin on tilted axes, so day and night move across the surface. Moons orbit their planets. Systems also have asteroid belts you can collide with, comets, energy nebulae and orbital stations.
- **An endless galaxy.** Stars are generated deterministically from their position in space, so the galaxy never runs out. Every star in the sky is a real system you can visit. Danger rises with distance from home, across five regions, each with its own Overlords. The last waits at the galaxy's heart.
- **Starships instead of a map.** Build a ship at a city shipyard with star coins, star metal and beast essence. Aim at a star with T and press G to warp. Bigger ships reach further. Within a system, the cruise drive speeds up the further you are from anything massive.
- **Things to find.** Cities and outposts hold a Martial Hall for bounties, an Exchange for pills and the sword forge, and a shipyard. In the wilds you find ancient ruins to search, energy springs to cultivate in, star metal deposits to shatter, beast nests and wrecks to salvage.

## Other features

- **Flying swords.** Idle swords fly beside you and knock enemy shots out of the air. Hold right mouse and they follow your crosshair, cutting anything they pass. Swarm formation whirls them around the aim point. Lance formation lines them into a spear. You gain a sword every realm, up to twelve, and can reforge them through five grades.
- **Ten realms.** They run from Warrior 战士 to Universe Master 宇宙之主, with four stages each. A Heavenly Tribulation 天劫 guards every breakthrough.
- **Presentation.** The game has first-person cyber gauntlets and a holographic HUD with compass, radar, target lock and hit markers. Planets have single-scattering atmospheres, clouds and oceans. Rendering includes a starfield baked from the real nearby stars, lens flares, bloom, chromatic aberration, speed blur and film grain. The music is generative and intensifies in combat.
- **Settings.** You can choose a quality preset from Low to Ultra, set the render scale, and turn on dynamic resolution. You can also adjust FOV, sensitivity, invert-Y, volume levels and post effects.

## Code map

| Folder | Contents |
| --- | --- |
| `src/core/` | Settings, input, audio engine, post-processing, log-depth shader helper, noise helpers |
| `src/world/` | Galaxy and star system generation, planet terrain and quadtree, atmospheres, cities, points of interest, props, worker pool, skybox baker, models |
| `src/game/` | Game loop, player, starship, flying swords, first-person arms, beasts, combat, loot, bounties, data, save state |
| `src/ui/` | HUD, menus and in-game panels |
