import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import L from 'leaflet';
import { groupFor } from './data.js';
import serviceIconLibrary from '../assets/Service Provider Icons.png';

const CLUSTER_MAX_ZOOM = 9;
const CONTINENTAL_US_CENTER = L.latLng(39.833, -98.583);
const ICON = {
  pressure: [-15, -35], drilling: [-78, -35], construction: [-136, -35], environmental: [-198, -35], vendor: [-258, -35], engineering: [-316, -35], geophysics: [-367, -35], seismic: [-418, -35],
  regulatory: [-15, -96], trucking: [-78, -96], completion: [-136, -96], workover: [-198, -96], swab: [-258, -96], water: [-316, -96], fracTank: [-367, -96], production: [-418, -96],
  cementing: [-15, -154], coiledTubing: [-78, -154], wireline: [-136, -154], directional: [-198, -154], laboratory: [-258, -154], waste: [-316, -154], safety: [-367, -154], inspection: [-418, -154],
  surveying: [-15, -210], rightOfWay: [-78, -210], land: [-136, -210], pipeline: [-198, -210], mechanical: [-258, -210], electrical: [-316, -210], instrumentation: [-367, -210], fabrication: [-418, -210],
  blasting: [-15, -251], reclamation: [-78, -251], project: [-136, -251], pipe: [-198, -251], valves: [-258, -251], artificialLift: [-316, -251], storage: [-367, -251], rental: [-418, -251]
};

function serviceIconFor(category = '') {
  const value = category.toLowerCase();
  if (/frac tank|fluid storage/.test(value)) return ICON.fracTank;
  if (/^cement/.test(value)) return ICON.cementing;
  if (/^coiled tubing|^coil tubing/.test(value)) return ICON.coiledTubing;
  if (/^wireline|^slickline|^e-line/.test(value)) return ICON.wireline;
  if (/pressure pump|hydraulic frac|\bfrac\b|stimulation|acidiz/.test(value)) return ICON.pressure;
  if (/cement/.test(value)) return ICON.cementing;
  if (/coiled tubing|coil tubing/.test(value)) return ICON.coiledTubing;
  if (/wireline|slickline|e-line|logging/.test(value)) return ICON.wireline;
  if (/directional|mwd|lwd|geosteering|coring/.test(value)) return ICON.directional;
  if (/drilling|drill contractor|\brig\b/.test(value)) return ICON.drilling;
  if (/flowback|production testing|well testing/.test(value)) return ICON.completion;
  if (/swab/.test(value)) return ICON.swab;
  if (/workover|well servic|service rig|snubbing/.test(value)) return ICON.workover;
  if (/capillary|esp spooling|cable spooling/.test(value)) return ICON.artificialLift;
  if (/artificial lift/.test(value)) return ICON.artificialLift;
  if (/production/.test(value)) return ICON.production;
  if (/water haul/.test(value)) return ICON.water;
  if (/waste|disposal/.test(value)) return ICON.waste;
  if (/environment|reclamation/.test(value)) return ICON.environmental;
  if (/chemical|laborator/.test(value)) return ICON.laboratory;
  if (/valve|fitting|wellhead/.test(value)) return ICON.valves;
  if (/pipe|tubular|octg/.test(value)) return ICON.pipe;
  if (/hydro test|pressure test/.test(value)) return ICON.inspection;
  if (/rental/.test(value)) return ICON.rental;
  if (/instrument|measurement|meter|automation|scada|control/.test(value)) return ICON.instrumentation;
  if (/pipeline/.test(value)) return ICON.pipeline;
  if (/trucking|transport/.test(value)) return ICON.trucking;
  if (/fabricat|welding/.test(value)) return ICON.fabrication;
  if (/construction/.test(value)) return ICON.construction;
  if (/inspection|integrity|ndt/.test(value)) return ICON.inspection;
  if (/seismic/.test(value)) return ICON.seismic;
  if (/geophys/.test(value)) return ICON.geophysics;
  if (/survey/.test(value)) return ICON.surveying;
  if (/engineering|consult/.test(value)) return ICON.engineering;
  if (/supply|equipment/.test(value)) return ICON.vendor;
  return ICON.vendor;
}
const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

const ProviderMap = forwardRef(function ProviderMap({ providers, onVisibleChange, onProviderDetails, onProviderSelect }, ref) {
  const elementRef = useRef(null);
  const mapRef = useRef(null);
  const markerLayerRef = useRef(null);
  const clusterLayerRef = useRef(null);
  const itemsRef = useRef([]);
  const providersRef = useRef(providers);
  const callbacksRef = useRef({ onVisibleChange, onProviderDetails, onProviderSelect });
  providersRef.current = providers;
  callbacksRef.current = { onVisibleChange, onProviderDetails, onProviderSelect };

  const publishVisible = () => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    callbacksRef.current.onVisibleChange(providersRef.current.filter(p => bounds.contains([Number(p.Latitude), Number(p.Longitude)])));
  };

  const setMarkerVisible = (item, visible) => {
    item.marker.setOpacity(visible ? 1 : 0);
    item.marker.setZIndexOffset(visible ? 0 : -1000);
    const element = item.marker.getElement();
    if (element) element.style.pointerEvents = visible ? 'auto' : 'none';
  };

  const updateConstellations = () => {
    const map = mapRef.current;
    if (!map) return;
    itemsRef.current.forEach(item => {
      if (!item.constellationCenter) return item.marker.setLatLng(item.actualLatLng);
      const point = map.latLngToLayerPoint(item.constellationCenter).add(L.point(item.offset.x, item.offset.y));
      item.marker.setLatLng(map.layerPointToLatLng(point));
    });
  };

  const updateLayout = () => {
    const map = mapRef.current; const clusters = clusterLayerRef.current;
    if (!map || !clusters) return;
    clusters.clearLayers();
    if (map.getZoom() > CLUSTER_MAX_ZOOM) {
      itemsRef.current.forEach(item => setMarkerVisible(item, true)); updateConstellations(); return;
    }
    itemsRef.current.forEach(item => { item.marker.setLatLng(item.actualLatLng); setMarkerVisible(item, true); });
    const pending = new Set(itemsRef.current); const threshold = map.getZoom() <= 5 ? 58 : 48;
    while (pending.size) {
      const seed = pending.values().next().value; pending.delete(seed);
      const seedPoint = map.latLngToLayerPoint(seed.actualLatLng); const group = [seed];
      for (const candidate of [...pending]) {
        if (seedPoint.distanceTo(map.latLngToLayerPoint(candidate.actualLatLng)) <= threshold) { group.push(candidate); pending.delete(candidate); }
      }
      if (group.length === 1) continue;
      group.forEach(item => setMarkerVisible(item, false));
      const center = L.latLng(group.reduce((sum, item) => sum + item.actualLatLng.lat, 0) / group.length, group.reduce((sum, item) => sum + item.actualLatLng.lng, 0) / group.length);
      const colors = [...new Set(group.map(item => groupFor(item.provider['Primary Category']).color))].slice(0, 6);
      const segments = colors.map((color, index) => `${color} ${index / colors.length * 100}% ${(index + 1) / colors.length * 100}%`).join(',');
      const icon = L.divIcon({ className: '', html: `<div class="area-cluster" style="--cluster-ring:conic-gradient(${segments})"><span>${group.length}</span><small>providers</small></div>`, iconSize: [56, 56], iconAnchor: [28, 28] });
      const names = group.slice(0, 6).map(item => escapeHTML(item.provider['Company Name'])).join('<br>');
      const more = group.length > 6 ? `<br><em>+${group.length - 6} more</em>` : '';
      L.marker(center, { icon, title: `${group.length} providers in this area`, zIndexOffset: 900 })
        .bindTooltip(`<b>${group.length} providers in this area</b><br>${names}${more}`, { direction: 'top', offset: [0, -22] })
        .on('click', () => map.flyTo(center, Math.min(11, map.getZoom() + 3), { duration: .65 })).addTo(clusters);
    }
  };

  useEffect(() => {
    const map = L.map(elementRef.current, {
      zoomControl: true,
      preferCanvas: true,
      minZoom: 3,
      zoomSnap: .25,
      zoomDelta: .25,
      wheelPxPerZoomLevel: 120,
      wheelDebounceTime: 55
    });
    map.setView(CONTINENTAL_US_CENTER, 4, { animate: false });
    mapRef.current = map;
    const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, className: 'street-basemap-tiles', attribution: '&copy; OpenStreetMap' });
    const imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, className: 'satellite-basemap-tiles', attribution: 'Tiles &copy; Esri' });
    const roads = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, className: 'satellite-reference-tiles' });
    const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, className: 'satellite-reference-tiles' });
    street.addTo(map); L.control.layers({ 'Street map': street, 'Satellite + roads': L.layerGroup([imagery, roads, labels]) }, null, { position: 'topleft', collapsed: false }).addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map); clusterLayerRef.current = L.layerGroup().addTo(map);
    map.createPane('stateBoundaries'); map.getPane('stateBoundaries').style.zIndex = 350; map.getPane('stateBoundaries').style.pointerEvents = 'none';
    fetch('https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json').then(r => r.json()).then(states => L.layerGroup([
      L.geoJSON(states, { pane: 'stateBoundaries', interactive: false, style: { color: '#fff', weight: 4.5, opacity: .72, fillOpacity: 0 } }),
      L.geoJSON(states, { pane: 'stateBoundaries', interactive: false, style: { color: '#0b1416', weight: 2.2, opacity: .86, fillOpacity: 0 } })
    ]).addTo(map)).catch(() => {});
    map.on('moveend', publishVisible); map.on('zoomend', () => { updateLayout(); publishVisible(); });
    const initializeUSView = () => {
      map.invalidateSize({ animate: false });
      map.setView(CONTINENTAL_US_CENTER, 4, { animate: false, reset: true });
      const center = map.getCenter();
      elementRef.current.dataset.mapCenter = `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
      publishVisible();
    };
    const viewTimers = [window.setTimeout(initializeUSView, 0), window.setTimeout(initializeUSView, 350), window.setTimeout(initializeUSView, 1200)];
    return () => { viewTimers.forEach(window.clearTimeout); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const layer = markerLayerRef.current; if (!layer) return;
    layer.clearLayers(); itemsRef.current = providers.map(provider => {
      const actualLatLng = L.latLng(Number(provider.Latitude), Number(provider.Longitude)); const group = groupFor(provider['Primary Category']);
      const [spriteX, spriteY] = serviceIconFor(provider['Primary Category']);
      const icon = L.divIcon({
        className: '',
        html: `<div class="service-provider-marker" style="--marker-color:${group.color};--sprite-x:${spriteX}px;--sprite-y:${spriteY}px;background-image:url('${serviceIconLibrary}')"></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        popupAnchor: [0, -17]
      });
      const marker = L.marker(actualLatLng, { icon, title: provider['Company Name'] }).bindPopup(`<div class="popup-card"><h3>${escapeHTML(provider['Company Name'])}</h3><p>${escapeHTML(provider['Primary Category'])}</p><p>⌖ ${escapeHTML(provider.City)}, ${escapeHTML(provider.State)}</p><button>View provider details</button></div>`);
      marker.on('popupopen', event => event.popup.getElement().querySelector('button')?.addEventListener('click', () => callbacksRef.current.onProviderDetails(provider)));
      marker.on('click', () => callbacksRef.current.onProviderSelect(provider.id)); marker.addTo(layer);
      return { marker, provider, actualLatLng, offset: { x: 0, y: 0 } };
    });
    const shared = new Map(); itemsRef.current.forEach(item => { const key = `${item.actualLatLng.lat.toFixed(5)}|${item.actualLatLng.lng.toFixed(5)}`; shared.set(key, [...(shared.get(key) || []), item]); });
    shared.forEach(items => {
      if (items.length < 2) return;
      const center = L.latLng(items.reduce((s, i) => s + i.actualLatLng.lat, 0) / items.length, items.reduce((s, i) => s + i.actualLatLng.lng, 0) / items.length);
      const sorted = [...items].sort((a, b) => a.provider['Company Name'].localeCompare(b.provider['Company Name']));
      let placed = 0; let ring = 0;
      while (placed < sorted.length) {
        const capacity = ring === 0 ? Math.min(sorted.length, 8) : 8 + ring * 6;
        const count = Math.min(capacity, sorted.length - placed); const radius = 25 + ring * 20;
        for (let index = 0; index < count; index++) {
          const angle = -Math.PI / 2 + Math.PI * 2 * index / count + (ring % 2 ? Math.PI / count : 0); const item = sorted[placed + index];
          item.constellationCenter = center; item.offset = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
        }
        placed += count; ring++;
      }
    });
    updateLayout(); publishVisible();
  }, [providers]);

  useImperativeHandle(ref, () => ({
    fit: () => { const map = mapRef.current; if (map && providers.length) map.fitBounds(L.latLngBounds(providers.map(p => [Number(p.Latitude), Number(p.Longitude)])), { padding: [35, 35], maxZoom: 9 }); },
    select: provider => { const map = mapRef.current; const item = itemsRef.current.find(entry => entry.provider.id === provider.id); if (!map || !item) return; const zoom = Math.max(map.getZoom(), 11); map.once('moveend', () => item.marker.openPopup()); map.flyTo(item.actualLatLng, zoom, { duration: .7 }); },
    locate: () => mapRef.current?.locate({ setView: true, maxZoom: 9 })
    ,resetUS: () => {
      const map = mapRef.current;
      if (!map) return;
      map.invalidateSize();
      map.setView(CONTINENTAL_US_CENTER, 4, { animate: true, reset: true });
    }
  }), [providers]);

  return <div id="map" ref={elementRef} />;
});

export default ProviderMap;
