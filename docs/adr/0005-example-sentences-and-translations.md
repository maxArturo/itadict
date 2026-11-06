# Example sentences: the sentence page and its English

Status: decided, not built. B1 (data) and B2 (UI) at the end are the work. Example counts and bytes
marked _see build log_ come from the B1 build, and the B1 change writes them in.

Every example row on the Entry screen opens a sentence page. The page shows the whole Italian
sentence and its English, and every word in it opens that word's entry. Every shipped example ships
with its English, and that English is always a human translation from Tatoeba. It is built ahead of
time and lives in `data/`. The app never asks a model, never fetches a translation on demand, and
never fills one in at run time.

## The English is human, from Tatoeba

The English of an example is a Tatoeba English sentence linked directly to the Italian one in
`ita-eng_links`. There is no machine translation: no model, no cache, no runner, no flag in the row
and no label in the UI. See "Rejected: machine translation".

## Selection

The candidates for a headword are the Tatoeba sentences that contain it as a token and are at most
`MAX_EXAMPLE` (120) characters, in corpus order. That is today's rule. The new rule is link-first:

1. A candidate with a human English translation that fits `MAX_EXAMPLE_EN` stays a candidate.
2. A candidate without one is dropped at selection.
3. The first `MAX_EXAMPLES` (3) candidates left, in corpus order, become the examples.

### Capitalised headwords

A token matches a lowercase headword in any case, as before. A capitalised headword, one whose first
letter is uppercase, is a name or an acronym: `SUA`, `Nella`, `Pesci`, `API`. It matches only its exact
spelling, and never as a token that starts a sentence: the first token, or one after `.`, `!`, `?` or
`…`. A capital after a full stop is grammar, not meaning, so `Nella bacinella` is not the name Nella
and `Le api` is not API.

The first version skipped only the first token. Extending it to every sentence start caught five
more rows where a second sentence inside one Tatoeba row opens with the word: `Crostacei` and
`Molluschi` ("Hai mangiato dei frutti di mare? Crostacei, diciamo."), `Giusto` ("OK. Giusto."),
`Loro` ("…paura dei mostri? Loro sono…") and `Viva` ("Viva il Brasile! Viva la democrazia!").

Rejected: allowing a sentence-initial match when the lowercase form is not a headword. It would
readmit `Nella bacinella`, because lowercase `nella` has no entry.

The cost: 358 capitalised entries lose all their examples, which brings the total to 6,113. A wrong
example under a name (`la sua età` under SUA) is worse than none. Before this rule, 402 of the 976
capitalised entries with examples showed only sentences about another word. After it, 618 have
examples and none of them is wrong.

A scan note, so a later run does not chase them: the review scan still flags `Gesù`, `Noè` and
`Perù`. These are false alarms from its ASCII `\b` on a final accented letter ("disse Gesù.",
"l'arca di Noè?", "il Perù, vero?"). Real suspects: 0.

So a headword whose candidates lack English gets fewer examples, or none, and the Entry screen then
hides its Examples section, as it does today for an entry with none.

| Measure | Value |
|---|---|
| Sentences with no human English among today's examples | 14,244 measured, the gap that MT would have filled |
| Entries that lose every example | 6,113 of the 19,655 that had examples before. See "The coverage cost" |
| Example slots, sentences and rows after the change | 33,450 slots, 28,985 distinct sentences, 33,329 rows. 13,542 entries have an example |

## The English cap

`MAX_EXAMPLE_EN` is **160** characters. `tools/build-data.mjs` and `tools/check-data.mjs` hold the
same constant.

A translation is never cut. A shortened sentence is a wrong translation. The build takes the human
translation with the lowest Tatoeba English id that fits the cap. A sentence with several English
links keeps the same choice from one build to the next, because a new translation gets a higher id.
When no human translation fits, the sentence is dropped at selection and the next candidate takes
its slot.

### When a sentence can be dropped

Only in the selection, and only before the example positions are assigned. The build drops a
candidate for the reasons above: the Italian over `MAX_EXAMPLE`, or no human translation that fits
`MAX_EXAMPLE_EN`. Then it assigns positions over the rows that remain and writes them. After that
step no row is dropped, by the build or by the client.

So the two rules do not conflict. "Drop if too long" acts on candidates, before a position exists.
"Never drop a row" acts on the written file: the client reader keeps one element per row, even a
bad one, so position `n` in an entry body always names row `n` of its ex file.

The UI never breaks on a long line. The Entry row clamps the English to two lines. The sentence page
wraps it in full with `overflow-wrap: anywhere`.

## The row shape

The English goes into the `ex` row. There is no new file set.

```
[sentenceId, it, en]
```

- Exactly three elements, always. `en` is a human Tatoeba translation.
- `sentenceId` stays the Tatoeba id of the Italian sentence, a string of digits. There is no second id.
  The English sentence's own id does not ship.
- The rows keep their order, ascending by numeric id, and the entry body keeps its positions. Nothing
  in `data/entry/` changes.
- `en` is never empty in shipped data. `npm run check` fails on any row whose English is empty or
  missing, and the build throws before it writes one. An empty English is a build bug, not a state
  the app supports.
- The reader is tolerant and the gate is strict, on purpose, and only for legacy two-element rows.
  The reader reads a two-element row, or a missing or empty `en`, as `en: ''`, and the UI hides the
  English line. `npm run check` accepts exactly three elements and a non-empty `en`. Nobody aligns the
  reader to the gate: the gate keeps bad data from shipping, and the reader keeps old data from
  breaking the app.

### Who owns the reader

B2 owns the example reader in `js/data.js`: the `Example { id, it, en }` type, `parseExamples`,
`examples(bucket)` returning `Example[]`, `sentence(bucket, sentenceId)` and
`exampleBucket(entryId)`. B1 builds `data/ex/` to match that reader and does not edit `js/`.

### Inline, not a side file

| | Inline in `data/ex/` (chosen) | A side file set, `data/exen/<bucket>.json` |
|---|---|---|
| Entry tap | one ex file, larger | one ex file, unchanged. The Entry row cannot show English without a second fetch |
| Sentence page, from Entry | no fetch: the ex file is in the memo | one more file |
| Cold sentence link | manifest, one ex file | manifest, two files |
| Manifest | the same shape | 317 more file records, about 30 KB, read before the first search |
| Licence | one file set, one licence, CC BY 2.0 FR | the same, in two places |
| Positions | one list | two lists that must stay aligned |

### Bytes and caps

Measured before the change: 317 ex files, 3,152,130 bytes, 90th percentile 28,983, largest
`data/ex/co.json` at 163,261 bytes. 49,283 rows hold 43,053 distinct sentences, because 4,919
sentences serve more than one bucket. Italian length: median 41, 90th percentile 85, 99th percentile
115 characters.

A row grows by its English plus 3 bytes of quoting. Fewer rows ship, because link-first selection
drops the sentences without English. So an ex file is at most about twice today's size: the largest
under about 330,000 bytes, against `MAX_FILE` 1,000,000, and the total far under `MAX_TOTAL`
150,000,000. Measured: the ex set is 3,314,114 bytes in 292 files, the largest `data/ex/co.json` at
169,412, and the whole set 66,388,672 bytes in that build (66,703,466 once the form index kept
raw spellings). An ex file still cannot split, because a split
shifts positions. The build fails instead, as it does today.

## Licences and attribution

- The English is a Tatoeba sentence, CC BY 2.0 FR, the same licence as the Italian. The ex file set
  keeps one licence. ADR 0001's rule holds: no CC BY-SA text is in that file set, and no Tatoeba text
  is in a CC BY-SA file.
- One attribution line covers both languages. It replaces the line in ADR 0001:
  `Frasi e traduzioni da Tatoeba (tatoeba.org), CC BY 2.0 FR`, with a link to <https://tatoeba.org/>.
  The build writes it into `NOTICE` and `data/LICENSE-DATA.md`, `npm run check` fails when it is
  missing, and the About screen shows it on the Tatoeba row.
- The manifest's `sources` gains two records, both CC BY 2.0 FR: the Tatoeba English sentences
  (`https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2`) and the Tatoeba
  Italian-English links (`https://downloads.tatoeba.org/exports/per_language/ita/ita-eng_links.tsv.bz2`).

## The coverage cost

Human-only English costs examples, and the ADR accepts that cost as the base case.

| Measure | Value |
|---|---|
| Entries with examples before link-first selection | 19,655 |
| Entries with examples after it | 13,542 |
| Entries that lose every example | 6,113 |
| Entries that go from 3 examples to 2 or 1 | 2,185 |
| Entries with fewer examples | 8,840. No entry gains one |
| Example rows | 49,283 before, 33,329 after |
| Italian Tatoeba sentences with a usable English link | 650,272 of 990,954, 65.6% |

The 65.6% is the ceiling, and it is the reason for the loss. A sentence with no direct English link
cannot ship, however the selection is ordered.

Decided: the English comes from direct `ita-eng` links only. Pivot-language chains and a longer
Italian cap were measured and rejected. See "Rejected: pivot translations and a longer Italian cap".

## Rejected: pivot translations and a longer Italian cap

All numbers in this section are **measured, rejected**. Do not redo the work. Do not re-add either
option without the user's approval.

**Pivots.** A pivot is a two-hop human chain, Italian to another language to English. The rule that
was measured: the shortest chain first, so a direct link beats a two-hop chain, and a chain never has
more than two hops. Then the pivot language with the most Italian links. Then the lowest English id.
Measured, rejected:

| Measure | Value |
|---|---|
| Emptied entries rescued | 1,105 of 5,755 (measured before the capitalised-headword rule), 8 of them in the 5,000 most frequent |
| Example slots restored in those entries | 1,419 |
| Partial entries topped up | 966, with 1,127 more slots |
| Entries still empty | 4,553, 14 of them in the 5,000 most frequent |
| Cost | a committed table of 225 KB and 2,431 lines, or 8.8 MB of per-language link files read on every build |

**A 160-character Italian cap**, in place of `MAX_EXAMPLE` (120). Measured, rejected: it rescues 94
entries.

**Why.**

- A pivot is written by a human, but it carries no label. Meaning drifts across two hops, and the
  user cannot see it. A wrong row that claims to be a real translation is worse than no row.
- Each option adds a new input, a new rule and a spot check, and together they recover about 19% of
  the loss.
- The blind spot check of pivot rows was cancelled before it gave a verdict. An example from the
  skim: `Tu sei villano` became `You are naughty`.

**The way back to coverage** is one labelled build-time model run over one sentence for each entry
that is still empty. It needs the user's approval, because it would send the corpus to an external
service. Keeping pivots out of the build leaves that option open, because no unlabelled
second-hand row competes with it.

## Rejected: machine translation

Machine translation was measured and rejected. Do not re-add it without the user's approval.

- The gap: 14,244 example sentences have no human English.
- `Helsinki-NLP/opus-mt-it-en` at revision `42556a0`: a blind spot check of 50 rows that would have
  shipped found 19 wrong, against a limit of 2.
- DIETA (Kasela et al., CLiC-it 2025) against opus-mt, blind pairs on 40 sentences: DIETA won 14,
  opus-mt won 10, 16 tied, and both were wrong on 4. DIETA would take about 15 hours on CPU, and its
  repo has no licence for its code or its weights.

A stronger model run at build time is the one possible follow-up, as above: labelled, one sentence
for each still-empty entry, and only with the user's approval.

## The route

`#/sentence/<bucket>/<sentenceId>`, for example `#/sentence/ca/4507`.

- `<bucket>` is the key of the manifest bucket whose ex file holds the row: `[a-z0-9_]{1,2}`, as the
  manifest has keys like `e_` and `__`. From an entry id it is `bucketOfId(id).slice(0, 2)`.
- `<sentenceId>` is the Tatoeba id, `\d{1,10}`.
- The parsed route is `{ name: 'sentence', id: '<bucket>:<sentenceId>' }`, the same `file:key` shape
  as an entry id. The router parses eight routes.

Rejected: `#/sentence/<sentenceId>` alone. A cold link would need an id-to-bucket table: 43,053 ids,
about 700 KB as shards at 16 bytes an id, and one more fetch before the sentence. Rejected too: `<entryId>/<position>`,
because both halves change on a rebuild.

**A rebuild.** The bucket key is a function of the headword's fold, and the sentence id is Tatoeba's,
so the link names the same thing in every build. It still resolves only while some entry in that
bucket keeps the sentence. The link-first selection changes the choice once, before any link exists. After that,
a link fails only when a selection change drops the sentence from the bucket. Then the page says
`This sentence is not in this version of the dictionary.` and links to
`https://tatoeba.org/sentences/show/<sentenceId>`.

**A cold deep link** costs the manifest and one ex file. It reads no entry file. The page draws the
Italian and the English from that row alone.

## The sentence page

| Part | What it draws |
|---|---|
| Back control | the same as Entry: `history.back()` when the app has a previous screen, otherwise Search |
| Italian | the whole sentence, 20 px, every word a tap target |
| Speaker | one button, only when an Italian voice exists, speaking the Italian |
| English | the whole Tatoeba English sentence, 17 px |
| Source | `Tatoeba #<id>`, linking to the sentence on tatoeba.org, opening outside the app |

A sentence is not an entry. Opening one adds nothing to `opened`, and its route does not change the
Back target of the next entry. At 900 px and wider it fills the detail pane, as Entry does.

States: the row is drawn; `This sentence is not in this version of the dictionary.`; or, when the ex
file did not load, `This sentence is not ready yet.`, the wording the other screens use for a miss.

### Word drilling

1. `tokenize(sentence)` from `js/text.js` splits the text. Every word segment becomes a
   `<button class="sentence-word">`. The plain runs between words stay text.
2. A tap resolves that word through the Text reader's path: `reader.word(text, context)` on
   `createReader`, the same `one()` lookup and memo the Text screen uses, with the word's place from
   `contexts()`: capitalised or not, first in its sentence or not. It gathers every candidate, each
   headword row that folds to the token and the lemma the forms index names, then the parts of an
   elided word. A token written with an accent first takes a forms record or a headword written
   exactly that way. Otherwise `pickCandidate()` in `js/text.js` chooses, in this order:
   - a name, abbreviation or symbol only for a capitalised token that is not first in its sentence,
     and then it wins; otherwise never, so lowercase `nella` is a miss, not the name Nella;
   - the more frequent entry, read as the earlier position within one entry file, since the build
     writes each file in frequency order. No frequency rank ships, so entries of two files are not
     compared;
   - a word before a name, then the first candidate found.

   The Text reader resolves each word in its own place through the same path, so a word opens the
   same entry on both screens.
3. A match navigates to `#/entry/<id>`. No match, or a file that did not load, runs a search for the
   word through the app's existing `onSearch`, which is `setQuery` then `#/search`.
4. A second tap before the first resolves wins. The first is dropped.

Words resolve on tap, not on draw. The page needs no known or unknown styling. On draw it fetches
nothing past its own ex file, and it works the same online, offline, and offline before a download.

**Elisions.** The tokeniser keeps `l'acqua` and `dell'anno` as one word, and the reader resolves
`acqua` and `anno`. The tap target is the whole token. The article or preposition before the
apostrophe has no target of its own. That is the Text reader's rule, kept on purpose so the two
screens agree. A trailing apostrophe (`po'`) is not part of the token.

**Forms with several lemmas.** The forms index holds one record per folded key, so a tapped form
resolves to one lemma. The build picks the first claim in the source whose gloss supports its lemma
and whose lemma ships: `fosse` goes to fossa. ADR 0004, Form to lemma, records why the most frequent
lemma was rejected. Folding merges spellings, so `è` and the conjunction
`e` share the key `e`. The record keeps the raw spelling, NFC, in `form` whenever it differs from the
key (`"e": { …, "lemma": "essere", "form": "è" }`), and the reader prefers that record when the
tapped token matches `form` exactly. 10,946 records carry it.

Follow-up, not built: one record per spelling, an array per key. Today a key whose spellings name
different lemmas keeps one of them, and 203 spellings are lost that way: `parti` (parte) under
`partì` (partire), `liberò` (libare) under `libero` (liberare), `rasò` (rasare) under `raso` (radere).

**Tap targets.** A word button is inline, with no background or border, and the text colour. The
dotted underline is on a span inside it, so the dots stop at the last glyph; they sit under the
descenders and do not skip them. The line box is 44 px tall: font 20 px, `line-height: 44px`, which
is Apple's minimum height.

The button's box is the whole target, so two targets never overlap. Three rules hold together:
every target is at least 24 px wide (WCAG 2.5.8), no two targets overlap, and a tap resolves to the
word whose glyphs are nearest, or to nothing, never to the other word.

- Every button has `min-width: 24px` with its text centred, and 0.1em of side padding taken back
  by a matching negative margin. 0.1em is below half of any text font's space, so neighbours never
  meet; the rest of the space is a dead gap of a few pixels.
- A word narrower than 24 px gets an outer margin, set when the sentence draws, of
  `(24 - glyph width) / 2 - 0.2em`, so its box stops short of the midpoint to a neighbour. The cost
  is visible: one-letter words have wider gaps, and dead gaps of 9 to 13 px sit between them.
- The paragraph's first word, when short, has no neighbour on its left: its target overhangs into
  the paragraph's 16 px padding, its text starts at the margin, and its right side keeps the
  normal word gap, stopping half a pixel short of the midpoint. Only the first word, because CSS
  cannot see where lines wrap, and only when the overhang stays inside the screen's edge.

`npm run verify:offline` checks the size, the overlap and the hit 1 px either side of each glyph
midpoint on a fixture row "a e i o". The width of a one-letter word under a thumb is a device check
in `docs/verification/gate-2.md`.

### The Entry row

The whole row becomes one link to its sentence page, not just the chevron. It draws the Italian with
the match in red, then the English in the muted colour, clamped to two lines, then the chevron. It keeps the 44 px minimum height.

## The cost of one tap

| Tap | Files fetched |
|---|---|
| Entry, as today | one entry file and one ex file, now about twice as large |
| An example row to its sentence page | none. The ex file is in the session memo |
| A word on the sentence page | at most two: the search file of the word's bucket, and the forms file when the word is not a headword. None when this session already read them |
| That word's entry | one entry file and one ex file, as any entry |
| A cold sentence link | the manifest and one ex file |

Search files today: 90th percentile 29,060 bytes, largest 110,776. Forms files: 90th percentile
107,870, largest 280,206.

## Offline

- Nothing new to cache. The ex files are in the download set and cached forever under their hashed
  URLs. The rebuilt files arrive as new URLs, and the activate sweep removes the old ones.
- The download grows by the ex growth: 3,152,130 to 3,314,114 bytes, 161,984 more.
- No new module is planned. The page lives in `js/ui.js`, the route in `js/router.js`, the lookup in
  `js/data.js` and `js/text.js`. A pure helper split into its own file goes into `sw.js`'s `SHELL` list
  in the same change, or `npm run verify:offline` fails.
- `CACHE` in `sw.js` goes from `v1` to `v2`, as every deploy requires.

## Consequences

- Every shipped example has a human English translation from a direct `ita-eng` link. No shipped
  English is machine output or a pivot chain.
- 6,113 entries lose every example, and 2,185 drop from 3 examples to 2 or 1, because a sentence
  without English no longer ships, and a name or acronym no longer borrows the sentences of a
  lowercase word. See "The coverage cost".
- The ex half of an entry tap grows, the smaller half.
- The first build after this change changes the examples, so an example position in any saved state
  could name another sentence. Nothing stores example positions today.
- Bookmarked sentence links outlive rebuilds, unless a sentence leaves its bucket's selection.
- A rebuild can move entry ids. Saved schedules and `opened` hold ids only, while lists and notes
  hold the word too and fall back to it. The pinned split plan keeps this build at 0 moved ids: see
  [ADR 0003, Pinned split plan](0003-sharded-lazy-content-and-offline.md#pinned-split-plan).

## Open questions

1. **The numbers.** The example counts and the byte growth after link-first selection. The B1 change
   writes them in from the build log.

Pivots and a longer Italian cap are closed: measured, rejected. A labelled build-time model is not an
open question. It is a follow-up that waits for the user's approval.

## Checklist

### B1: data

| File | Change |
|---|---|
| `tools/build-data.mjs` | Add the two Tatoeba sources to `SOURCES`: `eng_sentences.tsv.bz2` and `ita-eng_links.tsv.bz2`. Read English text by id and the direct `ita-eng` links only, Italian id to English ids. No pivot language, no two-hop chain, and `MAX_EXAMPLE` stays 120. Add `MAX_EXAMPLE_EN` = 160. Replace the one-pass first-three pick with link-first selection: drop a candidate without a human translation that fits, then take the first three in corpus order. Choose the translation by the lowest English id that fits. Write rows as exactly `[id, it, en]`, and throw on an empty `en`. Add the two `sources` records. Update `licenceText()` with the Tatoeba line and the header comment's row shape. Print a summary line: examples, sentences, candidates dropped for no English, entries with examples |
| `NOTICE`, `data/LICENSE-DATA.md` | Written by the build: `Frasi e traduzioni da Tatoeba (tatoeba.org), CC BY 2.0 FR` |
| `tools/check-data.mjs` | A row is exactly `[id, it, en]`. `en` is a non-empty string, trimmed, with no line break, and at most `MAX_EXAMPLE_EN`. Ids ascend numerically and are unique per file. A sentence id in two buckets has the same `it` and `en` in both. NOTICE and `LICENSE-DATA.md` hold the Tatoeba line exactly. This gate is the strict side; the reader stays tolerant of legacy rows. The summary line prints examples and sentences |
| `js/`, none | B1 edits no file under `js/`. It builds `data/ex/` to the reader B2 owns, below |
| Proof | In a copy of `data/`, blank one `en`, then add a fourth element to another row. Run `npm run check` against each: it fails and names the row. Put the output in the change |
| Docs, same change | The README counts and its Data size line. ADR 0001's What ships table and the Tatoeba row. ADR 0003's byte lines. The architecture doc's ex shape `[[sentenceId, sentence]]`, its file-set table and its cost table. `docs/verification/gate-2.md`. Grep for `49,283`, `49283`, `49,505`, `[id, text]` and `[sentenceId, sentence]`, and fix every hit. Replace every _see build log_ here with the measured number |

### B2: UI

| File | Change |
|---|---|
| `js/data.js`, the example reader | `@typedef Example { id, it, en }`, with no `mt`. `parseExamples` returns `Example[]` and keeps one element per row, so a bad row never shifts a position. A legacy two-element row, or a missing or empty `en`, reads as `en: ''`. Elements past the third are ignored. `examples(bucket)` returns `Example[]`. `sentence(bucket, sentenceId)` returns `Example \| null` through the same memo. `exampleBucket(entryId)`: `bucketOfId(entryId).slice(0, 2)`. Update the header comment |
| `js/app.js`, Study | `load` reads `.it` of the first example |
| `js/router.js` | `RouteName` gains `'sentence'`. `parseRoute` accepts exactly four segments `['', 'sentence', bucket, sid]` with `/^[a-z0-9_]{1,2}$/` and `/^\d{1,10}$/`, and returns `{ name: 'sentence', id: bucket + ':' + sid }`. New export `sentenceHash(bucket, sentenceId)`. Update the header table: eight routes |
| `js/text.js` | `createReader` returns `word(text)`: fold, then `one(folded)`, as a `Promise<Match \| null>` |
| `js/ui.js` | `entryScreen`: each example is an `<a class="example" href>` from a new `sentenceHref(sentenceId)` option, drawing `.example-it` with the match, then `.example-en` with a two-line clamp, then the chevron. An empty `en` draws no English line. New `sentenceScreen({ load, sentenceId, speech, back, word, openEntry, onSearch })`: the parts, states and word buttons above, with the newest-tap guard. No MT tag or label anywhere |
| `js/app.js` | `entryView` passes `examples` as `Example[]` and `sentenceHref: (sid) => sentenceHash(exampleBucket(id), sid)`. New `sentenceView(route.id, back)`: `data.sentence(...)`, `word: reader.word`, `openEntry: (id) => router.navigate(entryHash(id))`, `onSearch` as Lists uses it. `renderRoute` handles `sentence` like `entry` for the two panes, and does not set `from` or call `addOpened` |
| `styles.css` | `.sentence-it`, `.sentence-word` (the 44 px line box, 24 px minimum width, 0.1em side padding with a matching negative margin, a focus ring), `.sentence-word-text` (the dotted underline), `.sentence-en` with `overflow-wrap: anywhere`, `.example-en` with `-webkit-line-clamp: 2` |
| About, in `js/ui.js` | The Tatoeba row carries `Frasi e traduzioni da Tatoeba (tatoeba.org), CC BY 2.0 FR` |
| `sw.js` | `CACHE` to `v2`. Add a new module to `SHELL` only if B2 creates one |
| `tools/sanity.mjs` | `parseExamples`: a three-element row, a two-element legacy row read with `en: ''`, a row with an extra element read as its first three, and a bad row in the middle that keeps the next row's position. `sentence()` finds by id, answers `null` for an unknown id and an unknown bucket, and shares one hashed fetch with `examples()`. `exampleBucket('com:1')` is `co`, and `exampleBucket('e_:0')` is `e_`. The router test now says eight routes. `#/sentence/ca/4507` parses. `sentenceHash` round-trips. These do not parse: `#/sentence`, `#/sentence/ca`, `#/sentence/ca/`, `#/sentence/ca/x1`, `#/sentence/CA/1`, `#/sentence/abc/1`, `#/sentence/ca/1/2`. `reader.word("l'acqua")` gives the `acqua` id, an unknown word gives `null`, and a failed file gives `null` |
| `tools/verify-offline.mjs` | Derive the fixture from `data/ex/ca.json`: the first row with the word `casa`, giving `sid`, `it` and `en`. Online, in the cold deep-link context, `#/sentence/ca/<sid>` draws `.sentence-it` equal to `it` and `.sentence-en` equal to `en`. After the download action and the offline relaunch, set the hash to the sentence and reload: it draws the Italian and the English, offline. Tap the `casa` word: `.entry-screen .headword` reads `casa`, offline. No page error |
| `docs/verification/gate-2.md` | Device rows: word targets on an iPhone, VoiceOver on a word button, and the long-English clamp |
| Docs, same change | The router line in AGENTS.md and the architecture doc: eight routes. The README Screens table gains a Sentence row, and Language gains **Sentence** (one Tatoeba sentence, its human English and its id). ADR 0002's route list. The architecture doc's route list, fetch table, cost table, and its gap 6 removed when it is built |
