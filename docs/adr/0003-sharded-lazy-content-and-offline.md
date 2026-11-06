# Sharded, lazy content and offline

The dictionary is too large to load at boot and too useful offline to leave half downloaded.
Content ships as shards. The app fetches the shard it needs. Full offline is an explicit action,
not a boot cost.

## Shards

One bucket per two folded letters of the headword: `aa`, `ab`, `ca`. Folding is the search rule from
0004, so the bucket of a query is the bucket of its results. A bucket that exceeds the size cap splits
into numbered files. The cap is 1 MB per file, because one file is one fetch and a phone on a weak
signal must finish it. Total content stays under 150 MB.

`data/index.json` is the manifest: every file, its bucket, its byte size, the counts, and the source
list with licences.

Four file sets, fetched for four different reasons:

| Set | Holds | Fetched when |
|---|---|---|
| `data/<bucket>.json` | search rows: folded key, id, headword, pronunciation, one gloss | a query reaches that bucket |
| `data/entry/<bucket>.json` | entry bodies: senses, forms, example ids | an entry opens |
| `data/ex/<bucket>.json` | example sentences, keyed by Tatoeba sentence id | with the entry body |
| `data/forms/<bucket>.json` | folded inflected form to its lemmas | short result list, or an entry with a conjugation |

An entry body stores example ids, never example text. That is what keeps the CC BY 2.0 FR sentences in
their own files and out of the CC BY-SA shards. See 0001.

The content hash lives in the filename, never in a query string. A changed file is therefore a new URL,
and an unchanged file keeps its URL across deploys. The manifest's `version` is not a cache key; only
the per-file hash is.

## Cache rules

| Request | Strategy | Why |
|---|---|---|
| shell (`./`, `./index.html`, `./styles.css`, `./manifest.webmanifest`) | precached on install, cache-first | an installed app must open with no network |
| navigations | the cached `./index.html`, network fallback | never a browser error page |
| app code (`js/**`, `sw.js`, CSS, the webmanifest) | network-first, cache fallback | a fix lands on the first online load |
| content files (`data/**`, except the manifest) | cache-first, cached forever | the URL carries the hash, so a revalidation can never change the bytes |
| `data/index.json` | stale-while-revalidate | a new file list arrives on the next load, offline keeps the old one |

App code is matched before the shell, so `styles.css` and the manifest are precached and also
network-first, as they must be to take a fix.

Two caches, not one. `itadict-shell-<v>` holds the shell and the app code and is dropped on every
deploy. `itadict-data` holds content and is never dropped by a deploy; activate sweeps only the URLs
the new manifest no longer lists. One cache per deploy would delete a downloaded dictionary every
time a line of CSS changes.

## Download all

Offline use is an explicit action, next to the content list. It fetches every file URL in the manifest
through the normal fetch path, so the worker caches each one. Progress is files done out of files
listed. The action is explicit because the full set is large and most searches need one bucket or
two. After it, search works with no network for every letter.

A failed fetch inside the download never stops the run. It is counted and reported at the end, so one
bad file does not throw away the rest.

## Storage limits and eviction

Two measured facts decide the rules.

Safari gives an origin 60% of the free disk space. The full dictionary fits inside that on any phone
with room to install an app, so the download is safe to offer.

Intelligent Tracking Prevention clears the service-worker caches of a site that goes 7 days without
interaction. A home-screen web app is exempt from that clearing.

Three rules follow.

- Every cached file must be re-fetchable, so a cache is never the only copy of anything that ships.
- A missing cache entry is a network miss, not an error. The app must open after a wipe.
- A home-screen install is the durable state. The About screen says so in one line, and says that a
  browser tab may lose its offline copy after a week of no use.

Notes, history and study progress live in `localStorage` and are not re-fetchable. Their loss is
accepted; the app must open, not crash, when the blob is gone.

**Consequences:** a cold search in a new bucket costs one manifest read and then one row fetch.
`data/index.json` must be rebuilt with the files by `tools/build-data.mjs`, and a stale manifest is
the one way to request a file that no longer exists. The build must put the content hash in the
filename: until it does, a cache-first rule serves a stale file after a rebuild. The service worker
must fall back to the network on a cache miss, or the app dead-ends after an eviction.
