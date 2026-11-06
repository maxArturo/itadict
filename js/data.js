// @ts-check
/**
 * The data contract, in one place. The pipeline ships four file sets per bucket, and this module
 * is the only place that names them. When a path or a field moves, one function changes.
 *
 * ```
 * data/index.json
 *   {
 *     version, built, partial, bucketKey,
 *     sources: [{ name, url, licence, licenceUrl, bytes }],
 *     totals: { entries, forms, examples, bytes },
 *     buckets: {
 *       "<key>": {                        // lowercase, diacritics removed, first two letters or digits
 *         search: [{ path, bytes, hash }],   // rows: [folded, id, headword, pronunciation, gloss]
 *         entry:  [{ path, bytes, hash }],   // [{ id, word, pos, cefr, ipa?, senses, ex, conj? }]
 *         ex:     [{ path, bytes, hash }],   // { sentenceId: sentence }
 *         forms:  [{ path, bytes, hash }],   // { foldedForm: { lemma, label } }
 *       }
 *     }
 *   }
 * ```
 *
 * A bucket that grew past the file cap splits into files named by a longer key prefix
 * (`data/ca/cas.json`). The file for a query is the longest file prefix the query starts with, so
 * a cold search costs the manifest and one file.
 *
 * The manifest paths are relative to the page, and every URL in the app is relative, so the same
 * files load from `/itadict/` and from a root dev server.
 */

/** Where the pipeline writes, relative to the page. The manifest paths carry it too. */
export const DATA_BASE = '';

/** One file listed by the manifest. */
/** @typedef {{ path: string, bytes: number, hash: string }} Shard */

/** One bucket's four file sets. */
/** @typedef {{ search: Shard[], entry: Shard[], ex: Shard[], forms: Shard[] }} Bucket */

/** `data/index.json` once parsed. */
/** @typedef {{
 *   version: string,
 *   built: string,
 *   partial: boolean,
 *   sources: Array<{ name: string, url: string, licence: string }>,
 *   totals: { entries: number, forms: number, examples: number, bytes: number },
 *   buckets: Record<string, Bucket>,
 * }} Manifest */

/** One search row: what the result list draws, and what ranking matches. */
/** @typedef {{
 *   folded: string,
 *   id: string,
 *   headword: string,
 *   pronunciation: string,
 *   gloss: string,
 *   rank: number,
 *   matched?: string,
 * }} Row */

/** One entry body, as the Entry screen draws it. `exampleIds` are fetched separately. */
/** @typedef {{
 *   id: string,
 *   headword: string,
 *   pronunciation: string,
 *   cefr: string,
 *   translation: string[],
 *   forms: Array<{ label: string, value: string }>,
 *   exampleIds: string[],
 * }} Entry */

/** What an inflected form points at. */
/** @typedef {{ lemma: string, label: string }} Form */

/** @param {unknown} value @returns {boolean} */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {any} the value when it is a plain object, else `null` */
function obj(value) {
  return isObject(value) ? value : null;
}

/** @param {unknown} value @returns {string} */
function str(value) {
  return typeof value === 'string' ? value : '';
}

/** @param {unknown} value @returns {number} */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** @param {unknown} value @returns {string[]} the strings of an array, nothing else */
function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * The build's fold, and the one fold the app uses: NFD, drop the combining marks, lowercase.
 * It also builds a bucket key, so a query and a row cannot disagree about case or accents.
 *
 * @param {string} text
 * @returns {string}
 */
export function foldWord(text) {
  return String(text).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/**
 * The bucket a word belongs to: its folded letters and digits, first two of them. A one-letter
 * word keeps one.
 *
 * @param {string} word
 * @returns {string}
 */
export function bucketKey(word) {
  const key = foldWord(word).replace(/[^a-z0-9]/g, '');
  return key.slice(0, 2);
}

/**
 * Parse `data/index.json`, or `null` when it is not a manifest. A broken bucket or source is
 * skipped and a missing count reads as `0`: the shell must open on a partial manifest, not fail.
 *
 * @param {unknown} json
 * @returns {Manifest | null}
 */
export function parseManifest(json) {
  const root = obj(json);
  if (root === null) return null;

  /** @type {Record<string, Bucket>} */
  const buckets = {};
  for (const [key, value] of Object.entries(obj(root.buckets) ?? {})) {
    const bucket = parseBucket(value);
    if (bucket !== null) buckets[key] = bucket;
  }
  if (Object.keys(buckets).length === 0) return null;

  /** @type {Manifest['sources']} */
  const sources = [];
  for (const raw of Array.isArray(root.sources) ? root.sources : []) {
    const source = obj(raw);
    if (source !== null) sources.push({ name: str(source.name), url: str(source.url), licence: str(source.licence) });
  }

  const totals = obj(root.totals) ?? {};
  return {
    version: str(root.version),
    built: str(root.built ?? root.buildDate),
    partial: root.partial === true,
    sources,
    totals: { entries: num(totals.entries), forms: num(totals.forms), examples: num(totals.examples), bytes: num(totals.bytes) },
    buckets,
  };
}

/**
 * One bucket's four file sets. `null` when it lists no file at all.
 * @param {unknown} value
 * @returns {Bucket | null}
 */
function parseBucket(value) {
  const bucket = obj(value);
  if (bucket === null) return null;
  /** @type {Bucket} */
  const out = { search: [], entry: [], ex: [], forms: [] };
  for (const kind of /** @type {const} */ (['search', 'entry', 'ex', 'forms'])) {
    for (const raw of Array.isArray(bucket[kind]) ? bucket[kind] : []) {
      const file = obj(raw);
      const path = str(file?.path ?? file?.file);
      if (path === '') continue;
      out[kind].push({ path, bytes: num(file?.bytes), hash: str(file?.hash) });
    }
  }
  return out.search.length + out.entry.length + out.ex.length + out.forms.length === 0 ? null : out;
}

/**
 * The prefix a file holds, read off its name: `data/ca/cas.json` holds the key prefix `cas`.
 * @param {string} path
 * @returns {string}
 */
function filePrefix(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.endsWith('.json') ? name.slice(0, -5) : name;
}

/**
 * The one file of a set that holds a key, or every file when the key is shorter than the split
 * prefixes. A null answer means the set is empty.
 *
 * @param {Shard[]} files
 * @param {string} key a folded key
 * @returns {Shard[]}
 */
export function pickFiles(files, key) {
  if (files.length <= 1) return files;
  /** @type {Shard | null} */
  let best = null;
  let length = 0;
  for (const file of files) {
    const prefix = filePrefix(file.path);
    if (prefix.length > length && key.startsWith(prefix)) {
      best = file;
      length = prefix.length;
    }
  }
  return best === null ? files : [best];
}

/**
 * One row, from the compact `[folded, id, headword, pronunciation, gloss]` array the build writes.
 * The named shape is read too, because the build may settle on one.
 *
 * @param {unknown} raw
 * @returns {Row | null}
 */
export function toRow(raw) {
  const source = Array.isArray(raw)
    ? { folded: raw[0], id: raw[1], headword: raw[2], pronunciation: raw[3], gloss: raw[4], rank: raw[5] }
    : obj(raw);
  if (source === null) return null;
  const row = {
    folded: str(source.folded ?? source.key),
    id: str(source.id),
    headword: str(source.headword ?? source.word),
    pronunciation: str(source.pronunciation ?? source.ipa),
    gloss: str(source.gloss),
    rank: num(source.rank),
  };
  return row.id === '' || row.headword === '' ? null : row;
}

/**
 * One entry body. The examples arrive as sentence ids: their sentences are their own file, so the
 * headword never waits for them. `conj` is the conjugation table of a verb, drawn as FORMS.
 *
 * @param {unknown} raw
 * @returns {Entry | null}
 */
export function toEntry(raw) {
  const source = obj(raw);
  if (source === null) return null;
  const id = str(source.id);
  const headword = str(source.word ?? source.headword);
  if (id === '' || headword === '') return null;

  /** @type {Array<{ label: string, value: string }>} */
  const forms = [];
  const rawForms = source.conj ?? source.forms;
  for (const pair of Array.isArray(rawForms) ? rawForms : []) {
    // The build writes [form, label]; a named pair is read too.
    const value = Array.isArray(pair) ? str(pair[0]) : str(obj(pair)?.value ?? obj(pair)?.form);
    const label = Array.isArray(pair) ? str(pair[1]) : str(obj(pair)?.label);
    if (value !== '') forms.push({ label: label === '' ? 'form' : label, value });
  }

  return {
    id,
    headword,
    pronunciation: str(source.ipa ?? source.pronunciation),
    cefr: str(source.cefr),
    translation: strings(source.senses ?? source.translation),
    forms,
    exampleIds: strings(source.ex ?? source.exampleIds),
  };
}

/**
 * The forms set: folded inflected form -> `{ lemma, label }`.
 * @param {unknown} body
 * @returns {Map<string, Form>}
 */
export function parseForms(body) {
  /** @type {Map<string, Form>} */
  const map = new Map();
  const root = obj(body);
  if (root === null) return map;
  for (const [key, value] of Object.entries(root)) {
    const named = obj(value);
    const lemma = str(named?.lemma ?? (Array.isArray(value) ? value[0] : ''));
    if (lemma === '') continue;
    map.set(key, { lemma, label: str(named?.label ?? (Array.isArray(value) ? value[1] : '')) });
  }
  return map;
}

/**
 * The examples set: sentence id -> the sentence.
 * @param {unknown} body
 * @returns {Map<string, string>}
 */
export function parseExamples(body) {
  /** @type {Map<string, string>} */
  const map = new Map();
  const root = obj(body);
  if (root === null) return map;
  for (const [id, value] of Object.entries(root)) {
    const sentence = typeof value === 'string' ? value : str(obj(value)?.it ?? obj(value)?.text);
    if (sentence !== '') map.set(id, sentence);
  }
  return map;
}

/**
 * Open the data set. Every file is fetched at most once and the promise is kept, so a keystroke
 * after the first costs no request and an entry opened twice costs one. A failed load is not kept,
 * so a retry can succeed.
 *
 * @param {{
 *   fetch?: (url: string) => Promise<{ ok: boolean, status?: number, json: () => Promise<unknown> }>,
 *   base?: string,
 * }} [options] injected by `tools/sanity.mjs`; the browser passes nothing
 */
export function createData(options = {}) {
  const base = typeof options.base === 'string' ? options.base : DATA_BASE;
  const doFetch = typeof options.fetch === 'function' ? options.fetch : (/** @type {string} */ url) => globalThis.fetch(url);

  /** @type {Map<string, Promise<any>>} */
  const cache = new Map();

  /**
   * @param {string} key
   * @param {() => Promise<any>} load
   * @returns {Promise<any>}
   */
  function memo(key, load) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const promise = load().catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, promise);
    return promise;
  }

  /**
   * @param {string} path page-relative, as the manifest lists it
   * @returns {Promise<any>}
   */
  async function json(path) {
    const response = await doFetch(base + path);
    if (!response || response.ok !== true) {
      throw new Error(`itadict data: ${base + path} answered ${response?.status ?? 'nothing'}`);
    }
    return response.json();
  }

  /** @returns {Promise<Manifest>} */
  function manifest() {
    return memo('manifest', async () => {
      const parsed = parseManifest(await json('data/index.json'));
      if (parsed === null) throw new Error('itadict data: data/index.json is not a manifest');
      return parsed;
    });
  }

  /**
   * A bucket's files of one set, or none when the manifest has no such bucket.
   * @param {string} key folded
   * @param {'search' | 'entry' | 'ex' | 'forms'} kind
   * @param {boolean} pick one file by the key, or every file
   * @returns {Promise<Shard[]>}
   */
  async function files(key, kind, pick) {
    const found = (await manifest()).buckets[key.slice(0, 2)] ?? (await manifest()).buckets[key.slice(0, 1)];
    if (!found) return [];
    return pick ? pickFiles(found[kind], key) : found[kind];
  }

  /**
   * @param {Shard[]} shards
   * @returns {Promise<any[]>} every body, in order
   */
  function read(shards) {
    return Promise.all(shards.map((shard) => memo('file:' + shard.path, () => json(shard.path))));
  }

  return {
    manifest,
    /**
     * The search rows of one folded key.
     * @param {string} key folded
     * @returns {Promise<Row[]>}
     */
    async rows(key) {
      /** @type {Row[]} */
      const out = [];
      for (const body of await read(await files(key, 'search', true))) {
        for (const raw of Array.isArray(body) ? body : []) {
          const row = toRow(raw);
          if (row !== null) out.push(row);
        }
      }
      return out;
    },
    /**
     * The inflected forms of one folded key.
     * @param {string} key folded
     * @returns {Promise<Map<string, Form>>}
     */
    async forms(key) {
      /** @type {Map<string, Form>} */
      const out = new Map();
      for (const body of await read(await files(key, 'forms', true))) {
        for (const [form, hit] of parseForms(body)) out.set(form, hit);
      }
      return out;
    },
    /**
     * One entry body, from the bucket its row came from.
     * @param {string} bucket a bucket key
     * @param {string} id
     * @returns {Promise<Entry | null>}
     */
    async entry(bucket, id) {
      for (const body of await read(await files(bucket, 'entry', false))) {
        for (const raw of Array.isArray(body) ? body : []) {
          const entry = toEntry(raw);
          if (entry !== null && entry.id === id) return entry;
        }
      }
      return null;
    },
    /**
     * The sentences of one bucket, by id. One fetch, however many ids are wanted.
     * @param {string} bucket a bucket key
     * @returns {Promise<Map<string, string>>}
     */
    async examples(bucket) {
      /** @type {Map<string, string>} */
      const out = new Map();
      for (const body of await read(await files(bucket, 'ex', false))) {
        for (const [id, sentence] of parseExamples(body)) out.set(id, sentence);
      }
      return out;
    },
  };
}
