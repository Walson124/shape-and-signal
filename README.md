# Starsea Ascension · 星海飞升

A first-person 3D cultivation game that runs in the browser. You start as a Warrior in Base City 07 on the planet Terra. You choose a path, hunt the beasts that roam between Terra's walled cities, and break through ten realms. In time you fly, then leave the planet, build a starship and warp to any star you can see in an endless galaxy. Inspired by xianxia space epics like 吞噬星空 (Swallowed Star).

Built with [Three.js](https://threejs.org/) and Vite. Every planet, city, interior, beast, star, ship and sound is generated in code at runtime, so there are no asset downloads.

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # static build in dist/, works from any host or subfolder
npm run preview  # serve the production build
```

It needs a desktop browser with WebGL 2, a keyboard and a mouse. Progress and settings save to local storage.

## Controls

Every key can be changed in Settings › Controls. The defaults are:

| Action | Input |
| --- | --- |
| Look / steer | Mouse |
| Move · sprint or boost | W A S D · Left Shift |
| Jump · double-tap to fly | Space |
| Sink while flying | X |
| Primary attack · secondary | Left mouse · right mouse |
| Techniques 1–3 · ultimate | Q R F · V |
| Star Step blink (Stellar realm) | Left Alt |
| Sword formation (Mind Control) | Z |
| Lock / cycle target | Tab |
| Cultivate (tap to toggle) · breakthrough | C · B |
| Interact · search · board or leave ship | E (hold to search) |
| Pills | 1 2 3 |
| Target a marker or star · cruise or warp | T · G |
| First / third person | P |
| Cultivation · skill tree · bounties · guide | K · U · J · H |
| Mute · pause | N · Esc |

## Paths

You pick a path when you start and can retrain at any Martial Hall.

- **Mind Control 精神掌控.** Fire Star Bolts and steer a large host of flying swords with right mouse. Techniques: Sword Volley, Thought Prison (seizes and crushes a pack), Mind Barrier, Ten Thousand Swords.
- **Blade 刀者.** Swing a saber up close; every third cut throws a wave of blade light. Right mouse guards, and a well-timed guard parries and staggers. Techniques: Flash Cut, Crescent Wave, Battle Will, Heaven-Splitting Blade.
- **Mental Attack 精神攻击.** Mind Spikes land instantly on whatever you aim at. Right mouse lifts and crushes a beast, and releasing hurls it. Techniques: Soul Lance, Psychic Shockwave, Terror, Soul Annihilation.

Each path has its own skill tree plus a shared general tree. You earn a skill point per stage, two per breakthrough, and one for every obelisk trial you win.

## Realms

The ten realms run from Warrior 战士 to Universe Master 宇宙之主. Each one changes how you play, not only your numbers:

- War God flies inside an atmosphere and leaps over rooftops. Hard landings crack the ground.
- Planetary survives the void and can own a starship.
- Stellar gains Star Step, an instant blink.
- From Cosmic up, weaker beasts flee your aura. A Domain Lord's domain slows and weakens beasts nearby. From Realm Lord, weak beasts are crushed by your presence alone.
- Immortals survive one fatal blow every few minutes. Venerables cruise through space ten times faster.

Running speed, jump height, flight speed and the size of your attacks and aura all grow with each realm. Beasts of higher grades are visibly larger.

## The world

- **Every planet is a whole world.** Rocky planets and moons are full-size spheres with streamed terrain, forests, rocks, oceans, clouds, and day and night. You collide with trees, rocks and buildings.
- **Cities you can walk into.** Terra has a capital, five more base cities and three outposts; other civilised worlds have their own towns. Glowing doors lead into exchanges, sword forges, pill pavilions, gene clinics, cultivation chambers, teahouses, noodle bars, apartments and the Martial Hall. The capital has an arena. Interiors are built only when you are close, so they cost nothing elsewhere.
- **Native beasts.** Terra has its own 怪兽: Ironhide Wolves, Bladewing Hawks, Thunder Lizards, Shadow Mantises, Golden-horn Rhinos, Frostclaw Bears, Earth Wyrms and Mountain Golems. Every other world generates its own species from its climate. Space has its own void beasts.
- **Things to do.** Bounties and courier jobs between cities, arena waves, ancient ruins, energy springs, ore deposits, beast nests, wrecks, obelisk trials, hunters' camps with traders, rumours bought at teahouses, rented homes you can sleep in, meals that buff you, and permanent gene enhancement.
- **Real star systems.** Planets follow inclined elliptical orbits. Systems have moons, asteroid belts, comets, nebulae and orbital stations you can land on.
- **An endless galaxy.** Stars are generated from their position in space, so the galaxy never runs out. Every star in the sky is a real system you can warp to. Danger rises with distance from home, across five regions with their own Overlords.

## Settings

- **Graphics.** Quality presets from Minimal to Ultra, render scale, dynamic resolution, terrain detail, tree and rock density, and city crowds.
- **Visuals.** Field of view, bloom, speed blur, chromatic aberration, film grain, vignette, screen shake, head bob, damage numbers and HUD scale.
- **Controls.** Mouse sensitivity, invert-Y and every key binding.
- **Gameplay.** First or third person, cultivate by tap or hold, and always-sprint.
- **Audio.** Master, music and effects volume.

## Code map

| Folder | Contents |
| --- | --- |
| `src/core/` | Settings, key bindings, input, audio engine, post-processing, log-depth shader helper |
| `src/world/` | Galaxy and system generation, planet terrain and quadtree, atmospheres, cities, interiors, orbital stations, points of interest, props, worker pool, skybox |
| `src/game/` | Game loop, paths and skill trees, techniques, player, starship, flying swords, first-person arms, beasts and bestiary, combat, loot, bounties, data, save state |
| `src/ui/` | HUD, menus and in-game panels |
