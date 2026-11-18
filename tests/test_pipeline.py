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
def test_osmium_filters():
    from geointel.pipeline import _osmium_filters
    assert _osmium_filters({"building": True}) == ["nwr/building"]
    assert _osmium_filters({"amenity": ["school", "college"], "natural": "water"}) == [
        "nwr/amenity=school,college", "nwr/natural=water"]
def test_features_from_osm_xml(tmp_path):
    import osmnx as ox
    from geointel.pipeline import _features_from_osm_xml, _normalize_osm
    xml = tmp_path / "t.osm"
    xml.write_text('<?xml version="1.0"?><osm version="0.6">'
        '<node id="1" lat="12.97" lon="77.75"><tag k="amenity" v="school"/><tag k="name" v="X"/></node>'
        '<node id="2" lat="12.97" lon="77.75"><tag k="amenity" v="bench"/></node></osm>')
    gdf = _normalize_osm(_features_from_osm_xml(ox, xml, {"amenity": ["school"]}, (77.7, 12.9, 77.8, 13.0)), "schools")
    assert len(gdf) == 1 and gdf.iloc[0]["name"] == "X"
def test_apply_exclude_drops_metro_from_rail():
    from geointel.pipeline import _apply_exclude
    gdf = gpd.GeoDataFrame({"station": ["subway", None, "train"]}, geometry=[Point(0, 0)] * 3, crs="EPSG:32643")
    assert len(_apply_exclude(gdf, {"station": ["subway"]})) == 2
def test_nearest_feature_returns_label():
    from geointel.pipeline import _nearest_feature
    gdf = gpd.GeoDataFrame({"name": ["Far", None], "ref": [None, "NH 44"]},
                           geometry=[Point(5000, 0), Point(1200, 0)], crs="EPSG:32643")
    assert _nearest_feature(gdf, Point(0, 0)) == (1.2, "NH 44")
    assert _nearest_feature(gpd.GeoDataFrame(geometry=[], crs="EPSG:32643"), Point(0, 0)) == (None, None)
