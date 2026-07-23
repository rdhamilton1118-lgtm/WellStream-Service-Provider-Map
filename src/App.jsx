import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import ProviderMap from './ProviderMap.jsx';
import { GROUPS, PROVIDERS, groupFor, verificationTier } from './data.js';
import logo from '../assets/wellstream-mark-board.png';
import serviceIconLibrary from '../assets/Service Provider Icons.png';

const safeURL = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const firstWebsiteURL = value => safeURL(String(value || '').match(/https?:\/\/[^\s|;]+/i)?.[0] || '');
const PROVIDER_BRANDS = [...PROVIDERS.reduce((brands, provider) => {
  const website = firstWebsiteURL(provider.Website);
  if (!website) return brands;
  const domain = new URL(website).hostname.replace(/^www\./i, '').toLowerCase();
  if (!domain || /(?:google|facebook|linkedin|maps)\./i.test(domain)) return brands;
  const name = provider['Company Name'].replace(/\s+-\s+.*$/, '').trim();
  const existing = brands.get(domain);
  if (!existing || name.length < existing.name.length) brands.set(domain, { domain, name, website });
  return brands;
}, new Map()).values()].sort((a, b) => a.name.localeCompare(b.name));
const providerLogoURL = brand => `https://${brand.domain}/favicon.ico`;
const verifyProviderLogo = brand => new Promise(resolve => {
  const image = new Image();
  const timer = window.setTimeout(() => finish(false), 6000);
  const finish = valid => {
    window.clearTimeout(timer);
    image.onload = null;
    image.onerror = null;
    resolve(valid ? { ...brand, logo: providerLogoURL(brand) } : null);
  };
  image.onload = () => finish(image.naturalWidth > 1 && image.naturalHeight > 1);
  image.onerror = () => finish(false);
  image.decoding = 'async';
  image.src = providerLogoURL(brand);
});
const detail = (label, value, wide = false) => value ? <div className={`detail-item ${wide ? 'wide' : ''}`}><small>{label}</small><div>{value}</div></div> : null;
const publicValue = value => {
  const text = String(value || '').trim();
  return text && !/^(?:n\/?a|none)$/i.test(text) && !/\b(?:pending|unknown|unavailable|not available|needs? (?:direct )?(?:confirmation|verification|research)|requires? (?:direct )?(?:confirmation|verification|research))\b/i.test(text) ? text : '';
};
const publicAddress = provider => {
  const street = publicValue(provider.Address);
  const locality = [publicValue(provider.City), publicValue(provider.State)].filter(Boolean).join(', ');
  return [street, locality].filter(Boolean).join(', ');
};
const contactRows = providers => [...providers].sort((a, b) => (a.State || '').localeCompare(b.State || '') || (a.City || '').localeCompare(b.City || '') || a['Company Name'].localeCompare(b['Company Name'])).map(p => ({ Company: p['Company Name'] || '', Service: p['Primary Category'] || '', Address: p.Address || '', City: p.City || '', State: p.State || '', Phone: p.Phone || '', Website: p.Website || '', Verification: verificationTier(p).label, Latitude: Number(p.Latitude), Longitude: Number(p.Longitude) }));
const filename = extension => `WellStream_Provider_Contacts_${new Date().toISOString().slice(0, 10)}.${extension}`;

function App() {
  const [query, setQuery] = useState(''); const [stateFilter, setStateFilter] = useState(''); const [priority, setPriority] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(''); const [rendered, setRendered] = useState(30); const [activeId, setActiveId] = useState(null);
  const [visible, setVisible] = useState([]); const [details, setDetails] = useState(null); const [exportOpen, setExportOpen] = useState(false); const [mobileOpen, setMobileOpen] = useState(false);
  const [iconGuideOpen, setIconGuideOpen] = useState(false);
  const [tickerBrands, setTickerBrands] = useState([]);
  const [tickerReady, setTickerReady] = useState(false);
  const [tickerStarted, setTickerStarted] = useState(false);
  const mapRef = useRef(null);
  const tickerRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    const loadLogos = async () => {
      const verified = (await Promise.all(PROVIDER_BRANDS.map(verifyProviderLogo))).filter(Boolean);
      if (!cancelled) { setTickerBrands(verified); setTickerReady(true); }
    };
    loadLogos();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!tickerReady || !tickerBrands.length || !tickerRef.current) return;
    let cancelled = false;
    const prepareTrack = async () => {
      const images = [...tickerRef.current.querySelectorAll('.ticker-brand img')];
      await Promise.race([
        Promise.allSettled(images.map(image => image.decode?.() || Promise.resolve())),
        new Promise(resolve => window.setTimeout(resolve, 2500))
      ]);
      if (!cancelled) requestAnimationFrame(() => requestAnimationFrame(() => setTickerStarted(true)));
    };
    prepareTrack();
    return () => { cancelled = true; };
  }, [tickerReady, tickerBrands]);
  const states = useMemo(() => [...new Set(PROVIDERS.map(p => p.State).filter(Boolean))].sort(), []);
  const filtered = useMemo(() => PROVIDERS.filter(p => {
    const service = [p['Primary Category'], p.Notes, p['Oilfield Specific Fit']].join(' ').toLowerCase();
    const gas = /gas|compress|pipeline|measurement|scada|wireline|well service|workover|frac|cement|drill|pump|production/.test(service) ? ' gasfield natural gas gas well upstream midstream ' : '';
    const aliases = p['Company Name'] === 'ProDirectional' ? ' pro directional pro coring procoring conventional coring sidewall coring core recovery ' : '';
    const haystack = [p['Company Name'], aliases, service, gas, p.City, p.State].join(' ').toLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLowerCase())) && (!stateFilter || p.State === stateFilter) && (!priority || p.Priority.startsWith(priority)) && (!selectedGroup || groupFor(p['Primary Category']).name === selectedGroup);
  }), [query, stateFilter, priority, selectedGroup]);
  const listedProviders = useMemo(() => {
    const filteredIds = new Set(filtered.map(provider => provider.id));
    return visible.filter(provider => filteredIds.has(provider.id));
  }, [filtered, visible]);

  const reset = () => { setQuery(''); setStateFilter(''); setPriority(''); setSelectedGroup(''); setRendered(30); };
  const selectProvider = provider => { setActiveId(provider.id); mapRef.current?.select(provider); setMobileOpen(false); };
  const rows = contactRows(visible);
  const exportExcel = () => { const sheet = XLSX.utils.json_to_sheet(rows); sheet['!cols'] = [28, 34, 30, 18, 9, 17, 34, 14, 12, 12].map(wch => ({ wch })); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Provider Contacts'); XLSX.writeFile(book, filename('xlsx')); };
  const exportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' }); doc.setTextColor(15, 95, 87); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('WellStream Solutions Provider Contact List', 36, 38); doc.setTextColor(90, 100, 107); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`${rows.length} providers in the selected map view - Generated ${new Date().toLocaleDateString()}`, 36, 54);
    autoTable(doc, { startY: 68, head: [['Company', 'Service', 'Address', 'City / State', 'Phone', 'Website']], body: rows.map(row => [row.Company, row.Service, row.Address, [row.City, row.State].filter(Boolean).join(', '), row.Phone, row.Website]), styles: { fontSize: 6.8, cellPadding: 4, overflow: 'linebreak', valign: 'top' }, headStyles: { fillColor: [15, 95, 87], textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [241, 247, 245] }, columnStyles: { 0: { cellWidth: 112 }, 1: { cellWidth: 116 }, 2: { cellWidth: 122 }, 3: { cellWidth: 72 }, 4: { cellWidth: 78 }, 5: { cellWidth: 130 } }, margin: { left: 36, right: 36 }, didDrawPage: data => { doc.setFontSize(7); doc.setTextColor(120); doc.text(`WellStream Solutions, LLC - Page ${data.pageNumber}`, 36, doc.internal.pageSize.height - 16); } }); doc.save(filename('pdf'));
  };

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#" aria-label="WellStream Solutions provider intelligence home"><img className="brand-mark" src={logo} alt=""/><span className="brand-rule"/><span className="brand-name"><b>WellStream</b><strong>Solutions</strong><small>LLC · Provider Intelligence</small></span></a>
      <a className="website-link" href="https://wellstreamsolutions.com/?utm_source=provider_atlas&utm_medium=referral&utm_campaign=provider_intelligence" target="_blank" rel="noreferrer">Visit our website <span aria-hidden="true">↗</span></a>
      <button className="mobile-filter-btn" type="button" onClick={() => setMobileOpen(open => !open)}>Filters</button>
    </header>
    <section className="provider-ticker" aria-label="Service provider websites">
      <div className="ticker-label"><b>Provider network</b></div>
      <div ref={tickerRef} className={`ticker-window ${tickerReady ? 'ready' : 'loading'} ${tickerStarted ? 'started' : ''}`}>
        {!tickerReady && <div className="ticker-loading" aria-hidden="true"><span/><span/><span/><span/></div>}
        {tickerReady && tickerBrands.length > 0 && <div className="ticker-track" style={{ '--ticker-duration': `${Math.max(55, tickerBrands.length * 2.5)}s` }}>
          {[0, 1].map(copy => <div className="ticker-group" aria-hidden={copy === 1} key={copy}>{tickerBrands.map(brand => <a className="ticker-brand" href={brand.website} target="_blank" rel="noreferrer" tabIndex={copy === 1 ? -1 : undefined} title={`Visit ${brand.name}`} key={`${copy}-${brand.domain}`}><img src={brand.logo} alt="" loading="eager" decoding="sync"/><span>{brand.name}</span></a>)}</div>)}
        </div>}
      </div>
    </section>
    <main>
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <section className="intro"><p className="eyebrow">WellStream Solutions, LLC</p><h1>Dependable solutions.<br/><span>Stronger operations.</span></h1><p>Find oilfield and gasfield service providers by capability, location, and operating fit.</p></section>
        <section className="search-panel">
          <label htmlFor="searchInput">Search providers</label><div className="search-box"><span aria-hidden="true">⌕</span><input id="searchInput" type="search" placeholder="Company, service, city…" value={query} onChange={e => { setQuery(e.target.value); setRendered(30); }}/>{query && <button type="button" aria-label="Clear search" className="visible" onClick={() => setQuery('')}>×</button>}</div>
          <div className="filter-grid"><div><label htmlFor="stateFilter">State</label><select id="stateFilter" value={stateFilter} onChange={e => { setStateFilter(e.target.value); setRendered(30); }}><option value="">All states</option>{states.map(state => <option key={state}>{state}</option>)}</select></div><div><label htmlFor="priorityFilter">Priority</label><select id="priorityFilter" value={priority} onChange={e => setPriority(e.target.value)}><option value="">Any priority</option><option>High</option><option>Medium</option><option>Low</option></select></div></div>
          <div className="category-heading"><label>Service category</label><div className="category-actions"><button type="button" onClick={() => setIconGuideOpen(true)}>Icon guide</button><button type="button" onClick={reset}>Reset all</button></div></div>
          <div className="category-list">{GROUPS.map(group => <button key={group.name} type="button" className={`category-chip ${selectedGroup === group.name ? 'active' : ''}`} style={{ '--chip-color': group.color }} onClick={() => { setSelectedGroup(selectedGroup === group.name ? '' : group.name); setRendered(30); }}><span className="chip-dot"/>{group.name}<span>{PROVIDERS.filter(p => groupFor(p['Primary Category']).name === group.name).length}</span></button>)}</div>
        </section>
        <section className="results-section"><div className="results-heading"><div><b>{listedProviders.length.toLocaleString()}</b><span> in map view</span>{filtered.length !== listedProviders.length && <small>{filtered.length.toLocaleString()} match active filters</small>}</div><button type="button" onClick={() => mapRef.current?.fit()}>Fit filtered</button></div><div className="results" aria-live="polite">
          {listedProviders.slice(0, rendered).map(provider => { const group = groupFor(provider['Primary Category']); const tier = verificationTier(provider); return <article key={provider.id} className={`provider-card ${activeId === provider.id ? 'active' : ''}`} style={{ '--card-color': group.color }} onClick={() => selectProvider(provider)}><span className="card-bar"/><div><h3>{provider['Company Name']}</h3><p>⌖ {provider.City}, {provider.State}</p><p className="service">{provider['Primary Category']}</p></div><span className={`priority-badge ${tier.className}`}>{tier.label}</span></article>; })}
          {!filtered.length && <div className="empty-state">No providers match these filters.<br/>Try a broader service or location.</div>}{filtered.length > 0 && !listedProviders.length && <div className="empty-state">No matching providers are inside this map view.<br/>Select <b>Fit filtered</b> to bring all {filtered.length.toLocaleString()} matches into view.</div>}{listedProviders.length > rendered && <button className="load-more" type="button" onClick={() => setRendered(value => value + 30)}>Show more providers</button>}
        </div></section>
      </aside>
      <section className="map-stage" aria-label="Provider map"><ProviderMap ref={mapRef} providers={filtered} onVisibleChange={setVisible} onProviderDetails={setDetails} onProviderSelect={setActiveId}/><button className="map-summary" type="button" title="Create a contact list from this map view" onClick={() => setExportOpen(true)}><span className="summary-icon">⌖</span><span><b>{visible.length.toLocaleString()}</b><small>visible locations</small></span><span className="summary-export">Export</span></button><button className="reset-map-btn" type="button" onClick={() => mapRef.current?.resetUS()}>Reset U.S. view</button><button className="locate-btn" type="button" title="Find my location" aria-label="Find my location" onClick={() => mapRef.current?.locate()}>◎</button></section>
    </main>
    {details && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setDetails(null)}><section className="provider-dialog react-modal"><button className="dialog-close" type="button" onClick={() => setDetails(null)}>×</button><div className="detail-head"><h2>{details['Company Name']}</h2></div><div className="detail-body"><div className="detail-grid public-details">{detail('Service provided', publicValue(details['Primary Category']), true)}{detail('Address', publicAddress(details), true)}{detail('Telephone', publicValue(details.Phone))}{safeURL(details.Website) && <div className="detail-item"><small>Website</small><a href={safeURL(details.Website)} target="_blank" rel="noreferrer">{safeURL(details.Website).replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\/$/, '')}</a></div>}</div><div className="detail-actions">{safeURL(details.Website) && <a className="primary" href={safeURL(details.Website)} target="_blank" rel="noreferrer">Visit website ↗</a>}{publicAddress(details) && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${details['Company Name']} ${publicAddress(details)}`)}`} target="_blank" rel="noreferrer">Open in Maps ↗</a>}</div></div></section></div>}
    {exportOpen && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setExportOpen(false)}><section className="export-dialog react-modal"><button className="dialog-close" type="button" onClick={() => setExportOpen(false)}>×</button><div className="export-head"><p className="eyebrow">Contact list builder</p><h2>Providers in this map view</h2><p>Pan or zoom the map to define an area, then export the providers currently inside it.</p></div><div className="export-body"><div className="export-stat"><b>{rows.length.toLocaleString()}</b><span>filtered providers in the visible map area</span></div><div className="export-preview">{rows.slice(0, 6).map(row => <div key={`${row.Company}-${row.Address}`}><b>{row.Company}</b><span>{[row.City, row.State].filter(Boolean).join(', ')}{row.Phone && ` · ${row.Phone}`}</span></div>)}{rows.length > 6 && <small>+ {rows.length - 6} more providers in the export</small>}{!rows.length && <div className="empty-state">No filtered providers are inside the current map view.</div>}</div><p className="export-note">Exports include company, service, address, phone, website, verification status, and coordinates. Active filters are honored.</p><div className="export-actions"><button className="primary" type="button" disabled={!rows.length} onClick={exportExcel}>Export Excel</button><button type="button" disabled={!rows.length} onClick={exportPdf}>Export PDF</button></div></div></section></div>}
    {iconGuideOpen && <div className="modal-backdrop icon-guide-backdrop" onMouseDown={e => e.target === e.currentTarget && setIconGuideOpen(false)}><section className="icon-guide react-modal"><button className="dialog-close" type="button" onClick={() => setIconGuideOpen(false)}>×</button><div className="icon-guide-head"><p className="eyebrow">WellStream Solutions</p><h2>Service provider icon library</h2><p>A visual reference for the oilfield and gasfield service categories represented in the provider atlas.</p></div><div className="icon-guide-canvas"><img src={serviceIconLibrary} alt="WellStream Solutions service provider icon library"/></div></section></div>}
  </div>;
}

export default App;
