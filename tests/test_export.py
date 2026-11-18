import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from export_web_data import export_data  # noqa: E402


def test_frontend_source_present():
    assert (ROOT / 'web/src/main.jsx').exists()
    assert (ROOT / 'web/package.json').exists()


def test_export_copies_only_existing_files_and_removes_stale(tmp_path):
    src, dest = tmp_path / 'processed', tmp_path / 'public'
    src.mkdir(); dest.mkdir()
    (src / 'schools.geojson').write_text('{"type":"FeatureCollection","features":[]}')
    (dest / 'parks.geojson').write_text('{"type":"FeatureCollection","features":[]}')  # stale
    copied = export_data(src, dest)
    assert copied == ['schools.geojson']
    assert not (dest / 'parks.geojson').exists()
    status = json.loads((dest / 'export_status.json').read_text())
    assert 'parks.geojson' in status['missing']


def test_export_rejects_invalid_geojson(tmp_path):
    src = tmp_path / 'processed'; src.mkdir()
    (src / 'roads.geojson').write_text('{"type":"Feature"}')
    with pytest.raises(ValueError):
        export_data(src, tmp_path / 'public')
