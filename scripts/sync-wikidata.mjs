import { mkdir, writeFile } from 'node:fs/promises';

const countries = [
  ['AR', '032'], ['AU', '036'], ['BR', '076'], ['CA', '124'], ['CL', '152'], ['CU', '192'],
  ['EG', '818'], ['FI', '246'], ['FR', '250'], ['DE', '276'], ['GR', '300'], ['IS', '352'],
  ['IN', '356'], ['ID', '360'], ['IE', '372'], ['IT', '380'], ['JP', '392'], ['MG', '450'],
  ['MX', '484'], ['MA', '504'], ['NZ', '554'], ['NO', '578'], ['PH', '608'], ['ZA', '710'],
  ['ES', '724'], ['SE', '752'], ['TH', '764'], ['TR', '792'], ['GB', '826'], ['US', '840'],
];

const query = `
SELECT ?iso ?country ?countryLabel ?capitalLabel ?languageLabel ?callingCode
       ?currencyLabel ?drivingSideLabel ?continentLabel WHERE {
  VALUES ?iso { ${countries.map(([iso]) => `"${iso}"`).join(' ')} }
  ?country wdt:P297 ?iso .
  OPTIONAL { ?country wdt:P36 ?capital . }
  OPTIONAL { ?country wdt:P37 ?language . }
  OPTIONAL { ?country wdt:P474 ?callingCode . }
  OPTIONAL { ?country wdt:P38 ?currency . }
  OPTIONAL { ?country wdt:P1622 ?drivingSide . }
  OPTIONAL { ?country wdt:P30 ?continent . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

const response = await fetch('https://query.wikidata.org/sparql', {
  method: 'POST',
  headers: {
    Accept: 'application/sparql-results+json',
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    'User-Agent': 'ShapeAndSignal-Whereform/1.0 (data provenance build)',
  },
  body: new URLSearchParams({ query }),
});

if (!response.ok) throw new Error(`Wikidata returned ${response.status}: ${await response.text()}`);
const payload = await response.json();
const byIso = new Map();
const unique = (items) => [...new Set(items.filter(Boolean))].sort();

for (const row of payload.results.bindings) {
  const iso = row.iso.value;
  const entry = byIso.get(iso) ?? {
    id: iso.toLowerCase(), iso2: iso,
    worldAtlasId: countries.find(([code]) => code === iso)?.[1],
    wikidataId: row.country.value.split('/').pop(),
    name: row.countryLabel?.value ?? iso,
    capitals: [], languages: [], callingCodes: [], currencies: [], drivingSides: [], continents: [],
  };
  entry.capitals.push(row.capitalLabel?.value);
  entry.languages.push(row.languageLabel?.value);
  entry.callingCodes.push(row.callingCode?.value);
  entry.currencies.push(row.currencyLabel?.value);
  entry.drivingSides.push(row.drivingSideLabel?.value);
  entry.continents.push(row.continentLabel?.value);
  byIso.set(iso, entry);
}

const retrievedAt = new Date().toISOString();
const records = countries.map(([iso]) => {
  const record = byIso.get(iso);
  if (!record) throw new Error(`Wikidata did not return ${iso}`);
  for (const field of ['capitals', 'languages', 'callingCodes', 'currencies', 'drivingSides', 'continents']) record[field] = unique(record[field]);
  return {
    ...record,
    status: 'source-verified',
    provenance: [
      { sourceId: 'wikidata', retrievedAt, fields: ['name', 'capitals', 'languages', 'callingCodes', 'currencies', 'drivingSides', 'continents'] },
      { sourceId: 'natural-earth', retrievedAt, fields: ['geometry'] },
    ],
  };
});

await mkdir(new URL('../src/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../src/data/places.json', import.meta.url), `${JSON.stringify({ schemaVersion: 1, generatedAt: retrievedAt, records }, null, 2)}\n`);
console.log(`Wrote ${records.length} source-backed place records.`);
