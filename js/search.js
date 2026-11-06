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

import { bucketFor, bucketOfId, foldWord, pickFiles, shardUrl } from './data.js';

/** @typedef {import('./data.js').Row} Row */
/** @typedef {ReturnType<typeof import('./data.js').createData>} Data */
/** @typedef {ReturnType<typeof import('./storage.js').createStorage>} Storage */

/** The result cap. One screenful and a half, which is the point where a query reads as vague. */
export const LIMIT = 50;

/**
 * The English trigger and cap. The English file is read only when the Italian list is shorter
 * than this, and the English block stops at this many rows.
 */
export const SHORT = 20;

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
 * alphabet (so the order is stable).
 *
 * @param {string} query as typed, accents and case intact
 * @returns {(a: Row, b: Row) => number}
 */
function compareTies(query) {
  return (a, b) =>
    (b.headword === query ? 1 : 0) - (a.headword === query ? 1 : 0) ||
    a.headword.length - b.headword.length ||
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
 * The entry ids an English bucket offers for one folded query: the exact token first, then the
 * tokens that start with it, in alphabet order, until the cap. Each token keeps the postings
 * order the build wrote. Junk is ignored.
 *
 * @param {Record<string, string[]>} tokens one English bucket
 * @param {string} folded the folded query
 * @param {number} [cap]
 * @returns {string[]}
 */
export function englishIds(tokens, folded, cap = SHORT) {
  /** @type {string[]} */
  const ids = [];
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {unknown} value */
  const add = (value) => {
    if (typeof value !== 'string' || value === '' || seen.has(value) || ids.length >= cap) return;
    seen.add(value);
    ids.push(value);
  };
  const exact = tokens[folded];
  if (Array.isArray(exact)) exact.forEach(add);
  if (ids.length < cap) {
    for (const token of Object.keys(tokens).sort()) {
      if (token === folded || !token.startsWith(folded)) continue;
      const list = tokens[token];
      if (Array.isArray(list)) list.forEach(add);
      if (ids.length >= cap) break;
    }
  }
  return ids;
}

/**
 * The search pipeline: one bucket, the three cheap steps, and the forms index only when needed.
 *
 * A query of one character reads history, not the dictionary. The English index is read only
 * when the Italian list is short, and it never mixes into that list.
 *
 * @param {{
 *   data: Data,
 *   storage: Storage,
 *   limit?: number,
 *   fetch?: (url: string) => Promise<{ ok: boolean, status?: number, json: () => Promise<unknown> }>,
 *   base?: string,
 * }} options
 */
export function createSearch(options) {
  const { data, storage } = options;
  const limit = options.limit ?? LIMIT;
  const base = typeof options.base === 'string' ? options.base : '';
  const doFetch =
    typeof options.fetch === 'function' ? options.fetch : (/** @type {string} */ url) => globalThis.fetch(url);

  /** Every row this session has shown, so an entry opens without a second fetch. @type {Map<string, Row>} */
  const known = new Map();

  /** One promise per English file URL, kept. A failure is dropped, so a later query can retry. */
  /** @type {Map<string, Promise<Record<string, string[]>>>} */
  const english = new Map();

  /**
   * One English file, read from its hashed URL so a rebuilt index is a new cache entry.
   * @param {string} url path plus `?v=<hash>`
   * @returns {Promise<Record<string, string[]>>}
   */
  function englishFile(url) {
    const hit = english.get(url);
    if (hit !== undefined) return hit;
    const promise = (async () => {
      const response = await doFetch(base + url);
      if (!response || response.ok !== true) throw new Error('itadict search: ' + url + ' did not load');
      const body = await response.json();
      return body !== null && typeof body === 'object' && !Array.isArray(body)
        ? /** @type {Record<string, string[]>} */ (body)
        : {};
    })().catch((error) => {
      english.delete(url);
      throw error;
    });
    english.set(url, promise);
    return promise;
  }

  /**
   * The English token map of a query's bucket, from the manifest's `en` set. A bucket with no
   * English set returns null: there is no file to read, and that is not an error.
   * @param {string} folded the folded query: it names the bucket and picks a split English file
   * @returns {Promise<Record<string, string[]> | null>}
   */
  async function englishTokens(folded) {
    const found = bucketFor(await data.manifest(), folded, 'en');
    if (found === undefined || found.en.length === 0) return null;
    const urls = pickFiles(found.en, folded).map(shardUrl);
    if (urls.length === 0) return null;
    const maps = await Promise.all(urls.map(englishFile));
    if (maps.length === 1) return maps[0];
    /** @type {Record<string, string[]>} */
    const merged = {};
    for (const map of maps) {
      for (const [token, ids] of Object.entries(map)) {
        if (Array.isArray(ids)) merged[token] = [...(merged[token] ?? []), ...ids];
      }
    }
    return merged;
  }

  /**
   * The rows of a list of ids, in that order. One read per bucket, and a missing row is skipped.
   * @param {string[]} ids
   * @returns {Promise<Row[]>}
   */
  async function rowsForIds(ids) {
    /** @type {Map<string, string[]>} */
    const byBucket = new Map();
    for (const id of ids) {
      const bucket = bucketOfId(id);
      if (bucket === '') continue;
      const list = byBucket.get(bucket);
      if (list === undefined) byBucket.set(bucket, [id]);
      else list.push(id);
    }
    /** @type {Map<string, Row>} */
    const found = new Map();
    await Promise.all(
      [...byBucket.keys()].map(async (bucket) => {
        try {
          for (const row of await data.rows(bucket)) found.set(row.id, row);
        } catch {
          // The English row is skipped; the block keeps the rest.
        }
      }),
    );
    /** @type {Row[]} */
    const out = [];
    for (const id of ids) {
      const row = found.get(id);
      if (row !== undefined) out.push(row);
    }
    return out;
  }


  return {
    /**
     * @param {string} query as typed
     * @param {{ whole?: boolean }} [options] `whole` searches a one-letter query as a whole word,
     *   for a word tapped on a sentence page; a typed letter still reads the history
     * @returns {Promise<{ rows: Row[], english: Row[], history: string[] }>} the Italian rows,
     *   the English block, and the history to draw when the field is empty or holds one character
     */
    async search(query, options = {}) {
      const text = typeof query === 'string' ? query.trim() : '';
      const folded = fold(text);
      const whole = options.whole === true && folded.length === 1;
      if (folded.length < 2 && !whole) {
        const history = storage.history();
        return {
          rows: [],
          english: [],
          history: folded === '' ? history : history.filter((entry) => fold(entry).startsWith(folded)),
        };
      }

      const bucketRows = await data.rows(folded);
      const { exact, prefix, fuzzy } = whole
        ? { exact: bucketRows.filter((row) => row.folded === folded), prefix: [], fuzzy: [] }
        : rank(bucketRows, text, limit);

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
          /** @type {Row | null} */
          let lemmaRow = null;
          try {
            lemmaRow = (await data.rows(fold(form.lemma))).find((row) => row.id === form.id) ?? null;
          } catch {
            // The lemma's bucket is not downloaded. The form still names the lemma.
          }
          if (lemmaRow !== null && !seen.has(lemmaRow.id)) push({ ...lemmaRow, matched: text });
        }
      }

      fuzzy.forEach(push);

      // The English index is a second read, only when the Italian list came up short. It stays a
      // separate block, so the two result lists never interleave.
      /** @type {Row[]} */
      let englishRows = [];
      // A whole-word search is an Italian word from a sentence: English matches are not asked for.
      if (rows.length < SHORT && !whole) {
        try {
          const tokens = await englishTokens(folded);
          if (tokens !== null) {
            englishRows = await rowsForIds(englishIds(tokens, folded, SHORT));
            for (const row of englishRows) known.set(row.id, row);
          }
        } catch {
          // The English file did not load; the Italian list stands.
        }
      }

      return { rows, english: englishRows, history: [] };
    },
    /**
     * The row this session already showed for an id, or `null`.
     * @param {string} id
     * @returns {Row | null}
     */
    row: (id) => known.get(id) ?? null,
  };
}
