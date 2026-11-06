# Data and licences

Three sources, and the licences never meet in one file. The dictionary text ships as CC BY-SA 4.0.
The example sentences ship under their own licence, in their own file set. The app code ships as
MIT.

## The sources

| Source | What it gives | Licence |
|---|---|---|
| kaikki.org extract of it.wiktionary | headwords, definitions, IPA, inflected forms | CC BY-SA 4.0 |
| Tatoeba Italian sentences | example sentences | CC BY 2.0 FR |
| FrequencyWords Italian 50k list (Hermit Dave) | the rank that sets a CEFR band | CC BY-SA 4.0 |

The extract holds 541,641 records, and 454,374 of them are inflected forms. A lemma becomes an
entry; a form becomes one row in the form index.

## What ships

| Measure | Value |
|---|---|
| Entries | 61,820, every one with at least one Italian definition |
| Entries with IPA | 56.6% |
| Senses | 91,744 |
| Forms that resolve to a lemma | 232,248 |
| Verbs | 6,325, of which 5,471 carry a full table |
| Tatoeba sentences | 49,283, in 49,505 example slots |
| Buckets | 478 |
| Data size | 60,067,433 bytes of file content, 62 MB on disk, largest file 999,990 bytes |

CEFR bands, by entry: a1 670, a2 572, b1 1,489, b2 2,144, c1 5,028, c2 51,917.

## The licence split

- **Dictionary data**: CC BY-SA 4.0. The shards are a derivative of the Wiktionary text and keep that
  licence. See <https://it.wiktionary.org/wiki/Aiuto:Copyright>.
- **App code**: MIT. Separate licence, separate files, separate notice. The `LICENSE` file is not on
  disk yet.
- **Examples**: CC BY 2.0 FR. They ship in their own file set. An entry body stores example
  positions, never sentence text, so no Tatoeba sentence lands in a CC BY-SA shard.
- **The frequency list**: CC BY-SA 4.0. Only the derived band value ships. The word list itself does
  not.

## Required attribution

- Dictionary text, near each entry:
  `Testo da Wikizionario, it.wiktionary.org, CC BY-SA 4.0 - <url voce>, modificato`
- Examples, once site-wide:
  `Frasi da Tatoeba (tatoeba.org), CC BY 2.0 FR`, with a link to <https://tatoeba.org/>.

The build writes the strings into `NOTICE` and `data/LICENSE-DATA.md`, so the notice cannot drift
from the licence table. The About screen, when it lands, shows the same two lines.

## Exclusion

27 pages on it.wiktionary are flagged for an unchecked copyright claim, and they must not ship. The
category is
<https://it.wiktionary.org/wiki/Categoria:Da_controllare_per_copyright>. The build reads the list into
`tools/data-exclusions.json`, drops a record whose headword is on it, and `npm run check` fails if
an excluded headword ships.

## Entry ids are per build

An entry id is `<bucket>:<index>`, a position in the shard of one build. It is stable within a build
and it carries its own location, so a cold deep link reads one entry file.

It is not stable across builds. A rebuild reorders a shard, and the same id can name a different
word. A stored id therefore points at a word, not at a word's identity:

- a study card, a note and a list item all keep the id, and after a rebuild they can name the wrong
  word;
- a bookmarked `#/entry/<id>` link can open a different entry after a rebuild.

The build is the unit of the mapping. A content change that must keep stored progress would need a
stable key, such as the headword and the part of speech, and that is a decision for a later ADR.

## CEFR

No open CEFR list for Italian exists. A band comes from the FrequencyWords `it_50k` rank, calibrated
on the De Mauro vocabulary sizes. The resulting order is defensible: a word that ranks higher in a
large corpus is more likely to be taught earlier. The label is approximate, and the UI says so on the
Study screen. A band is a filter, never a claim about a word.

## Consequences

- A bucket carries one licence. Any merge of two sources into one file would force the BY-SA licence
  onto Tatoeba text, which the CC BY 2.0 FR terms do not allow.
- Every attribution string is data, not copy written by hand in a screen. A licence change is one
  line of the build.
- The build records what it changed: fields pruned, glosses cleaned and shortened, examples shortened.
  That record is what `modificato` stands for.
- CEFR bands can be rebuilt from another frequency table without touching the app. Only the band value
  changes.
