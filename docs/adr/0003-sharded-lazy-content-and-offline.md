# Sharded, lazy content and offline

The dictionary is too large to load at boot and too useful offline to leave half downloaded. Content
ships as shards. The app fetches the shard it needs. Full offline is an explicit action, not a boot
cost.

## Shards

One bucket per two folded letters of the headword: `aa`, `ca`, `st`. Folding is the search rule from
0004, so the bucket of a query is the bucket of its results. A bucket that exceeds the size cap splits
into files named by a longer prefix, for example `data/ca/cao.json`. Entry and form files split at
250 KB, so one cold tap never pulls a whole fat bucket. Every file stays under the 1 MB cap, and the
build holds `npm run check` to it. The entry split is pinned to the previous build: see Pinned split
plan below. The shipped set is 586 buckets, 948 entry files, 66,703,466 bytes in the manifest, and
the largest file is 999,999 bytes. Of that total, 1,943,073 bytes is the English index and 3,314,114
bytes is the example set.

`data/index.json` is the manifest: every file, its size, its hash, the counts, the CEFR deck sizes and
the source list with licences.

Five file sets per bucket, and one set outside a bucket:

| Set | Holds | Fetched when |
|---|---|---|
| `data/<key>.json` | search rows: folded key, id, headword, IPA, part of speech, Italian gloss, English gloss | a query reaches that bucket |
| `data/entry/<key>.json` | entry bodies: English groups `en`, Italian senses, conjugation, example positions | an entry opens |
| `data/ex/<key>.json` | example rows `[id, it, en]`: the Tatoeba id, the Italian and its directly linked Tatoeba English, in id order, keyed by position. 292 files, 33,329 rows | with the entry body; a sentence page reads the same file |
| `data/forms/<key>.json` | folded inflected form to its lemma | a short result list, or a form search |
| `data/cefr/<band>.json` | deck rows: id, word, part of speech, gloss | a deck is picked in Study |
| `data/en/<key>.json` | folded English token to entry ids, at most 100 per token | an English query that the Italian search left short: `js/search.js` reads it when the Italian list has fewer than 20 rows, and draws an English block after the Italian rows |

An ex file never splits, because a split shifts the positions. The build fails instead. The largest
is `data/ex/co.json` at 169,412 bytes with its English, under a fifth of the 1 MB cap. A bucket with
no example that has English ships no ex file: 292 of 586 buckets have one.

An entry body stores example positions, never example text. That keeps the CC BY 2.0 FR sentences in
their own files and out of the CC BY-SA shards. See 0001.

## Pinned split plan

An entry id is `<file>:<position>`, so the entry-file split plan is part of every id. `schedule` and
`opened` store bare ids, and so do history and lists. A split point that moves makes a stored id dead,
or worse, makes it name another word and re-attach a study schedule to it.

The rule:

1. The build reads the previous build before anything else: the committed `data/index.json` and the
   entry files it lists. Their file keys pin the plan.
2. A group whose key was a previous entry file stays one file, unless its body passes `MAX_FILE`,
   1,000,000 bytes. A group the previous build split is split again. Only a group the previous build
   never saw follows the 250 KB cap.
3. So a body that shrinks never moves a split point. A pinned file moves only when it grows past 1 MB.
4. The guard. For every id in the previous entry files, the build compares its word with the new
   entry at that id. An id that now names another word is a collision: the build stops before it
   touches `data/`, and names the first ten. An id that is gone is a warning with a count. Only
   `--accept-id-moves` builds through a collision, and only on purpose: a source refresh that
   reorders words within a file is the case it exists for.
5. The build loads the previous manifest and the word at every id into memory before it touches
   `data/`, and it writes the new manifest last. A build that dies after clearing `data/` therefore
   leaves no `data/index.json`. So a missing `data/index.json` that git HEAD still tracks is an error:
   "data/ is missing but tracked in git: run `git checkout -- data/` first, or pass --fresh to accept
   new entry ids". It never silently renumbers.
6. `--fresh` starts a new id baseline on purpose: the build ignores any previous build, plans from
   scratch with the 250 KB cap, prints one warning that every id is new, and does not fail. With no
   git, or no tracked `data/`, a missing previous build takes the same path, with the same single
   warning. `--accept-id-moves` is the other override: it keeps the pin and builds through a
   collision.
7. A previous build that is partial (`--limit`), or a `data/index.json` that does not parse, stops
   the build with "restore data/ with `git checkout -- data/`". Neither override is the fix for it.

Determinism: the inputs are the sources and the previous build. The same sources plus the same
committed `data/index.json` and entry files give the same bytes. A build from scratch, with
`--fresh` or on a clone without `data/`, can renumber: today's sources plan bucket `re` as one file
instead of 21, and 621 ids go.

The link-first example build of ADR 0005 shrank entry bodies. Pinned, it kept all 61,820 ids: 0
gone and 0 naming another word. Unpinned, the same build would have dropped 621.

Earlier rebuilds moved ids before this rule. aece58b (the 250 KB split) removed 20,690 ids and
23dbb02 (the English join) removed 7,198. Every surviving id kept its word, so those left dead
references and no wrong words. The durable fix is ids keyed by the headword, with a migration of
`schedule` and `opened`. That is a follow-up ADR. Until then saved state stores ids only.

## URLs

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
