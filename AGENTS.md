# AGENTS.md

Repo map. Read the row before you touch that area.

| Path | What it holds | Read it when |
|---|---|---|
| `README.md` | Purpose, the two substitutions from the reference app, the frozen decisions, the language | Before changing anything |
| `docs/adr/0001-data-and-licences.md` | The two sources, the licence split, the attribution strings, the exclusions, the CEFR rule | Before choosing a source, a field, an example or an attribution |
| `docs/adr/0002-hash-routes-relative-urls-on-deploy.md` | Why hash routes, relative URLs and a frozen subpath | Before changing routing or deploy paths |
| `docs/adr/0003-sharded-lazy-content-and-offline.md` | Bucket plan and caps, the four file sets, the cache table, the download-all action, the storage and eviction rules | Before changing `sw.js`, `data/` or the manifest |
| `docs/adr/0004-search-index-and-ranking.md` | Folding, the row format, the form index, conjugation tables, the ranking order and its cost | Before changing search or the index build |
| `docs/design/architecture.md` | The four layers, boot order, the data client contract, which screen fetches what, storage, the worker table, deploy, what a test can prove | Before touching `app.js`, `router.js`, `data.js` or `sw.js` |
| `docs/verification/gate-2.md` | The browser and device acceptance record. Plan now, results at milestone 8 | Before claiming the deployed app works |

`docs/design/architecture.md` ends with the list of gaps between the code and the ADRs. Read that
list before you trust an ADR over the code.

## Development gates

| Command | What it does |
|---|---|
| `npm run build:data` | `node tools/build-data.mjs`. Dev-only build of `data/` from the cached sources. Writes the manifest and the four file sets per bucket. |
| `npm run check` | `node tools/check-data.mjs`. The structural gate over `data/`: manifest, byte counts, hashes, size caps, form targets, example ids, licence lines. |
| `npm test` | `node tools/sanity.mjs`. Node checks over `js/`: fold, ranking, router, storage, manifest, the fetch memo. No browser. |
| `npm run typecheck` | `npx tsc --noEmit`. The only devDependency. |
| `cd /home/max/Developer && python3 -m http.server 8000` | The local server. Serve the parent, so the app loads under `/itadict/` as it deploys. |

Nothing ships from `tools/`. There is no bundler, no framework and no runtime dependency. Node runs
in `tools/` only.

## Shell

- Every URL is relative, so the shell works from the `/itadict/` subpath and from a root dev server
  unchanged. The manifest, when it lands, uses a relative `start_url` and `scope`.
- `index.html` loads one module, `js/app.js`. Boot registers `./sw.js` first, reads the stored blob,
  then renders.
- `sw.js` is one hand-written classic worker. Precache the shell, cache content shards forever,
  stale-while-revalidate the manifest, fall back to `index.html` for a navigation.
- `localStorage` holds one key, `itadict`, shaped `{ v, data: {...} }`, with one
  `migrate(v, data)` chain. Never a key per version.

Status: shell, router, data client, search, storage, the Search and Entry screens, the data build and
its gate, and the docs. The four other tabs and Settings are placeholders that name their milestone.
`sw.js`, `manifest.webmanifest` and `.nojekyll` are not on disk yet.
