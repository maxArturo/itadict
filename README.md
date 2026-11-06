# itadict

A static, offline, monolingual Italian dictionary PWA. It runs on GitHub Pages at
`https://maxarturo.github.io/itadict/`, installs to a home screen, and needs no server. The display
name is "Italian".

It copies the screens and the flow of the App Store app "Japanese" (id290664053, renzo Inc.), for
Italian. The chrome is English. The content is Italian: Italian headwords, Italian definitions,
Italian examples.

`AGENTS.md` indexes every document. `docs/adr/` holds the decisions that are expensive to reverse.
`docs/design/architecture.md` holds the mechanics. `docs/verification/gate-2.md` holds the
acceptance record. This README holds the purpose, the differences from the reference app, the
licences, the frozen decisions and the language.

## How this differs from the reference app

1. **Monolingual.** The reference goes Japanese to English. This one stays in Italian, by decision.
   A learner reads the definition in the language he is learning.
2. **The count.** The reference lists 175,000 entries. This build ships 61,820 lemma entries and
   232,248 inflected forms. Two rules cap the source: the licences limit what can ship, and a
   monolingual dictionary counts lemmas, not translations.
3. **Handwriting became the letter palette.** Latin script needs no stroke recognition. The Search
   screen offers a keypad and a palette of Italian letters grouped by sound, and search ignores
   accents and case.
4. **JLPT became CEFR.** Bands A1 to C2 replace N5 to N1. No open CEFR list for Italian exists, so a
   band comes from a frequency rank. The order is defensible and the label is approximate, and the
   Study screen says so.
5. **Split View is a breakpoint.** Above 900 px the result list sits beside the entry. Below it,
   there is one screen at a time.

## Screens

| Screen | What it does |
|---|---|
| Search | A field with two input modes, keypad and letters. A row shows the headword, a form or the IPA, the part of speech and one gloss. |
| Entry (`#/entry/<id>`) | The back control to the screen you came from, the headword with its IPA, Translation, Forms, and Examples with the match in red. A speaker button appears only when an Italian voice exists. |
| Text | Paste Italian text. The screen shows a summary, the text with a link on every word the dictionary knows, and the words it does not know. |
| Reference | The alphabet catalogue and the parts-of-speech index. The screen is a placeholder in this build; its data module is in place. |
| Lists | Lists, folders, notes and the two portable file kinds. The screen is a placeholder in this build; the storage and the file shapes are in place. |
| Study | A deck picker: due today, history, and one deck per CEFR band. A card shows a headword, its sense and an example. Swipe right for remembered, left for forgot. Tap the headword to open the entry. A note field sits in the card. |
| Settings | Theme, text size, speech rate, storage size and backup. The screen is a placeholder in this build. |

The active tab is dark and the rest are grey. Study carries a badge with the number of cards due.

## Data and licences

| Source | What it gives | Licence |
|---|---|---|
| kaikki.org extract of it.wiktionary | headwords, definitions, IPA, inflected forms | CC BY-SA 4.0 |
| Tatoeba Italian sentences | example sentences | CC BY 2.0 FR |
| FrequencyWords Italian 50k list (Hermit Dave) | the rank that sets a CEFR band | CC BY-SA 4.0 |

The app code is MIT. The data and the code carry separate licences and never share a file.

| Measure | Value |
|---|---|
| Entries | 61,820, every one with at least one Italian definition |
| Entries with IPA | 56.6% |
| Senses | 91,744, 1.48 per entry |
| Inflected forms that resolve to a lemma | 232,248 |
| Verbs | 6,325, of which 5,471 carry a full table |
| Tatoeba sentences | 49,283, filling 49,505 example slots |
| Buckets | 478 |
| Data size | 60,067,433 bytes of file content, 62 MB on disk, largest file 999,990 bytes |

CEFR bands, by entry: a1 670, a2 572, b1 1,489, b2 2,144, c1 5,028, c2 51,917.

Attribution strings ship in `NOTICE` and in `data/LICENSE-DATA.md`. The build writes both, so a
licence change is one line of data.

- **Dictionary text**, near each entry: `Testo da Wikizionario, it.wiktionary.org, CC BY-SA 4.0 - <url voce>, modificato`.
- **Examples**, once site-wide: `Frasi da Tatoeba (tatoeba.org), CC BY 2.0 FR`, with a link.
- 27 pages of it.wiktionary are flagged for an unchecked copyright claim, and they do not ship. The
  list is the category `Da controllare per copyright`, read at build time.

An entry id is `<bucket>:<index>`. It names a position in one build, so a deep link can point at a
different word after a rebuild.

## Frozen decisions

- Static files. No framework, no bundler, no runtime dependency. Node runs in `tools/` only.
- Hash routes only. Every URL relative. The `/itadict/` subpath is frozen. `.nojekyll` sits at the
  root.
- One hand-written classic `sw.js`, with two caches. The shell cache dies on every deploy. The data
  cache lives, because every content URL carries its hash.
- Content is bucketed by two folded letters of the headword, and a fat bucket splits by a longer
  prefix. Maximum 1 MB per file, under 150 MB in total, one manifest at `data/index.json`.
- `localStorage` holds one key, `itadict`, shaped `{ v: 3, data: { ... } }`, with one
  `migrate(v, data)` chain.
- Search folds accents and case, ranks exact, prefix, inflected form, then fuzzy, and caps at 50
  rows. A search runs from two characters.
- Offline is an explicit action. The app never downloads the whole dictionary at boot.
- A home-screen install is the durable state. A browser tab may lose its offline copy after 7 days
  without use, because that is when Safari clears site caches.

## How to run

```
npm install              # the two devDependencies: typescript, playwright
npm run build:data       # build data/ from the cached sources
npm run check            # the structural gate over data/
npm test                 # the Node checks over js/
npm run verify:offline   # the headless browser gate over the deployed shape
```

To browse the app by hand, serve the parent directory so the subpath is real:

```
cd /home/max/Developer && python3 -m http.server 8000
# then open http://localhost:8000/itadict/
```

If the repo does not sit inside the served folder, put a symlink named `itadict` in the served
folder and point it at the repo. The URL must keep the `/itadict/` subpath, or a bad path never
shows up.

`file://` has no secure context, so the service worker never registers there.

## What a real device still owns

- Install from the home screen, and the standalone window it opens.
- The safe areas under a notch and the home indicator.
- The Italian voices that the speaker button offers.
- The 7-day storage eviction, which removes the offline copy of a browser tab.
- The maskable icon crop, and the status bar colour in both schemes.

## Language

One word per thing, and the same word in docs, code and UI.

**Entry**: one dictionary article: one headword, one build id of the form `<bucket>:<index>`, its
senses, forms and examples. _Avoid_: article, record, word.

**Headword**: the word as printed, accents kept.

**Sense**: one Italian definition under one part of speech.

**Part of speech**: the grammar class a sense sits under, such as verb or noun. The code field is
`pos`.

**Fold**: lowercase, then drop the accents: `perché` becomes `perche`. Fold is for matching only.
The display keeps its accents.

**Bucket**: the two folded letters a word sorts under. It is the sharding key and the search unit.

**Shard**: one file in the manifest. A bucket holds one shard per file set, and more when it splits.
_Avoid_: chunk, piece, part.

**File set**: one of the four kinds of file a bucket holds: search, entry, ex, forms.

**Manifest**: `data/index.json`. It lists every file, its size and its hash, plus the counts, the
sources and the CEFR deck sizes.

**Row**: one line in a result list: folded key, id, headword, IPA, part of speech, one gloss.

**Form**: one inflected form of a lemma.

**Lemma**: the entry a form belongs to.

**Deck**: one set of cards in Study: due today, history, or one CEFR band. _Avoid_: pack, stack.

**Card**: one study item, which is one entry id plus its schedule: step, ease, due, reps, lapses.

**Grade**: the one word a swipe writes, remembered or forgot.

**Run**: one pass through a deck, from the first card to the summary.

**Note**: the learner's own text on one entry, keyed by entry id.

**List**: the learner's own named collection of items. **Item** is one entry id and its word.

**Label**: one of the six tags a list carries: Verbs, Nouns, Phrases, Exam, Travel, Other.

**Folder**: the learner's own group of lists.

**Palette**: the letter keys on the Search screen, grouped by vowel sound.

**Download**: the action that fetches every data file for offline use.

## Open

- The Reference, Lists and Settings screens are placeholders in this build.
- The download action has no button yet. The function that runs it exists and its gate passes.
