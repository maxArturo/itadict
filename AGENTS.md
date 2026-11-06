# AGENTS.md

Repo map. Read the row before you touch that area.

| Path | What it holds | Read it when |
|---|---|---|
| `README.md` | Purpose, the two substitutions from the reference app, the frozen decisions, the language | Before changing anything |
| `docs/adr/0001-data-and-licences.md` | Stub. The open questions for the data spike | Before choosing a source, a field or an attribution |
| `docs/adr/0002-hash-routes-relative-urls-on-deploy.md` | Why hash routes, relative URLs and a frozen subpath | Before changing routing or deploy paths |
| `docs/adr/0003-sharded-lazy-content-and-offline.md` | Shard plan and caps, the cache table, the download-all action, the eviction risk | Before changing `sw.js`, `data/` or the manifest |
| `docs/adr/0004-search-index-and-ranking.md` | Folding, the bucket format, the form index, the ranking order and its cost | Before changing search or the index build |

A design note `docs/design/architecture.md` does not exist yet. Build it from the ADRs when the code
lands.

## Development gates

| Command | What it does |
|---|---|
| `python3 -m http.server 8000` | The local server every manual browser and device check uses. |
| `node tools/*.mjs` (planned) | Dev-only build and structural checks for `data/`. Not written yet. |

Nothing ships from `tools/`. There is no bundler, no framework and no runtime dependency. Node runs
in `tools/` only.

## Shell

- Every URL is relative, so the shell works from the `/itadict/` subpath and from a root dev server
  unchanged. `manifest.webmanifest` uses `start_url: "./"`.
- `index.html` loads one module, `js/app.js`. Boot registers `./sw.js` first, reads the stored blob,
  then renders.
- `sw.js` is one hand-written classic worker. Precache the shell, cache content shards forever,
  stale-while-revalidate the manifest, fall back to `index.html` for a navigation.
- `localStorage` holds one key, `itadict`, shaped `{ v, data: {...} }`, with one
  `migrate(v, data)` chain. Never a key per version.

Status: shell and docs only. No data build, no service worker, no screens yet.
