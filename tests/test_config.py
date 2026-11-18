from geointel.pipeline import load_config, validate_config

def test_default_config_is_valid():
    cfg = load_config()
    validate_config(cfg)
    assert cfg["project"]["city"] == "Bengaluru"
    assert cfg["project"]["metric_crs"] == "EPSG:32643"
