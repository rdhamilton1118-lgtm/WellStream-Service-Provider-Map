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
  'data/Capillary_Spooling_Oilfield_Profile_2026-06-30.csv'
  ,'data/Gillette_Oilfield_Exact_Search_Expansion_2026-06-30.csv'
];
const THEMES = [
  'oilfield services',
  'oilfield',
  'gasfield natural gas well services',
  'drilling workover wireline cementing services',
  'gas compression processing measurement methane services',
  'pipeline gathering integrity midstream construction',
  'oilfield supply pumps equipment rental',
  'water hauling environmental disposal oil gas',
  'hot shot trucking safety automation oil gas',
  'well service field services production support',
  'mobile well testing hydro testing pressure testing',
  'NDT inspection tubular pipeline integrity services',
  'pump and supply artificial lift production equipment',
  'engine compressor repair service oil gas',
  'roustabout welding fabrication facility services'
];
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const limitArg = [...args].find(arg => arg.startsWith('--limit-markets='));
const marketLimit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const themeArg = [...args].find(arg => arg.startsWith('--theme='));
const selectedThemes = themeArg ? [themeArg.slice('--theme='.length).trim()].filter(Boolean) : THEMES;
const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const resultFile = resolve('research/nationwide-discovery-candidates.json');
const manifestFile = resolve('reports/nationwide-discovery-manifest.json');
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
  const headers = rows.shift().map(h => h.trim());
  return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').trim()])));
}

const providers = (await Promise.all(DATA_FILES.map(file => readFile(resolve(file), 'utf8')))).flatMap(parseCSV);
const marketMap = new Map();
providers.forEach(provider => {
  const lat = Number(provider.Latitude), lng = Number(provider.Longitude);
  if (!provider.City || !provider.State || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const key = `${provider.City}|${provider.State}`;
  const market = marketMap.get(key) || { market: key, city: provider.City, state: provider.State, latitudes: [], longitudes: [], existingProviders: 0 };
  market.latitudes.push(lat); market.longitudes.push(lng); market.existingProviders++;
  marketMap.set(key, market);
});
const markets = [...marketMap.values()].map(market => ({
  market: market.market,
  city: market.city,
  state: market.state,
  latitude: market.latitudes.reduce((a, b) => a + b, 0) / market.latitudes.length,
  longitude: market.longitudes.reduce((a, b) => a + b, 0) / market.longitudes.length,
  existingProviders: market.existingProviders
})).sort((a, b) => a.existingProviders - b.existingProviders || a.market.localeCompare(b.market));

const manifest = {
  generatedAt: new Date().toISOString(),
  mode: dryRun ? 'dry-run' : 'live',
  marketCount: markets.length,
  queryThemes: selectedThemes,
  totalPlannedQueries: markets.length * selectedThemes.length,
  radiusMeters: 65000,
  markets
};
await mkdir(resolve('reports'), { recursive: true });
await mkdir(resolve('research'), { recursive: true });
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

if (dryRun) {
  console.log(`Dry run: ${manifest.marketCount} markets, ${manifest.totalPlannedQueries} planned searches.`);
  process.exit(0);
}
if (!apiKey) throw new Error('Set GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY), or run with --dry-run.');

let state = { generatedAt: null, completedQueries: [], candidates: [] };
try { state = JSON.parse(await readFile(resultFile, 'utf8')); } catch {}
const completed = new Set(state.completedQueries || []);
const candidates = new Map((state.candidates || []).map(candidate => [candidate.placeId, candidate]));
const existingNames = new Set(providers.map(p => normalize(p['Company Name'])));
let marketsTouched = 0;

for (const market of markets) {
  const pendingThemes = selectedThemes.filter(theme => !completed.has(`${market.market}|${theme}`));
  if (!pendingThemes.length) continue;
  if (marketsTouched >= marketLimit) break;
  marketsTouched++;
  for (const theme of pendingThemes) {
    const queryKey = `${market.market}|${theme}`;
    const places = await searchPlaces(theme, market, queryKey);
    for (const place of places) {
      const name = place.displayName?.text || '';
      if (!name || existingNames.has(normalize(name))) continue;
      const prior = candidates.get(place.id);
      candidates.set(place.id, {
        placeId: place.id,
        name,
        formattedAddress: place.formattedAddress || '',
        latitude: place.location?.latitude,
        longitude: place.location?.longitude,
        phone: place.nationalPhoneNumber || '',
        website: place.websiteUri || '',
        googleMapsUrl: place.googleMapsUri || '',
        businessStatus: place.businessStatus || '',
        primaryType: place.primaryType || '',
        anchorMarkets: [...new Set([...(prior?.anchorMarkets || []), market.market])],
        matchedThemes: [...new Set([...(prior?.matchedThemes || []), theme])],
        researchStatus: 'Discovery — requires oil/gas relevance and company-source verification'
      });
    }
    completed.add(queryKey);
    state = { generatedAt: new Date().toISOString(), completedQueries: [...completed], candidates: [...candidates.values()] };
    await writeFile(resultFile, JSON.stringify(state, null, 2) + '\n');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
const selectedCompleted = markets.reduce((count, market) => count + selectedThemes.filter(theme => completed.has(`${market.market}|${theme}`)).length, 0);
console.log(`Completed ${selectedCompleted}/${manifest.totalPlannedQueries} selected searches; staged ${candidates.size} unique candidates overall.`);

async function searchPlaces(theme, market, key) {
  if (useLegacyPlaces) return searchLegacyPlaces(theme, market);
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.websiteUri,places.businessStatus,places.primaryType,places.googleMapsUri'
    },
    body: JSON.stringify({
      textQuery: `${theme} near ${market.city}, ${market.state}`,
      locationBias: { circle: { center: { latitude: market.latitude, longitude: market.longitude }, radius: 65000 } },
      maxResultCount: 20
    })
  });
  if (response.ok) return (await response.json()).places || [];
  const errorText = await response.text();
  if (response.status === 403) {
    useLegacyPlaces = true;
    console.warn(`Places API (New) blocked for ${key}; using legacy Places Text Search.`);
    return searchLegacyPlaces(theme, market);
  }
  throw new Error(`Places search failed ${response.status} for ${key}: ${errorText}`);
}

async function searchLegacyPlaces(theme, market) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  url.searchParams.set('query', `${theme} near ${market.city}, ${market.state}`);
  url.searchParams.set('location', `${market.latitude},${market.longitude}`);
  url.searchParams.set('radius', '65000');
  url.searchParams.set('key', apiKey);
  let response; let payload;
  for (let attempt = 1; attempt <= 3; attempt++) {
    response = await fetch(url);
    payload = await response.json();
    if (response.ok && ['OK', 'ZERO_RESULTS'].includes(payload.status)) break;
    const transient = ['DEADLINE_EXCEEDED', 'UNKNOWN_ERROR', 'OVER_QUERY_LIMIT'].includes(payload.status);
    if (!transient || attempt === 3) throw new Error(`Legacy Places search failed ${response.status}/${payload.status}: ${payload.error_message || 'Unknown error'}`);
    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
  }
  return (payload.results || []).slice(0, 20).map(place => ({
    id: place.place_id,
    displayName: { text: place.name || '' },
    formattedAddress: place.formatted_address || '',
    location: place.geometry?.location ? { latitude: place.geometry.location.lat, longitude: place.geometry.location.lng } : undefined,
    nationalPhoneNumber: '',
    websiteUri: '',
    businessStatus: place.business_status || '',
    primaryType: place.types?.[0] || '',
    googleMapsUri: place.place_id ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}` : ''
  }));
}

function normalize(value = '') {
  return value.toLowerCase().replace(/\b(inc|llc|ltd|company|co|corporation|corp)\b/g, '').replace(/[^a-z0-9]/g, '');
}
