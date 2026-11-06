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

import { bucketOfId, createData, foldWord } from './data.js';
import { backupFile, counts, noteWord, packageList, parseBackup, parsePackage } from './lists.js';
import { downloadAll, fileUrls } from './offline.js';
import { posIndex } from './reference.js';
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
 * Track the last input device, so a focus ring can follow the keyboard and nothing else. A text
 * field focused by a script or a tap would otherwise draw Chromium's :focus-visible ring and make
 * the app look like a web page. The field is never focused on boot.
 *
 * @param {Document} doc
 */
function trackInput(doc) {
  const html = doc.documentElement;
  if (!html) return;
  html.setAttribute('data-input', 'pointer');
  doc.addEventListener('keydown', () => html.setAttribute('data-input', 'keyboard'), true);
  doc.addEventListener('pointerdown', () => html.setAttribute('data-input', 'pointer'), true);
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
 *   confirm?: (message: string) => boolean,
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
  trackInput(doc);

  const storage = options.storage ?? createStorage();
  const data = options.data ?? createData({ fetch: options.fetch, base: options.base });
  const search = createSearch({ data, storage, fetch: options.fetch, base: options.base });
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

  const baseSpeech = options.speech ?? createSpeech();
  /**
   * Speak at the rate Settings holds. The setting is read at each tap, so a change applies at
   * once. Both the Entry and the Study screens take this wrapper.
   */
  const speech = {
    available: () => baseSpeech.available(),
    /**
     * @param {string} text
     * @returns {boolean}
     */
    speak: (text) => baseSpeech.speak(text, storage.settings().speechRate),
    cancel: () => baseSpeech.cancel(),
  };
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
   * Ask before a destructive action. A browser without a dialog keeps going; the action was
   * asked for by a tap.
   */
  const ask =
    options.confirm ??
    ((message) => (typeof globalThis.confirm === 'function' ? globalThis.confirm(message) : true));

  /**
   * Save one JSON file through a download link.
   * @param {string} name
   * @param {Record<string, unknown>} payload
   */
  function saveFile(name, payload) {
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = url;
    link.download = name;
    doc.body.append(link);
    link.click();
    link.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Share one JSON file through the phone's own share sheet when the browser has one, and
   * download it when it does not.
   * @param {string} name
   * @param {Record<string, unknown>} payload
   * @returns {Promise<'shared' | 'downloaded' | 'cancelled'>}
   */
  async function shareFile(name, payload) {
    const text = JSON.stringify(payload, null, 2);
    const nav = globalThis.navigator;
    if (nav && typeof nav.share === 'function' && typeof nav.canShare === 'function') {
      const file = new File([text], name, { type: 'application/json' });
      if (nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: name });
          return 'shared';
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
        }
      }
    }
    saveFile(name, payload);
    return 'downloaded';
  }

  /** @returns {Promise<'shared' | 'downloaded' | 'cancelled'>} */
  function exportBackup() {
    return shareFile('italian-backup.json', backupFile(storage.snapshot(), new Date().toISOString()));
  }

  /**
   * @param {import('./lists.js').UserList} list
   * @returns {Promise<'shared' | 'downloaded' | 'cancelled'>}
   */
  function shareList(list) {
    return shareFile('italian-list.json', packageList(list));
  }

  /**
   * Validate and merge one list file. A bad file changes nothing.
   * @param {string} text
   */
  function importText(text) {
    /** @type {unknown} */
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      return { ok: false, error: 'That is not JSON.' };
    }
    const parsed = parsePackage(value);
    if (parsed === null) return { ok: false, error: 'That file is not an itadict list.' };
    const merged = storage.importList(parsed);
    return { ok: true, name: merged.list.name, added: merged.added, present: merged.present };
  }

  /**
   * Validate one backup, ask once, then replace every user datum.
   * @param {string} text
   */
  function restoreText(text) {
    /** @type {unknown} */
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      return { ok: false, error: 'That is not JSON.' };
    }
    const parsed = parseBackup(value);
    if (parsed === null) return { ok: false, error: 'That file is not an itadict backup.' };
    if (!ask('Replace all your data with this backup? Your current lists, notes and progress will be lost.')) {
      return { ok: false, cancelled: true };
    }
    if (!storage.restore(parsed.data)) {
      return { ok: false, error: 'The browser refused to save it. The backup is loaded for this session only.' };
    }
    applySettings();
    updateDue();
    listsView.refresh();
    settingsView?.refresh();
    return { ok: true, counts: counts(storage.snapshot()) };
  }

  /**
   * The notes with the headword each one belongs to, newest first.
   * @returns {Promise<Array<{ id: string, text: string, word: string }>>}
   */
  async function noteRows() {
    return Promise.all(
      storage.notes().map(async (note) => {
        let fetched = '';
        // A stored word survives a data rebuild; only a note without one asks the dictionary.
        if (note.word === '') {
          try {
            const entry = await data.entry(note.id);
            if (entry !== null) fetched = entry.headword;
          } catch {
            // The id stands in for the word.
          }
        }
        return { ...note, word: noteWord(note.word, fetched, note.id) };
      }),
    );
  }

  /**
   * The part of speech and the first gloss of each entry, for the rows of one list.
   * @param {string[]} ids
   * @returns {Promise<Map<string, { pos: string, gloss: string }>>}
   */
  async function describeItems(ids) {
    /** @type {Map<string, { pos: string, gloss: string }>} */
    const out = new Map();
    await Promise.all(
      ids.map(async (id) => {
        try {
          const entry = await data.entry(id);
          if (entry === null) return;
          const group = entry.posList[0];
          out.set(id, { pos: group?.pos ?? '', gloss: group?.senses[0] ?? '' });
        } catch {
          // The row keeps the word alone.
        }
      }),
    );
    return out;
  }

  /**
   * The entry id of each word that is a headword. The alphabet rows link only those.
   * @param {string[]} words
   * @returns {Promise<Map<string, string>>}
   */
  async function wordIds(words) {
    /** @type {Map<string, string>} */
    const out = new Map();
    await Promise.all(
      words.map(async (word) => {
        try {
          const { rows } = await search.search(word);
          const hit = rows.find((row) => foldWord(row.headword) === foldWord(word));
          if (hit !== undefined) out.set(word, hit.id);
        } catch {
          // The word stays plain.
        }
      }),
    );
    return out;
  }

  /** @type {ReturnType<typeof posIndex> | null} */
  let posGroups = null;
  /** @type {Promise<ReturnType<typeof posIndex>> | null} */
  let posLoaded = null;

  /**
   * The parts-of-speech index, built once from the CEFR decks, which cover every entry.
   * @returns {Promise<ReturnType<typeof posIndex>>}
   */
  function loadPos() {
    if (posLoaded === null) {
      posLoaded = Promise.all(BANDS.map((band) => data.cefr(band)))
        .then((decks) => {
          posGroups = posIndex(decks.flat());
          return posGroups;
        })
        .catch((error) => {
          posLoaded = null;
          throw error;
        });
    }
    return posLoaded;
  }

  /**
   * The six bands with the number of cards the manifest lists for each.
   * @returns {Promise<Array<{ band: string, count: number }>>}
   */
  function cefrRows() {
    return Promise.all(BANDS.map(async (band) => ({ band, count: await data.cefrCount(band) })));
  }

  /**
   * What the About screen shows, read from the manifest.
   * @returns {Promise<{ version: string, built: string, entries: number, examples: number }>}
   */
  function aboutInfo() {
    return data.manifest().then((manifest) => ({
      version: manifest.version,
      built: manifest.built,
      entries: manifest.totals.entries,
      examples: manifest.totals.examples,
    }));
  }

  /**
   * The size of the download the Offline screens offer.
   * @returns {Promise<{ files: number, bytes: number }>}
   */
  async function offlineInfo() {
    const manifest = await data.manifest();
    return { files: fileUrls(manifest).length, bytes: manifest.totals.bytes };
  }

  /**
   * Fetch every data file once, in order, reporting progress.
   * @param {(done: number, total: number, failed: number) => void} onProgress
   */
  function downloadDictionary(onProgress) {
    return data.manifest().then((manifest) => downloadAll(manifest, { onProgress }));
  }

  /** Put the stored theme and text size on the page. */
  function applySettings() {
    const settings = storage.settings();
    const html = doc.documentElement;
    if (!html) return;
    if (settings.theme === 'system') html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', settings.theme);
    html.setAttribute('data-text-size', String(settings.textSize));
  }
  applySettings();

  const listsView = ui.listsScreen({
    lists: () => storage.lists(),
    folders: () => storage.folders(),
    history: () => storage.history(),
    notesCount: () => storage.notes().length,
    notes: noteRows,
    rows: describeItems,
    addList: (name, label, folder) => {
      storage.addList(name, label, folder);
    },
    addFolder: (name) => {
      storage.addFolder(name);
    },
    removeList: (id) => storage.removeList(id),
    removeItem: (listId, itemId) => storage.removeItem(listId, itemId),
    importText,
    restoreText,
    shareList,
    confirm: ask,
    onSettings: () => router.navigate(HASH.settings),
    onSearch: (query) => {
      searchView.setQuery(query);
      router.navigate(HASH.search);
    },
  });

  /** @type {ReturnType<typeof ui.settingsScreen> | null} */
  let settingsView = null;
  /**
   * Build the Settings screen on first use. It reads the dictionary size, and boot fetches no
   * data file.
   * @returns {ReturnType<typeof ui.settingsScreen>}
   */
  function getSettings() {
    if (settingsView === null) {
      settingsView = ui.settingsScreen({
        settings: () => storage.settings(),
        setSettings: (patch) => {
          storage.setSettings(patch);
          applySettings();
        },
        size: () => storage.size(),
        exportBackup,
        restoreText,
        download: downloadDictionary,
        offline: offlineInfo,
      });
    }
    return settingsView;
  }

  const referenceView = ui.referenceScreen({
    about: aboutInfo,
    alphabetIds: wordIds,
    pos: loadPos,
    cefr: cefrRows,
    startDeck: (band) => {
      void studyView.start(band);
      router.navigate(HASH.study);
    },
    download: downloadDictionary,
    offline: offlineInfo,
  });

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
    const row = known ?? { folded: '', id, headword: id, pronunciation: '', pos: '', gloss: '', en: '' };
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
      lists: () => storage.lists(),
      listIds: (id) => storage.listIdsWith(id),
      toggleItem: (listId, item) => {
        storage.toggleItem(listId, item);
      },
      addList: (name, label) => storage.addList(name, label),
      note: (id) => storage.note(id),
      setNote: (id, text, word) => {
        storage.setNote(id, text, word);
        listsView.refresh();
      },
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

    if (route.name === 'lists') {
      listsView.refresh();
      main.replaceChildren(listsView.node);
      return;
    }

    if (route.name === 'settings') {
      const view = getSettings();
      view.refresh();
      main.replaceChildren(view.node);
      return;
    }

    if (route.name === 'reference') {
      main.replaceChildren(referenceView.node);
      return;
    }

    if (route.name === 'study') {
      studyView.refresh();
      main.replaceChildren(studyView.node);
      return () => speech.cancel();
    }

    main.replaceChildren(ui.placeholder(NO_ENTRY));
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
