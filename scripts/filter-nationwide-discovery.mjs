import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const inputFile = resolve('research/nationwide-discovery-candidates.json');
const reviewJsonFile = resolve('research/nationwide-discovery-review.json');
const reviewCsvFile = resolve('research/nationwide-discovery-review.csv');
const reportFile = resolve('reports/nationwide-discovery-review-summary.json');

const data = JSON.parse(await readFile(inputFile, 'utf8'));
const candidates = data.candidates || [];

const strongName = /\b(oilfield|oil field|gasfield|gas field|well service|well services|well servicing|drilling|drilling co|drilling inc|wireline|slickline|cementing|frac|fracturing|flowback|roustabout|fishing tool|downhole|workover|coiled tubing|hot shot|hydro testing|pressure testing|saltwater|brine|water transfer|water disposal|vacuum truck|swabbing|artificial lift)\b/i;
const relatedName = /\b(oil|gas|energy|pipeline|midstream|compressor|compression|measurement|meter|pump|valve|supply|tubular|inspection|ndt|integrity|welding|fabrication|construction|environmental|disposal|field service|tank|fluid|chemical)\b/i;
const excludeName = /\b(propane|plumbing|electric\b|tractor|farm|restaurant|hotel|motel|bank|insurance|law firm|attorney|realtor|real estate|church|school|convenience|grocery|tire|auto repair|car repair|car wash|campground|clothing|apartment|storage units?)\b/i;
const waterWellOnly = /\bwater\s+well|waterwell|geothermal\s+water\s+well\b/i;
const explicitOilGas = /\b(oilfield|oil field|gasfield|gas field|oil\s*&\s*gas|oil and gas|oilfield services|drilling fluids|frac|fracturing|wireline|slickline|cementing|roustabout|workover|flowback|saltwater|brine|pipeline|midstream|artificial lift)\b/i;
const strongTheme = /(oilfield|gasfield|drilling|workover|wireline|cementing|well service|hydro testing|pressure testing|artificial lift|compressor repair|tubular|pipeline integrity)/i;

const scored = candidates.map(candidate => {
  const text = `${candidate.name || ''} ${candidate.formattedAddress || ''}`;
  const themes = candidate.matchedThemes || [];
  let score = 0;
  const reasons = [];

  if (candidate.businessStatus === 'OPERATIONAL') { score += 10; reasons.push('operational'); }
  if (strongName.test(text)) { score += 60; reasons.push('strong oil/gas service term'); }
  else if (relatedName.test(text)) { score += 25; reasons.push('related industrial/energy term'); }
  const strongThemeCount = themes.filter(theme => strongTheme.test(theme)).length;
  if (strongThemeCount) { score += Math.min(30, strongThemeCount * 8); reasons.push(`${strongThemeCount} strong matched theme(s)`); }
  if (themes.length >= 3) { score += 10; reasons.push('repeated across multiple query themes'); }
  if (/pipeline/i.test(candidate.name || '') && /pipeline gathering|pipeline integrity|midstream/i.test(themes.join(' '))) {
    score += 20;
    reasons.push('pipeline-specific match');
  }
  if (excludeName.test(text)) { score -= 55; reasons.push('likely adjacent/non-provider business'); }
  if (waterWellOnly.test(text) && !explicitOilGas.test(text)) {
    score -= 45;
    reasons.push('appears water-well focused, not oil/gas-specific');
  }
  if (candidate.primaryType && !/establishment|point_of_interest/i.test(candidate.primaryType)) {
    score -= 10;
    reasons.push(`generic local type: ${candidate.primaryType}`);
  }

  return {
    ...candidate,
    discoveryScore: score,
    discoveryTier: score >= 75 ? 'strong-review' : score >= 45 ? 'possible-review' : 'hold-noisy',
    discoveryReasons: reasons
  };
}).sort((a, b) => b.discoveryScore - a.discoveryScore || (a.name || '').localeCompare(b.name || ''));

const review = scored.filter(candidate => candidate.discoveryTier !== 'hold-noisy');
const headers = [
  'Name',
  'Address',
  'Latitude',
  'Longitude',
  'Business Status',
  'Primary Type',
  'Discovery Tier',
  'Discovery Score',
  'Reasons',
  'Matched Themes',
  'Anchor Markets',
  'Google Maps URL',
  'Place ID'
];

const csv = [
  headers.join(','),
  ...review.map(candidate => [
    candidate.name,
    candidate.formattedAddress,
    candidate.latitude,
    candidate.longitude,
    candidate.businessStatus,
    candidate.primaryType,
    candidate.discoveryTier,
    candidate.discoveryScore,
    (candidate.discoveryReasons || []).join('; '),
    (candidate.matchedThemes || []).join('; '),
    (candidate.anchorMarkets || []).join('; '),
    candidate.googleMapsUrl,
    candidate.placeId
  ].map(csvCell).join(','))
].join('\n') + '\n';

await mkdir(resolve('research'), { recursive: true });
await mkdir(resolve('reports'), { recursive: true });
await writeFile(reviewJsonFile, JSON.stringify({ generatedAt: new Date().toISOString(), sourceFile: inputFile, candidates: review }, null, 2) + '\n');
await writeFile(reviewCsvFile, csv);

const summary = {
  generatedAt: new Date().toISOString(),
  rawCandidateCount: candidates.length,
  reviewCandidateCount: review.length,
  strongReviewCount: review.filter(candidate => candidate.discoveryTier === 'strong-review').length,
  possibleReviewCount: review.filter(candidate => candidate.discoveryTier === 'possible-review').length,
  heldNoisyCount: scored.filter(candidate => candidate.discoveryTier === 'hold-noisy').length,
  completedQueries: data.completedQueries?.length || 0,
  topAnchorMarkets: Object.fromEntries([...countBy(review.flatMap(candidate => candidate.anchorMarkets || []))]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 25)),
  topMatchedThemes: Object.fromEntries([...countBy(review.flatMap(candidate => candidate.matchedThemes || []))]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 25))
};
await writeFile(reportFile, JSON.stringify(summary, null, 2) + '\n');

console.log(`Filtered ${candidates.length} raw candidates to ${review.length} review leads.`);
console.log(`Strong: ${summary.strongReviewCount}; Possible: ${summary.possibleReviewCount}; Held noisy: ${summary.heldNoisyCount}`);

function csvCell(value = '') {
  const text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function countBy(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}
