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

import { createData, bucketKey } from './data.js';
import { HASH, createRouter } from './router.js';
import { createSearch } from './search.js';
import { createStorage } from './storage.js';
import { createUi } from './ui.js';

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
  text: { title: 'Text', note: 'Reading texts arrive in milestone 5.' },
  reference: { title: 'Reference', note: 'The grammar and pronunciation catalogue arrives in milestone 5.' },
  lists: { title: 'Lists', note: 'Lists and notes arrive in milestone 4.' },
  study: { title: 'Study', note: 'Flashcards arrive in milestone 6.' },
  settings: { title: 'Settings', note: 'Settings arrive in milestone 4.' },
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

  /**
   * One entry screen, from the row this session already showed. On a reload the row is gone, so
   * the stored bucket from `storage.rememberEntry` is the way back to the body; with neither, one
   * honest line replaces the sections.
   * @param {string} id
   * @returns {HTMLElement}
   */
  function entryView(id) {
    const known = search.row(id);
    const bucket = known !== null && known.folded !== '' ? bucketKey(known.folded) : storage.openedBucket(id);
    /** @type {Row} */
    const row = known ?? { folded: '', id, headword: id, pronunciation: '', gloss: '', rank: 0 };
    const load =
      bucket === null
        ? Promise.resolve(null)
        : data.entry(bucket, id).then(
            (entry) => {
              storage.rememberEntry(id, bucket);
              return entry;
            },
            () => null,
          );
    return ui.entryScreen({
      row,
      load,
      query: searchView.query(),
      examples: () => (bucket === null ? Promise.resolve(new Map()) : data.examples(bucket).catch(() => new Map())),
    });
  }

  /**
   * @param {Route} route
   */
  function renderRoute(route) {
    ui.setActiveTab(bar, route.name);

    if (route.name === 'entry' && route.id !== null) {
      if (matchWide()) {
        const list = doc.createElement('div');
        list.className = 'pane pane-list';
        list.append(searchView.node);
        const detail = doc.createElement('div');
        detail.className = 'pane pane-detail';
        detail.append(entryView(route.id));
        const split = doc.createElement('div');
        split.className = 'split';
        split.append(list, detail);
        main.replaceChildren(split);
        return;
      }
      main.replaceChildren(entryView(route.id));
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
