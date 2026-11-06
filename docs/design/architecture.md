# itadict — Shell, Data and Offline Architecture

Four runtime layers: the shell, the router, the data client, and the screens. `README.md` holds the
purpose, the counts and the frozen decisions. `docs/adr/` holds the decisions that are expensive to
reverse. This file is the mechanics, and it follows the code on disk.

## Layout

```
index.html              one module script, one #app node, every URL relative
styles.css              all CSS: shell, tab bar, rows, entry, study card, safe areas, the 900px split
manifest.webmanifest    name, relative start_url and scope, four icons
sw.js                   one classic worker, two caches
.nojekyll               stops GitHub Pages running the files through Jekyll
NOTICE                  the licence text that ships, written by the build
icons/                  180, 192, 512 and a maskable 512
data/
  index.json            the manifest
  <key>.json            search rows, one file per bucket, or a longer prefix when the bucket split
  entry/<key>.json      entry bodies
  ex/<key>.json         example sentences, in entry order, keyed by position
  forms/<key>.json      folded inflected form to its lemma
  cefr/<band>.json      one CEFR deck, split when a band is fat
  LICENSE-DATA.md       the data licence, written by the build
js/
  app.js                boot and the screen composition
  router.js             eight hash routes, one redirect
  data.js               the data contract, hashed URLs, the fetch memo
  search.js             folding, ranking, the search pipeline
  text.js               the reader: tokenise, resolve, summarise
  study.js              the schedule rule, the due rule, the deck order, the bands
  lists.js              list, folder and backup shapes, plus their validation
  reference.js          the alphabet and the parts-of-speech index
  speech.js             Italian text to speech, one voice, one rate
  offline.js            the explicit download of every data file
  storage.js            envelope, migrate, and every stored collection
  ui.js                 the tab bar and every screen
tools/                  dev only: build, data gate, Node checks, icons, offline gate
```

Nothing under `tools/` ships and nothing under `tools/` is precached.

## The four layers

**1. The shell.** `index.html` holds one `#app` node and one module script. It sets
`viewport-fit=cover` so the CSS can read `env(safe-area-inset-*)`, the Apple web-app meta tags, and
two `theme-color` values. `styles.css` is the only stylesheet: safe areas, the tab bar height, the
44px tap minimum, the study card, and the two-pane layout from 900 px.

**2. The router.** `js/router.js` reads only the fragment, so the deploy subpath never reaches it.
Eight routes: `#/search`, `#/entry/<id>`, `#/sentence/<bucket>/<sentenceId>`, `#/text`,
`#/reference`, `#/lists`, `#/study`, `#/settings`. A sentence route parses to
`{ name: 'sentence', id: '<bucket>:<sentenceId>' }`, the bucket matching `[a-z0-9_]{1,2}` and the id
`\d{1,10}`; see ADR 0005. An empty fragment and `#/` mean Search. Anything else is repaired to `#/search` with
`location.replace()`. The router owns screen lifetime: whatever `render` returns is that screen's
teardown, and it runs before the next render and on `stop()`.

**3. The data client.** `js/data.js` is the only module that names a path or a JSON field. It parses
the manifest, picks the file for a key, appends the file's hash to its URL, and keeps every loaded
file in one memo.

**4. The screens.** `js/ui.js` draws the tab bar, Search, Text, Entry, Sentence, Study and the
placeholder.
`js/app.js` composes them: boot, the two-pane rule, the route renderer, the Study wiring. No screen
fetches. The app hands a screen a function or a promise, which is the seam the Node checks use.

Seven pure modules sit under the screens: `search`, `text`, `study`, `lists`, `reference`,
`speech` and `offline`. They take their environment as a parameter and carry their own checks in
`tools/sanity.mjs`. Growth goes sideways into that set, never up into `app.js`.

## Boot order

1. `app.js` reads the `#app` node. A missing node is a hard error.
2. It registers `./sw.js` with `{ updateViaCache: 'none' }`, fire-and-forget. A missing worker, an
   insecure context or a browser without one degrades to an ordinary online app. Boot never waits.
3. It opens the storage envelope: one key, one read, one `migrate()` walk.
4. It builds the data client, the search pipeline, the text reader, the speech client and the
   screens. None of them fetches anything yet.
5. It builds the tab bar and the Search and Text screens once, and puts `main` above the bar. A
   paste and its result survive a tab change.
6. It starts the router. The current route renders. The Study tab badge reads the stored schedule,
   which is a local read.

The first `data/index.json` fetch happens on the first search of two characters or more, the first
deck choice, or the first paste. A boot fetch would delay the first screen for a file only a feature
needs.

A viewport crossing 900px re-renders the current route in place. It is not a navigation.

## The data client contract

### Manifest

```
{
  version,        the build's id, a string, part of no URL
  built,          the source date, YYYY-MM-DD
  partial,        true when the build ran with a limit
  bucketKey,      the rule, as text, for a human
  persons,        the six person labels the forms use
  sources: [{ url, licence }],
  totals: { entries, forms, examples, bytes },
  cefr: { "<band>": [{ path, bytes, hash, rows }] },
  buckets: { "<key>": { search, entry, ex, forms } }
}
```

Each bucket set entry is `{ path, bytes, hash }`. A broken bucket is skipped and a missing count
reads as `0`. The shell must open on a partial manifest, never fail.

### URLs carry the hash

`shardUrl(shard)` returns `path + '?v=' + hash`. The worker caches a data file forever, so a
rebuilt file must arrive as a new URL. The hash is that URL. A file with no hash is requested bare,
which is the build's signal that it did not compute one.

### Buckets and shards

A bucket key is the fold of the headword, first two letters or digits. Fold is NFD, drop the
combining marks, lowercase, then drop everything outside `a-z0-9`. A one-letter word keeps one
letter.

A bucket over the cap splits into files named by a longer prefix, for example `data/ca/cao.json`.
The client picks the file whose name-prefix is the longest one the key starts with. When no prefix
matches, it reads the whole set. A bucket lookup falls back to the one-letter key.

### Entry ids

An entry id is `<bucket>:<index>`, for example `ca:0`. The id carries its own location, so a cold
deep link costs one entry file and needs no memory of an earlier search. An id is a position in one
build: after a rebuild the same id can name a different word.

### The file sets

| Set | Holds | Shape |
|---|---|---|
| search | what a result row draws and what ranking matches | `[folded, id, headword, pronunciation, pos, gloss, en]`, where `gloss` is Italian and `en` is the first English gloss or `''` |
| entry | one entry body | `{ id, word, ipa?, cefr, pos: [{ pos, senses }], en: [{ pos, glosses }], ex: [index], conj?: [{ key, personal, forms }] }` |
| ex | the example sentences of one bucket and their English | `[[sentenceId, it, en]]` in numeric id order, so `ex` holds positions. `en` is the directly linked Tatoeba English, never empty, at most 160 characters |
| forms | folded inflected form to its lemma | `{ <foldedForm>: { id, lemma, label, form? } }`. One lemma per form: the first claim whose gloss supports it and whose lemma ships; `form` is the raw NFC spelling when it is not the key (`"e"` holds `"form": "è"`) |
| cefr | one deck of browse rows, one per entry | `[id, word, pos, gloss]` |
| en | folded English token to the entries whose glosses contain it | `{ <token>: [id, ...] }`, at most 100 postings per token |

An entry body holds example positions, never example text. That is what keeps the CC BY 2.0 FR
sentences out of the CC BY-SA shards. See ADR 0001.

`en` holds the English glosses of one part of speech, at most three, and `pos.senses` holds the
Italian definitions. The Entry screen draws them in this order: the headword with its IPA, then
TRANSLATION from `en`, then DEFINITIONS from `pos`, then FORMS from `conj`, then EXAMPLES. An entry
with no `en` draws no Translation section: 14,543 of 61,820 entries, or 23.5%.

A search row carries both glosses in separate fields. The row draws the English gloss first and falls
back to the Italian one, so a result line reads the same way for every row without an entry fetch.

The parsers also read named shapes, so a build change from a compact array to a named object does
not break the app.

### Which fetch each screen triggers

| Action | Files fetched |
|---|---|
| boot | none |
| first search of 2+ characters | `data/index.json`, then the row shard of the query's bucket |
| a search with a short result list | the forms shard of that bucket, then the row shard of the lemma's bucket |
| opening an entry | the entry shard of the id's bucket, then the ex shard of that bucket |
| a cold deep link | the same as opening an entry: the manifest, one entry shard, one ex shard |
| an example row to its sentence page | none: the ex shard is in the memo from the entry |
| a cold sentence link | the manifest and the ex shard of the route's bucket. No entry shard |
| a word on the sentence page | at most the row shard of the word's bucket, then its forms shard when the word is not a headword. None when the session already read them |
| Study, first deck pick | `data/index.json`, then the copy of the band's deck |
| Study, one card | the entry shard of the id's bucket, then its ex shard; the band row already carries the sense |
| Text, one paste | one row shard per bucket the text touches, once per bucket |
| an English query | the row shard as for any query, then `data/en/<bucket>.json` when the Italian list is short of 20 rows. None when the session already read it |
| Reference | the manifest, then all six deck bands once for the parts-of-speech table |
| Lists, Settings | none. Both read only the stored blob |

### The cost of one tap

| Measure | Value |
|---|---|
| Entry file, 90th percentile | 74,564 bytes |
| Largest entry file | 243,439 bytes, 47,576 bytes gzipped |
| Entry files | 948, from 22,339,073 bytes |
| Example file, 90th percentile | 31,656 bytes |
| Largest example file | 169,412 bytes, 61,553 bytes gzipped |
| Example files | 292, from 3,314,114 bytes, 33,329 rows |
| Whole data set | 66,703,466 bytes in the manifest, of which 1,943,073 is the English index |

The entry files grew by 3,379,148 bytes in total for the English glosses. The example rows carry their
English since the link-first build of ADR 0005, which kept fewer rows. One tap still costs one entry
file and one example file, and both are cached forever after the first read.

### The English index

The data ships an English index: `data/en/<bucket>.json` maps a folded English token to the ids of
the entries whose glosses contain it, at most 100 postings per token. It is 415 files, 1,943,073
bytes raw and 0.66 MiB gzipped, a 90th percentile of 14,562 bytes, and a largest file of 76,533
bytes. The cap dropped 50,071 postings and no token.

The decided rule is: Italian matches first, an English block second, and the English index fetched
only when the Italian list is short of 20 rows.

`js/search.js` reads it. When the Italian steps leave fewer than 20 rows, it fetches the bucket's
English file by its hashed URL and draws up to 20 entries in an English block after the Italian
rows: the exact token's postings first, then the tokens that start with the query.

### The memo

Every URL is fetched at most once per session. The promise is kept, so a keystroke after the first
costs no request and an entry opened twice costs one. A failed load is dropped from the memo, so a
retry can succeed.

The memo has no bound and no eviction. A long session that walks many buckets keeps every file it
touched. The download action bypasses the memo: it fetches each URL once and the worker caches it.

## Storage

```
localStorage['itadict'] = {
  v: 3,
  data: {
    history: [...],  opened: [...],  schedule: {...},  notes: {...},
    lists: [...],    folders: [...], settings: { theme, textSize, speechRate },
  },
}
```

- `history` holds the last 50 queries, newest first, trimmed and de-duplicated.
- `opened` holds the last 50 entry ids. It is the History deck.
- `schedule` holds one card per entry id: `{ step, ease, due, reps, lapses }`.
- `notes` holds one note per entry id: `{ text, at }`.
- `lists` and `folders` are the learner's own organisation. A list carries `{ id, name, label, folder, items }`.
- `settings` holds `theme`, `textSize` and `speechRate`.
- One key, one envelope, one `migrate(v, data)` walk. The chain has two steps: v1 to v2, and v2 to v3.
- Unknown top-level keys survive every read and every write. Nothing is pruned.
- A blob this build cannot read, or one written by a newer build, is left byte-for-byte alone and
  every write is refused. The app keeps working from memory for the session.
- A failed `setItem` (quota, private mode) flips the session to memory-only and never throws.
- `size()` reports the stored bytes, and `snapshot()` copies the whole body, which is what a backup
  file carries.

## Service worker

`sw.js` is one hand-written classic worker. It handles same-origin GETs under its own subpath, and
nothing else.

| Request | Strategy | Why |
|---|---|---|
| install | precache the shell list and `data/index.json` | an offline boot needs the shell and the file list |
| navigations | the cached `./index.html`, network fallback, 504 | never a browser error page |
| `data/index.json` | stale-while-revalidate | a new file list arrives on the next load |
| `data/**` other | cache-first, cached forever | the URL carries the hash, so a hit can never be old |
| app code (`.js`, `.css`, `.webmanifest`) | network-first, cache fallback | a fix lands on the first online load |
| activate | drop the last shell cache, sweep data files the manifest no longer lists | a rebuild must not leave orphans |

Two caches. `itadict-shell-<v>` holds the shell and the app code and dies on every deploy.
`itadict-data` holds content and the manifest, and survives a deploy. A sweep that cannot read the
manifest leaves the data cache alone, because offline it would delete the whole dictionary.

The shell list holds every module under `js/` and the four icons. A module left off that list is
dead offline, and `npm run verify:offline` fails on it.

## Deploy

The site is `https://maxalcala.com/itadict/`. The `github.io` name redirects to it. The subpath
is `/itadict/` and it is frozen.

1. **Every URL is relative.** `./js/app.js`, `data/index.json`. An absolute path works on a root dev
   server and 404s on Pages.
2. **`.nojekyll` at the root.** Otherwise Jekyll drops a file that begins with an underscore.
3. **`sw.js` answers 200 at `/itadict/sw.js`.** A missing worker means no offline, with no visible
   error.
4. **`CACHE` in `sw.js` is bumped on every deploy.** Pages sends `Cache-Control: max-age=600`, so
   `sw.js` itself can be ten minutes stale. The bump is the only way a fix reaches an installed app.
5. **The first load is online.** An install that never loaded online has nothing cached.

## What each gate can prove

`npm test` (Node, no browser) proves the parts that would fail silently:

- the fold and the bucket key; the mapped offsets of a highlighted match; the edit-distance budget;
- ranking order, the tie rules, the result cap, and a one-character query that reads history;
- an inflected form resolving to its lemma, across buckets, by id;
- the Translation rows: one per English gloss, the part of speech only on its first row, and no
  section at all when the entry has no English data;
- the tokeniser, the reader's summary and its word cap; an elided word resolving through its parts;
- the router's eight routes, the sentence route's strict bucket and id, the URL repair, one render
  per route, and teardown;
- the example rows: English, empty English and legacy rows, a bad row keeping its place, and
  `sentence()` sharing one hashed fetch with `examples()`, with a second call reading no file;
- `reader.word`: an elision, a form, an unknown word, and a file that did not load;
- the attribution lines About reads from the manifest sources, and none when a source has none;
- the envelope migration, the caps, a refused blob, the lists and folders, the backup round trip;
- the study rule: a forgot, a remembered, the midnight boundary, the deck order, a card surviving a
  reload;
- speech picking an Italian voice and never drawing a dead button;
- the alphabet and the parts-of-speech index;
- the manifest with its hashes and deck sizes, the file a split bucket picks, and one hashed fetch
  per lookup.

`npm run check` proves the data: the manifest matches the files, the byte counts and hashes, the
size caps, the id form and its position, every form pointing at a shipped entry, every example
position holding a sentence, no sentence text inside an entry, no excluded headword, the licence
lines.

`npm run verify:offline` proves the deployed shape in headless Chromium at 390x664, DPR 3, with an
iPhone user agent, served on the real `/itadict/` subpath. It covers the cold load, five tabs, worker
control, a search, the manifest and the four icons, a cold deep link, the download action including
its one deliberate miss, an offline relaunch, a cached search offline, an uncached bucket offline, a
clean console, a clean response log, and the subpath on every request.

What none of them proves is on a device: the safe areas, the install, the status bar, the voices,
the swipe, the memory pressure, and the 7-day eviction. `docs/verification/gate-2.md` lists those.

## Gaps between the code and the ADRs

Recorded on purpose. Fix the code or the ADR; do not let the two drift.

1. `js/offline.js` runs from the Reference tab's Offline row and from the Settings screen. The gate
   calls the action directly, so the button itself is unproven.
2. The memo has no bound, so a long session grows. There is no LRU.
3. An entry body carries `cefr`, and no screen draws it. The band shows in Study and in Reference.
4. The code licence is MIT, and no `LICENSE` file is on disk yet.
5. Entry ids can move. An id is `<file>:<position>`, and a rebuild that reflows a file split
   renumbers entries. Past rebuilds were probably affected, unseen. The pinned split plan (ADR
   0003, "Pinned split plan") reuses the previous build's splits, and kept build
   `v1-96e792b8e32a` at 0 moved ids. A rebuild that must change a split can still move ids.

   The app's containment is the safety net, for what keeps a word beside its id. Notes and list
   items are checked against the headword now at their id, on the Entry screen, the Study card,
   the Notes view and a list view (`relocate()` in `js/lists.js`, `rekeyAll()` in `js/storage.js`).
   An item follows its word to a new id only when exactly one candidate sits in the old id's
   two-letter bucket. With none, or with homographs that disagree, it stays put. A note never
   shows on another headword. Not contained:
   - the Study schedule and the opened ids, which store only ids. A card can wake up on another
     word.
   - a note from before words were stored, which has no word.
   - an item whose word left the dictionary, which stays at its old id. Its note stays hidden
     there.

   The fix is a follow-up with its own decision. The options: a stable id keyed by the word, a
   redirect table from old ids to new ones shipped with each build, or splits that never reflow.
6. The manifest keys a one-character bucket differently per set. Search, entry, ex and forms pad
   it (`e_`, `2_`, and `__` for symbols only), and English does not (`e`, `_`). `bucketFor()` in
   `js/data.js` hides the difference for every reader. A uniform key in the build is a follow-up.
7. The form index holds one record per folded key, so spellings that fold together and name
   different lemmas keep only one: 203 are lost, such as `parti` (parte) under `partì` (partire),
   `liberò` (libare) under `libero` (liberare) and `rasò` (rasare) under `raso` (radere). The
   follow-up is an array per key, one record per spelling, about 4,209 more records and +520 KB.
   ADR 0005, Word drilling.
8. `contexts()` in `js/text.js` starts a sentence after any `.`, so a word after an abbreviation
   reads as sentence-initial: in `Sig. Rossi` the name Rossi is never eligible and does not open.
   An abbreviation list is a follow-up.
