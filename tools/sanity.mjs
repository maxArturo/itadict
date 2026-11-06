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
  bucketFor,
  bucketKey,
  bucketOfId,
  attributions,
  createData,
  exampleBucket,
  parseExamples,
  parseForms,
  parseManifest,
  pickFiles,
  shardUrl,
  toDeckRow,
  toEntry,
  toRow,
} from '../js/data.js';
import { HASH, createRouter, entryHash, parseRoute, resolveRoute, sentenceHash } from '../js/router.js';
import { createSearch, editDistanceAtMost, englishIds, findMatch, fold, rank } from '../js/search.js';
import { createSpeech, RATE } from '../js/speech.js';
import { HISTORY_MAX, KEY, VERSION, createStorage, migrate } from '../js/storage.js';
import {
  EASE_MIN,
  EASE_START,
  INTERVALS,
  dueCount,
  dueIds,
  endOfToday,
  gradeCard,
  isDue,
  newCard,
  orderDeck,
  readCard,
} from '../js/study.js';
import { WORD_CAP, contexts, createReader, pickCandidate, readKey, summarise, tokenize } from '../js/text.js';
import { PALETTE, backFor, backTarget, formRows, translationRows } from '../js/ui.js';
import {
  LABELS,
  backupFile,
  counts,
  firstLine,
  hasWord,
  noteWord,
  labelFor,
  mergeList,
  packageList,
  parseBackup,
  parsePackage,
  readLists,
  relocate,
  uniqueName,
  wordDictionary,
} from '../js/lists.js';
import { ALPHABET, posIndex, posLabel } from '../js/reference.js';

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

/** A manifest bucket with one search file and one forms file. @param {string} key @param {string} hash */
function oneFileBucket(key, hash) {
  return {
    search: [{ path: `data/${key}.json`, hash }],
    forms: [{ path: `data/forms/${key}.json`, hash: hash + 'f' }],
    entry: [],
    ex: [],
  };
}

/** A fetch that serves nothing: every English read misses. */
const noEnglish = async () => ({ ok: false, status: 404, json: async () => null });

/** A fetch over the English files it is given, counting every call. @param {Record<string, unknown>} files */
function englishFetch(files) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (!(url in files)) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => files[url] };
  };
  return { calls, fetch };
}

/** One search row with its English gloss, shaped as js/data.js hands one out. */
const englishRow = (id, folded, headword, en) => ({
  folded,
  id,
  headword,
  pronunciation: '',
  pos: 'noun',
  gloss: 'definizione italiana',
  en,
});

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
  for (const name of ['app', 'data', 'lists', 'reference', 'router', 'search', 'speech', 'storage', 'study', 'text', 'ui']) {
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
function memoryData(rows, forms = new Map(), buckets = {}) {
  const asked = [];
  return {
    asked,
    manifest: async () => ({ buckets }),
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
  const search = createSearch({ data, storage, fetch: noEnglish });

  assert.deepEqual(await search.search(''), { rows: [], english: [], history: ['via', 'casa'] });
  const one = await search.search('c');
  assert.deepEqual(one.rows, []);
  assert.deepEqual(one.history, ['casa'], 'history is filtered by the one character');
  assert.deepEqual(data.asked, [], 'no bucket was fetched');
});

test('exact beats prefix, and an inflected form resolves to its lemma row', async () => {
  const rows = [row('casetta', 'casetta', 'little house'), row('casa', 'casa', 'house'), row('cassa', 'cassa', 'box')];
  const forms = new Map([['case', { id: 'casa', lemma: 'casa', label: 'plurale' }]]);
  const search = createSearch({ data: memoryData(rows, forms), storage: createStorage(fakeBackend()), fetch: noEnglish });

  const result = await search.search('case');
  assert.deepEqual(result.rows.map((entry) => entry.id), ['casetta', 'casa'], 'the lemma row follows the prefix rows');
  assert.equal(result.rows[1].matched, 'case', 'the secondary line shows the form that was typed');
  assert.equal(search.row('casa')?.headword, 'casa', 'a shown row is remembered for the entry screen');
});

test('an inflected form resolves to a lemma in another bucket, by its id', async () => {
  const rows = [row('andare', 'andare', 'to go')];
  const forms = new Map([['vado', { id: 'andare', lemma: 'andare', label: 'presente 1s' }]]);
  const search = createSearch({ data: memoryData(rows, forms), storage: createStorage(fakeBackend()), fetch: noEnglish });
  const result = await search.search('vado');
  assert.deepEqual(result.rows.map((entry) => entry.id), ['andare']);
  assert.equal(result.rows[0].gloss, 'to go');
  assert.equal(result.rows[0].matched, 'vado');
});

// ---------------------------------------------------------------- English lookup

test('the English index takes the exact token first, then prefixes of the same bucket', () => {
  const tokens = { house: ['ca:0', 'ca:1'], houseboat: ['ca:2'], housing: ['ca:3', 'ca:0'] };
  assert.deepEqual(
    englishIds(tokens, 'house', 3),
    ['ca:0', 'ca:1', 'ca:2'],
    'exact first, then alphabet order, and no duplicate',
  );
  assert.deepEqual(englishIds(tokens, 'hous', 2), ['ca:0', 'ca:1'], 'prefixes fill the cap');
  assert.deepEqual(englishIds({}, 'house'), [], 'no token, no ids');
  assert.deepEqual(englishIds({ house: ['ca:0', 4, null] }, 'house'), ['ca:0'], 'junk postings are dropped');
});

test('an English hit is the Italian headword with its English gloss, in its own list', async () => {
  const rows = [
    englishRow('ca:0', 'casa', 'casa', 'house'),
    englishRow('ca:1', 'caseggiato', 'caseggiato', 'housing block'),
  ];
  const { calls, fetch } = englishFetch({ 'data/en/ho.json?v=h1': { house: ['ca:0', 'ca:1'] } });
  const buckets = { ho: { en: [{ path: 'data/en/ho.json', hash: 'h1' }] } };
  const search = createSearch({ data: memoryData(rows, new Map(), buckets), storage: createStorage(fakeBackend()), fetch });
  const result = await search.search('house');
  assert.deepEqual(result.rows, [], 'no Italian headword matches');
  assert.deepEqual(result.english.map((entry) => entry.id), ['ca:0', 'ca:1']);
  assert.equal(result.english[0].headword, 'casa', 'the row title is the Italian headword');
  assert.equal(result.english[0].en, 'house', 'the secondary line is the English gloss');
  assert.equal(search.row('ca:0')?.en, 'house', 'the entry opens from the remembered row');
  assert.deepEqual(calls, ['data/en/ho.json?v=h1'], 'one English read, with the manifest hash');
});

test('Italian matches lead in their own list, and the English block follows separately', async () => {
  const rows = [englishRow('ho:0', 'hotel', 'hotel', 'hotel'), englishRow('ca:0', 'casa', 'casa', 'house')];
  const { fetch } = englishFetch({ 'data/en/ho.json?v=h1': { hotel: ['ca:0'] } });
  const buckets = { ho: { en: [{ path: 'data/en/ho.json', hash: 'h1' }] } };
  const search = createSearch({ data: memoryData(rows, new Map(), buckets), storage: createStorage(fakeBackend()), fetch });
  const result = await search.search('hotel');
  assert.deepEqual(result.rows.map((entry) => entry.id), ['ho:0'], 'the Italian row leads its list');
  assert.deepEqual(result.english.map((entry) => entry.id), ['ca:0'], 'the English row is separate');
  const italian = new Set(result.rows.map((entry) => entry.id));
  assert.equal(result.english.some((entry) => italian.has(entry.id)), false, 'the two lists do not share a row');
});

test('the English file is not read while the Italian list is full', async () => {
  const rows = Array.from({ length: 25 }, (_, index) =>
    englishRow('ca:' + index, 'casa' + index, 'casa' + index, 'house'),
  );
  const { calls, fetch } = englishFetch({ 'data/en/ca.json': { house: ['ca:0'] } });
  const search = createSearch({ data: memoryData(rows), storage: createStorage(fakeBackend()), fetch });
  const result = await search.search('casa');
  assert.equal(result.rows.length, 25);
  assert.deepEqual(result.english, [], 'a full Italian list stops the English read');
  assert.deepEqual(calls, [], 'no English file was fetched');
});

test('a query with no match in either list returns two empty lists', async () => {
  const search = createSearch({ data: memoryData([]), storage: createStorage(fakeBackend()), fetch: noEnglish });
  assert.deepEqual(await search.search('zzzz'), { rows: [], english: [], history: [] });
});

test('a bucket with no English set in the manifest fetches nothing and shows no block', async () => {
  const rows = [englishRow('ca:0', 'casa', 'casa', 'house')];
  const { calls, fetch } = englishFetch({ 'data/en/ho.json': { house: ['ca:0'] } });
  const search = createSearch({ data: memoryData(rows), storage: createStorage(fakeBackend()), fetch });
  const result = await search.search('house');
  assert.deepEqual(result.english, [], 'no English set means no English block');
  assert.deepEqual(calls, [], 'and no fetch');
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

// ---------------------------------------------------------------- the entry translation

test('English glosses keep their part of speech, and no English data yields no section', () => {
  assert.deepEqual(
    translationRows([
      { pos: 'noun', glosses: ['house', 'home'] },
      { pos: 'verb', glosses: ['to house'] },
    ]),
    [
      { pos: 'noun', gloss: 'house' },
      { pos: '', gloss: 'home' },
      { pos: 'verb', gloss: 'to house' },
    ],
    'each gloss stays in its own group',
  );
  assert.deepEqual(
    translationRows([{ pos: 'noun', glosses: ['house'] }]),
    [{ pos: '', gloss: 'house' }],
    'one group draws no label',
  );
  assert.deepEqual(translationRows([]), [], 'no English data, no rows, so the section stays hidden');
  assert.deepEqual(
    toEntry({
      id: 'ca:0',
      word: 'casa',
      en: [{ pos: 'noun', glosses: [' house ', ''] }, { pos: 'verb', glosses: [] }, 'junk'],
    })?.en,
    [{ pos: 'noun', glosses: ['house'] }],
    'empty groups and junk are dropped',
  );
  const v1 = toEntry({
    id: 'ca:1',
    word: 'cane',
    ipa: '/ˈkane/',
    cefr: 'a1',
    pos: [{ pos: 'noun', senses: ['dog'] }],
    ex: [0],
    conj: [],
  });
  assert.deepEqual(v1?.en, [], 'a v1.0 body with no "en" key reads as an empty list');
});

// ---------------------------------------------------------------- the text reader

test('the tokeniser keeps an apostrophe inside a word and drops numbers and punctuation', () => {
  const input = "L'acqua è fredda. Ho 3 gatti; l’altra no!";
  const { segments, truncated } = tokenize(input);
  assert.deepEqual(
    segments.filter((segment) => segment.word).map((segment) => segment.text),
    ["L'acqua", 'è', 'fredda', 'Ho', 'gatti', 'l’altra', 'no'],
  );
  assert.equal(segments.map((segment) => segment.text).join(''), input, 'the segments join back to the input');
  assert.equal(truncated, false);
  assert.deepEqual(tokenize('').segments, []);
  assert.equal(tokenize('123 — !? …').segments.some((segment) => segment.word), false, 'punctuation is not a word');
  assert.deepEqual(
    tokenize("l'").segments.filter((segment) => segment.word).map((segment) => segment.text),
    ['l'],
    'a trailing apostrophe is not part of a word',
  );
});

test('the tokeniser stops at the word cap and leaves the rest plain', () => {
  const cut = tokenize('casa '.repeat(WORD_CAP + 10));
  assert.equal(cut.segments.filter((segment) => segment.word).length, WORD_CAP);
  assert.equal(cut.truncated, true);
  assert.equal(cut.segments[cut.segments.length - 1].word, false, 'everything past the cap is one plain run');
  assert.equal(tokenize('casa').truncated, false);
  assert.equal(tokenize('casa '.repeat(WORD_CAP).trimEnd()).truncated, false, 'a text that ends at the cap is not cut');
});

test('the summary counts every word but lists each unknown word once, most frequent first', () => {
  const { segments } = tokenize('casa via via xyz xyz xyz abc abc');
  const resolved = new Map([
    ['casa', { id: 'ca:0', headword: 'casa' }],
    ['via', { id: 'vi:0', headword: 'via' }],
  ]);
  assert.deepEqual(summarise(segments, resolved), {
    total: 8,
    known: 2,
    unknown: [
      { word: 'xyz', count: 3 },
      { word: 'abc', count: 2 },
    ],
  });
});

test('the reader resolves a headword and a form, and reads an unknown word as null', async () => {
  const { calls, fetch } = fileFetch({
    'data/index.json': { version: 'v1', buckets: { ca: oneFileBucket('ca', 'h1'), ig: oneFileBucket('ig', 'h2') } },
    'data/ca.json?v=h1': [['casa', 'ca:0', 'casa', '', '', '']],
    'data/forms/ca.json?v=h1f': { case: { id: 'ca:0', lemma: 'casa', label: 'plurale' } },
    'data/ig.json?v=h2': [],
    'data/forms/ig.json?v=h2f': {},
  });
  const reader = createReader({ data: createData({ fetch, base: '' }) });
  const { segments } = tokenize('Casa case ignoto casa');
  const resolved = await reader.read(segments);
  assert.equal(resolved.get('casa')?.id, 'ca:0');
  assert.equal(resolved.get('case')?.headword, 'casa', 'a form opens its lemma');
  assert.equal(resolved.get('ignoto'), null);
  assert.equal(calls.filter((url) => url === 'data/ca.json?v=h1').length, 1, 'one read per file, not per word');
});

test('the reader resolves a word from a split bucket, not only its base file', async () => {
  const { fetch } = fileFetch({
    'data/index.json': {
      version: 'v1',
      buckets: {
        co: {
          search: [
            { path: 'data/co.json', hash: 's1' },
            { path: 'data/co/com.json', hash: 's2' },
          ],
          forms: [
            { path: 'data/forms/co.json', hash: 'f1' },
            { path: 'data/forms/co/com.json', hash: 'f2' },
          ],
          entry: [],
          ex: [],
        },
      },
    },
    'data/co.json?v=s1': [['cosa', 'co:0', 'cosa', '', '', '']],
    'data/co/com.json?v=s2': [['comunque', 'co:1', 'comunque', '', '', '']],
    'data/forms/co.json?v=f1': {},
    'data/forms/co/com.json?v=f2': { compri: { id: 'co:0', lemma: 'comprare', label: 'presente 2s' } },
  });
  const reader = createReader({ data: createData({ fetch, base: '' }) });
  const resolved = await reader.read(tokenize('cosa comunque compri').segments);
  assert.equal(resolved.get('cosa')?.id, 'co:0');
  assert.equal(resolved.get('comunque')?.id, 'co:1', 'the longest file prefix wins');
  assert.equal(resolved.get('compri')?.headword, 'comprare', 'the forms split with the bucket');
});

test('an elided word resolves through its parts, and each token counts once', async () => {
  const { fetch } = fileFetch({
    'data/index.json': {
      version: 'v1',
      buckets: {
        ac: oneFileBucket('ac', 'a1'),
        al: oneFileBucket('al', 'a2'),
        un: oneFileBucket('un', 'a3'),
        po: oneFileBucket('po', 'a4'),
      },
    },
    'data/ac.json?v=a1': [['acqua', 'ac:0', 'acqua', '', '', '']],
    'data/forms/ac.json?v=a1f': {},
    'data/al.json?v=a2': [['altra', 'al:0', 'altra', '', '', '']],
    'data/forms/al.json?v=a2f': {},
    'data/un.json?v=a3': [['un', 'un:0', 'un', '', '', '']],
    'data/forms/un.json?v=a3f': {},
    'data/po.json?v=a4': [['po', 'po:0', 'po', '', '', '']],
    'data/forms/po.json?v=a4f': {},
  });
  const reader = createReader({ data: createData({ fetch, base: '' }) });
  const { segments } = tokenize("L'acqua l'acqua un'acqua un'idea po'");
  const resolved = await reader.read(segments);
  assert.equal(resolved.get("l'acqua")?.id, 'ac:0', 'the part after the apostrophe resolves');
  assert.equal(resolved.get("un'acqua")?.id, 'ac:0', 'the part after comes before the part before');
  assert.equal(resolved.get("un'idea")?.id, 'un:0', 'the part before, when it is a word');
  assert.equal(resolved.get('po')?.id, 'po:0', 'a trailing apostrophe stays outside the word');
  assert.deepEqual(summarise(segments, resolved), { total: 5, known: 4, unknown: [] }, 'each token counts once');
});

test('reader.word resolves one tapped word, an elision through its part, and a miss to null', async () => {
  const { calls, fetch } = fileFetch({
    'data/index.json': {
      version: 'v1',
      buckets: { ac: oneFileBucket('ac', 'w1'), ca: oneFileBucket('ca', 'w2'), ig: oneFileBucket('ig', 'w3'), br: oneFileBucket('br', 'w4') },
    },
    'data/ac.json?v=w1': [['acqua', 'ac:0', 'acqua', '', '', '']],
    'data/forms/ac.json?v=w1f': {},
    'data/ca.json?v=w2': [['casa', 'ca:0', 'casa', '', '', '']],
    'data/forms/ca.json?v=w2f': { case: { id: 'ca:0', lemma: 'casa', label: 'plurale' } },
    'data/ig.json?v=w3': [],
    'data/forms/ig.json?v=w3f': {},
    // br: the manifest lists it, but its files answer 404.
  });
  const reader = createReader({ data: createData({ fetch, base: '' }) });
  assert.equal((await reader.word("l'acqua"))?.id, 'ac:0', 'an elision resolves through the part after the apostrophe');
  assert.equal((await reader.word('Case'))?.headword, 'casa', 'a form opens its lemma, case-folded');
  assert.equal(await reader.word('ignoto'), null, 'an unknown word');
  assert.equal(await reader.word('brutto'), null, 'a file that did not load reads as null');
  assert.equal(await reader.word(''), null);
  await reader.read(tokenize('casa casa').segments);
  assert.equal(calls.filter((url) => url === 'data/ca.json?v=w2').length, 1, 'word() and read() share one memo');
});

test('a tapped inflected form still opens its lemma: devo -> dovere, possono -> potere', async () => {
  const { fetch } = fileFetch({
    'data/index.json': {
      version: 'v1',
      buckets: { de: oneFileBucket('de', 'd1'), po: oneFileBucket('po', 'd2'), do: oneFileBucket('do', 'd3') },
    },
    'data/de.json?v=d1': [],
    'data/forms/de.json?v=d1f': { devo: { id: 'do:0', lemma: 'dovere', label: 'presente 1s' } },
    'data/po.json?v=d2': [['potere', 'po:0', 'potere', '', 'verb', 'can']],
    'data/forms/po.json?v=d2f': { possono: { id: 'po:0', lemma: 'potere', label: 'presente 3p' } },
    'data/do.json?v=d3': [['dovere', 'do:0', 'dovere', '', 'verb', 'must']],
    'data/forms/do.json?v=d3f': {},
  });
  const reader = createReader({ data: createData({ fetch, base: '' }) });
  assert.deepEqual(await reader.word('devo'), { id: 'do:0', headword: 'dovere' }, 'the forms index answers when no headword matches');
  assert.deepEqual(await reader.word('Possono'), { id: 'po:0', headword: 'potere' });
});

// ---------------------------------------------------------------- which entry a tapped word opens

/** @param {string} id @param {string} headword @param {string} pos */
const cand = (id, headword, pos) => ({ id, headword, pos });
const MID = { capitalised: false, initial: false };
const MID_CAP = { capitalised: true, initial: false };
const START = { capitalised: true, initial: true };

test('pickCandidate: the advocate cases, by the capitalisation gate, frequency and the tie-break', () => {
  // Frequency: within one entry file, the earlier position is the more frequent entry. No rank ships.
  assert.equal(pickCandidate([cand('co:45', 'raro', ''), cand('co:0', 'comune', '')], MID)?.headword, 'comune', 'the earlier position in one file wins');
  assert.equal(pickCandidate([cand('co:79', 'rarissimo', 'noun'), cand('co:0', 'comune', '')], MID)?.headword, 'comune', 'whatever the order found');
  assert.equal(pickCandidate([cand('ra:0', 'raro', ''), cand('co:0', 'comune', '')], MID)?.headword, 'raro', 'two files are not compared: the first found');
  assert.equal(pickCandidate([cand('fa:5', 'faccia', 'noun'), cand('fa:0', 'fare', '')], START)?.headword, 'fare', 'Faccia at sentence start -> fare: same file, the earlier position is more frequent');
  // The gate: a lowercase or sentence-initial token never takes a name while a word matches.
  assert.equal(pickCandidate([cand('su:1', 'SUA', 'abbrev'), cand('su:0', 'suo', '')], MID)?.headword, 'suo', 'sua -> suo, not SUA');
  assert.equal(pickCandidate([cand('pes:4', 'Pesci', 'name'), cand('pes:0', 'pesce', '')], MID)?.headword, 'pesce', 'pesci -> the fish, not Pisces');
  assert.equal(pickCandidate([cand('ne:1', 'Nella', 'name'), cand('in:0', 'in', '')], MID)?.headword, 'in', 'nella lowercase -> the preposition');
  assert.equal(pickCandidate([cand('ne:1', 'Nella', 'name'), cand('in:0', 'in', '')], MID_CAP)?.headword, 'Nella', 'Nella mid-sentence -> the name');
  assert.equal(pickCandidate([cand('i:0', 'I', 'symbol'), cand('il:0', 'il', '')], START)?.headword, 'il', 'I at sentence start -> the article');
  assert.equal(pickCandidate([cand('i:0', 'I', 'symbol'), cand('il:0', 'il', '')], MID_CAP)?.headword, 'I', 'I mid-sentence, capitalised -> the symbol');
  assert.equal(pickCandidate([cand('ro:0', 'Roma', 'name')], MID), null, 'a lowercase token never takes a name, even alone');
  assert.equal(pickCandidate([cand('ro:0', 'Roma', 'name')], START), null, 'nor does a sentence-initial one');
  assert.equal(pickCandidate([cand('ro:0', 'Roma', 'name')], MID_CAP)?.headword, 'Roma', 'a mid-sentence capital does');
  // The tie-break: no rank and two files, so a word beats a name, then the first found wins.
  assert.equal(pickCandidate([cand('xa:3', 'Xa', 'name'), cand('xb:1', 'xa', 'noun')], START)?.headword, 'xa');
  assert.equal(pickCandidate([cand('xa:3', 'alpha', 'noun'), cand('xb:1', 'beta', 'noun')], MID)?.headword, 'alpha', 'no information: the first found');
  assert.equal(pickCandidate([], MID), null);
});

test('contexts marks capitals and the first word of each sentence', () => {
  const { segments } = tokenize('I miei capelli. Nella casa è Nella! e poi… Sì');
  const words = segments.map((segment, index) => ({ segment, context: contexts(segments)[index] })).filter((entry) => entry.segment.word);
  assert.deepEqual(
    words.map((entry) => entry.segment.text + ':' + (entry.context.capitalised ? 'C' : 'c') + (entry.context.initial ? 'I' : 'm')),
    ['I:CI', 'miei:cm', 'capelli:cm', 'Nella:CI', 'casa:cm', 'è:cm', 'Nella:Cm', 'e:cI', 'poi:cm', 'Sì:CI'],
  );
});

test('reader.word ranks every candidate of a tapped word, single letters included', async () => {
  const { fetch } = fileFetch({
    'data/index.json': {
      version: 'v1',
      buckets: { a: oneFileBucket('a', 'q1'), i: oneFileBucket('i', 'q2'), pe: oneFileBucket('pe', 'q3'), ne: oneFileBucket('ne', 'q4') },
    },
    'data/a.json?v=q1': [['a', 'a:0', 'a', '', 'prep', 'to']],
    'data/forms/a.json?v=q1f': {},
    'data/i.json?v=q2': [['i', 'i:0', 'I', '', 'symbol', 'iodine']],
    'data/forms/i.json?v=q2f': { i: { id: 'il:0', lemma: 'il', label: 'plurale' } },
    'data/pe.json?v=q3': [['pesci', 'pe:4', 'Pesci', '', 'name', 'Pisces'], ['pesce', 'pe:0', 'pesce', '', 'noun', 'fish']],
    'data/forms/pe.json?v=q3f': { pesci: { id: 'pe:0', lemma: 'pesce', label: 'plurale' } },
    'data/ne.json?v=q4': [['nella', 'ne:1', 'Nella', '', 'name', 'Nella']],
    'data/forms/ne.json?v=q4f': {},
  });
  const reader = createReader({ data: createData({ fetch, base: '' }) });
  assert.equal((await reader.word('a'))?.headword, 'a', 'a single letter resolves like any word');
  assert.equal((await reader.word('I', START))?.headword, 'il', 'sentence-initial I is the article');
  assert.equal((await reader.word('I', MID_CAP))?.headword, 'I', 'a mid-sentence capital I is the symbol');
  assert.equal((await reader.word('pesci'))?.headword, 'pesce', 'pesci is the fish');
  assert.equal((await reader.word('Nella', MID_CAP))?.headword, 'Nella', 'a mid-sentence capital picks the name');
  assert.equal(await reader.word('nella'), null, 'lowercase nella never opens the name: a miss, so the page searches "nella"');
});

test('a token with an accent takes the forms record written that way: è is essere, e the conjunction', async () => {
  const { fetch } = fileFetch({
    'data/index.json': {
      version: 'v1',
      buckets: {
        a: oneFileBucket('a', 'r1'),
        e: oneFileBucket('e', 'r2'),
        i: oneFileBucket('i', 'r3'),
        o: oneFileBucket('o', 'r4'),
        pe: oneFileBucket('pe', 'r5'),
      },
    },
    'data/a.json?v=r1': [['a', 'a:0', 'a', '', 'prep', 'to']],
    'data/forms/a.json?v=r1f': {},
    'data/e.json?v=r2': [['e', 'e:0', 'e', '', 'conj', 'and']],
    'data/forms/e.json?v=r2f': { e: { id: 'es:0', lemma: 'essere', label: '3s presente', form: 'è' } },
    'data/i.json?v=r3': [['i', 'i:0', 'i', '', 'article', 'the']],
    'data/forms/i.json?v=r3f': {},
    'data/o.json?v=r4': [['o', 'o:0', 'o', '', 'conj', 'or']],
    'data/forms/o.json?v=r4f': {},
    'data/pe.json?v=r5': [['perche', 'pe:0', 'perché', '', 'conj', 'because']],
    'data/forms/pe.json?v=r5f': {},
  });
  const reader = createReader({ data: createData({ fetch, base: '' }) });
  assert.equal((await reader.word('è'))?.headword, 'essere', 'è: the accented form record wins over the folded headword');
  assert.equal((await reader.word('È', START))?.headword, 'essere', 'È at sentence start: case does not matter');
  assert.equal((await reader.word('e'))?.headword, 'e', 'e: no accent, the conjunction');
  assert.equal((await reader.word('a'))?.id, 'a:0', 'a keeps its headword');
  assert.equal((await reader.word('i'))?.headword, 'i', 'i keeps its headword');
  assert.equal((await reader.word('o'))?.headword, 'o', 'o keeps its headword');
  assert.equal((await reader.word('perché'))?.headword, 'perché', 'perché: no form written that way, so the headword');
  assert.equal((await reader.word('perche'))?.headword, 'perché', 'perche: the same headword through the fold');
});

test('bucketFor pads a one-character key for every set but English, and the padded bucket wins', () => {
  const set = (/** @type {string} */ name) => ({ search: [{ path: 'data/' + name + '.json', hash: 'h' }], entry: [], ex: [], forms: [], en: [] });
  const english = (/** @type {string} */ name) => ({ search: [], entry: [], ex: [], forms: [], en: [{ path: 'data/en/' + name + '.json', hash: 'h' }] });
  const manifest = /** @type {any} */ ({
    buckets: { e: english('e'), e_: set('e_'), a_: set('a_'), 2: english('2'), '2_': set('2_'), __: set('__'), _: english('_'), ca: set('ca'), o: set('o') },
  });
  const name = (/** @type {any} */ bucket) => bucket?.search[0]?.path ?? bucket?.en[0]?.path ?? 'none';
  assert.equal(name(bucketFor(manifest, 'e', 'search')), 'data/e_.json', 'a letter: the padded bucket wins over the bare English one');
  assert.equal(name(bucketFor(manifest, 'è', 'forms')), 'data/e_.json', 'an accented letter folds, then pads');
  assert.equal(name(bucketFor(manifest, 'à', 'entry')), 'data/a_.json');
  assert.equal(name(bucketFor(manifest, '2', 'search')), 'data/2_.json', 'a digit pads too');
  assert.equal(name(bucketFor(manifest, '-', 'search')), 'data/__.json', 'a bare symbol is the "__" bucket');
  assert.equal(name(bucketFor(manifest, 'e', 'en')), 'data/en/e.json', 'English keeps the bare letter');
  assert.equal(name(bucketFor(manifest, '-', 'en')), 'data/en/_.json', 'and "_" for symbols');
  assert.equal(bucketFor(manifest, 'casa', 'en'), manifest.buckets.ca, 'a two-letter English lookup is unchanged: bucketKey("casa")');
  assert.equal(name(bucketFor(manifest, 'casa', 'search')), 'data/ca.json');
  assert.equal(name(bucketFor(manifest, 'cas', 'entry')), 'data/ca.json', 'a split file key names its bucket');
  assert.equal(name(bucketFor(manifest, 'e_', 'ex')), 'data/e_.json', 'a padded key from an id stays padded');
  assert.equal(name(bucketFor(manifest, 'o', 'search')), 'data/o.json', 'with no padded bucket, the bare one');
  assert.equal(bucketFor(manifest, 'xz', 'search'), undefined);
});

test('one-letter words resolve through their padded buckets: e, è, a, à, i, o, ò', async () => {
  const one = (/** @type {string} */ key, /** @type {string} */ hash) => ({
    search: [{ path: 'data/' + key + '.json', hash }],
    forms: [{ path: 'data/forms/' + key + '.json', hash: hash + 'f' }],
    entry: [],
    ex: [],
    en: [],
  });
  const { fetch } = fileFetch({
    'data/index.json': {
      version: 'v1',
      buckets: {
        e: { search: [], entry: [], ex: [], forms: [], en: [{ path: 'data/en/e.json', hash: 'x' }] },
        e_: one('e_', 's1'),
        a_: one('a_', 's2'),
        i_: one('i_', 's3'),
        o_: one('o_', 's4'),
      },
    },
    'data/e_.json?v=s1': [['e', 'e_:0', 'e', '', 'conj', 'and']],
    'data/forms/e_.json?v=s1f': { e: { id: 'es:0', lemma: 'essere', label: '3s presente', form: 'è' } },
    'data/a_.json?v=s2': [['a', 'a_:0', 'a', '', 'prep', 'to'], ['a', 'a_:1', 'à', '', 'verb', 'obsolete ha']],
    'data/forms/a_.json?v=s2f': {},
    'data/i_.json?v=s3': [['i', 'i_:0', 'i', '', 'article', 'the']],
    'data/forms/i_.json?v=s3f': {},
    'data/o_.json?v=s4': [['o', 'o_:0', 'o', '', 'conj', 'or'], ['o', 'o_:1', 'ò', '', 'intj', 'oh']],
    'data/forms/o_.json?v=s4f': {},
  });
  const data = createData({ fetch, base: '' });
  assert.deepEqual((await data.rows('e')).map((entry) => entry.id), ['e_:0'], 'data.rows("e") reads the padded bucket');
  const reader = createReader({ data });
  assert.equal((await reader.word('e'))?.id, 'e_:0', 'e: the conjunction');
  assert.equal((await reader.word('è'))?.headword, 'essere', 'è: essere, by the written form');
  assert.equal((await reader.word('a'))?.id, 'a_:0', 'a: the preposition');
  assert.equal((await reader.word('à'))?.id, 'a_:1', 'à: the headword written that way');
  assert.equal((await reader.word('i'))?.id, 'i_:0');
  assert.equal((await reader.word('o'))?.id, 'o_:0');
  assert.equal((await reader.word('ò'))?.id, 'o_:1', 'ò: the headword written that way');
});

test('the written-form preference is NFC and shared: dà, a decomposed è, the Text reader, and rasò', async () => {
  const { fetch } = fileFetch({
    'data/index.json': {
      version: 'v1',
      buckets: { e_: oneFileBucket('e_', 't1'), da: oneFileBucket('da', 't2'), ra: oneFileBucket('ra', 't3') },
    },
    'data/e_.json?v=t1': [['e', 'e_:0', 'e', '', 'conj', 'and']],
    'data/forms/e_.json?v=t1f': { e: { id: 'es:0', lemma: 'essere', label: '3s presente', form: 'è' } },
    'data/da.json?v=t2': [['da', 'da:0', 'da', '', 'prep', 'from'], ['dare', 'da:1', 'dare', '', 'verb', 'to give']],
    'data/forms/da.json?v=t2f': { da: { id: 'da:1', lemma: 'dare', label: '3s presente', form: 'dà' } },
    'data/ra.json?v=t3': [['raso', 'ra:0', 'raso', '', 'noun', 'satin']],
    'data/forms/ra.json?v=t3f': {},
  });
  const reader = createReader({ data: createData({ fetch, base: '' }) });
  assert.equal((await reader.word('dà'))?.headword, 'dare', 'dà: the written form wins over the preposition');
  assert.equal((await reader.word('da'))?.headword, 'da', 'da: the preposition');
  assert.equal((await reader.word('e\u0300'))?.headword, 'essere', 'a decomposed è is NFC before it is compared');
  // KNOWN GAP: one forms record per folded key. "raso" has no record written "rasò", so rasò
  // opens the headword raso, not rasare. A record per written form would close it.
  assert.equal((await reader.word('rasò'))?.headword, 'raso', 'known gap: rasò opens raso, not rasare');

  const { segments } = tokenize('È vero, e da qui dà luce.');
  const resolved = await reader.read(segments);
  assert.equal(resolved.get('è')?.headword, 'essere', 'the Text reader shares the lookup: È is essere');
  assert.equal(resolved.get('e')?.headword, 'e', 'and e stays the conjunction in the same text');
  assert.equal(resolved.get('dà')?.headword, 'dare');
  assert.deepEqual(summarise(segments, resolved).unknown.map((entry) => entry.word), ['luce', 'qui', 'vero'], 'è and e are counted as two words');
});

test('the Text reader takes each word in place: Roma mid-sentence links, lowercase nella does not', async () => {
  const { fetch } = fileFetch({
    'data/index.json': { version: 'v1', buckets: { ro: oneFileBucket('ro', 'u1'), ne: oneFileBucket('ne', 'u2'), vi: oneFileBucket('vi', 'u3') } },
    'data/ro.json?v=u1': [['roma', 'ro:0', 'Roma', '', 'name', 'Rome']],
    'data/forms/ro.json?v=u1f': {},
    'data/ne.json?v=u2': [['nella', 'ne:1', 'Nella', '', 'name', 'Nella']],
    'data/forms/ne.json?v=u2f': {},
    'data/vi.json?v=u3': [['vivo', 'vi:0', 'vivo', '', 'adj', 'alive']],
    'data/forms/vi.json?v=u3f': {},
  });
  const reader = createReader({ data: createData({ fetch, base: '' }) });
  const { segments } = tokenize('Vivo a Roma, e nella casa. Roma.');
  const resolved = await reader.read(segments);
  const places = contexts(segments);
  const at = (/** @type {string} */ word, nth = 0) => {
    const index = segments.map((segment, i) => (segment.text === word ? i : -1)).filter((i) => i >= 0)[nth];
    return resolved.get(readKey(segments[index].text, places[index])) ?? null;
  };
  assert.equal(at('Roma')?.headword, 'Roma', 'Roma mid-sentence links to the name, as on a sentence page');
  assert.equal(at('nella'), null, 'lowercase nella mid-sentence does not link to Nella');
  assert.equal(at('Roma', 1), null, 'Roma first in its sentence is not a name reading');
  assert.equal(summarise(segments, resolved).known, 2, 'vivo and Roma are known; the second Roma counts once');
});

test('a sentence miss searches the token as a whole word, one letter included', async () => {
  const storage = createStorage(fakeBackend());
  storage.addQuery('esempio');
  const rows = [row('e', 'e', 'and'), row('ecco', 'ecco', 'here is')];
  const search = createSearch({ data: memoryData(rows), storage, fetch: noEnglish });
  assert.deepEqual((await search.search('è')).rows, [], 'a typed letter still reads history');
  assert.deepEqual((await search.search('è', { whole: true })).rows.map((entry) => entry.headword), ['e'], 'whole: the exact word only');
  assert.deepEqual((await search.search('è', { whole: true })).history, []);
});

test('the palette is the Italian alphabet plus the accented vowels, grouped by sound', () => {
  assert.deepEqual(PALETTE.map((family) => family.sound), ['A', 'E', 'I', 'O', 'U', '']);
  const letters = PALETTE.flatMap((family) => family.letters);
  assert.equal(letters.length, 27, '21 letters plus 6 accented vowels');
  assert.equal(new Set(letters).size, letters.length, 'no letter appears twice');
  for (const letter of ['à', 'è', 'é', 'ì', 'ò', 'ù']) assert.ok(letters.includes(letter), letter);
  for (const letter of ['j', 'k', 'w', 'x', 'y']) assert.ok(!letters.includes(letter), letter + ' is not in the Italian alphabet');
  for (const family of PALETTE) {
    for (const letter of family.letters) {
      assert.equal(letter, letter.toLowerCase());
      if (family.sound !== '') assert.equal(fold(letter), family.sound.toLowerCase(), letter + ' belongs to ' + family.sound);
    }
  }
});

// ---------------------------------------------------------------- the back control

test('the entry back control returns to the screen the app came from, and Search on a cold link', () => {
  assert.deepEqual(backTarget(''), { label: 'Search', history: false });
  assert.deepEqual(backTarget('entry'), { label: 'Search', history: false });
  assert.deepEqual(backTarget('text'), { label: 'Text', history: true });
  assert.deepEqual(backTarget('search'), { label: 'Search', history: true });
  assert.deepEqual(backTarget('settings'), { label: 'Settings', history: true });
});

test('back controls come from a one-shot flag, never from the route drawn before', () => {
  assert.deepEqual(backFor('entry', 'sentence', 'search'), { label: 'Sentence', history: true }, 'a word tap steps back to its sentence');
  assert.deepEqual(backFor('sentence', 'entry', ''), { label: 'Entry', history: true }, 'an example row steps back to its entry');
  assert.deepEqual(backFor('sentence', '', 'search'), { label: 'Search', history: false }, 'no flag: a link to Search, never history.back()');
  assert.deepEqual(backFor('sentence', '', ''), { label: 'Search', history: false }, 'a cold sentence link');
  assert.deepEqual(backFor('sentence', 'sentence', 'lists'), { label: 'Search', history: false }, 'a stale flag of the other kind does nothing');
  // Back from a sentence lands on entry A with no flag: it is the entry's own back, not Sentence.
  assert.deepEqual(backFor('entry', '', 'search'), { label: 'Search', history: true });
  assert.deepEqual(backFor('entry', '', ''), { label: 'Search', history: false }, 'a cold-linked entry never leaves the app');
  assert.deepEqual(backFor('entry', 'entry', 'lists'), { label: 'Lists', history: true });
});

// ---------------------------------------------------------------- lists, notes and files

test('a list file is validated before anything is written', () => {
  const file = {
    app: 'itadict',
    kind: 'list',
    v: 1,
    name: '  Italian  ',
    label: 'Verbs',
    items: [{ id: 'ca:0', word: 'casa' }, { id: 'ca:0', word: 'casa' }, { id: 'vi:1', word: 'via' }, { id: '', word: 'x' }, 'junk'],
  };
  assert.deepEqual(parsePackage(file), {
    name: 'Italian',
    label: 'Verbs',
    items: [{ id: 'ca:0', word: 'casa' }, { id: 'vi:1', word: 'via' }],
  });
  assert.equal(parsePackage({ ...file, v: 2 }), null, 'a newer file is not read');
  assert.equal(parsePackage({ ...file, kind: 'backup' }), null);
  assert.equal(parsePackage({ ...file, items: 'junk' }), null);
  assert.equal(parsePackage(null), null);
  assert.equal(parsePackage({ ...file, label: 'Nope' })?.label, 'Other');
  assert.equal(LABELS.length, 6);
  assert.equal(labelFor('Exam'), 'Exam');
  assert.equal(uniqueName('Italian', ['Italian']), 'Italian (2)');
  assert.equal(uniqueName('Italian', ['Italian', 'Italian (2)']), 'Italian (3)');
  assert.equal(uniqueName('Italian', []), 'Italian');
  assert.deepEqual(packageList({ id: 'l-1', name: 'Italian', label: 'Verbs', folder: '', items: [{ id: 'ca:0', word: 'casa' }] }), {
    app: 'itadict',
    kind: 'list',
    v: 1,
    name: 'Italian',
    label: 'Verbs',
    items: [{ id: 'ca:0', word: 'casa' }],
  });
});

test('importing a list never overwrites a name and reports added items', () => {
  const lists = readLists([{ id: 'l-1', name: 'Italian', label: 'Verbs', folder: '', items: [{ id: 'ca:0', word: 'casa' }] }]);
  const parsed = parsePackage({
    app: 'itadict',
    kind: 'list',
    v: 1,
    name: 'Italian',
    label: 'Verbs',
    items: [{ id: 'ca:0', word: 'casa' }, { id: 'vi:1', word: 'via' }],
  });
  assert.ok(parsed !== null);
  const merged = mergeList(lists, parsed);
  assert.equal(merged.list.name, 'Italian (2)', 'an existing list is never overwritten');
  assert.equal(merged.added, 1, 'only via is new to the collection');
  assert.equal(merged.present, 1, 'casa is already there');
  assert.equal(merged.lists.length, 2);
  assert.deepEqual(merged.lists[0].items.map((item) => item.id), ['ca:0'], 'the existing list keeps exactly its items');
});

test('a backup file carries the whole data and is validated', () => {
  const file = backupFile({ history: ['casa'], lists: [] }, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(file, {
    app: 'itadict',
    kind: 'backup',
    v: 1,
    exported: '2026-01-01T00:00:00.000Z',
    data: { history: ['casa'], lists: [] },
  });
  assert.deepEqual(parseBackup(JSON.parse(JSON.stringify(file))), { data: { history: ['casa'], lists: [] } });
  assert.equal(parseBackup({ ...file, data: null }), null);
  assert.equal(parseBackup({ ...file, kind: 'list' }), null);
  assert.deepEqual(
    counts({
      history: ['a', 'b'],
      opened: [],
      schedule: { a: {} },
      notes: { n: { text: 'x', at: 1 } },
      lists: [{ id: 'l', name: 'A', label: 'Other', folder: '', items: [{ id: 'x', word: 'x' }] }],
      folders: [],
    }),
    { lists: 1, folders: 0, items: 1, notes: 1, cards: 1, history: 2 },
  );
  assert.equal(firstLine('  first line \n second '), 'first line');
  assert.equal(firstLine(''), '');
});

test('lists, folders and items are stored, never duplicated, and survive a reload', () => {
  const backend = fakeBackend();
  const clock = () => 1000;
  const storage = createStorage(backend, clock);
  const list = storage.addList('Italian', 'Verbs');
  assert.equal(storage.addList('Italian', 'Nouns').name, 'Italian (2)', 'a name already taken gets a suffix');
  const folder = storage.addFolder('Class');
  assert.equal(storage.addItem(list.id, { id: 'ca:0', word: 'casa' }), 'added');
  assert.equal(storage.addItem(list.id, { id: 'ca:0', word: 'casa' }), 'present');
  assert.deepEqual(storage.listIdsWith('ca:0'), [list.id]);
  const second = storage.lists()[1];
  assert.equal(storage.toggleItem(second.id, { id: 'ca:0', word: 'casa' }), 'added');
  assert.deepEqual(storage.listIdsWith('ca:0'), [list.id, second.id], 'one entry sits in many lists');
  assert.equal(storage.toggleItem(second.id, { id: 'ca:0', word: 'casa' }), 'removed');

  const again = createStorage(fakeBackend(backend.raw()), clock);
  assert.deepEqual(again.lists(), storage.lists(), 'the lists round-trip');
  assert.deepEqual(again.folders(), [folder]);
  storage.removeList(list.id);
  assert.equal(storage.lists().length, 1);
});

test('an imported list gets a new name, and a backup restores the same counts', () => {
  const backend = fakeBackend();
  const clock = () => 5000;
  const storage = createStorage(backend, clock);
  const list = storage.addList('Travel', 'Travel');
  storage.addItem(list.id, { id: 'ca:0', word: 'casa' });
  storage.setNote('ca:0', 'a note', 'casa');
  storage.addQuery('casa');

  const file = parsePackage({
    app: 'itadict',
    kind: 'list',
    v: 1,
    name: 'Travel',
    label: 'Travel',
    items: [{ id: 'ca:0', word: 'casa' }, { id: 'vi:1', word: 'via' }],
  });
  assert.ok(file !== null);
  const merged = storage.importList(file);
  assert.equal(merged.list.name, 'Travel (2)');
  assert.equal(merged.added, 1);
  assert.equal(merged.present, 1);

  const before = counts(storage.snapshot());
  const backup = parseBackup(JSON.parse(JSON.stringify(backupFile(storage.snapshot(), 'now'))));
  assert.ok(backup !== null);

  // Wipe: a fresh envelope on the same backend, then restore the file.
  backend.setItem(KEY, JSON.stringify({ v: VERSION, data: {} }));
  const wiped = createStorage(fakeBackend(backend.raw()), clock);
  assert.equal(wiped.lists().length, 0);
  assert.equal(wiped.restore(backup.data), true);
  assert.deepEqual(counts(wiped.snapshot()), before, 'a backup and a restore keep the same counts');
  assert.equal(wiped.note('ca:0'), 'a note');
  assert.deepEqual(wiped.settings(), storage.settings());
});

test('notes come back newest first, and an edit moves a note up', () => {
  const backend = fakeBackend();
  let clock = 100;
  const storage = createStorage(backend, () => clock);
  storage.setNote('ca:0', 'first', 'casa');
  clock = 200;
  storage.setNote('vi:1', 'second', 'via');
  clock = 300;
  storage.setNote('ca:0', 'edited', 'casa');
  assert.deepEqual(storage.notes().map((note) => note.id), ['ca:0', 'vi:1'], 'the newest edit leads');
  assert.equal(storage.notes()[0].text, 'edited');
  storage.setNote('ca:0', '', 'casa');
  assert.deepEqual(storage.notes().map((note) => note.id), ['vi:1'], 'an empty note leaves no row');
});

test('a note is never destroyed silently: no write without a word, none over another word', () => {
  const storage = createStorage(fakeBackend());
  assert.equal(storage.setNote('ca:0', 'no word yet', ''), false, 'an empty word is refused');
  assert.equal(storage.setNote('ca:0', 'cold link', 'ca:0'), false, 'a cold link id as the word is refused');
  assert.equal(storage.note('ca:0'), '');
  assert.equal(storage.setNote('ca:0', 'about the house', 'casa'), true);
  assert.equal(storage.setNote('ca:0', 'about the case', 'caso'), false, 'another word cannot overwrite it');
  assert.equal(storage.setNote('ca:0', '', 'caso'), false, 'nor clear it');
  assert.equal(storage.note('ca:0'), 'about the house');
  assert.equal(storage.notes()[0].word, 'casa');
  assert.equal(storage.setNote('ca:0', 'edited', 'Casa'), true, 'its own word, folded, can edit it');
  assert.equal(storage.note('ca:0'), 'edited');

  // A note from before words were stored has no owner: the first word that writes adopts it.
  const old = createStorage(fakeBackend(JSON.stringify({ v: 2, data: { notes: { 'ca:0': 'old note' } } })));
  assert.equal(old.setNote('ca:0', 'old note, kept', 'casa'), true);
  assert.equal(old.notes()[0].word, 'casa');
});

test('settings keep known values and the envelope reports its size', () => {
  const storage = createStorage(fakeBackend(), () => 42);
  assert.deepEqual(storage.setSettings({ theme: 'dark', textSize: 9, speechRate: 2 }), {
    theme: 'dark',
    textSize: 1,
    speechRate: 1.5,
  });
  assert.ok(storage.size() > 0);
  assert.equal(storage.setSettings({ theme: 'light', textSize: 2 }).textSize, 2);
});

// ---------------------------------------------------------------- ids a rebuild moved

/**
 * A rebuild that reflowed a split: `cas:0` was casa and is now caso, and casa moved to `cas:1`.
 * `cas:2` is a second casa, a homograph, which must not pull anything to itself.
 */
function movedBuild() {
  return fileFetch({
    'data/index.json': {
      version: 'v2',
      buckets: {
        ca: {
          search: [{ path: 'data/ca.json', hash: 'r1' }],
          entry: [{ path: 'data/entry/ca.json', hash: 'r2' }],
          forms: [{ path: 'data/forms/ca.json', hash: 'r3' }],
          ex: [],
        },
      },
    },
    'data/ca.json?v=r1': [
      ['caso', 'ca:0', 'caso', '', 'noun', 'case'],
      ['casa', 'ca:1', 'casa', '', 'noun', 'house'],
      ['cane', 'ca:2', 'cane', '', 'noun', 'dog'],
    ],
    'data/entry/ca.json?v=r2': [
      { id: 'ca:0', word: 'caso', pos: [{ pos: 'noun', senses: ['case'] }], ex: [] },
      { id: 'ca:1', word: 'casa', pos: [{ pos: 'noun', senses: ['house'] }], ex: [] },
      { id: 'ca:2', word: 'cane', pos: [{ pos: 'noun', senses: ['dog'] }], ex: [] },
    ],
    'data/forms/ca.json?v=r3': { case: { id: 'ca:1', lemma: 'casa', label: 'plurale' } },
  });
}

test('an item whose id a rebuild moved resolves by its stored word to the new id', async () => {
  const { fetch } = movedBuild();
  const dictionary = wordDictionary(createData({ fetch, base: '' }), fold);
  const moved = await relocate(
    [
      { id: 'ca:0', word: 'casa' }, // moved: ca:0 is caso now
      { id: 'ca:0', word: 'casa' }, // the same item twice is read once
      { id: 'ca:2', word: 'cane' }, // in place
      { id: 'ca:1', word: 'case' }, // a form of casa, not a headword: never moved onto the lemma
      { id: 'ca:2', word: 'gatto' }, // the word left the dictionary
      { id: 'ca:0', word: '' }, // no word: never checked
      { id: 'ca:0', word: 'ca:0' }, // a cold-link id stored as the word: never checked
    ],
    dictionary,
  );
  assert.deepEqual(moved.find((move) => move.word === 'casa'), { from: 'ca:0', word: 'casa', to: 'ca:1', why: 'moved' });
  assert.equal(moved.filter((move) => move.word === 'casa').length, 1, 'one answer per distinct item');
  assert.equal(moved.find((move) => move.word === 'cane'), undefined, 'an item still on its headword stays');
  assert.deepEqual(
    moved.find((move) => move.word === 'case'),
    { from: 'ca:1', word: 'case', to: null, why: 'missing' },
    'a word that is only a form is missing: the lemma is a different headword',
  );
  assert.deepEqual(
    moved.find((move) => move.word === 'gatto'),
    { from: 'ca:2', word: 'gatto', to: null, why: 'missing' },
    'a lost word has nowhere to go, and stays',
  );
  assert.equal(moved.length, 3);
  assert.equal(hasWord({ id: 'ca:0', word: '' }), false);
  assert.equal(hasWord({ id: 'ca:0', word: 'ca:0' }), false);
  assert.equal(hasWord({ id: 'ca:0', word: 'casa' }), true);

  const offline = await relocate([{ id: 'ca:0', word: 'casa' }], {
    fold,
    headwordOf: async () => {
      throw new Error('offline');
    },
    idsOfWord: async () => ['ca:1'],
  });
  assert.deepEqual(offline, [], 'a lookup that fails decides nothing');
});

test('homographs: a single same-bucket candidate resolves, and candidates that disagree leave the item put', async () => {
  // Pure rule: only a candidate in the old id's two-letter bucket counts.
  const stub = (/** @type {string[]} */ ids) => ({
    fold,
    headwordOf: async () => 'altro',
    idsOfWord: async () => ids,
  });
  assert.deepEqual(
    await relocate([{ id: 'cas:3', word: 'casa' }], stub(['zz:9', 'casa:4'])),
    [{ from: 'cas:3', word: 'casa', to: 'casa:4', why: 'moved' }],
    'one candidate in the same bucket wins, even across a file split (cas -> casa)',
  );
  assert.deepEqual(
    await relocate([{ id: 'cas:3', word: 'casa' }], stub(['zz:9'])),
    [{ from: 'cas:3', word: 'casa', to: null, why: 'missing' }],
    'a candidate in another bucket alone does not count',
  );

  // Through the data client: pesca is two entries, a noun and a verb, and pe:2 is pesce now.
  const { fetch } = fileFetch({
    'data/index.json': {
      version: 'v2',
      buckets: {
        pe: {
          search: [{ path: 'data/pe.json', hash: 'p1' }],
          entry: [{ path: 'data/entry/pe.json', hash: 'p2' }],
          forms: [{ path: 'data/forms/pe.json', hash: 'p3' }],
          ex: [],
        },
      },
    },
    'data/pe.json?v=p1': [
      ['pesca', 'pe:0', 'pesca', '', 'noun', 'peach'],
      ['pesca', 'pe:1', 'pesca', '', 'verb', 'he fishes'],
      ['pesce', 'pe:2', 'pesce', '', 'noun', 'fish'],
    ],
    'data/entry/pe.json?v=p2': [
      { id: 'pe:0', word: 'pesca', pos: [{ pos: 'noun', senses: ['frutto'] }], ex: [] },
      { id: 'pe:1', word: 'pesca', pos: [{ pos: 'verb', senses: ['pescare'] }], ex: [] },
      { id: 'pe:2', word: 'pesce', pos: [{ pos: 'noun', senses: ['animale'] }], ex: [] },
    ],
    'data/forms/pe.json?v=p3': {},
  });
  const dictionary = wordDictionary(createData({ fetch, base: '' }), fold);
  assert.deepEqual(await dictionary.idsOfWord('pesca'), ['pe:0', 'pe:1'], 'both homographs are candidates');
  assert.deepEqual(
    await relocate([{ id: 'pe:2', word: 'pesca' }], dictionary),
    [{ from: 'pe:2', word: 'pesca', to: null, why: 'ambiguous' }],
    'two candidates disagree: nothing moves',
  );
  assert.deepEqual(await relocate([{ id: 'pe:1', word: 'pesca' }], dictionary), [], 'an item still on one of them stays');

  const storage = createStorage(fakeBackend());
  storage.setNote('pe:2', 'a note about peaches', 'pesca');
  for (const move of await relocate([{ id: 'pe:2', word: 'pesca' }], dictionary)) {
    if (move.to !== null) storage.rekeyAll([{ from: move.from, to: move.to, word: move.word }], fold);
  }
  assert.equal(storage.note('pe:2'), 'a note about peaches', 'the note stays at its old id');
  assert.equal(storage.note('pe:0') + storage.note('pe:1'), '', 'and lands on neither homograph');
});

test('rekeyAll moves a moved note and list item to the new id, and leaves what another word owns', () => {
  const storage = createStorage(fakeBackend());
  storage.setNote('ca:0', 'my house note', 'casa');
  storage.setNote('ca:1', 'already here', 'casa');
  storage.setNote('ca:2', 'about the dog', 'cane');
  const words = storage.addList('Words', 'Nouns');
  const other = storage.addList('Other', 'Other');
  storage.addItem(words.id, { id: 'ca:0', word: 'casa' });
  storage.addItem(other.id, { id: 'ca:0', word: 'casa' });
  storage.addItem(other.id, { id: 'ca:1', word: 'casa' });
  storage.addItem(words.id, { id: 'ca:2', word: 'cane' });

  assert.equal(storage.rekeyAll([{ from: 'ca:0', to: 'ca:1', word: 'Casa' }], fold), 3, 'one note and two list items moved');
  assert.equal(storage.note('ca:0'), '', 'nothing is left at the old id');
  assert.equal(storage.note('ca:1'), 'already here\n\nmy house note', 'a note meeting a note is appended, never lost');
  const lists = storage.lists();
  assert.deepEqual(lists.find((list) => list.id === words.id)?.items, [
    { id: 'ca:1', word: 'casa' },
    { id: 'ca:2', word: 'cane' },
  ]);
  assert.deepEqual(lists.find((list) => list.id === other.id)?.items, [{ id: 'ca:1', word: 'casa' }], 'a duplicate is dropped');

  assert.equal(storage.rekeyAll([{ from: 'ca:2', to: 'ca:1', word: 'casa' }], fold), 0, 'an item another word owns stays');
  assert.equal(storage.note('ca:2'), 'about the dog');
  assert.equal(storage.rekeyAll([{ from: 'ca:1', to: 'ca:1', word: 'casa' }], fold), 0);
});

test('rekeyAll applies chained shifts from one snapshot: casa ca:3 -> ca:4 while caso ca:4 -> ca:5', () => {
  const storage = createStorage(fakeBackend());
  storage.setNote('ca:3', 'about the house', 'casa');
  storage.setNote('ca:4', 'about the case', 'caso');
  const list = storage.addList('Words', 'Nouns');
  storage.addItem(list.id, { id: 'ca:3', word: 'casa' });
  storage.addItem(list.id, { id: 'ca:4', word: 'caso' });
  // Either order of the moves gives the same result.
  for (const moves of [
    [{ from: 'ca:3', to: 'ca:4', word: 'casa' }, { from: 'ca:4', to: 'ca:5', word: 'caso' }],
    [{ from: 'ca:4', to: 'ca:5', word: 'caso' }, { from: 'ca:3', to: 'ca:4', word: 'casa' }],
  ]) {
    const copy = createStorage(fakeBackend(JSON.stringify({ v: 3, data: storage.snapshot() })));
    assert.equal(copy.rekeyAll(moves, fold), 4, 'two notes and two list items moved');
    assert.deepEqual(
      copy.notes().map((note) => [note.id, note.word, note.text]).sort(),
      [['ca:4', 'casa', 'about the house'], ['ca:5', 'caso', 'about the case']],
      'no note is merged into another word',
    );
    assert.deepEqual(copy.lists()[0].items, [{ id: 'ca:4', word: 'casa' }, { id: 'ca:5', word: 'caso' }], 'no list item is dropped');
  }

  // A destination another word keeps: that move is dropped and its item stays.
  const blocked = createStorage(fakeBackend());
  blocked.setNote('ca:3', 'about the house', 'casa');
  blocked.setNote('ca:4', 'about the dog', 'cane');
  assert.equal(blocked.rekeyAll([{ from: 'ca:3', to: 'ca:4', word: 'casa' }], fold), 0);
  assert.equal(blocked.note('ca:3'), 'about the house');
  assert.equal(blocked.note('ca:4'), 'about the dog');
});

// ---------------------------------------------------------------- the Reference catalogue

test('the alphabet lists the 21 Italian letters and the six accented vowels', () => {
  assert.equal(ALPHABET.length, 27);
  assert.deepEqual(
    ALPHABET.map((row) => row.letter),
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'z', 'à', 'è', 'é', 'ì', 'ò', 'ù'],
  );
  for (const row of ALPHABET) {
    assert.ok(row.name !== '' && row.word !== '', row.letter + ' has a name and an example');
  }
});

test('the parts-of-speech index counts every row and keeps the first rows in order', () => {
  const rows = [
    { id: 'a', word: 'a', pos: 'verb', gloss: '' },
    { id: 'b', word: 'b', pos: 'noun', gloss: '' },
    { id: 'c', word: 'c', pos: 'verb', gloss: '' },
    { id: 'd', word: 'd', pos: 'noun', gloss: '' },
    { id: 'e', word: 'e', pos: 'noun', gloss: '' },
    { id: 'f', word: 'f', pos: 'adj', gloss: '' },
  ];
  const groups = posIndex(rows, 2);
  assert.deepEqual(groups.map((group) => [group.pos, group.label, group.count]), [
    ['noun', 'Noun', 3],
    ['verb', 'Verb', 2],
    ['adj', 'Adjective', 1],
  ]);
  assert.deepEqual(groups[0].rows.map((row) => row.id), ['b', 'd'], 'capped at two, in the order given');
  assert.equal(posLabel('prep_phrase'), 'Prepositional phrase');
  assert.equal(posLabel('unknown_kind'), 'Unknown kind');
});

// ---------------------------------------------------------------- routes

test('the router parses exactly the eight routes, and nothing else', () => {
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
  assert.deepEqual(parseRoute('#/sentence/ca/4507'), { name: 'sentence', id: 'ca:4507' });
  assert.deepEqual(parseRoute('#/sentence/e_/1'), { name: 'sentence', id: 'e_:1' });
  assert.deepEqual(parseRoute('#/sentence/__/1234567890'), { name: 'sentence', id: '__:1234567890' });
  assert.equal(sentenceHash('ca', '4507'), '#/sentence/ca/4507');
  assert.deepEqual(parseRoute(sentenceHash('co', '42')), { name: 'sentence', id: 'co:42' }, 'sentenceHash round-trips');
  for (const hash of [
    '#/sentence',
    '#/sentence/ca',
    '#/sentence/ca/',
    '#/sentence/ca/x1',
    '#/sentence/CA/1',
    '#/sentence/abc/1',
    '#/sentence/ca/1/2',
    '#/sentence//1',
    '#/sentence/ca/12345678901',
  ]) {
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
  assert.deepEqual(JSON.parse(backend.raw()), {
    v: VERSION,
    data: {
      history: ['casa', 'via'],
      opened: [],
      schedule: {},
      notes: {},
      lists: [],
      folders: [],
      settings: { theme: 'system', textSize: 1, speechRate: 0.9 },
    },
  });
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
  assert.deepEqual(manifest?.sources, [{ name: 'kaikki', url: 'https://example.org', licence: 'CC BY-SA', attribution: '' }]);
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
    en: '',
  });
  assert.equal(
    toRow(['casa', 'ca:0', 'casa', '/ˈkasa/', 'noun', 'edificio', 'house'])?.en,
    'house',
    'the seventh field is the English gloss',
  );
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
    { id: 'ca:0', lemma: 'casa', label: 'plurale', form: '' },
  ], 'a record without its written form reads form as empty');
  assert.equal(parseForms({ e: { id: 'es:0', lemma: 'essere', label: '3s', form: 'è' } }).get('e')?.form, 'è');
  assert.deepEqual(parseExamples([['e1', 'La casa è grande.'], ['e2', 'Vado a casa.']]), [
    { id: 'e1', it: 'La casa è grande.', en: '' },
    { id: 'e2', it: 'Vado a casa.', en: '' },
  ], 'a legacy two-element row reads with no English');
});

test('parseExamples keeps one record per row: English, empty English, legacy, and a bad row in place', () => {
  const rows = parseExamples([
    ['4411', 'La casa è grande.', 'The house is big.'],
    ['4507', 'Vado a casa.', 'I am going home.'],
    ['4600', "L'acqua è fredda.", ''],
    'junk',
    ['4700', 'Il cane dorme.'],
    [4800, 'Il gatto mangia.', ' The cat eats. '],
  ]);
  assert.equal(rows.length, 6, 'no row is dropped, so positions hold');
  assert.deepEqual(rows[0], { id: '4411', it: 'La casa è grande.', en: 'The house is big.' }, 'a row with English');
  assert.deepEqual(rows[1], { id: '4507', it: 'Vado a casa.', en: 'I am going home.' });
  assert.deepEqual(rows[2], { id: '4600', it: "L'acqua è fredda.", en: '' }, 'an empty English stays empty');
  assert.deepEqual(rows[3], { id: '', it: '', en: '' }, 'a bad row keeps its place, empty');
  assert.equal(rows[4].it, 'Il cane dorme.', 'the row after a bad row keeps its position');
  assert.deepEqual(rows[5], { id: '4800', it: 'Il gatto mangia.', en: 'The cat eats.' }, 'a numeric id reads as a string, the English trimmed');
  assert.deepEqual(parseExamples({ 9: 'Ciao.' }), [{ id: '9', it: 'Ciao.', en: '' }], 'an object keyed by id');
  assert.deepEqual(parseExamples(null), []);
  assert.equal(exampleBucket('com:1'), 'co');
  assert.equal(exampleBucket('e_:0'), 'e_');
  assert.equal(exampleBucket('ca:42'), 'ca');
  assert.equal(exampleBucket('nope'), '');
});

test('sentence() finds a row by id through the same hashed fetch as examples()', async () => {
  const { calls, fetch } = fileFetch({
    'data/index.json': {
      version: 'v1',
      buckets: { ca: { search: [], entry: [], forms: [], ex: [{ path: 'data/ex/ca.json', hash: 'x1' }] } },
    },
    'data/ex/ca.json?v=x1': [
      ['4411', 'La casa è grande.', 'The house is big.'],
      ['4507', 'Vado a casa.', 'I am going home.'],
      ['4600', 'Casa mia.', ''],
    ],
  });
  const data = createData({ fetch, base: '' });
  assert.equal((await data.examples('ca')).length, 3);
  assert.deepEqual(await data.sentence('ca', '4507'), { id: '4507', it: 'Vado a casa.', en: 'I am going home.' });
  assert.equal((await data.sentence('ca', '4600'))?.en, '', 'an empty English reads as empty, not missing');
  assert.equal(await data.sentence('ca', '9999'), null, 'an unknown id');
  assert.equal(await data.sentence('zz', '4411'), null, 'an unknown bucket');
  assert.equal(calls.filter((url) => url === 'data/ex/ca.json?v=x1').length, 1, 'one fetch shared by examples() and sentence()');
});

test('About reads attribution lines from the manifest sources, and none draws no blank', () => {
  const base = { version: 'v1', buckets: { ca: { search: [{ path: 'data/ca.json', hash: 'h' }] } } };
  const before = parseManifest({ ...base, sources: [{ url: 'https://tatoeba.org/x', licence: 'CC BY 2.0 FR' }] });
  assert.deepEqual(attributions(/** @type {any} */ (before)), [], 'a manifest from before the rebuild has no line, and no blank');
  const tatoeba = 'Frasi e traduzioni da Tatoeba (tatoeba.org), CC BY 2.0 FR';
  const after = parseManifest({
    ...base,
    sources: [
      { url: 'https://kaikki.org/x', licence: 'CC BY-SA 4.0' },
      { url: 'https://tatoeba.org/ita', licence: 'CC BY 2.0 FR', attribution: tatoeba },
      { url: 'https://tatoeba.org/eng', licence: 'CC BY 2.0 FR', attribution: ' ' + tatoeba + ' ' },
      { url: 'https://example.org/other', licence: 'CC BY 4.0', attribution: 'Altra fonte, CC BY 4.0' },
      { url: 'https://x', licence: '', attribution: '' },
    ],
  });
  assert.deepEqual(attributions(/** @type {any} */ (after)), [tatoeba, 'Altra fonte, CC BY 4.0'], 'in source order, each once, trimmed, none blank');
});

test('a second sentence() call reads no file', async () => {
  const { calls, fetch } = fileFetch({
    'data/index.json': {
      version: 'v1',
      buckets: { ca: { search: [], entry: [], forms: [], ex: [{ path: 'data/ex/ca.json', hash: 'x2' }] } },
    },
    'data/ex/ca.json?v=x2': [['4507', 'Vado a casa.', 'I am going home.']],
  });
  const data = createData({ fetch, base: '' });
  assert.equal((await data.sentence('ca', '4507'))?.en, 'I am going home.');
  const before = calls.length;
  assert.equal(before, 2, 'a cold sentence costs the manifest and one ex file');
  assert.equal((await data.sentence('ca', '4507'))?.it, 'Vado a casa.');
  assert.equal(await data.sentence('ca', '1'), null);
  assert.equal(calls.length, before, 'the second and third calls fetch nothing');
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
  assert.deepEqual((await data.examples('ca')).map((example) => example.it).slice(0, 1), ['La casa è grande.']);
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

// ---------------------------------------------------------------- study

const DAY = 24 * 60 * 60 * 1000;

test('a forgot drops to step 0, lowers the ease and comes back in ten minutes', () => {
  const now = Date.UTC(2026, 0, 5, 12);
  const card = gradeCard({ step: 3, ease: 2.5, due: 0, reps: 5, lapses: 1 }, false, now);
  assert.deepEqual(card, { step: 0, ease: 2.3, due: now + 10 * 60 * 1000, reps: 5, lapses: 2 });

  let floor = newCard(now);
  for (let index = 0; index < 10; index += 1) floor = gradeCard(floor, false, now);
  assert.equal(floor.ease, EASE_MIN, 'the ease never falls under the floor');
});

test('a remembered card climbs the interval ladder, scaled by ease, and repeats the top step', () => {
  const now = Date.UTC(2026, 0, 5, 12);
  let card = newCard(now);
  const days = [];
  for (let index = 0; index < INTERVALS.length + 1; index += 1) {
    card = gradeCard(card, true, now);
    days.push(Math.round((card.due - now) / DAY));
  }
  assert.deepEqual(days.slice(0, INTERVALS.length), INTERVALS);
  assert.equal(days[INTERVALS.length], INTERVALS[INTERVALS.length - 1], 'the top step repeats');
  assert.equal(card.reps, INTERVALS.length + 1);
  assert.equal(card.ease, EASE_START, 'remembering never raises the ease');
  assert.equal(readCard(card)?.step, INTERVALS.length + 1);
});

test('due today counts a past due date, and stops at local midnight', () => {
  const now = new Date(2026, 0, 5, 9).getTime();
  const end = endOfToday(now);
  const card = (due) => ({ step: 0, ease: 2.5, due, reps: 0, lapses: 0 });
  const schedule = {
    'ca:0': card(end - 1),
    'ca:1': card(end),
    'ca:2': card(end + 1),
    'ca:3': card(new Date(2020, 0, 1).getTime()),
  };
  assert.equal(dueCount(schedule, now), 3, 'a made-up past date is due');
  assert.deepEqual(dueIds(schedule, now), ['ca:3', 'ca:0', 'ca:1'], 'soonest first');
  assert.equal(isDue(schedule['ca:2'], now), false, 'one millisecond past midnight is tomorrow');
  assert.equal(dueCount({}, now), 0);
  assert.equal(dueCount({ 'ca:0': 'junk' }, now), 0, 'a malformed card is not due');
});

test('a deck shows due cards first, then new ones, then the future', () => {
  const now = new Date(2026, 0, 5, 9).getTime();
  const end = endOfToday(now);
  const card = (due, step) => ({ step, ease: 2.5, due, reps: step, lapses: 0 });
  const schedule = { a: card(end - 10, 1), b: card(end + 5 * DAY, 2) };
  assert.deepEqual(orderDeck(['c', 'b', 'a', 'd'], schedule, now), ['a', 'c', 'd', 'b']);
});

test('a graded card survives a reload, with its note and the History deck', () => {
  const backend = fakeBackend();
  const now = Date.UTC(2026, 0, 5, 12);
  const first = createStorage(backend);
  const graded = gradeCard(newCard(now), true, now);
  first.setSchedule('co:5', graded);
  first.setNote('co:5', 'comprare = to buy', 'comprare');
  first.addOpened('co:5');

  const again = createStorage(fakeBackend(backend.raw()));
  assert.deepEqual(again.schedule()['co:5'], graded, 'the schedule is the same after a reload');
  assert.equal(again.schedule()['co:5'].reps, 1);
  assert.equal(again.note('co:5'), 'comprare = to buy');
  assert.deepEqual(again.opened(), ['co:5']);
});

test('a v1 blob migrates forward with empty study collections and lists', () => {
  const storage = createStorage(fakeBackend(JSON.stringify({ v: 1, data: { history: ['casa'] } })));
  assert.deepEqual(storage.schedule(), {});
  assert.deepEqual(storage.opened(), []);
  assert.equal(storage.note('ca:0'), '');
  assert.deepEqual(storage.lists(), []);
  assert.deepEqual(storage.folders(), []);
  assert.deepEqual(storage.history(), ['casa'], 'the old data survives');
});

test('a v2 note carries no word, and a missing word falls back to the id', () => {
  const storage = createStorage(fakeBackend(JSON.stringify({ v: 2, data: { notes: { 'ca:0': 'old note' } } })));
  assert.deepEqual(storage.notes(), [{ id: 'ca:0', text: 'old note', at: 0, word: '' }]);
  assert.equal(noteWord('', '', 'ca:0'), 'ca:0', 'the id is the last resort');
  assert.equal(noteWord('', 'casa', 'ca:0'), 'casa', 'a fetched headword is the next resort');
  assert.equal(noteWord('casa', 'altra', 'ca:0'), 'casa', 'a stored word wins');
  storage.setNote('ca:0', 'new note', 'casa');
  assert.equal(storage.notes()[0].word, 'casa', 'a saved note keeps its headword');
});

test('a CEFR deck row reads as id, word, pos and gloss', () => {
  assert.deepEqual(toDeckRow(['ca:0', 'casa', 'noun', 'house']), { id: 'ca:0', word: 'casa', pos: 'noun', gloss: 'house' });
  assert.equal(toDeckRow(['ca:0']), null);
  assert.equal(toDeckRow({ id: 'ca:0', word: 'casa', pos: 'noun', gloss: '' })?.word, 'casa');
  assert.equal(toDeckRow({}), null);
});

test('the manifest exposes the CEFR decks with their row counts', () => {
  const manifest = parseManifest({
    buckets: { ca: { search: [{ path: 'data/ca.json' }] } },
    cefr: { a1: [{ path: 'data/cefr/a1.json', bytes: 10, hash: 'abc', rows: 670 }], empty: [] },
  });
  assert.deepEqual(manifest?.cefr.a1, [{ path: 'data/cefr/a1.json', bytes: 10, hash: 'abc', rows: 670 }]);
  assert.equal(manifest?.cefr.empty, undefined, 'a band with no file is not listed');
});

// ---------------------------------------------------------------- speech

test('speech picks an Italian voice, speaks at 0.9 and never offers a dead button', () => {
  const spoken = [];
  const fake = {
    speechSynthesis: {
      getVoices: () => [{ lang: 'en-US', name: 'Sam' }, { lang: 'it-IT', name: 'Alice' }],
      speak: (utterance) => spoken.push(utterance),
      cancel: () => spoken.push('cancel'),
    },
    SpeechSynthesisUtterance: class {
      constructor(text) {
        this.text = text;
      }
    },
  };
  const speech = createSpeech(fake);
  assert.equal(speech.available(), true);
  assert.equal(speech.speak('casa'), true);
  assert.equal(spoken[0], 'cancel', 'a new word cancels the old one');
  const utterance = spoken[1];
  assert.equal(utterance.lang, 'it-IT');
  assert.equal(utterance.rate, RATE);
  assert.equal(utterance.voice.name, 'Alice');
  assert.equal(utterance.text, 'casa');

  speech.speak('via', 1.2);
  assert.equal(spoken[3].rate, 1.2, 'the stored rate is used');
  speech.speak('via', 9);
  assert.equal(spoken[5].rate, 1.5, 'a fast rate is clamped');
  speech.speak('via', 0.1);
  assert.equal(spoken[7].rate, 0.5, 'a slow rate is clamped');
  speech.speak('via', Number.NaN);
  assert.equal(spoken[9].rate, RATE, 'a bad rate falls back to the default');

  const noItalian = createSpeech({
    speechSynthesis: { getVoices: () => [{ lang: 'en-US' }], speak() {}, cancel() {} },
    SpeechSynthesisUtterance: class {},
  });
  assert.equal(noItalian.available(), false);
  assert.equal(noItalian.speak('casa'), false, 'no Italian voice means no sound');

  assert.equal(createSpeech({}).available(), false, 'a browser without synthesis hides the control');
});

