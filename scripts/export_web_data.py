"""Publish local processed data into the Vite public folder (no synthetic metrics)."""
from __future__ import annotations
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'data' / 'processed'
DEST = ROOT / 'web' / 'public' / 'data'
LAYERS = ['schools','healthcare','parks','water','retail','roads','buildings',
          'metro_stations','rail_stations','airports','highways','metro_upcoming','drains']
METADATA = ['demo_location_metrics.json','project_reports.json','data_status.json','source_manifest.json','quality_report.json']
# Cloudflare Workers static assets reject files over 25 MiB; stay well under it.
MAX_ASSET_BYTES = 20 * 1024 * 1024


def export_data(src: Path = SRC, dest: Path = DEST) -> list[str]:
    src, dest = Path(src), Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    names = [*(f'{layer}.geojson' for layer in LAYERS), *METADATA]
    copied = []
    for name in names:
        source = src / name
        target = dest / name
        if source.is_file():
            with source.open(encoding='utf-8') as f:
                payload = json.load(f)
            if name.endswith('.geojson') and payload.get('type') != 'FeatureCollection':
                raise ValueError(f'Invalid FeatureCollection: {source}')
            size = source.stat().st_size
            if size > MAX_ASSET_BYTES:
                raise ValueError(f'{source} is {size/1048576:.1f} MiB; Cloudflare asset limit is 25 MiB. '
                                 'Reduce fetch_radius_m for this layer in config/settings.yaml.')
            shutil.copyfile(source, target)
            copied.append(name)
        elif target.exists():
            target.unlink()  # prevent stale published data
    (dest / 'export_status.json').write_text(json.dumps({'copied':copied,'missing':[n for n in names if n not in copied]},indent=2),encoding='utf-8')
    return copied


if __name__ == '__main__':
    names = export_data()
    print(f'Exported {len(names)} files to {DEST}')
    if not names:
        print('No processed data yet. Dashboard will show No data until the pipeline runs.')
