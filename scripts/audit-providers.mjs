import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const dataFiles = [
  resolve('DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv'),
  resolve('data/Gillette_WY_Corridor_Discovery_V2_20.csv'),
  resolve('data/Dickinson_ND_Corridor_Discovery_V2_20.csv'),
  resolve('data/Nine_Energy_All_US_Locations_2026-06-22.csv'),
  resolve('data/Stoneham_Drilling_WESC_Locations_2026-06-22.csv'),
  resolve('data/Montana_Association_Guide_Discovery_2026-06-22.csv')
  ,resolve('data/PIOGA_2025_2026_Directory_Providers_2026-06-24.csv')
];
const reportFile = resolve('reports/provider-audit.json');
const texts = await Promise.all(dataFiles.map(file => readFile(file, 'utf8')));

function parseCSV(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  const headers = rows.shift();
  return rows.map(values => Object.fromEntries(headers.map((h, i) => [h.trim(), (values[i] || '').trim()])));
}

const providers = texts.flatMap(parseCSV);
const targets = providers.map((p, index) => ({ index, company: p['Company Name'], url: p.Website })).filter(p => /^https?:\/\//i.test(p.url));
const checks = [];

async function check(target) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(target.url, { method: 'HEAD', redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'WellStream-Provider-Audit/1.0' } });
    return { ...target, status: response.status, ok: response.ok, finalUrl: response.url };
  } catch (error) {
    return { ...target, status: 0, ok: false, error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally { clearTimeout(timeout); }
}

for (let i = 0; i < targets.length; i += 12) checks.push(...await Promise.all(targets.slice(i, i + 12).map(check)));

const duplicateKeys = new Map();
const coordinateKeys = new Map();
providers.forEach((p, index) => {
  const key = `${p['Company Name'].toLowerCase()}|${p.City.toLowerCase()}|${p.State.toLowerCase()}`;
  duplicateKeys.set(key, [...(duplicateKeys.get(key) || []), index]);
  const coordinateKey = `${p.Latitude}|${p.Longitude}`;
  coordinateKeys.set(coordinateKey, [...(coordinateKeys.get(coordinateKey) || []), index]);
});
const sharedCoordinateGroups = [...coordinateKeys.entries()]
  .filter(([, indexes]) => indexes.length > 1)
  .map(([coordinates, indexes]) => ({
    coordinates,
    count: indexes.length,
    providers: indexes.map(i => ({ row: i + 2, company: providers[i]['Company Name'], city: providers[i].City, state: providers[i].State }))
  }))
  .sort((a, b) => b.count - a.count);
const report = {
  generatedAt: new Date().toISOString(),
  recordCount: providers.length,
  checkedWebsiteCount: checks.length,
  healthyWebsiteCount: checks.filter(c => c.ok).length,
  websitesForReview: checks.filter(c => !c.ok),
  possibleDuplicates: [...duplicateKeys.entries()].filter(([, indexes]) => indexes.length > 1).map(([key, indexes]) => ({ key, rows: indexes.map(i => i + 2) })),
  locationAudit: {
    recordsNeedingPhysicalAddress: providers.filter(p => /physical address needed/i.test(p['Address Completeness'])).length,
    recordsNeedingPhoneEnrichment: providers.filter(p => !p.Phone || /needs|pending|confirm/i.test(p.Phone)).length,
    recordsNeedingWebsiteEnrichment: providers.filter(p => !/^https?:\/\//i.test(p.Website)).length,
    cityCentroidRecords: providers.filter(p => /city centroid|city-level/i.test(`${p['Address Completeness']} ${p['Map Status']}`)).length,
    unverifiedUserLeads: providers.filter(p => /user-provided.*(pending|required)/i.test(p['Verification Status'])).length,
    sharedCoordinateGroupCount: sharedCoordinateGroups.length,
    sharedCoordinateGroups
  },
  policy: 'This audit flags evidence for human review. It never deletes a provider from a single failed web request.'
};
await mkdir(dirname(reportFile), { recursive: true });
await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
console.log(`Audited ${providers.length} providers; ${report.websitesForReview.length} websites need review.`);
