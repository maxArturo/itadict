// @ts-check
/**
 * Persistence: one key, one envelope, one `migrate()` chain.
 *
 * ```js
 * localStorage['itadict'] = { v: 1, data: { history: [...], opened: [...] } }
 * ```
 *
 * `history` is the last {@link HISTORY_MAX} search queries, newest first. `opened` remembers which
 * bucket an entry id came from, so reloading `#/entry/<id>` still finds the entry body: the URL
 * carries an id, and the shard key cannot be derived from an id.
 *
 * Nothing else is pruned. A blob this build cannot read (unparsable, foreign, newer) is left
 * exactly where it is and writes are refused, so data is never clobbered; the app keeps working
 * from memory for the session.
 */

/** The one persistent key. No second key, no export, no import. */
export const KEY = 'itadict';

/** The envelope version this build understands and writes. */
export const VERSION = 1;

/** How many queries search history keeps. */
export const HISTORY_MAX = 50;

/** How many entry ids the app remembers the bucket of. */
export const OPENED_MAX = 200;

/** One entry id and the bucket its body lives in. */
/** @typedef {{ id: string, bucket: string }} Opened */

/**
 * Envelope contents once versioned. Extra top-level keys survive untouched.
 * @typedef {{ history: string[], opened: Opened[], [key: string]: unknown }} Data
 */

/** A `localStorage`-shaped backend; injected so the module is testable without a DOM. */
/** @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} Backend */

/** @typedef {(data: Data) => Data} Step */

/**
 * One migration step per version bump, keyed by the version it *produces*. Empty because `v: 1`
 * is the first shipped envelope: the chain exists so the first bump is one entry here plus
 * `VERSION`, and never a boot that probes a set of versioned keys.
 * @type {Record<number, Step>}
 */
const STEPS = {};

/**
 * The single migration entry point. Walks `v` forward to {@link VERSION}, running one registered
 * step per version, and returns the data (normalised, never pruned).
 *
 * @param {unknown} v the version found in the envelope
 * @param {unknown} data the `data` found in the envelope
 * @param {Record<number, Step>} [steps] injection point so the chain is testable
 * @returns {Data}
 */
export function migrate(v, data, steps = STEPS) {
  let out = normalise(data);
  const from = typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : VERSION;
  for (let next = from + 1; next <= VERSION; next += 1) {
    const step = steps[next];
    if (step) out = normalise(step(out));
  }
  return out;
}

/** @param {unknown} value @returns {boolean} true only for plain objects, never arrays */
function isPlain(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Keep whatever is already persisted — including keys this build does not know — and make the
 * two known lists the right shape.
 *
 * @param {unknown} data
 * @returns {Data}
 */
function normalise(data) {
  /** @type {Record<string, unknown>} */
  const source = isPlain(data) ? { .../** @type {Record<string, unknown>} */ (data) } : {};
  const history = Array.isArray(source.history) ? source.history : [];
  const opened = Array.isArray(source.opened) ? source.opened : [];
  return {
    ...source,
    history: history
      .filter((query) => typeof query === 'string' && query.trim() !== '')
      .map((query) => /** @type {string} */ (query).trim())
      .slice(0, HISTORY_MAX),
    opened: opened
      .filter((entry) => isPlain(entry) && typeof /** @type {any} */ (entry).id === 'string' && typeof /** @type {any} */ (entry).bucket === 'string')
      .map((entry) => ({ id: /** @type {any} */ (entry).id, bucket: /** @type {any} */ (entry).bucket }))
      .slice(0, OPENED_MAX),
  };
}

/** @param {string} message @param {unknown} [detail] */
function warn(message, detail) {
  if (typeof console !== 'undefined') console.warn(`itadict storage: ${message}`, detail ?? '');
}

/**
 * Read the stored blob into an envelope body.
 * @param {Backend} backend
 * @returns {{ data: Data, writable: boolean }}
 */
function open(backend) {
  /** @type {string | null} */
  let raw;
  try {
    raw = backend.getItem(KEY);
  } catch (error) {
    warn(`could not read ${KEY}; this session will not be saved`, error);
    return { data: migrate(VERSION, {}), writable: false };
  }
  if (raw === null) return { data: migrate(VERSION, {}), writable: true };

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    warn(`stored ${KEY} is not valid JSON; leaving it alone`, error);
    return { data: migrate(VERSION, {}), writable: false };
  }
  if (!isPlain(parsed)) {
    warn(`stored ${KEY} is not an envelope; leaving it alone`);
    return { data: migrate(VERSION, {}), writable: false };
  }

  const envelope = /** @type {Record<string, unknown>} */ (parsed);
  const v = envelope.v;
  if (typeof v === 'number' && v > VERSION) {
    warn(`stored ${KEY} is version ${v}, newer than this build's ${VERSION}; writes are disabled`);
    return { data: migrate(VERSION, envelope.data), writable: false };
  }
  return { data: migrate(v, envelope.data), writable: true };
}

/**
 * Open the envelope and hand out the two lists.
 *
 * @param {Backend} [backend] defaults to `localStorage`; inject a fake in Node checks
 * @returns {{
 *   readonly writable: boolean,
 *   history: () => string[],
 *   addQuery: (query: string) => string[],
 *   clearHistory: () => void,
 *   openedBucket: (id: string) => string | null,
 *   rememberEntry: (id: string, bucket: string) => void,
 *   save: () => boolean,
 * }}
 */
export function createStorage(backend = globalThis.localStorage) {
  if (!backend || typeof backend.getItem !== 'function' || typeof backend.setItem !== 'function') {
    throw new Error('itadict storage: a localStorage-like backend is required');
  }

  const opened = open(backend);
  const data = opened.data;
  let writable = opened.writable;

  /** Write the whole envelope now. @returns {boolean} */
  function persist() {
    if (!writable) return false;
    try {
      backend.setItem(KEY, JSON.stringify({ v: VERSION, data }));
      return true;
    } catch (error) {
      writable = false;
      warn('could not be written (quota or blocked); keeping this session in memory only', error);
      return false;
    }
  }

  return {
    /** False once writes are refused (newer, foreign or unwritable blob). */
    get writable() {
      return writable;
    },
    /** The stored queries, newest first. A copy: callers never mutate the envelope. */
    history: () => [...data.history],
    /**
     * Add one query: trimmed, de-duplicated, newest first, capped.
     * @param {string} query
     * @returns {string[]} the new history
     */
    addQuery(query) {
      const clean = typeof query === 'string' ? query.trim() : '';
      if (clean === '') return [...data.history];
      data.history = [clean, ...data.history.filter((entry) => entry !== clean)].slice(0, HISTORY_MAX);
      persist();
      return [...data.history];
    },
    /** Drop every stored query. */
    clearHistory() {
      data.history = [];
      persist();
    },
    /**
     * The bucket an entry id was last opened from, or `null` when this build never opened it.
     * @param {string} id
     * @returns {string | null}
     */
    openedBucket(id) {
      return data.opened.find((entry) => entry.id === id)?.bucket ?? null;
    },
    /**
     * Remember where an entry body lives, so a reload of `#/entry/<id>` can fetch it.
     * @param {string} id
     * @param {string} bucket
     */
    rememberEntry(id, bucket) {
      if (typeof id !== 'string' || id === '' || typeof bucket !== 'string' || bucket === '') return;
      data.opened = [{ id, bucket }, ...data.opened.filter((entry) => entry.id !== id)].slice(0, OPENED_MAX);
      persist();
    },
    save: persist,
  };
}
