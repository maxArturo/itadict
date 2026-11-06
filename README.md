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

CEFR bands are approximate. They are assigned from a published list or from a frequency band, and the
UI must say so wherever a band is shown. A band is a filter, never a claim about a word.

## Data and licences

Placeholder. Filled after the data spike. See `docs/adr/0001-data-and-licences.md` for the open
questions.

- Headwords, definitions, IPA and verb forms: the kaikki.org extract of the Italian Wiktionary.
- Examples: Tatoeba Italian sentences.
- Licence text and attribution placement: to be written here, and shown in Reference.

No number in this section is final.

## Frozen decisions

- Static files. No framework, no bundler, no runtime dependency. Node runs in `tools/` only.
- Hash routes only. Every URL relative. The `/itadict/` subpath is frozen. `.nojekyll` sits at the
  root.
- One hand-written `sw.js`. The shell is precached. Content shards are cached forever, keyed by their
  content hash. The manifest is stale-while-revalidate. A navigation falls back to `index.html`.
- Content is sharded by the first letter of the headword, sub-sharded when a letter is fat. Maximum
  1 MB per file, under 150 MB in total, one manifest at `data/index.json`.
- `localStorage` holds one key, `itadict`, shaped `{ v, data: { ... } }`, with one
  `migrate(v, data)` chain.
- Search is prefix and accent-insensitive. Ranking is exact, prefix, inflected form, fuzzy. A search
  by a conjugated form resolves to its lemma.
- Offline is an explicit action. The app never downloads the whole dictionary at boot.

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
