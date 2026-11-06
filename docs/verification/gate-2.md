# Gate 2 — acceptance record

Status: **plan**. Fill the Result column at milestone 8. A blank row blocks the gate.

This record checks the deployed shape of the app in a browser that behaves like an iPhone. It checks
one subpath, one offline relaunch, one cold entry link and one cut network. It does not replace the
device checks at the end.

## Setup

Serve the parent directory, so the app loads under `/itadict/` exactly as it deploys:

```
cd /home/max/Developer && python3 -m http.server 8000
```

Open `http://localhost:8000/itadict/`. Never serve the repo root: the subpath is the point of the run,
and a mistake in a path only shows up under it.

Build the data before the run (`npm run build:data`), so the manifest is complete and not a fixture.

## Browser harness

- Chromium, headless, driven by a local Playwright install. The install is for this check only. It is
  not a dependency of the app and not in `package.json`.
- One context per check, unless the check says otherwise.
- Device: iPhone-shaped. Viewport 390 by 664 CSS px, device scale factor 3, mobile on, touch on, an
  iPhone user agent. A screenshot from this context is 1170 by 1992 px.
- Record every request, every response status and every console message for the whole run.
  `page.on('request')`, `page.on('response')`, `page.on('console')`, `page.on('pageerror')`.

The harness is throwaway. It lives outside the repo, or in a scratch file that never ships.

## Checks

| # | Check | How | Pass looks like | Result |
|---|---|---|---|---|
| 1 | Cold load of the subpath | New context, open `/itadict/` | 200 for the document, the tab bar shows five tabs, Search is the active tab | — |
| 2 | Tab bar and safe areas | Screenshot at 390x664, then read the computed style of the bar | The bar is pinned to the bottom, its padding reads the bottom inset, and no row sits under it | — |
| 3 | Search as you type | Type `c`, then `ca`, then `cas` | One letter shows the history or the one-more-letter line and no request; `cas` shows rows with headword, pronunciation or form line, and one gloss | — |
| 4 | Entry deep link, cold | Fresh context, open `/itadict/#/entry/<id>` for an id captured in check 3 | The screen never flashes empty. With no stored bucket it shows one line and no error. After one open, a reload of the same URL fills the sections | — |
| 5 | Offline relaunch, home-screen shape | Load once online, wait for the worker to activate, `context.setOffline(true)`, reload | The app opens from the shell cache. The tab bar and Search draw. No browser error page | — |
| 6 | Search with the network cut | Stay offline, search a bucket already fetched, then a bucket never fetched | The fetched bucket draws its rows. The fresh bucket shows the no-data line. Neither throws | — |
| 7 | Shell after a data wipe | Delete the data cache only, stay offline, reload | The shell still opens and Search draws its state line. This proves the shell cache is separate from the data cache | — |
| 8 | Manifest and icons | Fetch `./manifest.webmanifest` and every icon it lists | 200 each, valid JSON, name `Italian`, `start_url` and `scope` relative, 192 and 512 icons and one maskable | — |
| 9 | Subpath on every request | Read the request log | Every request URL starts with `http://localhost:8000/itadict/`. No request to a bare root path | — |
| 10 | No 404 | Read the response log | No 404, and no 4xx other than none | — |
| 11 | No console error | Read the console log and the page-error log | No error. A warning about a missing worker is the only allowed line, and only if the browser blocks it | — |

Checks 9 and 10 fail together for one cause: an absolute path. Find it in the request log, not in the
source.

## How to fake offline honestly

`context.setOffline(true)` drops the network and leaves the caches alone, which is what an aeroplane
does. Reload after it, so the document itself has to come from the worker.

Two runs are needed:

1. **Shell run**: online once, worker active, then offline and reload. Proves the precache.
2. **Data-wipe run**: online once, worker active, delete only the data cache through the page, then
   offline and reload. Proves the shell does not depend on the data cache, and that a missing content
   file is a miss, not a crash.

A third run answers a different question: clear every cache and every stored blob, then reload
offline. That must fail with the browser error page. It proves the app is not silently depending on a
cache that a device wipe removes.

Do not fake offline by stopping the server. A stopped server still answers nothing, but it also kills
the run and hides which cache answered.

## What stays a real-device check

| Check | Why the harness cannot settle it |
|---|---|
| Safe areas under a notch and the home indicator | Desktop Chromium reports every inset as 0 |
| Install from the home screen | Only the real browser adds the icon and the standalone window |
| Status bar and theme colour in both schemes | Needs a real system setting and a real screenshot |
| TTS voices for a headword | Voices are per device and per OS |
| The swipe on a study card | A programmatic swipe is not a thumb |
| Storage eviction after a week of no use | Cannot be waited out, and a desktop profile does not follow the iOS rule |
| Memory pressure with the whole dictionary cached | A desktop machine has different limits |
| Tap targets under a thumb | Hit areas can be measured; reach cannot |

## Result

Fill each row with pass, fail, or fail with a reason. Add the build version from `data/index.json`,
the browser build, and the date at the top.

| Field | Value |
|---|---|
| Date | |
| Build (`data/index.json` version) | |
| Browser | |
| Harness location | |
| Checks 1 to 11 | |
| Failures, with cause | |
| Device checks done, and on which device | |
| Signed off by | |
