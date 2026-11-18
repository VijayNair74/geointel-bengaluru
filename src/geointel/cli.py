from __future__ import annotations
import argparse
from .pipeline import (
    build_metrics, build_project_reports, fetch_osm_layers, load_config, quality_report,
    source_report, validate_config,
)
def main() -> None:
    parser = argparse.ArgumentParser(prog="geointel", description="GeoIntel Bengaluru data foundation")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate-config")
    fetch = sub.add_parser("fetch-osm")
    fetch.add_argument("--refresh", action="store_true", help="Re-fetch layers instead of using cached processed files")
    fetch.add_argument("--pbf", help="Read from a local OSM .pbf extract (needs osmium-tool) instead of Overpass")
    sub.add_parser("build-metrics")
    sub.add_parser("build-projects")
    sub.add_parser("report")
    sub.add_parser("data-status")
    args = parser.parse_args()
    if args.command == "validate-config":
        validate_config(load_config())
        print("Configuration valid.")
    elif args.command == "fetch-osm":
        print(fetch_osm_layers(refresh=args.refresh, pbf_path=args.pbf))
    elif args.command == "build-metrics":
        print(f"Metrics written to: {build_metrics()}")
    elif args.command == "build-projects":
        print(f"Project reports written to: {build_project_reports()}")
    elif args.command == "report":
        print(f"Quality report written to: {quality_report()}")
    elif args.command == "data-status":
        print(f"Data status written to: {source_report()}")
if __name__ == "__main__":
    main()
