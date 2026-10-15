# Starsea Ascension · 星海飞升

**Play it at [starsea.dev](https://starsea.dev)** · [Support development](https://ko-fi.com/starseadev)

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
| Dodge (move to choose direction) | Left Ctrl |
| Techniques 1–3 · ultimate | Q R F · V |
| Star Step blink (Stellar realm) | Left Alt |
| Sword formation (Mind Control) | Z |
| Lock / cycle target | Tab |
| Cultivate (tap to toggle) · breakthrough | C · B |
| Interact · search · board or leave ship | E (hold to search) |
| Pills | 1 2 3 |
| Target a marker or star · cruise or warp | T · G |
| Radar pulse | I |
| First / third person | P |
| Cultivation · skill tree · bounties · guide | K · U · J · H |
| Mute · pause | N · Esc |

## Paths

You pick a path when you start and can retrain at any Martial Hall.

- **Mind Control 精神掌控.** The only path with flying swords. Fire Star Bolts and steer a large host of swords with right mouse. Techniques: Sword Volley, Thought Prison (seizes and crushes a pack), Mind Barrier, Ten Thousand Swords.
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

Experience only takes you to the Peak of a realm. To break through you also need a **Realm Insight**, earned by winning an obelisk trial, slaying an Overlord, clearing every fifth arena wave, or completing a Martial Hall breakthrough trial. Missions and fights are worth far more experience than sitting still.

## Nix

Your ring holds **Nix 尼克斯**, an ancient and very sarcastic intelligence. Nix comments on what you do, warns you about beasts above your grade, explains new places and systems the first time you meet them, and fills the quiet with opinions. Its chattiness can be turned down or off in Settings.

## The world

- **Every planet is a whole world.** Rocky planets and moons are full-size spheres with streamed terrain, forests, rocks, oceans, clouds, and day and night. You collide with trees, rocks and buildings.
- **Cities you can walk into.** Terra has a capital, five more base cities and three outposts; other civilised worlds have their own towns. Glowing doors lead into exchanges, sword forges, pill pavilions, gene clinics, cultivation chambers, teahouses, noodle bars, apartments and the Martial Hall. The capital has an arena. Interiors are built only when you are close, so they cost nothing elsewhere.
- **Native beasts.** Terra has its own 怪兽: Ironhide Wolves, Bladewing Hawks, Thunder Lizards, Shadow Mantises, Golden-horn Rhinos, Frostclaw Bears, Earth Wyrms and Mountain Golems. Every other world generates its own species from its climate. Space has its own void beasts.
- **Radar.** Pulse the radar to mark undiscovered sites on your compass. Better scanners from the Exchange find more kinds of site, further away: ore first, then wrecks and camps, ruins and springs, obelisks and nests, and finally Overlord lairs.
- **Things break.** Attacks fell trees, shatter rocks, knock down street lamps and scorch the ground, and pedestrians run from a fight. The world repairs itself after a few minutes.
- **Things to do.** Bounties and courier jobs between cities, arena waves, ancient ruins, energy springs, ore deposits, beast nests, wrecks, obelisk trials, hunters' camps with traders, rumours bought at teahouses, rented homes you can sleep in, meals that buff you, and permanent gene enhancement.
- **Real star systems.** Planets follow inclined elliptical orbits. Systems have moons, asteroid belts, comets, nebulae and orbital stations you can land on.
- **An endless galaxy.** Stars are generated from their position in space, so the galaxy never runs out. Every star in the sky is a real system you can warp to. Danger rises with distance from home, across five regions with their own Overlords.

## Prism Training World

Press **O** to enter the Virtual Universe, visit the **Simulator** kiosk, and choose **Enter training world**. Prism is a single crystal planet with cities, discoveries and space for combat, flight, building and taming experiments.

Entry uses a warp corridor from the Virtual Universe, with the destination preparing in the background. The plaza stays animated until Prism is ready; no loading screen interrupts the transfer. Training controls are available with **F2** after arrival. Escape during transfer pauses on arrival. If the browser declines mouse capture after Escape, the pause screen stays available so you can click Resume.

Use **F2** for training controls: choose your realm, stage, weapon, mastery and equipment; toggle invulnerability, infinite energy/spirit/currency, cooldowns and frozen enemies; spawn enemy packs or bosses; summon ships and vehicles; refill or reset to the hub. All weapons and skill ranks are unlocked, with techniques retaining their realm requirements. The Ring includes crafting parts, building kits and collars.

Press **O** or **Return to Virtual Universe** to leave. Your physical body remains in the real world: enemies, projectiles and environmental hazards can still injure or kill it during training, including PvP and the entry warp. Training cheats only affect the simulation avatar. Cyan hit flashes indicate simulation damage; red warnings and a separate physical-body health/hull display indicate real danger. Press **L**, or click **Return to body**, to go straight back and defend yourself. Physical death severs the connection and applies the normal death/respawn consequences. Returning preserves your physical body's current health. Simulation rewards never transfer to the main save; real-world progress continues saving. Interstellar warp is disabled; flight and orbital travel remain available.

Training controls also include a **PvP simulation** against a humanoid AI cultivator. Choose its weapon, Recruit/Adept/Master difficulty, and a matched or custom realm/stage. Fair duels temporarily disable training cheats, clear encounters and suspend turret support. Rounds have a three-second countdown, live rival health/energy, and win/loss tracking; lethal hits end the round without a respawn penalty. Settings changes cancel the round, and previous training modifiers return when it ends. This is local AI practice, not online multiplayer.

## Planetary campaign

Start Story mode, or choose **Begin the story** in the Story tab of an existing Free Play save. The original Terra missions remain in order. After the Beast Tide, **The Black Crown** reveals Vesper, the Worldbreaker: the planetary threat foreshadowed in the opening broadcasts. Prepare a second-realm character, then approach its objective outside Base City 07. Surviving the siege leads to **The Buried Sun** on Dune and **The Silent Choir** on Glacis, tracing a corrupted Concord signal through its engine and relay.

Each original giant has its own model and attack mix. Vesper uses crown charges, sweeps, resonance rings and starfall; Serekh uses sand eruptions, bombardment and lunges; Ilyra uses aimed lances, rings and bombardment. All use separate encounter AI with committed targeting, readable windups, recovery damage bonuses and three health phases. Jump over ground waves, step out of lanes/marks, and punish recovery. Every fourth attack opens a ten-second World Rend channel: dealing 5.5% of maximum boss health interrupts it. Uninterrupted channels damage planetary integrity; three will destroy the planet. A seven-minute siege limit also applies. The timer starts when the confrontation begins, allowing preparation beforehand.

During a siege, death, planetary core failure or abandoning the defensive line triggers an orbital destruction cinematic and a campaign defeat screen, rather than automatic respawn. **Retry from checkpoint** restores the saved character/resources before that confrontation; **Return to title** retains the failed attempt and its checkpoint. Destruction belongs to that failed timeline, not a permanently deleted planet/save. Normal Free Play deaths and training retain their existing rules. Saves from the former Act I ending continue into The Black Crown.

For an isolated live-game WebGL inspection, run Vite on port 5191, open `/tools/planetary-preview.html`, or run `node tools/capture-terra.mjs --planetary`. The capture uses a temporary browser profile, fallback fonts and a separate test save. It exercises all three models, a tell, real player death, destruction, defeat/retry and victory progression; outputs are `artifacts/planetary-*.png`. This is functional/visual verification, not a hardware frame-rate or difficulty benchmark.

## Settings

Base City 07's **South Concourse** is a composed block beside the arrival plaza: Meridian Noodles, Kite Armory & Repairs, South Court Reception and Botanica Apothecary. Shop windows reveal furnished ground floors; the reception passage connects to the rear lane, and an external stair leads to a planted terrace. Recessed windows, balcony rails, service equipment and shared brick/plaster/stone/wood maps replace the generic towers within this footprint. Interior fixture lighting is baked into vertex data, with no additional real-time lights. Detailed architecture swaps to a simple distant silhouette and unloads beyond 350 m.

The concourse also has individual curtains/blinds, window planters, projecting shop signs, a neighbourhood noticeboard, roof parapets/ventilation and service-lane bins and deliveries. The complete nearby block uses 12 material batches and 54,000 triangles; bins have collision bounds and entrances, the rear passage and stairs remain clear.

Across Terra, the other buildings come from deterministic recipes in `terra-architecture.js`, rather than a manually placed copy of the concourse. Each city has a seeded architectural character, palette, floor height, height distribution, roof treatment and (outside the capital) lot spacing. Neighbourhood and lot seeds mix six building families: brick residences, court apartments, stepped offices, workshops, garden housing and commercial buildings. Existing walk-in venues keep their service locations and clear doors. The countryside stays open.

Shared small maps and batched skyline geometry provide distant buildings. Windows use cutout texture quads rather than geometry for every pane; close frames, curtains, balconies, planters, storefront cladding and fixtures stream in 96 m cells. At most four detailed architecture cells are kept (two on lower presets), one new cell is built per update, and detail unloads above street level. Roof setbacks have matching collision boxes. There are no extra real-time lights or per-building animation loops. Appearance varies without storing a unique texture/mesh asset for every building; additional nearby geometry still has a rendering cost.

For a reproducible daylight WebGL inspection, run Vite on port 5191 and open `/tools/terra-preview.html`. With Chrome installed, `node tools/capture-terra.mjs` captures eight views under `artifacts/terra-*.png`, including another town, an outpost and an outer district; `CHROME_PATH` overrides the browser executable. This preview uses actual city geometry and materials, with inspection lighting; it is not a measurement of in-game GPU frame rate.

Player ships have distinct hulls: a single-engine delta-wing Skyjet, compact twin-engine Corvette, larger patrol Frigate with a raised bridge and equipment bays, four-engine wedge Cruiser, and six-engine twin-habitat Star Ark. Static parts are batched by material; existing ship speeds, collision radii and landing clearances remain unchanged.

Terra's settlements have close-range street detail: tiled pedestrian paths, curbs and drains, benches, planted courts, transit shelters, directional signs and storefront canopies. Around Base City 07, start at the planted courts beside the arrival plaza and follow the avenues toward the market and shops. Pedestrians use the outer walking routes, pause and turn around; footsteps distinguish paving/interiors from softer ground. Street detail streams one 48 m cell per frame, keeps at most nine cells, uses shared sign/paving textures and unloads above the streets. Lower quality presets use a shorter detail range.

Atlas Reach is a deep-space expedition system 180 light years from Solace. Use **Chart Atlas Reach** at a shipyard, then the normal warp controls. The Star Ark can make the direct jump; shorter-range ships need intermediate stars. Atlas is a 12,800 km crystal world, Khamsin is a 6,000 km desert world, and Behemoth is a 96,000 km gas giant with a landable moon. The landable bodies have expedition bases and nearby discoveries. Existing planet sizes and ship speeds are unchanged; larger worlds use deeper terrain quadtrees with the same per-chunk mesh size.

- **Graphics.** Quality presets from Minimal to Ultra, render scale, dynamic resolution, terrain detail, tree and rock density, and city crowds.
- **Visuals.** Field of view, bloom, speed blur, chromatic aberration, film grain, vignette, screen shake, head bob, damage numbers and HUD scale.
- **Controls.** Mouse sensitivity, invert-Y and every key binding.
- **Gameplay.** First or third person, cultivate by tap or hold, and always-sprint.
- **Audio.** Master, music and effects volume.

## Code map

Graphics use chamfered structural boxes, smooth organic normals, and baked facade detail. Thin lights keep simple geometry, props/NPCs retain instancing, and terrain resolution and post-processing pass counts stay within the existing quality presets. Film grain and chromatic aberration are subtle when enabled. `npm test` includes closed-mesh, collision-bound and representative scene budget checks; GPU frame times still require a browser playtest.

| Folder | Contents |
| --- | --- |
| `src/core/` | Settings, key bindings, input, audio engine, post-processing, log-depth shader helper |
| `src/world/` | Galaxy and system generation, planet terrain and quadtree, atmospheres, cities, interiors, orbital stations, points of interest, props, worker pool, skybox |
| `src/game/` | Game loop, paths and skill trees, techniques, player, starship, flying swords, first-person arms, beasts and bestiary, combat, loot, bounties, data, save state |
| `src/ui/` | HUD, menus and in-game panels |
