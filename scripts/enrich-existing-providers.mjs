import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const DATA_FILES = [
  'DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv',
  'data/Gillette_WY_Corridor_Discovery_V2_20.csv',
  'data/Dickinson_ND_Corridor_Discovery_V2_20.csv',
  'data/Nine_Energy_All_US_Locations_2026-06-22.csv',
  'data/Stoneham_Drilling_WESC_Locations_2026-06-22.csv',
  'data/Montana_Association_Guide_Discovery_2026-06-22.csv',
  'data/PIOGA_2025_2026_Directory_Providers_2026-06-24.csv',
  'data/Nationwide_Google_Places_Discovery_Batch_1_2026-06-25.csv',
  'data/Great_Lakes_Wellhead_Locations_2026-06-25.csv',
  'data/Directional_Coring_Profile_Expansion_2026-06-30.csv',
  'data/NewKota_Profile_Expansion_2026-06-30.csv',
  'data/Action_Energy_Services_Gillette_2026-06-30.csv',
  'data/Capillary_Spooling_Oilfield_Profile_2026-06-30.csv',
  'data/Gillette_Oilfield_Exact_Search_Expansion_2026-06-30.csv',
  'data/Precision_Well_Service_Gillette_Correction_2026-06-30.csv'
];
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const limitArg = [...args].find(arg => arg.startsWith('--limit='));
const recordLimit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const queueFile = resolve('reports/existing-provider-enrichment-queue.json');
const resultFile = resolve('research/existing-provider-enrichment-candidates.json');
let useLegacyPlaces = false;

function parseCSV(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift().map(header => header.trim());
  return rows.map((values, index) => ({
    ...Object.fromEntries(headers.map((header, column) => [header, (values[column] || '').trim()])),
    sourceRow: index + 2
  }));
}

function normalize(value = '') {
  return value.toLowerCase()
    .replace(/\b(incorporated|corporation|company|limited|services?|inc|corp|llc|ltd|co)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function missingFields(provider) {
  const fields = [];
  const addressEvidence = `${provider.Address || ''} ${provider['Address Completeness'] || ''} ${provider['Map Status'] || ''}`;
  if (!provider.Address || /pending|needed|city[- ]level|city centroid|corridor|placeholder|extraction/i.test(addressEvidence)) fields.push('address');
  if (!provider.Phone || /pending|needed|confirm/i.test(provider.Phone)) fields.push('phone');
  if (!/^https?:\/\//i.test(provider.Website || '')) fields.push('website');
  return fields;
}

function priorityScore(provider) {
  const evidence = `${provider['Verification Status'] || ''} ${provider['Map Status'] || ''} ${provider['Source URL'] || ''} ${provider.Notes || ''}`;
  let score = provider.missingFields.length * 10;
  if (/map|maps|screenshot|user-provided|discovery lead/i.test(evidence)) score += 60;
  if (/corridor|exact address pending|city centroid/i.test(`${provider.Address || ''} ${provider['Address Completeness'] || ''}`)) score += 15;
  if (provider.missingFields.includes('phone')) score += 8;
  if (provider.missingFields.includes('website')) score += 6;
  return score;
}

function scoreMatch(provider, place) {
  const expected = normalize(provider['Company Name']);
  const actual = normalize(place.displayName?.text || '');
  let score = expected === actual ? 100 : expected.includes(actual) || actual.includes(expected) ? 82 : 0;
  if (place.formattedAddress?.toLowerCase().includes(provider.City.toLowerCase())) score += 10;
  if (place.formattedAddress?.toLowerCase().includes(provider.State.toLowerCase())) score += 5;
  if (place.businessStatus === 'OPERATIONAL') score += 3;
  return score;
}

async function searchLegacyPlaces(provider, lat, lng) {
  const searchUrl = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  searchUrl.searchParams.set('query', `${provider['Company Name']}, ${provider.City}, ${provider.State}`);
  searchUrl.searchParams.set('key', apiKey);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    searchUrl.searchParams.set('location', `${lat},${lng}`);
    searchUrl.searchParams.set('radius', '100000');
  }
  const searchResponse = await fetch(searchUrl);
  const searchPayload = await searchResponse.json();
  if (!searchResponse.ok || !['OK', 'ZERO_RESULTS'].includes(searchPayload.status)) {
    throw new Error(`Legacy Places search failed ${searchResponse.status}/${searchPayload.status}: ${searchPayload.error_message || 'Unknown error'}`);
  }
  const places = [];
  for (const result of (searchPayload.results || []).slice(0, 5)) {
    const detailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    detailsUrl.searchParams.set('place_id', result.place_id);
    detailsUrl.searchParams.set('fields', 'place_id,name,formatted_address,geometry,formatted_phone_number,website,business_status,type,url,plus_code');
    detailsUrl.searchParams.set('key', apiKey);
    const detailsResponse = await fetch(detailsUrl);
    const detailsPayload = await detailsResponse.json();
    if (!detailsResponse.ok || detailsPayload.status !== 'OK') continue;
    const place = detailsPayload.result;
    places.push({
      id: place.place_id,
      displayName: { text: place.name || '' },
      formattedAddress: place.formatted_address || '',
      location: place.geometry?.location ? { latitude: place.geometry.location.lat, longitude: place.geometry.location.lng } : undefined,
      nationalPhoneNumber: place.formatted_phone_number || '',
      websiteUri: place.website || '',
      businessStatus: place.business_status || '',
      primaryType: place.types?.[0] || '',
      googleMapsUri: place.url || '',
      plusCode: place.plus_code ? { globalCode: place.plus_code.global_code, compoundCode: place.plus_code.compound_code } : undefined
    });
  }
  return places;
}

async function searchPlaces(provider, body, lat, lng, key) {
  if (useLegacyPlaces) return searchLegacyPlaces(provider, lat, lng);
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.websiteUri,places.businessStatus,places.primaryType,places.googleMapsUri,places.plusCode'
    },
    body: JSON.stringify(body)
  });
  if (response.ok) return (await response.json()).places || [];
  const errorText = await response.text();
  if (response.status === 403) {
    useLegacyPlaces = true;
    console.warn(`Places API (New) blocked for ${key}; using legacy Places search and details.`);
    return searchLegacyPlaces(provider, lat, lng);
  }
  throw new Error(`Places enrichment failed ${response.status} for ${key}: ${errorText}`);
}

const providers = [];
for (const sourceFile of DATA_FILES) {
  const rows = parseCSV(await readFile(resolve(sourceFile), 'utf8'));
  rows.forEach(provider => providers.push({ ...provider, sourceFile }));
}
const targets = providers.map(provider => ({ ...provider, missingFields: missingFields(provider) }))
  .filter(provider => provider.missingFields.length)
  .map(provider => ({ ...provider, priorityScore: priorityScore(provider) }))
  .sort((a, b) => b.priorityScore - a.priorityScore || a.State.localeCompare(b.State) || a.City.localeCompare(b.City));

await mkdir(resolve('reports'), { recursive: true });
await mkdir(resolve('research'), { recursive: true });
await writeFile(queueFile, JSON.stringify({
  generatedAt: new Date().toISOString(),
  totalProviderCount: providers.length,
  enrichmentTargetCount: targets.length,
  missingAddressCount: targets.filter(target => target.missingFields.includes('address')).length,
  missingPhoneCount: targets.filter(target => target.missingFields.includes('phone')).length,
  missingWebsiteCount: targets.filter(target => target.missingFields.includes('website')).length,
  targets: targets.map(target => ({
    key: `${target.sourceFile}|${target.sourceRow}`,
    company: target['Company Name'], city: target.City, state: target.State,
    missingFields: target.missingFields, priorityScore: target.priorityScore,
    sourceFile: target.sourceFile, sourceRow: target.sourceRow
  }))
}, null, 2) + '\n');

if (dryRun) {
  console.log(`Dry run: ${targets.length} existing providers need enrichment.`);
  process.exit(0);
}
if (!apiKey) throw new Error('Set GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY), or run with --dry-run.');

let state = { generatedAt: null, completedKeys: [], candidates: [] };
try { state = JSON.parse(await readFile(resultFile, 'utf8')); } catch {}
const completed = new Set(state.completedKeys || []);
const candidates = new Map((state.candidates || []).map(candidate => [candidate.key, candidate]));
let processed = 0;

for (const provider of targets) {
  const key = `${provider.sourceFile}|${provider.sourceRow}`;
  if (completed.has(key)) continue;
  if (processed >= recordLimit) break;
  processed++;
  const lat = Number(provider.Latitude), lng = Number(provider.Longitude);
  const body = {
    textQuery: `${provider['Company Name']}, ${provider.City}, ${provider.State}`,
    maxResultCount: 5
  };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 100000 } };
  }
  const places = await searchPlaces(provider, body, lat, lng, key);
  const matches = places.map(place => ({ place, score: scoreMatch(provider, place) })).sort((a, b) => b.score - a.score);
  const best = matches[0];
  candidates.set(key, {
    key,
    sourceFile: provider.sourceFile,
    sourceRow: provider.sourceRow,
    existing: {
      company: provider['Company Name'], address: provider.Address, city: provider.City, state: provider.State,
      phone: provider.Phone, website: provider.Website, latitude: provider.Latitude, longitude: provider.Longitude
    },
    missingFields: provider.missingFields,
    matchScore: best?.score || 0,
    reviewStatus: best?.score >= 95 ? 'Strong map-profile match - review before promotion' : 'Manual review required',
    suggested: best ? {
      placeId: best.place.id,
      name: best.place.displayName?.text || '',
      formattedAddress: best.place.formattedAddress || '',
      latitude: best.place.location?.latitude,
      longitude: best.place.location?.longitude,
      phone: best.place.nationalPhoneNumber || '',
      website: best.place.websiteUri || '',
      businessStatus: best.place.businessStatus || '',
      primaryType: best.place.primaryType || '',
      googleMapsUrl: best.place.googleMapsUri || '',
      plusCode: best.place.plusCode?.globalCode || best.place.plusCode?.compoundCode || ''
    } : null,
    alternatives: matches.slice(1).map(match => ({ name: match.place.displayName?.text || '', address: match.place.formattedAddress || '', score: match.score, googleMapsUrl: match.place.googleMapsUri || '' })),
    researchedAt: new Date().toISOString()
  });
  completed.add(key);
  state = { generatedAt: new Date().toISOString(), completedKeys: [...completed], candidates: [...candidates.values()] };
  await writeFile(resultFile, JSON.stringify(state, null, 2) + '\n');
  await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
}

console.log(`Enriched ${processed} records this run; ${completed.size}/${targets.length} targets researched.`);
