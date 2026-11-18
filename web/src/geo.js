// Client-side spatial metrics for arbitrary points. Mirrors the Python pipeline's
// definitions (src/geointel/pipeline.py) so custom points and pilot locations are
// comparable. Distances: haversine for points; for lines/polygons a local
// equirectangular projection around the query point (error well under 0.5% at
// city scale). A point inside a polygon is at distance 0.

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function haversineM([lon1, lat1], [lon2, lat2]) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function projector([lon0, lat0]) {
  const kx = rad(1) * R * Math.cos(rad(lat0)), ky = rad(1) * R;
  return ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky];
}

function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function lineDist(coords, proj) {
  let best = Infinity, prev = proj(coords[0]);
  if (coords.length === 1) return Math.hypot(prev[0], prev[1]);
  for (let i = 1; i < coords.length; i++) {
    const cur = proj(coords[i]);
    best = Math.min(best, segDist([0, 0], prev, cur));
    prev = cur;
  }
  return best;
}

function inRing(ring, proj) {
  // Ray cast from origin (query point) in projected space.
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = proj(ring[i]), [xj, yj] = proj(ring[j]);
    if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonDist(rings, proj) {
  if (inRing(rings[0], proj) && !rings.slice(1).some((h) => inRing(h, proj))) return 0;
  return Math.min(...rings.map((r) => lineDist(r, proj)));
}

/** Minimum distance in metres from point p ([lon, lat]) to a GeoJSON geometry. */
export function distanceToGeometry(geom, p) {
  if (!geom) return Infinity;
  const proj = projector(p);
  switch (geom.type) {
    case 'Point': return haversineM(p, geom.coordinates);
    case 'MultiPoint': return Math.min(...geom.coordinates.map((c) => haversineM(p, c)));
    case 'LineString': return lineDist(geom.coordinates, proj);
    case 'MultiLineString': return Math.min(...geom.coordinates.map((l) => lineDist(l, proj)));
    case 'Polygon': return polygonDist(geom.coordinates, proj);
    case 'MultiPolygon': return Math.min(...geom.coordinates.map((r) => polygonDist(r, proj)));
    case 'GeometryCollection': return Math.min(...geom.geometries.map((g) => distanceToGeometry(g, p)));
    default: return Infinity;
  }
}

/** Area-weighted centroid (shoelace) for polygons, vertex mean otherwise; matches shapely closely. */
export function roughCentroid(geom) {
  if (!geom) return null;
  if (geom.type === 'Point') return geom;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : null;
  if (polys) {
    const [lon0, lat0] = polys[0][0][0], proj = projector([lon0, lat0]);
    let A = 0, cx = 0, cy = 0;
    for (const rings of polys) for (const [ri, ring] of rings.entries()) {
      const sign = ri === 0 ? 1 : -1; // holes subtract
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = proj(ring[i]), [xj, yj] = proj(ring[j]);
        const c = (xj * yi - xi * yj) * sign;
        A += c; cx += (xj + xi) * c; cy += (yj + yi) * c;
      }
    }
    if (Math.abs(A) > 1e-9) {
      const x = cx / (3 * A), y = cy / (3 * A);
      return { type: 'Point', coordinates: [lon0 + x / (rad(1) * R * Math.cos(rad(lat0))), lat0 + y / (rad(1) * R)] };
    }
  }
  const pts = [];
  const walk = (c) => (typeof c[0] === 'number' ? pts.push(c) : c.forEach(walk));
  walk(geom.coordinates);
  const n = pts.length;
  return { type: 'Point', coordinates: [pts.reduce((s, c) => s + c[0], 0) / n, pts.reduce((s, c) => s + c[1], 0) / n] };
}

const label = (f) => {
  const pr = f?.properties || {};
  for (const k of ['name', 'ref', 'iata']) if (typeof pr[k] === 'string' && pr[k].trim()) return pr[k].trim();
  return null;
};

export function nearest(fc, p, { centroid = false, filter } = {}) {
  let best = Infinity, bestF = null;
  for (const f of fc?.features || []) {
    if (filter && !filter(f)) continue;
    const g = centroid ? roughCentroid(f.geometry) : f.geometry;
    const d = distanceToGeometry(g, p);
    if (d < best) { best = d; bestF = f; }
  }
  return Number.isFinite(best) ? { km: Math.round(best) / 1000, name: label(bestF) } : null;
}

export function countWithin(fc, p, radiusM) {
  let n = 0;
  for (const f of fc?.features || []) if (distanceToGeometry(f.geometry, p) <= radiusM) n++;
  return n;
}

const OSM = { source: 'OpenStreetMap contributors', license: 'ODbL-1.0' };

/**
 * Compute the indicators for an arbitrary point from city-wide published layers.
 * Returns the same shape as the pipeline's demo_location_metrics.json entries.
 * Road density and building coverage need city-wide roads/buildings, which are
 * only published around the pilot locations, so they are marked unavailable.
 */
export function computeMetrics(p, data) {
  const m = {};
  const counts = {
    schools: [['schools_within_1km', 1000], ['schools_within_3km', 3000]],
    healthcare: [['healthcare_within_1km', 1000], ['healthcare_within_5km', 5000]],
    parks: [['parks_within_1km', 1000], ['parks_within_3km', 3000]],
    retail: [['retail_within_2km', 2000]],
  };
  for (const [layer, defs] of Object.entries(counts)) {
    for (const [key, r] of defs) {
      m[key] = data[layer]
        ? { ...OSM, value: countWithin(data[layer], p, r), unit: 'mapped_features', radius_m: r, status: 'calculated',
            method: 'Count mapped feature geometries with minimum distance to the point within radius (computed in browser).' }
        : { status: 'loading' };
    }
  }
  const near = (key, layer, method, opts) => {
    if (!data[layer]) { m[key] = { status: 'loading' }; return; }
    const r = nearest(data[layer], p, opts);
    m[key] = r ? { ...OSM, value: r.km, unit: 'km', nearest_feature: r.name, status: 'calculated', method }
               : { status: 'no_layer_data' };
  };
  near('nearest_mapped_water_km', 'water', 'Minimum distance to mapped water feature geometry (computed in browser).');
  near('nearest_airport_km', 'airports', 'Distance to the centroid of the nearest mapped aerodrome with an IATA code.',
       { centroid: true, filter: (f) => typeof f.properties?.iata === 'string' && f.properties.iata.length === 3 });
  near('nearest_metro_station_km', 'metro_stations', 'Distance to the nearest mapped operational metro station.');
  near('nearest_rail_station_km', 'rail_stations', 'Distance to the nearest mapped railway station or halt, excluding metro.');
  near('nearest_highway_km', 'highways', 'Distance to the nearest mapped motorway or trunk road.');
  for (const key of ['road_density_within_1km', 'building_footprint_coverage_within_1km'])
    m[key] = { status: 'pilot_only', method: 'City-wide road and building layers are not published yet; available for the five pilot locations only.' };
  return m;
}
