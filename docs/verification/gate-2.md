# Gate 2 — acceptance record

Status: the automated checks, the local gate and the live origin pass. The device checks are open.
A row marked "not run" blocks a full sign-off.

This record covers the deployed shape of the app in a browser that behaves like an iPhone, on the
real subpath, and on the live origin. It also lists what only a real device can settle.

## The automated half

```
npm run verify:offline
```

The tool serves the parent directory itself, on a random port, so the app loads under `/itadict/`
exactly as it deploys. It does not need `python3 -m http.server`, and it never serves the repo root:
the subpath is the point of the run.

- Chromium, headless, one context per check that needs a fresh state.
- iPhone shape: 390 by 664 CSS px, device scale factor 3, mobile on, touch on, an iPhone user agent.
  A screenshot from this context is 1170 by 1992 px.
- Every request, response status, console message and page error is recorded for the whole run.

The run needs `data/index.json`, so run `npm run build:data` first. The tool stops with a clear line
when the manifest is missing.

### Checks

Rows 1 to 22 passed on build `v1-8ffb3c86b224`, and again on `v1-ff5b79f38403`, the build that
added the English glosses. All 33 rows passed on `v1-0b0640e0c4a1`, the human-only example build.

| # | Check | Pass looks like | Result |
|---|---|---|---|
| 1 | Every module under `js/` is precached | Each file is in the worker's shell list. A module left out is dead offline | pass |
| 2 | Cold load of the subpath | 200 for the document | pass |
| 3 | The tab bar | Five tabs, Search active | pass |
| 4 | The worker controls the page | `navigator.serviceWorker.controller` is not null | pass |
| 5 | Search | The query `casa` returns a row that starts with `casa` | pass |
| 6 | The manifest | Answers 200 through the worker | pass |
| 7 | The manifest is Italian | Name and short name are `Italian` | pass |
| 8 | Relative start | `start_url` and `scope` are `./` | pass |
| 9 | The icon set | 180, 192, 512 and a maskable 512 are listed | pass |
| 10 | The icons resolve | Each icon answers 200 | pass |
| 11 | A cold deep link | `#/entry/ca:0` in a fresh context draws `casa` | pass |
| 12 | Download progress | One progress line per file, zero failures | pass |
| 13 | Download coverage | Every file the bucket lists is fetched | pass |
| 14 | One bad file | Counted, and the run goes on | pass |
| 15 | Offline relaunch | The shell draws with the network cut | pass |
| 16 | Offline Search | The field is visible after the relaunch | pass |
| 17 | Cached search offline | A bucket already fetched returns rows | pass |
| 18 | Uncached bucket offline | One line, not a crash | pass |
| 19 | No uncaught error | The page-error list is empty | pass |
| 20 | The subpath | Every request starts with `/itadict/` | pass |
| 21 | No failed response | No 4xx or 5xx, apart from one deliberate miss | pass |
| 22 | A clean console | No console error while online | pass |

### The sentence page checks

ADR 0005 added these. The fixture is the first row of `data/ex/ca.json` whose Italian has the word
`casa`. Every row of every ex file in the manifest must carry English: one without fails the run.
The word-target checks add a fixture row "a e i o" to the ca ex file, in their own context.

| # | Check | Pass looks like | Result |
|---|---|---|---|
| 23 | A `casa` row exists | `data/ex/ca.json` has one | pass |
| 24 | Every example has English | No row of any ex file in the manifest has an empty English | pass |
| 25 | Cold sentence link, Italian | `#/sentence/ca/<sid>` in a fresh context draws `.sentence-it` equal to the row | pass |
| 26 | Cold sentence link, English | `.sentence-en` equals the row's English | pass |
| 27 | No error on the cold links | The page-error list is empty | pass |
| 28 | The target fixture draws | "a e i o" draws as four word buttons | pass |
| 29 | Word targets are 24x44 | Every word button is at least 24 px wide and 44 px tall | pass |
| 30 | Word targets never cross | No two boxes on a line overlap, and 1 px either side of each glyph midpoint hits the nearer word or the gap, never the other word | pass |
| 31 | Sentence offline, Italian | After the download and the offline relaunch, the link draws the Italian | pass |
| 32 | Sentence offline, English | The same, for the English | pass |
| 33 | A word tap offline | A tap on `casa` draws the `casa` entry | pass |

On 2026-11-06 the run over build `v1-0b0640e0c4a1`, the human-only data with the first supported
form claim, passed 33 of 33 with the worktree's own Playwright 1.65, on the branch tip. The same day
`npm test` passed 74 of 74, `npx tsc --noEmit` was clean, and `npm run check` passed: 61,820
entries, 233,171 forms, 33,329 sentences, 586 buckets, 67,149,192 bytes. On the earlier build
`v1-0ac8a1e3d95a`, whose rows carried no English, the English checks failed, as they should.

Measured on that build at 390x844: the Entry row of an entry with one example (cabinato) is 112 px
tall with its English, and its chevron's centre is the row's centre. A short first word ("I" in
350517) starts at the margin with its 24 px target in the padding, inside the screen's edge and
below the navbar. Screenshots: `/tmp/itadict-shots/final-entry-one.png`, `final-entry-zero.png`
(cablogramma), `final-entry-zero-name.png` (Aarhus, a name with no examples),
`final-sentence-v2.png`, `final-sentence-v2-zoom.png`, `final-sentence-aeio.png` and
`final-word-tap.png`.

### How the run fakes offline

Two cuts, both needed. `context.setOffline(true)` stops the page's own requests. Closing the server
stops the worker's. Chromium still lets a service worker reach the network while the context reads
as offline, so the context alone would prove nothing about a cache miss. With both cuts, only a cache
can answer.

The run asks for one file that does not exist. That miss is the point: it proves one bad file is
counted and the rest of the download continues. Every other response must be clean.

A third question is open on purpose: clear every cache and every stored blob, then reload offline.
That must fail with the browser error page. It proves the app is not quietly depending on a cache a
device wipe removes. Not run.

### The other automated gates

| Gate | Result |
|---|---|
| `npm test` | 74 of 74 pass |
| `npx tsc --noEmit` | clean |
| `npm run check` | pass: 61,820 entries, 233,171 forms, 33,329 sentences, 586 buckets, 67,149,192 bytes |
| English coverage | 76.5%, 47,277 of 61,820 entries |

## The local gate

A second run, by hand, at a different device size, over the same served subpath.

| Field | Value |
|---|---|
| Device profile | iPhone 13: 390 by 844 CSS px, DPR 3, mobile, touch |
| URL | `http://localhost:8000/itadict/` |
| Requests | 19, all under `/itadict/` |
| Console errors | 0 |
| Cold start with the HTTP server killed | the shell draws: the tab bar and the history |
| Search offline | `casa` returns rows with no server |

Screenshots from this run:

- `/tmp/gate2-1-search-empty.png`
- `/tmp/gate2-2-search-rows.png`
- `/tmp/gate2-3-entry.png`
- `/tmp/gate2-4-study.png`
- `/tmp/gate2-5-lists.png`
- `/tmp/gate2-6-reference.png`
- `/tmp/gate2-7-offline-cold-start.png`
- `/tmp/gate2-8-offline-search.png`

## The live origin

| Field | Value |
|---|---|
| Browser | Firefox, on the live origin. The automated gate uses Chromium |
| URL | `https://maxalcala.com/itadict/` |
| Note | `maxarturo.github.io/itadict/` answers 301 to this origin, because the account sets a custom domain on the user site |
| Worker scope | `https://maxalcala.com/itadict/` |
| Caches | `itadict-shell-v1` and `itadict-data` |
| Shell cached | `index.html` and `styles.css` |
| Manifest cached | `data/index.json` |
| Search | works |
| Entry | works |
| Console errors | 0 |

Screenshots from this run: `/tmp/live-search.png` and `/tmp/live-entry.png`.

The 301 is a property of the host, not of the app. Every URL in the app is relative, so the subpath
works on either origin.

## The data cost of one tap

| Measure | Bytes |
|---|---|
| Entry file, 90th percentile | 74,564 |
| Largest entry file | 243,439 |
| Largest entry file, gzipped | 47,576 |
| Entry files | 948, from 22,339,073 bytes |
| Example file, 90th percentile | 31,656 |
| Largest example file | 169,412, 61,553 gzipped |
| Whole data set | 66,703,466 bytes in the manifest |
| English lookup index | 1,943,073 bytes of the total |

One tap on a row costs one entry file and one example file. Both are cached forever after the first
read, because their URL carries the file hash.

## What only a device can settle

Every row here is open. A row needs a real iPhone, a real home screen, or a week of no use.

| Check | Why the harness cannot settle it | Result |
|---|---|---|
| Safe areas under a notch and the home indicator | Desktop Chromium reports every inset as 0 | not run |
| Install from the home screen | Only the real browser adds the icon and the standalone window | not run |
| The maskable icon crop | Needs the real home screen and the real launcher | not run |
| Status bar and theme colour in both schemes | Needs a real system setting | not run |
| Italian TTS voices | Voices are per device and per OS | not run |
| The Web Share sheet on a list | The sheet belongs to the OS | not run |
| The swipe on a study card | A programmatic drag is not a thumb | not run |
| Storage eviction after 7 days without use | Cannot be waited out, and iOS applies its own rule | not run |
| The full 59.8 MB download on a phone | Needs the free disk and the real network | not run |
| Memory pressure with the whole dictionary cached | A desktop machine has different limits | not run |
| Tap targets under a thumb | Hit areas can be measured; reach cannot | not run |
| Sentence word targets on an iPhone | The harness measures each word button at least 24 px wide and 44 px tall; a one-letter word (`è`, `a`) under a thumb needs the phone | not run |
| VoiceOver on a word button | Each word is a `<button>` inside `lang="it"` text; the voice and the rotor order need the device | not run |
| The long-English clamp | The harness shows two lines and an ellipsis at 390 px; Safari's `-webkit-line-clamp` at the user's text size needs the device | not run |

## Open item: the iPhone check

Nobody has run this on an iPhone yet. One person can close it in about ten minutes.

1. Open `https://maxalcala.com/itadict/` in Safari.
2. Tap Share, then Add to Home Screen.
3. Turn Airplane Mode on.
4. Launch the app from the new icon.
5. Confirm the shell draws, and a search returns rows.
6. Look at the safe areas under the notch and the home indicator, and at the status bar in both
   schemes.

Record the result in the table below, with the device model and the iOS version. A failure here goes
in the same table as a failure, not as a plan.

## What this run does not prove

- Nothing here ran on a real iPhone. The device rows above are all open.
- The full download was never run end to end on a phone. Only the action, its progress and its
  error path are proved, on one bucket.
- A tap on the Download button in the UI is not covered. The gate calls the action directly.
- The install path, the standalone window and the maskable crop are not covered.
- The eviction rule is not covered, and no test can wait 7 days.
- Layout is measured at two fixed sizes. Text growth, a fold, and a large phone are not covered.
- The Translation section is checked at the data and DOM level, not against the live origin. The
  live run predates the English glosses.
- The English-keyed search index is measured and not built, so no run covers English to Italian
  search.

## Result

| Field | Value |
|---|---|
| Date | 2026-11-06 |
| Build from `data/index.json` | `v1-0b0640e0c4a1` for the automated gates below. The local gate and the live origin last ran on `v1-8ffb3c86b224` |
| Browser and version | Headless Chromium for the automated gate; a local Chromium at the iPhone 13 profile for the manual run; Firefox for the live origin |
| `npm test` | 75 of 75 pass |
| `npx tsc --noEmit` | clean |
| `npm run check` | pass, with the coverage line |
| Checks 1 to 33 | 33 of 33 pass on `v1-0b0640e0c4a1` |
| The local gate | 19 requests, all under `/itadict/`; 0 console errors; cold start and offline search pass |
| The live origin | search and entry pass; worker scope and both caches as listed; 0 console errors |
| Failures, with cause | none |
| Device checks done, and on which device | none. Every device row is "not run" |
| Signed off by | pending the device rows |

### Runs so far

| Date | Build | What ran | Outcome |
|---|---|---|---|
| 2026-11-05 | `v1-eeb5e34d3756` | `npm run verify:offline` | 22 of 22 passed. Headless Chromium only; no device check yet. |
| 2026-11-06 | `v1-8ffb3c86b224` | `npm test`, `npx tsc --noEmit`, `npm run check`, `npm run verify:offline` | 47 of 47, clean, pass, 22 of 22. |
| 2026-11-06 | `v1-8ffb3c86b224` | The local gate at iPhone 13, and the live origin | Pass. Device rows open. |
| 2026-11-06 | `v1-ff5b79f38403` | `npm test`, `npx tsc --noEmit`, `npm run check`, `npm run verify:offline` | 48 of 48, clean, pass with the coverage line, 22 of 22. |
| 2026-11-06 | `v1-7e4046481140` | The data rebuild: the English index and both glosses on every row | not re-run. The gates above stand on the previous build |
| 2026-11-06 | `v1-96e792b8e32a` | The link-first example rebuild: `[id, it, en]` rows, pinned split plan. `npm test`, `npx tsc --noEmit`, `npm run check`, three builds compared | 62 of 62, clean, pass, byte-identical. 0 entry ids moved. `npm run verify:offline` is B2's run |
| 2026-11-06 | `v1-16ca5ad4c4ba` | Capitalised headwords match examples by exact case, never sentence-initial. `npm test`, `npx tsc --noEmit`, `npm run check`, three builds compared | 65 of 65, clean, pass, byte-identical. 0 entry ids moved. `npm run verify:offline` is B2's run |
| 2026-11-06 | `v1-398a82a1a4b5` | The form index: the most frequent shipped lemma per form, and the raw spelling in `form`. `npm test`, `npx tsc --noEmit`, `npm run check`, three builds compared | 74 of 74, clean, pass, byte-identical. 0 entry ids moved. `npm run verify:offline` is B2's run |
| 2026-11-06 | `v1-0b0640e0c4a1` | The form index back to the first supported claim, keeping the gloss filter and `form`. `npm test`, `npx tsc --noEmit`, `npm run check`, two builds compared | 74 of 74, clean, pass, byte-identical. 0 entry ids moved. `npm run verify:offline` is B2's run |
