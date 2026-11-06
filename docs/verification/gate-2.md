# Gate 2 — acceptance record

Status: the automated half runs, the device half is open. A blank row blocks the gate.

This record covers the deployed shape of the app in a browser that behaves like an iPhone, and the
checks only a real device can settle. The automated half is a tool, not a person: it proves the
shell, the data paths and the offline fallback. It cannot prove safe areas, install, voices or
eviction.

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

| # | Check | Pass looks like | Result |
|---|---|---|---|
| 1 | Every module under `js/` is precached | Each file is in the worker's shell list. A module left out is dead offline | — |
| 2 | Cold load of the subpath | 200 for the document | — |
| 3 | The tab bar | Five tabs, Search active | — |
| 4 | The worker controls the page | `navigator.serviceWorker.controller` is not null | — |
| 5 | Search | The query `casa` returns a row that starts with `casa` | — |
| 6 | The manifest | Answers 200 through the worker | — |
| 7 | The manifest is Italian | Name and short name are `Italian` | — |
| 8 | Relative start | `start_url` and `scope` are `./` | — |
| 9 | The icon set | 180, 192, 512 and a maskable 512 are listed | — |
| 10 | The icons resolve | Each icon answers 200 | — |
| 11 | A cold deep link | `#/entry/ca:0` in a fresh context draws `casa` | — |
| 12 | Download progress | One progress line per file, zero failures | — |
| 13 | Download coverage | Every file the bucket lists is fetched | — |
| 14 | One bad file | Counted, and the run goes on | — |
| 15 | Offline relaunch | The shell draws with the network cut | — |
| 16 | Offline Search | The field is visible after the relaunch | — |
| 17 | Cached search offline | A bucket already fetched returns rows | — |
| 18 | Uncached bucket offline | One line, not a crash | — |
| 19 | No uncaught error | The page-error list is empty | — |
| 20 | The subpath | Every request starts with `/itadict/` | — |
| 21 | No failed response | No 4xx or 5xx, apart from one deliberate miss | — |
| 22 | A clean console | No console error while online | — |

### How the run fakes offline

Two cuts, both needed. `context.setOffline(true)` stops the page's own requests. Closing the server
stops the worker's. Chromium still lets a service worker reach the network while the context reads
as offline, so the context alone would prove nothing about a cache miss. With both cuts, only a cache
can answer.

The run asks for one file that does not exist. That miss is the point: it proves one bad file is
counted and the rest of the download continues. Every other response must be clean.

A third question stays open on purpose: clear every cache and every stored blob, then reload offline.
That must fail with the browser error page. It proves the app is not quietly depending on a cache a
device wipe removes.

## What only a device can settle

| Check | Why the harness cannot settle it |
|---|---|
| Safe areas under a notch and the home indicator | Desktop Chromium reports every inset as 0 |
| Install from the home screen | Only the real browser adds the icon and the standalone window |
| The maskable icon crop | Needs the real home screen and the real launcher |
| Status bar and theme colour in both schemes | Needs a real system setting |
| Italian TTS voices | Voices are per device and per OS |
| The swipe on a study card | A programmatic drag is not a thumb |
| Storage eviction after a week of no use | Cannot be waited out, and iOS applies its own rule |
| Memory pressure with the whole dictionary cached | A desktop machine has different limits |
| Tap targets under a thumb | Hit areas can be measured; reach cannot |

## Result

Fill each row with pass, fail, or fail with a reason, and keep the run's log beside the record.

| Field | Value |
|---|---|
| Date | |
| Build from `data/index.json` | |
| Browser and version | |
| Checks 1 to 22 | |
| Failures, with cause | |
| Device checks done, and on which device | |
| Signed off by | |

### Runs so far

| Date | Build | What ran | Outcome |
|---|---|---|---|
| 2026-11-05 | `v1-eeb5e34d3756` | `npm run verify:offline` | 22 of 22 passed. Headless Chromium only; no device check yet. |
