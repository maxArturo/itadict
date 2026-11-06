// @ts-check
/**
 * Folding, matching and ranking, per ADR 0004.
 *
 * Ranking order is exact, then prefix, then inflected form, then fuzzy. The order is also the
 * budget: {@link rank} computes fuzzy only when the two cheap steps came up short, and
 * `createSearch` reaches for the forms index only when exact and prefix left room.
 *
 * Match costs one pass over one bucket. A keystroke after the first costs no fetch: the bucket is
 * already in memory and `js/data.js` keeps it.
 *
 * `shortcut: every match step scans the whole bucket; add a range index if a bucket passes ~50k
 * rows`.
 */

import { foldWord } from './data.js';

/** @typedef {import('./data.js').Row} Row */
/** @typedef {ReturnType<typeof import('./data.js').createData>} Data */
/** @typedef {ReturnType<typeof import('./storage.js').createStorage>} Storage */

/** The result cap. One screenful and a half, which is the point where a query reads as vague. */
export const LIMIT = 50;

/**
 * Fold one string for matching: NFD, drop the combining marks, lowercase. `perché` and `PERCHE`
 * both fold to `perche`. Display strings keep their accents; only keys are folded.
 *
 * It is the build's own fold, re-exported here: a row and a query cannot disagree about case or
 * accents, and a bucket key and a match cannot disagree either.
 */
export const fold = foldWord;

/**
 * Where a needle matches a haystack, by folding character by character, so an accented word
 * highlights at the right offset. This is what the Entry screen marks in an example.
 *
 * @param {string} haystack
 * @param {string} needle
 * @returns {{ start: number, end: number } | null} offsets into the unfolded haystack
 */
export function findMatch(haystack, needle) {
  const foldedNeedle = fold(needle);
  if (foldedNeedle === '' || haystack === '') return null;
  let folded = '';
  /** @type {number[]} the index in the haystack of each folded character */
  const map = [];
  for (let index = 0; index < haystack.length; index += 1) {
    const part = fold(haystack[index]);
    for (let k = 0; k < part.length; k += 1) {
      folded += part[k];
      map.push(index);
    }
  }
  const at = folded.indexOf(foldedNeedle);
  if (at < 0) return null;
  return { start: map[at], end: map[at + foldedNeedle.length - 1] + 1 };
}

/**
 * Levenshtein distance, abandoned once every path is longer than `max`. Returns `max + 1` when
 * the distance is above the budget, which the caller reads as "no match".
 *
 * @param {string} a
 * @param {string} b
 * @param {number} max
 * @returns {number}
 */
export function editDistanceAtMost(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    /** @type {number[]} */
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current[j] = value;
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * Ties inside one step: an exact case-and-accent match first, then the shorter headword, then the
 * row's rank from the extract, then the alphabet (so the order is stable).
 *
 * @param {string} query as typed, accents and case intact
 * @returns {(a: Row, b: Row) => number}
 */
function compareTies(query) {
  return (a, b) =>
    (b.headword === query ? 1 : 0) - (a.headword === query ? 1 : 0) ||
    a.headword.length - b.headword.length ||
    a.rank - b.rank ||
    (a.headword < b.headword ? -1 : a.headword > b.headword ? 1 : 0);
}

/**
 * The three steps that need no other file. Each list is sorted and unbounded: the caller takes
 * what it needs, because the inflected step slots in between.
 *
 * @param {Row[]} rows one bucket
 * @param {string} query
 * @param {number} [limit] the cap the fuzzy step is allowed to fill
 * @returns {{ exact: Row[], prefix: Row[], fuzzy: Row[] }}
 */
export function rank(rows, query, limit = LIMIT) {
  const folded = fold(query);
  if (folded.length < 2) return { exact: [], prefix: [], fuzzy: [] };

  /** @type {Row[]} */
  const exact = [];
  /** @type {Row[]} */
  const prefix = [];
  for (const row of rows) {
    if (row.folded === folded) exact.push(row);
    else if (row.folded.startsWith(folded)) prefix.push(row);
  }
  const tie = compareTies(String(query).trim());
  exact.sort(tie);
  prefix.sort(tie);
  if (exact.length + prefix.length >= limit) return { exact, prefix, fuzzy: [] };

  // Fuzzy is the only step that scans, so it runs only when the steps above came up short.
  const max = folded.length <= 4 ? 1 : 2;
  /** @type {Row[]} */
  const fuzzy = [];
  for (const row of rows) {
    const candidate = row.folded;
    if (candidate === folded || candidate.startsWith(folded)) continue;
    if (editDistanceAtMost(candidate, folded, max) <= max) fuzzy.push(row);
  }
  fuzzy.sort(tie);
  return { exact, prefix, fuzzy };
}

/**
 * The search pipeline: one bucket, the three cheap steps, and the forms index only when needed.
 *
 * A query of one character reads history, not the dictionary.
 *
 * @param {{ data: Data, storage: Storage, limit?: number }} options
 */
export function createSearch(options) {
  const { data, storage } = options;
  const limit = options.limit ?? LIMIT;

  /** Every row this session has shown, so an entry opens without a second fetch. @type {Map<string, Row>} */
  const known = new Map();


  return {
    /**
     * @param {string} query as typed
     * @returns {Promise<{ rows: Row[], history: string[] }>} rows, and the history to draw when
     *   the field is empty or holds one character
     */
    async search(query) {
      const text = typeof query === 'string' ? query.trim() : '';
      const folded = fold(text);
      if (folded.length < 2) {
        const history = storage.history();
        return { rows: [], history: folded === '' ? history : history.filter((entry) => fold(entry).startsWith(folded)) };
      }

      const { exact, prefix, fuzzy } = rank(await data.rows(folded), text, limit);

      /** @type {Row[]} */
      const rows = [];
      /** @type {Set<string>} */
      const seen = new Set();
      /** @param {Row} row */
      const push = (row) => {
        if (rows.length >= limit || seen.has(row.id)) return;
        seen.add(row.id);
        rows.push(row);
        known.set(row.id, row);
      };
      exact.forEach(push);
      prefix.forEach(push);

      // The forms set names the lemma of an inflected form. The lemma's own row is the row to
      // show, and the typed form goes on its secondary line. One more bucket fetch, cached.
      if (rows.length < limit) {
        let form = null;
        try {
          form = (await data.forms(folded)).get(folded) ?? null;
        } catch {
          // No forms set for this bucket yet; the cheap steps above stand.
        }
        if (form !== null) {
          const lemmaKey = fold(form.lemma);
          /** @type {Row | null} */
          let lemmaRow = null;
          try {
            lemmaRow = (await data.rows(lemmaKey)).find((row) => row.folded === lemmaKey) ?? null;
          } catch {
            // The lemma's bucket is not downloaded. The form still names the lemma.
          }
          if (lemmaRow !== null && !seen.has(lemmaRow.id)) push({ ...lemmaRow, matched: text });
        }
      }

      fuzzy.forEach(push);
      return { rows, history: [] };
    },
    /**
     * The row this session already showed for an id, or `null`.
     * @param {string} id
     * @returns {Row | null}
     */
    row: (id) => known.get(id) ?? null,
  };
}
