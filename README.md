# GeoIntel Bengaluru

Open-data geospatial intelligence MVP for Bengaluru.

## Status

Early prototype. The React/Vite dashboard displays five reference locations and reports **No data** until the local OpenStreetMap ingestion pipeline has exported verified inputs. This is not a parcel, zoning, flood, or title verification product.

## Cloudflare Worker deployment

This repository is currently connected to a **Cloudflare Worker with static assets**, not a legacy Pages project.

- Root directory: `/`
- Wrangler static assets directory: `./web/dist`
- Current Cloudflare deploy command: `npx wrangler deploy`
- Production frontend assets are built and checked by `.github/workflows/validate.yml` and committed to `web/dist` automatically.
- For a regular dashboard build, set the Cloudflare build command to `npm run build`. The checked-in compiled assets also permit the existing no-build-command deployment workflow.
- Production site: https://geointel-bengaluru.vijaynath-nair.workers.dev/

A GitHub Action must pass the frontend compilation check before declaring a frontend build validated. A successful Cloudflare deploy alone is **not** proof that the app renders; verify the public page, its JS/CSS assets, and actual visible dashboard.

## Data

OpenStreetMap attribution: © OpenStreetMap contributors (ODbL). Avoid assuming that incomplete OSM data means a feature does not exist. Do not scrape proprietary/official GIS datasets without permission.
