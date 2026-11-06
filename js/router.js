// @ts-check
/**
 * The hash router: seven routes, one default, one redirect.
 *
 * | URL | Screen |
 * |---|---|
 * | `#/search` | the field, the history and the result rows — the default screen |
 * | `#/entry/<id>` | one entry |
 * | `#/text` `#/reference` `#/lists` `#/study` | placeholder screens, each naming its milestone |
 * | `#/settings` | a placeholder, reached from Lists later |
 *
 * The fragment never leaves the browser, so GitHub Pages needs no rewrite, a reload never 404s,
 * and the deploy subpath never reaches this module: every URL in the app is relative.
 *
 * One rule keeps hand-typed and stale links safe: a fragment that is not one of the seven is
 * replaced with `#/search` in the address bar, through `location.replace()` — never pushed — so
 * Back leaves the app instead of bouncing off a dead route.
 *
 * The router owns screen lifetime too: whatever `render` returns is that screen's teardown, and
 * it runs before the next screen renders and on `stop()`.
 *
 * `window` is a parameter with a browser default, so `tools/sanity.mjs` drives cold loads,
 * redirects and back/forward with a fake and no DOM.
 */

/** The five tab screens and the one screen without a tab. */
export const HASH = Object.freeze({
  search: '#/search',
  text: '#/text',
  reference: '#/reference',
  lists: '#/lists',
  study: '#/study',
  settings: '#/settings',
});

/** @typedef {'search' | 'entry' | 'text' | 'reference' | 'lists' | 'study' | 'settings'} RouteName */
/** @typedef {{ name: RouteName, id: string | null }} Route */

/** @type {Array<Exclude<RouteName, 'entry'>>} */
const NAMES = ['search', 'text', 'reference', 'lists', 'study', 'settings'];

/** The six id-less routes, frozen and shared, so a screen cannot poison one. */
/** @type {Map<string, Route>} */
const PLAIN = new Map(NAMES.map((name) => [name, Object.freeze({ name, id: null })]));

/** The default screen, shared like the rest. */
const SEARCH_ROUTE = /** @type {Route} */ (PLAIN.get('search'));

/**
 * @param {string} id an entry id
 * @returns {string} its route
 */
export function entryHash(id) {
  return `#/entry/${encodeURIComponent(id)}`;
}

/**
 * Parse one fragment. Deliberately strict: a trailing slash, an empty id or a fourth segment is
 * not "close enough", it is an unknown route.
 *
 * @param {string} hash `location.hash` — with or without its `#`, and `''` for "no fragment"
 * @returns {Route | null}
 */
export function parseRoute(hash) {
  const raw = typeof hash === 'string' ? hash : '';
  const fragment = raw.startsWith('#') ? raw.slice(1) : raw;
  if (fragment === '' || fragment === '/') return SEARCH_ROUTE;
  const parts = fragment.split('/');
  if (parts[0] !== '') return null;
  if (parts.length === 2) return PLAIN.get(parts[1]) ?? null;
  if (parts.length !== 3 || parts[1] !== 'entry' || parts[2] === '') return null;
  try {
    const id = decodeURIComponent(parts[2]);
    return id === '' ? null : { name: 'entry', id };
  } catch {
    return null;
  }
}

/**
 * Resolve a fragment into the screen to render and the fragment that belongs in the address bar.
 *
 * @param {string} hash
 * @returns {{ route: Route, redirect: string | null }}
 */
export function resolveRoute(hash) {
  const route = parseRoute(hash);
  return route === null ? { route: SEARCH_ROUTE, redirect: HASH.search } : { route, redirect: null };
}

/**
 * The slice of the browser the router touches, injected by the sanity suite.
 * @typedef {{
 *   location: { hash: string, replace: (url: string) => void },
 *   addEventListener: (type: string, listener: (event: unknown) => void) => void,
 *   removeEventListener: (type: string, listener: (event: unknown) => void) => void,
 * }} RouterWindow
 */

/** What a screen gets besides its route: the router's own navigation. */
/** @typedef {{ navigate: (hash: string, options?: { replace?: boolean }) => void }} RouterHost */

/** The browser's `window`; under Node a fake is injected instead. */
function defaultWindow() {
  return /** @type {RouterWindow} */ (/** @type {unknown} */ (globalThis));
}

/**
 * Wire the hash to a renderer.
 *
 * @param {{
 *   render: (route: Route, host: RouterHost) => (() => void) | void,
 *   window?: RouterWindow,
 * }} options
 */
export function createRouter(options) {
  if (typeof options.render !== 'function') {
    throw new Error('itadict router: createRouter needs a render function');
  }
  const win = options.window ?? defaultWindow();
  const render = options.render;

  /** @type {Route | null} */
  let current = null;
  /** @type {(() => void) | null} */
  let teardown = null;
  /** The fragment the current screen was rendered for, so a repeat hash is not a navigation. */
  /** @type {string | null} */
  let rendered = null;
  let started = false;

  /**
   * @param {string} hash
   * @param {{ replace?: boolean }} [navOptions]
   */
  function navigate(hash, navOptions = {}) {
    if (navOptions.replace === true) win.location.replace(hash);
    else win.location.hash = hash;
  }

  /** @type {RouterHost} */
  const host = { navigate };

  /** @param {Route} route */
  function renderRoute(route) {
    if (teardown !== null) {
      const done = teardown;
      teardown = null;
      done();
    }
    current = route;
    const result = render(route, host);
    teardown = typeof result === 'function' ? result : null;
  }

  /**
   * Show whatever `hash` means. The target is recorded before the redirect is applied, because
   * the browser queues the redirect's `hashchange` and would otherwise render the screen twice.
   * @param {string} hash
   */
  function show(hash) {
    const { route, redirect } = resolveRoute(hash);
    const target = redirect ?? (hash === '' || hash === '#' ? HASH.search : hash);
    // The URL is repaired even when the redirect lands on the screen already drawn, so an
    // unknown fragment never stays in the address bar.
    if (redirect !== null && win.location.hash !== target) win.location.replace(target);
    if (rendered === target) return;
    rendered = target;
    renderRoute(route);
  }

  const onHashChange = () => show(win.location.hash);

  return {
    /** Render the current fragment. Idempotent. */
    start() {
      if (started) return;
      started = true;
      win.addEventListener('hashchange', onHashChange);
      show(win.location.hash);
    },
    /** Unhook the hash and tear the current screen down. */
    stop() {
      if (started) {
        win.removeEventListener('hashchange', onHashChange);
        started = false;
      }
      if (teardown !== null) {
        const done = teardown;
        teardown = null;
        done();
      }
      current = null;
      rendered = null;
    },
    navigate,
    /** @returns {Route | null} the rendered route, or `null` before `start()`/after `stop()` */
    current: () => current,
  };
}
