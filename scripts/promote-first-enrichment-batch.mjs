import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const CANDIDATE_FILE = resolve('research/existing-provider-enrichment-candidates.json');
const autoSafeRemainder = process.argv.includes('--auto-safe-remainder');
const FIRST_REPORT_FILE = resolve('reports/enrichment-promotion-2026-06-24.json');
const REPORT_FILE = resolve(autoSafeRemainder ? 'reports/enrichment-promotion-remainder-2026-06-24.json' : 'reports/enrichment-promotion-2026-06-24.json');
const APPROVED_KEYS = new Set([
  'DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv|2',
  'DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv|62',
  'DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv|86',
  'DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv|143',
  'data/Dickinson_ND_Corridor_Discovery_V2_20.csv|2',
  'data/Dickinson_ND_Corridor_Discovery_V2_20.csv|4',
  'data/Dickinson_ND_Corridor_Discovery_V2_20.csv|5',
  'data/Dickinson_ND_Corridor_Discovery_V2_20.csv|6',
  'data/Dickinson_ND_Corridor_Discovery_V2_20.csv|7',
  'DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv|222',
  'DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv|352',
  'DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv|401',
  'DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv|471'
]);

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
  return { headers, records: rows.map(values => Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()]))) };
}

function csvCell(value = '') {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function stringifyCSV(headers, records) {
  return [headers.join(','), ...records.map(record => headers.map(header => csvCell(record[header])).join(','))].join('\r\n') + '\r\n';
}

function parseAddress(formattedAddress, fallbackCity, fallbackState) {
  const parts = formattedAddress.replace(/,\s*USA$/i, '').split(',').map(part => part.trim()).filter(Boolean);
  const stateZip = parts.at(-1)?.match(/^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);
  if (!stateZip || parts.length < 3) return { address: formattedAddress, city: fallbackCity, state: fallbackState };
  return { address: parts.slice(0, -2).join(', '), city: parts.at(-2), state: stateZip[1], zip: stateZip[2] || '' };
}

function appendUnique(existing, additions) {
  const values = [...String(existing || '').split(/\s*;\s*/), ...additions].map(value => value.trim()).filter(Boolean);
  return [...new Set(values)].join(' ; ');
}

function normalize(value = '') {
  return value.toLowerCase()
    .replace(/\b(incorporated|corporation|company|limited|services?|inc|corp|llc|ltd|co)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function isSafeAutomaticMatch(candidate) {
  if (!candidate.suggested || candidate.suggested.businessStatus !== 'OPERATIONAL') return false;
  if (normalize(candidate.existing.company) !== normalize(candidate.suggested.name)) return false;
  const address = candidate.suggested.formattedAddress || '';
  return address.toLowerCase().includes(candidate.existing.city.toLowerCase())
    && new RegExp(`(?:,|\\s)${candidate.existing.state}(?:\\s|$)`, 'i').test(address);
}

const state = JSON.parse(await readFile(CANDIDATE_FILE, 'utf8'));
const batch = autoSafeRemainder ? state.candidates : state.candidates.slice(0, 50);
let previouslyPromoted = new Set();
if (autoSafeRemainder) {
  try {
    const prior = JSON.parse(await readFile(FIRST_REPORT_FILE, 'utf8'));
    previouslyPromoted = new Set(prior.promoted.map(item => item.key));
  } catch {}
}
const byFile = new Map();
const promoted = [];
const held = [];

for (const candidate of batch) {
  if (previouslyPromoted.has(candidate.key)) continue;
  const approved = APPROVED_KEYS.has(candidate.key) || (autoSafeRemainder && isSafeAutomaticMatch(candidate));
  if (!approved) {
    held.push({
      key: candidate.key,
      company: candidate.existing.company,
      suggestedName: candidate.suggested?.name || '',
      suggestedAddress: candidate.suggested?.formattedAddress || '',
      businessStatus: candidate.suggested?.businessStatus || '',
      matchScore: candidate.matchScore,
      reason: /CLOSED/.test(candidate.suggested?.businessStatus || '') ? 'Closed profile requires disposition review' : 'Identity, branch, or location match requires manual corroboration'
    });
    continue;
  }
  if (!candidate.suggested || candidate.suggested.businessStatus !== 'OPERATIONAL') throw new Error(`Approved candidate is not operational: ${candidate.key}`);
  if (!byFile.has(candidate.sourceFile)) {
    byFile.set(candidate.sourceFile, parseCSV(await readFile(resolve(candidate.sourceFile), 'utf8')));
  }
  const file = byFile.get(candidate.sourceFile);
  const record = file.records[candidate.sourceRow - 2];
  if (!record || record['Company Name'] !== candidate.existing.company) throw new Error(`Source row changed for ${candidate.key}`);
  const found = candidate.suggested;
  const location = parseAddress(found.formattedAddress, record.City, record.State);
  const prior = { address: record.Address, city: record.City, state: record.State, phone: record.Phone, website: record.Website, latitude: record.Latitude, longitude: record.Longitude };
  if (!record['Original Latitude']) record['Original Latitude'] = record.Latitude;
  if (!record['Original Longitude']) record['Original Longitude'] = record.Longitude;
  record.Address = location.address;
  record.City = location.city;
  record.State = location.state;
  if (found.phone) record.Phone = found.phone;
  if (found.website) record.Website = found.website;
  record.Latitude = String(found.latitude);
  record.Longitude = String(found.longitude);
  record['Map Status'] = 'Public business profile address and Google Places geocode';
  record['Verification Status'] = 'Google Places map-profile enriched 2026-06-24; company-source service verification pending';
  record['Source URL'] = appendUnique(record['Source URL'], [found.googleMapsUrl, found.website]);
  record.Notes = appendUnique(record.Notes, [`Google Places profile matched ${found.name}; ${found.formattedAddress}; ${found.phone || 'phone not listed'}; status ${found.businessStatus}; researched 2026-06-24`]);
  record['Location Role / Satellite Type'] = 'Map-profile-enriched provider';
  record['Duplicate Cleanup Action'] = appendUnique(record['Duplicate Cleanup Action'], ['Replaced placeholder location/contact fields with reviewed Google Places profile 2026-06-24']);
  record['Address Completeness'] = 'Public street address / Google Places geocode';
  record['Hover Separation Group'] = `${found.latitude}|${found.longitude}`;
  record['Hover Group Size'] = '1';
  record['Map Behavior'] = 'Single marker; tooltip opens on click';
  promoted.push({ key: candidate.key, company: record['Company Name'], prior, applied: { address: record.Address, city: record.City, state: record.State, phone: record.Phone, website: record.Website, latitude: record.Latitude, longitude: record.Longitude }, source: found.googleMapsUrl });
}

for (const [sourceFile, file] of byFile) await writeFile(resolve(sourceFile), stringifyCSV(file.headers, file.records), 'utf8');
await mkdir(resolve('reports'), { recursive: true });
await writeFile(REPORT_FILE, JSON.stringify({
  generatedAt: new Date().toISOString(),
  batchSize: batch.length,
  previouslyPromotedCount: previouslyPromoted.size,
  reviewedThisRun: promoted.length + held.length,
  promotedCount: promoted.length,
  heldCount: held.length,
  policy: 'Only reviewed operational identity/location matches were promoted. Ambiguous and closed results remain held.',
  promoted,
  held
}, null, 2) + '\n');
console.log(`Reconciled ${batch.length} candidates: promoted ${promoted.length}, held ${held.length}.`);
