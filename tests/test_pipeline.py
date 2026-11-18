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
def test_operational_metro_filter():
    from geointel.pipeline import _apply_exclude, load_config
    d = load_config()["osm_layers"]["metro_stations"]
    gdf = gpd.GeoDataFrame({"railway": ["station", "proposed", "station", None],
                            "name": ["Hebbal", "Nagawara", "Agara Lake (u/c)", "X"]},
                           geometry=[Point(0, 0)] * 4, crs="EPSG:4326")
    out = _apply_exclude(gdf, d.get("exclude"), d.get("require"), d.get("exclude_name_pattern"))
    assert out["name"].tolist() == ["Hebbal"]
def test_simplify_keeps_points_and_shrinks_lines():
    from geointel.pipeline import _simplify
    line = LineString([(77.6, 12.9), (77.60001, 12.9000001), (77.61, 12.9)])
    gdf = gpd.GeoDataFrame(geometry=[Point(77.6, 12.9), line], crs="EPSG:4326")
    out = _simplify(gdf)
    assert out.geometry.iloc[0].equals(Point(77.6, 12.9))
    assert len(out.geometry.iloc[1].coords) == 2
def test_upcoming_only_labels_and_cleans_names():
    from geointel.pipeline import _upcoming_only
    gdf = gpd.GeoDataFrame({"railway": ["station", "proposed", "station", "construction"],
                            "name": ["Kudlu Gate", "Nagawara (Proposed)", "Agara Lake (u/c)", "Tavarekere"]},
                           geometry=[Point(0, 0)] * 4, crs="EPSG:4326")
    out = _upcoming_only(gdf)
    assert out["name"].tolist() == ["Nagawara", "Agara Lake", "Tavarekere"]
    assert out["status"].tolist() == ["proposed", "under construction", "under construction"]

def test_project_evidence_lakes_drains_upcoming_and_dem(tmp_path, monkeypatch):
    import numpy as np, rasterio
    from rasterio.transform import from_origin
    from geointel.pipeline import _project_evidence
    crs = "EPSG:32643"
    site = gpd.GeoSeries([Point(77.64, 12.886)], crs="EPSG:4326").to_crs(crs).iloc[0]
    lake = box(site.x + 200, site.y - 100, site.x + 500, site.y + 100)
    layers = {
        "water": gpd.GeoDataFrame({"name": ["Test Lake"]}, geometry=[lake], crs=crs),
        "drains": gpd.GeoDataFrame({"name": [None], "waterway": ["drain"]}, geometry=[LineString([(site.x - 80, site.y - 500), (site.x - 80, site.y + 500)])], crs=crs),
        "metro_upcoming": gpd.GeoDataFrame({"name": ["Future Stn"], "status": ["under construction"]}, geometry=[Point(site.x, site.y + 1500)], crs=crs),
    }
    # synthetic DEM: 900 m everywhere, 890 m east of the site (the lake side)
    lake_wgs = gpd.GeoSeries([lake], crs=crs).to_crs("EPSG:4326").iloc[0]
    arr = np.full((400, 400), 900, dtype="float32")
    tr = from_origin(77.62, 12.90, 0.0001, 0.0001)
    cols_lake = int((lake_wgs.bounds[0] - 77.62) / 0.0001)
    arr[:, cols_lake:] = 890
    with rasterio.open(tmp_path / "dem.tif", "w", driver="GTiff", height=400, width=400, count=1, dtype="float32", crs="EPSG:4326", transform=tr) as dst:
        dst.write(arr, 1)
    monkeypatch.setenv("DEM_DIR", str(tmp_path))
    ev = _project_evidence(site, layers, crs)
    assert ev["nearest_lake"]["name"] == "Test Lake" and 190 <= ev["nearest_lake"]["distance_m"] <= 210
    assert ev["nearest_drain"]["distance_m"] == 80 and ev["drains_within_500m"] == 1
    assert ev["upcoming_metro_within_5km"][0]["name"] == "Future Stn"
    assert ev["elevation"]["height_above_lake_m"] == 10.0
def test_match_developers_prefix_and_dedupe():
    from geointel.pipeline import _match_developers
    devs = [{"builder": "Navami", "prefixes": ["Navami"]}, {"builder": "Mana Projects", "prefixes": ["Mana"]}]
    gdf = gpd.GeoDataFrame({"name": ["Navami Vruksha", "navami vruksha", "Manasa Layout", "Mana Tranquilla", None, "HSR Layout"]},
                           geometry=[box(77.6, 12.9, 77.602, 12.902), box(77.6, 12.9, 77.6005, 12.9005), box(0, 0, 1, 1),
                                     box(77.7, 12.9, 77.701, 12.901), box(0, 0, 1, 1), box(0, 0, 1, 1)], crs="EPSG:4326")
    out = _match_developers(gdf, devs)
    assert sorted(out["name"]) == ["Mana Tranquilla", "Navami Vruksha"]   # 'Manasa' is not 'Mana'; duplicate kept once
    assert dict(zip(out["name"], out["builder"]))["Navami Vruksha"] == "Navami"
