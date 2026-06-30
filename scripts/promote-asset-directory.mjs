import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const enrichedFile = resolve('research/pioga-image-directory-enriched.json');
const outputFile = resolve('data/PIOGA_2025_2026_Directory_Providers_2026-06-24.csv');
const reportFile = resolve('reports/pioga-image-directory-promotion-2026-06-24.json');
const baseFile = resolve('DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv');
const EXCLUDED_NON_PROVIDERS = /\b(?:NFP|Aon|Vineyard Oil & Gas)\b/i;
const HEADERS = ['Company Name','Primary Category','Vendor Scale','Local Vendor Priority','Address','City','State','Phone','Website','Latitude','Longitude','Map Status','Priority','Verification Status','Source URL','Notes','Oilfield Specific Fit','Location Role / Satellite Type','Expansion Source','Original Latitude','Original Longitude','Map Offset Applied','Duplicate Cleanup Action','Address Completeness','Hover Separation Group','Hover Group Size','Map Behavior'];

function normalize(value = '') {
  return value.toLowerCase().replace(/\b(incorporated|corporation|company|limited|services?|inc|corp|llc|ltd|co|pllc|pc|lp|llp)\b/g, '').replace(/[^a-z0-9]/g, '');
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
  return { address: parts.slice(0, -2).join(', '), city: parts.at(-2), state: stateZip[1] };
}

function validDirectoryPhone(value = '') {
  return /^\(\d{3}\)\s*\d{3}-\d{4}$/.test(value.trim());
}

function trustedWebsite(directory, place) {
  if (/^Bluewater,? Inc\.?$/i.test(directory.company)) return 'https://bluewateroilfield.com/';
  if (directory.website) return directory.website;
  return place.website || '';
}

function categoryFor(name) {
  const value = name.toLowerCase();
  if (/geolog|geophys/.test(value)) return 'Geoscience / Geophysical / Geological Consulting';
  if (/pipeline|trenchtech/.test(value)) return 'Pipeline Construction / Integrity / Equipment';
  if (/environmental|water|chemstream/.test(value)) return 'Environmental / Water / Chemical Services';
  if (/inspection|camera/.test(value)) return 'Inspection / Integrity / Camera Services';
  if (/equipment|cleveland brothers|vavco/.test(value)) return 'Oilfield / Pipeline Equipment & Supply';
  if (/tank/.test(value)) return 'Tank Fabrication / Field Equipment';
  if (/kodiak gas/.test(value)) return 'Gas Compression / Production Services';
  if (/consult|associates|engineering|technologies|thrasher|moody|alliance/.test(value)) return 'Consulting / Engineering / Field Services';
  return 'Oil & Gas Field Services / Industry Support';
}

const enrichment = JSON.parse(await readFile(enrichedFile, 'utf8'));
const eligible = enrichment.records.filter(record =>
  record.matchScore >= 105
  && record.places?.businessStatus === 'OPERATIONAL'
  && !EXCLUDED_NON_PROVIDERS.test(record.directory.company)
);
const skippedExisting = [];
const promoted = [];
const seen = new Set();

for (const record of eligible) {
  const directory = record.directory, place = record.places;
  const location = parseAddress(place.formattedAddress, directory.city, directory.state);
  if (!/^\d/.test(location.address) && /^\d/.test(directory.address)) location.address = directory.address;
  const exactExistingSameLocation = directory.existingMatch && normalize(directory.address) === normalize(location.address);
  if (exactExistingSameLocation || ['Toy Pipeline Contractors, Inc.', 'West Penn Energy Services'].includes(directory.existingMatch)) {
    skippedExisting.push({ company: directory.company, city: directory.city, state: directory.state, existingMatch: directory.existingMatch });
    continue;
  }
  const key = `${normalize(directory.company)}|${normalize(location.address)}|${location.city.toLowerCase()}|${location.state}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const sourceImages = directory.sourceImages || [directory.sourceImage];
  promoted.push({
    'Company Name': directory.company,
    'Primary Category': categoryFor(directory.company),
    'Vendor Scale': 'Regional',
    'Local Vendor Priority': 'Medium',
    Address: location.address,
    City: location.city,
    State: location.state,
    Phone: validDirectoryPhone(directory.phone) ? directory.phone : place.phone,
    Website: trustedWebsite(directory, place),
    Latitude: place.latitude,
    Longitude: place.longitude,
    'Map Status': 'PIOGA directory address corroborated by current Google Places geocode',
    Priority: 'Medium',
    'Verification Status': '2025-2026 PIOGA directory image plus current operational Google Places match; service-scope review ongoing',
    'Source URL': place.googleMapsUrl,
    Notes: `PIOGA directory image evidence: ${sourceImages.join(' ; ')}. Directory listed ${directory.address}, ${directory.city}, ${directory.state} ${directory.postalCode}; ${directory.phone || 'phone not listed'}; ${directory.website || 'website not listed'}. Google Places researched 2026-06-24.`,
    'Oilfield Specific Fit': 'Current PIOGA membership supports oil/gas industry relevance; exact service scope categorized from company identity and requires ongoing company-source review',
    'Location Role / Satellite Type': directory.existingMatch ? 'Additional association-sourced branch' : 'Association-sourced provider location',
    'Expansion Source': '2025-2026 PIOGA Membership Directory asset-image extraction',
    'Original Latitude': '', 'Original Longitude': '', 'Map Offset Applied': '',
    'Duplicate Cleanup Action': directory.existingMatch ? `Preserved separate branch from existing ${directory.existingMatch} location` : 'Deduplicated by directory address, phone, and current Places identity',
    'Address Completeness': 'Public street address / Google Places geocode',
    'Hover Separation Group': `${place.latitude}|${place.longitude}`,
    'Hover Group Size': '1', 'Map Behavior': 'Single marker; tooltip opens on click'
  });
}

await mkdir(resolve('data'), { recursive: true });
await writeFile(outputFile, stringifyCSV(HEADERS, promoted), 'utf8');

const base = parseCSV(await readFile(baseFile, 'utf8'));
const wellstream = base.records.find(record => record['Company Name'] === 'WellStream Solutions, LLC');
if (wellstream) {
  wellstream.Address = '6017 Atwood Dr, Ste 17';
  wellstream['Source URL'] = [...new Set([...wellstream['Source URL'].split(/\s*;\s*/), 'assets/Scan_20260624_160618.jpg'].filter(Boolean))].join(' ; ');
  wellstream.Notes = `${wellstream.Notes}${wellstream.Notes ? ' ; ' : ''}2025-2026 PIOGA directory image confirms 6017 Atwood Dr, Ste 17, Richmond, KY 40475 and (859) 200-0989.`;
  wellstream['Address Completeness'] = 'PIOGA directory street address; existing company-sourced coordinates retained';
  await writeFile(baseFile, stringifyCSV(base.headers, base.records), 'utf8');
}

await mkdir(resolve('reports'), { recursive: true });
await writeFile(reportFile, JSON.stringify({
  generatedAt: new Date().toISOString(), eligibleStrongOperationalCount: eligible.length,
  promotedLocationCount: promoted.length, skippedExistingLocationCount: skippedExisting.length,
  excludedPolicy: 'Non-provider directory members and ambiguous/weak/closed/no-result matches remain staged for review.',
  promoted: promoted.map(record => ({ company: record['Company Name'], address: record.Address, city: record.City, state: record.State, category: record['Primary Category'] })),
  skippedExisting
}, null, 2) + '\n');
console.log(`Promoted ${promoted.length} PIOGA image-directory locations; skipped ${skippedExisting.length} locations already live.`);
