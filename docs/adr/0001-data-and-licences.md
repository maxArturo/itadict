# Data and licences (stub)

Status: stub. Numbers and scopes are open until the data spike finishes. Do not quote a figure from
this file.

## Open questions

- Which kaikki.org dump of the Italian Wiktionary extract, and which fields are kept: headword, part
  of speech, definitions, examples, IPA, inflected forms.
- How one headword with several parts of speech becomes one entry or several. The entry screen has one
  TRANSLATION section, so the merge rule decides what goes in it.
- Which licence version and attribution text ships for the Wiktionary text, where the text is shown,
  and whether it must sit beside each entry or once in Reference.
- The ShareAlike side: the shards are a derivative of the Wiktionary text, the app code is not. Confirm
  the split, and whether the build scripts under `tools/` must ship.
- Tatoeba: the licence line for the sentences, whether each sentence needs a link back to its source
  id, and how many sentences the whole set adds in bytes.
- The sentence-to-entry link rule: which headword an example belongs to, how many examples per entry,
  and what happens when a sentence matches several.
- CEFR: is a level taken from a published list, or assigned by frequency band. The bands are
  approximate either way and the UI must say so.
- Pruning: how many rare senses, dialects and obsolete forms are dropped, and whether dropped content
  can come back without breaking saved notes.
- Counts, sizes, and the shard plan: headwords, shards, index bytes, total bytes.
