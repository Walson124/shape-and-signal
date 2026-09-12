# Shape / Signal - Whereform

Whereform is a geography game about recognizing real places from the shapes and signals they leave behind. Players study an unlabeled geographic form, reveal factual signals if needed, and tap the answer on a world map.

## Current release

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

## Commands

```bash
npm install
npm run data:sync
npm run data:validate
npm run dev
npm run test:smoke
npm run build
```

`data:sync` refreshes structured metadata from Wikidata. `data:validate` rejects incomplete records, duplicate identifiers, and fields without provenance. The checked-in snapshot keeps daily rounds stable and allows production builds without live API dependencies.

`test:smoke` expects the development server on `http://127.0.0.1:5173`. It drives desktop and mobile Chrome through mixed clue generation, score decay, movable pins, guess confirmation, exact and distance-scored results, focus styling, map zoom and panning, Daily and Free Play entry, all five rounds, scored sharing, and the results screen. It also fails on browser console errors.

## Data policy

- Geographic geometry: [Natural Earth](https://www.naturalearthdata.com/), public domain, distributed through `world-atlas`.
- Structured place metadata: [Wikidata](https://www.wikidata.org/), CC0 1.0.
- Future street and traffic geometry: [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL 1.0 with required attribution.
- Future transit geometry: official GTFS feeds, admitted individually only after license review.
- Traffic laws and signal meanings: government or national transport sources with manual review.

Ambiguous multi-value fields are not silently resolved. The UI omits signals that cannot be presented unambiguously, and every shipped record carries source IDs and retrieval timestamps.

## Important scope boundary

"Source verified" means the displayed value was retrieved from the recorded open dataset and passed the repository checks. It does not mean third-party datasets are infallible. Content should remain traceable, reviewable, and correctable.
