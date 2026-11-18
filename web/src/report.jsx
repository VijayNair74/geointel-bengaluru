import React, { useMemo } from 'react';
import { Icon } from './icons.jsx';
import { haversineM } from './geo.js';

// Distances: under 1 km in metres (rounded to 10 m), otherwise km.
// Under 100 m round to 5 m (short distances matter, e.g. drains); under 1 km to 10 m; otherwise 0.1 km.
export const fmtDist = (km) => {
  if (km == null) return '—';
  const m = km * 1000;
  if (m < 100) return `${Math.max(5, Math.round(m / 5) * 5)} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${km.toFixed(1)} km`;
};
const val = (m) => (m?.status === 'calculated' ? m.value : null);

// Operational stations near the site, from the published metro layer (for the "within walking distance" line).
function stationsNear(metroFc, lon, lat, maxM) {
  return (metroFc?.features || [])
    .filter((f) => f.geometry?.type === 'Point' && f.properties?.name)
    .map((f) => ({ name: f.properties.name, m: haversineM([lon, lat], f.geometry.coordinates) }))
    .filter((s) => s.m <= maxM)
    .sort((a, b) => a.m - b.m)
    .filter((s, i, arr) => arr.findIndex((x) => x.name === s.name) === i);
}

/** Deterministic, evidence-backed headline facts; each carries its source. */
export function highlights(p, metroFc) {
  const m = p.metrics || {}, ev = p.evidence || {}, out = [];
  const metro = val(m.nearest_metro_station_km);
  if (metro != null && metro <= 1.5) {
    const near = stationsNear(metroFc, p.lon, p.lat, 1000);
    out.push({ icon: 'metro', value: fmtDist(metro), label: `to ${m.nearest_metro_station_km.nearest_feature} metro station (operational)`,
      note: near.length > 1 ? `${near.length} operational stations within 1 km` : null, src: 'OpenStreetMap' });
  }
  const hwy = val(m.nearest_highway_km);
  if (hwy != null && hwy <= 1) out.push({ icon: 'road', value: fmtDist(hwy), label: `to ${m.nearest_highway_km.nearest_feature}`, src: 'OpenStreetMap' });
  const sch = val(m.schools_within_3km);
  if (sch) out.push({ icon: 'school', value: String(sch), label: 'schools & colleges within 3 km', src: 'OpenStreetMap' });
  const hc = val(m.healthcare_within_5km);
  if (hc) out.push({ icon: 'health', value: String(hc), label: 'hospitals & clinics within 5 km', src: 'OpenStreetMap' });
  const up = ev.upcoming_metro_within_5km?.[0];
  if (up && up.distance_km <= 3) out.push({ icon: 'metro', value: fmtDist(up.distance_km), label: `to upcoming ${up.name} station`, note: up.status, src: 'OpenStreetMap' });
  const lake = ev.nearest_lake;
  if (lake?.name && lake.distance_m <= 600) out.push({ icon: 'water', value: fmtDist(lake.distance_m / 1000), label: `to ${lake.name}`, note: lake.area_acres ? `${lake.area_acres} acres` : null, src: 'OpenStreetMap' });
  const air = val(m.nearest_airport_km);
  if (air != null) out.push({ icon: 'plane', value: fmtDist(air), label: 'to Kempegowda International Airport', note: 'straight line', src: 'OpenStreetMap' });
  return out.slice(0, 6);
}

function Row({ label, value, sub }) {
  return <tr><th scope="row">{label}</th><td><span className="r-val">{value}</span>{sub && <span className="r-sub">{sub}</span>}</td></tr>;
}

export function Report({ project: p, metroFc, onClose, onShare }) {
  const m = p.metrics || {}, ev = p.evidence || {};
  const hl = useMemo(() => highlights(p, metroFc), [p, metroFc]);
  const nearStations = useMemo(() => stationsNear(metroFc, p.lon, p.lat, 2000), [metroFc, p]);
  const lake = ev.nearest_lake, elev = ev.elevation || {};
  const updated = p._generated ? new Date(p._generated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const n = (k) => val(m[k]);
  const buffer = lake ? (lake.distance_m > 75
    ? `Outside every lake buffer zone that has applied in Bengaluru (30 m under the 2015 master plan; 75 m under the 2016 NGT order, set aside in 2019).`
    : lake.distance_m > 30 ? `Between the 30 m and 75 m buffer lines that have applied to Bengaluru lakes. Check the current rule and the approved plan.`
      : `Within 30 m of a mapped lake edge. Check buffer-zone compliance against the approved plan.`) : null;

  return (
    <div className="report" data-theme="light" role="dialog" aria-label={`Location report: ${p.name}`}>
      <div className="report-bar">
        <button type="button" className="btn-ghost" onClick={onClose}><Icon name="close" size={15} />Close</button>
        <div className="report-bar-actions">
          <button type="button" className="btn-ghost" onClick={onShare}><Icon name="share" size={15} />Copy link</button>
          <button type="button" className="btn" onClick={() => window.print()}><Icon name="download" size={15} />Save as PDF</button>
        </div>
      </div>
      <article className="report-page">
        <header className="r-head">
          <div className="eyebrow">LOCATION REPORT</div>
          <h1>{p.name}</h1>
          <p className="r-addr">{p.builder} · {p.address}</p>
          <div className="r-facts">
            {p.status && <span>{p.status}</span>}
            {p.facts?.total_units && <span>{p.facts.total_units} units</span>}
            {p.facts?.land_area_acres && <span>{p.facts.land_area_acres} acres</span>}
            {p.facts?.configurations && <span>{p.facts.configurations}</span>}
          </div>
        </header>

        <section className="r-highlights" aria-label="Highlights">
          {hl.map((h, i) => (
            <div className="r-hl" key={i}>
              <span className="row-icon"><Icon name={h.icon} /></span>
              <div><div className="r-hl-val">{h.value}</div><div className="r-hl-label">{h.label}</div>{h.note && <div className="r-hl-note">{h.note}</div>}</div>
            </div>))}
        </section>

        <section>
          <h2>Getting around</h2>
          <table className="r-table"><tbody>
            <Row label="Nearest metro station" value={fmtDist(n('nearest_metro_station_km'))} sub={m.nearest_metro_station_km?.nearest_feature} />
            {nearStations.length > 1 && <Row label="Operational stations within 2 km" value={String(nearStations.length)} sub={nearStations.map((s) => `${s.name} ${fmtDist(s.m / 1000)}`).join(' · ')} />}
            <Row label="Nearest railway station" value={fmtDist(n('nearest_rail_station_km'))} sub={m.nearest_rail_station_km?.nearest_feature} />
            <Row label="Nearest highway" value={fmtDist(n('nearest_highway_km'))} sub={m.nearest_highway_km?.nearest_feature} />
            <Row label="Airport" value={fmtDist(n('nearest_airport_km'))} sub={m.nearest_airport_km?.nearest_feature} />
          </tbody></table>
        </section>

        {ev.upcoming_metro_within_5km?.length > 0 && (
          <section>
            <h2>Upcoming metro within 5 km</h2>
            <table className="r-table"><tbody>
              {ev.upcoming_metro_within_5km.map((u) => <Row key={u.name + u.distance_km} label={u.name} value={fmtDist(u.distance_km)} sub={u.status} />)}
            </tbody></table>
            <p className="r-note">Shown separately and never counted in the distances above.</p>
          </section>)}

        <section>
          <h2>Everyday needs</h2>
          <table className="r-table"><tbody>
            <Row label="Schools & colleges" value={`${n('schools_within_1km') ?? '—'} within 1 km`} sub={`${n('schools_within_3km') ?? '—'} within 3 km`} />
            <Row label="Hospitals & clinics" value={`${n('healthcare_within_1km') ?? '—'} within 1 km`} sub={`${n('healthcare_within_5km') ?? '—'} within 5 km`} />
            <Row label="Parks & gardens" value={`${n('parks_within_1km') ?? '—'} within 1 km`} sub={`${n('parks_within_3km') ?? '—'} within 3 km`} />
            <Row label="Supermarkets, malls, convenience" value={`${n('retail_within_2km') ?? '—'} within 2 km`} />
          </tbody></table>
        </section>

        <section>
          <h2>Lakes & drainage</h2>
          <table className="r-table"><tbody>
            {lake && <Row label="Nearest lake edge" value={fmtDist(lake.distance_m / 1000)} sub={[lake.name, lake.area_acres ? `${lake.area_acres} acres` : null].filter(Boolean).join(' · ')} />}
            <Row label="Water bodies within 2 km" value={String(ev.water_bodies_within_2km ?? 0)} sub={[...new Set((ev.lakes_within_2km || []).map((l) => l.name))].slice(0, 6).join(', ')} />
            {ev.nearest_drain && <Row label="Nearest mapped drain or stream" value={fmtDist(ev.nearest_drain.distance_m / 1000)} sub={[ev.nearest_drain.name, ev.nearest_drain.type].filter(Boolean).join(' · ')} />}
            {elev.height_above_lake_m != null && <Row label="Ground height vs nearest lake" value={`${elev.height_above_lake_m > 0 ? '+' : ''}${elev.height_above_lake_m} m`} sub="approximate, from a 30 m satellite surface model" />}
          </tbody></table>
          {buffer && <p className="r-note">{buffer}</p>}
          {ev.nearest_drain && ev.nearest_drain.distance_m <= 60 && (
            <p className="r-note">A mapped drain runs {ev.nearest_drain.distance_m} m from the site point. Bengaluru drain buffer zones have ranged from 15 m to 50 m depending on the drain’s class, which OpenStreetMap does not record. Check against the approved plan and the drain’s official classification.</p>)}
          <p className="r-note">Flood history is not included yet; it needs official flood-location records.</p>
        </section>

        <section>
          <h2>Neighbourhood form</h2>
          <table className="r-table"><tbody>
            <Row label="Road density within 1 km" value={n('road_density_within_1km') != null ? `${n('road_density_within_1km').toFixed(1)} km/km²` : '—'} />
            <Row label="Building footprint coverage within 1 km" value={n('building_footprint_coverage_within_1km') != null ? `${n('building_footprint_coverage_within_1km').toFixed(1)}%` : '—'} />
          </tbody></table>
        </section>

        <footer className="r-foot">
          <p><strong>Sources.</strong> Map data © OpenStreetMap contributors (ODbL){p._osm ? `, retrieved ${p._osm}` : ''}. Elevation: Copernicus DEM GLO-30. Project facts: the builder’s public listing{p.source_url ? <> (<a href={p.source_url} target="_blank" rel="noreferrer">source</a>)</> : null}.</p>
          <p><strong>Method.</strong> Straight-line distances from the site point. Counts are mapped features. Only operational stations are used for distances.</p>
          <p>Prepared by GeoIntel{updated ? ` · ${updated}` : ''} · blr.geointel.workers.dev · Not affiliated with {p.builder}.</p>
        </footer>
      </article>
    </div>
  );
}
