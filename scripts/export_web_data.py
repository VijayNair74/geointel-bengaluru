"""Publish local processed data into the Vite public folder (no synthetic metrics)."""
from __future__ import annotations
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'data' / 'processed'
DEST = ROOT / 'web' / 'public' / 'data'
LAYERS = ['schools','healthcare','parks','water','retail','roads','buildings']
METADATA = ['demo_location_metrics.json','data_status.json','source_manifest.json','quality_report.json']

def export_data() -> list[str]:
    DEST.mkdir(parents=True, exist_ok=True)
    copied = []
    for name in [*(f'{layer}.geojson' for layer in LAYERS), *METADATA]:
        source = SRC / name
        target = DEST / name
        if source.is_file():
            with source.open(encoding='utf-8') as f:
                payload = json.load(f)
            if name.endswith('.geojson') and payload.get('type') != 'FeatureCollection':
                raise ValueError(f'Invalid FeatureCollection: {source}')
            shutil.copyfile(source, target)
            copied.append(name)
        elif target.exists():
            target.unlink()  # prevent stale published data
    (DEST / 'export_status.json').write_text(json.dumps({'copied':copied,'missing':[n for n in [*(f'{x}.geojson' for x in LAYERS),*METADATA] if n not in copied]},indent=2),encoding='utf-8')
    return copied

if __name__ == '__main__':
    names = export_data()
    print(f'Exported {len(names)} files to {DEST}')
    if not names:
        print('No processed data yet. Dashboard will show No data until the pipeline runs.')
