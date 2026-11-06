// @ts-check
/**
 * Boot: the service worker, the stored blob, then the router.
 *
 * `index.html` has exactly one module entry, and this is it. Boot draws every screen into the one
 * `#app` node: a persistent tab bar, and above it either one screen or, from 900px wide, the
 * search list beside the entry.
 *
 * The Search screen's node is built once and kept, so a query and its rows survive a trip into an
 * entry and back. Everything the module touches in the environment is a parameter with a browser
 * default — `document`, `window`, `fetch`, the storage backend, the wide-screen test — so
 * `tools/sanity.mjs` drives the shell with fakes and the browser path calls `boot()` with nothing.
 */

import { bucketOfId, createData } from './data.js';
import { HASH, createRouter, entryHash } from './router.js';
import { createSearch } from './search.js';
import { createSpeech } from './speech.js';
import { createStorage } from './storage.js';
import { BANDS, dueCount, dueIds, gradeCard, newCard, orderDeck } from './study.js';
import { createReader } from './text.js';
import { backTarget, createUi } from './ui.js';

/** @typedef {import('./data.js').Row} Row */
/** @typedef {import('./router.js').Route} Route */

/** The root node `index.html` provides. Boot never replaces it. */
const ROOT_ID = 'app';

/** Two panes from here up: the result list on the left, the entry on the right. */
const WIDE = '(min-width: 900px)';

/**
 * What each screen without a feature yet says. The numbers are the roadmap's; correct them when
 * a milestone moves.
 * @type {Record<string, { title: string, note: string }>}
 */
const PLACEHOLDERS = {
  lists: { title: 'Lists', note: 'Lists and notes arrive in a later build.' },
  settings: { title: 'Settings', note: 'Settings arrive in a later build.' },
  reference: { title: 'Reference', note: 'The grammar catalogue arrives in a later build.' },
};

/** The right pane of the wide layout before a row is tapped. */
const NO_ENTRY = { title: 'No word selected', note: 'Choose a word on the left.' };

/**
 * Register the service worker: its install precaches the shell, which is what makes the app open
 * offline. Fire-and-forget, like every failure here: a missing worker, an insecure context or a
 * browser without one degrades to an ordinary online app, never to a page that failed to start.
 *
 * `./sw.js` is relative like every other URL; `{ updateViaCache: 'none' }` keeps GitHub Pages'
 * ten-minute `Cache-Control` off the one file a fix can otherwise be stuck behind.
 *
 * @param {ServiceWorkerContainer | null | undefined} container injected by `tools/sanity.mjs`
 */
function registerWorker(container) {
  const target = container === undefined ? globalThis.navigator?.serviceWorker : container;
  if (!target || typeof target.register !== 'function') return;
  target.register('./sw.js', { updateViaCache: 'none' }).catch((error) => {
    console.warn('itadict: the service worker did not register', error);
  });
}

/**
 * Start the app.
 *
 * @param {{
 *   document?: Document,
 *   window?: import('./router.js').RouterWindow,
 *   root?: HTMLElement,
 *   storage?: ReturnType<typeof createStorage>,
 *   data?: ReturnType<typeof createData>,
 *   fetch?: typeof globalThis.fetch,
 *   base?: string,
 *   matchWide?: () => boolean,
 *   serviceWorker?: ServiceWorkerContainer | null,
 *   speech?: ReturnType<typeof createSpeech>,
 *   now?: () => number,
 * }} [options] injected by `tools/sanity.mjs`; the browser passes nothing
 */
export function boot(options = {}) {
  const doc = options.document ?? globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') {
    throw new Error('itadict app: a document is required to boot');
  }
  const root = options.root ?? doc.getElementById(ROOT_ID);
  if (!root) throw new Error(`itadict app: index.html must provide a #${ROOT_ID} root node`);

  registerWorker(options.serviceWorker);

  const storage = options.storage ?? createStorage();
  const data = options.data ?? createData({ fetch: options.fetch, base: options.base });
  const search = createSearch({ data, storage });
  const ui = createUi(doc);
  const matchWide =
    options.matchWide ??
    (() => (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(WIDE).matches : false));

  const main = doc.createElement('main');
  main.className = 'screen-root';
  const bar = ui.tabBar();
  root.replaceChildren(main, bar);

  const searchView = ui.searchScreen({
    search: (query) => search.search(query),
    onCommit: (query) => {
      storage.addQuery(query);
    },
  });

  // Built once beside the search screen, so a pasted text and its result survive a tab change.
  const reader = createReader({ data });
  const textView = ui.textScreen({ read: (segments) => reader.read(segments) });

  const speech = options.speech ?? createSpeech();
  const now = options.now ?? (() => Date.now());

  /** The due count on the Study tab: the one number the chrome shows about study. */
  function updateDue() {
    const due = dueCount(storage.schedule(), now());
    ui.setTabBadge(bar, 'study', due === 0 ? '' : String(due));
  }

  /**
   * Ask for notification permission on the first deck open. A browser only grants it after a
   * gesture, and a tap on a deck is one.
   */
  function askToRemind() {
    const api = globalThis.Notification;
    if (!api || typeof api.requestPermission !== 'function' || api.permission !== 'default') return;
    Promise.resolve(api.requestPermission()).catch(() => {});
  }

  /**
   * One reminder per session, only while the app is open. A web app has no push on iOS, so the
   * reminder can never arrive after the page is closed. The picker says so in one line.
   */
  let reminded = false;
  function remind() {
    const api = globalThis.Notification;
    if (reminded || !api || api.permission !== 'granted') return;
    const due = dueCount(storage.schedule(), now());
    if (due === 0) return;
    reminded = true;
    try {
      new api('Review due', { body: due === 1 ? '1 card is due today.' : due + ' cards are due today.', tag: 'itadict-due' });
    } catch {
      // A blocked notification is not an error the learner must see.
    }
  }
  if (typeof globalThis.setInterval === 'function') globalThis.setInterval(remind, 15 * 60 * 1000);

  const studyView = ui.studyScreen({
    decks: async () => {
      const schedule = storage.schedule();
      /** @type {import('./study.js').Deck[]} */
      const decks = [
        { id: 'due', title: 'Due today', count: dueCount(schedule, now()) },
        { id: 'history', title: 'History', count: storage.opened().length },
      ];
      for (const band of BANDS) decks.push({ id: band, title: band.toUpperCase(), count: await data.cefrCount(band) });
      return decks;
    },
    cards: async (deckId) => {
      askToRemind();
      if (deckId === 'due') return dueIds(storage.schedule(), now()).map((id) => ({ id }));
      if (deckId === 'history') return storage.opened().map((id) => ({ id }));
      const rows = await data.cefr(deckId);
      const byId = new Map(rows.map((row) => [row.id, row]));
      return orderDeck(rows.map((row) => row.id), storage.schedule(), now()).map((id) => ({
        id,
        word: byId.get(id)?.word ?? '',
        gloss: byId.get(id)?.gloss ?? '',
      }));
    },
    load: (id) =>
      data.entry(id).then((entry) => {
        if (entry === null) return null;
        const sense = entry.posList[0]?.senses[0] ?? '';
        const card = { word: entry.headword, ipa: entry.pronunciation, sense, example: '' };
        return data
          .examples(bucketOfId(id))
          .then((sentences) => ({ ...card, example: sentences[entry.exampleIndexes[0]] ?? '' }))
          .catch(() => card);
      }),
    grade: (id, remembered) => {
      const at = now();
      storage.setSchedule(id, gradeCard(storage.schedule()[id] ?? newCard(at), remembered, at));
      updateDue();
    },
    note: (id) => storage.note(id),
    setNote: (id, text) => storage.setNote(id, text),
    speech,
    entryHref: (id) => entryHash(id),
    onGrade: updateDue,
  });
  updateDue();

  /**
   * One entry screen. The id carries its own location, so a cold deep link costs one entry file
   * and needs no memory of an earlier search. The row this session showed gives the headword at
   * once; a cold link draws the id until the body lands.
   * @param {string} id
   * @param {{ label: string, go?: () => void }} back
   * @returns {HTMLElement}
   */
  function entryView(id, back) {
    const known = search.row(id);
    /** @type {Row} */
    const row = known ?? { folded: '', id, headword: id, pronunciation: '', pos: '', gloss: '' };
    const bucket = bucketOfId(id);
    return ui.entryScreen({
      row,
      load: data.entry(id).then(
        (entry) => entry,
        () => null,
      ),
      query: searchView.query(),
      speech,
      examples: (indexes) =>
        data
          .examples(bucket)
          .then((sentences) => indexes.map((index) => sentences[index] ?? '').filter((line) => line !== ''))
          .catch(() => []),
      back,
    });
  }

  /** The last tab screen drawn. The entry's back control returns to it. */
  let from = '';

  /**
   * @param {Route} route
   */
  function renderRoute(route) {
    ui.setActiveTab(bar, route.name);
    const previous = from;
    if (route.name !== 'entry') from = route.name;

    if (route.name === 'entry' && route.id !== null) {
      storage.addOpened(route.id);
      const target = backTarget(previous);
      /** @type {{ label: string, go?: () => void }} */
      const back = { label: target.label };
      if (target.history) back.go = () => globalThis.history.back();

      if (matchWide()) {
        const list = doc.createElement('div');
        list.className = 'pane pane-list';
        list.append(searchView.node);
        const detail = doc.createElement('div');
        detail.className = 'pane pane-detail';
        detail.append(entryView(route.id, back));
        const split = doc.createElement('div');
        split.className = 'split';
        split.append(list, detail);
        main.replaceChildren(split);
        return;
      }
      main.replaceChildren(entryView(route.id, back));
      return;
    }

    if (route.name === 'search') {
      if (matchWide()) {
        const list = doc.createElement('div');
        list.className = 'pane pane-list';
        list.append(searchView.node);
        const detail = doc.createElement('div');
        detail.className = 'pane pane-detail';
        detail.append(ui.placeholder(NO_ENTRY));
        const split = doc.createElement('div');
        split.className = 'split';
        split.append(list, detail);
        main.replaceChildren(split);
        return;
      }
      main.replaceChildren(searchView.node);
      return;
    }

    if (route.name === 'text') {
      main.replaceChildren(textView);
      return;
    }

    if (route.name === 'study') {
      studyView.refresh();
      main.replaceChildren(studyView.node);
      return () => speech.cancel();
    }

    main.replaceChildren(ui.placeholder(PLACEHOLDERS[route.name] ?? NO_ENTRY));
  }

  const router = createRouter({ render: renderRoute, window: options.window });
  router.start();

  // Crossing the two-pane breakpoint re-renders the current route without leaving it.
  if (typeof globalThis.matchMedia === 'function') {
    globalThis.matchMedia(WIDE).addEventListener('change', () => {
      const route = router.current();
      if (route !== null) renderRoute(route);
    });
  }

  return { router, ui, storage, data, search };
}

// The browser path: `index.html`'s one module script is this file. Under Node there is no document.
if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
  try {
    boot();
  } catch (error) {
    console.error('itadict: the app could not start', error);
  }
}
