import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const DATA_FILES = [
  'DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv',
  'data/Gillette_WY_Corridor_Discovery_V2_20.csv',
  'data/Dickinson_ND_Corridor_Discovery_V2_20.csv',
  'data/Nine_Energy_All_US_Locations_2026-06-22.csv',
  'data/Stoneham_Drilling_WESC_Locations_2026-06-22.csv',
  'data/Montana_Association_Guide_Discovery_2026-06-22.csv',
  'data/PIOGA_2025_2026_Directory_Providers_2026-06-24.csv'
];

const headers = [
  'Company Name',
  'Primary Category',
  'Vendor Scale',
  'Local Vendor Priority',
  'Address',
  'City',
  'State',
  'Phone',
  'Website',
  'Latitude',
  'Longitude',
  'Map Status',
  'Priority',
  'Verification Status',
  'Source URL',
  'Notes',
  'Oilfield Specific Fit',
  'Location Role / Satellite Type',
  'Expansion Source',
  'Original Latitude',
  'Original Longitude',
  'Map Offset Applied',
  'Duplicate Cleanup Action',
  'Address Completeness',
  'Hover Separation Group',
  'Hover Group Size',
  'Map Behavior'
];

const inputFile = resolve('research/nationwide-discovery-review-enriched.json');
const outputFile = resolve('data/Nationwide_Google_Places_Discovery_Batch_1_2026-06-25.csv');
const reportFile = resolve('reports/nationwide-discovery-batch-1-promotion-2026-06-25.json');

const explicitOilGas = /\b(oilfield|oil field|gasfield|gas field|oil\s*&\s*gas|oil and gas|drilling fluids|frac|fracturing|wireline|slickline|cementing|roustabout|workover|flowback|saltwater|brine|pipeline|midstream|artificial lift|downhole|well service|well services|completion|pressure pumping)\b/i;
const hardOilGas = /\b(oilfield|oil field|gasfield|gas field|oil\s*&\s*gas|oil and gas|oil well|drilling fluids|frac|fracturing|wireline|slickline|cementing|roustabout|workover|flowback|saltwater|brine|pipeline|midstream|artificial lift|downhole|completion|pressure pumping)\b/i;
const operationalTerm = /\b(oilfield|oil field|gasfield|gas field|drilling fluids|frac|fracturing|wireline|slickline|cementing|roustabout|workover|flowback|saltwater|brine|pipeline|midstream|artificial lift|downhole|well service|well services|oil field services|oilfield services|completion|pressure pumping|pumpers?|swabbing)\b/i;
const holdTerm = /\b(water\s+well|geothermal|propane|plumbing|electric\b|tractor|farm|restaurant|hotel|motel|bank|insurance|law firm|attorney|realtor|real estate|church|school|convenience|grocery|tire|auto repair|car repair|campground|clothing|apartment|storage units?|utility|utilities)\b|waterwells?|water-wells?/i;
const waterWellPattern = /\b(well drilling|drilling\s*&\s*pump|drilling and pump|pump service|pump repair|water wells?|aqua\w*|sweetwater)\b|waterwells?|water-wells?/i;
const producerOrUtility = /\b(production company|exploration|e&p|operator\b|gas company|gas co\b|energy company|pipeline co\b|pipeline company\b|compressor station|station\b|atmos energy|spectra energy|tennessee gas pipeline|marathon pipeline|mid-valley pipeline)\b/i;

const existingRows = [];
for (const file of DATA_FILES) {
  const text = await readFile(resolve(file), 'utf8');
  parseCSV(text).forEach(row => existingRows.push(row));
}

const existingNameKeys = new Set(existingRows.map(row => normalize(row['Company Name'])).filter(Boolean));
const existingLocationKeys = new Set(existingRows.map(row => `${normalize(row['Company Name'])}|${round(row.Latitude)}|${round(row.Longitude)}`).filter(key => !key.startsWith('|')));

const data = JSON.parse(await readFile(inputFile, 'utf8'));
const promoted = [];
const held = [];
const seenBatch = new Set();

for (const candidate of data.candidates || []) {
  const details = candidate.details;
  const reason = holdReason(candidate, details);
  if (reason) {
    held.push(summary(candidate, details, reason));
    continue;
  }

  const name = details.name || candidate.name;
  const parsed = parseAddress(details.formattedAddress || candidate.formattedAddress);
  const lat = Number(details.latitude ?? candidate.latitude);
  const lng = Number(details.longitude ?? candidate.longitude);
  const nameKey = normalize(name);
  const locationKey = `${nameKey}|${round(lat)}|${round(lng)}`;
  if (existingNameKeys.has(nameKey) || existingLocationKeys.has(locationKey)) {
    held.push(summary(candidate, details, 'already represented in live master list by normalized company name/location'));
    continue;
  }
  if (seenBatch.has(locationKey)) {
    held.push(summary(candidate, details, 'duplicate within this nationwide discovery batch'));
    continue;
  }
  seenBatch.add(locationKey);

  const category = categorize(name, candidate, details);
  promoted.push({
    'Company Name': name,
    'Primary Category': category,
    'Vendor Scale': 'Google Places discovery lead',
    'Local Vendor Priority': priorityFor(candidate),
    'Address': parsed.street,
    'City': parsed.city,
    'State': parsed.state,
    'Phone': details.phone || '',
    'Website': cleanWebsite(details.website || ''),
    'Latitude': lat.toFixed(7),
    'Longitude': lng.toFixed(7),
    'Map Status': 'Google Places discovery exact map location; provider fit screened for oil/gas terms',
    'Priority': priorityFor(candidate),
    'Verification Status': 'Google Places Details enriched 2026-06-25; company-source verification still recommended before base-list merge',
    'Source URL': details.googleMapsUrl || candidate.googleMapsUrl || '',
    'Notes': `Promoted from nationwide Google Places discovery batch 1. Discovery score ${candidate.discoveryScore}; matched themes: ${(candidate.matchedThemes || []).join('; ')}. Places types: ${(details.types || []).join('; ')}.`,
    'Oilfield Specific Fit': oilfieldFit(name, category),
    'Location Role / Satellite Type': 'Google Places discovered provider location',
    'Expansion Source': 'Nationwide Google Places discovery batch 1 2026-06-25',
    'Original Latitude': '',
    'Original Longitude': '',
    'Map Offset Applied': '',
    'Duplicate Cleanup Action': 'Skipped if normalized company name or same geocoded company location already existed in live data',
    'Address Completeness': 'Public street address / Google Places geocode',
    'Hover Separation Group': `${lat.toFixed(6)}|${lng.toFixed(6)}`,
    'Hover Group Size': '1',
    'Map Behavior': 'Single marker; tooltip opens on click'
  });
}

await mkdir(resolve('data'), { recursive: true });
await mkdir(resolve('reports'), { recursive: true });
await writeFile(outputFile, toCSV(headers, promoted));
await writeFile(reportFile, JSON.stringify({
  generatedAt: new Date().toISOString(),
  inputFile,
  outputFile,
  reviewedDetailedLeadCount: (data.candidates || []).filter(candidate => candidate.details).length,
  promotedCount: promoted.length,
  heldCount: held.length,
  promoted: promoted.map(row => ({
    companyName: row['Company Name'],
    address: `${row.Address}, ${row.City}, ${row.State}`,
    phone: row.Phone,
    website: row.Website,
    category: row['Primary Category'],
    sourceUrl: row['Source URL']
  })),
  held
}, null, 2) + '\n');

console.log(`Promoted ${promoted.length} nationwide Google Places discovery leads.`);
console.log(`Held ${held.length} leads for manual/company-source review.`);
console.log(`CSV: ${outputFile}`);
console.log(`Report: ${reportFile}`);

function holdReason(candidate, details) {
  if (!details) return 'no Google Places Details record yet';
  if (candidate.discoveryTier !== 'strong-review') return 'not in strong-review tier';
  if (candidate.discoveryScore < 86) return 'discovery score below first-batch threshold';
  if (details.businessStatus && details.businessStatus !== 'OPERATIONAL') return `business status is ${details.businessStatus}`;
  const text = `${details.name || candidate.name || ''} ${details.formattedAddress || candidate.formattedAddress || ''} ${details.website || ''} ${(candidate.matchedThemes || []).join(' ')}`;
  const nameAndWebsite = `${details.name || candidate.name || ''} ${details.website || ''}`;
  if (holdTerm.test(nameAndWebsite) && !explicitOilGas.test(nameAndWebsite)) return 'likely adjacent/water-well/non-oilfield business; needs manual review';
  if (waterWellPattern.test(nameAndWebsite) && !hardOilGas.test(nameAndWebsite)) return 'likely water-well drilling/pump business; needs manual oil/gas fit review';
  if (producerOrUtility.test(details.name || candidate.name || '')) return 'appears to be operator/utility/pipeline owner rather than service provider';
  if (!operationalTerm.test(text)) return 'does not contain enough explicit oil/gas service language for auto-promotion';
  const lat = Number(details.latitude ?? candidate.latitude);
  const lng = Number(details.longitude ?? candidate.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'missing usable coordinates';
  const parsed = parseAddress(details.formattedAddress || candidate.formattedAddress);
  if (!parsed.city || !parsed.state) return 'could not parse city/state from Places address';
  return '';
}

function categorize(name, candidate, details) {
  const nameText = `${name} ${details.website || ''}`;
  const text = `${nameText} ${(candidate.matchedThemes || []).join(' ')} ${(details.types || []).join(' ')}`;
  if (/drilling fluids|mud/i.test(nameText)) return 'Drilling / Downhole / Fluids';
  if (/oilfield supply|oil field supply|supply/i.test(nameText)) return 'Supply / Equipment / Artificial Lift';
  if (/oilfield|oil field|well service|well services|swabbing|workover/i.test(nameText)) return 'Completions / Well Service / Pressure Pumping';
  if (/wireline|slickline|logging/i.test(nameText)) return 'Wireline / Logging / Intervention';
  if (/downhole|fishing tool|drilling/i.test(nameText)) return 'Drilling / Downhole / Fluids';
  if (/pipeline|midstream|integrity|ndt|inspection/i.test(text)) return 'Pipeline / Inspection / Integrity';
  if (/cement|frac|fracturing|pressure pumping|completion|workover|well service|well services|swabbing/i.test(text)) return 'Completions / Well Service / Pressure Pumping';
  if (/wireline|slickline|logging/i.test(text)) return 'Wireline / Logging / Intervention';
  if (/drilling fluids|mud|drilling|downhole|fishing tool/i.test(text)) return 'Drilling / Downhole / Fluids';
  if (/oilfield supply|supply|equipment|rental|pump|valve|artificial lift/i.test(text)) return 'Supply / Equipment / Artificial Lift';
  if (/water|fluid|disposal|saltwater|brine|vacuum/i.test(text)) return 'Water / Fluids / Disposal';
  if (/compress|measurement|meter/i.test(text)) return 'Compression / Measurement';
  return 'Oil & Gas Field Services / Industry Support';
}

function oilfieldFit(name, category) {
  if (/Oilfield|Oil Field|Gasfield|Well Service|Wireline|Cement|Frac|Downhole|Drilling Fluids/i.test(`${name} ${category}`)) {
    return 'Strong Google Places oil/gas provider fit; company-source verification still recommended';
  }
  return 'Probable oil/gas service fit from Google Places discovery themes; company-source verification recommended';
}

function priorityFor(candidate) {
  return candidate.discoveryScore >= 100 ? 'High' : 'Medium';
}

function parseAddress(value = '') {
  const parts = value.replace(/,\s*USA$/i, '').split(',').map(part => part.trim()).filter(Boolean);
  const stateZip = parts.at(-1) || '';
  const state = stateZip.match(/\b([A-Z]{2})\b/)?.[1] || '';
  return {
    street: parts.slice(0, -2).join(', ') || parts[0] || '',
    city: parts.length >= 2 ? parts.at(-2) : '',
    state
  };
}

function cleanWebsite(value = '') {
  if (/safer\.fmcsa\.dot\.gov/i.test(value)) return '';
  return /^https?:\/\//i.test(value) ? value : '';
}

function summary(candidate, details, reason) {
  return {
    name: details?.name || candidate.name,
    address: details?.formattedAddress || candidate.formattedAddress,
    discoveryScore: candidate.discoveryScore,
    discoveryTier: candidate.discoveryTier,
    reason
  };
}

function round(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(5) : '';
}

function normalize(value = '') {
  return value.toLowerCase()
    .replace(/\b(incorporated|corporation|company|limited|services?|service|inc|corp|llc|ltd|co)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

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
  const parsedHeaders = rows.shift().map(header => header.trim());
  return rows.map(values => Object.fromEntries(parsedHeaders.map((header, index) => [header, (values[index] || '').trim()])));
}

function toCSV(headerRow, rows) {
  return [
    headerRow.join(','),
    ...rows.map(row => headerRow.map(header => csvCell(row[header] ?? '')).join(','))
  ].join('\n') + '\n';
}

function csvCell(value = '') {
  const text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
