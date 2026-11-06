# Search index and ranking

Ranking order is fixed: exact, then prefix, then inflected form, then fuzzy. The order is also the
budget. A cheap step that already filled the result list stops the steps below it.

The app answers an Italian query. It also ships an English lookup index, so that a query in English
can one day find the Italian entry whose translation it matches. The Italian match always comes
first, and the English index ships without a client that reads it yet.

## Folding

Search is accent-insensitive and case-insensitive. Fold means: NFD normalize, drop the combining
marks, lowercase, then drop everything outside `a-z0-9` for a bucket key. `perché` and `PERCHE` both
fold to `perche`. Folding is one `String.prototype.normalize` call, not a table. The build folds once
per headword; the browser folds once per query. Only the key is folded. Display strings keep their
accents.

Consequence: `e` matches `è` and `é`. Results order by rank, not by alphabet.

## The row set

Search rows are separate from entry bodies. A row carries what a result row draws and what ranking
matches. Nothing else.

```
[folded, id, headword, pronunciation, pos, gloss, en]
```

Seven fields. `gloss` is the first Italian definition. `en` is the first English gloss, and `''` when
the entry has none. A row carries both, so the app never fetches an entry to draw a result line, and a
row draws the English gloss first with the Italian one behind it.

So a result list is drawn from one file, with no entry fetch per row. The entry body is fetched only
when a row is tapped.

Buckets are the first two folded letters of the headword. Two letters is the unit because search
starts at two characters, so every query needs exactly one bucket. A bucket over 1 MB splits by a
longer prefix, and the client picks the longest prefix the key starts with.

## Entry ids

An id is `<bucket>:<index>`, for example `ca:0`. It names a file and a position, so a cold deep link
costs one entry file and the app needs no lookup table. The id is a position in one build: after a
rebuild the same id can name a different word. See 0001.

## English to Italian

`data/en/<bucket>.json` maps a folded English token to the ids of the entries whose glosses contain it.
Buckets are the first two folded letters of the token, the same rule as the head index. A token is
looked up exactly, never by prefix, so a one-letter token keeps its plain file name.

Each key keeps at most 100 postings. Entries sit in frequency order, so the first 100 postings for a
token are the ones a learner meets first. The cap dropped 50,071 postings and no token: every English
token in the glosses is still in the index.

The index is 415 files, 1,943,440 bytes raw and 0.66 MiB gzipped, with a 90th percentile of 14,562
bytes and a largest file of 76,533 bytes.

The lookup rule is the ranking rule, applied to two languages:

1. Italian matches first: exact, prefix, inflected form, fuzzy, as above.
2. An English block comes second, and only when the Italian list holds fewer than 20 rows.
3. So the English index is fetched only for a query that the Italian search left short. A common
   Italian word never pays for it.

The index ships. The client does not read it yet: `js/data.js` has no English lookup and
`js/search.js` runs the Italian steps only. Until that lands, an English query returns Italian rows
that happen to match, and the index is dead weight that the download action still fetches. The data
side is the decision; the client side is open.

## Form to lemma

`data/forms/<bucket>.json` maps a folded inflected form to `{ id, lemma, label }`. Buckets are the
first two letters of the form. The index is built from every form claim in the extract: the source's
own `form_of` links, plus the tense and person tags on the lemma's form entries. It is inverted
relative to a conjugation table, and that is on purpose: a search needs form to lemma, which is the
direction a dictionary never stores.

This index duplicates every inflected form once: 232,248 rows in the shipped build. It ships
separately so that it is fetched only when a short result list needs it.

## Conjugation tables

The Forms section of an entry is built from the inverted form index, never from the extract's own
`forms` field on the lemma. The field is per source page and misses forms that another page claims, so
a table built from it has holes. The index has every claim.

The build writes one lemma's table into that lemma's entry body as `conj`: one group per tense, with
its six person slots, so the app does no reverse scan. A lemma whose forms the index does not know
shows no Forms section, rather than an empty one.

## Ranking

| Step | Match | Cost |
|---|---|---|
| exact | folded query equals a folded headword | one pass over the loaded bucket |
| English | the query is an English word in a gloss, and the Italian list is short of 20 | one English shard fetch, then one row lookup per id |
| prefix | a folded headword starts with the query | the same pass, then a sort to the cap |
| inflected | the query is a form of a lemma | one forms shard fetch, then the lemma's row |
| fuzzy | edit distance 1 for queries up to four characters, 2 above | one more pass over the bucket, never an entry file |

Fuzzy runs only when the three steps above return fewer than the result cap, and only for queries of
two characters or more, and it stops at the cap. It is the only step that scans for a near miss. The
cap is 50 rows. A one-character query shows history and notes suggestions instead of a search.

Within a step, ties order by exact case-and-accent match first, then by the shorter headword, then by
the row's rank from the corpus, then by alphabet, so the order is stable. Prefix search never crosses
a bucket, because a bucket is the first two letters and the query is at least two characters.

**Consequences:** one row carries both glosses, which is why the entry set grew from 59,877,636 to
66,334,993 bytes in three builds. Of that, 1,943,440 bytes is the English index itself. A keystroke
after the first costs no fetch, because the bucket stays in the session memo. The first search in a new bucket costs one small fetch. An inflected-form hit costs a second
fetch. Fuzzy results are bounded, which is a quality limit, not a bug:
`shortcut: matching scans the whole bucket; add a range index if a bucket passes 50k rows`.
