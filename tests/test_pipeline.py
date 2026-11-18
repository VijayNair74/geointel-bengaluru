import geopandas as gpd
from shapely.geometry import LineString, Point, box
from geointel.pipeline import (
    _building_coverage_pct, _count_within, _nearest_distance_km,
    _road_density_km_per_sqkm, load_config, validate_config,
)
def test_config_is_valid():
    validate_config(load_config())
def test_demo_area_and_locations_are_configured():
    cfg = load_config()
    assert cfg["aoi"]["west"] < cfg["aoi"]["east"]
    assert len(cfg["demo_locations"]) == 5
    assert {"schools", "healthcare", "water", "roads", "buildings"}.issubset(cfg["osm_layers"])
def test_count_within_radius():
    gdf = gpd.GeoDataFrame(geometry=[Point(0, 0), Point(1500, 0)], crs="EPSG:32643")
    assert _count_within(gdf, Point(0, 0), 1000) == 1
def test_nearest_distance_km():
    gdf = gpd.GeoDataFrame(geometry=[Point(1500, 0)], crs="EPSG:32643")
    assert _nearest_distance_km(gdf, Point(0, 0)) == 1.5
def test_road_density_is_positive():
    gdf = gpd.GeoDataFrame(geometry=[LineString([(-2000, 0), (2000, 0)])], crs="EPSG:32643")
    value = _road_density_km_per_sqkm(gdf, Point(0, 0))
    assert value is not None and value > 0
def test_building_coverage_is_bounded():
    gdf = gpd.GeoDataFrame(geometry=[box(-100, -100, 100, 100)], crs="EPSG:32643")
    value = _building_coverage_pct(gdf, Point(0, 0))
    assert value is not None and 0 < value <= 100
def test_normalize_osm_dedups_on_type_and_id():
    import pandas as pd
    from geointel.pipeline import _normalize_osm
    idx = pd.MultiIndex.from_tuples([("node", 1), ("node", 2), ("node", 1), ("way", 1)], names=["element", "id"])
    gdf = gpd.GeoDataFrame({"name": ["a", "b", "a", "c"], "amenity": ["school"] * 4, "junk": [1, 2, 3, 4]},
                           geometry=[Point(77.6, 12.9)] * 4, index=idx, crs="EPSG:4326")
    out = _normalize_osm(gdf, "schools")
    assert len(out) == 3
    assert "junk" not in out.columns
    assert {"osm_type", "osm_id", "name", "layer"}.issubset(out.columns)
