// @ts-check
/**
 * The Text reader: tokenise pasted text, resolve a word to its entry, and summarise the result.
 *
 * This is not a search. A search matches one bucket and ranks rows; the reader asks a yes-or-no
 * question per distinct word and needs the entry id behind it. So it builds one folded map per
 * bucket, once, and answers every later word from memory.
 *
 * Word work stops at {@link WORD_CAP}. A 100k-character paste is a long article, not a test of the
 * app; beyond the cap the rest of the text is drawn plain and the screen says so.
 *
 * A word resolves through its file, not its bucket: a bucket over 1 MB splits into files named by
 * a longer prefix, and both sides choose the file the same way. An elided token such as
 * `l'acqua` resolves through `acqua`, and its link opens that entry.
 */

import { bucketFor, foldWord, pickFiles } from './data.js';

/** @typedef {import('./data.js').Row} Row */
/** @typedef {{ id: string, headword: string }} Match */
/**
 * One entry a token could open: a headword row that folds to the token, or the lemma the forms
 * index names for it. `form` is a forms record's written form, accents kept, or `''`; a headword
 * row has none.
 * @typedef {{ id: string, headword: string, pos: string, form?: string }} Candidate
 */
/** Where a token sits: capitalised, and first in its sentence. */
/** @typedef {{ capitalised: boolean, initial: boolean }} Context */
/** @typedef {{ text: string, word: boolean }} Segment */

/**
 * A paste stops at this many words. 2,000 words fills several screens and covers a full article;
 * the cap keeps a 100k-character paste from doing 18,000 bucket reads.
 */
export const WORD_CAP = 2000;

/**
 * A word is Unicode letters, with an apostrophe only between two letters: `l'acqua`,
 * `un'altra`. Digits and punctuation split words and are not words themselves.
 */
const WORD_SOURCE = "\\p{L}+(?:['\u2019]\\p{L}+)*";

/** A combining mark, once a word is in NFD: the word was written with an accent. */
const DIACRITIC = /\p{M}/u;

/** The apostrophes the tokeniser keeps inside a word. */
const APOSTROPHE = /['\u2019]/;

/**
 * Split a text into the words and the plain runs between them. Every segment keeps its exact
 * text, so the segments join back to the input and the screen draws it unchanged.
 *
 * @param {string} input
 * @returns {{ segments: Segment[], truncated: boolean }}
 */
export function tokenize(input) {
  const text = typeof input === 'string' ? input : '';
  /** @type {Segment[]} */
  const segments = [];
  const word = new RegExp(WORD_SOURCE, 'gu');
  let last = 0;
  let words = 0;
  /** @type {RegExpExecArray | null} */
  let match;
  while (words < WORD_CAP && (match = word.exec(text)) !== null) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index), word: false });
    segments.push({ text: match[0], word: true });
    last = match.index + match[0].length;
    words += 1;
  }
  let truncated = false;
  if (words === WORD_CAP) {
    word.lastIndex = last;
    truncated = word.test(text);
  }
  if (last < text.length) segments.push({ text: text.slice(last), word: false });
  return { segments, truncated };
}

/** The parts of speech that name a thing rather than a word of the language. */
const NAME_POS = new Set(['name', 'abbrev', 'symbol']);

/**
 * The entry position inside its file, from an id `<file>:<position>`. Two entries of one file are
 * in the build's frequency order, so their positions compare; entries of two files do not.
 * @param {string} id
 * @returns {{ file: string, position: number }}
 */
function placeOf(id) {
  const cut = id.lastIndexOf(':');
  return { file: id.slice(0, cut), position: Number(id.slice(cut + 1)) };
}

/**
 * Choose the entry a tapped word opens, from every candidate the dictionary has for it. The only
 * place this order lives; the Text reader and the sentence page both use it.
 *
 * 1. Capitalisation gate: a name, abbreviation or symbol is eligible only when the token is
 *    capitalised and not first in its sentence, and then it wins ("Nella" mid-sentence is the
 *    name). Otherwise it is never chosen, because a sentence-initial capital ("I miei…") and a
 *    lowercase token ("sua", "pesci", "nella") are ordinary words; with no word left it is a miss.
 * 2. Frequency: among what is left, the more frequent entry wins, because a learner meets the
 *    common reading first. No frequency rank ships, so this compares positions within one entry
 *    file only: the build writes each file in frequency order ("Faccia" is fare, fa:0, not the
 *    noun faccia, fa:5). Entries of two files are not compared. No part-of-speech list and no
 *    exceptions. Which lemmas are candidates is the forms index's choice, not this function's.
 * 3. Tie-break: when two entries sit in different files, a word beats a name, then the first
 *    candidate found wins, so the choice is stable.
 *
 * @param {Candidate[]} candidates
 * @param {Context} context
 * @returns {Candidate | null} `null` when nothing is eligible: the caller searches the token
 */
export function pickCandidate(candidates, context) {
  const named = (/** @type {Candidate} */ candidate) => NAME_POS.has(candidate.pos);
  const names = candidates.filter(named);
  const words = candidates.filter((candidate) => !named(candidate));
  const pool = context.capitalised && !context.initial && names.length > 0 ? names : words;
  if (pool.length === 0) return null;
  const indexed = pool.map((candidate, index) => ({ candidate, index }));
  indexed.sort((a, b) => {
    const left = a.candidate;
    const right = b.candidate;
    const one = placeOf(left.id);
    const two = placeOf(right.id);
    if (one.file === two.file && one.position !== two.position) return one.position - two.position;
    const kind = Number(named(left)) - Number(named(right));
    return kind !== 0 ? kind : a.index - b.index;
  });
  return indexed[0].candidate;
}

/**
 * Where each word of a text sits: capitalised or not, and first in its sentence. A sentence
 * starts the text and starts again after `.`, `!`, `?` or `…`.
 * @param {Segment[]} segments
 * @returns {Context[]} one per segment; a plain run's entry is unused
 */
export function contexts(segments) {
  /** @type {Context[]} */
  const out = [];
  let initial = true;
  for (const segment of segments) {
    if (!segment.word) {
      if (/[.!?\u2026]/u.test(segment.text)) initial = true;
      out.push({ capitalised: false, initial: false });
      continue;
    }
    const first = segment.text.charAt(0);
    out.push({ capitalised: first !== first.toLowerCase(), initial });
    initial = false;
  }
  return out;
}

/**
 * The key a word is resolved and counted under: NFC, lowercase, accents kept. Accents stay because
 * "è" and "e" are different words that fold alike; NFC makes a decomposed "è" (e + U+0300) the
 * same key as a composed one.
 * @param {string} text
 * @returns {string}
 */
export function wordKey(text) {
  return (typeof text === 'string' ? text : '').normalize('NFC').toLowerCase();
}

/**
 * The context {@link pickCandidate} acts on. Only one thing changes its answer: whether the token
 * is capitalised and not first in its sentence, which makes a name eligible.
 * @param {Context} context
 * @returns {Context}
 */
function gateOf(context) {
  return context.capitalised && !context.initial ? { capitalised: true, initial: false } : { capitalised: false, initial: false };
}

/**
 * The key one occurrence of a word is resolved under by {@link createReader}'s `read`: its
 * {@link wordKey}, marked when a name is eligible there. "Roma" mid-sentence and "roma" are two
 * keys; "Roma" at a sentence start and "roma" are one.
 * @param {string} text
 * @param {Context} context from {@link contexts}
 * @returns {string}
 */
export function readKey(text, context) {
  return wordKey(text) + (gateOf(context).capitalised ? '\u0001' : '');
}

/**
 * Count the words, the distinct words the dictionary knows, and the distinct words it does not,
 * most frequent first. The counts of known and unknown words are distinct words, the way a
 * reader studies a text; `total` counts every occurrence.
 *
 * @param {Segment[]} segments
 * @param {Map<string, Match | null>} resolved {@link readKey} -> its entry, or `null`
 * @returns {{ total: number, known: number, unknown: Array<{ word: string, count: number }> }}
 */
export function summarise(segments, resolved) {
  const places = contexts(segments);
  let total = 0;
  /** @type {Set<string>} */
  const known = new Set();
  /** @type {Map<string, { word: string, count: number }>} */
  const unknown = new Map();
  for (const [index, segment] of segments.entries()) {
    if (!segment.word) continue;
    total += 1;
    const folded = wordKey(segment.text);
    if (resolved.get(readKey(segment.text, places[index])) != null) {
      known.add(folded);
      continue;
    }
    const hit = unknown.get(folded);
    if (hit === undefined) unknown.set(folded, { word: segment.text, count: 1 });
    else hit.count += 1;
  }
  const list = [...unknown.values()].sort(
    (a, b) => b.count - a.count || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0),
  );
  return { total, known: known.size, unknown: list };
}

/**
 * Resolve words against the dictionary. The data client is injected, the way Search takes it, so
 * the reader has no fetch of its own and a Node check can hand it a map.
 *
 * @param {{ data: ReturnType<typeof import('./data.js').createData> }} options
 */
export function createReader(options) {
  const { data } = options;

  /** @type {Map<string, Promise<Map<string, Candidate[]>>>} */
  const headwords = new Map();
  /** @type {Map<string, Promise<Map<string, Candidate[]>>>} */
  const lemmas = new Map();

  /**
   * One promise per file, kept. A failure is dropped, so a later word can try again.
   * @param {Map<string, Promise<Map<string, Candidate[]>>>} cache
   * @param {string} path
   * @param {() => Promise<Map<string, Candidate[]>>} load
   * @returns {Promise<Map<string, Candidate[]>>}
   */
  function memo(cache, path, load) {
    let hit = cache.get(path);
    if (hit === undefined) {
      hit = load().catch((error) => {
        cache.delete(path);
        throw error;
      });
      cache.set(path, hit);
    }
    return hit;
  }

  /**
   * The file a folded key lives in, chosen the way js/data.js chooses it: the longest file prefix
   * the key starts with. A bucket over 1 MB keeps its rows and forms in several files.
   * @param {'search' | 'forms'} kind
   * @param {string} folded
   * @returns {Promise<string>} the file path, or `''` when the manifest has no bucket for the key
   */
  async function fileOf(kind, folded) {
    const bucket = bucketFor(await data.manifest(), folded, kind);
    if (bucket === undefined) return '';
    const file = pickFiles(bucket[kind], folded)[0];
    return file === undefined ? '' : file.path;
  }

  /**
   * Every candidate one file holds for one folded key: each headword row that folds to it, or the
   * lemma the forms index names for it. Each file is read into a map once.
   * @param {'search' | 'forms'} kind
   * @param {string} folded
   * @returns {Promise<Candidate[]>}
   */
  async function lookup(kind, folded) {
    const path = await fileOf(kind, folded);
    if (path === '') return [];
    const cache = kind === 'search' ? headwords : lemmas;
    const map = await memo(cache, path, async () => {
      /** @type {Map<string, Candidate[]>} */
      const built = new Map();
      /** @param {string} key @param {Candidate} candidate */
      const add = (key, candidate) => {
        const list = built.get(key);
        if (list === undefined) built.set(key, [candidate]);
        else list.push(candidate);
      };
      if (kind === 'search') {
        for (const row of await data.rows(folded)) add(row.folded, { id: row.id, headword: row.headword, pos: row.pos });
      } else {
        for (const [form, hit] of await data.forms(folded)) {
          add(form, { id: hit.id, headword: hit.lemma, pos: '', form: hit.form });
        }
      }
      return built;
    });
    return map.get(folded) ?? [];
  }

  /**
   * The lookups for one token, in order: the whole token, the part after an apostrophe, then the
   * part before it. `l'acqua` resolves through `acqua`; `un'idea` through `un`.
   * @param {string} token lowercase, accents kept
   * @returns {string[]}
   */
  function partsOf(token) {
    const cut = token.search(APOSTROPHE);
    if (cut < 1) return [token];
    return [token, token.slice(cut + 1), token.slice(0, cut)].filter((part) => part !== '');
  }

  /**
   * The entry one token opens: the first part with any candidate.
   *
   * A part written with a diacritic first looks for a forms record whose written form is that
   * part, and takes it over any headword: "è" and "e" fold to one key, and only the accent says
   * "è" is essere and not the conjunction. Next it looks for a headword written that way. Every
   * other part is ranked by {@link pickCandidate}.
   * @param {string} token lowercase, accents kept
   * @param {Context} context
   * @returns {Promise<Match | null>}
   */
  async function one(token, context) {
    for (const part of partsOf(token)) {
      /** @type {Candidate[]} */
      const candidates = [];
      for (const kind of /** @type {Array<'search' | 'forms'>} */ (['search', 'forms'])) {
        try {
          candidates.push(...(await lookup(kind, foldWord(part))));
        } catch {
          // A file that did not load is read as unknown; the text still draws.
        }
      }
      if (DIACRITIC.test(part.normalize('NFD'))) {
        const same = (/** @type {string | undefined} */ text) => (text ?? '').normalize('NFC').toLowerCase() === part;
        // A forms record written this way first, then a headword written this way: "à" is the
        // headword à, not a, though both fold to "a".
        const written = pickCandidate(candidates.filter((candidate) => same(candidate.form)), context)
          ?? pickCandidate(candidates.filter((candidate) => candidate.form === undefined && same(candidate.headword)), context);
        if (written !== null) return { id: written.id, headword: written.headword };
      }
      const pick = pickCandidate(candidates, context);
      if (pick !== null) return { id: pick.id, headword: pick.headword };
    }
    return null;
  }

  /** A token with no position to read: lowercase, mid-sentence. */
  const PLAIN = Object.freeze({ capitalised: false, initial: false });

  return {
    /**
     * Resolve one tapped word through the same memo and the same ranking as {@link read}. The
     * sentence page passes where the word sits, so a capital mid-sentence can open a name.
     * @param {string} text a word as the tokeniser cut it
     * @param {Context} [context] defaults to lowercase, mid-sentence
     * @returns {Promise<Match | null>} its entry, or `null` when the word or its file is missing
     */
    word(text, context = PLAIN) {
      const token = wordKey(text);
      return foldWord(token) === '' ? Promise.resolve(null) : one(token, context);
    },
    /**
     * Resolve every distinct word once per place it can sit, through the same lookup and the
     * same {@link pickCandidate} as {@link word}: a word opens the same entry in a pasted text as
     * on a sentence page, a name mid-sentence included.
     * @param {Segment[]} segments
     * @returns {Promise<Map<string, Match | null>>} {@link readKey} -> its entry, or `null`
     */
    async read(segments) {
      const places = contexts(segments);
      /** @type {Map<string, { token: string, context: Context }>} */
      const wanted = new Map();
      segments.forEach((segment, index) => {
        if (segment.word) {
          wanted.set(readKey(segment.text, places[index]), { token: wordKey(segment.text), context: gateOf(places[index]) });
        }
      });
      /** @type {Map<string, Match | null>} */
      const resolved = new Map();
      await Promise.all(
        [...wanted].map(async ([key, { token, context }]) => {
          resolved.set(key, foldWord(token) === '' ? null : await one(token, context));
        }),
      );
      return resolved;
    },
  };
}
