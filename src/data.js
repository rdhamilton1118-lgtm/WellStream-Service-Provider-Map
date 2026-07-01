import base from '../DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv?raw';
import gillette from '../data/Gillette_WY_Corridor_Discovery_V2_20.csv?raw';
import dickinson from '../data/Dickinson_ND_Corridor_Discovery_V2_20.csv?raw';
import nine from '../data/Nine_Energy_All_US_Locations_2026-06-22.csv?raw';
import stoneham from '../data/Stoneham_Drilling_WESC_Locations_2026-06-22.csv?raw';
import montana from '../data/Montana_Association_Guide_Discovery_2026-06-22.csv?raw';
import pioga from '../data/PIOGA_2025_2026_Directory_Providers_2026-06-24.csv?raw';
import nationwide from '../data/Nationwide_Google_Places_Discovery_Batch_1_2026-06-25.csv?raw';
import greatLakes from '../data/Great_Lakes_Wellhead_Locations_2026-06-25.csv?raw';
import directional from '../data/Directional_Coring_Profile_Expansion_2026-06-30.csv?raw';
import newKotaExpansion from '../data/NewKota_Profile_Expansion_2026-06-30.csv?raw';
import actionEnergy from '../data/Action_Energy_Services_Gillette_2026-06-30.csv?raw';
import capillarySpooling from '../data/Capillary_Spooling_Oilfield_Profile_2026-06-30.csv?raw';
import gilletteOilfieldExact from '../data/Gillette_Oilfield_Exact_Search_Expansion_2026-06-30.csv?raw';
import precisionWellCorrection from '../data/Precision_Well_Service_Gillette_Correction_2026-06-30.csv?raw';
import wellConstructionManufacturers from '../data/Well_Construction_Tool_Manufacturers_2026-07-01.csv?raw';
import pumpdownCompletions from '../data/Pumpdown_Completions_Profile_Expansion_2026-07-01.csv?raw';

export const GROUPS = [
  { name: 'Drilling & Directional', color: '#e45a46', words: ['drill', 'coring', 'directional', 'mudlogging', 'geosteering', 'bit'] },
  { name: 'Completions, Frac & Well Service', color: '#e3922c', words: ['completion', 'wireline', 'cement', 'frac', 'pressure pumping', 'stimulation', 'workover', 'well servic', 'coiled tubing', 'snubbing'] },
  { name: 'Production & Artificial Lift', color: '#b56836', words: ['artificial lift', 'production', 'pump', 'compression', 'gas service'] },
  { name: 'Water, Chemicals & Disposal', color: '#318ab5', words: ['water', 'chemical', 'disposal', 'fluid', 'environment'] },
  { name: 'Supply, Pipe & Equipment', color: '#2f9b74', words: ['supply', 'pipe', 'tubular', 'octg', 'valve', 'fitting', 'equipment', 'rental'] },
  { name: 'Automation & Technology', color: '#168e94', words: ['automation', 'control', 'scada', 'software', 'measurement', 'meter', 'instrument', 'data'] },
  { name: 'Construction & Field Support', color: '#708086', words: ['construction', 'pipeline', 'trucking', 'transport', 'fabrication', 'welding', 'roustabout', 'field service'] },
  { name: 'Geoscience & Consulting', color: '#8a5ca5', words: ['seismic', 'geophysical', 'geology', 'consult', 'engineering', 'laboratory'] },
  { name: 'Integrated Services', color: '#39566b', words: [] }
];

export function parseCSV(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; if (row.some(value => value !== '')) rows.push(row); row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift().map(header => header.trim());
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()])));
}

const sources = [base, gillette, dickinson, nine, stoneham, montana, pioga, nationwide, greatLakes, directional, newKotaExpansion, actionEnergy, capillarySpooling, gilletteOilfieldExact, precisionWellCorrection, wellConstructionManufacturers, pumpdownCompletions];
export const PROVIDERS = sources.flatMap(parseCSV)
  .map((provider, id) => ({ ...provider, id }))
  .filter(provider => provider['Company Name'] && Number.isFinite(Number(provider.Latitude)) && Number.isFinite(Number(provider.Longitude)))
  .filter(provider => !(provider['Company Name'] === 'Axis Energy Services - Gillette' && provider.Address.includes('exact address pending')))
  .filter(provider => !(provider['Company Name'] === 'Precision Well Services - Gillette' && provider.Address.includes('pending')));

export function groupFor(category = '') {
  const value = category.toLowerCase();
  return GROUPS.find(group => group.words.some(word => value.includes(word))) || GROUPS.at(-1);
}

export function verificationTier(provider) {
  const status = (provider['Verification Status'] || '').toLowerCase();
  if (/screenshot|discovery lead|user-identified/.test(status)) return { label: 'Discovery', className: 'discovery' };
  if (/company source verified|source verified|confirmed|directory verified|public listing/.test(status)) return { label: 'Verified', className: 'verified' };
  return { label: 'Review', className: 'review' };
}
