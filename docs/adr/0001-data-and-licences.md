# Data and licences

Two sources, two licences, and the two never meet in one file. The dictionary text ships as
CC BY-SA 4.0. The app code ships as MIT. The example sentences ship under their own licence, in their
own file set.

## The sources

| Source | What it gives | Licence |
|---|---|---|
| kaikki.org extract of it.wiktionary, dump 2026-11-01 | headwords, definitions, IPA, inflected forms | CC BY-SA 4.0 |
| Tatoeba Italian sentences | example sentences | CC BY 2.0 FR |

The extract holds 541,641 records. 454,374 of them are inflected forms. About 58k are lemmas, and only
a lemma becomes an entry. A form becomes one row in the form index.

## The licence split

- **Dictionary data**: CC BY-SA 4.0. The shards are a derivative of the Wiktionary text and keep that
  licence. See <https://it.wiktionary.org/wiki/Aiuto:Copyright>.
- **App code**: MIT. Separate licence, separate files, separate notice. Never mix the two in one file
  or one claim.
- **Examples**: CC BY 2.0 FR. They ship in their own file set and are never merged into a shard that
  carries dictionary text. An entry body stores example ids only.

## Required attribution

- Dictionary text, near each entry and in Reference:
  `Testo da Wikizionario, it.wiktionary.org, CC BY-SA 4.0 - <url voce>, modificato`
- Examples, once site-wide on the About screen:
  `Frasi da Tatoeba (tatoeba.org), CC BY 2.0 FR`, with a link to <https://tatoeba.org/>.

Each source line is generated into `data/LICENSE-DATA.md` by the build, so the notice cannot drift
from the licence table. The About screen ships the same two lines.

## Exclusion

27 pages on it.wiktionary are flagged for an unchecked copyright claim. They must not ship. The
category is
<https://it.wiktionary.org/wiki/Categoria:Da_controllare_per_copyright>. The build drops a record whose
headword is a member of that category, and the count of dropped records goes into the manifest.

Membership changes over time, so the list is fetched at build time, never hardcoded as a word list.

## CEFR

No open CEFR list for Italian exists. Bands come from a frequency rank table (FrequencyWords `it_50k`,
data CC BY-SA 4.0), calibrated on the De Mauro vocabulary sizes. The resulting order is defensible:
a word that ranks higher in a large corpus is more likely to be taught earlier. The label is
approximate, and the UI must say so wherever a band is shown. A band is a filter, never a claim about a
word.

## Consequences

- A shard carries one licence. Any two-source merge would force the BY-SA licence onto Tatoeba text,
  which the CC BY 2.0 FR terms do not allow.
- Every attribution string is data, not copy written by hand in a screen. A licence change is one line
  in the build.
- The build must record what it changed: fields pruned, glosses cleaned and shortened, examples
  shortened and capped. That record is what `modificato` stands for.
- CEFR bands can be rebuilt from another frequency table without touching the app. Only the band value
  in a row changes.
