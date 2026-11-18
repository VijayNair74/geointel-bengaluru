from pathlib import Path

def test_frontend_source_present():
    root = Path(__file__).resolve().parents[1]
    assert (root / 'web/src/main.jsx').exists()
    assert (root / 'web/package.json').exists()

def test_export_does_not_fabricate_data():
    import sys
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root / 'scripts'))
    from export_web_data import export_data
    copied = export_data()
    assert isinstance(copied, list)
    assert all((root / 'data/processed' / n).exists() for n in copied)
