# Sharded, lazy content and offline

The dictionary is too large to load at boot and too useful offline to leave half downloaded. Content
ships as shards. The app fetches the shard it needs. Full offline is an explicit action, not a boot
cost.

## Shards

One bucket per two folded letters of the headword: `aa`, `ca`, `st`. Folding is the search rule from
0004, so the bucket of a query is the bucket of its results. A bucket that exceeds the size cap splits
into files named by a longer prefix, for example `data/ca/cao.json`. The cap is 1 MB per file, and
the build holds `npm run check` to it. The shipped set is 478 buckets, 66,344,150 bytes in the
manifest, and the largest file is 999,999 bytes. Of that total, 1,943,440 bytes is the English index.

`data/index.json` is the manifest: every file, its size, its hash, the counts, the CEFR deck sizes and
the source list with licences.

Five file sets per bucket, and one set outside a bucket:

| Set | Holds | Fetched when |
|---|---|---|
| `data/<key>.json` | search rows: folded key, id, headword, IPA, part of speech, Italian gloss, English gloss | a query reaches that bucket |
| `data/entry/<key>.json` | entry bodies: English groups `en`, Italian senses, conjugation, example positions | an entry opens |
| `data/ex/<key>.json` | example sentences in entry order, keyed by position | with the entry body |
| `data/forms/<key>.json` | folded inflected form to its lemma | a short result list, or a form search |
| `data/cefr/<band>.json` | deck rows: id, word, part of speech, gloss | a deck is picked in Study |
| `data/en/<key>.json` | folded English token to entry ids, at most 100 per token | an English query that the Italian search left short. The client does not read this set yet |

An entry body stores example positions, never example text. That keeps the CC BY 2.0 FR sentences in
their own files and out of the CC BY-SA shards. See 0001.

Every data URL carries `?v=<hash>` from the manifest. A rebuilt file is a new URL, so a cache-first
read can never serve old bytes. The manifest's `version` is not part of any URL.

## Cache rules

| Request | Strategy | Why |
|---|---|---|
| shell, precached on install | cache-first | an installed app must open with no network |
| `data/index.json`, also precached | stale-while-revalidate | a new file list arrives on the next load, offline keeps the old one |
| content files (`data/**` other) | cache-first, cached forever | the URL carries the hash |
| navigations | the cached `./index.html`, network fallback, then 504 | never a browser error page |
| app code (`.js`, `.css`, `.webmanifest`) | network-first, cache fallback | a fix lands on the first online load |
| activate | drop the last shell cache, sweep files the new manifest does not list | a rebuild leaves no orphans |

App code is matched before the shell, so `styles.css` and the manifest are precached and also
network-first, as they must be to take a fix.

Two caches, not one. `itadict-shell-<v>` holds the shell and the app code and is dropped on every
deploy. `itadict-data` holds content and the manifest and is never dropped by a deploy. One cache per
deploy would delete a downloaded dictionary every time a line of CSS changes.

A sweep that cannot read the manifest leaves the data cache alone. Offline, a sweep would otherwise
delete the whole downloaded dictionary.

## Download all

`js/offline.js` holds the action: it fetches every data URL the manifest lists, one at a time, through
the normal path, so the worker caches each one. Progress is files done out of files listed. It is
sequential on purpose: the number is honest, and a phone on a weak signal is not flooded.

A failed fetch never stops the run. It is counted, and the run reports it at the end.

The Reference tab's Offline row calls it. The row shows the size, the file count and a Download
button, then a progress line that counts files done, total, and failures. `js/app.js` wires the button
to `downloadAll()` over the manifest. The gate calls the action directly, so it proves the action and
not the button.

## Storage limits and eviction

Two measured facts decide the rules.

Safari gives an origin 60% of the free disk space. The whole dictionary fits inside that on any phone
with room to install an app, so the download is safe to offer.

Intelligent Tracking Prevention clears the service-worker caches of a site that goes 7 days without
interaction. A home-screen web app is exempt from that clearing.

Three rules follow.

- Every cached file must be re-fetchable, so a cache is never the only copy of anything that ships.
- A missing cache entry is a network miss, not an error. The app must open after a wipe.
- A home-screen install is the durable state. The About screen says so in one line.

Notes, lists and study progress live in `localStorage` and are not re-fetchable. Their loss is
accepted; the app must open, not crash, when the blob is gone.

**Consequences:** a cold search in a new bucket costs one manifest read and one row fetch. An entry
costs one entry file and one example file. `data/index.json` must be rebuilt with the files by
`npm run build:data`, and a stale manifest is the one way to request a file that no longer exists.
The worker must fall back to the network on a cache miss, or the app dead-ends after an eviction.
