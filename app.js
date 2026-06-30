const DATA_FILES = [
  'DOG_Continental_US_Oilfield_Service_Provider_Map_V2_20_Corridor_Expansion.csv',
  'data/Gillette_WY_Corridor_Discovery_V2_20.csv',
  'data/Dickinson_ND_Corridor_Discovery_V2_20.csv',
  'data/Nine_Energy_All_US_Locations_2026-06-22.csv',
  'data/Stoneham_Drilling_WESC_Locations_2026-06-22.csv',
  'data/Montana_Association_Guide_Discovery_2026-06-22.csv'
  ,'data/PIOGA_2025_2026_Directory_Providers_2026-06-24.csv',
  'data/Nationwide_Google_Places_Discovery_Batch_1_2026-06-25.csv',
  'data/Great_Lakes_Wellhead_Locations_2026-06-25.csv',
  'data/Directional_Coring_Profile_Expansion_2026-06-30.csv'
];

const GROUPS = [
  { name: 'Drilling & Directional', color: '#e45a46', words: ['drill', 'coring', 'directional', 'mudlogging', 'geosteering', 'bit'] },
  { name: 'Completions & Well Service', color: '#e3922c', words: ['completion', 'wireline', 'cement', 'frac', 'pressure pumping', 'workover', 'well servic', 'coiled tubing', 'snubbing'] },
  { name: 'Production & Artificial Lift', color: '#b56836', words: ['artificial lift', 'production', 'pump', 'compression', 'gas service'] },
  { name: 'Water, Chemicals & Disposal', color: '#318ab5', words: ['water', 'chemical', 'disposal', 'fluid', 'environment'] },
  { name: 'Supply, Pipe & Equipment', color: '#2f9b74', words: ['supply', 'pipe', 'tubular', 'octg', 'valve', 'fitting', 'equipment', 'rental'] },
  { name: 'Automation & Technology', color: '#168e94', words: ['automation', 'control', 'scada', 'software', 'measurement', 'meter', 'instrument', 'data'] },
  { name: 'Construction & Field Support', color: '#708086', words: ['construction', 'pipeline', 'trucking', 'transport', 'fabrication', 'welding', 'roustabout', 'field service'] },
  { name: 'Geoscience & Consulting', color: '#8a5ca5', words: ['seismic', 'geophysical', 'geology', 'consult', 'engineering', 'laboratory'] },
  { name: 'Integrated Services', color: '#39566b', words: [] }
];

const state = { providers: [], filtered: [], selectedGroup: '', rendered: 30, markers: [], activeId: null };
const $ = (id) => document.getElementById(id);
let map;
let markerLayer;
let clusterLayer;
let stateBoundaryLayer;
let baseLayerControl;
const CLUSTER_MAX_ZOOM = 9;

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift().map(h => h.trim());
  return rows.map((values, id) => Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').trim()]))).map((p, id) => ({ ...p, id }));
}

function groupFor(category) {
  const value = category.toLowerCase();
  return GROUPS.find(group => group.words.some(word => value.includes(word))) || GROUPS[GROUPS.length - 1];
}

function initMap() {
  map = L.map('map', {
    zoomControl: true,
    preferCanvas: true,
    minZoom: 3,
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    wheelPxPerZoomLevel: 120,
    wheelDebounceTime: 55
  }).setView([38.2, -98.4], 5);
  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    className: 'street-basemap-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  });
  const satelliteImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    className: 'satellite-basemap-tiles',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
  });
  const satelliteRoads = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    className: 'satellite-reference-tiles',
    attribution: 'Roads &copy; Esri'
  });
  const satelliteLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    className: 'satellite-reference-tiles',
    attribution: 'Labels &copy; Esri'
  });
  const satelliteHybridLayer = L.layerGroup([satelliteImagery, satelliteRoads, satelliteLabels]);

  streetLayer.addTo(map);
  baseLayerControl = L.control.layers({
    'Street map': streetLayer,
    'Satellite + roads': satelliteHybridLayer
  }, null, { position: 'topleft', collapsed: false }).addTo(map);
  addStateBoundaries();
  markerLayer = L.layerGroup().addTo(map);
  clusterLayer = L.layerGroup().addTo(map);
  map.on('moveend', updateVisibleCount);
  map.on('zoomend', () => { updateMapLayout(); updateVisibleCount(); });
}

async function addStateBoundaries() {
  map.createPane('stateBoundaries');
  const pane = map.getPane('stateBoundaries');
  pane.style.zIndex = 350;
  pane.style.pointerEvents = 'none';
  try {
    const response = await fetch('https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json');
    if (!response.ok) throw new Error(`Boundary request failed (${response.status})`);
    const states = await response.json();
    stateBoundaryLayer = L.layerGroup([
      L.geoJSON(states, { pane: 'stateBoundaries', interactive: false, style: { color: '#ffffff', weight: 4.5, opacity: .72, fillOpacity: 0 } }),
      L.geoJSON(states, { pane: 'stateBoundaries', interactive: false, style: { color: '#0b1416', weight: 2.2, opacity: .86, fillOpacity: 0 } })
    ]).addTo(map);
  } catch (error) {
    console.warn('State boundary overlay unavailable:', error);
  }
}

function buildFilters() {
  const states = [...new Set(state.providers.map(p => p.State).filter(Boolean))].sort();
  $('stateFilter').insertAdjacentHTML('beforeend', states.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join(''));
  $('categoryFilters').innerHTML = GROUPS.map(g => {
    const count = state.providers.filter(p => groupFor(p['Primary Category']).name === g.name).length;
    return `<button class="category-chip" data-group="${g.name}" style="--chip-color:${g.color}"><span class="chip-dot"></span>${g.name}<span>${count}</span></button>`;
  }).join('');
}

function applyFilters({ fit = false } = {}) {
  const query = $('searchInput').value.trim().toLowerCase();
  const selectedState = $('stateFilter').value;
  const priority = $('priorityFilter').value;
  state.filtered = state.providers.filter(p => {
    const serviceText = [p['Primary Category'], p.Notes, p['Oilfield Specific Fit']].join(' ').toLowerCase();
    const gasfieldAlias = /gas|compress|pipeline|measurement|scada|wireline|well service|workover|frac|cement|drill|pump|production/.test(serviceText) ? ' gasfield natural gas gas well upstream midstream ' : '';
    const searchAliases = p['Company Name'] === 'ProDirectional' ? ' pro directional pro coring procoring conventional coring sidewall coring core recovery ' : '';
    const haystack = [p['Company Name'], searchAliases, serviceText, gasfieldAlias, p.City, p.State].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (!selectedState || p.State === selectedState) && (!priority || p.Priority.startsWith(priority)) && (!state.selectedGroup || groupFor(p['Primary Category']).name === state.selectedGroup);
  });
  state.rendered = 30;
  renderResults();
  renderMarkers();
  $('resultCount').textContent = state.filtered.length.toLocaleString();
  $('clearSearch').classList.toggle('visible', Boolean(query));
  if (fit) fitResults();
}

function renderResults() {
  const items = state.filtered.slice(0, state.rendered);
  $('results').innerHTML = items.length ? items.map(p => {
    const group = groupFor(p['Primary Category']);
    return `<article class="provider-card ${state.activeId === p.id ? 'active' : ''}" data-id="${p.id}" style="--card-color:${group.color}">
      <span class="card-bar"></span><div><h3>${escapeHTML(p['Company Name'])}</h3><p>⌖ ${escapeHTML(p.City)}, ${escapeHTML(p.State)}</p><p class="service">${escapeHTML(p['Primary Category'])}</p></div>
      <span class="priority-badge ${verificationTier(p).className}">${verificationTier(p).label}</span></article>`;
  }).join('') + (state.filtered.length > state.rendered ? '<button class="load-more" id="loadMore">Show more providers</button>' : '') : '<div class="empty-state">No providers match these filters.<br>Try a broader service or location.</div>';
  document.querySelectorAll('.provider-card').forEach(card => card.addEventListener('click', () => selectProvider(Number(card.dataset.id))));
  $('loadMore')?.addEventListener('click', () => { state.rendered += 30; renderResults(); });
}

function renderMarkers() {
  markerLayer.clearLayers();
  state.markers = [];
  state.filtered.forEach(p => {
    const lat = Number(p.Latitude);
    const lng = Number(p.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const group = groupFor(p['Primary Category']);
    const icon = L.divIcon({ className: '', html: `<div class="provider-marker" style="--marker-color:${group.color}"></div>`, iconSize: [16,16], iconAnchor: [8,8] });
    const marker = L.marker([lat, lng], { icon, title: p['Company Name'] }).bindPopup(`<div class="popup-card"><h3>${escapeHTML(p['Company Name'])}</h3><p>${escapeHTML(p['Primary Category'])}</p><p>⌖ ${escapeHTML(p.City)}, ${escapeHTML(p.State)}</p><button data-provider="${p.id}">View provider details</button></div>`);
    marker.on('popupopen', e => e.popup.getElement().querySelector('button')?.addEventListener('click', () => openDetails(p)));
    marker.on('click', () => { state.activeId = p.id; renderResults(); });
    marker.addTo(markerLayer);
    state.markers.push({ marker, provider: p, actualLatLng: L.latLng(lat, lng), offset: { x: 0, y: 0 } });
  });
  buildConstellations();
  updateMapLayout();
  updateVisibleCount();
}

function buildConstellations() {
  const sharedLocations = new Map();
  state.markers.forEach(item => {
    const coordinateKey = `${item.actualLatLng.lat.toFixed(5)}|${item.actualLatLng.lng.toFixed(5)}`;
    sharedLocations.set(coordinateKey, [...(sharedLocations.get(coordinateKey) || []), item]);
  });

  sharedLocations.forEach(items => {
    if (items.length < 2) return;
    const center = L.latLng(
      items.reduce((sum, item) => sum + item.actualLatLng.lat, 0) / items.length,
      items.reduce((sum, item) => sum + item.actualLatLng.lng, 0) / items.length
    );
    const sorted = [...items].sort((a, b) => a.provider['Company Name'].localeCompare(b.provider['Company Name']));
    let placed = 0;
    let ring = 0;
    while (placed < sorted.length) {
      const capacity = ring === 0 ? Math.min(sorted.length, 8) : 8 + ring * 6;
      const count = Math.min(capacity, sorted.length - placed);
      const radius = 25 + ring * 20;
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.PI * 2 * i / count) + (ring % 2 ? Math.PI / count : 0);
        const item = sorted[placed + i];
        item.constellationCenter = center;
        item.offset = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      }
      placed += count;
      ring++;
    }
  });
}

function updateConstellations() {
  if (!map) return;
  state.markers.forEach(item => {
    if (!item.constellationCenter) {
      item.marker.setLatLng(item.actualLatLng);
      return;
    }
    const centerPoint = map.latLngToLayerPoint(item.constellationCenter);
    item.marker.setLatLng(map.layerPointToLatLng(centerPoint.add(L.point(item.offset.x, item.offset.y))));
  });
}

function updateMapLayout() {
  if (!map || !clusterLayer) return;
  clusterLayer.clearLayers();
  if (map.getZoom() > CLUSTER_MAX_ZOOM) {
    state.markers.forEach(item => setMarkerVisible(item, true));
    updateConstellations();
    return;
  }

  state.markers.forEach(item => {
    item.marker.setLatLng(item.actualLatLng);
    setMarkerVisible(item, true);
  });
  const pending = new Set(state.markers);
  const threshold = map.getZoom() <= 5 ? 58 : 48;
  while (pending.size) {
    const seed = pending.values().next().value;
    pending.delete(seed);
    const seedPoint = map.latLngToLayerPoint(seed.actualLatLng);
    const group = [seed];
    for (const candidate of [...pending]) {
      if (seedPoint.distanceTo(map.latLngToLayerPoint(candidate.actualLatLng)) <= threshold) {
        group.push(candidate);
        pending.delete(candidate);
      }
    }
    if (group.length === 1) continue;
    group.forEach(item => setMarkerVisible(item, false));
    const center = L.latLng(
      group.reduce((sum, item) => sum + item.actualLatLng.lat, 0) / group.length,
      group.reduce((sum, item) => sum + item.actualLatLng.lng, 0) / group.length
    );
    const colors = [...new Set(group.map(item => groupFor(item.provider['Primary Category']).color))].slice(0, 6);
    const segments = colors.map((color, index) => `${color} ${index / colors.length * 100}% ${(index + 1) / colors.length * 100}%`).join(',');
    const icon = L.divIcon({
      className: '',
      html: `<div class="area-cluster" style="--cluster-ring:conic-gradient(${segments})"><span>${group.length}</span><small>providers</small></div>`,
      iconSize: [56, 56],
      iconAnchor: [28, 28]
    });
    const names = group.slice(0, 6).map(item => escapeHTML(item.provider['Company Name'])).join('<br>');
    const more = group.length > 6 ? `<br><em>+${group.length - 6} more</em>` : '';
    L.marker(center, { icon, title: `${group.length} providers in this area`, zIndexOffset: 900 })
      .bindTooltip(`<b>${group.length} providers in this area</b><br>${names}${more}`, { direction: 'top', offset: [0, -22] })
      .on('click', () => map.flyTo(center, Math.min(11, map.getZoom() + 3), { duration: .65 }))
      .addTo(clusterLayer);
  }
}

function setMarkerVisible(item, visible) {
  item.marker.setOpacity(visible ? 1 : 0);
  item.marker.setZIndexOffset(visible ? 0 : -1000);
  const element = item.marker.getElement();
  if (element) element.style.pointerEvents = visible ? 'auto' : 'none';
}

function selectProvider(id) {
  const item = state.markers.find(m => m.provider.id === id);
  if (!item) return;
  state.activeId = id;
  const targetZoom = Math.max(map.getZoom(), 11);
  if (map.getZoom() <= CLUSTER_MAX_ZOOM) {
    map.once('zoomend', () => item.marker.openPopup());
    map.flyTo(item.actualLatLng, targetZoom, { duration: .7 });
  } else {
    map.flyTo(item.marker.getLatLng(), targetZoom, { duration: .7 });
    item.marker.openPopup();
  }
  renderResults();
  if (window.innerWidth <= 800) $('sidebar').classList.remove('open');
}

function openDetails(p) {
  const website = safeURL(p.Website);
  const source = safeURL((p['Source URL'] || '').split(/\s*;\s*/)[0]);
  $('dialogContent').innerHTML = `<div class="detail-head"><p class="eyebrow">${escapeHTML(groupFor(p['Primary Category']).name)}</p><h2>${escapeHTML(p['Company Name'])}</h2><div class="detail-location">⌖ ${escapeHTML([p.Address, p.City, p.State].filter(Boolean).join(', '))}</div></div>
    <div class="detail-body"><div class="detail-grid">
      ${detail('Primary service', p['Primary Category'])}${detail('Research status', verificationTier(p).label)}
      ${detail('Priority', p.Priority)}${detail('Phone', p.Phone)}
      ${detail('Location role', p['Location Role / Satellite Type'])}${detail('Address quality', p['Address Completeness'])}
      ${detail('Oilfield fit', p['Oilfield Specific Fit'], true)}${detail('Verification', p['Verification Status'], true)}
      ${detail('Notes', p.Notes, true)}
    </div><div class="detail-actions">
      ${website ? `<a class="primary" href="${website}" target="_blank" rel="noopener">Visit website ↗</a>` : ''}
      ${source ? `<a href="${source}" target="_blank" rel="noopener">View source ↗</a>` : ''}
      <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p['Company Name']} ${p.Address || ''} ${p.City} ${p.State}`)}" target="_blank" rel="noopener">Open in Maps ↗</a>
    </div></div>`;
  $('providerDialog').showModal();
}

function detail(label, value, wide = false) { return value ? `<div class="detail-item ${wide ? 'wide' : ''}"><small>${label}</small><div>${escapeHTML(value)}</div></div>` : ''; }
function verificationTier(p) {
  const status = (p['Verification Status'] || '').toLowerCase();
  if (/screenshot|discovery lead|user-identified/.test(status)) return { label: 'Discovery', className: 'discovery' };
  if (/company source verified|source verified|confirmed|directory verified|public listing/.test(status)) return { label: 'Verified', className: 'verified' };
  return { label: 'Review', className: 'review' };
}
function safeURL(value) { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }
function escapeHTML(value = '') { return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])); }
function providersInView() {
  if (!map) return [];
  const bounds = map.getBounds();
  return state.filtered.filter(p => bounds.contains(L.latLng(Number(p.Latitude), Number(p.Longitude))));
}

function updateVisibleCount() {
  const providers = providersInView();
  $('visibleCount').textContent = providers.length.toLocaleString();
  if ($('exportDialog').open) renderExportPreview(providers);
}

function contactRows(providers = providersInView()) {
  return [...providers]
    .sort((a, b) => (a.State || '').localeCompare(b.State || '') || (a.City || '').localeCompare(b.City || '') || a['Company Name'].localeCompare(b['Company Name']))
    .map(p => ({
      Company: p['Company Name'] || '', Service: p['Primary Category'] || '', Address: p.Address || '',
      City: p.City || '', State: p.State || '', Phone: p.Phone || '', Website: p.Website || '',
      Verification: verificationTier(p).label, Latitude: Number(p.Latitude), Longitude: Number(p.Longitude)
    }));
}

function renderExportPreview(providers = providersInView()) {
  const rows = contactRows(providers);
  $('exportCount').textContent = rows.length.toLocaleString();
  $('exportPreview').innerHTML = rows.length
    ? rows.slice(0, 6).map(row => `<div><b>${escapeHTML(row.Company)}</b><span>${escapeHTML([row.City, row.State].filter(Boolean).join(', '))}${row.Phone ? ` &middot; ${escapeHTML(row.Phone)}` : ''}</span></div>`).join('') + (rows.length > 6 ? `<small>+ ${rows.length - 6} more providers in the export</small>` : '')
    : '<div class="empty-state">No filtered providers are inside the current map view.</div>';
  $('exportExcel').disabled = !rows.length;
  $('exportPdf').disabled = !rows.length;
}

function exportFilename(extension) {
  return `WellStream_Provider_Contacts_${new Date().toISOString().slice(0, 10)}.${extension}`;
}

function exportExcel() {
  const rows = contactRows();
  if (!rows.length) return;
  if (!window.XLSX) { alert('The Excel exporter is still loading. Check your internet connection and try again.'); return; }
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = [28, 34, 30, 18, 9, 17, 34, 14, 12, 12].map(wch => ({ wch }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Provider Contacts');
  XLSX.writeFile(workbook, exportFilename('xlsx'));
}

function exportPdf() {
  const rows = contactRows();
  if (!rows.length) return;
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) { alert('The PDF exporter is still loading. Check your internet connection and try again.'); return; }
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  doc.setTextColor(15, 95, 87); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text('WellStream Solutions Provider Contact List', 36, 38);
  doc.setTextColor(90, 100, 107); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`${rows.length} providers in the selected map view - Generated ${new Date().toLocaleDateString()}`, 36, 54);
  doc.autoTable({
    startY: 68,
    head: [['Company', 'Service', 'Address', 'City / State', 'Phone', 'Website']],
    body: rows.map(row => [row.Company, row.Service, row.Address, [row.City, row.State].filter(Boolean).join(', '), row.Phone, row.Website]),
    styles: { fontSize: 6.8, cellPadding: 4, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [15, 95, 87], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [241, 247, 245] },
    columnStyles: { 0: { cellWidth: 112 }, 1: { cellWidth: 116 }, 2: { cellWidth: 122 }, 3: { cellWidth: 72 }, 4: { cellWidth: 78 }, 5: { cellWidth: 130 } },
    margin: { left: 36, right: 36 },
    didDrawPage: data => { doc.setFontSize(7); doc.setTextColor(120); doc.text(`WellStream Solutions, LLC - Page ${data.pageNumber}`, 36, doc.internal.pageSize.height - 16); }
  });
  doc.save(exportFilename('pdf'));
}
function fitResults() { if (!state.markers.length) return; map.fitBounds(L.latLngBounds(state.markers.map(m => m.marker.getLatLng())), { padding: [35,35], maxZoom: 9 }); }

async function boot() {
  initMap();
  try {
    const responses = await Promise.all(DATA_FILES.map(file => fetch(file)));
    const failed = responses.find(response => !response.ok);
    if (failed) throw new Error(`Data request failed (${failed.status})`);
    const datasets = await Promise.all(responses.map(response => response.text()));
    state.providers = datasets.flatMap(parseCSV).map((p, id) => ({ ...p, id })).filter(p => p['Company Name'] && Number.isFinite(Number(p.Latitude)) && Number.isFinite(Number(p.Longitude)));
    buildFilters();
    applyFilters();
    $('dataStatus').textContent = `${state.providers.length.toLocaleString()} mapped locations · weekly audit ready`;
  } catch (error) {
    $('dataStatus').textContent = 'Provider data unavailable';
    $('results').innerHTML = `<div class="empty-state">Could not load the provider file.<br>Run this app through a local web server.</div>`;
    console.error(error);
  }
}

let searchTimer;
$('searchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(applyFilters, 140); });
$('clearSearch').addEventListener('click', () => { $('searchInput').value = ''; applyFilters(); $('searchInput').focus(); });
$('stateFilter').addEventListener('change', () => applyFilters({ fit: true }));
$('priorityFilter').addEventListener('change', applyFilters);
$('categoryFilters').addEventListener('click', e => {
  const chip = e.target.closest('.category-chip'); if (!chip) return;
  state.selectedGroup = state.selectedGroup === chip.dataset.group ? '' : chip.dataset.group;
  document.querySelectorAll('.category-chip').forEach(c => c.classList.toggle('active', c.dataset.group === state.selectedGroup));
  applyFilters({ fit: true });
});
$('clearFilters').addEventListener('click', () => { $('searchInput').value = ''; $('stateFilter').value = ''; $('priorityFilter').value = ''; state.selectedGroup = ''; document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active')); applyFilters({ fit: true }); });
$('fitResults').addEventListener('click', fitResults);
$('mobileFilters').addEventListener('click', () => $('sidebar').classList.toggle('open'));
$('providerDialog').querySelector('.dialog-close').addEventListener('click', () => $('providerDialog').close());
$('providerDialog').addEventListener('click', e => { if (e.target === $('providerDialog')) $('providerDialog').close(); });
$('locateMe').addEventListener('click', () => map.locate({ setView: true, maxZoom: 9 }));
$('openExport').addEventListener('click', () => { renderExportPreview(); $('exportDialog').showModal(); });
$('exportDialog').querySelector('.dialog-close').addEventListener('click', () => $('exportDialog').close());
$('exportDialog').addEventListener('click', e => { if (e.target === $('exportDialog')) $('exportDialog').close(); });
$('exportExcel').addEventListener('click', exportExcel);
$('exportPdf').addEventListener('click', exportPdf);

boot();
