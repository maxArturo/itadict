// @ts-check
/**
 * Lists, folders, notes order, and the two portable files: one list and a full backup.
 *
 * Pure. Nothing here touches the DOM, the storage backend or a clock. The storage module owns the
 * envelope and the ids; this module owns the shapes, the validation and the merge rules.
 *
 * A list file is:
 *   { app: "itadict", kind: "list", v: 1, name, label, items: [{ id, word }] }
 * A backup file is:
 *   { app: "itadict", kind: "backup", v: 1, exported, data: <the whole storage data> }
 *
 * Both are validated before anything is written. A bad file changes nothing.
 */

import { exampleBucket } from './data.js';

/** The six labels a list can carry. A new list must pick one. */
export const LABELS = ['Verbs', 'Nouns', 'Phrases', 'Exam', 'Travel', 'Other'];

/** The app name both file kinds carry. */
export const APP = 'itadict';

/** The file versions this build writes and reads. */
export const FILE_VERSION = 1;

/** A list holds this many items at most. A guard, not a product limit. */
export const ITEMS_MAX = 5000;

/** A name is this long at most. */
export const NAME_MAX = 60;

/** @typedef {{ id: string, word: string }} ListItem */
/** @typedef {{ id: string, name: string, label: string, folder: string, items: ListItem[] }} UserList */
/** @typedef {{ id: string, name: string }} Folder */
/** @typedef {{ name: string, label: string, items: ListItem[] }} ListPackage */

/** @param {unknown} value @returns {boolean} true only for plain objects, never arrays */
function isPlain(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** @param {unknown} value @returns {string} */
function str(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * A label from the fixed set. Anything else is Other.
 * @param {unknown} value
 * @returns {string}
 */
export function labelFor(value) {
  return typeof value === 'string' && LABELS.includes(value) ? value : 'Other';
}

/**
 * One clean name: trimmed, single spaces, no control characters, at most {@link NAME_MAX}.
 * @param {unknown} value
 * @returns {string}
 */
export function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

/**
 * A name not already taken: "Italian (2)", "Italian (3)". The base keeps its own name.
 * @param {string} name
 * @param {Iterable<string>} taken
 * @returns {string}
 */
export function uniqueName(name, taken) {
  const base = cleanName(name);
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const next = base + ' (' + n + ')';
    if (!used.has(next)) return next;
  }
  return base + ' (1000)';
}

/**
 * The items of a stored list or an imported list, de-duplicated by id. A row without an id or a
 * word is dropped.
 * @param {unknown} value
 * @returns {ListItem[]}
 */
export function readItems(value) {
  /** @type {ListItem[]} */
  const out = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    if (!isPlain(raw)) continue;
    const item = /** @type {Record<string, unknown>} */ (raw);
    const id = str(item.id);
    const word = str(item.word).trim();
    if (id === '' || word === '' || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, word });
    if (out.length >= ITEMS_MAX) break;
  }
  return out;
}

/**
 * One stored list, or null. Unknown keys are dropped; an empty name is not a list.
 * @param {unknown} value
 * @returns {UserList | null}
 */
export function readList(value) {
  if (!isPlain(value)) return null;
  const raw = /** @type {Record<string, unknown>} */ (value);
  const id = str(raw.id);
  const name = cleanName(raw.name);
  if (id === '' || name === '') return null;
  return { id, name, label: labelFor(raw.label), folder: str(raw.folder), items: readItems(raw.items) };
}

/**
 * Every stored list with a shape this build can use.
 * @param {unknown} value
 * @returns {UserList[]}
 */
export function readLists(value) {
  /** @type {UserList[]} */
  const out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const list = readList(raw);
    if (list !== null) out.push(list);
  }
  return out;
}

/**
 * One stored folder, or null.
 * @param {unknown} value
 * @returns {Folder | null}
 */
export function readFolder(value) {
  if (!isPlain(value)) return null;
  const raw = /** @type {Record<string, unknown>} */ (value);
  const id = str(raw.id);
  const name = cleanName(raw.name);
  return id === '' || name === '' ? null : { id, name };
}

/**
 * Every stored folder with a shape this build can use.
 * @param {unknown} value
 * @returns {Folder[]}
 */
export function readFolders(value) {
  /** @type {Folder[]} */
  const out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const folder = readFolder(raw);
    if (folder !== null) out.push(folder);
  }
  return out;
}

/**
 * Read an imported list file. Null means "not an itadict list this build reads"; nothing is
 * written on null.
 * @param {unknown} value
 * @returns {ListPackage | null}
 */
export function parsePackage(value) {
  if (!isPlain(value)) return null;
  const raw = /** @type {Record<string, unknown>} */ (value);
  if (raw.app !== APP || raw.kind !== 'list' || raw.v !== FILE_VERSION) return null;
  const name = cleanName(raw.name);
  if (name === '' || !Array.isArray(raw.items)) return null;
  return { name, label: labelFor(raw.label), items: readItems(raw.items) };
}

/**
 * Read a backup file. Null means "not an itadict backup this build reads".
 * @param {unknown} value
 * @returns {{ data: Record<string, unknown> } | null}
 */
export function parseBackup(value) {
  if (!isPlain(value)) return null;
  const raw = /** @type {Record<string, unknown>} */ (value);
  if (raw.app !== APP || raw.kind !== 'backup' || raw.v !== FILE_VERSION) return null;
  if (!isPlain(raw.data)) return null;
  return { data: /** @type {Record<string, unknown>} */ (raw.data) };
}

/**
 * The file one list becomes: only the fields another device needs.
 * @param {UserList} list
 * @returns {{ app: string, kind: string, v: number, name: string, label: string, items: ListItem[] }}
 */
export function packageList(list) {
  return {
    app: APP,
    kind: 'list',
    v: FILE_VERSION,
    name: cleanName(list.name),
    label: labelFor(list.label),
    items: list.items.map((item) => ({ id: item.id, word: item.word })),
  };
}

/**
 * The file a full backup becomes.
 * @param {Record<string, unknown>} data the whole storage data
 * @param {string} exported an ISO timestamp
 * @returns {{ app: string, kind: string, v: number, exported: string, data: Record<string, unknown> }}
 */
export function backupFile(data, exported) {
  return { app: APP, kind: 'backup', v: FILE_VERSION, exported, data };
}

/**
 * Merge an imported list into the collection. An existing list is never overwritten: a name
 * already taken gets a suffix. "added" counts item ids new to the whole collection; "present"
 * counts the ids the collection already holds.
 *
 * @param {UserList[]} lists the stored lists
 * @param {ListPackage} parsed a validated file
 * @returns {{ lists: UserList[], list: UserList, added: number, present: number }}
 */
export function mergeList(lists, parsed) {
  const name = uniqueName(parsed.name, lists.map((list) => list.name));
  /** @type {Set<string>} */
  const known = new Set();
  for (const list of lists) for (const item of list.items) known.add(item.id);
  const items = parsed.items;
  const added = items.filter((item) => !known.has(item.id)).length;
  const list = { id: '', name, label: parsed.label, folder: '', items };
  return { lists: [...lists, list], list, added, present: items.length - added };
}

/**
 * The counts a backup or a restore reports.
 * @param {Record<string, any>} data the storage data, already normalised
 * @returns {{ lists: number, folders: number, items: number, notes: number, cards: number, history: number }}
 */
export function counts(data) {
  let items = 0;
  for (const list of readLists(data.lists)) items += list.items.length;
  return {
    lists: readLists(data.lists).length,
    folders: readFolders(data.folders).length,
    items,
    notes: isPlain(data.notes) ? Object.keys(data.notes).length : 0,
    cards: isPlain(data.schedule) ? Object.keys(data.schedule).length : 0,
    history: Array.isArray(data.history) ? data.history.length : 0,
  };
}

/**
 * The word a note row shows: the word stored with the note, else the headword the entry gave,
 * else the entry id. A data rebuild can rename ids; the stored word keeps the row readable.
 * @param {string} stored
 * @param {string} fetched
 * @param {string} id
 * @returns {string}
 */
export function noteWord(stored, fetched, id) {
  return stored !== '' ? stored : fetched !== '' ? fetched : id;
}

/**
 * The first line of a note, short enough for one row.
 * @param {string} text
 * @returns {string}
 */
export function firstLine(text) {
  const line = String(text ?? '').split('\n').map((part) => part.trim()).find((part) => part !== '') ?? '';
  return line.length > 90 ? line.slice(0, 89) + '…' : line;
}

/**
 * Whether a stored item carries a usable headword. A note from before words were stored has `''`,
 * and an item saved from a cold link before its body landed may hold its own id as the word.
 * Neither says which entry it meant, so neither is checked or moved.
 * @param {{ id: string, word: string }} item
 * @returns {boolean}
 */
export function hasWord(item) {
  return (
    typeof item?.id === 'string' &&
    item.id !== '' &&
    typeof item.word === 'string' &&
    item.word.trim() !== '' &&
    item.word !== item.id
  );
}

/**
 * Find the stored items whose id a rebuild moved. An entry id is `<file>:<position>`, and a file
 * split that reflows renumbers entries, so a saved id can name another headword after a rebuild.
 * Notes and list items keep the word beside the id; this checks the two against each other.
 *
 * Each distinct `{ id, word }` is read once. When the entry at `id` still has the stored headword,
 * or the item has no word (see {@link hasWord}), it stays. Otherwise the word's candidate entries
 * are read from the dictionary, and the rule is:
 *
 * - Only a candidate in the same two-letter bucket as the old id counts.
 * - Exactly one such candidate: the item moves to it.
 * - None, or several that disagree (homographs, such as one word under two parts of speech): the
 *   item stays where it is, and its note stays hidden there. A note on the wrong word is the bug
 *   this guards against; a hidden note is the safe failure.
 *
 * A lookup that throws (offline, a file that did not load) decides nothing either. Every item
 * that stays is reported with `to: null` and the reason.
 *
 * Pure: the dictionary arrives as functions, so a Node check hands it maps.
 *
 * @param {Array<{ id: string, word: string }>} items
 * @param {{
 *   headwordOf: (id: string) => Promise<string | null>,
 *   idsOfWord: (word: string) => Promise<string[]>,
 *   fold: (text: string) => string,
 * }} dictionary
 * @returns {Promise<Array<{ from: string, word: string, to: string | null, why: 'moved' | 'missing' | 'ambiguous' }>>}
 *   each item whose id no longer holds its word, once
 */
export async function relocate(items, dictionary) {
  /** @type {Array<{ from: string, word: string, to: string | null, why: 'moved' | 'missing' | 'ambiguous' }>} */
  const moved = [];
  /** @type {Map<string, { id: string, word: string }>} */
  const distinct = new Map();
  for (const item of items) {
    if (!hasWord(item)) continue;
    distinct.set(item.id + '\u0000' + item.word, { id: item.id, word: item.word });
  }
  await Promise.all(
    [...distinct.values()].map(async (item) => {
      try {
        const headword = await dictionary.headwordOf(item.id);
        if (headword !== null && dictionary.fold(headword) === dictionary.fold(item.word)) return;
        const bucket = exampleBucket(item.id);
        const inBucket = [...new Set(await dictionary.idsOfWord(item.word))].filter((id) => exampleBucket(id) === bucket);
        if (inBucket.length === 1) {
          if (inBucket[0] !== item.id) moved.push({ from: item.id, word: item.word, to: inBucket[0], why: 'moved' });
          return;
        }
        moved.push({ from: item.id, word: item.word, to: null, why: inBucket.length === 0 ? 'missing' : 'ambiguous' });
      } catch {
        // Not known: the item stays where it is.
      }
    }),
  );
  return moved;
}

/**
 * The dictionary {@link relocate} reads, over the app's data client. A word's candidates are
 * every row whose headword is exactly that word; when none is, every row that folds to it. All of
 * them are returned, so {@link relocate} can refuse a choice between homographs. The forms index
 * is not read: it maps a form to its lemma, and landing on the lemma means landing on a different
 * headword, which is the bug this guards against. A word with no row is missing. The client is a
 * parameter, so this module stays free of fetches.
 *
 * @param {{
 *   entry: (id: string) => Promise<{ headword: string } | null>,
 *   rows: (key: string) => Promise<Array<{ id: string, headword: string }>>,
 * }} data
 * @param {(text: string) => string} fold
 */
export function wordDictionary(data, fold) {
  return {
    fold,
    /** @param {string} id */
    headwordOf: async (id) => (await data.entry(id))?.headword ?? null,
    /**
     * @param {string} word
     * @returns {Promise<string[]>}
     */
    idsOfWord: async (word) => {
      const folded = fold(word);
      const rows = await data.rows(folded);
      const exact = rows.filter((row) => row.headword === word);
      const hits = exact.length > 0 ? exact : rows.filter((row) => fold(row.headword) === folded);
      return hits.map((row) => row.id);
    },
  };
}
