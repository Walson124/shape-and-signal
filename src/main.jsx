import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { feature, neighbors as topologyNeighbors } from 'topojson-client';
import { geoArea, geoCentroid, geoContains, geoNaturalEarth1, geoPath } from 'd3-geo';
import world from 'world-atlas/countries-110m.json';
import { ArrowRight, Banknote, CarFront, Check, CircleHelp, Compass, Database, ExternalLink, Languages, Landmark, MapPin, Maximize2, Phone, RotateCcw, Ruler, Share2, X, ZoomIn, ZoomOut } from 'lucide-react';
import places from './data/places.json';
import sources from './data/sources.json';
import './styles.css';

const ROUND_COUNT = 5;
const worldFeatures = feature(world, world.objects.countries).features;
const featureById = new Map(worldFeatures.map((item) => [String(item.id).padStart(3, '0'), item]));
const geometryNeighbors = topologyNeighbors(world.objects.countries.geometries);
const neighborCountById = new Map(world.objects.countries.geometries.map((item, index) => [String(item.id).padStart(3, '0'), geometryNeighbors[index].length]));
const areaRanks = [...worldFeatures].sort((a, b) => geoArea(b) - geoArea(a));
const playablePlaces = places.records.filter((place) => featureById.has(place.worldAtlasId));
const cx = (...items) => items.filter(Boolean).join(' ');

function mulberry32(seed) { return () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function dayNumber() { const now = new Date(); return Number(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`); }
function shuffle(items, random) { const copy = [...items]; for (let i = copy.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }
function dailyRounds() { return shuffle(playablePlaces, mulberry32(dayNumber())).slice(0, ROUND_COUNT); }
function freeRounds() { return shuffle(playablePlaces, Math.random).slice(0, ROUND_COUNT); }
function joinValues(items, limit = 3) { if (items.length <= limit) return items.join(', '); return `${items.slice(0, limit).join(', ')} +${items.length - limit} more`; }
function logo() { return <div className="logo-mark" aria-hidden="true"><i /><i /><i /><i /><i /></div>; }

function displayGeometry(input) {
  if (input.geometry.type !== 'MultiPolygon') return input;
  const polygons = input.geometry.coordinates.map((coordinates) => ({ type: 'Feature', properties: input.properties, geometry: { type: 'Polygon', coordinates } }));
  const totalArea = polygons.reduce((sum, polygon) => sum + geoArea(polygon), 0);
  const largest = Math.max(...polygons.map(geoArea));
  const meaningful = polygons.filter((polygon) => geoArea(polygon) >= Math.max(largest * .018, totalArea * .008));
  return { type: 'FeatureCollection', features: meaningful.length ? meaningful : polygons };
}

function WorldMap({ target, selected, result, onSelect }) {
  const projection = useMemo(() => geoNaturalEarth1().fitExtent([[10, 10], [950, 480]], { type: 'Sphere' }), []);
  const path = useMemo(() => geoPath(projection), [projection]);
  const svgRef = useRef(null), dragRef = useRef(null), lastDragRef = useRef(0);
  const [view, setView] = useState({ x: 0, y: 0, w: 960, h: 490 });
  const clampView = (next) => ({ ...next, x: Math.max(0, Math.min(960 - next.w, next.x)), y: Math.max(0, Math.min(490 - next.h, next.y)) });
  const zoom = (direction) => setView((current) => {
    const factor = direction > 0 ? .7 : 1 / .7;
    const w = Math.max(230, Math.min(960, current.w * factor)), h = w * 490 / 960;
    return clampView({ x: current.x + (current.w - w) / 2, y: current.y + (current.h - h) / 2, w, h });
  });
  const reset = () => { lastDragRef.current = 0; setView({ x: 0, y: 0, w: 960, h: 490 }); };
  useEffect(() => {
    const map = svgRef.current;
    const wheel = (event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1 : -1); };
    map.addEventListener('wheel', wheel, { passive: false });
    return () => map.removeEventListener('wheel', wheel);
  }, []);
  const pointerDown = (event) => {
    if (view.w === 960) return;
    dragRef.current = { clientX: event.clientX, clientY: event.clientY, view };
  };
  const pointerMove = (event) => {
    if (!dragRef.current || view.w === 960) return;
    const rect = svgRef.current.getBoundingClientRect(), start = dragRef.current;
    const dx = (event.clientX - start.clientX) * start.view.w / rect.width, dy = (event.clientY - start.clientY) * start.view.h / rect.height;
    if (Math.abs(dx) + Math.abs(dy) > 2) lastDragRef.current = Date.now();
    setView(clampView({ ...start.view, x: start.view.x - dx, y: start.view.y - dy }));
  };
  const mapClick = (event) => {
    if (result || Date.now() - lastDragRef.current <= 160 || !event.target.matches('.map-country, .map-ocean')) return;
    const point = svgRef.current.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(svgRef.current.getScreenCTM().inverse());
    const coordinates = projection.invert([local.x, local.y]);
    if (coordinates) onSelect({ coordinates, atlasId: event.target.dataset.countryId ?? null });
  };
  const selectedPoint = selected ? projection(selected.coordinates) : null;
  const nearestPoint = result ? projection(result.nearest) : null;
  return (
    <div className="map-wrap">
      <div className="map-controls"><button onClick={() => zoom(1)} aria-label="Zoom in"><ZoomIn size={19} /></button><button onClick={() => zoom(-1)} aria-label="Zoom out" disabled={view.w === 960}><ZoomOut size={19} /></button><button onClick={reset} aria-label="Reset map"><Maximize2 size={18} /></button></div>
      <svg ref={svgRef} className={cx('world-map', view.w < 960 && 'is-zoomed')} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} role="group" aria-label="Place your guess on the world map" onClick={mapClick} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { dragRef.current = null; }} onPointerLeave={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
        <path d={path({ type: 'Sphere' })} className="map-ocean" />
        {worldFeatures.map((country) => {
          const id = country.id == null ? `unlisted-${country.properties.name}` : String(country.id).padStart(3, '0');
          const isTarget = id === target.worldAtlasId;
          return <path key={id} d={path(country)} data-country-id={id} vectorEffect="non-scaling-stroke" className={cx('map-country', result && isTarget && 'is-target')} tabIndex="0" role="button" aria-label={result ? country.properties.name : 'Country'} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && !result) { event.preventDefault(); onSelect({ coordinates: geoCentroid(country), atlasId: id }); } }} />;
        })}
        {result && selectedPoint && nearestPoint && <line className="distance-line" x1={selectedPoint[0]} y1={selectedPoint[1]} x2={nearestPoint[0]} y2={nearestPoint[1]} vectorEffect="non-scaling-stroke" />}
        {nearestPoint && result.km > 0 && <g className="target-marker" transform={`translate(${nearestPoint[0]} ${nearestPoint[1]})`}><circle r="8" /><circle r="3" /></g>}
        {selectedPoint && <g className="guess-marker" transform={`translate(${selectedPoint[0]} ${selectedPoint[1]})`}><circle r="11" /><circle r="4" /></g>}
      </svg>
      <div className="map-attribution">Made with Natural Earth · Public domain</div>
    </div>
  );
}

function clueBank(place) {
  const geometry = displayGeometry(featureById.get(place.worldAtlasId));
  const [longitude, latitude] = geoCentroid(geometry), magnitude = Math.abs(latitude);
  const lower = Math.floor(magnitude / 10) * 10, upper = lower + 10;
  const parts = geometry.type === 'FeatureCollection' ? geometry.features.length : 1;
  const rank = areaRanks.findIndex((item) => String(item.id).padStart(3, '0') === place.worldAtlasId) + 1;
  const bank = [
    { key: 'latitude', category: 'position', strength: 1, label: 'LATITUDE BAND', value: `${lower}-${upper} deg ${latitude >= 0 ? 'N' : 'S'}`, icon: MapPin },
    { key: 'hemisphere', category: 'position', strength: 1, label: 'HEMISPHERES', value: `${latitude >= 0 ? 'NORTH' : 'SOUTH'} / ${longitude >= 0 ? 'EAST' : 'WEST'}`, icon: Compass },
    { key: 'parts', category: 'shape', strength: 1, label: 'ATLAS STRUCTURE', value: `${parts} VISIBLE ${parts === 1 ? 'PART' : 'PARTS'}`, icon: Database },
    { key: 'neighbors', category: 'borders', strength: 1, label: 'LAND NEIGHBORS', value: `${neighborCountById.get(place.worldAtlasId) ?? 0} IN ATLAS`, icon: MapPin },
    { key: 'language-count', category: 'language', strength: 1, label: 'OFFICIAL VOICES', value: `${place.languages.length} RECORDED`, icon: Languages },
    { key: 'area-rank', category: 'scale', strength: 2, label: 'LAND AREA RANK', value: `TOP ${Math.max(10, Math.ceil(rank / 10) * 10)}`, icon: Ruler },
    { key: 'region', category: 'region', strength: 2, label: 'WORLD REGION', value: joinValues(place.continents), icon: MapPin },
    { key: 'currency', category: 'civic', strength: 3, label: 'CURRENCY', value: joinValues(place.currencies, 2), icon: Banknote },
    { key: 'languages', category: 'language', strength: 3, label: place.languages.length > 1 ? 'OFFICIAL LANGUAGES' : 'OFFICIAL LANGUAGE', value: joinValues(place.languages, 3), icon: Languages },
    { key: 'capital-initial', category: 'civic', strength: 3, label: 'CAPITAL INITIAL', value: place.capitals.map((capital) => capital[0]).join(' / '), icon: Landmark },
    { key: 'calling', category: 'code', strength: 4, label: 'CALLING SIGNAL', value: joinValues(place.callingCodes), icon: Phone },
    { key: 'capital', category: 'rescue', strength: 5, label: place.capitals.length > 1 ? 'CAPITALS' : 'CAPITAL', value: joinValues(place.capitals), icon: Landmark },
  ];
  if (place.drivingSides.length === 1) bank.push({ key: 'traffic', category: 'movement', strength: 1, label: 'TRAFFIC FLOW', value: `${place.drivingSides[0].toUpperCase()} SIDE`, icon: CarFront });
  return bank.filter((clue) => clue.value);
}

function buildClueSet(place, random) {
  const bank = clueBank(place), weak = shuffle(bank.filter((clue) => clue.strength <= 2), random);
  const anchor = shuffle(weak.filter((clue) => clue.strength === 2), random)[0];
  const starting = anchor ? [anchor] : [];
  for (const clue of weak) {
    if (starting.length === 3) break;
    if (!starting.some((item) => item.key === clue.key || item.category === clue.category)) starting.push(clue);
  }
  const used = new Set(starting.map((clue) => clue.key));
  const rescue = shuffle(bank.filter((clue) => !used.has(clue.key) && clue.strength >= 4), random)[0];
  const candidates = bank.filter((clue) => !used.has(clue.key) && clue.key !== rescue?.key)
    .map((clue) => ({ clue, order: clue.strength + random() * 1.4 }))
    .sort((a, b) => a.order - b.order)
    .map((item) => item.clue);
  const deeper = [...candidates.slice(0, 4), rescue].filter(Boolean);
  return { starting, deeper };
}

function haversine(a, b) {
  const rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
function longitudeDelta(value, origin) { return ((value - origin + 540) % 360) - 180; }
function distanceToCountry(coordinates, country) {
  if (geoContains(country, coordinates)) return { km: 0, nearest: coordinates };
  const polygons = country.geometry.type === 'Polygon' ? [country.geometry.coordinates] : country.geometry.coordinates;
  const cosine = Math.max(.15, Math.cos(coordinates[1] * Math.PI / 180));
  let best = { km: Infinity, nearest: coordinates };
  for (const polygon of polygons) for (const ring of polygon) for (let index = 1; index < ring.length; index += 1) {
    const a = ring[index - 1], b = ring[index];
    const ax = longitudeDelta(a[0], coordinates[0]) * cosine, ay = a[1] - coordinates[1];
    const bx = longitudeDelta(b[0], coordinates[0]) * cosine, by = b[1] - coordinates[1];
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    const nearest = [coordinates[0] + (ax + t * dx) / cosine, coordinates[1] + ay + t * dy];
    nearest[0] = ((nearest[0] + 540) % 360) - 180;
    const km = haversine(coordinates, nearest);
    if (km < best.km) best = { km, nearest };
  }
  return best;
}

function Header({ onHome, onHow, onSources }) {
  return <header className="site-header"><button className="brand" onClick={onHome}>{logo()}<span>SHAPE<span>/</span>SIGNAL</span></button><div className="header-status"><span /> WHEREFORM / VERIFIED DATA</div><div className="header-actions"><button className="header-text-button" onClick={onSources}><Database size={17} /> SOURCES</button><button className="icon-button" onClick={onHow} aria-label="How to play"><CircleHelp size={21} /></button></div></header>;
}

function HowModal({ onClose }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close icon-button" onClick={onClose}><X size={21} /></button><div className="eyebrow">WHEREFORM / FIELD GUIDE</div><h2>READ THE PLACE.<br />TAP THE EARTH.</h2><div className="instruction-row"><span>01</span><p>Start with three broad signals: latitude band, mapped land-part count, and traffic side. No country outline is shown.</p></div><div className="instruction-row"><span>02</span><p>Each round starts at 1,000 points and loses 10 every second. Stronger signals progress through region, currency, language, calling code, and capital; each costs another 140.</p></div><div className="instruction-row"><span>03</span><p>Daily mode generates one calendar-based set each day. Free Play produces a fresh random set whenever you want another run.</p></div><div className="instruction-row"><span>04</span><p>Zoom and drag the map, then tap a country to answer. Every completed round identifies the datasets behind it.</p></div><button className="primary-button" onClick={onClose}>START EXPLORING <ArrowRight size={18} /></button></section></div>;
}

function SourcesModal({ onClose }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal sources-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close icon-button" onClick={onClose}><X size={21} /></button><div className="eyebrow">DATA LEDGER / BUILD {places.generatedAt.slice(0, 10)}</div><h2>NOTHING<br />UNSOURCED.</h2><p className="source-intro">This content pack contains {places.records.length} machine-validated place records. The game stores where every displayed field came from and when it was retrieved.</p>{Object.entries(sources).slice(0,2).map(([id, source]) => <a className="source-row" href={source.url} target="_blank" rel="noreferrer" key={id}><div><strong>{source.name}</strong><span>{source.license}</span></div><ExternalLink size={18} /></a>)}<div className="validation-stamp"><Check size={18} /> SOURCE-VERIFIED CONTENT PACK</div></section></div>;
}

function Intro({ onStart, onHow, best }) {
  return <main className="intro-shell"><section className="intro-copy"><div className="eyebrow"><span className="live-dot" /> DAILY WORLD / {new Date().toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}).toUpperCase()}</div><h1>READ THE<br /><em>PLACE.</em></h1><p className="lede">Recognize somewhere real from the patterns and signals it leaves behind—then tap it on Earth.</p><div className="intro-actions"><button className="primary-button primary-button--large" onClick={() => onStart('daily')}>PLAY TODAY’S WORLD <ArrowRight size={20} /></button><button className="secondary-button primary-button--large" onClick={() => onStart('free')}><RotateCcw size={18} /> FREE PLAY</button><button className="text-button" onClick={onHow}><CircleHelp size={18} /> HOW IT WORKS</button></div><div className="daily-note">A NEW VERIFIED SET IS GENERATED EACH LOCAL CALENDAR DAY</div><div className="intro-stats"><div><strong>05</strong><span>PLACES DAILY</span></div><div><strong>{places.records.length}</strong><span>VERIFIED PLACES</span></div><div><strong>{best || '—'}</strong><span>DAILY BEST</span></div></div></section><section className="hero-place"><div className="hero-grid" /><div className="hero-label">GEOGRAPHIC RETURN / 01</div><div className="hero-dossier"><div className="dossier-orbit"><span>40-50</span><small>DEG N</small></div><div className="dossier-rule" /><div className="dossier-code">LATITUDE BAND<br />TRAFFIC: RIGHT<br />ATLAS PARTS: 03</div></div><div className="hero-signals"><div><CarFront size={17} /><span>TRAFFIC</span><strong>RIGHT</strong></div><div><Phone size={17} /><span>CALLING</span><strong>+39</strong></div><div><Languages size={17} /><span>VOICE</span><strong>ITALIAN</strong></div></div><div className="hero-coordinates">SOURCE VERIFIED<br />SIGNAL ARRAY ONLINE</div><div className="ticker"><span>SIGNAL BECOMES PLACE</span><span>SIGNAL BECOMES PLACE</span></div></section></main>;
}

function Game({ onFinish, mode }) {
  const rounds = useMemo(() => {
    const selectedPlaces = mode === 'daily' ? dailyRounds() : freeRounds();
    const random = mode === 'daily' ? mulberry32(dayNumber() * 101 + 17) : Math.random;
    return selectedPlaces.map((place) => ({ place, ...buildClueSet(place, random) }));
  }, [mode]);
  const [roundIndex, setRoundIndex] = useState(0), [revealed, setRevealed] = useState(0), [selected, setSelected] = useState(null), [result, setResult] = useState(null), [score, setScore] = useState(0), [roundScore, setRoundScore] = useState(1000), [outcomes, setOutcomes] = useState([]);
  const { place, starting: startingSignals, deeper: signals } = rounds[roundIndex];
  useEffect(() => {
    if (result) return undefined;
    const timer = window.setInterval(() => setRoundScore((value) => Math.max(0, value - 10)), 1000);
    return () => window.clearInterval(timer);
  }, [roundIndex, result]);
  const reveal = () => { if (result || revealed >= signals.length) return; setRevealed((value) => value + 1); setRoundScore((value) => Math.max(0, value - 140)); };
  const confirm = () => {
    if (!selected || result) return;
    const distance = selected.atlasId === place.worldAtlasId ? { km: 0, nearest: selected.coordinates } : distanceToCountry(selected.coordinates, featureById.get(place.worldAtlasId));
    const awarded = Math.round((roundScore * Math.exp(-distance.km / 2500)) / 10) * 10;
    const outcome = { place: place.name, distanceKm: Math.round(distance.km), points: awarded };
    setResult({ ...distance, awarded }); setScore((value) => value + awarded); setOutcomes((items) => [...items, outcome]);
  };
  const next = () => {
    if (roundIndex === rounds.length - 1) { onFinish(score, outcomes); return; }
    setRoundIndex((value) => value + 1); setRevealed(0); setSelected(null); setResult(null); setRoundScore(1000);
  };
  return <main className="game-shell">
    <div className="game-topbar">
      <div className="game-stat"><span>{mode === 'daily' ? 'DAILY SCORE' : 'FREE PLAY SCORE'}</span><strong>{score.toLocaleString().padStart(4, '0')}</strong></div>
      <div className="round-progress">{rounds.map((_, index) => <i key={index} className={cx(index < roundIndex && 'done', index === roundIndex && 'active')} />)}</div>
      <div className="game-stat game-stat--right"><span>PLACE</span><strong>{roundIndex + 1}/{rounds.length}</strong></div>
    </div>
    <section className="challenge-layout">
      <aside className="clue-panel">
        <div className="panel-kicker"><span className="live-dot" /> BASE SIGNAL / 03</div>
        <div className="evidence-board">
          {startingSignals.map((signal) => { const Icon = signal.icon; return <div className="evidence-card" key={signal.label}><Icon size={22} /><span>{signal.label}</span><strong>{signal.value}</strong></div>; })}
        </div>
        <div className="evidence-note">DERIVED FROM SOURCE GEOMETRY + VERIFIED DATA</div>
        <div className="signals-heading"><span>DEEPER SIGNALS</span><small>{revealed}/{signals.length} OPEN</small></div>
        <div className="signal-stack">{signals.map((signal, index) => { const Icon = signal.icon, open = index < revealed || result; return <div className={cx('signal-card', open && 'is-open')} key={signal.label}><Icon size={18} /><span>{open ? signal.label : `SIGNAL ${String(index + 1).padStart(2, '0')}`}</span><strong>{open ? signal.value : 'LOCKED'}</strong></div>; })}</div>
        {!result && <button className="reveal-button" onClick={reveal} disabled={revealed >= signals.length}>REVEAL NEXT SIGNAL <span>-140</span></button>}
      </aside>
      <section className="map-panel">
        <div className="map-heading"><div><span>GLOBAL POSITION</span><h2>{result ? place.name.toUpperCase() : selected ? 'READY TO LOCK?' : 'PLACE YOUR GUESS'}</h2></div><div className="potential-score"><span>ROUND VALUE / -10 SEC</span><strong>{roundScore}</strong></div></div>
        <WorldMap target={place} selected={selected} result={result} onSelect={setSelected} />
        {selected && !result && <div className="guess-lock"><div><span>PIN PLACED</span><strong>{Math.abs(selected.coordinates[1]).toFixed(1)} deg {selected.coordinates[1] >= 0 ? 'N' : 'S'} / {Math.abs(selected.coordinates[0]).toFixed(1)} deg {selected.coordinates[0] >= 0 ? 'E' : 'W'}</strong></div><small>CLICK MAP TO REPOSITION</small><button className="primary-button" onClick={confirm}>LOCK GUESS <Check size={18} /></button></div>}
        {result && <div className="answer-reveal"><div className="answer-check"><Check size={22} /></div><div><span>{result.km === 0 ? 'EXACT COUNTRY' : 'NEAREST LAND DISTANCE'}</span><strong>{place.name}</strong><small>{Math.round(result.km).toLocaleString()} KM AWAY / +{result.awarded} POINTS</small></div><div className="answer-source"><span>DATA</span><strong>WIKIDATA + NATURAL EARTH</strong></div><button className="primary-button" onClick={next}>{roundIndex === rounds.length - 1 ? 'SEE RESULTS' : 'NEXT PLACE'} <ArrowRight size={18} /></button></div>}
      </section>
    </section>
    <footer className="game-footer"><span>TAP A COUNTRY TO ANSWER / ZOOM AND DRAG TO INSPECT</span><span>{mode === 'daily' ? `DAILY SET / ${dayNumber()}` : 'FREE PLAY / RANDOMIZED SET'}</span><span>MADE WITH NATURAL EARTH</span></footer>
  </main>;
}

function Results({ score, best, onReplay, onHome, mode, outcomes }) {
  const [shareState, setShareState] = useState('');
  const share = async () => {
    const label = mode === 'daily' ? `DAILY ${new Date().toLocaleDateString()}` : 'FREE PLAY';
    const lines = outcomes.map((outcome, index) => `${index + 1}. ${outcome.distanceKm.toLocaleString()} km / ${outcome.points} pts`).join('\n');
    const text = `WHEREFORM - ${label}\n${lines}\nScore: ${score.toLocaleString()} / ${ROUND_COUNT * 1000}\n${location.origin}${location.pathname}`;
    try {
      if (navigator.share) { await navigator.share({ title: `Whereform - ${score.toLocaleString()} points`, text }); setShareState('SHARED'); }
      else { await navigator.clipboard.writeText(text); setShareState('SCORE COPIED'); }
    } catch { setShareState(''); }
  };
  return <main className="result-screen"><section className="result-card"><div className="result-pin"><MapPin size={46}/></div><div className="eyebrow">{mode === 'daily' ? 'DAILY WORLD' : 'FREE PLAY'} / COMPLETE</div><h2>{score>=4200?'WORLD READER.':score>=3000?'SIGNAL FOUND.':'PLACE LOCATED.'}</h2><p>You committed one guess for each verified place.</p><div className="outcome-strip">{outcomes.map((outcome) => <div key={outcome.place}><span>{outcome.distanceKm.toLocaleString()} KM</span><strong>{outcome.points}</strong></div>)}</div><div className="final-score"><span>FINAL SCORE</span><strong>{score.toLocaleString()}</strong></div><div className="result-actions"><button className="primary-button" onClick={share}><Share2 size={18}/> {shareState || 'SHARE SCORE'}</button><button className="secondary-button" onClick={() => onReplay(mode)}><RotateCcw size={18}/> PLAY AGAIN</button></div>{mode === 'daily' && <div className="best-note">DAILY PERSONAL BEST / {best.toLocaleString()}</div>}<button className="text-button" onClick={onHome}>BACK TO HOME</button></section></main>;
}

function App() {
  const [screen, setScreen] = useState(() => ['#play', '#free'].includes(location.hash) ? 'game' : 'intro');
  const [modal, setModal] = useState(null), [run, setRun] = useState(0), [lastScore, setLastScore] = useState(0), [lastOutcomes, setLastOutcomes] = useState([]), [gameMode, setGameMode] = useState(() => location.hash === '#free' ? 'free' : 'daily');
  const [best, setBest] = useState(() => Number(localStorage.getItem('whereform-best') || 0));
  const home = () => { history.replaceState(null, '', location.pathname + location.search); setScreen('intro'); };
  const play = (mode = 'daily') => { setGameMode(mode); history.replaceState(null, '', mode === 'daily' ? '#play' : '#free'); setRun((value) => value + 1); setScreen('game'); };
  const finish = (score, outcomes) => { setLastScore(score); setLastOutcomes(outcomes); if (gameMode === 'daily' && score > best) { setBest(score); localStorage.setItem('whereform-best', String(score)); } setScreen('results'); };
  return <div className="app"><Header onHome={home} onHow={() => setModal('how')} onSources={() => setModal('sources')} />{screen === 'intro' && <Intro onStart={play} onHow={() => setModal('how')} best={best} />}{screen === 'game' && <Game key={run} onFinish={finish} mode={gameMode} />}{screen === 'results' && <Results score={lastScore} best={Math.max(best, gameMode === 'daily' ? lastScore : best)} onReplay={play} onHome={home} mode={gameMode} outcomes={lastOutcomes} />}{modal === 'how' && <HowModal onClose={() => setModal(null)} />}{modal === 'sources' && <SourcesModal onClose={() => setModal(null)} />}</div>;
}
createRoot(document.getElementById('root')).render(<App/>);
