# Cloudflare Worker static-assets deployment

The project is a React + Vite **static site**. Source JSX cannot be served directly.
A successful deployment must build it and serve `index.html` plus `assets/*.js` from `dist`.

## Existing Cloudflare Worker project (GitHub deployment)
Repository: `VijayNair74/geointel-bengaluru`

Cloudflare's Git deployment source directory can be configured either way:

| Git build root | Build command | Static assets directory | Wrangler config |
| --- | --- | --- | --- |
| Repo root (`/`) | `npm run build` | `web/dist` | `wrangler.jsonc` |
| `web` | `npm run build` | `dist` | `web/wrangler.jsonc` |

For the repo-root variant, `package.json` installs and builds the nested web app.
For the `web` variant, Cloudflare runs Vite from inside `web` and uses its local configuration.
Do **not** deploy the repo's `web/index.html` or `web/src/main.jsx` as direct static files.
Those are developer sources and won't work in a web browser without bundling.

## Check
After deployment, open the production URL and inspect the browser's Network tab.
The initial HTML response should point to a hashed `/assets/index-*.js` and
`/assets/index-*.css`; if it instead points to `/src/main.jsx`,
Cloudflare is serving sources, not the built app. Inspect the deployment build logs.
The dashboard intentionally shows `No data` until locally processed OSM data is exported.
