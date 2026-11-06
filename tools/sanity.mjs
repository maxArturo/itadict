/**
 * The shell's checks. `npm test`. node:assert only, no framework, no browser.
 *
 * What is checked is what would fail silently: folding, ranking order and cap, routing, the
 * envelope, and the manifest. Layout, focus, safe areas and taps need the browser, and are
 * checked by hand against `python3 -m http.server`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { bucketKey, createData, parseExamples, parseForms, parseManifest, pickFiles, toEntry, toRow } from '../js/data.js';
import { HASH, createRouter, entryHash, parseRoute, resolveRoute } from '../js/router.js';
import { createSearch, editDistanceAtMost, findMatch, fold, rank } from '../js/search.js';
import { HISTORY_MAX, KEY, OPENED_MAX, VERSION, createStorage, migrate } from '../js/storage.js';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

/** A `localStorage`-shaped backend. @param {string | null} [initial] */
function fakeBackend(initial = null) {
  const store = new Map();
  if (initial !== null) store.set(KEY, initial);
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    raw: () => store.get(KEY) ?? null,
  };
}

/** A `window` with a hash, a recording replace, and a manual hashchange. @param {string} hash */
function fakeWindow(hash) {
  const listeners = new Set();
  const replaceCalls = [];
  const win = {
    location: {
      hash,
      replace(url) {
        replaceCalls.push(url);
        win.location.hash = url;
      },
    },
    addEventListener(type, listener) {
      if (type === 'hashchange') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.delete(listener);
    },
  };
  return { win, replaceCalls, fire: () => [...listeners].forEach((listener) => listener({})) };
}

/** A search row, shaped as `js/data.js` hands one out. */
const row = (headword, folded, gloss, rankValue) => ({ folded, id: headword, headword, pronunciation: '', gloss, rank: rankValue });

/** A fetch over an in-memory file map, counting every call. @param {Record<string, unknown>} files */
function fileFetch(files) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (!(url in files)) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => files[url] };
  };
  return { calls, fetch };
}

// ---------------------------------------------------------------- the shipped files

test('every module carries the typecheck pragma, and the page loads only relative URLs', () => {
  for (const name of ['app', 'data', 'router', 'search', 'storage', 'ui']) {
    const source = read('../js/' + name + '.js');
    assert.equal(source.split('\n')[0], '// @ts-check', 'js/' + name + '.js');
    assert.doesNotMatch(source, /\.innerHTML\b/, 'js/' + name + '.js writes no markup');
  }

  const html = read('../index.html');
  assert.match(html, /src="\.\/js\/app\.js"/);
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /href="\.\/manifest\.webmanifest"/);
  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /(?:src|href)="\/(?!\/)/, 'no absolute URL');

  const css = read('../styles.css');
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /--tap:\s*44px/);
  assert.match(css, /min-height:\s*var\(--tap\)/);
  assert.match(css, /overscroll-behavior-y:\s*contain/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
});

// ---------------------------------------------------------------- folding and matching

test('folding drops accents and case; the bucket key keeps two letters and digits', () => {
  assert.equal(fold('Perché'), 'perche');
  assert.equal(fold('CITTÀ'), 'citta');
  assert.equal(bucketKey('Casa'), 'ca');
  assert.equal(bucketKey('città'), 'ci');
  assert.equal(bucketKey('c'), 'c');
  assert.equal(bucketKey("c'è"), 'ce');
});

test('findMatch maps a folded match back to the unfolded offsets', () => {
  assert.deepEqual(findMatch('La casa è grande.', 'casa'), { start: 3, end: 7 });
  assert.deepEqual(findMatch('Perché lui?', 'PERCHE'), { start: 0, end: 6 });
  assert.deepEqual(findMatch('città', 'citta'), { start: 0, end: 5 });
  assert.equal(findMatch('casa', 'via'), null);
});

test('the edit distance is abandoned above the budget', () => {
  assert.equal(editDistanceAtMost('casa', 'case', 1), 1);
  assert.equal(editDistanceAtMost('casa', 'cassetta', 2), 3);
  assert.equal(editDistanceAtMost('casa', 'csaa', 2), 2);
});

// ---------------------------------------------------------------- ranking

test('ranking is exact, then prefix, then fuzzy, and a one-character query matches nothing', () => {
  const rows = [row('casale', 'casale', 'farmhouse', 3), row('casata', 'casata', 'lineage', 2), row('casa', 'casa', 'house', 1)];

  assert.deepEqual(rank(rows, 'c').prefix, [], 'one character reads history, not the dictionary');
  assert.deepEqual(rank(rows, 'casa').exact.map((entry) => entry.id), ['casa']);
  assert.deepEqual(rank(rows, 'casa').prefix.map((entry) => entry.id), ['casata', 'casale'], 'equal length, then the extract rank');
  assert.deepEqual(rank(rows, 'casx').fuzzy.map((entry) => entry.id), ['casa'], 'distance 1 for four characters');
  assert.deepEqual(rank(rows, 'casa', 1).fuzzy, [], 'a full exact step skips fuzzy');
});

test('the exact case-and-accent match wins its tie', () => {
  const rows = [row('perché', 'perche', 'why', 9), row('perche', 'perche', 'why', 1)];
  assert.deepEqual(rank(rows, 'perche').exact.map((entry) => entry.headword), ['perche', 'perché']);
  assert.deepEqual(rank(rows, 'perché').exact.map((entry) => entry.headword), ['perché', 'perche']);
});

// ---------------------------------------------------------------- the search pipeline

/** A data set that answers from memory, filtering by bucket the way the real one does. */
function memoryData(rows, forms = new Map()) {
  const asked = [];
  return {
    asked,
    rows: async (key) => {
      asked.push('rows:' + key);
      return rows.filter((entry) => entry.folded.startsWith(key.slice(0, 2)));
    },
    forms: async (key) => {
      asked.push('forms:' + key);
      return forms;
    },
    entry: async () => null,
    examples: async () => new Map(),
  };
}

test('a query of one character reads history, not the dictionary', async () => {
  const storage = createStorage(fakeBackend());
  storage.addQuery('casa');
  storage.addQuery('via');
  const data = memoryData([]);
  const search = createSearch({ data, storage });

  assert.deepEqual(await search.search(''), { rows: [], history: ['via', 'casa'] });
  const one = await search.search('c');
  assert.deepEqual(one.rows, []);
  assert.deepEqual(one.history, ['casa'], 'history is filtered by the one character');
  assert.deepEqual(data.asked, [], 'no bucket was fetched');
});

test('exact beats prefix, and an inflected form resolves to its lemma row', async () => {
  const rows = [row('casetta', 'casetta', 'little house', 3), row('casa', 'casa', 'house', 1), row('cassa', 'cassa', 'box', 2)];
  const data = memoryData(rows, new Map([['case', { lemma: 'casa', label: 'plurale' }]]));
  const search = createSearch({ data, storage: createStorage(fakeBackend()) });

  const result = await search.search('case');
  assert.deepEqual(result.rows.map((entry) => entry.id), ['casetta', 'casa']);
  assert.equal(result.rows[1].matched, 'case', 'the secondary line shows the form that was typed');
  assert.equal(search.row('casa')?.headword, 'casa', 'a shown row is remembered for the entry screen');
});

test('an inflected form resolves to a lemma in another bucket', async () => {
  const rows = [row('andare', 'andare', 'to go', 1)];
  const data = memoryData(rows, new Map([['vado', { lemma: 'andare', label: 'presente 1s' }]]));
  const search = createSearch({ data, storage: createStorage(fakeBackend()) });
  const result = await search.search('vado');
  assert.deepEqual(result.rows.map((entry) => entry.id), ['andare']);
  assert.equal(result.rows[0].gloss, 'to go', 'the lemma row carries its gloss');
  assert.equal(result.rows[0].matched, 'vado');
});

// ---------------------------------------------------------------- routes

test('the router parses exactly the seven routes, and nothing else', () => {
  assert.deepEqual(parseRoute(''), { name: 'search', id: null });
  assert.deepEqual(parseRoute('#/'), { name: 'search', id: null });
  for (const name of ['search', 'text', 'reference', 'lists', 'study', 'settings']) {
    assert.deepEqual(parseRoute('#/' + name), { name, id: null });
  }
  assert.deepEqual(parseRoute('#/entry/casa'), { name: 'entry', id: 'casa' });
  assert.deepEqual(parseRoute(entryHash('casa bella')), { name: 'entry', id: 'casa bella' });
  for (const hash of ['#/nope', '#/entry', '#/entry/', '#/entry/a/b', '#/search/x', 'nope', '#/Entry/casa']) {
    assert.equal(parseRoute(hash), null, hash + ' is not a route');
  }
});

test('an unknown fragment repairs the URL even when Search is already drawn', () => {
  const { win, replaceCalls, fire } = fakeWindow('#/search');
  const seen = [];
  const router = createRouter({ window: win, render: (route) => seen.push(route.name) });

  router.start();
  win.location.hash = '#/nope';
  fire();
  assert.deepEqual(replaceCalls, [HASH.search]);
  assert.equal(win.location.hash, HASH.search);
  assert.deepEqual(seen, ['search'], 'the screen is not drawn twice');

  win.location.hash = '';
  fire();
  assert.equal(win.location.hash, '', 'no fragment renders Search without writing one into the URL');
  assert.deepEqual(seen, ['search']);
});

test('a route renders once, a repeat hash is not a navigation, and leaving tears down', () => {
  const { win, fire } = fakeWindow('#/search');
  const log = [];
  const router = createRouter({
    window: win,
    render: (route) => {
      const name = route.id ?? route.name;
      log.push('render ' + name);
      return () => log.push('teardown ' + name);
    },
  });

  router.start();
  win.location.hash = HASH.text;
  fire();
  win.location.hash = HASH.text;
  fire();
  win.location.hash = entryHash('casa');
  fire();
  router.stop();

  assert.deepEqual(log, ['render search', 'teardown search', 'render text', 'teardown text', 'render casa', 'teardown casa']);
  assert.equal(router.current(), null);
  assert.throws(() => createRouter({}), /render/);
  assert.deepEqual(resolveRoute('#/nope'), { route: { name: 'search', id: null }, redirect: HASH.search });
});

// ---------------------------------------------------------------- the envelope

test('the envelope migrates forward, keeps unknown keys, and caps both lists', () => {
  const data = migrate(undefined, {
    history: [' casa ', '', 3, 'via'],
    opened: [{ id: 'casa', bucket: 'ca' }, { id: 1 }, null],
    later: true,
  });
  assert.deepEqual(data.history, ['casa', 'via']);
  assert.deepEqual(data.opened, [{ id: 'casa', bucket: 'ca' }]);
  assert.equal(data.later, true, 'a key this build does not know survives');

  const many = migrate(VERSION, {
    history: Array.from({ length: HISTORY_MAX + 10 }, (_, index) => 'q' + index),
    opened: Array.from({ length: OPENED_MAX + 10 }, (_, index) => ({ id: 'e' + index, bucket: 'ee' })),
  });
  assert.equal(many.history.length, HISTORY_MAX);
  assert.equal(many.opened.length, OPENED_MAX);
});

test('storage de-duplicates a query, remembers a bucket, and refuses a blob it cannot read', () => {
  const backend = fakeBackend();
  const storage = createStorage(backend);
  storage.addQuery(' casa ');
  storage.addQuery('via');
  storage.addQuery('casa');
  assert.deepEqual(storage.history(), ['casa', 'via'], 'newest first, no duplicate');
  assert.deepEqual(JSON.parse(backend.raw()), { v: VERSION, data: { history: ['casa', 'via'], opened: [] } });

  storage.rememberEntry('casa', 'ca');
  assert.equal(storage.openedBucket('casa'), 'ca');
  assert.equal(storage.openedBucket('nope'), null);
  assert.deepEqual(createStorage(fakeBackend(backend.raw())).history(), ['casa', 'via'], 'the blob round-trips');

  const brokenBlob = fakeBackend('not json');
  const broken = createStorage(brokenBlob);
  assert.equal(broken.writable, false);
  assert.deepEqual(broken.addQuery('casa'), ['casa'], 'this session still holds the query');
  assert.equal(brokenBlob.raw(), 'not json', 'the unreadable blob is left exactly where it is');

  const newer = createStorage(fakeBackend(JSON.stringify({ v: VERSION + 1, data: { history: ['casa'] } })));
  assert.equal(newer.writable, false);
  assert.deepEqual(newer.history(), ['casa'], 'readable, but never written over');
});

// ---------------------------------------------------------------- the data contract

test('the manifest parses into four file sets per bucket, and skips a broken bucket', () => {
  const manifest = parseManifest({
    version: 'v1-x',
    built: '2026-01-01',
    partial: false,
    sources: [{ name: 'kaikki', url: 'https://example.org', licence: 'CC BY-SA' }, 'nonsense'],
    totals: { entries: 2, forms: 3, examples: 4, bytes: 5 },
    buckets: {
      ca: {
        search: [{ path: 'data/ca.json', bytes: 10, hash: 'a' }],
        entry: [{ path: 'data/entry/ca.json', bytes: 11 }],
        ex: [{ path: 'data/ex/ca.json', bytes: 12 }],
        forms: [{ path: 'data/forms/ca.json', bytes: 13 }],
      },
      broken: { search: [{ nope: true }] },
      empty: {},
    },
  });
  assert.equal(manifest?.version, 'v1-x');
  assert.equal(manifest?.partial, false);
  assert.deepEqual(manifest?.totals, { entries: 2, forms: 3, examples: 4, bytes: 5 });
  assert.deepEqual(manifest?.sources, [{ name: 'kaikki', url: 'https://example.org', licence: 'CC BY-SA' }]);
  assert.deepEqual(manifest?.buckets.ca.search, [{ path: 'data/ca.json', bytes: 10, hash: 'a' }]);
  assert.deepEqual(manifest?.buckets.ca.forms, [{ path: 'data/forms/ca.json', bytes: 13, hash: '' }]);
  assert.equal(manifest?.buckets.broken, undefined);
  assert.equal(manifest?.buckets.empty, undefined);
  assert.equal(parseManifest([]), null);
  assert.equal(parseManifest({ buckets: {} }), null);
});

test('the file for a key is the longest file prefix the key starts with', () => {
  const files = [{ path: 'data/ca.json', bytes: 1, hash: '' }, { path: 'data/ca/cas.json', bytes: 1, hash: '' }, { path: 'data/ca/cat.json', bytes: 1, hash: '' }];
  assert.deepEqual(pickFiles(files, 'casa').map((file) => file.path), ['data/ca/cas.json']);
  assert.deepEqual(pickFiles(files, 'catone').map((file) => file.path), ['data/ca/cat.json']);
  assert.deepEqual(pickFiles(files, 'ca').map((file) => file.path), ['data/ca.json']);
  assert.deepEqual(pickFiles(files, 'cb'), files, 'a key shorter than every split prefix reads the bucket');
  assert.deepEqual(pickFiles([], 'casa'), []);
});

test('a row, an entry and the two lookups are read from the shapes the build writes', () => {
  assert.deepEqual(toRow(['casa', 'it-casa', 'casa', '/ˈkaza/', 'house']), {
    folded: 'casa',
    id: 'it-casa',
    headword: 'casa',
    pronunciation: '/ˈkaza/',
    gloss: 'house',
    rank: 0,
  });
  assert.equal(toRow(['casa', '', 'casa']), null, 'a row without an id cannot be opened');

  const entry = toEntry({
    id: 'it-casa',
    word: 'casa',
    pos: 'noun',
    cefr: 'a1',
    ipa: '/ˈkaza/',
    senses: ['house', 'home'],
    ex: ['e1', 'e2'],
    conj: [['case', 'plurale']],
  });
  assert.deepEqual(entry, {
    id: 'it-casa',
    headword: 'casa',
    pronunciation: '/ˈkaza/',
    cefr: 'a1',
    translation: ['house', 'home'],
    forms: [{ label: 'plurale', value: 'case' }],
    exampleIds: ['e1', 'e2'],
  });
  assert.equal(toEntry({ id: 'x' }), null, 'an entry without a word cannot be drawn');

  assert.deepEqual([...parseForms({ case: { lemma: 'casa', label: 'plurale' } }).entries()], [['case', { lemma: 'casa', label: 'plurale' }]]);
  assert.deepEqual([...parseExamples({ e1: 'La casa è grande.' }).entries()], [['e1', 'La casa è grande.']]);
});

test('createData reads the manifest once and one file per lookup', async () => {
  const { calls, fetch } = fileFetch({
    'data/index.json': {
      version: 'v1',
      buckets: {
        ca: {
          search: [{ path: 'data/ca.json' }],
          entry: [{ path: 'data/entry/ca.json' }],
          ex: [{ path: 'data/ex/ca.json' }],
          forms: [{ path: 'data/forms/ca.json' }],
        },
      },
    },
    'data/ca.json': [['casa', 'it-casa', 'casa', '/ˈkaza/', 'house'], ['cane', 'it-cane', 'cane', '', 'dog'], 'junk'],
    'data/entry/ca.json': [{ id: 'it-casa', word: 'casa', pos: 'noun', cefr: 'a1', senses: ['house'], ex: ['e1'], conj: [['case', 'plurale']] }],
    'data/ex/ca.json': { e1: 'La casa è grande.' },
    'data/forms/ca.json': { case: { lemma: 'casa', label: 'plurale' } },
  });
  const data = createData({ fetch, base: '' });

  assert.equal((await data.rows('casa')).length, 2, 'a junk row is dropped');
  await data.rows('casa');
  assert.equal(calls.filter((url) => url === 'data/index.json').length, 1, 'the manifest is fetched once');
  assert.equal(calls.filter((url) => url === 'data/ca.json').length, 1, 'a bucket file is fetched once');
  assert.deepEqual(await data.rows('zz'), [], 'a bucket the manifest does not list is empty');
  assert.equal(calls.some((url) => url.includes('zz')), false, 'and costs no request, so it cannot log a 404');

  assert.deepEqual((await data.forms('case')).get('case'), { lemma: 'casa', label: 'plurale' });
  const entry = await data.entry('ca', 'it-casa');
  assert.deepEqual(entry?.translation, ['house']);
  assert.deepEqual(entry?.exampleIds, ['e1'], 'an entry body carries sentence ids, not sentences');
  assert.equal((await data.examples('ca')).get('e1'), 'La casa è grande.');
  assert.equal(await data.entry('ca', 'nothing'), null);
});

// ---------------------------------------------------------------- the budget

test('ranking a 5,000-row bucket stays far below a keystroke', () => {
  const syllables = ['ca', 'sa', 'ta', 're', 'li', 'bro', 'stra', 'zio', 'ne', 'mo', 'tta', 'gno'];
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const rows = [];
  for (let index = 0; index < 5000; index += 1) {
    let word = '';
    const parts = 2 + Math.floor(random() * 3);
    for (let k = 0; k < parts; k += 1) word += syllables[Math.floor(random() * syllables.length)];
    rows.push(row(word, word, 'una glossa breve', index));
  }
  const queries = ['ca', 'casa', 'strada', 'perche', 'casta', 'casetta', 'zzzzz', 'libro'];
  for (const query of queries) rank(rows, query);

  const rounds = 20;
  const started = performance.now();
  for (let round = 0; round < rounds; round += 1) for (const query of queries) rank(rows, query);
  const perQuery = (performance.now() - started) / (rounds * queries.length);
  console.log('rank(): ' + perQuery.toFixed(2) + ' ms per query over ' + rows.length + ' rows');
  assert.ok(perQuery < 25, 'a keystroke must stay under the 25 ms budget, got ' + perQuery.toFixed(2));
});
