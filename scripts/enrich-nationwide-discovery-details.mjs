import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const limitArg = [...args].find(arg => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 200;
const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
if (!apiKey) throw new Error('Set GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY.');

const inputFile = resolve('research/nationwide-discovery-review.json');
const outputFile = resolve('research/nationwide-discovery-review-enriched.json');
const reportFile = resolve('reports/nationwide-discovery-details-summary.json');

const data = JSON.parse(await readFile(inputFile, 'utf8'));
let prior = { details: {} };
try { prior = JSON.parse(await readFile(outputFile, 'utf8')); } catch {}
const detailMap = new Map(Object.entries(prior.details || {}));

const targets = (data.candidates || [])
  .filter(candidate => candidate.discoveryTier === 'strong-review')
  .filter(candidate => candidate.placeId && !detailMap.has(candidate.placeId))
  .slice(0, limit);

for (const candidate of targets) {
  const details = await getDetails(candidate.placeId);
  detailMap.set(candidate.placeId, {
    placeId: candidate.placeId,
    name: details.name || candidate.name,
    formattedAddress: details.formatted_address || candidate.formattedAddress,
    latitude: details.geometry?.location?.lat ?? candidate.latitude,
    longitude: details.geometry?.location?.lng ?? candidate.longitude,
    phone: details.formatted_phone_number || '',
    website: details.website || '',
    googleMapsUrl: details.url || candidate.googleMapsUrl,
    businessStatus: details.business_status || candidate.businessStatus,
    types: details.types || [],
    source: 'Google Places Details'
  });
  await writeOutputs();
  await new Promise(resolve => setTimeout(resolve, 120));
}

await writeOutputs();
console.log(`Enriched ${targets.length} nationwide discovery leads; total detailed leads: ${detailMap.size}.`);

async function getDetails(placeId) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'place_id,name,formatted_address,geometry,formatted_phone_number,website,business_status,type,url');
  url.searchParams.set('key', apiKey);
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.status !== 'OK') {
    throw new Error(`Place Details failed ${response.status}/${payload.status} for ${placeId}: ${payload.error_message || 'Unknown error'}`);
  }
  return payload.result;
}

async function writeOutputs() {
  const details = Object.fromEntries([...detailMap.entries()].sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '')));
  const enrichedCandidates = (data.candidates || []).map(candidate => ({
    ...candidate,
    details: detailMap.get(candidate.placeId) || null
  }));
  const report = {
    generatedAt: new Date().toISOString(),
    detailedLeadCount: detailMap.size,
    withPhoneCount: [...detailMap.values()].filter(item => item.phone).length,
    withWebsiteCount: [...detailMap.values()].filter(item => item.website).length,
    remainingStrongWithoutDetails: enrichedCandidates.filter(candidate => candidate.discoveryTier === 'strong-review' && !candidate.details).length
  };
  await mkdir(resolve('research'), { recursive: true });
  await mkdir(resolve('reports'), { recursive: true });
  await writeFile(outputFile, JSON.stringify({ generatedAt: new Date().toISOString(), sourceFile: inputFile, details, candidates: enrichedCandidates }, null, 2) + '\n');
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
}
