// @ts-check
/**
 * The screens: the tab bar, Search, Entry, and the placeholders. One element helper and text
 * nodes only — no `innerHTML` with data, anywhere.
 *
 * | Screen | Draws |
 * |---|---|
 * | tab bar | five tabs; the active one dark, the rest grey |
 * | Search | the field, then history, rows or a one-line state |
 * | Entry | back control, the entry name in the nav bar, the large headword, then the sections |
 * | placeholder | a title and the milestone it arrives in |
 *
 * The `document` is a parameter, like every other module's environment here, so a Node check can
 * build the same DOM with a fake. This module imports no data and fetches nothing: the app hands
 * Search a `search(query)` function and Entry a promise, which is the seam the sanity suite uses.
 */

import { HASH, entryHash } from './router.js';
import { findMatch, fold } from './search.js';

/** @typedef {import('./data.js').Row} Row */
/** @typedef {import('./data.js').Entry} Entry */

/** The five tabs, in bar order. Settings has no tab; Lists reaches it later. */
/** @type {Array<[keyof typeof HASH, string]>} */
const TABS = [
  ['search', 'Search'],
  ['text', 'Text'],
  ['reference', 'Reference'],
  ['lists', 'Lists'],
  ['study', 'Study'],
];

/** What the Search screen says when the data set cannot be read. It names the milestone, not a bug. */
const NO_DATA_TITLE = 'The dictionary is not ready.';
const NO_DATA_NOTE = 'The data build (milestone 1) has not landed: data/index.json is missing.';

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
 *     examples: (ids: string[]) => Promise<Map<string, string>>,
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
   * A one-line state: a title, and a second line when there is one to give.
   * @param {string} title
   * @param {string} [note]
   * @returns {HTMLElement}
   */
  function message(title, note) {
    const wrap = el('div', 'empty');
    wrap.append(text('p', 'empty-title', title));
    if (note !== undefined && note !== '') wrap.append(text('p', 'empty-note', note));
    return wrap;
  }

  /**
   * The bottom tab bar. Built once and kept: navigating must not rebuild the chrome.
   * @returns {HTMLElement}
   */
  function tabBar() {
    const bar = el('nav', 'tabbar');
    bar.setAttribute('aria-label', 'Screens');
    for (const [name, label] of TABS) {
      const link = el('a', 'tab');
      link.href = HASH[name];
      link.setAttribute('data-tab', name);
      link.textContent = label;
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
    const input = el('input', 'search-input');
    input.type = 'search';
    input.placeholder = 'Search Italian';
    input.setAttribute('aria-label', 'Search Italian');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('enterkeyhint', 'search');
    input.spellcheck = false;
    form.append(input);

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
      link.append(text('span', 'row-headword', row.headword));
      // A row matched through an inflected form shows that form; the pronunciation otherwise.
      const secondary = row.matched ?? row.pronunciation;
      if (secondary !== '') link.append(text('span', 'row-pronunciation', secondary));
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
        body.replaceChildren(
          trimmed === ''
            ? message('Type a word to search.', 'Results appear as you type.')
            : message('One more letter.', 'A single letter is too common to search.'),
        );
        return;
      }
      body.replaceChildren(message(`No results for "${trimmed}".`));
    }

    async function run() {
      const query = input.value;
      const mine = (token += 1);
      /** @type {{ rows: Row[], history: string[] }} */
      let result;
      try {
        result = await options.search(query);
      } catch {
        if (mine === token) body.replaceChildren(message(NO_DATA_TITLE, NO_DATA_NOTE));
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
   * flashes empty; the entry body fills the sections when it arrives. A body that never arrives
   * says so in one line and hides what it cannot fill.
   *
   * @param {{
   *   row: Row,
   *   load: Promise<Entry | null>,
   *   examples: (ids: string[]) => Promise<Map<string, string>>,
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

    const note = text('p', 'note', '');
    note.setAttribute('role', 'status');
    note.hidden = true;
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
    action('🔈', 'Speak', 'Speak arrives in milestone 4.');
    action('＋', 'Add to list', 'Lists arrive in milestone 4.');

    bar.append(back, title, actions);

    const article = el('article', 'entry');
    const headword = text('h1', 'headword', row.headword);
    const pronunciation = text('p', 'pronunciation', row.pronunciation);
    pronunciation.hidden = row.pronunciation === '';

    /**
     * @param {string} name
     * @returns {{ node: HTMLElement, body: HTMLElement }}
     */
    function block(name) {
      const node = el('section', 'block');
      node.append(text('h2', 'section-title', name));
      const inner = el('div', 'block-body');
      node.append(inner);
      return { node, body: inner };
    }

    const translation = block('Translation');
    const forms = block('Forms');
    const examples = block('Examples');
    article.append(headword, pronunciation, note, translation.node, forms.node, examples.node);
    section.append(bar, article);

    /**
     * A sentence with the matched word marked. The needle is the query when the user arrived
     * from a search, else the entry's headword.
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
        translation.body.append(text('p', 'note', 'This entry is not available yet.'));
        forms.node.hidden = true;
        examples.node.hidden = true;
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

      if (entry.translation.length === 0) {
        translation.body.append(text('p', 'note', 'No definition yet.'));
      } else {
        const list = el('ul', 'senses');
        for (const line of entry.translation) list.append(text('li', undefined, line));
        translation.body.append(list);
      }

      if (entry.forms.length === 0) {
        forms.node.hidden = true;
      } else {
        const list = el('dl', 'forms');
        for (const form of entry.forms) list.append(text('dt', undefined, form.label), text('dd', undefined, form.value));
        forms.body.append(list);
      }

      // A prefix search ("cas" for "casa") marks the whole word; a form search marks the form.
      const typed = (options.query ?? '').trim();
      const needle = typed !== '' && !fold(entry.headword).startsWith(fold(typed)) ? typed : entry.headword;
      if (entry.exampleIds.length === 0) {
        examples.node.hidden = true;
        return;
      }
      // The headword and the definition are already drawn; the sentences are their own fetch.
      Promise.resolve(options.examples(entry.exampleIds)).then(
        (sentences) => {
          const lines = entry.exampleIds
            .map((id) => sentences.get(id) ?? '')
            .filter((line) => line !== '');
          if (lines.length === 0) {
            examples.node.hidden = true;
            return;
          }
          const list = el('ul', 'examples');
          for (const line of lines) {
            const item = el('li');
            item.append(highlight(line, needle));
            list.append(item);
          }
          examples.body.append(list);
        },
        () => {
          examples.node.hidden = true;
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
   * A screen whose feature is a later milestone. It says so, so nothing is a dead end.
   * @param {{ title: string, note: string }} options
   * @returns {HTMLElement}
   */
  function placeholder(options) {
    const section = el('section', 'screen placeholder');
    section.append(text('h1', 'page-title', options.title), text('p', 'page-note', options.note));
    return section;
  }

  return { tabBar, setActiveTab, searchScreen, entryScreen, placeholder };
}
