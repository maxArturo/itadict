# itadict

A static, offline, mobile-first Italian dictionary PWA. It runs on GitHub Pages at
`https://maxarturo.github.io/itadict/`, installs to a home screen, and works with no network and no
server. The display name is "Italian".

It is a 1:1 copy of the App Store app "Japanese" (id290664053, renzo Inc.), for Italian. The chrome
is English. The dictionary content is monolingual Italian: Italian headwords, Italian definitions,
Italian examples.

`AGENTS.md` indexes every document. The expensive-to-reverse decisions live in `docs/adr/`. This
README holds what cannot be read off the source: the purpose, the two substitutions, the data and
licence statement, and the frozen decisions.

## Screens

Bottom tabs: Search, Text, Reference, Lists, Study.

- **Search** — a search field and a three-mode input switch. Rows show the headword, a small
  pronunciation line and one grey definition line.
- **Entry** — back control, the entry name in the nav bar, the large headword and its pronunciation,
  then TRANSLATION, then a related forms section (conjugation), then EXAMPLES with the matched word
  highlighted.
- **Lists** — History and Notes pinned on top, then folders and lists with an icon, a name and an item
  count, plus add and more controls. Settings is the top-left control on this screen.
- **Reference** — catalogue rows: alphabet and pronunciation, verbs, parts of speech, fields, CEFR.
- **Study** — a full-screen flashcard, a progress bar with the grade and the remaining count, swipe
  right or left to grade, tap the headword to open the entry, a note field in the card.

## Two substitutions

Two features of the reference app cannot be copied as they are. Both have a replacement, and the
replacement is the decision.

| Reference app | Here | Why |
|---|---|---|
| Handwriting input, drawn on the screen and recognised | A spell-it-by-ear palette: tap kana-like sound groups to build a word, plus a plain keyboard and a voice-free fallback | Latin script needs no stroke recognition. An Italian learner spells a word he hears; the palette is that act, with no recogniser and no model download. |
| JLPT levels N5 to N1 | CEFR bands A1 to C2 | JLPT grades Japanese; CEFR is the scale Italian learners and courses already use. |

CEFR bands are approximate. No open CEFR list for Italian exists, so a band comes from a frequency
rank table calibrated on De Mauro vocabulary sizes. The UI must say so wherever a band is shown. A band
is a filter, never a claim about a word.

## Data and licences

Two sources, two licences, and they never meet in one file.

| Source | What it gives | Licence |
|---|---|---|
| kaikki.org extract of it.wiktionary, dump 2026-11-01 | headwords, definitions, IPA, inflected forms | CC BY-SA 4.0 |
| Tatoeba Italian sentences | example sentences | CC BY 2.0 FR |

- **Dictionary data** is CC BY-SA 4.0 and the shards are a derivative of it. Attribution near each
  entry: `Testo da Wikizionario, it.wiktionary.org, CC BY-SA 4.0 - <url voce>, modificato`.
- **App code** is MIT. Separate files, separate notice, never mixed with the data licence.
- **Examples** are CC BY 2.0 FR and ship in their own file set. An entry body stores example ids, never
  example text, so no Tatoeba sentence lands in a CC BY-SA shard.
- 27 pages flagged for an unchecked copyright claim are excluded. The list is the category
  `Da controllare per copyright` on it.wiktionary, read at build time.
- CEFR bands come from a frequency table. The order is defensible; the label is approximate, and the
  UI says so.

See `docs/adr/0001-data-and-licences.md` for the full rule.

## Frozen decisions

- Static files. No framework, no bundler, no runtime dependency. Node runs in `tools/` only.
- Hash routes only. Every URL relative. The `/itadict/` subpath is frozen. `.nojekyll` sits at the
  root.
- One hand-written `sw.js`. The shell is precached. Content shards are cached forever, keyed by their
  content hash. The manifest is stale-while-revalidate. A navigation falls back to `index.html`.
- Content is sharded by two folded letters of the headword, sub-sharded when a bucket is fat.
  Maximum 1 MB per file, under 150 MB in total, one manifest at `data/index.json`.
- Data and code carry separate licences. A CC BY-SA shard never holds Tatoeba text.
- `localStorage` holds one key, `itadict`, shaped `{ v, data: { ... } }`, with one
  `migrate(v, data)` chain.
- Search is prefix and accent-insensitive. Ranking is exact, prefix, inflected form, fuzzy. A search
  by a conjugated form resolves to its lemma.
- Offline is an explicit action. The app never downloads the whole dictionary at boot.
- A home-screen install is the durable state. A browser tab may lose its offline copy after 7 days
  without use, because that is when Safari clears site caches.

## Language

Placeholder. Filled when the code names its parts. Terms this app will need, at least: headword,
entry, sense, example, form, lemma, shard, bucket, manifest, search row, list, note, card, grade.

Rules to keep:
- One word per thing, and the same word in docs, code and UI.
- An Italian word is never a code name. Code names are English.
- "Entry" means one dictionary article. "Row" means one line in a result list.

## Open

- The Text tab has no content source yet. It is a screen, not a feature.
- The Study scheduling rule is not decided.
