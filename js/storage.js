// @ts-check
/**
 * Persistence: one key, one envelope, one `migrate()` chain.
 *
 * ```js
 * localStorage['itadict'] = {
 *   v: 2,
 *   data: { history: [...], opened: [...], schedule: {...}, notes: {...} }
 * }
 * ```
 *
 * `history` is the last {@link HISTORY_MAX} search queries, newest first. `opened` is the last
 * {@link OPENED_MAX} entries opened, newest first. `schedule` is one study card per entry id and
 * `notes` is one note per entry id. An entry id carries its own location, so nothing has to
 * remember a bucket.
 *
 * Nothing is pruned. A blob this build cannot read (unparsable, foreign, newer) is left exactly
 * where it is and writes are refused, so data is never clobbered; the app keeps working from
 * memory for the session.
 */

import { readCard } from './study.js';

/** The one persistent key. No second key, no export, no import. */
export const KEY = 'itadict';

/** The envelope version this build understands and writes. */
export const VERSION = 2;

/** How many queries search history keeps. */
export const HISTORY_MAX = 50;

/** How many recently opened entries the History deck keeps. */
export const OPENED_MAX = 50;

/**
 * Envelope contents once versioned. Extra top-level keys survive untouched.
 * @typedef {{
 *   history: string[],
 *   opened: string[],
 *   schedule: Record<string, import('./study.js').Card>,
 *   notes: Record<string, string>,
 *   [key: string]: unknown,
 * }} Data
 */

/** A `localStorage`-shaped backend; injected so the module is testable without a DOM. */
/** @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} Backend */

/** @typedef {(data: Data) => Data} Step */

/**
 * One migration step per version bump, keyed by the version it *produces*.
 * Step 2 adds study: the card schedule, the notes and the recently opened entries. A v1 blob
 * has none of them, so the step gives the three empty collections and normalise fills the rest.
 * @type {Record<number, Step>}
 */
const STEPS = {
  2: (data) => ({ ...data, schedule: {}, notes: {}, opened: [] }),
};

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
  return {
    ...source,
    history: history
      .filter((query) => typeof query === 'string' && query.trim() !== '')
      .map((query) => /** @type {string} */ (query).trim())
      .slice(0, HISTORY_MAX),
    opened: Array.isArray(source.opened)
      ? [...new Set(source.opened.filter((id) => typeof id === 'string' && id !== ''))].slice(0, OPENED_MAX)
      : [],
    schedule: normaliseSchedule(source.schedule),
    notes: normaliseNotes(source.notes),
  };
}

/**
 * Keep only well-formed cards, with the five known fields.
 * @param {unknown} value
 * @returns {Record<string, import('./study.js').Card>}
 */
function normaliseSchedule(value) {
  /** @type {Record<string, import('./study.js').Card>} */
  const out = {};
  if (!isPlain(value)) return out;
  for (const [id, card] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
    const clean = readCard(card);
    if (id !== '' && clean !== null) out[id] = clean;
  }
  return out;
}

/**
 * Keep only non-empty notes on non-empty ids.
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function normaliseNotes(value) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!isPlain(value)) return out;
  for (const [id, note] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
    if (id !== '' && typeof note === 'string' && note.trim() !== '') out[id] = note;
  }
  return out;
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
 *   schedule: () => Record<string, import('./study.js').Card>,
 *   setSchedule: (id: string, card: import('./study.js').Card) => void,
 *   note: (id: string) => string,
 *   setNote: (id: string, text: string) => void,
 *   opened: () => string[],
 *   addOpened: (id: string) => void,
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
    /** The stored cards, by entry id. A copy: callers never mutate the envelope. */
    schedule: () => ({ ...data.schedule }),
    /**
     * Store one graded card and write the envelope now.
     * @param {string} id
     * @param {import('./study.js').Card} card
     */
    setSchedule(id, card) {
      const clean = readCard(card);
      if (typeof id !== 'string' || id === '' || clean === null) return;
      data.schedule[id] = clean;
      persist();
    },
    /**
     * The note of one entry, or an empty string.
     * @param {string} id
     * @returns {string}
     */
    note: (id) => data.notes[id] ?? '',
    /**
     * Store or clear one note and write the envelope now.
     * @param {string} id
     * @param {string} text
     */
    setNote(id, text) {
      if (typeof id !== 'string' || id === '') return;
      const clean = typeof text === 'string' ? text : '';
      if (clean.trim() === '') delete data.notes[id];
      else data.notes[id] = clean;
      persist();
    },
    /** The entries opened most recently, newest first. A copy. */
    opened: () => [...data.opened],
    /**
     * Put one entry at the front of the History deck and write the envelope now.
     * @param {string} id
     */
    addOpened(id) {
      if (typeof id !== 'string' || id === '') return;
      data.opened = [id, ...data.opened.filter((entry) => entry !== id)].slice(0, OPENED_MAX);
      persist();
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
    save: persist,
  };
}
