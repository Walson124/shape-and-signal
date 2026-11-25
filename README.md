# Shape & Signal

Small games and group tools that run in the browser. Open a tab, send a link, play together. No accounts.

| App | Path | What it is |
| --- | --- | --- |
| Hub | `/` | The front page linking to everything |
| **Whereform** | `/whereform/` | Daily geography game: name the country from the signals it leaves behind |
| **Minesweeper Duel** | `/mines/` | Real-time Minesweeper races for 2–4 players, plus solo practice |
| **Whereto** | `/whereto/` | Like when2meet, but for places: everyone marks the spots that work on a map, and the group overlap picks the place |

## Run it

```bash
npm install
npm run dev      # Vite dev server for all apps (the hub at /)
npm run build    # static build of every app into dist/
npx wrangler dev # the Worker: serves dist/ and the API on :8787
```

Minesweeper Duel matches and Whereto plans live in the Cloudflare Worker (`worker/`), so run `npx wrangler dev` next to `npm run dev`; Vite proxies `/api` to it. Whereform and Minesweeper practice work without it. `npm test` runs the unit tests.

`npx wrangler deploy` (after `npm run build`) publishes everything to the `shape-and-signal` Worker.

## Minesweeper Duel

Create a room, send the code or invite link (`/mines/?room=CODE`), and ready up. The host picks:

- **Board:** Beginner 9×9 (10 mines), Intermediate 16×16 (40), Expert 30×16 (99).
- **Mines:** *Same board* (everyone gets the same mines; you see only each other's progress) or *Separate boards* (same size and count, different layouts; you can watch each other's boards fill in).
- **Hit a mine:** *Freeze 5 s* or *You're out* (last one standing wins).

Every board starts with an open area, so nobody has to guess a first click. The first player to open every safe cell wins; wins are tallied across rematches. Controls: click opens, right-click flags, clicking a satisfied number opens its neighbours, Space flags or chords under the pointer, and on touch screens long-press flags (or turn on Flag mode). On a portrait phone, Expert is turned on its side to fit.

The server (`worker/mines-match.js`, one `MinesRoom` Durable Object per code) holds every board and replays each move with the same rules module the browser uses (`src/mines/core.js`). Browsers show a move at once and resync if the server disagrees, so the server alone decides who won. A dropped player has 20 seconds to reconnect to their seat.

## Whereto

Make a plan (a trip, a meetup or anything else), pick a map and share the link (`/whereto/?p=<id>`). Everyone enters a name (with an optional password that stops others editing their picks) and paints spots as *Works* or *If needed*, by clicking or dragging across them like when2meet. The **Everyone** view shades each spot by how many people can do it, outlines spots that work for the whole group, and ranks the best spots. Spots everyone can do come first, then those more people can do, then those with more "works". Hover or tap a person to see their picks. Pages poll every few seconds, so new answers show up live.

Maps:

- **World · countries**, **World · cities** (120+ popular destinations), **United States** (states), and a **sample office** floor plan.
- **Your own picture:** a floor plan, a campus map, a screenshot. You either draw named boxes on it (rooms, buildings, areas) or lay a grid over it for people to paint. Pictures are scaled down in the browser to keep them under about 1 MB.

Each plan is a `Plan` Durable Object (`worker/plan.js`) storing the plan, its picture and the responses. Validation lives in `worker/plan-protocol.js` and ranking in `src/whereto/score.js`.

## Code map (platform)

| Folder | Contents |
| --- | --- |
| `index.html`, `src/hub/` | The hub page |
| `src/platform/` | Shared look (light/dark tokens), top bar, toast, remembered player name |
| `mines/`, `src/mines/` | Minesweeper Duel page, rules, board view, room connection |
| `whereto/`, `src/whereto/` | Whereto page: create flow and upload editor, plan view, maps, map view, ranking |
| `whereform/`, `src/whereform/`, `scripts/` | Whereform page, game, content pack and data scripts |
| `worker/` | Cloudflare Worker: static files, Minesweeper rooms, Whereto plans |

## Whereform

Whereform is a geography game about recognizing real places from the shapes and signals they leave behind. Players study an unlabeled geographic form, reveal factual signals if needed, and tap the answer on a world map.

### Current release

- Five deterministic daily rounds, with a new set chosen from the local calendar date
- Randomized Free Play mode
- 30 source-backed countries
- No country-shape clue or full-border reveal
- Per-round clue decks drawn from position, hemisphere, atlas structure, land neighbors, area rank, traffic flow, language, currency, calling code, and capital data
- Three balanced starting signals and five seeded deeper signals; combinations vary by place and day
- Round value decays by 10 points per second all the way to zero, with additional hint costs
- One movable, confirmed map guess per round
- Distance scoring against the nearest point on the target country's land geometry, with exact-country detection
- Zoomable, draggable world map with keyboard-accessible country targets
- Daily personal bests and scored sharing
- Visible in-game provenance and licensing
- Desktop and mobile layouts

The first content pack focuses on national borders. The data model is designed to add OpenStreetMap street grids and traffic infrastructure, plus individually licensed official GTFS transit feeds.

### Commands

```bash
npm install
npm run data:sync
npm run data:validate
npm run dev
npm run test:smoke
npm run build
```

`data:sync` refreshes structured metadata from Wikidata. `data:validate` rejects incomplete records, duplicate identifiers, and fields without provenance. The checked-in snapshot keeps daily rounds stable and allows production builds without live API dependencies.

`test:smoke` expects the development server on `http://127.0.0.1:5173` and opens `/whereform/` (set `WHEREFORM_URL` to the Whereform page to point it elsewhere). It drives desktop and mobile Chrome through mixed clue generation, score decay, movable pins, guess confirmation, exact and distance-scored results, focus styling, map zoom and panning, Daily and Free Play entry, all five rounds, scored sharing, and the results screen. It also fails on browser console errors.

### Data policy

- Geographic geometry: [Natural Earth](https://www.naturalearthdata.com/), public domain, distributed through `world-atlas`.
- Structured place metadata: [Wikidata](https://www.wikidata.org/), CC0 1.0.
- Future street and traffic geometry: [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL 1.0 with required attribution.
- Future transit geometry: official GTFS feeds, admitted individually only after license review.
- Traffic laws and signal meanings: government or national transport sources with manual review.

Ambiguous multi-value fields are not silently resolved. The UI omits signals that cannot be presented unambiguously, and every shipped record carries source IDs and retrieval timestamps.

### Important scope boundary

"Source verified" means the displayed value was retrieved from the recorded open dataset and passed the repository checks. It does not mean third-party datasets are infallible. Content should remain traceable, reviewable, and correctable.
