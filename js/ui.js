// @ts-check
/**
 * The screens: the tab bar, Search, Text, Entry, Study, Lists, Reference, Settings, and the
 * placeholder. One element helper and text nodes only — no `innerHTML` with data, anywhere.
 * Icons are inline SVG built with `createElementNS`, so they take `currentColor` and need no
 * files. A sheet is the one overlay: a dialog over the tab bar, closed by its button, the
 * backdrop or Escape.
 *
 * | Screen | Draws |
 * |---|---|
 * | tab bar | five tabs: a 25px icon above a 10px label, chrome last in focus order |
 * | Search | the field, the input switch and its letter palette, then history, rows or one line |
 * | Text | the textarea, the summary, the text as words with a link on each known one, and the unknown words |
 * | Entry | back control, the entry name, the headword block, the sections, and the list and note sheets |
 * | Study | the deck picker and one card at a time |
 * | Lists | pinned History and Notes, folders, lists with their labels, list items, and the sheets |
 * | Reference | the catalogue, then About, Alphabet, Parts of speech, CEFR and Offline |
 * | Settings | theme, text size, speech rate, storage, backup and restore, and the download |
 * | placeholder | a title and the one line that names what is missing |
 *
 * The `document` is a parameter, like every other module's environment here, so a Node check can
 * build the same DOM with a fake. This module imports no data and fetches nothing: the app hands
 * Search a `search(query)` function and Entry two promises, which is the seam the sanity suite
 * uses. `formRows` is pure and exports the conjugation order on its own.
 */

import { LABELS, firstLine } from './lists.js';
import { ALPHABET } from './reference.js';
import { HASH, entryHash } from './router.js';
import { findMatch, fold } from './search.js';
import { WORD_CAP, summarise, tokenize } from './text.js';

/** @typedef {import('./data.js').Row} Row */
/** @typedef {import('./data.js').Entry} Entry */
/** @typedef {import('./data.js').ConjGroup} ConjGroup */
/** @typedef {import('./text.js').Match} Match */
/** @typedef {import('./study.js').Deck} Deck */
/** @typedef {import('./text.js').Segment} Segment */
/** @typedef {import('./lists.js').UserList} UserList */
/** @typedef {import('./storage.js').Settings} Settings */

/** The callbacks the Lists screen needs. */
/** @typedef {{
 *   lists: () => UserList[],
 *   folders: () => Array<{ id: string, name: string }>,
 *   history: () => string[],
 *   notesCount: () => number,
 *   notes: () => Promise<Array<{ id: string, text: string, word: string }>>,
 *   rows: (ids: string[]) => Promise<Map<string, { pos: string, gloss: string }>>,
 *   addList: (name: string, label: string, folder: string) => void,
 *   addFolder: (name: string) => void,
 *   removeList: (id: string) => void,
 *   removeItem: (listId: string, itemId: string) => void,
 *   importText: (text: string) => { ok: boolean, error?: string, name?: string, added?: number, present?: number },
 *   restoreText: (text: string) => { ok: boolean, error?: string, cancelled?: boolean, counts?: Record<string, number> },
 *   shareList: (list: UserList) => Promise<'shared' | 'downloaded' | 'cancelled'>,
 *   confirm: (message: string) => boolean,
 *   onSettings: () => void,
 *   onSearch: (query: string) => void,
 * }} ListsOptions */

/** The callbacks the Settings screen needs. */
/** @typedef {{
 *   settings: () => Settings,
 *   setSettings: (patch: Partial<Settings>) => void,
 *   size: () => number,
 *   exportBackup: () => Promise<'shared' | 'downloaded' | 'cancelled'>,
 *   restoreText: (text: string) => { ok: boolean, error?: string, cancelled?: boolean, counts?: Record<string, number> },
 *   download: (onProgress: (done: number, total: number, failed: number) => void) => Promise<{ total: number, failures: unknown[] }>,
 *   offline: () => Promise<{ files: number, bytes: number }>,
 * }} SettingsOptions */

/** The data the Reference screen reads, all through the app. */
/** @typedef {{
 *   about: () => Promise<{ version: string, built: string, entries: number, examples: number }>,
 *   alphabetIds: (words: string[]) => Promise<Map<string, string>>,
 *   pos: () => Promise<Array<{ pos: string, label: string, count: number, rows: Array<{ id: string, word: string, gloss: string }> }>>,
 *   cefr: () => Promise<Array<{ band: string, count: number }>>,
 *   startDeck: (band: string) => void,
 *   download: (onProgress: (done: number, total: number, failed: number) => void) => Promise<{ total: number, failures: unknown[] }>,
 *   offline: () => Promise<{ files: number, bytes: number }>,
 * }} ReferenceOptions */

/** The CEFR band names, shown beside the band code. @type {Record<string, string>} */
const BANDS_NAMED = {
  a1: 'Beginner',
  a2: 'Elementary',
  b1: 'Intermediate',
  b2: 'Upper intermediate',
  c1: 'Advanced',
  c2: 'Mastery',
};

/** The chevron that closes a row. */
const CHEVRON = 'M1 1.2 6.2 6.5 1 11.8';

/** The row icons of the Lists and Reference screens. */
const ICONS = {
  history: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14M12 8v4l3 2',
  note: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4',
  folder: 'M3 6h6l2 2h10v11H3z',
  list: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4',
  about: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8h.01M11 11h1v6h1',
  alphabet: 'M4 19 9 5l5 14M6.2 14h5.6',
  pos: 'M4 6h16M4 12h16M4 18h10',
  cefr: 'M4 19V5M4 19h16M8 15l3-4 3 2 4-6',
  offline: 'M12 4v10M8 10l4 4 4-4M4 20h16',
};

const NAMESPACE = 'http://www.w3.org/2000/svg';

/** The five tabs, in bar order. Settings has no tab; Lists reaches it in a later build. */
/** @type {Array<[keyof typeof HASH, string, string]>} */
const TABS = [
  ['search', 'Search', 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M16.5 16.5 21 21'],
  ['text', 'Text', 'M4 7h11M4 12h7M4 17h7M17 13.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7M18.6 18.6 21 21'],
  ['reference', 'Reference', 'M4 8h10v12H4zM8 4h10v12'],
  ['lists', 'Lists', 'M5 3h9l5 5v13H5zM14 3v5h5M8 12h7M8 16h7'],
  ['study', 'Study', 'M4 17l5-6 4 4 7-9M15 6h5v5'],
];

/** The magnifier inside the search field. */
const MAGNIFIER = 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M16.5 16.5 21 21';

/**
 * The conjugation order the designer fixed. The build's own tense keys map onto it; a tense the
 * app does not know is not drawn.
 * @type {Array<[string, string, boolean]>}
 */
const TENSES = [
  ['indicativo presente', 'presente', true],
  ['indicativo imperfetto', 'imperfetto', true],
  ['indicativo futuro', 'futuro semplice', true],
  ['condizionale presente', 'condizionale presente', true],
  ['congiuntivo presente', 'congiuntivo presente', true],
  ['congiuntivo imperfetto', 'congiuntivo imperfetto', true],
  ['indicativo passato remoto', 'passato remoto', true],
  ['gerundio', 'gerundio', false],
  ['participio presente', 'participio presente', false],
  ['participio passato', 'participio passato', false],
];

/** The six person slots of a personal tense, in the order the build writes them. */
const PERSONS = ['io', 'tu', 'lui/lei', 'noi', 'voi', 'loro'];

/**
 * The spell-it-by-ear palette: the five vowels with their accents, then the sixteen consonants
 * of the Italian alphabet. One tap appends one letter, so a learner who heard a word can build it
 * without a keyboard. The sound column is the vowel the accents belong to.
 * @type {Array<{ sound: string, letters: string[] }>}
 */
export const PALETTE = [
  { sound: 'A', letters: ['a', 'à'] },
  { sound: 'E', letters: ['e', 'è', 'é'] },
  { sound: 'I', letters: ['i', 'ì'] },
  { sound: 'O', letters: ['o', 'ò'] },
  { sound: 'U', letters: ['u', 'ù'] },
  { sound: '', letters: ['b', 'c', 'd', 'f', 'g', 'h', 'l', 'm', 'n', 'p', 'q', 'r', 's', 't', 'v', 'z'] },
];

/**
 * The Entry screen's back control. A cold deep link has no screen behind it, so it goes to
 * Search. An entry the app opened has its screen behind it in history, so it steps back there.
 *
 * @param {string} from the last tab screen the app drew, or `''` for a cold link
 * @returns {{ label: string, history: boolean }}
 */
export function backTarget(from) {
  if (from === '' || from === 'entry') return { label: 'Search', history: false };
  return { label: from.charAt(0).toUpperCase() + from.slice(1), history: true };
}

/**
 * The FORMS table: one row per person of a personal tense, one row per other tense, in the fixed
 * order, starting at the present. Pure, so the order is checked without a document.
 *
 * @param {ConjGroup[]} conj
 * @returns {Array<{ label: string, value: string }>}
 */
export function formRows(conj) {
  /** @type {Array<{ label: string, value: string }>} */
  const rows = [];
  for (const [key, name, personal] of TENSES) {
    const group = conj.find((entry) => entry.key === key);
    if (group === undefined) continue;
    if (personal) {
      PERSONS.forEach((person, index) => {
        const value = group.forms[index];
        if (typeof value === 'string' && value !== '') rows.push({ label: name + ' · ' + person, value });
      });
    } else {
      const value = group.forms.filter((form) => form !== '').join(', ');
      if (value !== '') rows.push({ label: name, value });
    }
  }
  return rows;
}

/**
 * Build the screens against one document.
 *
 * @param {Document} [doc] defaults to the browser's; inject a fake in Node checks
 * @returns {{
 *   tabBar: () => HTMLElement,
 *   setActiveTab: (bar: HTMLElement, name: string) => void,
 *   setTabBadge: (bar: HTMLElement, name: string, value: string) => void,
 *   searchScreen: (options: {
 *     search: (query: string) => Promise<{ rows: Row[], history: string[] }>,
 *     onCommit?: (query: string) => void,
 *   }) => { node: HTMLElement, query: () => string, setQuery: (value: string) => void, refresh: () => void },
 *   textScreen: (options: {
 *     read: (segments: Segment[]) => Promise<Map<string, Match | null>>,
 *   }) => HTMLElement,
 *   entryScreen: (options: {
 *     row: Row,
 *     load: Promise<Entry | null>,
 *     examples: (indexes: number[]) => Promise<string[]>,
 *     query?: string,
 *     back?: { label: string, go?: () => void },
 *     speech?: { available: () => boolean, speak: (text: string) => boolean },
 *     lists?: () => UserList[],
 *     listIds?: (id: string) => string[],
 *     toggleItem?: (listId: string, item: { id: string, word: string }) => void,
 *     addList?: (name: string, label: string) => UserList,
 *     note?: (id: string) => string,
 *     setNote?: (id: string, text: string, word: string) => void,
 *   }) => HTMLElement,
 *   studyScreen: (options: {
 *     decks: () => Promise<Deck[]>,
 *     cards: (deckId: string) => Promise<Array<{ id: string, word?: string, gloss?: string }>>,
 *     load: (id: string) => Promise<{ word: string, ipa: string, sense: string, example: string } | null>,
 *     grade: (id: string, remembered: boolean) => void,
 *     note: (id: string) => string,
 *     setNote: (id: string, text: string) => void,
 *     speech: { available: () => boolean, speak: (text: string) => boolean },
 *     entryHref: (id: string) => string,
 *     onGrade?: () => void,
 *   }) => { node: HTMLElement, refresh: () => void, start: (id: string) => Promise<void> },
 *   listsScreen: (options: ListsOptions) => { node: HTMLElement, refresh: () => void },
 *   settingsScreen: (options: SettingsOptions) => { node: HTMLElement, refresh: () => void },
 *   referenceScreen: (options: ReferenceOptions) => { node: HTMLElement, refresh: () => void },
 *   placeholder: (options: { title: string, note: string }) => HTMLElement,
 * }}
 */
export function createUi(doc = globalThis.document) {
  if (!doc || typeof doc.createElement !== 'function') {
    throw new Error('itadict ui: a document-like object is required');
  }

  /**
   * @template {keyof HTMLElementTagNameMap} T
   * @param {T} tag
   * @param {string} [className]
   * @returns {HTMLElementTagNameMap[T]}
   */
  function el(tag, className) {
    const node = doc.createElement(tag);
    if (className !== undefined) node.className = className;
    return node;
  }

  /**
   * An element carrying one piece of text — the only way this module writes copy.
   * @param {keyof HTMLElementTagNameMap} tag
   * @param {string} [className]
   * @param {string} [value]
   * @returns {HTMLElement}
   */
  function text(tag, className, value) {
    const node = el(tag, className);
    if (value !== undefined) node.textContent = value;
    return node;
  }

  /**
   * One inline SVG path.
   * @param {string} d
   * @param {string} [className]
   * @param {string} [viewBox]
   * @returns {SVGElement}
   */
  function icon(d, className, viewBox = '0 0 24 24') {
    const svg = doc.createElementNS(NAMESPACE, 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('aria-hidden', 'true');
    if (className !== undefined) svg.setAttribute('class', className);
    const shape = doc.createElementNS(NAMESPACE, 'path');
    shape.setAttribute('d', d);
    svg.append(shape);
    return svg;
  }

  /**
   * The one-line state under the field.
   * @param {string} line
   * @returns {HTMLElement}
   */
  function message(line) {
    return text('p', 'empty', line);
  }

  /**
   * One tappable catalogue row: an icon, a name, an optional count or note, and a chevron.
   * A row with an href is a link; a row without one is a button.
   *
   * @param {{
   *   path: string,
   *   tint?: string,
   *   name: string,
   *   count?: number,
   *   note?: string,
   *   checked?: boolean,
   *   href?: string,
   *   external?: boolean,
   *   onOpen?: () => void,
   * }} row
   * @returns {HTMLElement}
   */
  function navRow(row) {
    const item = el('li');
    /** @type {HTMLElement} */
    let node;
    if (row.href === undefined) {
      const button = el('button', 'row lists-row');
      button.type = 'button';
      if (row.onOpen !== undefined) button.addEventListener('click', row.onOpen);
      node = button;
    } else {
      const link = el('a', 'row lists-row');
      link.href = row.href;
      if (row.external === true) {
        link.target = '_blank';
        link.rel = 'noopener';
      }
      node = link;
    }
    if (row.tint !== undefined) node.setAttribute('data-tint', row.tint);
    const mark = el('span', 'row-icon');
    mark.append(icon(row.path, 'row-glyph'));
    const main = el('span', 'row-main');
    const name = text('span', 'row-headword', row.name);
    if (row.count !== undefined) name.append(text('span', 'lists-count', ' (' + row.count + ')'));
    main.append(name);
    if (row.note !== undefined && row.note !== '') main.append(text('span', 'row-pronunciation', row.note));
    node.append(mark, main);
    if (row.checked === true) node.append(text('span', 'row-check', '✓'));
    else node.append(icon(CHEVRON, 'chevron', '0 0 8 13'));
    item.append(node);
    return item;
  }

  /**
   * One top bar: a left control, the centred title and the right actions.
   * @param {string} title
   * @param {HTMLElement | null} left
   * @param {HTMLElement[]} actions
   * @returns {HTMLElement}
   */
  function headerBar(title, left, actions) {
    const bar = el('header', 'navbar');
    if (left !== null) bar.append(left);
    bar.append(text('span', 'navbar-title', title));
    const box = el('div', 'navbar-actions');
    for (const action of actions) box.append(action);
    bar.append(box);
    return bar;
  }

  /**
   * @param {string} label
   * @param {() => void} onClick
   * @param {string} [className]
   * @param {string} [ariaLabel] for a glyph-only control
   * @returns {HTMLButtonElement}
   */
  function barButton(label, onClick, className = 'back', ariaLabel = '') {
    const button = el('button', className);
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    if (ariaLabel !== '') {
      button.setAttribute('aria-label', ariaLabel);
      button.title = ariaLabel;
    }
    return button;
  }

  /** @param {number} size @returns {string} a short byte count */
  function bytes(size) {
    if (size >= 1000000) return (size / 1000000).toFixed(1) + ' MB';
    if (size >= 1000) return Math.round(size / 1000) + ' KB';
    return Math.max(0, Math.round(size)) + ' bytes';
  }

  /** @type {HTMLElement | null} the one open sheet */
  let sheetNode = null;

  /**
   * A bottom sheet. One at a time. The backdrop, the close control and Escape all close it.
   * @param {string} title
   * @param {(close: () => void) => HTMLElement} build
   */
  function openSheet(title, build) {
    if (sheetNode !== null) sheetNode.remove();
    const backdrop = el('div', 'sheet-backdrop');
    const sheet = el('div', 'sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', title);
    const head = el('header', 'sheet-head');
    const titleNode = text('h2', 'sheet-title', title);
    const closeButton = el('button', 'sheet-close');
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Close');
    head.append(titleNode, closeButton);
    const body = el('div', 'sheet-body');
    const close = () => {
      backdrop.remove();
      if (sheetNode === backdrop) sheetNode = null;
      doc.removeEventListener('keydown', onKey);
    };
    /** @param {KeyboardEvent} event */
    const onKey = (event) => {
      if (event.key === 'Escape') close();
    };
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });
    closeButton.addEventListener('click', close);
    doc.addEventListener('keydown', onKey);
    body.append(build(close));
    sheet.append(head, body);
    backdrop.append(sheet);
    (doc.body ?? doc.documentElement).append(backdrop);
    sheetNode = backdrop;
    const first = sheet.querySelector('input, textarea, button');
    if (first !== null && typeof /** @type {HTMLElement} */ (first).focus === 'function') {
      /** @type {HTMLElement} */ (first).focus();
    }
  }

  /**
   * A sheet that takes one JSON file or a paste and reports the result.
   * @param {string} title
   * @param {string} action
   * @param {(text: string) => { ok: boolean, error?: string, cancelled?: boolean, line?: string }} run
   */
  function jsonSheet(title, action, run) {
    openSheet(title, () => {
      const box = el('div', 'sheet-stack');
      const file = el('input', 'sheet-file');
      file.type = 'file';
      file.accept = 'application/json,.json';
      file.setAttribute('aria-label', 'JSON file');
      const area = el('textarea', 'sheet-input sheet-area');
      area.rows = 5;
      area.placeholder = 'Paste the file here';
      file.addEventListener('change', () => {
        const picked = file.files?.[0];
        if (picked === undefined) return;
        picked.text().then(
          (text) => {
            area.value = text;
          },
          () => {
            area.focus();
          },
        );
      });
      const result = text('p', 'sheet-result', '');
      result.setAttribute('role', 'status');
      result.hidden = true;
      const go = el('button', 'sheet-button');
      go.type = 'button';
      go.textContent = action;
      go.addEventListener('click', () => {
        const outcome = run(area.value);
        result.textContent = outcome.ok
          ? outcome.line ?? 'Done.'
          : outcome.cancelled === true
            ? 'Nothing changed.'
            : outcome.error ?? 'That file is not valid.';
        result.hidden = false;
      });
      const fileField = el('label', 'sheet-field');
      fileField.append(text('span', 'sheet-label', 'File'), file);
      const areaField = el('label', 'sheet-field');
      areaField.append(text('span', 'sheet-label', 'Or paste'), area);
      box.append(fileField, areaField, go, result);
      return box;
    });
  }

  /**
   * One labelled segmented control.
   * @param {string} title
   * @param {string[]} labels
   * @param {string[]} values
   * @param {string} current
   * @param {(value: string) => void} onPick
   * @returns {HTMLElement}
   */
  function segment(title, labels, values, current, onPick) {
    const wrap = el('div', 'settings-segment');
    wrap.append(text('span', 'settings-label', title));
    const row = el('div', 'modes');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', title);
    labels.forEach((label, index) => {
      const value = values[index] ?? '';
      const button = el('button', 'mode');
      button.type = 'button';
      button.textContent = label;
      const on = value === current;
      if (on) button.className = 'mode is-on';
      button.setAttribute('aria-pressed', String(on));
      button.addEventListener('click', () => onPick(value));
      row.append(button);
    });
    wrap.append(row);
    return wrap;
  }

  /**
   * The Offline section: the size, the download action and the progress line.
   * @param {{
   *   download: (onProgress: (done: number, total: number, failed: number) => void) => Promise<{ total: number, failures: unknown[] }>,
   *   offline: () => Promise<{ files: number, bytes: number }>,
   * }} options
   * @returns {HTMLElement}
   */
  function offlineBlock(options) {
    const wrap = el('section', 'offline-block');
    wrap.append(text('h2', 'section-title', 'Offline'));
    const size = text('p', 'settings-line', 'The dictionary size is not known yet.');
    const note = text('p', 'settings-note', 'Download it once and the app opens with no network.');
    const button = el('button', 'settings-button');
    button.type = 'button';
    button.textContent = 'Download the dictionary';
    const progress = text('p', 'settings-line', '');
    progress.setAttribute('role', 'status');
    progress.hidden = true;
    options.offline().then(
      (info) => {
        size.textContent = 'The dictionary is ' + bytes(info.bytes) + ', in ' + info.files + ' files.';
      },
      () => {
        size.textContent = 'The dictionary size is not known yet.';
      },
    );
    button.addEventListener('click', () => {
      if (button.disabled) return;
      button.disabled = true;
      progress.hidden = false;
      progress.textContent = 'Downloading…';
      options
        .download((done, total, failed) => {
          progress.textContent = 'Downloading ' + done + ' / ' + total + ' files' + (failed > 0 ? ', ' + failed + ' failed' : '') + '.';
        })
        .then(
          (result) => {
            progress.textContent = result.total + ' files done, ' + result.failures.length + ' failed.';
          },
          () => {
            progress.textContent = 'The download did not finish.';
          },
        )
        .then(() => {
          button.disabled = false;
        });
    });
    wrap.append(size, note, button, progress);
    return wrap;
  }

  /**
   * The bottom tab bar. Built once and kept: navigating must not rebuild the chrome.
   * @returns {HTMLElement}
   */
  function tabBar() {
    const bar = el('nav', 'tabbar');
    bar.setAttribute('aria-label', 'Screens');
    for (const [name, label, path] of TABS) {
      const link = el('a', 'tab');
      link.href = HASH[name];
      link.setAttribute('data-tab', name);
      const badge = text('span', 'tab-badge', '');
      badge.hidden = true;
      link.append(icon(path), text('span', 'tab-label', label), badge);
      bar.append(link);
    }
    return bar;
  }

  /**
   * A small count on one tab, or no badge when the value is empty.
   * @param {HTMLElement} bar
   * @param {string} name
   * @param {string} value
   */
  function setTabBadge(bar, name, value) {
    for (const node of Array.from(bar.children)) {
      if (node.getAttribute('data-tab') !== name) continue;
      const badge = /** @type {HTMLElement | null} */ (node.querySelector('.tab-badge'));
      if (!badge) continue;
      badge.textContent = value;
      badge.hidden = value === '';
    }
  }

  /**
   * @param {HTMLElement} bar
   * @param {string} name the route on screen
   */
  function setActiveTab(bar, name) {
    for (const node of Array.from(bar.children)) {
      const active = node.getAttribute('data-tab') === name;
      node.className = active ? 'tab is-active' : 'tab';
      if (active) node.setAttribute('aria-current', 'page');
      else node.removeAttribute('aria-current');
    }
  }

  /**
   * The Search screen. Its node is built once and kept by the app, so a query, the rows and the
   * field's value survive a trip into an entry and back. A promise that resolves late, after a
   * newer query, is dropped: only the newest answer reaches the DOM.
   *
   * @param {{
   *   search: (query: string) => Promise<{ rows: Row[], history: string[] }>,
   *   onCommit?: (query: string) => void,
   * }} options
   */
  function searchScreen(options) {
    const section = el('section', 'screen search');
    section.setAttribute('aria-label', 'Search');

    const form = el('form', 'search-form');
    form.setAttribute('role', 'search');
    const field = el('div', 'search-field');
    const input = el('input', 'search-input');
    input.type = 'search';
    input.placeholder = 'Search Italian';
    input.setAttribute('aria-label', 'Search Italian');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('enterkeyhint', 'search');
    input.spellcheck = false;

    const clear = el('button', 'search-clear');
    clear.type = 'button';
    clear.textContent = '×';
    clear.setAttribute('aria-label', 'Clear search');
    clear.addEventListener('click', () => {
      input.value = '';
      input.focus();
      void run();
    });

    field.append(icon(MAGNIFIER, 'search-icon'), input, clear);
    form.append(field);

    /**
     * The two input modes. `letters` shows the palette under the field.
     * @type {'keypad' | 'letters'}
     */
    let mode = 'keypad';

    const modes = el('div', 'modes');
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Input method');

    // The palette is built once and hidden in keypad mode, so a mode change costs no DOM work.
    const palette = el('div', 'palette');
    palette.setAttribute('role', 'group');
    palette.setAttribute('aria-label', 'Italian letters');
    for (const family of PALETTE) {
      const group = el('div', 'palette-group');
      if (family.sound === '') group.className = 'palette-group is-consonants';
      else group.append(text('span', 'palette-sound', family.sound));
      for (const letter of family.letters) {
        const key = el('button', 'key');
        key.type = 'button';
        key.textContent = letter;
        key.setAttribute('aria-label', 'Add ' + letter);
        key.addEventListener('click', () => {
          input.value += letter;
          void run();
        });
        group.append(key);
      }
      palette.append(group);
    }

    /**
     * @param {'keypad' | 'letters'} name
     * @param {string} label
     * @returns {HTMLButtonElement}
     */
    function modeButton(name, label) {
      const button = el('button', 'mode');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        mode = name;
        paintModes();
        // The palette stands in for the software keyboard, so the keyboard goes away.
        if (name === 'letters') input.blur();
        else input.focus();
      });
      modes.append(button);
      return button;
    }

    const keypadButton = modeButton('keypad', 'Keypad');
    const lettersButton = modeButton('letters', 'Letters');

    function paintModes() {
      keypadButton.className = mode === 'keypad' ? 'mode is-on' : 'mode';
      lettersButton.className = mode === 'letters' ? 'mode is-on' : 'mode';
      keypadButton.setAttribute('aria-pressed', String(mode === 'keypad'));
      lettersButton.setAttribute('aria-pressed', String(mode === 'letters'));
      palette.hidden = mode !== 'letters';
    }
    paintModes();

    const head = el('header', 'search-head');
    head.append(form, modes);
    const body = el('div', 'search-body');
    section.append(head, palette, body);

    let token = 0;

    /** @param {Row} row */
    function rowView(row) {
      const item = el('li');
      const link = el('a', 'row');
      link.href = entryHash(row.id);
      const main = el('span', 'row-main');
      main.append(text('span', 'row-headword', row.headword));
      // A row matched through an inflected form shows that form; the pronunciation otherwise.
      const secondary = row.matched ?? row.pronunciation;
      if (secondary !== '') main.append(text('span', 'row-pronunciation', secondary));
      if (row.pos !== '') main.append(text('span', 'row-pos', row.pos));
      link.append(main);
      if (row.gloss !== '') link.append(text('span', 'row-gloss', row.gloss));
      link.addEventListener('click', () => options.onCommit?.(input.value));
      item.append(link);
      return item;
    }

    /** @param {string[]} history */
    function historyView(history) {
      const wrap = el('div', 'history');
      wrap.append(text('h2', 'section-title', 'History'));
      const list = el('ul', 'rows');
      for (const query of history) {
        const item = el('li');
        const button = el('button', 'row history-row');
        button.type = 'button';
        button.textContent = query;
        button.addEventListener('click', () => {
          input.value = query;
          input.focus();
          void run();
        });
        item.append(button);
        list.append(item);
      }
      wrap.append(list);
      return wrap;
    }

    /**
     * @param {string} query
     * @param {Row[]} rows
     * @param {string[]} history
     */
    function draw(query, rows, history) {
      const trimmed = query.trim();
      if (rows.length > 0) {
        const list = el('ul', 'rows');
        for (const row of rows) list.append(rowView(row));
        body.replaceChildren(list);
        return;
      }
      if (history.length > 0) {
        body.replaceChildren(historyView(history));
        return;
      }
      if (trimmed.length < 2) {
        body.replaceChildren(message(trimmed === '' ? 'Type a word to search.' : 'Keep typing.'));
        return;
      }
      body.replaceChildren(message(`No results for "${trimmed}".`));
    }

    async function run() {
      const query = input.value;
      const mine = (token += 1);
      clear.className = query === '' ? 'search-clear' : 'search-clear is-shown';
      /** @type {{ rows: Row[], history: string[] }} */
      let result;
      try {
        result = await options.search(query);
      } catch {
        if (mine === token) body.replaceChildren(message('The dictionary is not ready yet.'));
        return;
      }
      if (mine !== token) return;
      draw(query, result.rows, result.history);
    }

    input.addEventListener('input', () => {
      void run();
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      options.onCommit?.(input.value);
      void run();
    });

    void run(); // first paint: the stored history

    return {
      node: section,
      query: () => input.value,
      /**
       * Put a query in the field and run it, for the History row on Lists.
       * @param {string} value
       */
      setQuery: (value) => {
        input.value = value;
        void run();
      },
      refresh: () => {
        void run();
      },
    };
  }

  /**
   * The Entry screen. The headword from the result row is drawn at once, so the screen never
   * flashes empty; the body fills the sections when it arrives, and the example sentences fill
   * after that. A body that never arrives says so in one line and hides what it cannot fill.
   *
   * @param {{
   *   row: Row,
   *   load: Promise<Entry | null>,
   *   examples: (indexes: number[]) => Promise<string[]>,
   *   query?: string,
   *   back?: { label: string, go?: () => void },
   *   speech?: { available: () => boolean, speak: (text: string) => boolean },
   *   lists?: () => UserList[],
   *   listIds?: (id: string) => string[],
   *   toggleItem?: (listId: string, item: { id: string, word: string }) => void,
   *   addList?: (name: string, label: string) => UserList,
   *   note?: (id: string) => string,
   *   setNote?: (id: string, text: string, word: string) => void,
   * }} options
   * @returns {HTMLElement}
   */
  function entryScreen(options) {
    const row = options.row;
    const section = el('section', 'screen entry-screen');

    const bar = el('header', 'navbar');
    const back = el('a', 'back');
    back.href = HASH.search;
    const label = options.back?.label ?? 'Search';
    back.textContent = '‹ ' + label;
    back.setAttribute('aria-label', 'Back to ' + label.toLowerCase());
    // The href stays the cold-link fallback; an in-app entry steps back to the screen behind it.
    const go = options.back?.go;
    if (go !== undefined) {
      back.addEventListener('click', (event) => {
        event.preventDefault();
        go();
      });
    }
    const title = text('span', 'navbar-title', row.headword);
    const actions = el('div', 'navbar-actions');
    // A speaker that cannot speak is never drawn.
    if (options.speech?.available()) {
      const speak = el('button', 'action');
      speak.type = 'button';
      speak.textContent = '🔈';
      speak.setAttribute('aria-label', 'Speak');
      speak.title = 'Speak';
      speak.addEventListener('click', () => options.speech?.speak(row.headword));
      actions.append(speak);
    }
    if (options.lists !== undefined && options.toggleItem !== undefined) actions.append(listAction());
    if (options.setNote !== undefined) actions.append(noteAction());
    bar.append(back, title, actions);

    /**
     * The add-to-list control. It shows a tick when the entry sits in at least one list.
     * @returns {HTMLButtonElement}
     */
    function listAction() {
      const button = el('button', 'action action-list');
      button.type = 'button';
      const paint = () => {
        const held = (options.listIds?.(row.id) ?? []).length > 0;
        button.replaceChildren(held ? text('span', 'action-glyph', '✓') : text('span', 'action-glyph', '+'));
        button.className = held ? 'action action-list is-on' : 'action action-list';
        button.setAttribute('aria-label', held ? 'In a list' : 'Add to list');
        button.title = held ? 'In a list' : 'Add to list';
        button.setAttribute('aria-pressed', String(held));
      };
      button.addEventListener('click', () => openListSheet(paint));
      paint();
      return button;
    }

    /**
     * The sheet: every list with its state, and a name field that creates one inline.
     * @param {() => void} after
     */
    function openListSheet(after) {
      openSheet('Add to list', () => {
        const box = el('div', 'sheet-stack');
        const host = el('div');
        const refresh = () => {
          const lists = options.lists?.() ?? [];
          if (lists.length === 0) {
            host.replaceChildren(message('No lists yet. Create one below.'));
            return;
          }
          const held = new Set(options.listIds?.(row.id) ?? []);
          const ul = el('ul', 'rows');
          for (const list of lists) {
            ul.append(
              navRow({
                path: ICONS.list,
                tint: list.label.toLowerCase(),
                name: list.name,
                count: list.items.length,
                checked: held.has(list.id),
                onOpen: () => {
                  options.toggleItem?.(list.id, { id: row.id, word: row.headword });
                  refresh();
                  after();
                },
              }),
            );
          }
          host.replaceChildren(ul);
        };
        const name = el('input', 'sheet-input');
        name.type = 'text';
        name.placeholder = 'New list name';
        name.setAttribute('aria-label', 'New list name');
        const create = el('button', 'sheet-button');
        create.type = 'button';
        create.textContent = 'Create and add';
        create.addEventListener('click', () => {
          const value = name.value.trim();
          if (value === '') {
            name.focus();
            return;
          }
          const list = options.addList?.(value, 'Other');
          if (list !== undefined) options.toggleItem?.(list.id, { id: row.id, word: row.headword });
          name.value = '';
          refresh();
          after();
        });
        const field = el('label', 'sheet-field');
        field.append(text('span', 'sheet-label', 'New list'), name);
        box.append(host, field, create);
        refresh();
        return box;
      });
    }

    /**
     * The note control: a sheet with the entry's note, and Save.
     * @returns {HTMLButtonElement}
     */
    function noteAction() {
      const button = el('button', 'action');
      button.type = 'button';
      button.append(icon('M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z', 'action-glyph-icon'));
      button.setAttribute('aria-label', 'Note');
      button.title = 'Note';
      button.addEventListener('click', () => {
        openSheet('Note for ' + row.headword, (close) => {
          const box = el('div', 'sheet-stack');
          const area = el('textarea', 'sheet-input sheet-area');
          area.rows = 5;
          area.value = options.note?.(row.id) ?? '';
          area.placeholder = 'Write a note about this entry…';
          area.setAttribute('aria-label', 'Note');
          const save = el('button', 'sheet-button');
          save.type = 'button';
          save.textContent = 'Save note';
          save.addEventListener('click', () => {
            options.setNote?.(row.id, area.value, row.headword);
            close();
          });
          box.append(area, save, text('p', 'sheet-note', 'An empty note removes it.'));
          return box;
        });
      });
      return button;
    }

    const block = el('div', 'headword-block');
    const pronunciation = text('p', 'pronunciation', row.pronunciation);
    pronunciation.hidden = row.pronunciation === '';
    const headword = text('h1', 'headword', row.headword);
    block.append(pronunciation, headword);

    const translation = el('section', 'block');
    translation.append(text('h2', 'section-title', 'Translation'));

    const forms = el('section', 'block');
    forms.append(text('h2', 'section-title', 'Forms'));

    const examples = el('section', 'block');
    examples.append(text('h2', 'section-title', 'Examples'));

    section.append(bar, block, translation, forms, examples);

    /**
     * A sentence with the matched word marked in red.
     * @param {string} line
     * @param {string} needle
     * @returns {DocumentFragment}
     */
    function highlight(line, needle) {
      const fragment = doc.createDocumentFragment();
      const match = needle === '' ? null : findMatch(line, needle);
      if (match === null) {
        fragment.append(doc.createTextNode(line));
        return fragment;
      }
      fragment.append(
        doc.createTextNode(line.slice(0, match.start)),
        text('mark', undefined, line.slice(match.start, match.end)),
        doc.createTextNode(line.slice(match.end)),
      );
      return fragment;
    }

    /** @param {Entry | null} entry */
    function fill(entry) {
      if (entry === null) {
        translation.append(message('This entry is not ready yet.'));
        forms.hidden = true;
        examples.hidden = true;
        return;
      }
      if (entry.headword !== '') {
        headword.textContent = entry.headword;
        title.textContent = entry.headword;
      }
      if (entry.pronunciation !== '') {
        pronunciation.textContent = entry.pronunciation;
        pronunciation.hidden = false;
      }

      const labelled = entry.posList.length > 1;
      for (const group of entry.posList) {
        if (labelled && group.pos !== '') translation.append(text('p', 'sense-pos', group.pos));
        for (const sense of group.senses) translation.append(text('p', 'sense', sense));
      }
      if (entry.posList.length === 0) translation.append(message('No definition yet.'));

      const rows = formRows(entry.conj);
      if (rows.length === 0) {
        forms.hidden = true;
      } else {
        const list = el('dl', 'forms');
        for (const form of rows) list.append(text('dt', undefined, form.label), text('dd', undefined, form.value));
        forms.append(list);
      }

      // A prefix search ("cas" for "casa") marks the whole word; a form search marks the form.
      const typed = (options.query ?? '').trim();
      const needle = typed !== '' && !fold(entry.headword).startsWith(fold(typed)) ? typed : entry.headword;
      if (entry.exampleIndexes.length === 0) {
        examples.hidden = true;
        return;
      }
      // The headword and the definition are already drawn; the sentences are their own fetch.
      Promise.resolve(options.examples(entry.exampleIndexes)).then(
        (sentences) => {
          if (sentences.length === 0) {
            examples.hidden = true;
            return;
          }
          const list = el('ul', 'examples');
          for (const line of sentences) {
            const item = el('li', 'example');
            const body = el('span');
            body.append(highlight(line, needle));
            item.append(body, icon('M1 1.2 6.2 6.5 1 11.8', 'chevron', '0 0 8 13'));
            list.append(item);
          }
          examples.append(list);
        },
        () => {
          examples.hidden = true;
        },
      );
    }

    Promise.resolve(options.load).then(
      (entry) => fill(entry),
      () => fill(null),
    );

    return section;
  }

  /**
   * The Text reader. The textarea stays on screen, so a paste can be fixed and read again. The
   * result is one summary line, the text as flowing words, and the words the dictionary misses.
   *
   * @param {{ read: (segments: Segment[]) => Promise<Map<string, Match | null>> }} options
   * @returns {HTMLElement}
   */
  function textScreen(options) {
    const section = el('section', 'screen text-screen');
    section.setAttribute('aria-label', 'Text');

    const head = el('header', 'text-head');
    const form = el('form', 'text-form');
    const input = el('textarea', 'text-input');
    input.rows = 4;
    input.placeholder = 'Paste Italian text';
    input.setAttribute('aria-label', 'Italian text');
    input.spellcheck = false;
    const submit = el('button', 'text-submit');
    submit.type = 'submit';
    submit.textContent = 'Read';
    form.append(input, submit);
    head.append(text('h1', 'page-title', 'Text'), form);

    const result = el('div', 'text-result');
    section.append(head, result);

    /** Only the newest paste reaches the screen. */
    let token = 0;

    /**
     * @param {Map<string, Match | null>} resolved
     * @param {Segment[]} segments
     * @param {boolean} truncated
     * @param {{ total: number, known: number, unknown: Array<{ word: string, count: number }> }} summary
     */
    function draw(resolved, segments, truncated, summary) {
      const fragment = doc.createDocumentFragment();
      const words = summary.total === 1 ? 'word' : 'words';
      fragment.append(
        text(
          'p',
          'text-summary',
          `${summary.total} ${words}, ${summary.known} in the dictionary, ${summary.unknown.length} not found`,
        ),
      );
      if (truncated) fragment.append(text('p', 'note', `Long text: only the first ${WORD_CAP} words are read.`));

      const read = el('p', 'text-read');
      for (const segment of segments) {
        const match = segment.word ? resolved.get(fold(segment.text)) ?? null : null;
        if (match === null) {
          read.append(doc.createTextNode(segment.text));
          continue;
        }
        const link = el('a', 'text-word');
        link.href = entryHash(match.id);
        link.textContent = segment.text;
        read.append(link);
      }
      fragment.append(read);

      if (summary.unknown.length > 0) {
        fragment.append(text('h2', 'section-title', 'Not in the dictionary'));
        const list = el('ul', 'unknown');
        for (const item of summary.unknown) {
          const rowNode = el('li', 'unknown-row');
          rowNode.append(text('span', 'unknown-word', item.word), text('span', 'unknown-count', '×' + item.count));
          list.append(rowNode);
        }
        fragment.append(list);
      }
      result.replaceChildren(fragment);
    }

    async function read() {
      const mine = (token += 1);
      if (input.value.trim() === '') {
        result.replaceChildren(message('Paste some Italian text.'));
        return;
      }
      const { segments, truncated } = tokenize(input.value);
      if (!segments.some((segment) => segment.word)) {
        result.replaceChildren(message('No words in this text.'));
        return;
      }
      result.replaceChildren(message('Reading…'));
      /** @type {Map<string, Match | null>} */
      let resolved;
      try {
        resolved = await options.read(segments);
      } catch {
        if (mine === token) result.replaceChildren(message('The dictionary is not ready yet.'));
        return;
      }
      if (mine !== token) return;
      draw(resolved, segments, truncated, summarise(segments, resolved));
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void read();
    });

    return section;
  }

  /**
   * The Study screen: a deck list, then one full-screen card at a time.
   *
   * A run grades one card at a time, by swipe or by the two buttons, and the app writes the
   * result at once. The app keeps this node alive, so tapping the headword, reading the entry
   * and coming back lands on the same card.
   *
   * @param {{
   *   decks: () => Promise<Deck[]>,
   *   cards: (deckId: string) => Promise<Array<{ id: string, word?: string, gloss?: string }>>,
   *   load: (id: string) => Promise<{ word: string, ipa: string, sense: string, example: string } | null>,
   *   grade: (id: string, remembered: boolean) => void,
   *   note: (id: string) => string,
   *   setNote: (id: string, text: string) => void,
   *   speech: { available: () => boolean, speak: (text: string) => boolean },
   *   entryHref: (id: string) => string,
   *   onGrade?: () => void,
   * }} options
   * @returns {{ node: HTMLElement, refresh: () => void, start: (id: string) => Promise<void> }}
   */
  function studyScreen(options) {
    const section = el('section', 'screen study-screen');
    section.setAttribute('aria-label', 'Study');

    const picker = el('div', 'study-picker');
    const run = el('div', 'study-run');
    run.hidden = true;
    const done = el('div', 'study-finish');
    done.hidden = true;
    section.append(picker, run, done);

    /** @type {'picker' | 'card' | 'done'} */
    let screen = 'picker';
    /** @type {Array<{ id: string, word?: string, gloss?: string }>} */
    let cards = [];
    let index = 0;
    let graded = 0;
    let remembered = 0;
    let forgot = 0;
    let lastGrade = '';
    let deckTitle = '';
    let deckToken = 0;
    let cardToken = 0;
    /** @type {any} */ let fill = null;
    /** @type {any} */ let gradeLabel = null;
    /** @type {any} */ let remainingLabel = null;
    /** @type {any} */ let cardHost = null;

    /** @param {'picker' | 'card' | 'done'} next */
    function show(next) {
      screen = next;
      picker.hidden = next !== 'picker';
      run.hidden = next !== 'card';
      done.hidden = next !== 'done';
    }

    function paintProgress() {
      const total = cards.length;
      const remaining = Math.max(0, total - graded);
      // A deck can hold hundreds of cards; keep the first grade visible.
      if (fill) fill.style.width = (total === 0 || graded === 0 ? 0 : Math.max(0.6, (graded / total) * 100)) + '%';
      if (gradeLabel) gradeLabel.textContent = lastGrade === '' ? 'Ready' : lastGrade;
      if (remainingLabel) {
        remainingLabel.textContent = String(remaining);
        remainingLabel.setAttribute('aria-label', remaining === 1 ? '1 card left' : remaining + ' cards left');
      }
    }

    async function drawDecks() {
      const mine = (deckToken += 1);
      /** @type {Deck[]} */
      let decks = [];
      try {
        decks = await options.decks();
      } catch {
        decks = [];
      }
      if (mine !== deckToken || screen !== 'picker') return;
      const list = el('ul', 'decks');
      for (const deck of decks) {
        const item = el('li');
        const button = el('button', 'row deck');
        button.type = 'button';
        button.setAttribute('data-deck', deck.id);
        const main = el('span', 'row-main');
        main.append(text('span', 'row-headword', deck.title));
        if (deck.note) main.append(text('span', 'row-pronunciation', deck.note));
        button.append(main, text('span', 'deck-count', String(deck.count)));
        button.addEventListener('click', () => {
          if (deck.count > 0) void openDeck(deck);
        });
        item.append(button);
        list.append(item);
      }
      const dueDeck = decks.find((deck) => deck.id === 'due');
      const due = dueDeck ? dueDeck.count : 0;
      picker.replaceChildren(
        text('h1', 'page-title', 'Study'),
        text('p', 'study-due', due === 1 ? '1 card due today.' : due + ' cards due today.'),
        list,
        text('p', 'study-note', 'CEFR bands are approximate, derived from frequency.'),
        text('p', 'study-note', 'Review reminders show only while the app is open. iOS has no web push for a web app.'),
      );
    }

    /** @param {Deck} deck */
    async function openDeck(deck) {
      const mine = (deckToken += 1);
      /** @type {Array<{ id: string, word?: string, gloss?: string }>} */
      let list = [];
      try {
        list = await options.cards(deck.id);
      } catch {
        list = [];
      }
      if (mine !== deckToken) return;
      cards = list;
      index = 0;
      graded = 0;
      remembered = 0;
      forgot = 0;
      lastGrade = '';
      deckTitle = deck.title;
      if (cards.length === 0) {
        show('picker');
        void drawDecks();
        return;
      }
      paintRun();
      show('card');
      void showCard();
    }

    function paintRun() {
      const top = el('header', 'study-top');
      const close = el('button', 'study-close');
      close.type = 'button';
      close.textContent = '×';
      close.setAttribute('aria-label', 'Close this run');
      close.addEventListener('click', () => {
        deckToken += 1;
        cardToken += 1;
        show('picker');
        void drawDecks();
      });
      const progress = el('div', 'study-progress');
      const track = el('div', 'study-track');
      fill = el('div', 'study-fill');
      track.append(fill);
      const meta = el('div', 'study-meta');
      gradeLabel = text('span', 'study-grade', 'Ready');
      remainingLabel = text('span', 'study-left', '0');
      meta.append(gradeLabel, remainingLabel);
      progress.append(track, meta);
      top.append(close, progress);

      cardHost = el('div', 'study-card-host');
      const hints = el('div', 'study-hints');
      hints.append(
        text('p', 'study-hint', 'Swipe right if you remembered, left if not.'),
        text('p', 'study-hint', 'Tap the headword to see the entry.'),
      );
      const actions = el('div', 'study-actions');
      const wrong = el('button', 'study-forgot');
      wrong.type = 'button';
      wrong.textContent = 'Forgot';
      wrong.addEventListener('click', () => grade(false));
      const right = el('button', 'study-remembered');
      right.type = 'button';
      right.textContent = 'Remembered';
      right.addEventListener('click', () => grade(true));
      actions.append(wrong, right);
      run.replaceChildren(top, cardHost, hints, actions);
      paintProgress();
    }

    /**
     * @param {{ word: string, ipa: string, sense: string, example: string }} view
     * @param {string} id
     */
    function paintCard(view, id) {
      if (!cardHost) return;
      const box = el('article', 'study-card');

      const headword = el('a', 'study-headword');
      headword.href = options.entryHref(id);
      headword.textContent = view.word;
      headword.draggable = false;

      const ipa = text('p', 'study-ipa', view.ipa);
      ipa.hidden = view.ipa === '';
      const sense = text('p', 'study-sense', view.sense);
      sense.hidden = view.sense === '';

      const example = el('div', 'study-example');
      example.append(text('span', 'study-label', 'Example'), text('p', 'study-sentence', view.example));
      example.hidden = view.example === '';

      const note = el('div', 'study-note');
      note.append(text('span', 'study-label', 'Note'));
      const field = el('textarea', 'study-note-input');
      field.rows = 2;
      field.placeholder = 'Tap here to add a note...';
      field.setAttribute('aria-label', 'Note');
      field.value = options.note(id);
      field.addEventListener('input', () => options.setNote(id, field.value));
      note.append(field);

      box.append(headword, ipa, sense, example, note);

      // A speaker that cannot speak is never drawn.
      if (options.speech.available()) {
        const speak = el('button', 'study-speak');
        speak.type = 'button';
        speak.setAttribute('aria-label', 'Speak ' + view.word);
        speak.title = 'Speak';
        speak.append(icon('M4 9h3l4-4v14l-4-4H4zM14.5 8a5.5 5.5 0 0 1 0 8', 'study-speak-icon'));
        speak.addEventListener('click', () => options.speech.speak(view.word));
        box.append(speak);
      }

      attachSwipe(box);
      cardHost.replaceChildren(box);
      paintProgress();
    }

    /**
     * Swipe right for remembered, left for forgot. A tap or a tap on a control is not a swipe.
     * @param {HTMLElement} box
     */
    function attachSwipe(box) {
      let startX = 0;
      let startY = 0;
      let dx = 0;
      let active = false;
      let captured = false;
      /**
       * Stop the click a drag would otherwise send to the headword link.
       * @param {Event} event
       */
      const blockClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      // A link under the finger starts a native drag and cancels the swipe.
      box.addEventListener('dragstart', (event) => event.preventDefault());
      box.addEventListener('pointerdown', (event) => {
        const target = /** @type {any} */ (event.target);
        if (target && typeof target.closest === 'function' && target.closest('textarea, input, button')) return;
        startX = event.clientX;
        startY = event.clientY;
        dx = 0;
        active = true;
        captured = false;
        box.style.transition = 'none';
      });
      box.addEventListener('pointermove', (event) => {
        if (!active) return;
        dx = event.clientX - startX;
        if (Math.abs(dx) <= 6 || Math.abs(event.clientY - startY) > 40) return;
        // Capture only once the drag starts, so a tap still reaches the headword link.
        if (!captured && typeof box.setPointerCapture === 'function') {
          box.setPointerCapture(event.pointerId);
          captured = true;
        }
        box.style.transform = 'translateX(' + dx + 'px)';
      });
      const release = () => {
        if (!active) return;
        active = false;
        box.style.transition = '';
        box.style.transform = '';
        if (Math.abs(dx) > 60) {
          // The headword is a link across the whole card, so a drag ends with a click.
          box.addEventListener('click', blockClick, true);
          globalThis.setTimeout(() => box.removeEventListener('click', blockClick, true), 400);
          grade(dx > 0);
        }
        dx = 0;
      };
      box.addEventListener('pointerup', release);
      box.addEventListener('pointercancel', release);
    }

    /** @param {boolean} isRemembered */
    function grade(isRemembered) {
      if (screen !== 'card') return;
      const card = cards[index];
      if (!card) return;
      options.grade(card.id, isRemembered);
      graded += 1;
      if (isRemembered) remembered += 1;
      else forgot += 1;
      lastGrade = isRemembered ? 'Remembered' : 'Forgot';
      index += 1;
      options.onGrade?.();
      if (index >= cards.length) {
        finishRun();
        return;
      }
      paintProgress();
      void showCard();
    }

    async function showCard() {
      const card = cards[index];
      if (!card) return finishRun();
      const mine = (cardToken += 1);
      paintCard({ word: card.word ?? '', ipa: '', sense: card.gloss ?? '', example: '' }, card.id);
      /** @type {{ word: string, ipa: string, sense: string, example: string } | null} */
      let view = null;
      try {
        view = await options.load(card.id);
      } catch {
        view = null;
      }
      if (mine !== cardToken || screen !== 'card') return;
      if (view !== null) paintCard(view, card.id);
    }

    function finishRun() {
      show('done');
      const summary = el('article', 'study-summary');
      summary.append(
        text('h1', 'page-title', deckTitle + ' done'),
        text('p', 'study-total', graded === 1 ? '1 card graded' : graded + ' cards graded'),
        text('p', 'study-total', remembered + ' remembered, ' + forgot + ' forgot'),
      );
      const back = el('button', 'study-done');
      back.type = 'button';
      back.textContent = 'Done';
      back.addEventListener('click', () => {
        show('picker');
        void drawDecks();
      });
      summary.append(back);
      done.replaceChildren(summary);
    }

    section.addEventListener('keydown', (event) => {
      if (screen !== 'card') return;
      const target = /** @type {any} */ (event.target);
      if (target && target.tagName === 'TEXTAREA') return;
      if (event.key === 'ArrowRight') grade(true);
      else if (event.key === 'ArrowLeft') grade(false);
    });

    void drawDecks();

    return {
      node: section,
      /** Re-read the deck counts. A run in progress is left alone. */
      refresh: () => {
        if (screen === 'picker') void drawDecks();
      },
      /**
       * Open one deck by id, from a Reference CEFR row. An empty deck falls back to the picker.
       * @param {string} id
       */
      async start(id) {
        await openDeck({ id, title: id.toUpperCase(), count: 1 });
      },
    };
  }

  /**
   * The Lists tab. The reference layout: History and Notes pinned first, then folders, then the
   * lists. One node holds its own sub-screens, so opening a list and coming back keeps the place.
   * The title bar carries Settings on the left and the add and more controls on the right.
   *
   * @param {ListsOptions} options
   * @returns {{ node: HTMLElement, refresh: () => void }}
   */
  function listsScreen(options) {
    const section = el('section', 'screen lists-screen');
    section.setAttribute('aria-label', 'Lists');

    /** @type {'main' | 'folder' | 'list' | 'notes' | 'history'} */
    let view = 'main';
    let folderId = '';
    let listId = '';
    let filter = 'All';
    let token = 0;

    function render() {
      token += 1;
      const mine = token;
      /** @type {HTMLElement} */
      let bar;
      /** @type {HTMLElement} */
      let body;
      if (view === 'history') {
        bar = headerBar('History', barButton('‹ Lists', goMain), []);
        body = el('div', 'lists-body');
        const queries = options.history();
        if (queries.length === 0) {
          body.append(message('No searches yet.'));
        } else {
          const list = el('ul', 'rows');
          for (const query of queries) {
            const item = el('li');
            const button = el('button', 'row history-row');
            button.type = 'button';
            button.textContent = query;
            button.addEventListener('click', () => options.onSearch(query));
            item.append(button);
            list.append(item);
          }
          body.append(list);
        }
      } else if (view === 'notes') {
        bar = headerBar('Notes', barButton('‹ Lists', goMain), []);
        body = el('div', 'lists-body');
        body.append(message('Reading notes…'));
        options.notes().then(
          (notes) => {
            if (mine !== token || view !== 'notes') return;
            if (notes.length === 0) {
              body.replaceChildren(message('No notes yet. Add one from an entry screen.'));
              return;
            }
            const list = el('ul', 'rows');
            for (const note of notes) {
              const item = el('li');
              const link = el('a', 'row note-row');
              link.href = entryHash(note.id);
              link.append(text('span', 'row-headword', note.word), text('span', 'note-line', firstLine(note.text)));
              item.append(link);
              list.append(item);
            }
            body.replaceChildren(list);
          },
          () => {
            if (mine === token) body.replaceChildren(message('Notes did not load.'));
          },
        );
      } else if (view === 'folder') {
        const folder = options.folders().find((entry) => entry.id === folderId);
        if (folder === undefined) {
          goMain();
          return;
        }
        bar = headerBar(folder.name, barButton('‹ Lists', goMain), []);
        body = el('div', 'lists-body');
        const inside = options.lists().filter((list) => list.folder === folder.id);
        body.append(inside.length === 0 ? message('No lists in this folder yet.') : listRows(inside));
      } else if (view === 'list') {
        const list = options.lists().find((entry) => entry.id === listId);
        if (list === undefined) {
          goMain();
          return;
        }
        const openList = list;
        const back = openList.folder === '' ? goMain : () => openFolder(openList.folder);
        bar = headerBar(openList.name, barButton('‹ Lists', back), [
          barButton('⋯', () => openListMenu(openList), 'action', 'List options'),
        ]);
        body = el('div', 'lists-body');
        const status = text('p', 'note', '');
        status.setAttribute('role', 'status');
        status.hidden = true;
        body.append(status);
        if (list.items.length === 0) {
          body.append(message('This list is empty. Add entries from an entry screen.'));
        } else {
          const listNode = el('ul', 'list-items');
          /** @type {Map<string, { pos: HTMLElement, gloss: HTMLElement }>} */
          const filled = new Map();
          for (const item of list.items) {
            const row = el('li', 'list-item');
            const link = el('a', 'row list-item-row');
            link.href = entryHash(item.id);
            const main = el('span', 'row-main');
            const pos = text('span', 'row-pronunciation', '');
            const gloss = text('span', 'row-gloss', '');
            main.append(text('span', 'row-headword', item.word), pos);
            link.append(main, gloss);
            const remove = el('button', 'list-remove');
            remove.type = 'button';
            remove.append(icon('M4 7h16M6 7l1 14h10l1-14M9 7V4h6v3', 'list-remove-icon'));
            remove.setAttribute('aria-label', 'Remove ' + item.word);
            remove.addEventListener('click', () => {
              if (!options.confirm('Remove "' + item.word + '" from this list?')) return;
              options.removeItem(list.id, item.id);
              render();
            });
            row.append(link, remove);
            listNode.append(row);
            filled.set(item.id, { pos, gloss });
          }
          body.append(listNode);
          options.rows(list.items.map((item) => item.id)).then(
            (described) => {
              if (mine !== token || view !== 'list') return;
              for (const [id, detail] of described) {
                const nodes = filled.get(id);
                if (nodes === undefined) continue;
                nodes.pos.textContent = detail.pos;
                nodes.gloss.textContent = detail.gloss;
              }
            },
            () => {
              // The rows keep the word alone.
            },
          );
        }
        /**
         * Share the list, and say what happened in one line.
         */
        async function shareNow() {
          let line = 'The list could not be shared.';
          try {
            const how = await options.shareList(openList);
            if (how === 'shared') line = 'List shared.';
            else if (how === 'downloaded') line = 'List downloaded.';
            else line = 'Share cancelled.';
          } catch {
            line = 'The list could not be shared.';
          }
          status.textContent = line;
          status.hidden = false;
        }
        /** @param {UserList} target */
        function openListMenu(target) {
          openSheet('List options', (close) => {
            const box = el('div', 'sheet-stack');
            const share = el('button', 'sheet-button');
            share.type = 'button';
            share.textContent = 'Share list';
            share.addEventListener('click', () => {
              close();
              void shareNow();
            });
            const remove = el('button', 'sheet-button is-danger');
            remove.type = 'button';
            remove.textContent = 'Delete list';
            remove.addEventListener('click', () => {
              if (!options.confirm('Delete "' + target.name + '"? The entries stay in the dictionary.')) return;
              close();
              options.removeList(target.id);
              goMain();
            });
            box.append(share, remove);
            return box;
          });
        }
      } else {
        bar = headerBar('Lists', barButton('Settings', options.onSettings), [
          barButton('+', openNewList, 'action', 'New list'),
          barButton('⋯', openMore, 'action', 'More'),
        ]);
        body = mainBody();
      }
      section.replaceChildren(bar, body);
    }

    /**
     * The root screen: the label filter, the two pinned rows, the folders and the lists.
     * @returns {HTMLElement}
     */
    function mainBody() {
      const body = el('div', 'lists-body');
      const filters = el('div', 'label-filter');
      for (const value of ['All', ...LABELS]) {
        const chip = el('button', 'label-chip');
        chip.type = 'button';
        chip.textContent = value;
        if (filter === value) chip.className = 'label-chip is-on';
        chip.setAttribute('aria-pressed', String(filter === value));
        chip.addEventListener('click', () => {
          filter = value;
          render();
        });
        filters.append(chip);
      }
      body.append(filters);

      const pinned = el('ul', 'rows');
      pinned.append(
        navRow({
          path: ICONS.history,
          tint: 'other',
          name: 'History',
          count: options.history().length,
          onOpen: () => {
            view = 'history';
            render();
          },
        }),
        navRow({
          path: ICONS.note,
          tint: 'other',
          name: 'Notes',
          count: options.notesCount(),
          onOpen: () => {
            view = 'notes';
            render();
          },
        }),
      );
      body.append(pinned);

      const filtering = filter !== 'All';
      if (!filtering) {
        const folders = options.folders();
        if (folders.length > 0) {
          body.append(text('h2', 'section-title', 'Folders'));
          const list = el('ul', 'rows');
          for (const folder of folders) {
            const inside = options.lists().filter((entry) => entry.folder === folder.id).length;
            list.append(
              navRow({
                path: ICONS.folder,
                tint: 'other',
                name: folder.name,
                count: inside,
                onOpen: () => openFolder(folder.id),
              }),
            );
          }
          body.append(list);
        }
      }

      const lists = options.lists().filter((entry) => (filtering ? entry.label === filter : entry.folder === ''));
      if (lists.length > 0) {
        body.append(text('h2', 'section-title', filtering ? filter : 'Lists'));
        body.append(listRows(lists));
      } else if (filtering) {
        body.append(message('No lists carry this label.'));
      } else if (options.folders().length === 0) {
        body.append(message('No lists yet. Tap + to make one.'));
      } else {
        body.append(message('No lists here yet. Tap + to make one.'));
      }
      return body;
    }

    /**
     * @param {UserList[]} lists
     * @returns {HTMLElement}
     */
    function listRows(lists) {
      const ul = el('ul', 'rows');
      for (const list of lists) {
        ul.append(
          navRow({
            path: ICONS.list,
            tint: list.label.toLowerCase(),
            name: list.name,
            count: list.items.length,
            onOpen: () => openList(list.id),
          }),
        );
      }
      return ul;
    }

    function goMain() {
      view = 'main';
      folderId = '';
      listId = '';
      render();
    }

    /** @param {string} id */
    function openFolder(id) {
      view = 'folder';
      folderId = id;
      listId = '';
      render();
    }

    /** @param {string} id */
    function openList(id) {
      view = 'list';
      listId = id;
      render();
    }

    function openNewList() {
      const folders = options.folders();
      let label = 'Other';
      let folder = view === 'folder' ? folderId : '';
      openSheet('New list', (close) => {
        const box = el('div', 'sheet-stack');
        const name = el('input', 'sheet-input');
        name.type = 'text';
        name.placeholder = 'For example: Travel words';
        name.setAttribute('aria-label', 'List name');
        const nameField = el('label', 'sheet-field');
        nameField.append(text('span', 'sheet-label', 'Name'), name);

        const chips = el('div', 'label-filter');
        /** @type {Array<() => void>} */
        const paints = [];
        for (const value of LABELS) {
          const chip = el('button', 'label-chip');
          chip.type = 'button';
          chip.textContent = value;
          const paint = () => {
            chip.className = label === value ? 'label-chip is-on' : 'label-chip';
            chip.setAttribute('aria-pressed', String(label === value));
          };
          chip.addEventListener('click', () => {
            label = value;
            for (const draw of paints) draw();
          });
          paints.push(paint);
          chips.append(chip);
        }
        for (const draw of paints) draw();
        const labelField = el('div', 'sheet-field');
        labelField.append(text('span', 'sheet-label', 'Label'), chips);

        /** @type {HTMLElement[]} */
        const parts = [nameField, labelField];
        if (folders.length > 0) {
          const select = el('select', 'sheet-select');
          select.setAttribute('aria-label', 'Folder');
          const none = el('option');
          none.value = '';
          none.textContent = 'No folder';
          select.append(none);
          for (const entry of folders) {
            const option = el('option');
            option.value = entry.id;
            option.textContent = entry.name;
            select.append(option);
          }
          select.value = folder;
          select.addEventListener('change', () => {
            folder = select.value;
          });
          const folderField = el('label', 'sheet-field');
          folderField.append(text('span', 'sheet-label', 'Folder'), select);
          parts.push(folderField);
        }

        const create = el('button', 'sheet-button');
        create.type = 'button';
        create.textContent = 'Create';
        create.addEventListener('click', () => {
          const value = name.value.trim();
          if (value === '') {
            name.focus();
            return;
          }
          options.addList(value, label, folder);
          close();
          if (folder !== '' && folder !== folderId) openFolder(folder);
          else render();
        });
        parts.push(create);
        box.append(...parts);
        return box;
      });
    }

    function openNewFolder() {
      openSheet('New folder', (close) => {
        const box = el('div', 'sheet-stack');
        const name = el('input', 'sheet-input');
        name.type = 'text';
        name.placeholder = 'For example: Class notes';
        name.setAttribute('aria-label', 'Folder name');
        const field = el('label', 'sheet-field');
        field.append(text('span', 'sheet-label', 'Name'), name);
        const create = el('button', 'sheet-button');
        create.type = 'button';
        create.textContent = 'Create';
        create.addEventListener('click', () => {
          const value = name.value.trim();
          if (value === '') {
            name.focus();
            return;
          }
          options.addFolder(value);
          close();
          render();
        });
        box.append(field, create);
        return box;
      });
    }

    function openMore() {
      openSheet('More', (close) => {
        const box = el('div', 'sheet-stack');
        /** @type {Array<[string, () => void]>} */
        const entries = [
          ['New folder', openNewFolder],
          ['Import list', openImport],
          ['Restore backup', openRestore],
        ];
        for (const [label, open] of entries) {
          const button = el('button', 'sheet-button');
          button.type = 'button';
          button.textContent = label;
          button.addEventListener('click', () => {
            close();
            open();
          });
          box.append(button);
        }
        return box;
      });
    }

    function openImport() {
      jsonSheet('Import list', 'Import', (text) => {
        const outcome = options.importText(text);
        if (!outcome.ok) return outcome;
        render();
        return {
          ok: true,
          line:
            (outcome.added ?? 0) +
            ' added, ' +
            (outcome.present ?? 0) +
            ' already there. Saved as "' +
            (outcome.name ?? '') +
            '".',
        };
      });
    }

    function openRestore() {
      jsonSheet('Restore backup', 'Restore', (text) => {
        const outcome = options.restoreText(text);
        if (!outcome.ok) return outcome;
        const report = outcome.counts ?? {};
        render();
        return {
          ok: true,
          line:
            'Restored ' +
            (report.lists ?? 0) +
            ' lists, ' +
            (report.notes ?? 0) +
            ' notes, ' +
            (report.cards ?? 0) +
            ' cards.',
        };
      });
    }

    render();

    return {
      node: section,
      refresh: () => render(),
    };
  }

  /**
   * The Settings screen: theme, text size, speech rate, the storage figure, backup and restore,
   * and the explicit offline download. It is reached from the Lists tab.
   *
   * @param {SettingsOptions} options
   * @returns {{ node: HTMLElement, refresh: () => void }}
   */
  function settingsScreen(options) {
    const section = el('section', 'screen settings-screen');
    section.setAttribute('aria-label', 'Settings');

    function render() {
      const back = el('a', 'back');
      back.href = HASH.lists;
      back.textContent = '‹ Lists';
      const bar = headerBar('Settings', back, []);
      const body = el('div', 'settings-body');
      const settings = options.settings();

      body.append(text('h2', 'section-title', 'Appearance'));
      body.append(
        segment('Theme', ['System', 'Light', 'Dark'], ['system', 'light', 'dark'], settings.theme, (value) => {
          options.setSettings({ theme: /** @type {'system' | 'light' | 'dark'} */ (value) });
          render();
        }),
        segment('Text size', ['Small', 'Medium', 'Large'], ['0', '1', '2'], String(settings.textSize), (value) => {
          options.setSettings({ textSize: /** @type {0 | 1 | 2} */ (Number(value)) });
          render();
        }),
      );

      body.append(text('h2', 'section-title', 'Speech'));
      body.append(
        segment('Speech rate', ['Slow', 'Normal', 'Fast'], ['0.75', '0.9', '1.1'], String(settings.speechRate), (value) => {
          options.setSettings({ speechRate: Number(value) });
          render();
        }),
      );
      body.append(text('p', 'settings-note', 'The rate applies to the speaker on entries and on study cards.'));

      body.append(text('h2', 'section-title', 'Storage'));
      body.append(text('p', 'settings-line', 'Storage used: ' + options.size() + ' bytes.'));
      body.append(
        text(
          'p',
          'settings-note',
          'iOS may clear site data after 7 days without use. Export a backup to keep your lists, notes and progress.',
        ),
      );

      const status = text('p', 'settings-line', '');
      status.setAttribute('role', 'status');
      status.hidden = true;
      const exportButton = el('button', 'settings-button');
      exportButton.type = 'button';
      exportButton.textContent = 'Export backup';
      exportButton.addEventListener('click', () => {
        exportButton.disabled = true;
        options
          .exportBackup()
          .then(
            (how) => {
              status.textContent =
                how === 'shared' ? 'Backup shared.' : how === 'downloaded' ? 'Backup downloaded.' : 'Backup cancelled.';
            },
            () => {
              status.textContent = 'The backup could not be made.';
            },
          )
          .then(() => {
            status.hidden = false;
            exportButton.disabled = false;
          });
      });
      const restoreButton = el('button', 'settings-button');
      restoreButton.type = 'button';
      restoreButton.textContent = 'Restore backup';
      restoreButton.addEventListener('click', () => {
        jsonSheet('Restore backup', 'Restore', (value) => {
          const outcome = options.restoreText(value);
          if (!outcome.ok) return outcome;
          const report = outcome.counts ?? {};
          render();
          return {
            ok: true,
            line:
              'Restored ' +
              (report.lists ?? 0) +
              ' lists, ' +
              (report.notes ?? 0) +
              ' notes, ' +
              (report.cards ?? 0) +
              ' cards.',
          };
        });
      });
      body.append(status, exportButton, restoreButton);

      body.append(offlineBlock(options));
      section.replaceChildren(bar, body);
    }

    render();
    return { node: section, refresh: () => render() };
  }

  /**
   * The Reference tab. One catalogue of rows; each row opens a real screen with its own back
   * control. The alphabet examples resolve to entries through the app's search seam.
   *
   * @param {ReferenceOptions} options
   * @returns {{ node: HTMLElement, refresh: () => void }}
   */
  function referenceScreen(options) {
    const section = el('section', 'screen reference-screen');
    section.setAttribute('aria-label', 'Reference');

    /** @type {'main' | 'about' | 'alphabet' | 'pos' | 'pos-list' | 'cefr' | 'offline'} */
    let view = 'main';
    let posKey = '';
    /** @type {Awaited<ReturnType<typeof options.pos>> | null} */
    let groups = null;
    let token = 0;

    function backToMain() {
      view = 'main';
      render();
    }

    function render() {
      token += 1;
      const mine = token;
      /** @type {HTMLElement} */
      let bar;
      /** @type {HTMLElement} */
      let body;
      if (view === 'about') {
        bar = headerBar('About', barButton('‹ Reference', backToMain), []);
        body = el('div', 'lists-body');
        drawAbout(body, mine);
      } else if (view === 'alphabet') {
        bar = headerBar('Alphabet', barButton('‹ Reference', backToMain), []);
        body = el('div', 'lists-body');
        drawAlphabet(body, mine);
      } else if (view === 'pos') {
        bar = headerBar('Parts of speech', barButton('‹ Reference', backToMain), []);
        body = el('div', 'lists-body');
        drawPos(body, mine);
      } else if (view === 'pos-list') {
        const group = groups === null ? undefined : groups.find((entry) => entry.pos === posKey);
        if (group === undefined) {
          view = 'pos';
          render();
          return;
        }
        bar = headerBar(group.label, barButton('‹ Parts of speech', () => {
          view = 'pos';
          render();
        }), []);
        body = el('div', 'lists-body');
        drawPosList(body, group);
      } else if (view === 'cefr') {
        bar = headerBar('CEFR', barButton('‹ Reference', backToMain), []);
        body = el('div', 'lists-body');
        drawCefr(body, mine);
      } else if (view === 'offline') {
        bar = headerBar('Offline', barButton('‹ Reference', backToMain), []);
        body = el('div', 'lists-body');
        body.append(offlineBlock(options));
      } else {
        bar = headerBar('Reference', el('span', 'navbar-slot'), []);
        body = el('div', 'lists-body');
        const rows = el('ul', 'rows');
        rows.append(
          navRow({ path: ICONS.about, name: 'About', note: 'Version, counts and licences', onOpen: open('about') }),
          navRow({ path: ICONS.alphabet, name: 'Alphabet and pronunciation', note: '21 letters and the accented vowels', onOpen: open('alphabet') }),
          navRow({ path: ICONS.pos, name: 'Parts of speech', note: 'Counts, and the 200 most frequent entries', onOpen: open('pos') }),
          navRow({ path: ICONS.cefr, name: 'CEFR', note: 'Six bands, A1 to C2, each a Study deck', onOpen: open('cefr') }),
          navRow({ path: ICONS.offline, name: 'Offline', note: 'Download the dictionary', onOpen: open('offline') }),
        );
        body.append(rows);
      }
      section.replaceChildren(bar, body);
    }

    /**
     * @param {'about' | 'alphabet' | 'pos' | 'cefr' | 'offline'} next
     * @returns {() => void}
     */
    function open(next) {
      return () => {
        view = next;
        render();
      };
    }

    /** @param {HTMLElement} body @param {number} mine */
    function drawAbout(body, mine) {
      body.append(message('Reading the dictionary…'));
      options.about().then(
        (info) => {
          if (mine !== token) return;
          const licences = el('ul', 'rows');
          licences.append(
            navRow({
              path: ICONS.about,
              name: 'Dictionary text',
              note: 'Wikizionario, CC BY-SA 4.0',
              href: 'https://creativecommons.org/licenses/by-sa/4.0/',
              external: true,
            }),
            navRow({
              path: ICONS.about,
              name: 'Example sentences',
              note: 'Tatoeba, CC BY 2.0 FR',
              href: 'https://creativecommons.org/licenses/by/2.0/fr/',
              external: true,
            }),
            navRow({ path: ICONS.about, name: 'App code', note: 'MIT', href: './NOTICE' }),
          );
          body.replaceChildren(
            text('p', 'settings-line', 'Dictionary version ' + info.version + ', built ' + info.built + '.'),
            text(
              'p',
              'settings-line',
              info.entries.toLocaleString('en-US') + ' entries and ' + info.examples.toLocaleString('en-US') + ' example sentences.',
            ),
            text('h2', 'section-title', 'Licences'),
            licences,
            text('p', 'settings-note', 'Testo da Wikizionario, it.wiktionary.org, CC BY-SA 4.0, modificato.'),
            text(
              'p',
              'settings-note',
              'CEFR bands are approximate. They come from a frequency table. They never describe a word.',
            ),
          );
        },
        () => {
          if (mine === token) body.replaceChildren(message('The dictionary is not available yet.'));
        },
      );
    }

    /** @param {HTMLElement} body @param {number} mine */
    function drawAlphabet(body, mine) {
      const list = el('ul', 'rows');
      /** @type {Array<{ word: string, link: HTMLAnchorElement }>} */
      const links = [];
      for (const entry of ALPHABET) {
        const item = el('li');
        const link = el('a', 'row alpha-row');
        link.append(
          text('span', 'alpha-letter', entry.letter),
          text('span', 'alpha-name', entry.name),
          text('span', 'alpha-word', entry.word),
        );
        item.append(link);
        list.append(item);
        links.push({ word: entry.word, link });
      }
      body.replaceChildren(
        text('p', 'settings-note', 'The 21 Italian letters and the six accented vowels. Tap an example to open its entry.'),
        list,
      );
      options.alphabetIds(ALPHABET.map((entry) => entry.word)).then(
        (ids) => {
          if (mine !== token) return;
          for (const row of links) {
            const id = ids.get(row.word);
            if (id !== undefined) row.link.href = entryHash(id);
            else row.link.className = 'row alpha-row is-plain';
          }
        },
        () => {
          // The rows keep the letter alone.
        },
      );
    }

    /** @param {HTMLElement} body @param {number} mine */
    function drawPos(body, mine) {
      if (groups !== null) {
        paintPos(body, groups);
        return;
      }
      body.append(message('Reading the index…'));
      options.pos().then(
        (found) => {
          groups = found;
          if (mine !== token) return;
          paintPos(body, found);
        },
        () => {
          if (mine === token) body.replaceChildren(message('The index did not load.'));
        },
      );
    }

    /**
     * @param {HTMLElement} body
     * @param {NonNullable<typeof groups>} found
     */
    function paintPos(body, found) {
      const list = el('ul', 'rows');
      for (const group of found) {
        list.append(
          navRow({
            path: ICONS.pos,
            name: group.label,
            count: group.count,
            onOpen: () => {
              posKey = group.pos;
              view = 'pos-list';
              render();
            },
          }),
        );
      }
      body.replaceChildren(
        text('p', 'settings-note', 'Counts cover every entry, from the CEFR index. Each row opens its most frequent entries.'),
        list,
      );
    }

    /**
     * @param {HTMLElement} body
     * @param {{ label: string, rows: Array<{ id: string, word: string, gloss: string }> }} group
     */
    function drawPosList(body, group) {
      const list = el('ul', 'rows');
      for (const row of group.rows) {
        const item = el('li');
        const link = el('a', 'row');
        link.href = entryHash(row.id);
        const main = el('span', 'row-main');
        main.append(text('span', 'row-headword', row.word));
        link.append(main, text('span', 'row-gloss', row.gloss));
        item.append(link);
        list.append(item);
      }
      body.append(text('p', 'settings-note', 'The 200 most frequent entries of this part of speech.'), list);
    }

    /** @param {HTMLElement} body @param {number} mine */
    function drawCefr(body, mine) {
      body.append(message('Reading the decks…'));
      options.cefr().then(
        (bands) => {
          if (mine !== token) return;
          const list = el('ul', 'rows');
          for (const entry of bands) {
            list.append(
              navRow({
                path: ICONS.cefr,
                name: entry.band.toUpperCase(),
                note: BANDS_NAMED[entry.band] ?? '',
                count: entry.count,
                onOpen: () => options.startDeck(entry.band),
              }),
            );
          }
          body.replaceChildren(
            text('p', 'settings-note', 'A band starts a Study run. CEFR bands are approximate.'),
            list,
          );
        },
        () => {
          if (mine === token) body.replaceChildren(message('The decks did not load.'));
        },
      );
    }

    render();
    return { node: section, refresh: () => render() };
  }

  /**
   * A screen whose feature is a later build. It says so, so nothing is a dead end.
   * @param {{ title: string, note: string }} options
   * @returns {HTMLElement}
   */
  function placeholder(options) {
    const section = el('section', 'screen placeholder');
    section.append(text('h1', 'page-title', options.title), message(options.note));
    return section;
  }

  return {
    tabBar,
    setActiveTab,
    setTabBadge,
    searchScreen,
    textScreen,
    entryScreen,
    studyScreen,
    listsScreen,
    settingsScreen,
    referenceScreen,
    placeholder,
  };
}
