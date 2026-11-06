/**
 * The shell's checks. `npm test`. node:assert only, no framework, no browser.
 *
 * What is checked is what would fail silently: folding, ranking order and cap, routing, the
 * envelope, the manifest and its cache-busting hashes, the entry id, and the FORMS order. Layout,
 * focus, safe areas and taps need the browser, checked by hand against `python3 -m http.server`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  bucketKey,
  bucketOfId,
  createData,
  parseExamples,
  parseForms,
  parseManifest,
  pickFiles,
  shardUrl,
  toEntry,
  toRow,
} from '../js/data.js';
import { HASH, createRouter, entryHash, parseRoute, resolveRoute } from '../js/router.js';
import { createSearch, editDistanceAtMost, findMatch, fold, rank } from '../js/search.js';
import { HISTORY_MAX, KEY, VERSION, createStorage, migrate } from '../js/storage.js';
import { formRows } from '../js/ui.js';

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
const row = (headword, folded, gloss) => ({ folded, id: headword, headword, pronunciation: '', pos: '', gloss });

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
  assert.match(css, /scroll-padding-top:\s*56px/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /#6e6e73/i);
  assert.doesNotMatch(css, /#8a8a8e/i, 'the secondary grey is never the low-contrast one');
});

// ---------------------------------------------------------------- folding and matching

test('folding drops accents and case; the bucket key keeps two letters and digits', () => {
  assert.equal(fold('Perché'), 'perche');
  assert.equal(fold('CITTÀ'), 'citta');
  assert.equal(bucketKey('Casa'), 'ca');
  assert.equal(bucketKey('città'), 'ci');
  assert.equal(bucketKey('c'), 'c');
  assert.equal(bucketKey("c'è"), 'ce');
  assert.equal(bucketOfId('ca:42'), 'ca');
  assert.equal(bucketOfId('nope'), '');
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
  const rows = [row('casata', 'casata', 'lineage'), row('casale', 'casale', 'farmhouse'), row('casa', 'casa', 'house')];

  assert.deepEqual(rank(rows, 'c').prefix, [], 'one character reads history, not the dictionary');
  assert.deepEqual(rank(rows, 'casa').exact.map((entry) => entry.id), ['casa']);
  assert.deepEqual(rank(rows, 'casa').prefix.map((entry) => entry.id), ['casale', 'casata'], 'equal length, then the alphabet');
  assert.deepEqual(rank(rows, 'casx').fuzzy.map((entry) => entry.id), ['casa'], 'distance 1 for four characters');
  assert.deepEqual(rank(rows, 'casa', 1).fuzzy, [], 'a full exact step skips fuzzy');
});

test('the exact case-and-accent match wins its tie', () => {
  const rows = [row('perché', 'perche', 'why'), row('perche', 'perche', 'why')];
  assert.deepEqual(rank(rows, 'perche').exact.map((entry) => entry.headword), ['perche', 'perché']);
  assert.deepEqual(rank(rows, 'perché').exact.map((entry) => entry.headword), ['perché', 'perche']);
});

// ---------------------------------------------------------------- the search pipeline

/** A data set that answers from memory, filtering by bucket the way the real one does. */
function memoryData(rows, forms = new Map()) {
  const asked = [];
  return {
    asked,
    manifest: async () => ({ buckets: {} }),
    rows: async (key) => {
      asked.push('rows:' + key);
      return rows.filter((entry) => entry.folded.startsWith(key.slice(0, 2)));
    },
    forms: async (key) => {
      asked.push('forms:' + key);
      return forms;
    },
    entry: async () => null,
    examples: async () => [],
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
  const rows = [row('casetta', 'casetta', 'little house'), row('casa', 'casa', 'house'), row('cassa', 'cassa', 'box')];
  const forms = new Map([['case', { id: 'casa', lemma: 'casa', label: 'plurale' }]]);
  const search = createSearch({ data: memoryData(rows, forms), storage: createStorage(fakeBackend()) });

  const result = await search.search('case');
  assert.deepEqual(result.rows.map((entry) => entry.id), ['casetta', 'casa'], 'the lemma row follows the prefix rows');
  assert.equal(result.rows[1].matched, 'case', 'the secondary line shows the form that was typed');
  assert.equal(search.row('casa')?.headword, 'casa', 'a shown row is remembered for the entry screen');
});

test('an inflected form resolves to a lemma in another bucket, by its id', async () => {
  const rows = [row('andare', 'andare', 'to go')];
  const forms = new Map([['vado', { id: 'andare', lemma: 'andare', label: 'presente 1s' }]]);
  const search = createSearch({ data: memoryData(rows, forms), storage: createStorage(fakeBackend()) });
  const result = await search.search('vado');
  assert.deepEqual(result.rows.map((entry) => entry.id), ['andare']);
  assert.equal(result.rows[0].gloss, 'to go');
  assert.equal(result.rows[0].matched, 'vado');
});

// ---------------------------------------------------------------- the FORMS table

test('the FORMS table starts at the present tense, and persons keep their slots', () => {
  const rows = formRows([
    { key: 'participio passato', personal: false, forms: ['andato'] },
    { key: 'indicativo presente', personal: true, forms: ['vado', 'vai', '', '', 'andate', ''] },
    { key: 'gerundio', personal: false, forms: ['andando'] },
    { key: 'imperativo', personal: true, forms: ['', 'vai'] },
  ]);
  assert.deepEqual(rows, [
    { label: 'presente · io', value: 'vado' },
    { label: 'presente · tu', value: 'vai' },
    { label: 'presente · voi', value: 'andate' },
    { label: 'gerundio', value: 'andando' },
    { label: 'participio passato', value: 'andato' },
  ], 'present first, gerundio before participio, imperativo not drawn');
  assert.deepEqual(formRows([]), []);
});

// ---------------------------------------------------------------- routes

test('the router parses exactly the seven routes, and nothing else', () => {
  assert.deepEqual(parseRoute(''), { name: 'search', id: null });
  assert.deepEqual(parseRoute('#/'), { name: 'search', id: null });
  for (const name of ['search', 'text', 'reference', 'lists', 'study', 'settings']) {
    assert.deepEqual(parseRoute('#/' + name), { name, id: null });
  }
  assert.deepEqual(parseRoute('#/entry/casa'), { name: 'entry', id: 'casa' });
  assert.deepEqual(parseRoute(entryHash('ca:42')), { name: 'entry', id: 'ca:42' });
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
  win.location.hash = entryHash('ca:42');
  fire();
  router.stop();

  assert.deepEqual(log, ['render search', 'teardown search', 'render text', 'teardown text', 'render ca:42', 'teardown ca:42']);
  assert.equal(router.current(), null);
  assert.throws(() => createRouter({}), /render/);
  assert.deepEqual(resolveRoute('#/nope'), { route: { name: 'search', id: null }, redirect: HASH.search });
});

// ---------------------------------------------------------------- the envelope

test('the envelope migrates forward, keeps unknown keys, and caps the history', () => {
  const data = migrate(undefined, { history: [' casa ', '', 3, 'via'], later: true });
  assert.deepEqual(data.history, ['casa', 'via']);
  assert.equal(data.later, true, 'a key this build does not know survives');
  const many = migrate(VERSION, { history: Array.from({ length: HISTORY_MAX + 10 }, (_, index) => 'q' + index) });
  assert.equal(many.history.length, HISTORY_MAX);
});

test('storage de-duplicates a query and refuses a blob it cannot read', () => {
  const backend = fakeBackend();
  const storage = createStorage(backend);
  storage.addQuery(' casa ');
  storage.addQuery('via');
  storage.addQuery('casa');
  assert.deepEqual(storage.history(), ['casa', 'via'], 'newest first, no duplicate');
  assert.deepEqual(JSON.parse(backend.raw()), { v: VERSION, data: { history: ['casa', 'via'] } });
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

test('the manifest parses into four file sets per bucket, with the hash of each file', () => {
  const manifest = parseManifest({
    version: 'v1-x',
    built: '2026-01-01',
    partial: false,
    sources: [{ name: 'kaikki', url: 'https://example.org', licence: 'CC BY-SA' }, 'nonsense'],
    totals: { entries: 2, forms: 3, examples: 4, bytes: 5 },
    buckets: {
      ca: {
        search: [{ path: 'data/ca.json', bytes: 10, hash: 'a1' }],
        entry: [{ path: 'data/entry/ca.json', bytes: 11, hash: 'b2' }],
        ex: [{ path: 'data/ex/ca.json', bytes: 12, hash: 'c3' }],
        forms: [{ path: 'data/forms/ca.json', bytes: 13, hash: 'd4' }],
      },
      broken: { search: [{ nope: true }] },
      empty: {},
    },
  });
  assert.equal(manifest?.version, 'v1-x');
  assert.equal(manifest?.partial, false);
  assert.deepEqual(manifest?.totals, { entries: 2, forms: 3, examples: 4, bytes: 5 });
  assert.deepEqual(manifest?.sources, [{ name: 'kaikki', url: 'https://example.org', licence: 'CC BY-SA' }]);
  assert.deepEqual(manifest?.buckets.ca.entry, [{ path: 'data/entry/ca.json', bytes: 11, hash: 'b2' }]);
  assert.equal(manifest?.buckets.broken, undefined);
  assert.equal(manifest?.buckets.empty, undefined);
  assert.equal(parseManifest([]), null);
  assert.equal(parseManifest({ buckets: {} }), null);
});

test('a data URL carries the file hash, and a bucket picks its split file by prefix', () => {
  assert.equal(shardUrl({ path: 'data/ca.json', bytes: 1, hash: 'abc' }), 'data/ca.json?v=abc');
  assert.equal(shardUrl({ path: 'data/ca.json', bytes: 1, hash: '' }), 'data/ca.json');

  const files = [
    { path: 'data/ca.json', bytes: 1, hash: '1' },
    { path: 'data/ca/cas.json', bytes: 1, hash: '2' },
    { path: 'data/ca/cat.json', bytes: 1, hash: '3' },
  ];
  assert.deepEqual(pickFiles(files, 'casa').map((file) => file.path), ['data/ca/cas.json']);
  assert.deepEqual(pickFiles(files, 'catone').map((file) => file.path), ['data/ca/cat.json']);
  assert.deepEqual(pickFiles(files, 'ca').map((file) => file.path), ['data/ca.json']);
  assert.deepEqual(pickFiles(files, 'cb'), files, 'a key shorter than every split prefix reads the bucket');
});

test('a row, an entry, the forms and the examples are read from the shapes the build writes', () => {
  assert.deepEqual(toRow(['casa', 'ca:0', 'casa', '/ˈkasa/', 'noun', 'edificio']), {
    folded: 'casa',
    id: 'ca:0',
    headword: 'casa',
    pronunciation: '/ˈkasa/',
    pos: 'noun',
    gloss: 'edificio',
  });
  assert.equal(toRow(['casa', '', 'casa']), null, 'a row without an id cannot be opened');

  const entry = toEntry({
    id: 'ca:0',
    word: 'casa',
    ipa: '/ˈkasa/',
    cefr: 'a1',
    pos: [{ pos: 'noun', senses: ['house', 'home'] }, { pos: 'adjective', senses: [] }],
    ex: [0, 2],
    conj: [{ key: 'indicativo presente', personal: true, forms: ['vado', null, 'va'] }, { key: 'gerundio', personal: false, forms: ['andando'] }],
  });
  assert.deepEqual(entry?.posList, [{ pos: 'noun', senses: ['house', 'home'] }], 'a pos group with no sense is dropped');
  assert.deepEqual(entry?.conj, [
    { key: 'indicativo presente', personal: true, forms: ['vado', '', 'va'] },
    { key: 'gerundio', personal: false, forms: ['andando'] },
  ]);
  assert.deepEqual(entry?.exampleIndexes, [0, 2], 'an entry body carries example positions, not sentences');
  assert.equal(toEntry({ id: 'ca:1' }), null, 'an entry without a word cannot be drawn');

  assert.deepEqual([...parseForms({ case: { id: 'ca:0', lemma: 'casa', label: 'plurale' } }).values()], [
    { id: 'ca:0', lemma: 'casa', label: 'plurale' },
  ]);
  assert.deepEqual(parseExamples([['e1', 'La casa è grande.'], ['e2', 'Vado a casa.']]), ['La casa è grande.', 'Vado a casa.']);
});

test('createData reads the manifest once, one hashed file per lookup, and an entry from its id', async () => {
  const { calls, fetch } = fileFetch({
    'data/index.json': {
      version: 'v1',
      buckets: {
        ca: {
          search: [{ path: 'data/ca.json', hash: 'h1' }],
          entry: [{ path: 'data/entry/ca.json', hash: 'h2' }],
          ex: [{ path: 'data/ex/ca.json', hash: 'h3' }],
          forms: [{ path: 'data/forms/ca.json', hash: 'h4' }],
        },
      },
    },
    'data/ca.json?v=h1': [['casa', 'ca:0', 'casa', '/ˈkasa/', 'noun', 'house'], ['cane', 'ca:1', 'cane', '', 'noun', 'dog'], 'junk'],
    'data/entry/ca.json?v=h2': [
      { id: 'ca:0', word: 'casa', ipa: '/ˈkasa/', cefr: 'a1', pos: [{ pos: 'noun', senses: ['house'] }], ex: [0], conj: [] },
      { id: 'ca:1', word: 'cane', cefr: 'a1', pos: [{ pos: 'noun', senses: ['dog'] }], ex: [], conj: [] },
    ],
    'data/ex/ca.json?v=h3': [['e1', 'La casa è grande.'], ['e2', 'Vado a casa.']],
    'data/forms/ca.json?v=h4': { case: { id: 'ca:0', lemma: 'casa', label: 'plurale' } },
  });
  const data = createData({ fetch, base: '' });

  assert.equal((await data.rows('casa')).length, 2, 'a junk row is dropped');
  assert.equal(calls.filter((url) => url === 'data/ca.json?v=h1').length, 1, 'the file URL carries its hash');
  assert.equal(calls.filter((url) => url === 'data/index.json').length, 1, 'the manifest is fetched once');

  const entry = await data.entry('ca:1');
  assert.equal(entry?.headword, 'cane', 'the id names its bucket and position');
  assert.equal(calls.filter((url) => url === 'data/entry/ca.json?v=h2').length, 1, 'one entry fetch, no search first');
  assert.deepEqual((await data.examples('ca')).slice(0, 1), ['La casa è grande.']);
  assert.equal((await data.forms('case')).get('case')?.id, 'ca:0');
  assert.equal(await data.entry('ca:99'), null, 'a position past the file is not an entry');
  assert.equal(await data.entry('nope'), null, 'an id without a bucket is not an entry');

  const before = calls.length;
  assert.deepEqual(await data.rows('zz'), [], 'a bucket the manifest does not list is empty');
  assert.equal(calls.length, before, 'and costs no request, so it cannot log a 404');
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
    rows.push(row(word, word, 'una glossa breve'));
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
