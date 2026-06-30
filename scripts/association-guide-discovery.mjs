import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceArg = process.argv.find(arg => arg.startsWith('--source='))?.split('=')[1];
const limitArg = Number(process.argv.find(arg => arg.startsWith('--limit-categories='))?.split('=')[1] || 0);
const normalizeOnly = process.argv.includes('--normalize-only');
const registry = JSON.parse(await readFile(resolve('research/association-guide-sources.json'), 'utf8'));
const sources = registry.filter(source => source.enabled && (!sourceArg || source.id === sourceArg));
const relevant = /drill|oilfield|gas field|gas compressor|gas measurement|gas process|natural gas analy|wireline|logging|well servic|workover|coiled tubing|pipeline|construction|equipment|suppl|rental|environment|trucking|transport|machine service|inspection|testing|cement|pump|chemical|safety|automation|measurement/i;
const outputFile = resolve('research/association-guide-candidates.json');
const masterFiles = [
  'DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv',
  'data/Gillette_WY_Corridor_Discovery_V2_20.csv',
  'data/Dickinson_ND_Corridor_Discovery_V2_20.csv',
  'data/Nine_Energy_All_US_Locations_2026-06-22.csv',
  'data/Stoneham_Drilling_WESC_Locations_2026-06-22.csv',
  'data/Montana_Association_Guide_Discovery_2026-06-22.csv'
];
const existingProviders = (await Promise.all(masterFiles.map(file => readFile(resolve(file), 'utf8')))).flatMap(parseCSV);
const existingNames = new Map(existingProviders.flatMap(provider => {
  const name = provider['Company Name'];
  return [[normalize(name), name], [normalize(name.split(/\s+-\s+/)[0]), name]];
}));
let prior = { generatedAt: null, sources: {}, candidates: [] };
try { prior = JSON.parse(await readFile(outputFile, 'utf8')); } catch {}
const candidates = new Map((prior.candidates || []).map(candidate => [candidate.key, candidate]));

if (normalizeOnly) {
  prior.candidates = (prior.candidates || []).map(candidate => ({
    ...candidate,
    categories: [...new Set((candidate.categories || []).map(normalizeCategory).filter(Boolean))]
  }));
  await writeOutputs(prior);
  console.log(`Normalized ${prior.candidates.length} association-guide candidates.`);
  process.exit(0);
}

for (const source of sources) {
  console.log(`Reading ${source.association}…`);
  try {
    const homepage = await get(source.baseUrl);
    let categories = extractLinks(homepage)
      .map(link => ({ ...link, text: normalizeCategory(clean(link.text)) }))
      .filter(link => /listings\.php/i.test(link.href) && relevant.test(link.text));
    categories = uniqueBy(categories, item => new URL(item.href, source.baseUrl).href);
    if (limitArg) categories = categories.slice(0, limitArg);
    let listingCount = 0;

    for (const category of categories) {
      const url = new URL(category.href, source.baseUrl);
      url.searchParams.set('num', '100');
      const html = await get(url.href);
      for (const listing of extractListings(html)) {
        if (!listing.name || !relevant.test(`${category.text} ${listing.description}`)) continue;
        const key = normalize(`${listing.name}|${listing.address}`);
        const existing = candidates.get(key);
        candidates.set(key, {
          key,
          companyName: listing.name,
          address: listing.address,
          phone: listing.phone,
          website: listing.website,
          description: listing.description,
          association: source.association,
          guideState: source.state,
          categories: [...new Set([...(existing?.categories || []), category.text])],
          sourceUrls: [...new Set([...(existing?.sourceUrls || []), new URL(listing.detailUrl || url.href, source.baseUrl).href])],
          existingProviderMatch: existingNames.get(normalize(listing.name)) || null,
          researchStatus: 'Association guide discovery — verify current operations and oil/gas fit against company source'
        });
        listingCount++;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    prior.sources[source.id] = { association: source.association, scannedAt: new Date().toISOString(), categoryCount: categories.length, listingOccurrences: listingCount, error: null };
  } catch (error) {
    console.error(`Skipped ${source.id}: ${error.message}`);
    prior.sources[source.id] = { association: source.association, scannedAt: new Date().toISOString(), categoryCount: 0, listingOccurrences: 0, error: error.message };
  }
}

prior.generatedAt = new Date().toISOString();
prior.candidates = [...candidates.values()].sort((a, b) => a.companyName.localeCompare(b.companyName));
await writeOutputs(prior);
console.log(`Staged ${prior.candidates.length} unique association-guide candidates.`);

async function writeOutputs(data) {
  await mkdir(resolve('research'), { recursive: true });
  await mkdir(resolve('reports'), { recursive: true });
  await writeFile(outputFile, JSON.stringify(data, null, 2) + '\n');
  const byGuideState = Object.fromEntries([...new Set(data.candidates.map(candidate => candidate.guideState))].sort().map(state => [state, data.candidates.filter(candidate => candidate.guideState === state).length]));
  const summary = {
    generatedAt: new Date().toISOString(),
    uniqueCandidateCount: data.candidates.length,
    existingMasterMatchCount: data.candidates.filter(candidate => candidate.existingProviderMatch).length,
    netNewReviewCount: data.candidates.filter(candidate => !candidate.existingProviderMatch).length,
    withAddressCount: data.candidates.filter(candidate => candidate.address).length,
    withWebsiteCount: data.candidates.filter(candidate => candidate.website).length,
    byGuideState,
    sourceRuns: data.sources
  };
  await writeFile(resolve('reports/association-guide-sweep-summary.json'), JSON.stringify(summary, null, 2) + '\n');
}

async function get(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'WellStream-Provider-Atlas/1.0' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${response.status} reading ${url}`);
  return response.text();
}

function extractLinks(html) {
  return [...html.matchAll(/<a[^>]+href=["'](?<href>[^"']+)["'][^>]*>(?<text>[\s\S]*?)<\/a>/gi)].map(match => match.groups);
}

function extractListings(html) {
  return [...html.matchAll(/<div\s+class=["'][^"']*listing-item[^"']*["'][^>]*>[\s\S]*?<div class=["']listing-details["']>(?<body>[\s\S]*?)<div class=["']listing-logos["']/gi)].map(match => {
    const body = match.groups.body;
    const h3 = body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '';
    const link = h3.match(/href=["']([^"']+)["']/i)?.[1] || '';
    return {
      name: clean(h3),
      detailUrl: link,
      address: clean(body.match(/<li class=["']address["']>([\s\S]*?)<\/li>/i)?.[1] || ''),
      phone: clean(body.match(/<li class=["']phone["']>([\s\S]*?)<\/li>/i)?.[1] || ''),
      website: body.match(/<li class=["']website["']>[\s\S]*?href=["']([^"']+)["']/i)?.[1] || '',
      description: clean(body.match(/<li class=["']descr["']>([\s\S]*?)<\/li>/i)?.[1] || '')
    };
  });
}

function clean(value = '') {
  return value.replace(/<br\s*\/?\s*>/gi, ', ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
}
function normalizeCategory(value = '') { return value.split("'>").at(-1).trim(); }
function normalize(value = '') { return value.toLowerCase().replace(/\b(inc|llc|ltd|company|co|corporation|corp)\b/g, '').replace(/[^a-z0-9]/g, ''); }
function uniqueBy(items, key) { return [...new Map(items.map(item => [key(item), item])).values()]; }
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
