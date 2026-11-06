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

import { foldWord, pickFiles } from './data.js';

/** @typedef {import('./data.js').Row} Row */
/** @typedef {{ id: string, headword: string }} Match */
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

/**
 * Count the words, the distinct words the dictionary knows, and the distinct words it does not,
 * most frequent first. The counts of known and unknown words are distinct words, the way a
 * reader studies a text; `total` counts every occurrence.
 *
 * @param {Segment[]} segments
 * @param {Map<string, Match | null>} resolved folded word -> its entry, or `null`
 * @returns {{ total: number, known: number, unknown: Array<{ word: string, count: number }> }}
 */
export function summarise(segments, resolved) {
  let total = 0;
  /** @type {Set<string>} */
  const known = new Set();
  /** @type {Map<string, { word: string, count: number }>} */
  const unknown = new Map();
  for (const segment of segments) {
    if (!segment.word) continue;
    total += 1;
    const folded = foldWord(segment.text);
    if (resolved.get(folded) != null) {
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

  /** @type {Map<string, Promise<Map<string, Match>>>} */
  const headwords = new Map();
  /** @type {Map<string, Promise<Map<string, Match>>>} */
  const lemmas = new Map();

  /**
   * One promise per file, kept. A failure is dropped, so a later word can try again.
   * @param {Map<string, Promise<Map<string, Match>>>} cache
   * @param {string} path
   * @param {() => Promise<Map<string, Match>>} load
   * @returns {Promise<Map<string, Match>>}
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
    const manifest = await data.manifest();
    const bucket = manifest.buckets[folded.slice(0, 2)] ?? manifest.buckets[folded.slice(0, 1)];
    if (bucket === undefined) return '';
    const file = pickFiles(bucket[kind], folded)[0];
    return file === undefined ? '' : file.path;
  }

  /**
   * One entry id for one folded word, or `null`. The first row of a folded form wins; the reader
   * needs one link, not a homograph list.
   * @param {'search' | 'forms'} kind
   * @param {string} folded
   * @returns {Promise<Match | null>}
   */
  async function lookup(kind, folded) {
    const path = await fileOf(kind, folded);
    if (path === '') return null;
    const cache = kind === 'search' ? headwords : lemmas;
    const map = await memo(cache, path, async () => {
      /** @type {Map<string, Match>} */
      const built = new Map();
      if (kind === 'search') {
        for (const row of await data.rows(folded)) {
          if (!built.has(row.folded)) built.set(row.folded, { id: row.id, headword: row.headword });
        }
      } else {
        for (const [form, hit] of await data.forms(folded)) built.set(form, { id: hit.id, headword: hit.lemma });
      }
      return built;
    });
    return map.get(folded) ?? null;
  }

  /**
   * The lookups for one token, in order: the whole token, the part after an apostrophe, then the
   * part before it. `l'acqua` resolves through `acqua`; `un'idea` through `un`.
   * @param {string} folded
   * @returns {string[]}
   */
  function partsOf(folded) {
    const cut = folded.search(APOSTROPHE);
    if (cut < 1) return [folded];
    return [folded, folded.slice(cut + 1), folded.slice(0, cut)].filter((part) => part !== '');
  }

  /**
   * @param {string} folded
   * @returns {Promise<Match | null>}
   */
  async function one(folded) {
    for (const part of partsOf(folded)) {
      try {
        const headword = await lookup('search', part);
        if (headword !== null) return headword;
        const lemma = await lookup('forms', part);
        if (lemma !== null) return lemma;
      } catch {
        // A file that did not load is read as unknown; the text still draws.
      }
    }
    return null;
  }

  return {
    /**
     * Resolve every distinct word once.
     * @param {Segment[]} segments
     * @returns {Promise<Map<string, Match | null>>} folded word -> its entry, or `null`
     */
    async read(segments) {
      /** @type {Set<string>} */
      const wanted = new Set();
      for (const segment of segments) if (segment.word) wanted.add(foldWord(segment.text));
      /** @type {Map<string, Match | null>} */
      const resolved = new Map();
      await Promise.all(
        [...wanted].map(async (folded) => {
          resolved.set(folded, await one(folded));
        }),
      );
      return resolved;
    },
  };
}
