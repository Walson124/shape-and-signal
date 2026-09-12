import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const sourceRef = z.object({
  sourceId: z.enum(['wikidata', 'natural-earth', 'openstreetmap', 'official-gtfs', 'government']),
  retrievedAt: z.string().datetime(),
  fields: z.array(z.string()).min(1),
});
const record = z.object({
  id: z.string().min(2), iso2: z.string().length(2), worldAtlasId: z.string().regex(/^\d{3}$/),
  wikidataId: z.string().regex(/^Q\d+$/), name: z.string().min(2),
  capitals: z.array(z.string()).min(1), languages: z.array(z.string()).min(1),
  callingCodes: z.array(z.string()).min(1), currencies: z.array(z.string()).min(1),
  drivingSides: z.array(z.string()).min(1), continents: z.array(z.string()).min(1),
  status: z.literal('source-verified'), provenance: z.array(sourceRef).min(2),
});
const dataset = z.object({ schemaVersion: z.literal(1), generatedAt: z.string().datetime(), records: z.array(record).min(20) });
const raw = JSON.parse(await readFile(new URL('../src/data/places.json', import.meta.url), 'utf8'));
const parsed = dataset.parse(raw);
const ids = parsed.records.flatMap((item) => [item.id, item.iso2, item.worldAtlasId]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate place identifiers detected.');
for (const item of parsed.records) {
  const sourced = new Set(item.provenance.flatMap((source) => source.fields));
  for (const field of ['name', 'capitals', 'languages', 'callingCodes', 'currencies', 'drivingSides', 'continents', 'geometry']) {
    if (!sourced.has(field)) throw new Error(`${item.iso2}.${field} has no provenance.`);
  }
}
console.log(`Validated ${parsed.records.length} records and their provenance.`);
