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
  toDeckRow,
  toEntry,
  toRow,
} from '../js/data.js';
import { HASH, createRouter, entryHash, parseRoute, resolveRoute } from '../js/router.js';
import { createSearch, editDistanceAtMost, findMatch, fold, rank } from '../js/search.js';
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
import { WORD_CAP, createReader, summarise, tokenize } from '../js/text.js';
import { PALETTE, backTarget, formRows } from '../js/ui.js';
import {
  LABELS,
  backupFile,
  counts,
  firstLine,
  noteWord,
  labelFor,
  mergeList,
  packageList,
  parseBackup,
  parsePackage,
  readLists,
  uniqueName,
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
  storage.setNote('ca:0', 'a note');
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
  storage.setNote('ca:0', 'first');
  clock = 200;
  storage.setNote('vi:1', 'second');
  clock = 300;
  storage.setNote('ca:0', 'edited');
  assert.deepEqual(storage.notes().map((note) => note.id), ['ca:0', 'vi:1'], 'the newest edit leads');
  assert.equal(storage.notes()[0].text, 'edited');
  storage.setNote('ca:0', '');
  assert.deepEqual(storage.notes().map((note) => note.id), ['vi:1'], 'an empty note leaves no row');
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
  first.setNote('co:5', 'comprare = to buy');
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

  const noItalian = createSpeech({
    speechSynthesis: { getVoices: () => [{ lang: 'en-US' }], speak() {}, cancel() {} },
    SpeechSynthesisUtterance: class {},
  });
  assert.equal(noItalian.available(), false);
  assert.equal(noItalian.speak('casa'), false, 'no Italian voice means no sound');

  assert.equal(createSpeech({}).available(), false, 'a browser without synthesis hides the control');
});

