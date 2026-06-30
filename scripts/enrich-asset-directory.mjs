import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const inputFile = resolve('research/pioga-image-directory-candidates.json');
const outputFile = resolve('research/pioga-image-directory-enriched.json');
const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const args = new Set(process.argv.slice(2));
const limitArg = [...args].find(arg => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
if (!apiKey) throw new Error('Set GOOGLE_PLACES_API_KEY or load it from .env.');

function normalize(value = '') {
  return value.toLowerCase().replace(/\b(incorporated|corporation|company|limited|services?|inc|corp|llc|ltd|co|pllc|pc|lp|llp)\b/g, '').replace(/[^a-z0-9]/g, '');
}

function similarity(left, right) {
  if (!left || !right) return 0;
  const row = Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let column = 1; column <= right.length; column++) {
    let diagonal = row[0]; row[0] = column;
    for (let index = 1; index <= left.length; index++) {
      const prior = row[index];
      row[index] = Math.min(row[index] + 1, row[index - 1] + 1, diagonal + (left[index - 1] === right[column - 1] ? 0 : 1));
      diagonal = prior;
    }
  }
  return 1 - row[left.length] / Math.max(left.length, right.length);
}

function score(candidate, place) {
  const expected = normalize(candidate.company), actual = normalize(place.name);
  let value = expected === actual ? 100 : expected.includes(actual) || actual.includes(expected) ? 80 : similarity(expected, actual) * 70;
  const address = place.formatted_address?.toLowerCase() || '';
  if (address.includes(candidate.city.toLowerCase())) value += 10;
  if (new RegExp(`(?:,|\\s)${candidate.state}(?:\\s|$)`, 'i').test(place.formatted_address || '')) value += 5;
  if (place.business_status === 'OPERATIONAL') value += 3;
  return Number(value.toFixed(1));
}

async function search(candidate) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  url.searchParams.set('query', `${candidate.company}, ${candidate.address}, ${candidate.city}, ${candidate.state} ${candidate.postalCode}`);
  url.searchParams.set('key', apiKey);
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || !['OK', 'ZERO_RESULTS'].includes(payload.status)) throw new Error(`Places search failed ${response.status}/${payload.status}: ${payload.error_message || candidate.company}`);
  const ranked = (payload.results || []).map(place => ({ place, score: score(candidate, place) })).sort((a, b) => b.score - a.score);
  if (!ranked.length) return { score: 0, place: null, alternatives: [] };
  const best = ranked[0];
  const detailUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  detailUrl.searchParams.set('place_id', best.place.place_id);
  detailUrl.searchParams.set('fields', 'place_id,name,formatted_address,geometry,formatted_phone_number,website,business_status,type,url,plus_code');
  detailUrl.searchParams.set('key', apiKey);
  const detailResponse = await fetch(detailUrl);
  const detailPayload = await detailResponse.json();
  const place = detailResponse.ok && detailPayload.status === 'OK' ? detailPayload.result : best.place;
  return {
    score: score(candidate, place),
    place: {
      placeId: place.place_id || '', name: place.name || '', formattedAddress: place.formatted_address || '',
      latitude: place.geometry?.location?.lat, longitude: place.geometry?.location?.lng,
      phone: place.formatted_phone_number || '', website: place.website || '',
      businessStatus: place.business_status || '', primaryType: place.types?.[0] || '',
      googleMapsUrl: place.url || '', plusCode: place.plus_code?.global_code || place.plus_code?.compound_code || ''
    },
    alternatives: ranked.slice(1, 3).map(match => ({ name: match.place.name, address: match.place.formatted_address, score: match.score, placeId: match.place.place_id }))
  };
}

const directory = JSON.parse(await readFile(inputFile, 'utf8'));
const targets = directory.candidates.filter(candidate => candidate.relevance.startsWith('Likely'));
let state = { generatedAt: null, completedKeys: [], records: [] };
try { state = JSON.parse(await readFile(outputFile, 'utf8')); } catch {}
const completed = new Set(state.completedKeys || []);
const records = new Map((state.records || []).map(record => [record.key, record]));
let processed = 0;

for (const candidate of targets) {
  const key = `${normalize(candidate.company)}|${normalize(candidate.address)}|${candidate.city.toLowerCase()}|${candidate.state}`;
  if (completed.has(key)) continue;
  if (processed >= limit) break;
  processed++;
  const result = await search(candidate);
  records.set(key, {
    key, directory: candidate, places: result.place, matchScore: result.score,
    reviewStatus: result.score >= 105 && result.place?.businessStatus === 'OPERATIONAL' ? 'Strong current match - eligible for review' : 'Manual review required',
    alternatives: result.alternatives, researchedAt: new Date().toISOString()
  });
  completed.add(key);
  state = { generatedAt: new Date().toISOString(), targetCount: targets.length, completedKeys: [...completed], records: [...records.values()] };
  await mkdir(resolve('research'), { recursive: true });
  await writeFile(outputFile, JSON.stringify(state, null, 2) + '\n');
  await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
}
console.log(`Enriched ${processed} image-directory locations; ${completed.size}/${targets.length} complete.`);
