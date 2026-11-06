// @ts-check
/**
 * The screens: the tab bar, Search, Entry, and the placeholders. One element helper and text
 * nodes only — no `innerHTML` with data, anywhere. Icons are inline SVG built with
 * `createElementNS`, so they take `currentColor` and need no files.
 *
 * | Screen | Draws |
 * |---|---|
 * | tab bar | five tabs: a 25px icon above a 10px label, chrome last in focus order |
 * | Search | the field, the input switch and its letter palette, then history, rows or one line |
 * | Text | the textarea, the summary, the text as words with a link on each known one, and the unknown words |
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
import { WORD_CAP, summarise, tokenize } from './text.js';

/** @typedef {import('./data.js').Row} Row */
/** @typedef {import('./data.js').Entry} Entry */
/** @typedef {import('./data.js').ConjGroup} ConjGroup */
/** @typedef {import('./text.js').Match} Match */
/** @typedef {import('./study.js').Deck} Deck */
/** @typedef {import('./text.js').Segment} Segment */

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
 *   }) => { node: HTMLElement, query: () => string, refresh: () => void },
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
 *   }) => { node: HTMLElement, refresh: () => void },
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
   * @returns {{ node: HTMLElement, refresh: () => void }}
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
    };
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

  return { tabBar, setActiveTab, setTabBadge, searchScreen, textScreen, entryScreen, studyScreen, placeholder };
}
