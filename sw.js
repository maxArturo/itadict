// One classic worker, no imports. ADR 0003 is the contract.
//
// Two caches, not one. The shell cache holds the shell and the app code and dies on every deploy.
// The data cache holds content files whose URL carries their hash, so it is never dropped.
//
// Every cache read is a miss, never an error. A miss falls back to the network, and a network miss
// answers 504. Nothing non-OK is ever written to a cache.

// Bumped by hand on every deploy. GitHub Pages sends max-age=600 on sw.js itself, so this constant
// is the only way a fix reaches an installed app.
const CACHE = 'v2';

const SHELL_CACHE = 'itadict-shell-' + CACHE;
const DATA_CACHE = 'itadict-data';

// The subpath, read off this file's own URL: /itadict/.
const SCOPE = new URL('./', self.location.href).pathname;
const DATA = SCOPE + 'data/';
const MANIFEST = DATA + 'index.json';

// The shell and the app code. Every path is relative, like every other URL in the app.
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/data.js',
  './js/lists.js',
  './js/offline.js',
  './js/reference.js',
  './js/router.js',
  './js/search.js',
  './js/speech.js',
  './js/storage.js',
  './js/study.js',
  './js/text.js',
  './js/ui.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

/** App code: network-first, so a fix lands on the first online load. */
const CODE = /\.(?:js|css|webmanifest)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(activate());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE)) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }
  if (url.pathname === MANIFEST) {
    event.respondWith(revalidate(event, request));
    return;
  }
  if (url.pathname.startsWith(DATA)) {
    event.respondWith(cacheFirst(DATA_CACHE, request));
    return;
  }
  // App code is matched before the shell, so styles.css and the manifest are precached and also
  // network-first.
  if (CODE.test(url.pathname)) {
    event.respondWith(networkFirst(SHELL_CACHE, request));
  }
});

/**
 * Precache the shell, then take over without waiting for the old worker to idle.
 *
 * The manifest goes in the data cache too. Boot reads it before the worker controls the page,
 * so a fetch the page makes at boot is never cached by the strategies below. Without this, an
 * offline boot has the shell and no file list.
 */
async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  await Promise.all(SHELL.map((path) => putIfOk(shell, path)));
  const data = await caches.open(DATA_CACHE);
  await putIfOk(data, MANIFEST);
  await self.skipWaiting();
}

/** Drop the last deploy's shell cache, then sweep content the new manifest no longer lists. */
async function activate() {
  for (const name of await caches.keys()) {
    if (name.startsWith('itadict-shell-') && name !== SHELL_CACHE) await caches.delete(name);
  }
  await sweep();
  await self.clients.claim();
}

/**
 * Delete content files the current manifest does not list. A manifest that cannot be read leaves
 * the data cache alone: offline, a sweep would delete the whole downloaded dictionary.
 */
async function sweep() {
  const listed = await listedUrls();
  if (listed === null) return;
  const cache = await caches.open(DATA_CACHE);
  for (const request of await cache.keys()) {
    const url = new URL(request.url);
    if (!listed.has(url.pathname + url.search)) await cache.delete(request);
  }
}

/**
 * Every URL the current manifest lists, or null when it cannot be read.
 * @returns {Promise<Set<string> | null>}
 */
async function listedUrls() {
  try {
    const response = await fetch(MANIFEST, { cache: 'reload' });
    if (!response.ok) return null;
    const manifest = await response.json();
    const listed = new Set([MANIFEST]);
    for (const bucket of Object.values(manifest.buckets ?? {})) {
      for (const kind of ['search', 'entry', 'ex', 'forms']) {
        for (const shard of bucket[kind] ?? []) {
          const url = new URL(SCOPE + shard.path, self.location.origin);
          listed.add(url.pathname);
          if (shard.hash) {
            url.searchParams.set('v', shard.hash);
            listed.add(url.pathname + url.search);
          }
        }
      }
    }
    return listed;
  } catch (error) {
    return null;
  }
}

/** A navigation draws the cached index.html, so a phone with no signal never sees an error page. */
async function navigate(request) {
  const shell = await matchIn(SHELL_CACHE, './index.html');
  if (shell !== null) return shell;
  try {
    return await fetch(request);
  } catch (error) {
    return miss();
  }
}

/** Content: cache-first, cached forever. The URL carries the file hash, so a hit can never be old. */
async function cacheFirst(cacheName, request) {
  const cached = await matchIn(cacheName, request);
  if (cached !== null) return cached;
  return networkAndPut(cacheName, request);
}

/** App code: network-first, cache fallback. */
async function networkFirst(cacheName, request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return (await matchIn(cacheName, request)) ?? miss();
  }
}

/** The manifest: the cached list at once, the fresh one behind it. */
async function revalidate(event, request) {
  const cached = await matchIn(DATA_CACHE, request);
  const fresh = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(DATA_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  if (cached !== null) {
    event.waitUntil(fresh);
    return cached;
  }
  return (await fresh) ?? miss();
}

/**
 * One cache lookup that cannot throw.
 * @param {string} cacheName
 * @param {RequestInfo} request
 * @returns {Promise<Response | null>}
 */
async function matchIn(cacheName, request) {
  try {
    return (await caches.match(request, { cacheName })) ?? null;
  } catch (error) {
    return null;
  }
}

/**
 * Precache one shell file. A missing file must not fail the whole install: the next install
 * retries it, and the app still opens.
 * @param {Cache} cache
 * @param {string} path
 * @returns {Promise<void>}
 */
async function putIfOk(cache, path) {
  try {
    const response = await fetch(path, { cache: 'reload' });
    if (response.ok) await cache.put(path, response);
  } catch (error) {
    // offline install: nothing to cache, and nothing that can be cached now
  }
}

/**
 * Fetch, cache an OK response, and hand the response to the page either way.
 * @param {string} cacheName
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function networkAndPut(cacheName, request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return miss();
  }
}

/** A cache miss with no network is a failure the page can catch, never a thrown fetch. */
function miss() {
  return new Response('', { status: 504, statusText: 'offline' });
}
