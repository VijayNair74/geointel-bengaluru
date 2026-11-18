# GeoIntel Bengaluru

Open-data geospatial intelligence MVP for Bengaluru.

## Status

Early prototype. The React/Vite dashboard displays five reference locations and reports **No data** until the local OpenStreetMap ingestion pipeline has exported verified inputs. This is not a parcel, zoning, flood, or title verification product.

## Deployment

Cloudflare Pages: project root `web`, build command `npm run build`, output directory `dist`.

## Data

OpenStreetMap attribution: © OpenStreetMap contributors (ODbL). Avoid assuming that incomplete OSM data means a feature does not exist. Do not scrape proprietary/official GIS datasets without permission.
