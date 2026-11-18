from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd
import yaml
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parents[2]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_config() -> dict[str, Any]:
    with (ROOT / "config" / "settings.yaml").open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_projects() -> list[dict[str, Any]]:
    """Hand-curated projects (config/projects.yaml), which carry facts from the builder's listing."""
    path = ROOT / "config" / "projects.yaml"
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return (yaml.safe_load(f) or {}).get("projects", [])


def _slug(text: str) -> str:
    return "-".join("".join(c.lower() if c.isalnum() else " " for c in text).split())


def discover_projects(processed_dir: Path) -> list[dict[str, Any]]:
    """Projects auto-discovered from the developer_projects OSM layer."""
    layer = _read_layer(processed_dir, "developer_projects")
    out = []
    import re
    brands = {px.lower() for d in load_config().get("developers", []) for px in d["prefixes"]}
    uc = re.compile(r"\s*\((?:u/c|under construction)\)\s*", re.I)
    for _, r in layer.iterrows():
        raw = str(r["name"])
        name = uc.sub(" ", raw).strip()
        if name.lower() in brands:
            continue  # e.g. "Sobha (u/c)": an unnamed site, not a project
        g = r.geometry
        pt = g.representative_point() if g.geom_type != "Point" else g
        addr = ", ".join(str(r.get(k)) for k in ("addr:street", "addr:suburb", "addr:city", "addr:postcode")
                         if isinstance(r.get(k), str) and r.get(k).strip())
        osm_type, osm_id = r.get("osm_type"), r.get("osm_id")
        out.append({"id": _slug(name), "name": name, "builder": r.get("builder"), "address": addr or None,
                    "lat": round(pt.y, 6), "lon": round(pt.x, 6),
                    "status": "Under construction (per OpenStreetMap)" if (r.get("landuse") == "construction" or uc.search(raw)) else None, "facts": None,
                    "source_url": f"https://www.openstreetmap.org/{osm_type}/{int(osm_id)}" if osm_type and osm_id == osm_id else None,
                    "source": "osm", "search_terms": [str(r.get("builder") or "")]})
    return out


def ensure_dirs(cfg: dict[str, Any]) -> tuple[Path, Path]:
    raw_dir = ROOT / cfg["outputs"]["raw_dir"] / "osm"
    processed_dir = ROOT / cfg["outputs"]["processed_dir"]
    raw_dir.mkdir(parents=True, exist_ok=True)
    processed_dir.mkdir(parents=True, exist_ok=True)
    return raw_dir, processed_dir


def validate_config(cfg: dict[str, Any]) -> None:
    aoi = cfg["aoi"]
    if not (-180 <= aoi["west"] < aoi["east"] <= 180):
        raise ValueError("Invalid longitude bounds")
    if not (-90 <= aoi["south"] < aoi["north"] <= 90):
        raise ValueError("Invalid latitude bounds")
    if cfg["project"]["metric_crs"] != "EPSG:32643":
        raise ValueError("Review metric CRS: Bengaluru uses UTM zone 43N (EPSG:32643)")
    if not cfg.get("osm_layers"):
        raise ValueError("At least one OSM layer must be configured")


def _safe_layer_name(name: str) -> str:
    return "".join(c.lower() if c.isalnum() else "_" for c in name).strip("_")


def _empty_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:4326")


def _write_geojson(gdf: gpd.GeoDataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if gdf.empty:
        path.write_text('{"type":"FeatureCollection","features":[]}', encoding="utf-8")
    else:
        # 6 decimals ~= 0.1 m; keeps the published files small enough for static hosting.
        gdf.to_file(path, driver="GeoJSON", layer_options={"COORDINATE_PRECISION": 6})


# Tag columns worth keeping per feature; everything else OSM returns is dropped so
# the published GeoJSON stays compact.
_KEEP_COLUMNS = ("osm_type", "osm_id", "name", "ref", "amenity", "leisure", "shop",
                 "highway", "natural", "water", "landuse", "building",
                 "railway", "station", "public_transport", "aeroway", "iata", "waterway",
                 "construction", "proposed", "residential", "addr:street", "addr:suburb", "addr:city", "addr:postcode")


def _apply_exclude(gdf: gpd.GeoDataFrame, exclude: dict[str, list[str]] | None,
                   require: dict[str, list[str]] | None = None,
                   exclude_name_pattern: str | None = None) -> gpd.GeoDataFrame:
    """Filter features after fetch.

    exclude: drop rows whose tag value is listed (e.g. metro stations from rail).
    require: keep only rows whose tag value is listed (e.g. operational railway=station).
    exclude_name_pattern: drop rows whose name matches (e.g. "(Proposed)", "(u/c)").
    """
    for key, values in (exclude or {}).items():
        if key in gdf.columns:
            gdf = gdf.loc[~gdf[key].isin(values)]
    for key, values in (require or {}).items():
        gdf = gdf.loc[gdf[key].isin(values)] if key in gdf.columns else gdf.iloc[0:0]
    if exclude_name_pattern and "name" in gdf.columns:
        gdf = gdf.loc[~gdf["name"].fillna("").str.contains(exclude_name_pattern, regex=True)]
    return gdf.reset_index(drop=True)


_NOT_OPERATIONAL = r"(?i)\b(?:proposed|u/c|under construction)\b"


def _upcoming_only(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Keep stations that are NOT operational and label them proposed / under construction."""
    if gdf.empty:
        return gdf
    name = gdf["name"].fillna("") if "name" in gdf.columns else pd.Series([""] * len(gdf), index=gdf.index)
    railway = gdf["railway"].fillna("") if "railway" in gdf.columns else pd.Series([""] * len(gdf), index=gdf.index)
    flagged = name.str.contains(_NOT_OPERATIONAL, regex=True)
    keep = flagged | (railway != "station")
    out = gdf.loc[keep].copy()
    n, r = name.loc[keep], railway.loc[keep]
    out["status"] = [
        "proposed" if (rw == "proposed" or "proposed" in nm.lower()) else "under construction"
        for nm, rw in zip(n, r)
    ]
    out["name"] = n.str.replace(r"\s*\((?:proposed|u/c|under construction)\)\s*", "", regex=True, case=False).str.strip()
    return out.reset_index(drop=True)


def _match_developers(gdf: gpd.GeoDataFrame, developers: list[dict[str, Any]]) -> gpd.GeoDataFrame:
    """Keep named complexes whose name starts with a developer brand; one row per complex."""
    import re
    if gdf.empty or "name" not in gdf.columns:
        return _empty_gdf()
    rows = []
    for _, r in gdf.loc[gdf["name"].notna()].iterrows():
        name = str(r["name"]).strip()
        for d in developers:
            if any(re.match(rf"(?i){re.escape(px)}\b", name) for px in d["prefixes"]):
                rows.append({**r.to_dict(), "builder": d["builder"]})
                break
    if not rows:
        return _empty_gdf()
    out = gpd.GeoDataFrame(rows, geometry="geometry", crs=gdf.crs)
    # Same complex is often mapped as a landuse area plus several buildings: keep the largest.
    area = out.geometry.to_crs("EPSG:32643").area
    out = out.assign(_a=area.values, _k=out["name"].str.lower().str.replace(r"[^a-z0-9]+", " ", regex=True).str.strip())
    out = out.sort_values("_a", ascending=False).drop_duplicates("_k").drop(columns=["_a", "_k"])
    return out.reset_index(drop=True)


def _normalize_osm(gdf: gpd.GeoDataFrame, layer: str) -> gpd.GeoDataFrame:
    if gdf.empty:
        return _empty_gdf()
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    else:
        gdf = gdf.to_crs("EPSG:4326")
    gdf = gdf.reset_index()
    gdf = gdf.loc[~gdf.geometry.isna()].copy()
    # OSMnx 2.x indexes features by (element, id); 1.x used (element_type, osmid).
    # Both columns are required: de-duplicating on the element type alone would
    # collapse every layer to at most three rows (node/way/relation).
    for type_col, id_col in (("element", "id"), ("element_type", "osmid")):
        if type_col in gdf.columns and id_col in gdf.columns:
            gdf = gdf.rename(columns={type_col: "osm_type", id_col: "osm_id"})
            break
    if {"osm_type", "osm_id"}.issubset(gdf.columns):
        gdf = gdf.drop_duplicates(subset=["osm_type", "osm_id"])
    keep = [c for c in _KEEP_COLUMNS if c in gdf.columns]
    gdf = gpd.GeoDataFrame(gdf[keep + ["geometry"]].copy(), geometry="geometry", crs="EPSG:4326")
    for col in keep:
        if col != "osm_id":
            gdf[col] = gdf[col].astype("string")
    gdf["layer"] = layer
    return gdf.reset_index(drop=True)


def _simplify(gdf: gpd.GeoDataFrame, tolerance_m: float = 2.0) -> gpd.GeoDataFrame:
    """Simplify line/polygon geometry by ~2 m (in metres, UTM 43N) to shrink published files."""
    if gdf.empty:
        return gdf
    mask = ~gdf.geom_type.isin(["Point", "MultiPoint"])
    if mask.any():
        gdf = gdf.copy()
        simplified = gdf.loc[mask].geometry.to_crs("EPSG:32643").simplify(tolerance_m, preserve_topology=True)
        gdf.loc[mask, "geometry"] = simplified.to_crs("EPSG:4326")
    return gdf


def _fetch_layer_around_points(ox, tags: dict[str, Any], points: list[tuple[float, float]],
                               dist_m: float, pause_s: float, endpoints: list[str]) -> gpd.GeoDataFrame:
    """Fetch one layer within dist_m of each (lat, lon) point and concatenate.

    If an Overpass endpoint errors (e.g. 403 to cloud runners, 429/504 when busy),
    the same request is retried on the next endpoint; the working endpoint is kept
    for later requests.
    """
    import pandas as pd
    from osmnx._errors import InsufficientResponseError

    frames = []
    for i, (lat, lon) in enumerate(points):
        last_exc: Exception | None = None
        for _ in range(len(endpoints)):
            try:
                frames.append(ox.features_from_point((lat, lon), tags=tags, dist=dist_m))
                last_exc = None
                break
            except InsufficientResponseError:
                last_exc = None
                break  # no matching features mapped around this point
            except Exception as exc:  # noqa: BLE001 - rotate endpoint and retry
                last_exc = exc
                endpoints.append(endpoints.pop(0))
                ox.settings.overpass_url = endpoints[0]
                print(f"[retry] {type(exc).__name__}: {exc} -> switching to {endpoints[0]}")
                time.sleep(pause_s)
        if last_exc is not None:
            raise last_exc
        if i < len(points) - 1:
            time.sleep(pause_s)
    frames = [f for f in frames if not f.empty]
    if not frames:
        return _empty_gdf()
    return gpd.GeoDataFrame(pd.concat(frames), geometry="geometry", crs=frames[0].crs)


def _osmium_filters(tags: dict[str, Any]) -> list[str]:
    """Translate OSMnx-style tags into osmium tags-filter expressions."""
    exprs = []
    for key, value in tags.items():
        if value is True:
            exprs.append(f"nwr/{key}")
        elif isinstance(value, (list, tuple)):
            exprs.append(f"nwr/{key}={','.join(map(str, value))}")
        else:
            exprs.append(f"nwr/{key}={value}")
    return exprs


def _run_osmium(*args: str) -> None:
    import subprocess
    subprocess.run(["osmium", *args], check=True)


def _features_from_osm_xml(ox, path: Path, tags: dict[str, Any], bbox_lbrt) -> gpd.GeoDataFrame:
    from shapely.geometry import box
    from osmnx._errors import InsufficientResponseError
    try:
        return ox.features_from_xml(path, polygon=box(*bbox_lbrt), tags=tags)
    except InsufficientResponseError:
        return _empty_gdf()


def _pbf_layer_fetcher(ox, pbf: Path, work: Path, aoi: dict[str, float]):
    """Return fetch(layer, tags, points, dist) that reads a local OSM PBF extract.

    Public Overpass servers refuse or time out from cloud CI runners, so CI uses a
    Geofabrik extract: clip it to the AOI once, filter tags per layer, then clip
    small XML files around each demo location for OSMnx to parse.
    """
    import pandas as pd
    work.mkdir(parents=True, exist_ok=True)
    aoi_pbf = work / "aoi.osm.pbf"
    _run_osmium("extract", "-b", f"{aoi['west']},{aoi['south']},{aoi['east']},{aoi['north']}",
                "--strategy", "smart", "--overwrite", "-o", str(aoi_pbf), str(pbf))

    def fetch(layer: str, tags: dict[str, Any], points, dist_m: float, scope: str = "points") -> gpd.GeoDataFrame:
        layer_pbf = work / f"{layer}.osm.pbf"
        _run_osmium("tags-filter", "--overwrite", "-o", str(layer_pbf), str(aoi_pbf), *_osmium_filters(tags))
        if scope == "aoi":
            boxes = [(aoi["west"], aoi["south"], aoi["east"], aoi["north"])]
        else:
            boxes = [ox.utils_geo.bbox_from_point((lat, lon), dist=dist_m) for lat, lon in points]
        frames = []
        for i, (left, bottom, right, top) in enumerate(boxes):
            xml = work / f"{layer}_{i}.osm"
            _run_osmium("extract", "-b", f"{left},{bottom},{right},{top}", "--strategy", "smart",
                        "--overwrite", "-f", "osm", "-o", str(xml), str(layer_pbf))
            frames.append(_features_from_osm_xml(ox, xml, tags, (left, bottom, right, top)))
        frames = [f for f in frames if not f.empty]
        if not frames:
            return _empty_gdf()
        return gpd.GeoDataFrame(pd.concat(frames), geometry="geometry", crs=frames[0].crs)

    return fetch


def fetch_osm_layers(refresh: bool = False, pbf_path: str | Path | None = None) -> dict[str, int]:
    # Lazy import keeps config validation and metric tests usable before GIS
    # dependencies are installed, and gives a clear message on first fetch.
    try:
        import osmnx as ox
    except ImportError as exc:
        raise RuntimeError(
            "OSMnx is not installed. Create the geointel Conda environment first: "
            "conda env create -f environment.yml"
        ) from exc

    cfg = load_config()
    validate_config(cfg)
    raw_dir, processed_dir = ensure_dirs(cfg)
    acq = cfg["acquisition"]
    pause_s = float(acq["pause_between_requests_seconds"])
    points = [(lat, lon) for _, lat, lon in cfg["demo_locations"]] + [(p["lat"], p["lon"]) for p in load_projects()]
    ox.settings.use_cache = True
    ox.settings.log_console = True
    ox.settings.requests_timeout = int(acq["request_timeout_seconds"])
    endpoints = [os.getenv("OVERPASS_URL", acq["overpass_url"]), *acq.get("overpass_fallback_urls", [])]
    ox.settings.overpass_url = endpoints[0]
    # The pre-request /status probe is specific to overpass-api.de and fails on
    # mirrors; we already pause between requests ourselves.
    ox.settings.overpass_rate_limit = False
    ox.settings.http_user_agent = acq["user_agent"]
    pbf_fetch = None
    if pbf_path:
        pbf_fetch = _pbf_layer_fetcher(ox, Path(pbf_path), ROOT / cfg["outputs"]["raw_dir"] / "pbf_work", cfg["aoi"])

    manifest_path = processed_dir / "source_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {
        "project": "GeoIntel Bengaluru", "manifest_version": "1.0", "layers": {}
    }
    counts: dict[str, int] = {}

    for index, (layer_name, definition) in enumerate(cfg["osm_layers"].items()):
        layer = _safe_layer_name(layer_name)
        raw_path = raw_dir / f"{layer}.geojson"
        output_path = processed_dir / f"{layer}.geojson"
        if output_path.exists() and not refresh:
            existing = gpd.read_file(output_path)
            counts[layer] = len(existing)
            print(f"[cache] {layer}: {len(existing)} features")
            continue

        dist_m = float(definition.get("fetch_radius_m", 3000))
        where = "whole AOI" if definition.get("fetch_scope") == "aoi" else f"{dist_m:.0f} m of {len(points)} locations"
        print(f"[fetch] {layer} — {definition['tags']} within {where}")
        try:
            scope = definition.get("fetch_scope", "points")
            if pbf_fetch:
                fetched = pbf_fetch(layer, definition["tags"], points, dist_m, scope)
            elif scope == "aoi":
                aoi = cfg["aoi"]
                fetched = ox.features_from_bbox(bbox=(aoi["west"], aoi["south"], aoi["east"], aoi["north"]),
                                                tags=definition["tags"])
            else:
                fetched = _fetch_layer_around_points(ox, definition["tags"], points, dist_m, pause_s, endpoints)
            gdf = _apply_exclude(_normalize_osm(fetched, layer), definition.get("exclude"),
                                 definition.get("require"), definition.get("exclude_name_pattern"))
            if definition.get("developer_match"):
                gdf = _match_developers(gdf, cfg.get("developers", []))
            if definition.get("upcoming_only"):
                gdf = _upcoming_only(gdf)
            gdf = _simplify(gdf)
        except Exception as exc:
            raise RuntimeError(
                f"Failed to fetch OSM layer '{layer}'. Public Overpass services are shared "
                "and may be busy. Retry later; do not run repeated rapid refreshes."
            ) from exc

        _write_geojson(gdf, raw_path)
        _write_geojson(gdf, output_path)
        counts[layer] = len(gdf)
        print(f"[done] {layer}: {len(gdf)} features")
        manifest["layers"][layer] = {
            "source": "OpenStreetMap contributors",
            "source_url": "https://www.openstreetmap.org/",
            "query_tags": definition["tags"],
            "fetch_strategy": "per_demo_location" + (" (local PBF extract)" if pbf_fetch else " (Overpass)"),
            "fetch_scope": definition.get("fetch_scope", "points"),
            "fetch_radius_m": dist_m if definition.get("fetch_scope", "points") == "points" else None,
            "demo_locations": [name for name, _, _ in cfg["demo_locations"]],
            "retrieved_at_utc": utc_now(),
            "license": "ODbL 1.0",
            "attribution": "© OpenStreetMap contributors",
            "feature_count": len(gdf),
            "output": str(output_path.relative_to(ROOT)),
            "limitations": "Community-mapped and incomplete; not an authoritative property, title, zoning or safety record."
        }
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        if pbf_fetch:
            manifest["layers"][layer]["source_extract"] = Path(pbf_path).name
        elif index < len(cfg["osm_layers"]) - 1:
            time.sleep(pause_s)

    return counts


def _read_layer(processed_dir: Path, name: str) -> gpd.GeoDataFrame:
    path = processed_dir / f"{name}.geojson"
    if not path.exists():
        return _empty_gdf()
    return gpd.read_file(path)


def _count_within(gdf: gpd.GeoDataFrame, point: Point, radius_m: float) -> int:
    if gdf.empty:
        return 0
    return int(gdf.geometry.distance(point).le(radius_m).sum())


def _nearest_distance_km(gdf: gpd.GeoDataFrame, point: Point) -> float | None:
    if gdf.empty:
        return None
    distances = gdf.geometry.distance(point)
    if distances.empty:
        return None
    return round(float(distances.min()) / 1000, 3)


def _feature_label(row) -> str | None:
    for col in ("name", "ref", "iata"):
        val = row.get(col) if hasattr(row, "get") else None
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def _nearest_feature(gdf: gpd.GeoDataFrame, point: Point, use_centroid: bool = False) -> tuple[float | None, str | None]:
    """Distance (km) to the nearest feature plus its OSM name/ref, for metric drill-down."""
    if gdf.empty:
        return None, None
    geoms = gdf.geometry.centroid if use_centroid else gdf.geometry
    distances = geoms.distance(point)
    if distances.dropna().empty:
        return None, None
    idx = distances.idxmin()
    return round(float(distances[idx]) / 1000, 3), _feature_label(gdf.loc[idx])


def _road_density_km_per_sqkm(gdf: gpd.GeoDataFrame, point: Point, radius_m: int = 1000) -> float | None:
    if gdf.empty:
        return None
    area = point.buffer(radius_m)
    clipped = gdf.geometry.intersection(area)
    total_length_km = float(clipped.length.sum()) / 1000
    area_sqkm = float(area.area) / 1_000_000
    return round(total_length_km / area_sqkm, 3) if area_sqkm else None


def _building_coverage_pct(gdf: gpd.GeoDataFrame, point: Point, radius_m: int = 1000) -> float | None:
    if gdf.empty:
        return None
    area = point.buffer(radius_m)
    clipped = gdf.geometry.intersection(area)
    # Unary union prevents overlapping/duplicate footprints being summed twice.
    footprint_area = float(clipped.union_all().area)
    return round(min(100.0, footprint_area / float(area.area) * 100), 2) if area.area else None


def _point_metrics(point: Point, layers: dict[str, gpd.GeoDataFrame], metric_crs: str) -> dict[str, Any]:
    """All indicators for one point (in metric_crs). Shared by pilot locations and projects."""
    m: dict[str, Any] = {}
    definitions = {
        "schools": [("schools_within_1km", 1000), ("schools_within_3km", 3000)],
        "healthcare": [("healthcare_within_1km", 1000), ("healthcare_within_5km", 5000)],
        "parks": [("parks_within_1km", 1000), ("parks_within_3km", 3000)],
        "retail": [("retail_within_2km", 2000)],
    }
    for layer_name, metrics in definitions.items():
        layer = layers.get(layer_name, _empty_gdf()).to_crs(metric_crs)
        for key, radius in metrics:
            m[key] = {
                "value": _count_within(layer, point, radius), "unit": "mapped_features",
                "radius_m": radius, "source": "OpenStreetMap contributors", "license": "ODbL-1.0",
                "method": "Count mapped feature geometries with minimum distance to reference point within radius.",
                "status": "calculated" if not layer.empty else "no_layer_data"
            }

    water = layers.get("water", _empty_gdf()).to_crs(metric_crs)
    nearest_water, water_label = _nearest_feature(water, point)
    m["nearest_mapped_water_km"] = {
        "value": nearest_water, "unit": "km", "nearest_feature": water_label, "source": "OpenStreetMap contributors",
        "license": "ODbL-1.0", "method": "Minimum planar distance to mapped water feature geometry.",
        "status": "calculated" if nearest_water is not None else "no_layer_data"
    }

    roads = layers.get("roads", _empty_gdf()).to_crs(metric_crs)
    road_density = _road_density_km_per_sqkm(roads, point)
    m["road_density_within_1km"] = {
        "value": road_density, "unit": "km_of_mapped_roads_per_sq_km", "radius_m": 1000,
        "source": "OpenStreetMap contributors", "license": "ODbL-1.0",
        "method": "Sum of mapped road-line lengths clipped to a 1 km radius circle, divided by circle area.",
        "status": "calculated" if road_density is not None else "no_layer_data"
    }

    buildings = layers.get("buildings", _empty_gdf()).to_crs(metric_crs)
    coverage = _building_coverage_pct(buildings, point)
    m["building_footprint_coverage_within_1km"] = {
        "value": coverage, "unit": "percent", "radius_m": 1000,
        "source": "OpenStreetMap contributors", "license": "ODbL-1.0",
        "method": "Union area of mapped building footprints clipped to a 1 km radius circle divided by circle area.",
        "status": "calculated" if coverage is not None else "no_layer_data"
    }

    connectivity = [
        ("nearest_airport_km", "airports", True,
         "Planar distance to the centroid of the nearest mapped aerodrome with an IATA code (scheduled-service airport)."),
        ("nearest_metro_station_km", "metro_stations", False,
         "Planar distance to the nearest mapped operational metro station (OSM station=subway)."),
        ("nearest_rail_station_km", "rail_stations", False,
         "Planar distance to the nearest mapped railway station or halt, excluding metro."),
        ("nearest_highway_km", "highways", False,
         "Planar distance to the nearest mapped motorway or trunk road (typically national/state highways)."),
    ]
    for key, layer_name, centroid, method in connectivity:
        layer = layers.get(layer_name, _empty_gdf()).to_crs(metric_crs)
        if layer_name == "airports" and "iata" in layer.columns:
            layer = layer.loc[layer["iata"].notna() & (layer["iata"].astype(str).str.len() == 3)]
        dist_km, label = _nearest_feature(layer, point, use_centroid=centroid)
        m[key] = {
            "value": dist_km, "unit": "km", "nearest_feature": label,
            "source": "OpenStreetMap contributors", "license": "ODbL-1.0", "method": method,
            "status": "calculated" if dist_km is not None else "no_layer_data"
        }
    return m


def _load_layers(cfg: dict[str, Any], processed_dir: Path, metric_crs: str) -> dict[str, gpd.GeoDataFrame]:
    layers: dict[str, gpd.GeoDataFrame] = {}
    for name in cfg["osm_layers"].keys():
        layer = _read_layer(processed_dir, name)
        if not layer.empty:
            layers[name] = layer.to_crs(metric_crs)
    return layers


def build_metrics() -> Path:
    cfg = load_config()
    _, processed_dir = ensure_dirs(cfg)
    metric_crs = cfg["project"]["metric_crs"]
    demo_points = cfg.get("demo_locations", [])
    if not demo_points:
        raise ValueError("No demo_locations configured")

    points = gpd.GeoDataFrame(
        [{"location": n, "latitude": lat, "longitude": lon} for n, lat, lon in demo_points],
        geometry=[Point(lon, lat) for n, lat, lon in demo_points], crs="EPSG:4326"
    ).to_crs(metric_crs)

    layers = _load_layers(cfg, processed_dir, metric_crs)

    results = []
    for _, point_row in points.iterrows():
        point = point_row.geometry
        item: dict[str, Any] = {
            "location": point_row["location"],
            "latitude": point_row["latitude"],
            "longitude": point_row["longitude"],
            "metrics": {},
            "method_version": "0.3.0",
            "data_status": "computed_from_available_layers",
            "caveat": "These are indicative counts and distances to OpenStreetMap-mapped features around reference points, not parcel-level assessments. Missing mapped features do not imply real-world absence."
        }
        item["metrics"] = _point_metrics(point, layers, metric_crs)
        results.append(item)

    output = processed_dir / "demo_location_metrics.json"
    output.write_text(json.dumps({
        "project": "GeoIntel Bengaluru", "generated_at_utc": utc_now(),
        "metric_crs": metric_crs, "source_manifest": "source_manifest.json",
        "aoi_bbox_wsen": [cfg["aoi"]["west"], cfg["aoi"]["south"], cfg["aoi"]["east"], cfg["aoi"]["north"]],
        "citywide_layers": [k for k, d in cfg["osm_layers"].items() if d.get("fetch_scope") == "aoi"],
        "locations": results
    }, indent=2), encoding="utf-8")
    return output


def _dem_files() -> list[Path]:
    d = Path(os.getenv("DEM_DIR", ROOT / "data" / "raw" / "dem"))
    return sorted(d.glob("*.tif")) if d.exists() else []


def _dem_median(geom_wgs84, pct: float = 50) -> float | None:
    """Percentile of Copernicus GLO-30 surface elevation (m) over a WGS84 geometry, or None.

    GLO-30 is a surface model (rooftops, trees), so callers use low percentiles to
    approximate the ground near a site and the water surface of a lake."""
    files = _dem_files()
    if not files:
        return None
    try:
        import numpy as np
        import rasterio
        from rasterio.mask import mask as rio_mask
    except ImportError:
        return None
    vals = []
    for f in files:
        with rasterio.open(f) as src:
            b = src.bounds
            minx, miny, maxx, maxy = geom_wgs84.bounds
            if maxx < b.left or minx > b.right or maxy < b.bottom or miny > b.top:
                continue
            arr, _ = rio_mask(src, [geom_wgs84.__geo_interface__], crop=True, all_touched=True, filled=False)
            vals.extend(v for v in arr.compressed().tolist() if v > -100)
    return round(float(np.percentile(vals, pct)), 1) if vals else None


def _project_evidence(point: Point, layers: dict[str, gpd.GeoDataFrame], metric_crs: str) -> dict[str, Any]:
    """Lakes, drains, upcoming metro and elevation around a project (point in metric_crs)."""
    ev: dict[str, Any] = {}
    water = layers.get("water", _empty_gdf())
    lakes = []
    if not water.empty:
        polys = water.loc[water.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
        polys["d"] = polys.geometry.distance(point)
        for _, r in polys.loc[polys["d"] <= 2000].sort_values("d").iterrows():
            lakes.append({"name": _feature_label(r), "distance_m": int(round(r["d"])),
                          "area_acres": round(float(r.geometry.area) / 4046.86, 1), "_geom": r.geometry})
    named = [l for l in lakes if l["name"]]
    ev["lakes_within_2km"] = [{k: v for k, v in l.items() if k != "_geom"} for l in named[:10]]
    ev["water_bodies_within_2km"] = len(lakes)
    nearest = lakes[0] if lakes else None
    ev["nearest_lake"] = {k: v for k, v in nearest.items() if k != "_geom"} if nearest else None

    drains = layers.get("drains", _empty_gdf())
    if not drains.empty:
        d = drains.geometry.distance(point)
        idx = d.idxmin()
        ev["nearest_drain"] = {"name": _feature_label(drains.loc[idx]), "type": drains.loc[idx].get("waterway"),
                               "distance_m": int(round(float(d[idx])))}
        ev["drains_within_500m"] = int((d <= 500).sum())
    else:
        ev["nearest_drain"], ev["drains_within_500m"] = None, 0

    up = layers.get("metro_upcoming", _empty_gdf())
    ev["upcoming_metro_within_5km"] = []
    if not up.empty:
        d = up.geometry.distance(point)
        for idx in d[d <= 5000].sort_values().index[:8]:
            ev["upcoming_metro_within_5km"].append({"name": _feature_label(up.loc[idx]), "status": up.loc[idx].get("status"),
                                                    "distance_km": round(float(d[idx]) / 1000, 2)})

    site = gpd.GeoSeries([point.buffer(60)], crs=metric_crs).to_crs("EPSG:4326").iloc[0]
    site_m = _dem_median(site, pct=20)   # ground between buildings, not rooftops
    lake_m = None
    # Only lakes >= 5 acres: small landscaped ponds are dominated by surrounding rooftops in a 30 m model.
    if nearest is not None and nearest["area_acres"] >= 5:
        lake_geom = gpd.GeoSeries([nearest["_geom"].buffer(-15) or nearest["_geom"]], crs=metric_crs).to_crs("EPSG:4326").iloc[0]
        lake_m = _dem_median(lake_geom if not lake_geom.is_empty else gpd.GeoSeries([nearest["_geom"]], crs=metric_crs).to_crs("EPSG:4326").iloc[0], pct=10)
    ev["elevation"] = {
        "site_m": site_m, "nearest_lake_surface_m": lake_m,
        "height_above_lake_m": round(site_m - lake_m, 1) if site_m is not None and lake_m is not None else None,
        "source": "Copernicus DEM GLO-30 (surface model incl. buildings and trees; approximate)",
        "status": "calculated" if site_m is not None else "no_dem_data",
    }
    return ev


def build_project_reports() -> Path:
    cfg = load_config()
    _, processed_dir = ensure_dirs(cfg)
    metric_crs = cfg["project"]["metric_crs"]
    layers = _load_layers(cfg, processed_dir, metric_crs)
    manifest_path = processed_dir / "source_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"layers": {}}
    retrieved = sorted({v.get("retrieved_at_utc", "")[:10] for v in manifest.get("layers", {}).values()} - {""})
    curated = load_projects()
    seen = {_slug(p["name"]) for p in curated}
    projects = [{**p, "source": "curated"} for p in curated]
    for p in discover_projects(processed_dir):
        if p["id"] not in seen:
            seen.add(p["id"])
            projects.append(p)
    out = []
    for p in projects:
        pt = gpd.GeoSeries([Point(p["lon"], p["lat"])], crs="EPSG:4326").to_crs(metric_crs).iloc[0]
        metrics = _point_metrics(pt, layers, metric_crs)
        if p.get("source") != "curated":
            # Roads/buildings are only fetched around pilots and curated projects.
            for k in ("road_density_within_1km", "building_footprint_coverage_within_1km"):
                metrics[k] = {"value": None, "status": "not_computed",
                              "method": "Road and building layers are fetched only around pilot areas and curated projects."}
        out.append({**{k: p.get(k) for k in ("id", "name", "builder", "address", "lat", "lon", "status", "facts", "source_url", "search_terms", "source")},
                    "metrics": metrics,
                    "evidence": _project_evidence(pt, layers, metric_crs)})
    path = processed_dir / "project_reports.json"
    path.write_text(json.dumps({"generated_at_utc": utc_now(), "osm_retrieved": retrieved[-1] if retrieved else None,
                                "projects": out}, indent=2, default=str), encoding="utf-8")
    return path


def quality_report() -> Path:
    _, processed_dir = ensure_dirs(load_config())
    rows = []
    for path in sorted(processed_dir.glob("*.geojson")):
        gdf = gpd.read_file(path)
        rows.append({
            "layer": path.stem, "feature_count": len(gdf), "crs": str(gdf.crs),
            "null_geometry_count": int(gdf.geometry.isna().sum()) if "geometry" in gdf else 0,
            "invalid_geometry_count": int((~gdf.geometry.is_valid).sum()) if len(gdf) else 0,
            "geometry_types": sorted(gdf.geom_type.dropna().unique().tolist()) if len(gdf) else [],
        })
    output = processed_dir / "quality_report.json"
    output.write_text(json.dumps({"generated_at_utc": utc_now(), "layers": rows}, indent=2), encoding="utf-8")
    return output


def source_report() -> Path:
    cfg = load_config()
    _, processed_dir = ensure_dirs(cfg)
    manifest_path = processed_dir / "source_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"layers": {}}
    expected = list(cfg["osm_layers"].keys())
    report = {
        "project": "GeoIntel Bengaluru", "generated_at_utc": utc_now(),
        "expected_layers": expected,
        "available_layers": sorted(manifest.get("layers", {}).keys()),
        "missing_layers": sorted(set(expected) - set(manifest.get("layers", {}).keys())),
        "source_manifest": "source_manifest.json"
    }
    path = processed_dir / "data_status.json"
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return path
