import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const OCR_DIR = resolve('research/asset-ocr');
const OUTPUT_FILE = resolve('research/pioga-image-directory-candidates.json');
const DATA_FILES = [
  'DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv',
  'data/Gillette_WY_Corridor_Discovery_V2_20.csv',
  'data/Dickinson_ND_Corridor_Discovery_V2_20.csv',
  'data/Nine_Energy_All_US_Locations_2026-06-22.csv',
  'data/Stoneham_Drilling_WESC_Locations_2026-06-22.csv',
  'data/Montana_Association_Guide_Discovery_2026-06-22.csv'
];
const NAME_CORRECTIONS = new Map([
  ['BAKER TILLY US, UP', 'Baker Tilly US, LLP'],
  ['OILFIELD EQUIPMENT CORPORATION', 'B&B Oilfield Equipment Corporation'],
  ['MUSTANG SAMPLINGIVALTRONICS', 'Mustang Sampling / Valtronics'],
  ['MUSTANG SAMPLING/VALTRONICS', 'Mustang Sampling / Valtronics'],
  ['PRECISION GEOPHYSCIAL, INC.', 'Precision Geophysical, Inc.'],
  ['IGS ENEGY PRODUCER SERVICES, INC', 'IGS Energy Producer Services, Inc.'],
  ['NFR AN AON COMPANY', 'NFP, an Aon company']
]);
const COMPANY_EXCLUSIONS = /^(ALLIES|PHONE|FAX|EMAIL|DIRECT PHONE|EXT\b|ADDITIONAL LOCATION|PO\.? BOX|P\.O\.|HTTP|WWW|STE\b|SUITE\b|ROUTE\b|\d|OOS$|VII|RESOURCES$|COMPANY$|CORPORATION$|AL REAL ESTATE$)/i;
const CITY_STATE = /^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i;

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
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()])));
}

function normalize(value = '') {
  return value.toLowerCase().replace(/\b(incorporated|corporation|company|limited|services?|inc|corp|llc|ltd|co|pllc|pc|lp|llp)\b/g, '').replace(/[^a-z0-9]/g, '');
}

function similarity(left, right) {
  if (!left || !right) return 0;
  const rows = Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let column = 1; column <= right.length; column++) {
    let diagonal = rows[0]; rows[0] = column;
    for (let row = 1; row <= left.length; row++) {
      const prior = rows[row];
      rows[row] = Math.min(rows[row] + 1, rows[row - 1] + 1, diagonal + (left[row - 1] === right[column - 1] ? 0 : 1));
      diagonal = prior;
    }
  }
  return 1 - rows[left.length] / Math.max(left.length, right.length);
}

function normalizedPhone(value = '') {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function applyVisualCorrections(entry) {
  const address = entry.address.toLowerCase();
  if (/4565 william penn|1307 south 2nd|5300 paxton/.test(address)) entry.company = 'Cleveland Brothers Equipment Company';
  if (/700 cherrington/.test(address)) entry.company = 'Civil & Environmental Consultants, Inc.';
  if (/8791 route 22/.test(address)) entry.company = 'B&B Oilfield Equipment Corporation';
  if (/p\.o\. box 2407|20\. box 2407/.test(address)) entry.company = 'Baker Tilly US, LLP';
  return entry;
}

function isHeading(line) {
  if (!line || line.length < 3 || COMPANY_EXCLUSIONS.test(line)) return false;
  const letters = line.match(/[A-Za-z]/g) || [];
  if (letters.length < 2) return false;
  const uppercase = letters.filter(letter => letter === letter.toUpperCase()).length / letters.length;
  return uppercase >= .96 && !/@/.test(line) && !/\b(?:PA|WV|OH|NY|MT|MI|TX|KY|ND|WY)\s+\d{5}/.test(line);
}

function cleanName(name) {
  const cleaned = name.replace(/^[-•o\s]+/, '').replace(/\s+/g, ' ').trim();
  return NAME_CORRECTIONS.get(cleaned.toUpperCase()) || cleaned.toLowerCase().replace(/(^|[\s&/()-])([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase());
}

function websiteFrom(lines) {
  const line = lines.find(value => /(?:https?:|www\.|\b[a-z0-9-]+\.(?:com|net|org|co)\b)/i.test(value) && !/@/.test(value));
  if (!line) return '';
  let value = line.replace(/^.*?(?=(?:https?|www\.|[a-z0-9-]+\.(?:com|net|org|co)))/i, '').replace(/\s+/g, '').replace(/[.,;]+$/, '');
  value = value.replace(/^https?[:â€¢·/\\]*/i, 'https://').replace(/^www\./i, 'https://www.');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  return value;
}

function relevanceFor(name, block) {
  const text = `${name} ${block.join(' ')}`.toLowerCase();
  const strong = /oilfield|oil & gas|pipeline|well service|drilling|geolog|geophys|gas service|compression|compressor|tank|inspection|environmental|energy service|natural gas|water solution|welding|equipment|controls|ccs|sequestration/;
  const adjacent = /engineering|consult|construction|safety|fabrication|lubricant|trailer|survey|aerial|drone|seed|insurance|law|account|bank|communications/;
  return strong.test(text) ? 'Likely oil/gas provider or industry ally' : adjacent.test(text) ? 'Industry-adjacent — service-scope review required' : 'Directory member — relevance review required';
}

const existing = (await Promise.all(DATA_FILES.map(async file => parseCSV(await readFile(resolve(file), 'utf8'))))).flat();
const existingByName = new Map(existing.map(provider => [normalize(provider['Company Name']), provider]));
const textFiles = (await readdir(OCR_DIR)).filter(file => file.endsWith('.txt')).sort();
const extracted = [];

for (const textFile of textFiles) {
  const lines = (await readFile(resolve(OCR_DIR, textFile), 'utf8')).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  let currentCompany = '';
  let lastCompany = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (isHeading(line)) {
      currentCompany = cleanName(line);
      lastCompany = currentCompany;
      continue;
    }
    if (/^ADDITIONAL LOCATION/i.test(line)) {
      const named = line.split(/[-—â€”]/).slice(1).join('-').trim();
      currentCompany = named ? cleanName(named) : lastCompany;
      continue;
    }
    const location = line.match(CITY_STATE);
    if (!location || !currentCompany) continue;
    let headingIndex = index - 1;
    while (headingIndex >= 0 && cleanName(lines[headingIndex]) !== currentCompany && index - headingIndex <= 8) headingIndex--;
    if (headingIndex < 0 || index - headingIndex > 8) headingIndex = Math.max(0, index - 2);
    const addressLines = lines.slice(headingIndex + 1, index).filter(value => !/^ADDITIONAL LOCATION/i.test(value) && !isHeading(value));
    const following = lines.slice(index + 1, Math.min(lines.length, index + 12));
    const phoneLine = following.find(value => /^Phone:/i.test(value));
    const faxLine = following.find(value => /^Fax:?/i.test(value));
    const entry = applyVisualCorrections({
      company: currentCompany,
      address: addressLines.join(', '),
      city: location[1].trim(),
      state: location[2].toUpperCase(),
      postalCode: location[3],
      phone: phoneLine?.replace(/^Phone:\s*/i, '').trim() || '',
      fax: faxLine?.replace(/^Fax:?\s*/i, '').trim() || '',
      website: websiteFrom(following),
      sourceImage: `assets/${basename(textFile, '.txt')}.jpg`,
      sourceText: `research/asset-ocr/${textFile}`,
      evidence: '2025-2026 PIOGA Membership Directory image OCR; visual confirmation required before promotion'
    });
    const normalizedName = normalize(entry.company);
    const exact = existingByName.get(normalizedName);
    let possible = exact ? { provider: exact, score: 1 } : null;
    if (!possible) {
      for (const provider of existing) {
        const score = similarity(normalizedName, normalize(provider['Company Name']));
        if (score >= .78 && (!possible || score > possible.score)) possible = { provider, score };
      }
    }
    entry.existingMatch = exact?.['Company Name'] || '';
    entry.possibleExistingMatch = possible?.provider?.['Company Name'] || '';
    entry.possibleExistingMatchScore = possible ? Number(possible.score.toFixed(3)) : 0;
    entry.relevance = relevanceFor(entry.company, [...addressLines, ...following]);
    extracted.push(entry);
  }
}

const deduplicated = new Map();
for (const entry of extracted) {
  const phone = normalizedPhone(entry.phone);
  const key = phone ? `${phone}|${entry.city.toLowerCase()}|${entry.state}` : `${normalize(entry.address)}|${entry.city.toLowerCase()}|${entry.state}`;
  const prior = deduplicated.get(key);
  if (!prior) deduplicated.set(key, { ...entry, sourceImages: [entry.sourceImage], sourceTexts: [entry.sourceText] });
  else {
    prior.sourceImages = [...new Set([...prior.sourceImages, entry.sourceImage])];
    prior.sourceTexts = [...new Set([...prior.sourceTexts, entry.sourceText])];
    if ((!prior.website && entry.website) || normalize(entry.company).length > normalize(prior.company).length) {
      const sources = { sourceImages: prior.sourceImages, sourceTexts: prior.sourceTexts };
      deduplicated.set(key, { ...entry, ...sources });
    }
  }
}
const candidates = [...deduplicated.values()].sort((a, b) => a.company.localeCompare(b.company) || a.city.localeCompare(b.city));
await mkdir(resolve('research'), { recursive: true });
await writeFile(OUTPUT_FILE, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: '2025-2026 PIOGA Membership Directory scans supplied in assets',
  scannedImageCount: textFiles.length,
  rawLocationCount: extracted.length,
  deduplicatedLocationCount: candidates.length,
  existingMasterListMatchCount: candidates.filter(candidate => candidate.existingMatch).length,
  possibleExistingMasterListMatchCount: candidates.filter(candidate => !candidate.existingMatch && candidate.possibleExistingMatch).length,
  newCandidateCount: candidates.filter(candidate => !candidate.existingMatch && !candidate.possibleExistingMatch).length,
  policy: 'OCR-derived candidates require visual confirmation and current web verification before live-map promotion.',
  candidates
}, null, 2) + '\n');
console.log(`Extracted ${extracted.length} location rows; ${candidates.length} remain after deduplication.`);
