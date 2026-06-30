import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceFile = resolve('research/association-guide-candidates.json');
const outFile = resolve('research/west-virginia-buyers-guide-candidates.csv');
const reportFile = resolve('reports/west-virginia-buyers-guide-summary.json');

const data = JSON.parse(await readFile(sourceFile, 'utf8'));
const rows = (data.candidates || [])
  .filter(candidate => candidate.guideState === 'WV')
  .sort((a, b) => a.companyName.localeCompare(b.companyName) || (a.address || '').localeCompare(b.address || ''));

const headers = [
  'Company Name',
  'Address',
  'Phone',
  'Website',
  'Categories',
  'Association',
  'Guide State',
  'Existing Provider Match',
  'Source URLs',
  'Research Status',
  'Description'
];

const csv = [
  headers.join(','),
  ...rows.map(row => [
    row.companyName,
    row.address,
    row.phone,
    cleanWebsite(row.website),
    (row.categories || []).join('; '),
    row.association,
    row.guideState,
    row.existingProviderMatch,
    (row.sourceUrls || []).join('; '),
    row.researchStatus,
    row.description
  ].map(csvCell).join(','))
].join('\n') + '\n';

await mkdir(resolve('research'), { recursive: true });
await mkdir(resolve('reports'), { recursive: true });
await writeFile(outFile, csv);

const summary = {
  generatedAt: new Date().toISOString(),
  source: 'https://www.wvoilgasbuyersguide.com/',
  candidateCount: rows.length,
  withAddressCount: rows.filter(row => row.address).length,
  withPhoneCount: rows.filter(row => row.phone).length,
  withWebsiteCount: rows.filter(row => cleanWebsite(row.website)).length,
  existingMasterMatchCount: rows.filter(row => row.existingProviderMatch).length,
  netNewReviewCount: rows.filter(row => !row.existingProviderMatch).length,
  topCategories: Object.fromEntries(
    [...countBy(rows.flatMap(row => row.categories || []))]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 25)
  )
};
await writeFile(reportFile, JSON.stringify(summary, null, 2) + '\n');

console.log(`Exported ${rows.length} West Virginia buyers-guide candidates.`);
console.log(`CSV: ${outFile}`);
console.log(`Report: ${reportFile}`);

function cleanWebsite(value = '') {
  return value === 'http://' || value === 'https://' ? '' : value;
}

function csvCell(value = '') {
  const text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function countBy(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}
