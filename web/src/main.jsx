import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { computeMetrics } from './geo.js';
import { Icon } from './icons.jsx';
import { Report } from './report.jsx';
import { Strategy } from './strategy.jsx';

/* ---------- static config ---------- */
const places = [
  { location: 'Whitefield', area: 'East Bengaluru', latitude: 12.9698, longitude: 77.75 },
  { location: 'Hebbal', area: 'North Bengaluru', latitude: 13.0358, longitude: 77.597 },
  { location: 'Sarjapur', area: 'South-east Bengaluru', latitude: 12.9081, longitude: 77.695 },
  { location: 'Electronic City', area: 'South Bengaluru', latitude: 12.8399, longitude: 77.677 },
  { location: 'Devanahalli', area: 'Airport corridor', latitude: 13.247, longitude: 77.713 },
];

// better: 'min' = smaller is better (distance), 'max' = more is better (count), null = no ranking
const sections = [
  { id: 'move', title: 'Getting around', rows: [
    { key: 'nearest_airport_km', label: 'Airport', icon: 'plane', unit: 'km', better: 'min' },
    { key: 'nearest_metro_station_km', label: 'Metro station', icon: 'metro', unit: 'km', better: 'min' },
    { key: 'nearest_rail_station_km', label: 'Railway station', icon: 'train', unit: 'km', better: 'min' },
    { key: 'nearest_highway_km', label: 'Highway', icon: 'road', unit: 'km', better: 'min' },
    { key: 'nearest_tech_park_km', label: 'Tech park', icon: 'build', unit: 'km', better: 'min' },
  ] },
  { id: 'near', title: 'Nearby', rows: [
    { key: 'schools_within_1km', label: 'Schools & colleges', short: 'Schools · 1 km', icon: 'school', unit: 'within 1 km', alt: ['schools_within_3km', 'within 3 km'], better: 'max' },
    { key: 'healthcare_within_1km', label: 'Healthcare', short: 'Healthcare · 1 km', icon: 'health', unit: 'within 1 km', alt: ['healthcare_within_5km', 'within 5 km'], better: 'max' },
    { key: 'parks_within_1km', label: 'Parks & gardens', short: 'Parks · 1 km', icon: 'park', unit: 'within 1 km', alt: ['parks_within_3km', 'within 3 km'], better: 'max' },
    { key: 'retail_within_2km', label: 'Retail', short: 'Retail · 2 km', icon: 'shop', unit: 'within 2 km', sub: 'Supermarkets, malls, convenience', better: 'max' },
  ] },
  { id: 'land', title: 'Land', rows: [
    { key: 'nearest_mapped_water_km', label: 'Nearest water', icon: 'water', unit: 'km', better: null },
    { key: 'road_density_within_1km', label: 'Road density', icon: 'road', unit: 'km/km²', sub: 'Mapped roads within 1 km', better: null },
    { key: 'building_footprint_coverage_within_1km', label: 'Building coverage', icon: 'build', unit: '%', sub: 'Footprints within 1 km', better: null },
  ] },
];
// Compare table shows the secondary radii as their own rows.
const compareRows = sections.map((s) => ({ ...s, rows: s.rows.flatMap((r) => r.alt
  ? [{ ...r, label: r.short }, { key: r.alt[0], label: r.short.replace(/· \d+ km/, '· ' + r.alt[1].replace('within ', '')), better: r.better }]
  : [{ ...r, label: r.short || r.label }]) }));

const layerDefs = [
  { id: 'metro_stations', label: 'Metro', color: { light: '#7C4DDB', dark: '#B48CFF' }, radius: 5 },
  { id: 'rail_stations', label: 'Rail', color: { light: '#D9661F', dark: '#F5A05A' }, radius: 5 },
  { id: 'metro_upcoming', label: 'Upcoming metro', color: { light: '#B79AF0', dark: '#7D63B8' }, radius: 4.5 },
  { id: 'highways', label: 'Highways', color: { light: '#D49A12', dark: '#E2B04A' }, width: 2.4 },
  { id: 'airports', label: 'Airports', color: { light: '#334155', dark: '#E2E8F0' } },
  { id: 'employment_hubs', label: 'Tech parks', color: { light: '#0F766E', dark: '#5EEAD4' } },
  { id: 'schools', label: 'Education', color: { light: '#C98A12', dark: '#E9C46A' } },
  { id: 'healthcare', label: 'Healthcare', color: { light: '#D23F6E', dark: '#F07AA0' } },
  { id: 'parks', label: 'Parks', color: { light: '#24915E', dark: '#5FCB9A' } },
  { id: 'water', label: 'Water', color: { light: '#2B87C8', dark: '#5DB6EC' } },
  { id: 'drains', label: 'Drains', color: { light: '#5FA7D9', dark: '#4C93C4' }, width: 1.4 },
  { id: 'retail', label: 'Retail', color: { light: '#9255D4', dark: '#C59DFF' } },
  { id: 'roads', label: 'Roads', color: { light: '#7B8794', dark: '#8796AE' } },
  { id: 'buildings', label: 'Buildings', color: { light: '#8B97A5', dark: '#C4D0DD' } },
];
const LAZY = ['roads', 'buildings'];
const DEFAULT_LAYERS = ['metro_stations', 'rail_stations', 'highways', 'airports', 'schools', 'healthcare'];
const BASEMAP = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };
const PLAIN = (bg) => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': bg } }] });
const PLAIN_BG = { light: '#EEF0EB', dark: '#0C1016' };
const DEFAULT_AOI = [77.35, 12.75, 77.85, 13.35];
const EDGE_KM = 5;
const MAX_COMPARE = 4;
const LETTERS = 'ABCD';
const empty = { type: 'FeatureCollection', features: [] };

/* ---------- helpers ---------- */
const fetchJSON = async (path) => { const r = await fetch(path, { cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };
const inAoi = ([lon, lat], a) => lon >= a[0] && lon <= a[2] && lat >= a[1] && lat <= a[3];
const nearEdge = ([lon, lat], a) => Math.min((lon - a[0]) * 108.6, (a[2] - lon) * 108.6, (lat - a[1]) * 110.6, (a[3] - lat) * 110.6) < EDGE_KM;
const parseLatLon = (q) => { const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/); if (!m) return null; let a = +m[1], b = +m[2]; if (a > 60 && b < 60) [a, b] = [b, a]; return [b, a]; };
const coords = (e) => `${e.lat.toFixed(4)}° N · ${e.lon.toFixed(4)}° E`;
const pilotEntry = (p) => ({ kind: 'pilot', name: p.location, area: p.area, lon: p.longitude, lat: p.latitude });
const pointEntry = (lon, lat, name = '') => ({ kind: 'point', name: name || 'Selected point', area: '', lon, lat });
const projectEntry = (p) => ({ kind: 'project', id: p.id, name: p.name, area: p.builder, lon: p.lon, lat: p.lat });
const pendingProject = (id) => ({ kind: 'project', id, name: 'Loading…', area: '', lon: 77.64, lat: 12.98, pending: true });
const entryKey = (e) => (e.kind === 'pilot' ? e.name : e.kind === 'project' ? `p:${e.id}` : `${e.lat.toFixed(5)},${e.lon.toFixed(5)}`);
const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Rank: exact/prefix name > name contains > builder or address > curated search terms. Max 6.
function matchProjects(projects, q) {
  const nq = norm(q); if (nq.length < 3) return [];
  const scored = projects.map((p) => {
    const name = norm(p.name), builder = norm(p.builder), addr = norm(p.address);
    const terms = (p.search_terms || []).map(norm).filter((t) => t.length >= 3);
    let sc = 0;
    if (name === nq || nq.includes(name)) sc = 100;
    else if (name.startsWith(nq)) sc = 80;
    else if (name.includes(nq)) sc = 60;
    else if (builder && (builder.includes(nq) || nq.startsWith(builder))) sc = 40;
    else if (addr && addr.includes(nq)) sc = 30;
    else if (terms.some((t) => nq.includes(t) || t.includes(nq))) sc = 20;
    return { p, sc: sc + (p.source === 'curated' && sc ? 5 : 0) };
  }).filter((x) => x.sc > 0);
  return scored.sort((a, b) => b.sc - a.sc || a.p.name.localeCompare(b.p.name)).slice(0, 6).map((x) => x.p);
}

function fmt(row, m) {
  if (!m) return { v: '—', u: '' };
  if (m.status === 'loading') return { v: '…', u: '' };
  if (m.status === 'pilot_only') return { v: 'Pilot only', u: '', muted: true };
  if (m.status === 'not_computed') return { v: 'Not computed', u: '', muted: true };
  if (m.status !== 'calculated' || m.value == null) return { v: 'No data', u: '', muted: true };
  if (row.unit === 'km') return { v: Number(m.value).toFixed(m.value < 10 ? 2 : 1), u: 'km' };
  if (row.unit === 'km/km²') return { v: Number(m.value).toFixed(1), u: 'km/km²' };
  if (row.unit === '%') return { v: Number(m.value).toFixed(1), u: '%' };
  return { v: String(m.value), u: row.unit || '' };
}

function readUrl() {
  const u = new URLSearchParams(location.search);
  const parseEntry = (s) => {
    if (s?.startsWith('p:')) return pendingProject(s.slice(2));
    const p = places.find((x) => x.location === s); if (p) return pilotEntry(p);
    const ll = parseLatLon(s || ''); return ll ? pointEntry(ll[0], ll[1]) : null;
  };
  const compare = (u.get('c') || '').split(/[|~]/).map(parseEntry).filter(Boolean).slice(0, MAX_COMPARE);
  const lat = parseFloat(u.get('lat')), lon = parseFloat(u.get('lon'));
  const current = u.get('project') ? pendingProject(u.get('project'))
    : Number.isFinite(lat) && Number.isFinite(lon) ? pointEntry(lon, lat, u.get('label') || '')
    : pilotEntry(places.find((x) => x.location === u.get('place')) || places[0]);
  const view = u.get('view') === 'strategy' ? 'strategy' : (u.get('view') === 'report' || u.get('report') === '1') ? 'report' : null;
  return { mode: u.get('mode') === 'compare' && compare.length ? 'compare' : 'explore', current, compare, view };
}
function writeUrl(mode, current, compare, view) {
  const u = new URLSearchParams();
  if (current.kind === 'project') { u.set('project', current.id); if (view) u.set('view', view); }
  else if (current.kind === 'pilot') u.set('place', current.name);
  else { u.set('lat', current.lat.toFixed(5)); u.set('lon', current.lon.toFixed(5)); if (current.name !== 'Selected point') u.set('label', current.name); }
  if (compare.length) u.set('c', compare.map((e) => (e.kind === 'pilot' ? e.name : e.kind === 'project' ? `p:${e.id}` : `${e.lat.toFixed(5)},${e.lon.toFixed(5)}`)).join('|'));
  if (mode === 'compare') u.set('mode', 'compare');
  history.replaceState(null, '', `${location.pathname}?${u}`);
}

/* ---------- app ---------- */
function App() {
  const init = useRef(readUrl()).current;
  const [theme, setTheme] = useState(() => (store.get('geointel-theme') === 'dark' ? 'dark' : 'light'));
  const [mode, setMode] = useState(init.mode);
  const [current, setCurrent] = useState(init.current);
  const [compare, setCompare] = useState(init.compare);
  const [tab, setTab] = useState('move');
  const [projects, setProjects] = useState([]), [projMeta, setProjMeta] = useState({});
  const [overlay, setOverlay] = useState(init.view); // 'report' | 'strategy' | null
  const [pilotData, setPilotData] = useState(null), [status, setStatus] = useState(null);
  const [available, setAvailable] = useState({}), [enabled, setEnabled] = useState(DEFAULT_LAYERS);
  const [query, setQuery] = useState(''), [results, setResults] = useState(null), [searching, setSearching] = useState(false), [msg, setMsg] = useState('');
  const [toast, setToast] = useState('');
  const [mapError, setMapError] = useState(''), [styleRev, setStyleRev] = useState(0), [basemapOk, setBasemapOk] = useState(true);
  const mapEl = useRef(null), mapRef = useRef(null), requested = useRef(new Set()), styleOk = useRef(false), fellBack = useRef(false);
  const aoi = pilotData?.aoi_bbox_wsen || DEFAULT_AOI;

  const metricsFor = (e) => (e.kind === 'pilot'
    ? pilotData?.locations?.find((l) => l.location === e.name)?.metrics
    : e.kind === 'project' ? projects.find((p) => p.id === e.id)?.metrics
      : computeMetrics([e.lon, e.lat], available));
  const currentMetrics = useMemo(() => metricsFor(current), [current, available, pilotData, projects]);
  const compareMetrics = useMemo(() => compare.map(metricsFor), [compare, available, pilotData, projects]);
  const currentProject = current.kind === 'project' ? projects.find((p) => p.id === current.id) : null;

  /* data */
  const loadLayer = (id) => { if (requested.current.has(id)) return; requested.current.add(id);
    fetchJSON(`/data/${id}.geojson`).then((g) => setAvailable((o) => ({ ...o, [id]: g }))).catch(() => { /* not published */ }); };
  useEffect(() => {
    fetchJSON('/data/demo_location_metrics.json').then(setPilotData).catch(() => {});
    fetchJSON('/data/data_status.json').then(setStatus).catch(() => {});
    fetchJSON('/data/project_reports.json').then((d) => {
      const list = d.projects || []; setProjects(list); setProjMeta({ generated: d.generated_at_utc, osm: d.osm_retrieved });
      const resolve = (e) => { if (e.kind !== 'project' || !e.pending) return e; const p = list.find((x) => x.id === e.id); return p ? projectEntry(p) : pilotEntry(places[0]); };
      setCurrent(resolve); setCompare((l) => l.map(resolve));
    }).catch(() => {
      const drop = (e) => (e.kind === 'project' && e.pending ? pilotEntry(places[0]) : e);
      setCurrent(drop); setCompare((l) => l.filter((e) => !(e.kind === 'project' && e.pending)));
    });
    layerDefs.filter((l) => !LAZY.includes(l.id)).forEach((l) => loadLayer(l.id));
  }, []);
  useEffect(() => { enabled.filter((id) => LAZY.includes(id)).forEach(loadLayer); }, [enabled]);
  useEffect(() => { if (!current.pending) writeUrl(mode, current, compare, overlay); }, [mode, current, compare, overlay]);
  useEffect(() => { document.documentElement.dataset.theme = theme; store.set('geointel-theme', theme); }, [theme]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 2200); return () => clearTimeout(t); }, [toast]);

  /* actions */
  const addToCompare = (e) => setCompare((list) => {
    if (list.some((x) => entryKey(x) === entryKey(e))) { setToast('Already in comparison'); return list; }
    if (list.length >= MAX_COMPARE) { setToast(`Compare up to ${MAX_COMPARE} locations`); return list; }
    return [...list, e];
  });
  const choose = (e0) => {
    let e = e0;
    if (e0.projectPick) { const p = projects.find((x) => x.id === e0.id); if (!p) return; e = projectEntry(p); }
    if (!inAoi([e.lon, e.lat], aoi)) { setMsg('That point is outside the covered Bengaluru area.'); return; }
    setMsg(''); setResults(null);
    if (mode === 'compare') addToCompare(e); else { setCurrent(e); setOverlay(null); }
  };
  const chooseRef = useRef(choose); chooseRef.current = choose;
  const search = async (ev) => {
    ev.preventDefault(); const q = query.trim(); if (!q) return;
    const ll = parseLatLon(q); if (ll) { choose(pointEntry(ll[0], ll[1])); return; }
    const pilot = places.find((p) => p.location.toLowerCase() === q.toLowerCase()); if (pilot) { choose(pilotEntry(pilot)); return; }
    const projHits = matchProjects(projects, q).map((p) => ({ project: p, name: `${p.name} · ${p.builder}`, sub: p.address || coords(p) }));
    setSearching(true); setMsg(''); setResults(projHits.length ? projHits : null);
    try {
      const [w, s, e, n] = aoi;
      const res = await fetchJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=in&bounded=1&viewbox=${w},${n},${e},${s}&q=${encodeURIComponent(q)}`);
      if (!res.length && !projHits.length) setMsg('No match inside the covered area. Try a locality, or click the map.');
      // Drop geocoder hits that are the same complex as a listed project.
      const projNames = projHits.map((h) => norm(h.project.name));
      const geo = res.filter((r) => !projNames.some((n) => norm(r.display_name.split(',')[0]) === n));
      setResults([...projHits, ...geo.map((r) => ({ lon: +r.lon, lat: +r.lat, name: r.display_name }))]);
    } catch { if (!projHits.length) setMsg('Search is unavailable right now. Click the map or enter “lat, lon”.'); }
    finally { setSearching(false); }
  };
  const share = async () => {
    try { await navigator.clipboard.writeText(location.href); setToast('Link copied'); }
    catch { setToast('Copy the address bar to share'); }
  };
  const exportCsv = () => {
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [['Metric', ...compare.map((e) => e.name)], ['Coordinates', ...compare.map((e) => `${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}`)]];
    compareRows.forEach((s) => s.rows.forEach((r) => lines.push([`${s.title}: ${r.label}${r.unit && !r.unit.startsWith('within') ? ` (${r.unit})` : ''}`,
      ...compareMetrics.map((m) => { const x = m?.[r.key]; return x?.status === 'calculated' ? `${x.value}${x.nearest_feature ? ` (${x.nearest_feature})` : ''}` : ''; })])));
    lines.push(['Source', 'OpenStreetMap contributors (ODbL); straight-line distances']);
    const blob = new Blob([lines.map((l) => l.map(esc).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'geointel-compare.csv'; a.click(); URL.revokeObjectURL(a.href);
  };

  /* map */
  useEffect(() => {
    if (!mapEl.current) return undefined;
    let map;
    try { map = new maplibregl.Map({ container: mapEl.current, style: BASEMAP[theme], center: [77.64, 12.98], zoom: 10.6, attributionControl: false }); }
    catch (err) { setMapError(`Map unavailable: ${err?.message || 'WebGL not supported'}`); return undefined; }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('style.load', () => { styleOk.current = true; setStyleRev((r) => r + 1); });
    map.on('error', (e) => {
      if (!styleOk.current && !fellBack.current) { fellBack.current = true; setBasemapOk(false); map.setStyle(PLAIN(PLAIN_BG[document.documentElement.dataset.theme || 'light'])); return; }
      if (e.sourceId || e.tile) return;
      setMapError(e.error?.message || 'Map rendering error');
    });
    map.on('click', (e) => {
      const ph = map.getLayer('project-points') ? map.queryRenderedFeatures(e.point, { layers: ['project-points'] }) : [];
      if (ph.length) { chooseRef.current({ kind: 'project', id: ph[0].properties.id, projectPick: true }); return; }
      const hit = map.getLayer('place-points') ? map.queryRenderedFeatures(e.point, { layers: ['place-points'] }) : [];
      if (hit.length) { const p = places.find((x) => x.location === hit[0].properties.location); if (p) { chooseRef.current(pilotEntry(p)); return; } }
      chooseRef.current(pointEntry(e.lngLat.lng, e.lngLat.lat));
    });
    map.getCanvas().style.cursor = 'crosshair';
    return () => { map.remove(); mapRef.current = null; };
  }, []);
  // Theme switch: swap basemap; style.load re-adds our layers via styleRev.
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) { firstTheme.current = false; return; }
    const map = mapRef.current; if (!map) return;
    styleOk.current = false;
    map.setStyle(basemapOk ? BASEMAP[theme] : PLAIN(PLAIN_BG[theme]), { diff: false });
  }, [theme]);
  // Data layers + pins (re-run after every style load).
  useEffect(() => {
    const map = mapRef.current; if (!map || !styleRev || !styleOk.current) return;
    const pinColor = theme === 'dark' ? '#7EE0C3' : '#1F7A63', ink = theme === 'dark' ? '#0C1016' : '#FFFFFF';
    for (const l of layerDefs) {
      const src = `osm-${l.id}`, base = `visual-${l.id}`, col = l.color[theme], geo = available[l.id] || empty;
      if (!map.getSource(src)) map.addSource(src, { type: 'geojson', data: geo }); else map.getSource(src).setData(geo);
      const kinds = [
        ['fill', 'fill', ['Polygon', 'MultiPolygon'], { 'fill-color': col, 'fill-opacity': theme === 'dark' ? 0.24 : 0.2 }],
        ['outline', 'line', ['Polygon', 'MultiPolygon'], { 'line-color': col, 'line-width': 1.1, 'line-opacity': 0.8 }],
        ['line', 'line', ['LineString', 'MultiLineString'], { 'line-color': col, 'line-width': l.width || 1.1, 'line-opacity': 0.8 }],
        ['circle', 'circle', ['Point', 'MultiPoint'], { 'circle-color': col, 'circle-radius': l.radius || 3.6, 'circle-stroke-color': ink, 'circle-stroke-width': 1 }],
      ];
      for (const [k, type, geomTypes, paint] of kinds) {
        const id = `${base}-${k}`;
        if (!map.getLayer(id)) map.addLayer({ id, type, source: src, filter: ['match', ['geometry-type'], geomTypes, true, false], paint });
        map.setLayoutProperty(id, 'visibility', enabled.includes(l.id) ? 'visible' : 'none');
      }
    }
    const pilots = { type: 'FeatureCollection', features: places.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] }, properties: { location: p.location } })) };
    if (!map.getSource('places')) {
      map.addSource('places', { type: 'geojson', data: pilots });
      map.addLayer({ id: 'place-points', type: 'circle', source: 'places', paint: { 'circle-radius': 6, 'circle-color': pinColor, 'circle-opacity': 0.55, 'circle-stroke-color': ink, 'circle-stroke-width': 2 } });
      map.on('mouseenter', 'place-points', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'place-points', () => { map.getCanvas().style.cursor = 'crosshair'; });
    }
    const projFc = { type: 'FeatureCollection', features: projects.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { id: p.id, name: p.name } })) };
    if (!map.getSource('projects')) {
      map.addSource('projects', { type: 'geojson', data: projFc });
      map.addLayer({ id: 'project-points', type: 'circle', source: 'projects', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 14, 7], 'circle-color': ink, 'circle-stroke-color': pinColor, 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 3] } });
      if (map.getStyle().glyphs) map.addLayer({ id: 'project-labels', type: 'symbol', source: 'projects', minzoom: 13.5,
        layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-offset': [0, 1.3], 'text-anchor': 'top' },
        paint: { 'text-color': theme === 'dark' ? '#EEF2F6' : '#14171A', 'text-halo-color': ink, 'text-halo-width': 1.5 } });
      map.on('mouseenter', 'project-points', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'project-points', () => { map.getCanvas().style.cursor = 'crosshair'; });
    } else map.getSource('projects').setData(projFc);
    if (!map.getSource('sel')) {
      map.addSource('sel', { type: 'geojson', data: empty });
      map.addLayer({ id: 'sel-halo', type: 'circle', source: 'sel', paint: { 'circle-radius': 20, 'circle-color': pinColor, 'circle-opacity': 0.16 } });
      map.addLayer({ id: 'sel-pin', type: 'circle', source: 'sel', paint: { 'circle-radius': ['case', ['has', 'letter'], 12, 8], 'circle-color': pinColor, 'circle-stroke-color': ink, 'circle-stroke-width': 3 } });
      if (map.getStyle().glyphs) map.addLayer({ id: 'sel-letter', type: 'symbol', source: 'sel', filter: ['has', 'letter'],
        layout: { 'text-field': ['get', 'letter'], 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
        paint: { 'text-color': ink } });
    }
  }, [styleRev, available, enabled, theme, projects]);
  useEffect(() => {
    const map = mapRef.current; if (!map || !styleRev || !map.getSource('sel')) return;
    const pts = mode === 'compare'
      ? compare.map((e, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] }, properties: { letter: LETTERS[i] } }))
      : [{ type: 'Feature', geometry: { type: 'Point', coordinates: [current.lon, current.lat] }, properties: {} }];
    map.getSource('sel').setData({ type: 'FeatureCollection', features: pts });
  }, [styleRev, mode, current, compare]);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (mode === 'explore') map.flyTo({ center: [current.lon, current.lat], zoom: Math.max(map.getZoom(), 12.5), padding: { left: window.innerWidth > 760 ? 420 : 0, bottom: window.innerWidth > 760 ? 0 : 360 }, duration: 800 });
    else if (compare.length) {
      const b = new maplibregl.LngLatBounds(); compare.forEach((e) => b.extend([e.lon, e.lat]));
      map.fitBounds(b, { padding: { top: 110, left: 60, right: 60, bottom: Math.round(window.innerHeight * 0.52) }, maxZoom: 13, duration: 800 });
    }
  }, [mode, current, compare.length]);

  /* render */
  const edge = current.kind === 'point' && nearEdge([current.lon, current.lat], aoi);
  const section = sections.find((s) => s.id === tab);
  const best = (row) => {
    if (!row.better) return -1;
    const vals = compareMetrics.map((m) => (m?.[row.key]?.status === 'calculated' ? Number(m[row.key].value) : null));
    const valid = vals.filter((v) => v != null); if (valid.length < 2) return -1;
    const target = row.better === 'min' ? Math.min(...valid) : Math.max(...valid);
    return vals.filter((v) => v === target).length === 1 ? vals.indexOf(target) : -1;
  };

  return (
    <div className="app">
      <div className="map" ref={mapEl} role="region" aria-label="Map. Click to choose a location." />

      <header className="topbar">
        <div className="brand"><span className="brand-mark">G</span><span className="brand-name">GeoIntel</span><span className="brand-city">Bengaluru</span></div>
        <form className="search glass" onSubmit={search} role="search">
          <Icon name="search" className="muted" />
          <label className="sr" htmlFor="q">{mode === 'compare' ? 'Add a location to compare' : 'Search a location'}</label>
          <input id="q" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off"
            placeholder={mode === 'compare' ? 'Add a location: address, locality or lat, lon' : 'Search an address, locality or lat, lon'} />
          <button type="submit" className="btn-ghost" disabled={searching}>{searching ? 'Searching…' : 'Go'}</button>
          {(results?.length > 0 || msg) && (
            <div className="results glass">
              {results?.map((r, i) => (
                <button type="button" key={i} className={r.project ? 'is-project' : ''} onClick={() => choose(r.project ? projectEntry(r.project) : pointEntry(r.lon, r.lat, r.name.split(',').slice(0, 2).join(',')))}>
                  <Icon name={r.project ? 'build' : 'pin'} size={16} className={r.project ? 'accent' : 'muted'} />
                  <span>{r.project && <span className="tag">Project</span>}{r.name}{r.sub && <span className="res-sub">{r.sub}</span>}</span>
                </button>))}
              {msg && <p className="results-msg">{msg}</p>}
            </div>)}
        </form>
        <div className="top-actions">
          <div className="segmented glass" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={mode === 'explore'} onClick={() => setMode('explore')}>Explore</button>
            <button type="button" role="tab" aria-selected={mode === 'compare'} onClick={() => setMode('compare')}>Compare{compare.length ? <span className="count">{compare.length}</span> : null}</button>
          </div>
          <label className="sr" htmlFor="pilot">Pilot areas</label>
          <select id="pilot" className="glass select" value={current.kind === 'pilot' && mode === 'explore' ? current.name : ''}
            onChange={(e) => { const p = places.find((x) => x.location === e.target.value); if (p) choose(pilotEntry(p)); }}>
            <option value="" disabled>Pilot areas</option>
            {places.map((p) => <option key={p.location} value={p.location}>{p.location}</option>)}
          </select>
          <button type="button" className="icon-btn glass" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'} title={theme === 'light' ? 'Dark theme' : 'Light theme'}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} />
          </button>
          <button type="button" className="icon-btn glass" onClick={share} aria-label="Copy link to this view" title="Copy link"><Icon name="share" /></button>
        </div>
      </header>

      {mode === 'explore' && (
        <section className="card glass" aria-label="Location summary">
          <div className="eyebrow">{current.kind === 'pilot' ? `PILOT AREA · ${current.area.toUpperCase()}` : current.kind === 'project' ? `PROJECT · ${(current.area || '').toUpperCase()}` : 'SELECTED POINT'}</div>
          <h1>{current.name}</h1>
          <div className="coords">{currentProject?.address || coords(current)}</div>
          {currentProject && (
            <div className="card-actions">
              <button type="button" className="btn" onClick={() => setOverlay('strategy')}><Icon name="compare" size={16} />Market strategy</button>
              <button type="button" className="btn-ghost" onClick={() => setOverlay('report')}><Icon name="info" size={16} />Location report</button>
            </div>)}
          <div className="tabs" role="tablist" aria-label="Indicator group">
            {sections.map((s) => <button type="button" role="tab" key={s.id} aria-selected={tab === s.id} onClick={() => setTab(s.id)}>{s.title}</button>)}
          </div>
          <div className="rows" role="tabpanel">
            {section.rows.map((r) => {
              const m = currentMetrics?.[r.key]; const f = fmt(r, m);
              const altM = r.alt ? currentMetrics?.[r.alt[0]] : null;
              const sub = m?.nearest_feature || (altM?.status === 'calculated' ? `${altM.value} ${r.alt[1]}` : r.sub) || '';
              return (
                <div className="row" key={r.key} title={m?.method || ''}>
                  <span className="row-icon"><Icon name={r.icon} /></span>
                  <div className="row-text"><div className="row-label">{r.label}</div>{sub && <div className="row-sub">{sub}</div>}</div>
                  <div className={`row-val${f.muted ? ' is-muted' : ''}`}><div className="num">{f.v}</div><div className="unit">{f.u === 'km' || f.u === '%' || f.u === 'km/km²' ? f.u : r.unit.startsWith('within') && !f.muted ? r.unit : ''}</div></div>
                </div>);
            })}
          </div>
          {edge && <p className="note warn">Near the edge of the covered area, so counts and nearest features may be incomplete.</p>}
          <div className="card-foot">
            <details>
              <summary><Icon name="info" size={15} />How it’s calculated</summary>
              <p>Straight-line distances and counts of features mapped in OpenStreetMap. Only operational metro and rail stations are counted. Missing features in OSM don’t mean they don’t exist. Not a title, zoning or flood assessment.</p>
            </details>
            <button type="button" className="btn" onClick={() => { addToCompare(current); setToast(`Added ${current.name} to compare`); }}><Icon name="compare" size={16} />Add to compare</button>
          </div>
        </section>
      )}

      {mode === 'compare' && (
        <section className="compare glass" aria-label="Compare locations">
          <div className="compare-head">
            <div><h2>Compare</h2><span className="muted small">{compare.length ? `${compare.length} of ${MAX_COMPARE} locations · search or click the map to add` : 'Search or click the map to add up to 4 locations'}</span></div>
            <div className="compare-actions">
              {compare.length > 0 && <button type="button" className="btn-ghost" onClick={() => setCompare([])}>Clear</button>}
              <button type="button" className="btn" disabled={!compare.length} onClick={exportCsv}><Icon name="download" size={16} />Export CSV</button>
            </div>
          </div>
          {compare.length === 0 ? (
            <div className="compare-empty">
              <p>Pick locations to see them side by side. Try the pilot areas:</p>
              <div className="chips">{places.map((p) => <button type="button" className="chip" key={p.location} onClick={() => addToCompare(pilotEntry(p))}><Icon name="plus" size={14} />{p.location}</button>)}</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col" className="th-metric">Metric</th>{compare.map((e, i) => (
                  <th scope="col" key={entryKey(e)}>
                    <div className="col-head"><span className="letter">{LETTERS[i]}</span><span className="col-name">{e.name}</span>
                      <button type="button" className="icon-btn sm" aria-label={`Remove ${e.name}`} onClick={() => setCompare((l) => l.filter((x) => entryKey(x) !== entryKey(e)))}><Icon name="close" size={14} /></button></div>
                    <div className="muted small">{e.kind === 'pilot' ? 'Pilot area' : coords(e)}</div>
                  </th>))}</tr></thead>
                {compareRows.map((s) => (
                  <tbody key={s.id}>
                    <tr className="group"><th scope="rowgroup" colSpan={compare.length + 1}>{s.title}</th></tr>
                    {s.rows.map((r) => { const b = best(r); return (
                      <tr key={r.key}><th scope="row">{r.label}</th>{compareMetrics.map((m, i) => { const x = m?.[r.key]; const f = fmt(r, x); return (
                        <td key={i} className={i === b ? 'is-best' : ''} title={x?.method || ''}>
                          <span className={`num${f.muted ? ' is-muted' : ''}`}>{f.v}</span>{['km', '%', 'km/km²'].includes(f.u) && <span className="unit"> {f.u}</span>}
                          {i === b && <span className="best">Best</span>}
                          {x?.nearest_feature && <div className="cell-sub">{x.nearest_feature}</div>}
                        </td>); })}</tr>); })}
                  </tbody>))}
              </table>
            </div>
          )}
        </section>
      )}

      <nav className="layers glass" aria-label="Map layers">
        {layerDefs.map((l) => { const on = enabled.includes(l.id); return (
          <button type="button" key={l.id} className="chip" aria-pressed={on} onClick={() => setEnabled((o) => (on ? o.filter((v) => v !== l.id) : [...o, l.id]))}>
            <span className="dot" style={{ background: l.color[theme] }} />{l.label}
          </button>); })}
      </nav>

      <div className="attribution">
        {mapError ? <span className="err">{mapError}</span> : null}
        {basemapOk ? <>Basemap <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> · </> : 'Basemap unavailable · '}
        Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · Search <a href="https://nominatim.org" target="_blank" rel="noreferrer">Nominatim</a>
        {status?.generated_at_utc ? ` · Updated ${new Date(status.generated_at_utc).toLocaleDateString()}` : ''}
      </div>
      {toast && <div className="toast glass" role="status">{toast}</div>}
      {overlay === 'report' && currentProject && (
        <Report project={{ ...currentProject, _generated: projMeta.generated, _osm: projMeta.osm }} metroFc={available.metro_stations}
          onClose={() => setOverlay(null)} onShare={share} />)}
      {overlay === 'strategy' && currentProject && (
        <Strategy project={currentProject} projects={projects} onClose={() => setOverlay(null)} onShare={share}
          onOpenReport={() => setOverlay('report')} />)}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
