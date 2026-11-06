// @ts-check
/**
 * Persistence: one key, one envelope, one `migrate()` chain.
 *
 * ```js
 * localStorage['itadict'] = {
 *   v: 3,
 *   data: {
 *     history: [...], opened: [...], schedule: {...}, notes: {...},
 *     lists: [...], folders: [...], settings: { theme, textSize, speechRate }
 *   }
 * }
 * ```
 *
 * `history` is the last {@link HISTORY_MAX} search queries, newest first. `opened` is the last
 * {@link OPENED_MAX} entries opened, newest first. `schedule` is one study card per entry id and
 * `notes` is one note per entry id. An entry id carries its own location, so nothing has to
 * remember a bucket. `lists` and `folders` are the user's own organisation. `settings` is what
 * the Settings screen writes.
 *
 * Nothing is pruned. A blob this build cannot read (unparsable, foreign, newer) is left exactly
 * where it is and writes are refused, so data is never clobbered; the app keeps working from
 * memory for the session.
 */

import { foldWord } from './data.js';
import { cleanName, hasWord, labelFor, mergeList, readFolders, readLists, uniqueName } from './lists.js';
import { readCard } from './study.js';

/** @typedef {import('./lists.js').UserList} UserList */
/** @typedef {import('./lists.js').Folder} Folder */
/** @typedef {{ text: string, at: number, word: string }} Note */
/** @typedef {{ theme: 'system' | 'light' | 'dark', textSize: 0 | 1 | 2, speechRate: number }} Settings */

/** The one persistent key. No second key, no export, no import. */
export const KEY = 'itadict';

/** The envelope version this build understands and writes. */
export const VERSION = 3;

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
 *   notes: Record<string, Note>,
 *   lists: UserList[],
 *   folders: Folder[],
 *   settings: Settings,
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
  3: (data) => ({ ...data, lists: [], folders: [], settings: { ...DEFAULT_SETTINGS } }),
};

/** The settings a fresh install starts with. The designer's values. */
export const DEFAULT_SETTINGS = Object.freeze(
  /** @type {Settings} */ ({ theme: 'system', textSize: 1, speechRate: 0.9 }),
);

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
    lists: readLists(source.lists),
    folders: readFolders(source.folders),
    settings: normaliseSettings(source.settings),
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
 * Keep only non-empty notes on non-empty ids. A v2 note is a string with no time; it becomes a
 * note stamped 0, which sorts last. A v3 note is `{ text, at }`.
 * @param {unknown} value
 * @returns {Record<string, Note>}
 */
function normaliseNotes(value) {
  /** @type {Record<string, Note>} */
  const out = {};
  if (!isPlain(value)) return out;
  for (const [id, raw] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
    if (id === '') continue;
    /** @type {Note | null} */
    let note = null;
    if (typeof raw === 'string') note = { text: raw, at: 0, word: '' };
    else if (isPlain(raw)) {
      const named = /** @type {Record<string, unknown>} */ (raw);
      note = {
        text: typeof named.text === 'string' ? named.text : '',
        at: typeof named.at === 'number' && Number.isFinite(named.at) ? named.at : 0,
        word: typeof named.word === 'string' ? named.word : '',
      };
    }
    if (note !== null && note.text.trim() !== '') out[id] = note;
  }
  return out;
}

/**
 * One settings object with known values only. A bad value falls back to the default.
 * @param {unknown} value
 * @returns {Settings}
 */
function normaliseSettings(value) {
  const raw = isPlain(value) ? /** @type {Record<string, unknown>} */ (value) : {};
  let size = 1;
  if (raw.textSize === 0 || raw.textSize === 2) size = raw.textSize;
  const rate =
    typeof raw.speechRate === 'number' && Number.isFinite(raw.speechRate)
      ? Math.min(1.5, Math.max(0.5, Math.round(raw.speechRate * 100) / 100))
      : DEFAULT_SETTINGS.speechRate;
  return {
    theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
    textSize: /** @type {0 | 1 | 2} */ (size),
    speechRate: rate,
  };
}

/**
 * A copy a caller may keep: nothing in it aliases the envelope.
 * @param {UserList} list
 * @returns {UserList}
 */
function copyList(list) {
  return { ...list, items: list.items.map((item) => ({ ...item })) };
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
 * @param {() => number} [now] defaults to `Date.now`; inject a clock in Node checks
 * @returns {{
 *   readonly writable: boolean,
 *   history: () => string[],
 *   addQuery: (query: string) => string[],
 *   clearHistory: () => void,
 *   schedule: () => Record<string, import('./study.js').Card>,
 *   setSchedule: (id: string, card: import('./study.js').Card) => void,
 *   note: (id: string) => string,
 *   notes: () => Array<{ id: string, text: string, at: number, word: string }>,
 *   setNote: (id: string, text: string, word: string) => boolean,
 *   opened: () => string[],
 *   addOpened: (id: string) => void,
 *   lists: () => UserList[],
 *   addList: (name: string, label: string, folder?: string) => UserList,
 *   removeList: (id: string) => void,
 *   addItem: (listId: string, item: { id: string, word: string }) => 'added' | 'present' | 'missing',
 *   removeItem: (listId: string, itemId: string) => void,
 *   toggleItem: (listId: string, item: { id: string, word: string }) => 'added' | 'removed' | 'missing',
 *   listIdsWith: (id: string) => string[],
 *   importList: (parsed: import('./lists.js').ListPackage) => ReturnType<typeof mergeList>,
 *   folders: () => Folder[],
 *   addFolder: (name: string) => Folder,
 *   settings: () => Settings,
 *   setSettings: (patch: Partial<Settings>) => Settings,
 *   size: () => number,
 *   snapshot: () => Record<string, unknown>,
 *   restore: (incoming: Record<string, unknown>) => boolean,
 *   save: () => boolean,
 *   rekeyAll: (moves: Array<{ from: string, to: string, word: string }>, fold: (text: string) => string) => number,
 * }}
 */
/**
 * Which moves of one batch can be applied together. A move is dropped when its destination holds
 * a word that is not the moved word and does not leave in the same batch, or when another move
 * brings a different word to the same destination. Dropping one move keeps its item in place, so
 * the plan is checked again until nothing changes.
 * @param {Array<{ from: string, to: string, word: string }>} moves
 * @param {(id: string) => string | undefined} wordAt the word stored at an id now
 * @param {(a: string, b: string) => boolean} same
 * @returns {Map<string, string>} old id -> new id
 */
function plan(moves, wordAt, same) {
  let accepted = moves;
  for (let changed = true; changed; ) {
    changed = false;
    const leaving = new Set(accepted.map((move) => move.from));
    /** @type {Map<string, string>} */
    const arriving = new Map();
    for (const move of accepted) {
      const staying = leaving.has(move.to) ? undefined : wordAt(move.to);
      const other = arriving.get(move.to);
      if ((staying !== undefined && !same(staying, move.word)) || (other !== undefined && !same(other, move.word))) {
        accepted = accepted.filter((entry) => entry !== move);
        changed = true;
        break;
      }
      arriving.set(move.to, move.word);
    }
  }
  return new Map(accepted.map((move) => [move.from, move.to]));
}

export function createStorage(backend = globalThis.localStorage, now = () => Date.now()) {
  if (!backend || typeof backend.getItem !== 'function' || typeof backend.setItem !== 'function') {
    throw new Error('itadict storage: a localStorage-like backend is required');
  }

  const opened = open(backend);
  let data = opened.data;
  let writable = opened.writable;
  let sequence = 0;

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

  /**
   * A new id for a list or a folder: the clock in base 36 plus a counter, unique in the envelope.
   * @param {string} prefix
   * @returns {string}
   */
  function nextId(prefix) {
    let id = '';
    do {
      sequence += 1;
      id = prefix + '-' + now().toString(36) + '-' + sequence.toString(36);
    } while (data.lists.some((list) => list.id === id) || data.folders.some((folder) => folder.id === id));
    return id;
  }

  /**
   * Add one entry to one list and write the envelope when it was new.
   * @param {UserList} list
   * @param {{ id: string, word: string }} item
   * @returns {'added' | 'present'}
   */
  function addTo(list, item) {
    const id = typeof item?.id === 'string' ? item.id : '';
    const word = typeof item?.word === 'string' ? item.word.trim() : '';
    if (id === '' || word === '') return 'present';
    if (list.items.some((entry) => entry.id === id)) return 'present';
    list.items.push({ id, word });
    persist();
    return 'added';
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
    note: (id) => data.notes[id]?.text ?? '',
    /** Every note, newest first. A copy. */
    notes: () =>
      Object.entries(data.notes)
        .map(([id, note]) => ({ id, text: note.text, at: note.at, word: note.word }))
        .sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    /**
     * Store or clear one note and write the envelope now. A cleared note leaves no row. The
     * headword is kept with the note, so a later data rebuild cannot lose the word.
     *
     * A note is never destroyed silently: the write is refused when no headword comes with it, and
     * when the note stored at this id belongs to another word (a rebuild moved the id). The stored
     * note is then left exactly as it is.
     * @param {string} id
     * @param {string} text
     * @param {string} word the entry's headword
     * @returns {boolean} whether the note was written
     */
    setNote(id, text, word) {
      if (typeof id !== 'string' || id === '') return false;
      const owner = typeof word === 'string' ? word.trim() : '';
      if (!hasWord({ id, word: owner })) return false;
      const stored = data.notes[id];
      // A v2 note has no word (''), so it carries no owner to protect, and the first headword that
      // writes it adopts it. That is safe because the pinned split keeps ids stable: a v2 note is
      // still on the id where it was written, so the headword now at that id is the one it meant.
      if (stored !== undefined && hasWord({ id, word: stored.word }) && foldWord(stored.word) !== foldWord(owner)) return false;
      const clean = typeof text === 'string' ? text : '';
      if (clean.trim() === '') delete data.notes[id];
      else data.notes[id] = { text: clean, at: now(), word: owner };
      persist();
      return true;
    },
    /**
     * Move the notes and list items a rebuild displaced, as one batch. Each move names an old id,
     * the new id and the stored word; only items whose word folds to that word move.
     *
     * Two phases, so chained moves cannot corrupt each other (casa ca:3 -> ca:4 while caso
     * ca:4 -> ca:5): the plan is read from a snapshot of every move, then applied once. A move is
     * dropped when its destination would hold another word, whether that word stays there or
     * arrives from another move; the item then stays where it is. Only items of the same word are
     * ever merged: a note meeting a note is appended, never lost, and a list item meeting its own
     * entry in the list is dropped. The Study schedule and the opened ids store no word, so they
     * are not moved.
     * @param {Array<{ from: string, to: string, word: string }>} moves
     * @param {(text: string) => string} fold
     * @returns {number} how many notes and list items moved
     */
    rekeyAll(moves, fold) {
      const same = (/** @type {string} */ a, /** @type {string} */ b) => fold(a) === fold(b);
      const valid = moves.filter(
        (move) => typeof move?.from === 'string' && typeof move.to === 'string' && move.from !== '' && move.to !== '' && move.from !== move.to,
      );
      let count = 0;

      const noteMoves = plan(
        valid.filter((move) => data.notes[move.from] !== undefined && same(data.notes[move.from].word, move.word)),
        (id) => data.notes[id]?.word,
        same,
      );
      if (noteMoves.size > 0) {
        /** @type {Record<string, Note>} */
        const next = {};
        // Notes that stay are placed first, so a moved note is appended after the one already there.
        const entries = Object.entries(data.notes);
        const ordered = [...entries.filter(([id]) => !noteMoves.has(id)), ...entries.filter(([id]) => noteMoves.has(id))];
        for (const [id, note] of ordered) {
          const to = noteMoves.get(id) ?? id;
          const there = next[to];
          next[to] =
            there === undefined
              ? { ...note }
              : { text: there.text + '\n\n' + note.text, at: Math.max(there.at, note.at), word: there.word || note.word };
          if (to !== id) count += 1;
        }
        data.notes = next;
      }

      for (const list of data.lists) {
        const listMoves = plan(
          valid.filter((move) => list.items.some((item) => item.id === move.from && same(item.word, move.word))),
          (id) => list.items.find((item) => item.id === id)?.word,
          same,
        );
        if (listMoves.size === 0) continue;
        /** @type {Set<string>} */
        const seen = new Set();
        list.items = list.items.flatMap((item) => {
          const to = listMoves.get(item.id) ?? item.id;
          if (to !== item.id) count += 1;
          if (seen.has(to)) return [];
          seen.add(to);
          return [{ ...item, id: to }];
        });
      }

      if (count > 0) persist();
      return count;
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
    /** The stored lists. A deep copy: callers never mutate the envelope. */
    lists: () => data.lists.map(copyList),
    /**
     * Create one list. A name already taken gets a suffix.
     * @param {string} name
     * @param {string} label
     * @param {string} [folder] a folder id, or ''
     * @returns {UserList}
     */
    addList(name, label, folder = '') {
      const base = cleanName(name) || 'List';
      /** @type {UserList} */
      const list = {
        id: nextId('l'),
        name: uniqueName(base, data.lists.map((entry) => entry.name)),
        label: labelFor(label),
        folder: typeof folder === 'string' ? folder : '',
        items: [],
      };
      data.lists.push(list);
      persist();
      return copyList(list);
    },
    /**
     * Remove one list. Items and notes are untouched.
     * @param {string} id
     */
    removeList(id) {
      const before = data.lists.length;
      data.lists = data.lists.filter((list) => list.id !== id);
      if (data.lists.length !== before) persist();
    },
    /**
     * Put one entry in one list, once.
     * @param {string} listId
     * @param {{ id: string, word: string }} item
     * @returns {'added' | 'present' | 'missing'}
     */
    addItem(listId, item) {
      const list = data.lists.find((entry) => entry.id === listId);
      if (list === undefined) return 'missing';
      return addTo(list, item);
    },
    /**
     * Take one entry out of one list.
     * @param {string} listId
     * @param {string} itemId
     */
    removeItem(listId, itemId) {
      const list = data.lists.find((entry) => entry.id === listId);
      if (list === undefined) return;
      const before = list.items.length;
      list.items = list.items.filter((item) => item.id !== itemId);
      if (list.items.length !== before) persist();
    },
    /**
     * Add the entry when the list does not hold it, remove it when it does.
     * @param {string} listId
     * @param {{ id: string, word: string }} item
     * @returns {'added' | 'removed' | 'missing'}
     */
    toggleItem(listId, item) {
      const list = data.lists.find((entry) => entry.id === listId);
      if (list === undefined) return 'missing';
      if (list.items.some((entry) => entry.id === item.id)) {
        list.items = list.items.filter((entry) => entry.id !== item.id);
        persist();
        return 'removed';
      }
      addTo(list, item);
      return 'added';
    },
    /**
     * The lists that hold one entry.
     * @param {string} id
     * @returns {string[]}
     */
    listIdsWith: (id) =>
      data.lists.filter((list) => list.items.some((item) => item.id === id)).map((list) => list.id),
    /**
     * Merge a validated list file into the collection. The name is never reused.
     * @param {import('./lists.js').ListPackage} parsed
     * @returns {ReturnType<typeof mergeList>}
     */
    importList(parsed) {
      const merged = mergeList(data.lists, parsed);
      merged.list.id = nextId('l');
      data.lists = merged.lists;
      persist();
      return merged;
    },
    /** The stored folders. A copy. */
    folders: () => data.folders.map((folder) => ({ ...folder })),
    /**
     * Create one folder. A name already taken gets a suffix.
     * @param {string} name
     * @returns {Folder}
     */
    addFolder(name) {
      const base = cleanName(name) || 'Folder';
      /** @type {Folder} */
      const folder = { id: nextId('f'), name: uniqueName(base, data.folders.map((entry) => entry.name)) };
      data.folders.push(folder);
      persist();
      return { ...folder };
    },
    /** The settings, a copy. */
    settings: () => ({ ...data.settings }),
    /**
     * Write one or more settings. A bad value falls back to the default.
     * @param {Partial<Settings>} patch
     * @returns {Settings}
     */
    setSettings(patch) {
      data.settings = normaliseSettings({ ...data.settings, ...(isPlain(patch) ? patch : {}) });
      persist();
      return { ...data.settings };
    },
    /** The bytes this app holds in storage, as UTF-8. */
    size() {
      const json = JSON.stringify({ v: VERSION, data });
      return typeof TextEncoder === 'function' ? new TextEncoder().encode(json).length : json.length;
    },
    /** Every user datum, as plain JSON: what a backup file carries. */
    snapshot: () => JSON.parse(JSON.stringify(data)),
    /**
     * Replace every user datum with a validated backup body. The caller has confirmed the
     * replacement, so this writes even when the previous blob was refused.
     * @param {Record<string, unknown>} incoming
     * @returns {boolean}
     */
    restore(incoming) {
      data = migrate(VERSION, incoming);
      writable = true;
      return persist();
    },
    save: persist,
  };
}
