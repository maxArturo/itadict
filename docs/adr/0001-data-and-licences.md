# Data and licences

Four sources, and the licences never meet in one file. The Italian dictionary text and the English
glosses ship as CC BY-SA 4.0. The example sentences ship under their own licence, in their own file
set. The app code ships as MIT.

## The sources

| Source | What it gives | Licence |
|---|---|---|
| kaikki.org extract of it.wiktionary | headwords, definitions, IPA, inflected forms | CC BY-SA 4.0 |
| kaikki.org extract of en.wiktionary, Italian entries | the English glosses of the Translation section | CC BY-SA 4.0 |
| Tatoeba Italian sentences | example sentences | CC BY 2.0 FR |
| FrequencyWords Italian 50k list (Hermit Dave) | the rank that sets a CEFR band | CC BY-SA 4.0 |

The Italian extract holds 541,641 records, and 454,374 of them are inflected forms. A lemma becomes
an entry; a form becomes one row in the form index.

The English extract is 779 MB. The build keeps three things from it per headword and part of speech:
the word, the part of speech, and up to three short glosses. It joins them to the Italian entry by
headword and part of speech, and ships nothing else.

## What ships

| Measure | Value |
|---|---|
| Entries | 61,820, every one with at least one Italian definition |
| Entries with IPA | 56.6% |
| Senses | 91,744 |
| Forms that resolve to a lemma | 232,248 |
| Verbs | 6,325, of which 5,471 carry a full table |
| Tatoeba sentences | 49,283, in 49,505 example slots |
| Entries with an English translation | 47,277 of 61,820, which is 76.5%. Of the 5,000 most frequent, 4,728, or 94.6% |
| Buckets and entry files | 478 buckets, 948 entry files |
| Entry files | 22,452,034 bytes, up 3,379,148 for the English glosses |
| Data size | 66,344,150 bytes in the manifest, of which 1,943,440 bytes is the English lookup index; largest file 999,999 bytes |

The other 14,543 entries carry no English gloss, and the Entry screen then draws no Translation
section. Coverage follows the part of speech: verb 95%, adverb 97%, pronoun 90%, noun 84%, adjective
84%, proper name 43%, preposition 46%, phrase 0.2% (10 of 4,801), abbreviation 0 of 631.

**Known gap:** the English extract holds almost no multiword Italian records. An idiom or a phrase
therefore ships with Italian definitions only. A phrase in the dictionary is worth reading in Italian,
and it has no English line above it.

CEFR bands, by entry: a1 670, a2 572, b1 1,489, b2 2,144, c1 5,028, c2 51,917.

## The licence split

- **Dictionary data**: CC BY-SA 4.0. The shards are a derivative of the Wiktionary text and keep that
  licence. See <https://it.wiktionary.org/wiki/Aiuto:Copyright>.
- **App code**: MIT. Separate licence, separate files, separate notice. The `LICENSE` file is not on
  disk yet.
- **English glosses**: CC BY-SA 4.0, the same licence as the Italian text, from en.wiktionary. They
  are stored inside the entry body, next to the Italian senses, and no Tatoeba text is in that file.
- **Examples**: CC BY 2.0 FR. They ship in their own file set. An entry body stores example
  positions, never sentence text, so no Tatoeba sentence lands in a CC BY-SA shard.
- **The frequency list**: CC BY-SA 4.0. Only the derived band value ships. The word list itself does
  not.

## Required attribution

- Dictionary text, near each entry:
  `Testo da Wikizionario, it.wiktionary.org, CC BY-SA 4.0 - <url voce>, modificato`
- English glosses, near the Translation section or once site-wide:
  `Glosse in inglese da Wikizionario, en.wiktionary.org, CC BY-SA 4.0, modificato.`
- Examples, once site-wide:
  `Frasi da Tatoeba (tatoeba.org), CC BY 2.0 FR`, with a link to <https://tatoeba.org/>.

The build writes the strings into `NOTICE` and `data/LICENSE-DATA.md`, so the notice cannot drift
from the licence table. The About screen shows the Wikizionario and Tatoeba lines today. It does not
show the en.wiktionary line yet, and that line is required, because a CC BY-SA work needs its
attribution wherever it is used.

## Exclusion

27 pages on it.wiktionary are flagged for an unchecked copyright claim, and they must not ship. The
category is
<https://it.wiktionary.org/wiki/Categoria:Da_controllare_per_copyright>. The build reads the list into
`tools/data-exclusions.json`, drops a record whose headword is on it, and `npm run check` fails if
an excluded headword ships.

## Entry ids are per build

An entry id is `<bucket>:<index>`, a position in the shard of one build. It is stable within a build
and it carries its own location, so a cold deep link reads one entry file.

It is not stable across builds. The id is the file name and a position inside that file, so a
different split moves every position in the file, and a word's id changes with it. A stored id names
a place in one build, not a word.

Saved notes, list items and history keep the id they wrote. A rebuild is safe for saved data: nothing
is corrupted, and nothing crashes. An id the new build does not have resolves to no entry body, and
the app then shows the id in place of the word. So a rebuild may lose the word text on rows saved
before it, and a stored id can name a different word:

- a study card, a note and a list item keep their id, and the word behind it can change;
- a bookmarked `#/entry/<id>` link can open another entry, or show the id.

A list item keeps the word text it stored, so its name survives even when its link does not.

The build is the unit of the mapping. Keeping progress across a rebuild would need a stable key, such
as the headword and the part of speech, and that is a decision for a later ADR.

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
