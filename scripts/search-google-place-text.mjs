const query = process.argv.slice(2).join(' ').trim();
const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

if (!query) throw new Error('Usage: node --env-file=.env scripts/search-google-place-text.mjs <query>');
if (!apiKey) throw new Error('Set GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY.');

const searchUrl = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
searchUrl.searchParams.set('query', query);
searchUrl.searchParams.set('key', apiKey);

const searchResponse = await fetch(searchUrl);
const searchPayload = await searchResponse.json();
if (!searchResponse.ok || !['OK', 'ZERO_RESULTS'].includes(searchPayload.status)) {
  throw new Error(`Places search failed ${searchResponse.status}/${searchPayload.status}: ${searchPayload.error_message || 'Unknown error'}`);
}

const results = [];
for (const result of (searchPayload.results || []).slice(0, 10)) {
  const detailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  detailsUrl.searchParams.set('place_id', result.place_id);
  detailsUrl.searchParams.set('fields', 'place_id,name,formatted_address,geometry,formatted_phone_number,website,business_status,type,url');
  detailsUrl.searchParams.set('key', apiKey);
  const detailsResponse = await fetch(detailsUrl);
  const detailsPayload = await detailsResponse.json();
  const details = detailsPayload.status === 'OK' ? detailsPayload.result : result;
  results.push({
    placeId: result.place_id,
    name: details.name || result.name || '',
    formattedAddress: details.formatted_address || result.formatted_address || '',
    latitude: details.geometry?.location?.lat ?? result.geometry?.location?.lat ?? null,
    longitude: details.geometry?.location?.lng ?? result.geometry?.location?.lng ?? null,
    phone: details.formatted_phone_number || '',
    website: details.website || '',
    businessStatus: details.business_status || result.business_status || '',
    types: details.types || result.types || [],
    googleMapsUrl: details.url || `https://www.google.com/maps/place/?q=place_id:${result.place_id}`
  });
}

console.log(JSON.stringify({ query, status: searchPayload.status, resultCount: results.length, results }, null, 2));
