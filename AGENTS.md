# AGENTS.md

Repo map. Read the row before you touch that area.

| Path | What it holds | Read it when |
|---|---|---|
| `README.md` | Purpose, the differences from the reference app, the data counts and licences, the frozen decisions, the language | Before changing anything |
| `docs/adr/0001-data-and-licences.md` | The four sources, the licence split, the counts, the English coverage and its gap, the attribution strings, the exclusions, the CEFR rule | Before choosing a source, a field, an example or an attribution |
| `docs/adr/0002-hash-routes-relative-urls-on-deploy.md` | Why hash routes, relative URLs and a frozen subpath | Before changing routing or deploy paths |
| `docs/adr/0003-sharded-lazy-content-and-offline.md` | Bucket plan and caps, the four file sets and the decks, the cache table, the download action, the eviction rules | Before changing `sw.js`, `data/` or the manifest |
| `docs/adr/0004-search-index-and-ranking.md` | Folding, the row format, entry ids, the form index, conjugation tables, the ranking order and its cost | Before changing search or the index build |
| `docs/adr/0005-example-sentences-and-translations.md` | The sentence page and its route, the human Tatoeba English of every example, link-first selection, the ex row shape, the English cap, why machine translation was rejected, and the B1 and B2 checklist | Before changing examples, `data/ex/` or the sentence route, and before proposing machine translation |
| `docs/design/architecture.md` | The four layers, boot order, the data client contract, which screen fetches what, the Translation rows, the cost of one tap, the English search option, storage, the worker table, deploy, what each gate can prove | Before touching `app.js`, `router.js`, `data.js`, `ui.js` or `sw.js` |
| `docs/verification/gate-2.md` | The browser and device acceptance record: the checks the offline gate runs, the checks a device still owns, the result table | Before claiming the deployed app works |

`docs/design/architecture.md` ends with the list of gaps between the code and the ADRs. Read that
list before you trust an ADR over the code.

## Delivered

A feature is not delivered until it is on `main` and served by GitHub Pages. Work on a branch, in a
worktree or in a local clone is not delivered, even when every gate passes.

Pages serves the root of `main`. There is no workflow file, so a push to `main` is the deploy. The
site is `https://maxalcala.com/itadict/`, and `https://maxarturo.github.io/itadict/` redirects to it.
An installed app keeps the old shell until `sw.js` updates, so a fix reaches users after the deploy.

1. Run every gate on the commit you mean to ship.
2. Merge or fast-forward it into `main`, then `git push origin main`.
3. Wait for the build:
   `gh api repos/maxArturo/itadict/pages/builds/latest --jq '.status + " " + .commit'` reads
   `built` and your sha.
4. Check the served copy. `https://maxalcala.com/itadict/data/index.json` carries a `version`, and
   `npm run verify:offline` prints the build it tested. They match.

Call a feature delivered after step 4, not before. Say which step failed when one fails.

## Development gates

| Command | What it does |
|---|---|
| `npm install` | Installs the two devDependencies: `typescript` and `playwright`. No runtime dependency. |
| `npm run build:data` | `node tools/build-data.mjs`. Build of `data/` from the cached sources. Writes the manifest, the four file sets per bucket, the CEFR decks, `NOTICE` and `data/LICENSE-DATA.md`. |
| `npm run check` | `node tools/check-data.mjs`. The structural gate over `data/`: manifest, byte counts, hashes, size caps, ids, form targets, example positions, licence lines, and the English coverage line. |
| `npm test` | `node tools/sanity.mjs`. Node checks over `js/`: fold, ranking, reader, router, storage, lists, study, speech, reference, the manifest and the fetch memo. No browser. |
| `npm run typecheck` | `npx tsc --noEmit`. |
| `npm run verify:offline` | `node tools/verify-offline.mjs`. Headless Chromium at iPhone size, over the app served on its real `/itadict/` subpath: the shell, search, a cold deep link, the download action, the offline relaunch, the request log. |
| `cd /home/max/Developer && python3 -m http.server 8000` | The local server for a manual look. Serve the parent, so the app loads under `/itadict/` as it deploys. |
| `node tools/icons.mjs` | Redraws the four icons in `icons/`. Dev-only, like the rest. |

Nothing ships from `tools/`. There is no bundler, no framework and no runtime dependency. Node runs
in `tools/` only.

## Shell

- Every URL is relative, so the shell works from the `/itadict/` subpath and from a root dev server
  unchanged. `manifest.webmanifest` uses `start_url: "./"` and `scope: "./"`, and lists a 180, a 192,
  a 512 and a maskable 512 icon.
- `index.html` loads one module, `js/app.js`. Boot registers `./sw.js` first, reads the stored blob,
  then starts the router.
- `sw.js` is one hand-written classic worker. It precaches the shell and every module under `js/`,
  caches a data file forever under its hashed URL, keeps the manifest on stale-while-revalidate, and
  falls back to `index.html` for a navigation. A cache miss falls through to the network and answers
  504, never an error.
- `localStorage` holds one key, `itadict`, shaped `{ v: 3, data: { history, opened, schedule, notes,
  lists, folders, settings } }`, with one `migrate(v, data)` chain. Never a key per version.

## Modules

`js/data.js` names every path and field. `js/search.js`, `js/text.js`, `js/study.js`, `js/lists.js`,
`js/reference.js`, `js/speech.js` and `js/offline.js` are pure or take their environment as a
parameter, and carry their own Node checks. `js/ui.js` draws the screens and fetches nothing.
`js/app.js` is boot and the composition of the screens. `js/router.js` parses eight hash routes.

A new pure module must be added to `sw.js`'s shell list in the same change, or it is dead offline.
`npm run verify:offline` fails on a module that is missing from that list.

Status: shipped. Shell, router, data client, search, storage, the Text reader, Study with its
schedule, speech, every screen, the data build and its gate, the shell precache, and the offline gate.
The Entry screen draws an English translation above the Italian definitions, and 76.5% of entries
have one, or 94.6% of the 5,000 most frequent. The English lookup index ships in the data, and the
search field reads it.
