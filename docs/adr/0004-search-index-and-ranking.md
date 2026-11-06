# Search index and ranking

Ranking order is fixed: exact, then prefix, then inflected form, then fuzzy. The order is also the
budget. A cheap step that already filled the result list stops the steps below it.

## Folding

Search is accent-insensitive and case-insensitive. Fold means: NFD normalize, drop the combining
marks, lowercase. `perché` and `PERCHE` both fold to `perche`. Folding is one
`String.prototype.normalize` call, not a table. It runs once per query in the browser, and once per
headword at build time. Only the key is folded. Display strings keep their accents.

Consequence: `e` matches `è` and `é`. Results order by rank, not by alphabet.

## Index format

The index is bucketed by the first two letters of the folded headword. A bucket is one file,
`data/index/<bucket>.json`, capped at 1 MB and split the same way a fat letter splits. Two letters
is the unit because a search runs from two characters, so every query needs exactly one bucket.

A bucket is an array of rows sorted by folded key:

```
[folded, id, headword, pronunciation, gloss]
```

The row carries what a search row draws: headword, the small pronunciation line, one grey gloss line.
That is why the index costs bytes. A result row is drawn without fetching the shard that holds the
entry.

## Form to lemma

`data/forms/<bucket>.json` maps a folded inflected form to its lemma id and the lemma's headword.
Buckets are the first two letters of the form, same as the head index. The source is the verb forms
in the extract.

This index duplicates every inflected form once, so it is the largest of the indexes. It is a separate
file set so that it is only fetched when the first two steps fall short.

## Ranking

| Step | Match | Cost |
|---|---|---|
| exact | folded query equals a folded headword | one map lookup in the loaded bucket |
| prefix | a folded headword starts with the query | binary search, then a scan up to the result cap |
| inflected | the query is a verb form of a lemma | one forms bucket fetch, then a lookup per hit |
| fuzzy | edit distance 1 for queries up to four characters, 2 above | a scan of the loaded buckets, never a shard |

Fuzzy runs only when the three steps above return fewer than the result cap, and only for queries of
two characters or more, and it stops at the cap. It is the only step that scans, so it is the only
step with a time budget. A one-character query shows history and notes suggestions instead of a
search.

Within a step, ties order by exact-case-and-accent match first, then by shorter headword, then by the
row's rank field from the extract. Prefix search never crosses a bucket, because a bucket is the
first two letters and the query is at least two characters.

**Consequences:** a keystroke after the first costs no fetch, because the bucket is cached forever.
The first search on a new bucket costs one small fetch. Fuzzy results are bounded, which is a quality
limit, not a bug: `shortcut: fuzzy only scans the loaded buckets, raise the search length or add a
bounded edit-distance index if recall matters`.
