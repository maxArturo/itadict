// @ts-check
/**
 * The data contract, in one place. The pipeline ships four file sets per bucket, and this module
 * is the only place that names them. When a path or a field moves, one function changes.
 *
 * ```
 * data/index.json
 *   {
 *     version, built, partial, bucketKey,
 *     sources: [{ name, url, licence }],
 *     totals: { entries, forms, examples, bytes },
 *     buckets: {
 *       "<key>": {                          // lowercase, diacritics removed, first two letters or digits
 *         search: [{ path, bytes, hash }],   // rows: [folded, id, headword, pronunciation, pos, gloss]
 *         entry:  [{ path, bytes, hash }],   // [{ id: "<bucket>:<index>", word, ipa?, cefr, pos, ex, conj? }]
 *         ex:     [{ path, bytes, hash }],   // [[sentenceId, sentence]] in index order
 *         forms:  [{ path, bytes, hash }],   // { foldedForm: { id, lemma, label } }
 *       }
 *     }
 *   }
 * ```
 *
 * Every data URL carries `?v=<hash>` from the manifest. The service worker caches a data file
 * forever, so a rebuilt shard must arrive as a new URL; the hash is that URL.
 *
 * A bucket that grew past the cap splits into files named by a longer key prefix
 * (`data/ca/cao.json`). The file for a query is the longest file prefix the query starts with, so
 * a cold search costs the manifest and one file. An entry id carries its own location, so a cold
 * deep link costs one entry file too.
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
 *   pos: string,
 *   gloss: string,
 *   matched?: string,
 * }} Row */

/** One part of speech and its senses. */
/** @typedef {{ pos: string, senses: string[] }} PosGroup */

/** One conjugation group. `forms` keeps the person slots: a missing form is "". */
/** @typedef {{ key: string, personal: boolean, forms: string[] }} ConjGroup */

/** One entry body, as the Entry screen draws it. */
/** @typedef {{
 *   id: string,
 *   headword: string,
 *   pronunciation: string,
 *   cefr: string,
 *   posList: PosGroup[],
 *   conj: ConjGroup[],
 *   exampleIndexes: number[],
 * }} Entry */

/** What an inflected form points at. */
/** @typedef {{ id: string, lemma: string, label: string }} Form */

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
  return foldWord(word).replace(/[^a-z0-9]/g, '').slice(0, 2);
}

/**
 * The bucket an entry id names: `ca:42` -> `ca`.
 * @param {string} id
 * @returns {string}
 */
export function bucketOfId(id) {
  const cut = typeof id === 'string' ? id.indexOf(':') : -1;
  return cut > 0 ? id.slice(0, cut) : '';
}

/**
 * Parse `data/index.json`, or `null` when it is not a manifest. A broken bucket is skipped and a
 * missing count reads as `0`: the shell must open on a partial manifest, not fail.
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
 * The prefix a file holds, read off its name: `data/ca/cao.json` holds the key prefix `cao`.
 * @param {string} path
 * @returns {string}
 */
function filePrefix(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.endsWith('.json') ? name.slice(0, -5) : name;
}

/**
 * The one file of a set that holds a key, or every file when the key is shorter than the split
 * prefixes.
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
 * The data URL of one file. The hash is the file's cache key, so a rebuilt shard is a new URL.
 * @param {Shard} shard
 * @returns {string}
 */
export function shardUrl(shard) {
  return shard.hash === '' ? shard.path : `${shard.path}?v=${shard.hash}`;
}

/**
 * One row, from the compact `[folded, id, headword, pronunciation, pos, gloss]` array the build
 * writes. The named shape is read too.
 *
 * @param {unknown} raw
 * @returns {Row | null}
 */
export function toRow(raw) {
  const source = Array.isArray(raw)
    ? { folded: raw[0], id: raw[1], headword: raw[2], pronunciation: raw[3], pos: raw[4], gloss: raw[5] }
    : obj(raw);
  if (source === null) return null;
  const row = {
    folded: str(source.folded ?? source.key),
    id: str(source.id),
    headword: str(source.headword ?? source.word),
    pronunciation: str(source.pronunciation ?? source.ipa),
    pos: str(source.pos),
    gloss: str(source.gloss),
  };
  return row.id === '' || row.headword === '' ? null : row;
}

/**
 * One entry body. Examples arrive as positions in the example file, so the headword never waits
 * for the sentences. `conj` keeps each tense and its six person slots.
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

  /** @type {PosGroup[]} */
  const posList = [];
  for (const rawPos of Array.isArray(source.pos) ? source.pos : []) {
    const group = obj(rawPos);
    if (group === null) continue;
    const senses = strings(group.senses);
    if (senses.length === 0) continue;
    posList.push({ pos: str(group.pos), senses });
  }

  /** @type {ConjGroup[]} */
  const conj = [];
  for (const rawGroup of Array.isArray(source.conj) ? source.conj : []) {
    const group = obj(rawGroup);
    if (group === null || typeof group.key !== 'string') continue;
    const forms = /** @type {any[]} */ (Array.isArray(group.forms) ? group.forms : []).map((form) =>
      typeof form === 'string' ? form : '',
    );
    conj.push({ key: group.key, personal: group.personal === true, forms });
  }

  return {
    id,
    headword,
    pronunciation: str(source.ipa ?? source.pronunciation),
    cefr: str(source.cefr),
    posList,
    conj,
    exampleIndexes: /** @type {any[]} */ (Array.isArray(source.ex) ? source.ex : []).filter(
      (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0,
    ),
  };
}

/**
 * The forms set: folded inflected form -> `{ id, lemma, label }`.
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
    const lemma = str(named?.lemma);
    if (lemma === '') continue;
    map.set(key, { id: str(named?.id), lemma, label: str(named?.label) });
  }
  return map;
}

/**
 * The examples set, in file order: `[[sentenceId, sentence]]`. An object keyed by id is read too.
 * @param {unknown} body
 * @returns {string[]}
 */
export function parseExamples(body) {
  /** @type {string[]} */
  const out = [];
  if (Array.isArray(body)) {
    for (const raw of body) {
      const pair = Array.isArray(raw) ? raw : null;
      const sentence = pair ? str(pair[1]) : str(obj(raw)?.it ?? obj(raw)?.text);
      if (sentence !== '') out.push(sentence);
    }
    return out;
  }
  const root = obj(body);
  if (root === null) return out;
  for (const value of Object.values(root)) {
    const sentence = typeof value === 'string' ? value : str(obj(value)?.it ?? obj(value)?.text);
    if (sentence !== '') out.push(sentence);
  }
  return out;
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
    return Promise.all(
      shards.map((shard) =>
        memo('file:' + shard.path + '@' + shard.hash, () => json(shardUrl(shard))),
      ),
    );
  }

  /**
   * Every entry of a bucket, in file order. The position is the second half of an entry id.
   * @param {string} bucket
   * @returns {Promise<Entry[]>}
   */
  function entries(bucket) {
    return memo('entries:' + bucket, async () => {
      /** @type {Entry[]} */
      const out = [];
      for (const body of await read(await files(bucket, 'entry', false))) {
        for (const raw of Array.isArray(body) ? body : []) {
          const entry = toEntry(raw);
          if (entry !== null) out.push(entry);
        }
      }
      return out;
    });
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
     * One entry body, found from its own id: `ca:42` is the bucket `ca`, position 42.
     * @param {string} id
     * @returns {Promise<Entry | null>}
     */
    async entry(id) {
      const bucket = bucketOfId(id);
      if (bucket === '') return null;
      const list = await entries(bucket);
      const index = Number(id.slice(bucket.length + 1));
      const at = Number.isInteger(index) ? list[index] : undefined;
      if (at !== undefined && at.id === id) return at;
      return list.find((entry) => entry.id === id) ?? null;
    },
    /**
     * The sentences of one bucket, in file order. An entry's example positions index this list.
     * @param {string} bucket
     * @returns {Promise<string[]>}
     */
    async examples(bucket) {
      /** @type {string[]} */
      const out = [];
      for (const body of await read(await files(bucket, 'ex', false))) out.push(...parseExamples(body));
      return out;
    },
  };
}
