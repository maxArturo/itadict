# Sharded, lazy content and offline

The dictionary is too large to load at boot and too useful offline to leave half downloaded.
Content ships as shards. The app fetches the shard it needs. Full offline is an explicit action,
not a boot cost.

## Shards

One directory per first letter of the headword: `data/a/`, `data/b/`. A letter that exceeds the
size cap splits into numbered files. The cap is 1 MB per file, because one shard is one fetch and a
phone on a weak signal must finish it. Total content stays under 150 MB. `data/index.json` is the
manifest: every shard URL, its content hash and its byte size.

The content hash lives in the filename, never in a query string. A changed shard is therefore a new
URL, and an unchanged shard keeps its URL across deploys.

## Cache rules

| Request | Strategy | Why |
|---|---|---|
| shell (`./`, `./index.html`, `./styles.css`, `./manifest.webmanifest`) | precached on install, cache-first | an installed app must open with no network |
| navigations | the cached `./index.html`, network fallback | never a browser error page |
| app code (`js/**`, `sw.js`, CSS, the webmanifest) | network-first, cache fallback | a fix lands on the first online load |
| content shards (`data/**`, except the manifest) | cache-first, cached forever | the URL carries the hash, so a revalidation can never change the bytes |
| `data/index.json` | stale-while-revalidate | a new shard list arrives on the next load, offline keeps the old one |

App code is matched before the shell, so `styles.css` and the manifest are precached and also
network-first, as they must be to take a fix.

Two caches, not one. `itadict-shell-<v>` holds the shell and the app code and is dropped on every
deploy. `itadict-data` holds shards and is never dropped by a deploy; activate sweeps only the URLs
the new manifest no longer lists. One cache per deploy would delete a downloaded dictionary every
time a line of CSS changes.

## Download all

Offline use is an explicit action, next to the content list. It fetches every shard URL in the
manifest through the normal fetch path, so the worker caches each one. Progress is files done out of
files listed. The action is explicit because the full set is large and most searches need one letter
or two. After it, search works with no network for every letter.

A failed fetch inside the download never stops the run. It is counted and reported at the end, so one
bad shard does not throw away the rest.

## The iOS eviction risk

Safari may delete site data for a site left unused for a while. That removes the Cache API content
and the `localStorage` blob together. A home-screen install is kept longer but is not guaranteed.

Two rules follow. Every cached file must be re-fetchable, so a cache is never the only copy of
anything that ships. And a missing cache entry is a network miss, not an error. Notes, history and
study progress live in `localStorage` and are not re-fetchable. Their loss is accepted; the app must
open, not crash, when the blob is gone.

**Consequences:** a cold search on a new letter costs one manifest read and then a shard fetch.
`data/index.json` must be rebuilt with the shards by `tools/*.mjs`, and a stale manifest is the one
way to request a shard that no longer exists. The service worker must fall back to the network on a
cache miss, or the app dead-ends after an eviction.
