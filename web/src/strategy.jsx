import React, { useMemo } from 'react';
import { Icon } from './icons.jsx';
import { haversineM } from './geo.js';
import { fmtDist } from './report.jsx';

// Location factors a builder can market on. better: 'min' = smaller is better (distance), 'max' = more is better.
const FACTORS = [
  { key: 'nearest_metro_station_km', label: 'Metro access', icon: 'metro', better: 'min', unit: 'km' },
  { key: 'nearest_tech_park_km', label: 'Tech park access', icon: 'build', better: 'min', unit: 'km' },
  { key: 'tech_parks_within_5km', label: 'Tech parks within 5 km', icon: 'build', better: 'max' },
  { key: 'nearest_highway_km', label: 'Highway access', icon: 'road', better: 'min', unit: 'km' },
  { key: 'nearest_airport_km', label: 'Airport access', icon: 'plane', better: 'min', unit: 'km' },
  { key: 'schools_within_3km', label: 'Schools within 3 km', icon: 'school', better: 'max' },
  { key: 'parks_within_3km', label: 'Parks within 3 km', icon: 'park', better: 'max' },
  { key: 'healthcare_within_5km', label: 'Healthcare within 5 km', icon: 'health', better: 'max' },
  { key: 'retail_within_2km', label: 'Shops within 2 km', icon: 'shop', better: 'max' },
  { key: '_upcoming_metro_km', label: 'Upcoming metro', icon: 'metro', better: 'min', unit: 'km' },
];
const PERSONAS = [
  { id: 'it', label: 'IT professionals', why: 'tech parks, metro and highway access', keys: ['nearest_tech_park_km', 'tech_parks_within_5km', 'nearest_metro_station_km', 'nearest_highway_km'] },
  { id: 'family', label: 'Families with children', why: 'schools, parks and everyday shops', keys: ['schools_within_3km', 'parks_within_3km', 'retail_within_2km'] },
  { id: 'senior', label: 'Seniors and retirees', why: 'healthcare, shops, parks and the metro', keys: ['healthcare_within_5km', 'retail_within_2km', 'parks_within_3km', 'nearest_metro_station_km'] },
  { id: 'nri', label: 'NRIs and frequent flyers', why: 'airport and highway access', keys: ['nearest_airport_km', 'nearest_highway_km'] },
  { id: 'investor', label: 'Investors', why: 'metro today, upcoming metro and job hubs nearby', keys: ['nearest_metro_station_km', '_upcoming_metro_km', 'tech_parks_within_5km'] },
];

// Factor value for a project (null when not calculated). _upcoming_metro_km is derived from evidence.
export function factorValue(p, key) {
  if (key === '_upcoming_metro_km') return p.evidence?.upcoming_metro_within_5km?.[0]?.distance_km ?? null;
  const m = p.metrics?.[key];
  return m?.status === 'calculated' && m.value != null ? Number(m.value) : null;
}
const COMP_LABEL = { nearest_metro_station_km: 'Metro', nearest_tech_park_km: 'Tech park', schools_within_3km: 'Schools 3 km', healthcare_within_5km: 'Hospitals 5 km' };
const fmtVal = (f, v) => (v == null ? '—' : f.unit === 'km' ? fmtDist(v) : String(v));
const nearestName = (p, key) => (key === '_upcoming_metro_km' ? p.evidence?.upcoming_metro_within_5km?.[0]?.name : p.metrics?.[key]?.nearest_feature);

// Percentile 0–100 where 100 = best of all projects (ties count half). Projects without a value are excluded.
function percentile(values, v, better) {
  if (v == null || !values.length) return null;
  let worse = 0, equal = 0;
  for (const x of values) {
    if (x === v) equal++;
    else if (better === 'min' ? x > v : x < v) worse++;
  }
  return Math.round(((worse + equal / 2) / values.length) * 100);
}
const topLabel = (pct) => (pct >= 50 ? `Top ${Math.max(1, 100 - pct)}%` : `Bottom ${Math.max(1, pct)}%`);

function leadLine(f, p, pct) {
  const v = factorValue(p, f.key), name = nearestName(p, f.key);
  switch (f.key) {
    case 'nearest_metro_station_km': return `Walk to the metro: ${name} is ${fmtDist(v)} away, closer than ${pct}% of Bengaluru projects.`;
    case 'nearest_tech_park_km': return `${fmtDist(v)} to ${name}. Speak directly to people who work there.`;
    case 'tech_parks_within_5km': return `${v} tech and business parks within 5 km: a deep pool of professional buyers and tenants.`;
    case 'nearest_highway_km': return `Direct access to ${name} (${fmtDist(v)}). Lead with commute times on this corridor.`;
    case 'nearest_airport_km': return `${fmtDist(v)} to the airport, nearer than ${pct}% of projects. Relevant for NRIs and frequent flyers.`;
    case 'schools_within_3km': return `${v} schools and colleges within 3 km, more than ${pct}% of projects. A strong family message.`;
    case 'parks_within_3km': return `${v} parks and gardens within 3 km. Green, walkable living.`;
    case 'healthcare_within_5km': return `${v} hospitals and clinics within 5 km. Reassurance for families and seniors.`;
    case 'retail_within_2km': return `${v} supermarkets, malls and convenience stores within 2 km. Everyday needs nearby.`;
    case '_upcoming_metro_km': return `Growth story: ${name} station (${p.evidence.upcoming_metro_within_5km[0].status}) is ${fmtDist(v)} away.`;
    default: return `${f.label}: better than ${pct}% of projects.`;
  }
}

export function Strategy({ project: p, projects, onClose, onShare, onOpenReport }) {
  const data = useMemo(() => {
    const scored = FACTORS.map((f) => {
      const all = projects.map((x) => factorValue(x, f.key)).filter((v) => v != null);
      const v = factorValue(p, f.key);
      return { f, v, pct: percentile(all, v, f.better), n: all.length };
    });
    const byKey = Object.fromEntries(scored.map((s) => [s.f.key, s]));
    // Competitors: other builders' projects within 5 km.
    const comps = projects
      .filter((x) => x.id !== p.id && x.builder !== p.builder)
      .map((x) => ({ x, d: haversineM([p.lon, p.lat], [x.lon, x.lat]) }))
      .filter((c) => c.d <= 5000).sort((a, b) => a.d - b.d);
    const localRank = (key, better) => {
      const vals = [p, ...comps.map((c) => c.x)].map((x) => factorValue(x, key)).filter((v) => v != null);
      const v = factorValue(p, key); if (v == null || vals.length < 2) return null;
      return { rank: 1 + vals.filter((x) => (better === 'min' ? x < v : x > v)).length, of: vals.length };
    };
    scored.forEach((s) => { s.local = localRank(s.f.key, s.f.better); });
    const valid = scored.filter((s) => s.pct != null);
    const strengths = valid.filter((s) => s.pct >= 70).sort((a, b) => b.pct - a.pct).slice(0, 4);
    const weaknesses = valid.filter((s) => s.pct <= 35).sort((a, b) => a.pct - b.pct).slice(0, 3);
    const personas = PERSONAS.map((pe) => {
      const ps = pe.keys.map((k) => byKey[k]?.pct).filter((x) => x != null);
      return { ...pe, score: ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : null };
    }).filter((x) => x.score != null).sort((a, b) => b.score - a.score);
    return { scored, strengths, weaknesses, personas, comps };
  }, [p, projects]);

  const ev = p.evidence || {};
  const top = data.strengths[0];
  const risks = [];
  if (ev.nearest_drain && ev.nearest_drain.distance_m <= 60) risks.push(`A mapped drain runs ${ev.nearest_drain.distance_m} m from the site. Expect buyers’ lawyers to ask about drain buffers; have the approved plan and the drain’s classification ready.`);
  if (ev.nearest_lake && ev.nearest_lake.distance_m <= 400) risks.push(`${ev.nearest_lake.name || 'A lake'} is ${fmtDist(ev.nearest_lake.distance_m / 1000)} away. Sell the view, and be ready on flooding${ev.elevation?.height_above_lake_m != null ? `: the site sits about ${ev.elevation.height_above_lake_m} m above the lake surface` : ''}${ev.nearest_lake.distance_m > 75 ? ', outside every lake buffer that has applied in Bengaluru' : ''}.`);
  const compCols = ['nearest_metro_station_km', 'nearest_tech_park_km', 'schools_within_3km', 'healthcare_within_5km'].map((k) => FACTORS.find((f) => f.key === k));
  const rows = [{ x: p, d: 0, self: true }, ...data.comps.slice(0, 8)];
  const bestIn = Object.fromEntries(compCols.map((f) => {
    const vals = rows.map((r) => factorValue(r.x, f.key)).filter((v) => v != null);
    return [f.key, vals.length ? (f.better === 'min' ? Math.min(...vals) : Math.max(...vals)) : null];
  }));

  return (
    <div className="report strategy" data-theme="light" role="dialog" aria-label={`Market strategy: ${p.name}`}>
      <div className="report-bar">
        <button type="button" className="btn-ghost" onClick={onClose}><Icon name="close" size={15} />Close</button>
        <div className="report-bar-actions">
          <button type="button" className="btn-ghost" onClick={onOpenReport}><Icon name="info" size={15} />Location report</button>
          <button type="button" className="btn-ghost" onClick={onShare}><Icon name="share" size={15} />Copy link</button>
          <button type="button" className="btn" onClick={() => window.print()}><Icon name="download" size={15} />Save as PDF</button>
        </div>
      </div>
      <article className="report-page">
        <div className="r-brand" aria-hidden="true">
          <span className="r-mark">G</span><span className="r-brand-name">GeoIntel</span>
          <span className="r-brand-sub">Location intelligence · Bengaluru</span>
          <span className="r-brand-date">{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
        <header className="r-head">
          <div className="eyebrow">MARKET STRATEGY BRIEF</div>
          <h1>{p.name}</h1>
          <p className="r-addr">{p.builder} · compared with {projects.length} developer projects across Bengaluru and {data.comps.length} competing projects within 5 km</p>
        </header>

        {top && <p className="s-lede">Position {p.name} on <strong>{top.f.label.toLowerCase()}</strong>: {leadLine(top.f, p, top.pct)}</p>}

        <section>
          <h2>Lead with</h2>
          <div className="s-cards">
            {data.strengths.length ? data.strengths.map((s) => (
              <div className="s-card good" key={s.f.key}>
                <div className="s-card-top"><span className="row-icon"><Icon name={s.f.icon} /></span><span className="s-badge">{topLabel(s.pct)}</span>{s.local && <span className="s-local">#{s.local.rank} of {s.local.of} nearby</span>}</div>
                <div className="s-card-title">{s.f.label}</div>
                <p>{leadLine(s.f, p, s.pct)}</p>
              </div>)) : <p className="r-note">No factor ranks in the top 30% city-wide.</p>}
          </div>
        </section>

        <section>
          <h2>Prepare for</h2>
          <ul className="s-list">
            {data.weaknesses.map((s) => (
              <li key={s.f.key}><strong>{s.f.label}</strong> is in the {topLabel(s.pct).toLowerCase()} of projects ({fmtVal(s.f, s.v)}{nearestName(p, s.f.key) ? `, ${nearestName(p, s.f.key)}` : ''}).{top && top.f.key !== s.f.key ? ` Offset it with ${top.f.label.toLowerCase()}.` : ''}</li>))}
            {risks.map((r, i) => <li key={`r${i}`}>{r}</li>)}
            {!data.weaknesses.length && !risks.length && <li>No factor ranks in the bottom third, and no lake or drain flags.</li>}
          </ul>
        </section>

        <section>
          <h2>Who this location suits</h2>
          <div className="s-personas">
            {data.personas.map((pe) => (
              <div className="s-persona" key={pe.id}>
                <div className="s-persona-head"><span>{pe.label}</span><span className="s-score">{pe.score}</span></div>
                <div className="s-bar"><div style={{ width: `${pe.score}%` }} /></div>
                <div className="r-sub">Based on {pe.why}</div>
              </div>))}
          </div>
          <p className="r-note">Score = average percentile of the relevant factors across all developer projects (100 = best in Bengaluru).</p>
        </section>

        <section>
          <h2>Scorecard</h2>
          <table className="r-table s-table s-scoretbl"><colgroup><col style={{ width: '30%' }} /><col style={{ width: '36%' }} /><col style={{ width: '17%' }} /><col style={{ width: '17%' }} /></colgroup><thead><tr><th>Factor</th><th>Value</th><th>City-wide</th><th>Within 5 km</th></tr></thead><tbody>
            {data.scored.filter((s) => s.v != null).map((s) => (
              <tr key={s.f.key}><td>{s.f.label}</td><td><span className="r-val">{fmtVal(s.f, s.v)}</span>{nearestName(p, s.f.key) && <span className="r-sub">{nearestName(p, s.f.key)}</span>}</td>
                <td><span className={`s-pill ${s.pct >= 70 ? 'good' : s.pct <= 35 ? 'weak' : ''}`}>{topLabel(s.pct)}</span></td>
                <td>{s.local ? `#${s.local.rank} of ${s.local.of}` : '—'}</td></tr>))}
          </tbody></table>
        </section>

        {data.comps.length > 0 && (
          <section className="s-compsec">
            <h2>Competitive set</h2>
            <div className="s-wrap"><table className="r-table s-table s-comp"><colgroup><col style={{ width: '31%' }} /><col style={{ width: '10%' }} />{compCols.map((f) => <col key={f.key} style={{ width: '14.75%' }} />)}</colgroup><thead><tr><th>Project</th><th>Away</th>{compCols.map((f) => <th key={f.key}>{COMP_LABEL[f.key]}</th>)}</tr></thead><tbody>
              {rows.map((r) => (
                <tr key={r.x.id} className={r.self ? 'is-self' : ''}>
                  <td><span className="r-val">{r.x.name}</span><span className="r-sub">{r.x.builder}{r.x.status ? ` · ${r.x.status.replace(' (per OpenStreetMap)', '')}` : ''}</span></td>
                  <td>{r.self ? '—' : fmtDist(r.d / 1000)}</td>
                  {compCols.map((f) => { const v = factorValue(r.x, f.key); return <td key={f.key} className={v != null && v === bestIn[f.key] ? 's-best' : ''}>{fmtVal(f, v)}</td>; })}
                </tr>))}
            </tbody></table></div>
            <p className="r-note">Nearest {Math.min(8, data.comps.length)} of {data.comps.length} projects by other developers within 5 km. Best value in each column highlighted.</p>
          </section>)}

        <footer className="r-foot">
          <p><strong>Method.</strong> Percentiles compare this site with {projects.length} named developer projects mapped in OpenStreetMap across Bengaluru. Straight-line distances; counts are mapped features. Upcoming metro means stations under construction or proposed.</p>
          <p>Prepared by GeoIntel · blr.geointel.workers.dev · Not affiliated with {p.builder}.</p>
        </footer>
      </article>
    </div>
  );
}
