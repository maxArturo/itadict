// @ts-check
/**
 * The screens: the tab bar, Search, Entry, and the placeholders. One element helper and text
 * nodes only — no `innerHTML` with data, anywhere. Icons are inline SVG built with
 * `createElementNS`, so they take `currentColor` and need no files.
 *
 * | Screen | Draws |
 * |---|---|
 * | tab bar | five tabs: a 25px icon above a 10px label, chrome last in focus order |
 * | Search | the field with its magnifier and clear control, then history, rows or one line |
 * | Entry | back control, the entry name in the nav bar, the headword block, then the sections |
 * | placeholder | a title and the one line that names its build |
 *
 * The `document` is a parameter, like every other module's environment here, so a Node check can
 * build the same DOM with a fake. This module imports no data and fetches nothing: the app hands
 * Search a `search(query)` function and Entry two promises, which is the seam the sanity suite
 * uses. `formRows` is pure and exports the conjugation order on its own.
 */

import { HASH, entryHash } from './router.js';
import { findMatch, fold } from './search.js';

/** @typedef {import('./data.js').Row} Row */
/** @typedef {import('./data.js').Entry} Entry */
/** @typedef {import('./data.js').ConjGroup} ConjGroup */

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
 *   searchScreen: (options: {
 *     search: (query: string) => Promise<{ rows: Row[], history: string[] }>,
 *     onCommit?: (query: string) => void,
 *   }) => { node: HTMLElement, query: () => string, refresh: () => void },
 *   entryScreen: (options: {
 *     row: Row,
 *     load: Promise<Entry | null>,
 *     examples: (indexes: number[]) => Promise<string[]>,
 *     query?: string,
 *   }) => HTMLElement,
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
      link.append(icon(path), text('span', 'tab-label', label));
      bar.append(link);
    }
    return bar;
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

    const head = el('header', 'search-head');
    head.append(form);
    const body = el('div', 'search-body');
    section.append(head, body);

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
   * }} options
   * @returns {HTMLElement}
   */
  function entryScreen(options) {
    const row = options.row;
    const section = el('section', 'screen entry-screen');

    const bar = el('header', 'navbar');
    const back = el('a', 'back');
    back.href = HASH.search;
    back.setAttribute('aria-label', 'Back to search');
    back.textContent = '‹ Search';
    const title = text('span', 'navbar-title', row.headword);
    const actions = el('div', 'navbar-actions');

    /**
     * @param {string} glyph
     * @param {string} label
     * @param {string} notice
     */
    function action(glyph, label, notice) {
      const button = el('button', 'action');
      button.type = 'button';
      button.textContent = glyph;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.addEventListener('click', () => {
        note.textContent = notice;
        note.hidden = false;
      });
      actions.append(button);
    }

    const note = text('p', 'note', '');
    note.setAttribute('role', 'status');
    note.hidden = true;
    action('🔈', 'Speak', 'Audio arrives in a later build.');
    action('＋', 'Add to list', 'Lists arrive in a later build.');
    bar.append(back, title, actions);

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

    section.append(bar, block, note, translation, forms, examples);

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
   * A screen whose feature is a later build. It says so, so nothing is a dead end.
   * @param {{ title: string, note: string }} options
   * @returns {HTMLElement}
   */
  function placeholder(options) {
    const section = el('section', 'screen placeholder');
    section.append(text('h1', 'page-title', options.title), message(options.note));
    return section;
  }

  return { tabBar, setActiveTab, searchScreen, entryScreen, placeholder };
}
