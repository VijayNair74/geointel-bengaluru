from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
import yaml
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parents[2]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_config() -> dict[str, Any]:
    with (ROOT / "config" / "settings.yaml").open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


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
        gdf.to_file(path, driver="GeoJSON")


def _normalize_osm(gdf: gpd.GeoDataFrame, layer: str) -> gpd.GeoDataFrame:
    if gdf.empty:
        return _empty_gdf()
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    else:
        gdf = gdf.to_crs("EPSG:4326")
    gdf = gdf.reset_index()
    gdf = gdf.loc[~gdf.geometry.isna()].copy()
    # OSMnx represents OSM elements with a stable element/osmid index. Avoid
    # double-counting duplicate representations returned by the query.
    id_cols = [c for c in ("element", "osmid") if c in gdf.columns]
    if id_cols:
        gdf = gdf.drop_duplicates(subset=id_cols)
    gdf["source"] = "OpenStreetMap contributors"
    gdf["source_license"] = "ODbL-1.0"
    gdf["acquired_at_utc"] = utc_now()
    gdf["layer"] = layer
    return gdf


def fetch_osm_layers(refresh: bool = False) -> dict[str, int]:
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
    aoi = cfg["aoi"]
    bbox = (aoi["west"], aoi["south"], aoi["east"], aoi["north"])
    ox.settings.use_cache = True
    ox.settings.log_console = True
    ox.settings.requests_timeout = int(cfg["acquisition"]["request_timeout_seconds"])
    ox.settings.overpass_url = os.getenv("OVERPASS_URL", cfg["acquisition"]["overpass_url"])
    ox.settings.http_user_agent = cfg["acquisition"]["user_agent"]

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

        print(f"[fetch] {layer} — {definition['tags']}")
        try:
            fetched = ox.features_from_bbox(bbox=bbox, tags=definition["tags"])
            gdf = _normalize_osm(fetched, layer)
        except Exception as exc:
            raise RuntimeError(
                f"Failed to fetch OSM layer '{layer}'. Public Overpass services are shared "
                "and may be busy. Retry later; do not run repeated rapid refreshes."
            ) from exc

        _write_geojson(gdf, raw_path)
        _write_geojson(gdf, output_path)
        counts[layer] = len(gdf)
        manifest["layers"][layer] = {
            "source": "OpenStreetMap contributors",
            "source_url": "https://www.openstreetmap.org/",
            "query_tags": definition["tags"],
            "aoi_bbox_wsen": [aoi["west"], aoi["south"], aoi["east"], aoi["north"]],
            "retrieved_at_utc": utc_now(),
            "license": "ODbL 1.0",
            "attribution": "© OpenStreetMap contributors",
            "feature_count": len(gdf),
            "output": str(output_path.relative_to(ROOT)),
            "limitations": "Community-mapped and incomplete; not an authoritative property, title, zoning or safety record."
        }
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        if index < len(cfg["osm_layers"]) - 1:
            time.sleep(float(cfg["acquisition"]["pause_between_requests_seconds"]))

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

    layer_names = list(cfg["osm_layers"].keys())
    layers: dict[str, gpd.GeoDataFrame] = {}
    for name in layer_names:
        layer = _read_layer(processed_dir, name)
        if not layer.empty:
            layers[name] = layer.to_crs(metric_crs)

    results = []
    for _, point_row in points.iterrows():
        point = point_row.geometry
        item: dict[str, Any] = {
            "location": point_row["location"],
            "latitude": point_row["latitude"],
            "longitude": point_row["longitude"],
            "metrics": {},
            "method_version": "0.2.0",
            "data_status": "computed_from_available_layers",
            "caveat": "These are indicative counts and distances to OpenStreetMap-mapped features around reference points, not parcel-level assessments. Missing mapped features do not imply real-world absence."
        }
        definitions = {
            "schools": [("schools_within_1km", 1000), ("schools_within_3km", 3000)],
            "healthcare": [("healthcare_within_1km", 1000), ("healthcare_within_5km", 5000)],
            "parks": [("parks_within_1km", 1000), ("parks_within_3km", 3000)],
            "retail": [("retail_within_2km", 2000)],
        }
        for layer_name, metrics in definitions.items():
            layer = layers.get(layer_name, _empty_gdf()).to_crs(metric_crs)
            for key, radius in metrics:
                item["metrics"][key] = {
                    "value": _count_within(layer, point, radius), "unit": "mapped_features",
                    "radius_m": radius, "source": "OpenStreetMap contributors", "license": "ODbL-1.0",
                    "method": "Count mapped feature geometries with minimum distance to reference point within radius.",
                    "status": "calculated" if not layer.empty else "no_layer_data"
                }

        water = layers.get("water", _empty_gdf()).to_crs(metric_crs)
        nearest_water = _nearest_distance_km(water, point)
        item["metrics"]["nearest_mapped_water_km"] = {
            "value": nearest_water, "unit": "km", "source": "OpenStreetMap contributors",
            "license": "ODbL-1.0", "method": "Minimum planar distance to mapped water feature geometry.",
            "status": "calculated" if nearest_water is not None else "no_layer_data"
        }

        roads = layers.get("roads", _empty_gdf()).to_crs(metric_crs)
        road_density = _road_density_km_per_sqkm(roads, point)
        item["metrics"]["road_density_within_1km"] = {
            "value": road_density, "unit": "km_of_mapped_roads_per_sq_km", "radius_m": 1000,
            "source": "OpenStreetMap contributors", "license": "ODbL-1.0",
            "method": "Sum of mapped road-line lengths clipped to a 1 km radius circle, divided by circle area.",
            "status": "calculated" if road_density is not None else "no_layer_data"
        }

        buildings = layers.get("buildings", _empty_gdf()).to_crs(metric_crs)
        coverage = _building_coverage_pct(buildings, point)
        item["metrics"]["building_footprint_coverage_within_1km"] = {
            "value": coverage, "unit": "percent", "radius_m": 1000,
            "source": "OpenStreetMap contributors", "license": "ODbL-1.0",
            "method": "Union area of mapped building footprints clipped to a 1 km radius circle divided by circle area.",
            "status": "calculated" if coverage is not None else "no_layer_data"
        }
        results.append(item)

    output = processed_dir / "demo_location_metrics.json"
    output.write_text(json.dumps({
        "project": "GeoIntel Bengaluru", "generated_at_utc": utc_now(),
        "metric_crs": metric_crs, "source_manifest": "source_manifest.json",
        "locations": results
    }, indent=2), encoding="utf-8")
    return output


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
