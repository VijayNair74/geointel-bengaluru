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
