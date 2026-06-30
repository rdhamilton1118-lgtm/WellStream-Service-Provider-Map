import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const files = [
  resolve('DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv'),
  resolve('data/Gillette_WY_Corridor_Discovery_V2_20.csv'),
  resolve('data/Dickinson_ND_Corridor_Discovery_V2_20.csv'),
  resolve('data/Nine_Energy_All_US_Locations_2026-06-22.csv'),
  resolve('data/Stoneham_Drilling_WESC_Locations_2026-06-22.csv'),
  resolve('data/Montana_Association_Guide_Discovery_2026-06-22.csv')
  ,resolve('data/PIOGA_2025_2026_Directory_Providers_2026-06-24.csv')
];
const serviceFamilies = {
  drilling: ['drill', 'coring', 'directional'],
  completion: ['frac', 'completion', 'wireline', 'cement', 'workover', 'well service'],
  production: ['production', 'artificial lift', 'compression', 'pump'],
  supply: ['supply', 'pipe', 'octg', 'tubular', 'valve', 'equipment'],
  fluids: ['water', 'chemical', 'mud', 'disposal', 'environment'],
  construction: ['construction', 'pipeline', 'roustabout', 'welding', 'fabrication'],
  logistics: ['trucking', 'haul', 'hot shot', 'transport'],
  technology: ['automation', 'control', 'scada', 'measurement', 'software'],
  safety: ['safety', 'h2s', 'ppe'],
  gasCompression: ['compression', 'compressor', 'gas lift'],
  gasGatheringPipeline: ['gathering', 'pipeline', 'midstream'],
  gasProcessing: ['gas processing', 'dehydration', 'separator', 'treating'],
  gasMeasurementEmissions: ['measurement', 'meter', 'emission', 'methane', 'leak detection'],
  midstreamConstruction: ['midstream construction', 'facility construction', 'plant construction']
};

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

const providers = (await Promise.all(files.map(file => readFile(file, 'utf8')))).flatMap(parseCSV);
const markets = new Map();
providers.forEach(provider => {
  const key = `${provider.City}|${provider.State}`;
  markets.set(key, [...(markets.get(key) || []), provider]);
});

const queue = [...markets.entries()].map(([market, rows]) => {
  const text = rows.map(row => row['Primary Category']).join(' ').toLowerCase();
  const coveredFamilies = Object.entries(serviceFamilies).filter(([, words]) => words.some(word => text.includes(word))).map(([name]) => name);
  const discoveryCount = rows.filter(row => /screenshot|discovery lead|user-identified/i.test(row['Verification Status'])).length;
  const weakEvidenceCount = rows.filter(row => /pending|required|needs|lead/i.test(row['Verification Status'])).length;
  return {
    market,
    providerCount: rows.length,
    verifiedOrSourcedCount: rows.length - weakEvidenceCount,
    discoveryCount,
    coveredServiceFamilies: coveredFamilies,
    missingServiceFamilies: Object.keys(serviceFamilies).filter(name => !coveredFamilies.includes(name)),
    researchPriorityScore: Math.max(0, Object.keys(serviceFamilies).length - coveredFamilies.length) * 10 + Math.max(0, 4 - rows.length) * 5 + weakEvidenceCount
  };
}).sort((a, b) => b.researchPriorityScore - a.researchPriorityScore || a.providerCount - b.providerCount);

await mkdir(resolve('reports'), { recursive: true });
await writeFile(resolve('reports/market-research-queue.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  methodology: 'Every mapped community is treated as an anchor market. A market is not complete until each relevant service family has been searched and candidates have source-backed status.',
  providerCount: providers.length,
  marketCount: queue.length,
  markets: queue
}, null, 2) + '\n');
console.log(`Built research queue for ${queue.length} markets and ${providers.length} provider records.`);
