// @ts-check
/**
 * The offline gate: the deployed shape, in a browser that behaves like an iPhone. Dev-only.
 * Run: npm run verify:offline
 *
 * Serves the parent directory, so the app loads under /itadict/ exactly as it deploys. Check
 * docs/verification/gate-2.md for what this cannot prove: the safe areas, the home-screen install,
 * the status bar, the voices, the swipe and the eviction.
 *
 * The sentence page is checked with a fixture read from the data: the first row of data/ex/ca.json
 * whose Italian has the word `casa`. Online, a cold deep link draws its Italian and English;
 * offline, after the download action, it draws them again and a tap on `casa` opens that entry.
 * Every row of every ex file in the manifest must carry English: one without fails the run.
 *
 * One deliberate miss is in the run: the download action is asked for a file that does not exist,
 * to prove one bad file is counted and the run goes on. Every response is checked except that one.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

/** The repo root, with its trailing slash: .../itadict/ */
const REPO = fileURLToPath(new URL('..', import.meta.url));
/** The folder the server holds, so the app sits on its deploy subpath. */
const PARENT = resolve(REPO, '..');
const SUBPATH = '/' + basename(REPO) + '/';

/** The path this run asks for and expects to miss. */
const MISSING = 'data/not-written.json';

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

/** The device the whole run pretends to be. */
const DEVICE = {
  viewport: { width: 390, height: 664 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

// ---------------------------------------------------------------- the server

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  /** @param {number} status @param {string} type @param {string | Buffer} body */
  const send = (status, type, body) => {
    // GitHub Pages sends max-age=600. This server sends no-cache, so a bump of the worker is never
    // stale inside the run.
    response.writeHead(status, { 'content-type': type, 'cache-control': 'no-cache' });
    response.end(body);
  };
  if (!path.startsWith(SUBPATH)) {
    send(404, 'text/plain; charset=utf-8', 'outside the app subpath');
    return;
  }
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(join(PARENT, path));
  if (!file.startsWith(PARENT + sep)) {
    send(403, 'text/plain; charset=utf-8', 'outside the server root');
    return;
  }
  try {
    send(200, TYPES.get(extname(file)) ?? 'application/octet-stream', await readFile(file));
  } catch (error) {
    send(404, 'text/plain; charset=utf-8', 'not found: ' + path);
  }
});

// ---------------------------------------------------------------- the report

/** @type {string[]} */
const failures = [];
let checks = 0;

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {string} [detail]
 */
function check(name, ok, detail) {
  checks += 1;
  console.log((ok ? 'pass  ' : 'FAIL  ') + name + (ok || !detail ? '' : ' :: ' + detail));
  if (!ok) failures.push(name + (detail ? ' :: ' + detail : ''));
}

/**
 * One page's network and console record. Responses are recorded online only: a request that fails
 * with the network cut is not a 404 the app caused.
 * @param {import('playwright').Page} page
 */
function watch(page) {
  const record = { requests: [], responses: [], consoleErrors: [], pageErrors: [], online: true };
  page.on('request', (request) => record.requests.push(request.url()));
  page.on('response', (response) => {
    if (record.online) record.responses.push({ url: response.url(), status: response.status() });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') record.consoleErrors.push({ text: message.text(), online: record.online });
  });
  page.on('pageerror', (error) => record.pageErrors.push(String(error)));
  return record;
}

// ---------------------------------------------------------------- the precache list

/** The paths sw.js precaches on install. A module left off this list is dead offline. */
async function precached() {
  const source = await readFile(join(REPO, 'sw.js'), 'utf8');
  const block = /const SHELL = \[([\s\S]*?)\]/.exec(source);
  if (block === null) throw new Error('sw.js has no SHELL array');
  return block[1]
    .split(',')
    .map((item) => item.trim().replace(/^'/, '').replace(/'$/, ''))
    .filter((item) => item !== '');
}

const shell = await precached();
console.log('verify:offline: precached: ' + shell.join(' '));
const modules = readdirSync(join(REPO, 'js')).filter((name) => name.endsWith('.js'));
const absent = modules.filter((name) => !shell.includes('./js/' + name));
check('every module under js/ is precached', absent.length === 0, absent.join(', '));

// ---------------------------------------------------------------- the run

let build;
let caCount = 0;
let casaId = '';
/** The sentence fixture: the first `casa` row of ca. */
/** @type {{ sid: string, it: string, en: string } | null} */
let casaSentence = null;
/** The example rows of every ex file with no English, how many rows were read, and the first miss. */
let noEnglish = 0;
let exRows = 0;
let noEnglishFirst = '';
try {
  build = JSON.parse(await readFile(join(REPO, 'data', 'index.json'), 'utf8'));
  // The bucket file list changes with the split cap, so derive the fixtures from the manifest.
  const caFiles = build.buckets.ca ?? { search: [], entry: [], ex: [], forms: [] };
  caCount = caFiles.search.length + caFiles.entry.length + caFiles.ex.length + caFiles.forms.length;
  for (const file of caFiles.entry) {
    const home = JSON.parse(readFileSync(join(REPO, file.path), 'utf8')).find((entry) => entry.word === 'casa');
    if (home) {
      casaId = home.id;
      break;
    }
  }
  /** @param {unknown} row */
  const fixtureOf = (row) =>
    Array.isArray(row) && typeof row[1] === 'string'
      ? { sid: String(row[0]), it: row[1], en: typeof row[2] === 'string' ? row[2].trim() : '' }
      : null;
  for (const file of caFiles.ex) {
    for (const row of JSON.parse(readFileSync(join(REPO, file.path), 'utf8'))) {
      const fixture = fixtureOf(row);
      if (fixture === null) continue;
      const words = fixture.it.toLowerCase().split(/[^\p{L}'\u2019]+/u);
      if (casaSentence === null && words.includes('casa')) {
        casaSentence = fixture;
        break;
      }
    }
  }
  // Every example the app can draw must carry its English, in every bucket.
  for (const [bucket, files] of Object.entries(build.buckets)) {
    for (const file of files.ex ?? []) {
      for (const row of JSON.parse(readFileSync(join(REPO, file.path), 'utf8'))) {
        exRows += 1;
        const fixture = fixtureOf(row);
        if (fixture !== null && fixture.en !== '') continue;
        noEnglish += 1;
        if (noEnglishFirst === '') noEnglishFirst = bucket + '/' + (fixture?.sid ?? JSON.stringify(row).slice(0, 40));
      }
    }
  }
} catch (error) {
  console.error('verify:offline: data/index.json is missing. Run npm run build:data first.');
  process.exit(1);
}

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
const port = address === null || typeof address === 'string' ? 0 : address.port;
const origin = 'http://127.0.0.1:' + port;
const app = origin + SUBPATH;

console.log('verify:offline: serving ' + PARENT + ' at ' + app);
console.log('verify:offline: build ' + build.version);

const browser = await chromium.launch();

try {
  // -------------------------------------------------------------- online, one page
  const context = await browser.newContext(DEVICE);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const record = watch(page);

  const cold = await page.goto(app, { waitUntil: 'load' });
  check('cold load answers 200', cold !== null && cold.status() === 200, 'status ' + (cold === null ? 'none' : cold.status()));
  await page.waitForSelector('.search-input');
  const tabs = await page.locator('.tab').count();
  check('the tab bar draws five tabs', tabs === 5, 'tabs ' + tabs);

  let controlled = true;
  try {
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
  } catch (error) {
    controlled = false;
  }
  check('the worker controls the page', controlled);

  // A search fills the bucket ca, which is the bucket the offline pass searches again.
  await page.fill('.search-input', 'casa');
  await page.waitForSelector('.row-headword');
  const first = ((await page.textContent('.row-headword')) ?? '').trim();
  check('search finds casa', first.toLowerCase().startsWith('casa'), 'first row ' + first);
  await page.screenshot({ path: '/tmp/itadict-search.png' });

  // The manifest and the four icons, through the worker, so the paths are the deployed ones.
  const manifestResponse = await page.evaluate(async () => {
    const response = await fetch('./manifest.webmanifest');
    return { status: response.status, json: response.ok ? await response.json() : null };
  });
  const manifestJson = manifestResponse.json ?? {};
  const icons = (manifestJson.icons ?? []).map((icon) => String(icon.sizes) + ' ' + String(icon.purpose ?? 'any'));
  check('the manifest answers 200', manifestResponse.status === 200, 'status ' + manifestResponse.status);
  check('the manifest is Italian', manifestJson.name === 'Italian' && manifestJson.short_name === 'Italian', String(manifestJson.name));
  check(
    'start_url and scope are relative',
    manifestJson.start_url === './' && manifestJson.scope === './',
    String(manifestJson.start_url) + ' ' + String(manifestJson.scope),
  );
  check(
    'the manifest lists 180, 192, 512 and a maskable 512',
    icons.includes('180x180 any') && icons.includes('192x192 any') && icons.includes('512x512 any') && icons.includes('512x512 maskable'),
    icons.join(', '),
  );

  const iconStatuses = await page.evaluate(async () => {
    const paths = ['./icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];
    const out = [];
    for (const path of paths) out.push([path, (await fetch(path)).status]);
    return out;
  });
  const brokenIcons = iconStatuses.filter((pair) => pair[1] !== 200).map((pair) => pair[0]);
  check('the 180 icon and its three siblings answer 200', brokenIcons.length === 0, brokenIcons.join(', '));

  // -------------------------------------------------------------- a cold deep link, fresh context
  const deepContext = await browser.newContext(DEVICE);
  const deepPage = await deepContext.newPage();
  deepPage.setDefaultTimeout(20000);
  const deepRecord = watch(deepPage);
  await deepPage.goto(app + '#/entry/' + casaId, { waitUntil: 'load' });
  let headword = '';
  try {
    await deepPage.waitForSelector('.entry-screen .headword', { timeout: 20000 });
    headword = ((await deepPage.textContent('.entry-screen .headword')) ?? '').trim();
  } catch (error) {
    headword = '';
  }
  check('a cold deep link renders its entry', headword === 'casa', 'headword ' + headword);
  await deepPage.screenshot({ path: '/tmp/itadict-entry.png' });

  // A cold sentence link: the hash, then a reload, so the page boots on the sentence route.
  /**
   * @param {import('playwright').Page} target
   * @param {string} bucket
   * @param {string} sid
   */
  async function openSentence(target, bucket, sid) {
    await target.goto(app + '#/sentence/' + bucket + '/' + sid, { waitUntil: 'load' });
    await target.reload({ waitUntil: 'load' });
    await target.waitForSelector('.sentence-it, .sentence-screen .empty', { timeout: 20000 });
    return {
      it: (await target.locator('.sentence-it').textContent().catch(() => null)) ?? '',
      en: (await target.locator('.sentence-en').textContent({ timeout: 1000 }).catch(() => null)) ?? '',
    };
  }

  check('data/ex/ca.json has a row with the word casa', casaSentence !== null);
  check(
    'every example row of every bucket carries English',
    exRows > 0 && noEnglish === 0,
    noEnglish + ' of ' + exRows + ' rows have none, the first is ' + noEnglishFirst + ': rebuild the data',
  );
  if (casaSentence !== null) {
    const drawn = await openSentence(deepPage, 'ca', casaSentence.sid);
    check('a cold sentence link draws its Italian', drawn.it === casaSentence.it, JSON.stringify(drawn.it));
    check(
      'a cold sentence link draws its English',
      casaSentence.en !== '' && drawn.en === casaSentence.en,
      casaSentence.en === '' ? 'the row has no English: rebuild the data' : JSON.stringify(drawn.en),
    );
    await deepPage.screenshot({ path: '/tmp/itadict-sentence.png' });
  }
  check('no uncaught error on the cold links', deepRecord.pageErrors.length === 0, deepRecord.pageErrors.join(' | '));
  await deepContext.close();

  // -------------------------------------------------------------- word tap targets
  //
  // A fixture row "a e i o", four one-letter words, is added to the ca ex file in a fresh
  // context. Every word's box is at least 24x44, no two boxes on a line overlap, and at the
  // midpoint between two words' glyphs, and 1px either side of it, the hit is the nearer word or
  // the gap between them, never the other word.
  const hitContext = await browser.newContext(DEVICE);
  await hitContext.route('**/data/ex/ca.json*', async (route) => {
    const response = await route.fetch();
    const rows = await response.json();
    rows.push(['999999999', 'a e i o', 'a and i or']);
    await route.fulfill({ response, json: rows });
  });
  const hitPage = await hitContext.newPage();
  hitPage.setDefaultTimeout(20000);
  await hitPage.goto(app + '#/sentence/ca/999999999', { waitUntil: 'load' });
  await hitPage.waitForSelector('.sentence-word');
  await hitPage.waitForTimeout(300);
  const targets = await hitPage.evaluate(() => {
    const words = [...document.querySelectorAll('.sentence-word')];
    const boxes = words.map((button) => {
      const box = button.getBoundingClientRect();
      const glyphs = (button.firstElementChild ?? button).getBoundingClientRect();
      return { word: button.textContent ?? '', left: box.left, right: box.right, width: box.width, height: box.height, top: box.top, gl: glyphs.left, gr: glyphs.right };
    });
    /** @param {number} x @param {number} y */
    const hit = (x, y) => document.elementFromPoint(x, y)?.closest('.sentence-word')?.textContent ?? 'gap';
    const faults = [];
    for (let i = 0; i + 1 < boxes.length; i += 1) {
      const a = boxes[i];
      const b = boxes[i + 1];
      if (a.top !== b.top) continue;
      if (a.right > b.left + 0.01) faults.push('overlap ' + a.word + '|' + b.word);
      const y = a.top + a.height / 2;
      const mid = (a.gr + b.gl) / 2;
      for (const [x, wrong] of [[mid - 1, b.word], [mid + 1, a.word]]) {
        if (hit(x, y) === wrong) faults.push(a.word + '|' + b.word + ' at ' + x.toFixed(1) + ' hits ' + wrong);
      }
    }
    return { words: boxes.map((box) => box.word), minWidth: Math.min(...boxes.map((box) => box.width)), minHeight: Math.min(...boxes.map((box) => box.height)), faults };
  });
  check('the fixture draws a e i o as four words', targets.words.join(' ') === 'a e i o', targets.words.join(' '));
  check('every word target is at least 24x44', targets.minWidth >= 24 && targets.minHeight >= 44, targets.minWidth + 'x' + targets.minHeight);
  check('word targets never overlap and never answer for the other word', targets.faults.length === 0, targets.faults.join(' | '));
  await hitContext.close();

  // -------------------------------------------------------------- the download action
  //
  // Over the bucket ca, plus one file that does not exist. That miss makes the browser log a
  // console line of its own, so the console assertion stops at this point.
  const consoleBefore = record.consoleErrors.length;
  const download = await page.evaluate(async (bucket) => {
    const module = await import('./js/offline.js');
    const progress = [];
    const run = await module.downloadAll(
      { buckets: { ca: bucket } },
      { onProgress: (done, total, failed) => progress.push([done, total, failed]) },
    );
    const bad = await module.downloadAll({
      buckets: { zz: { search: [{ path: 'data/not-written.json', hash: 'x' }], entry: [], ex: [], forms: [] } },
    });
    return { run, progress, bad };
  }, build.buckets.ca ?? { search: [], entry: [], ex: [], forms: [] });
  const lastProgress = download.progress[download.progress.length - 1] ?? [];
  check('the download action reports progress per file', download.progress.length === download.run.total && lastProgress[2] === 0, JSON.stringify(lastProgress));
  check('the download action fetches every listed file', download.run.total === caCount && download.run.failures.length === 0, JSON.stringify(download.run.failures));
  check('one bad file is counted and the run goes on', download.bad.failures.length === 1 && download.bad.done === 1, JSON.stringify(download.bad));

  // -------------------------------------------------------------- offline
  //
  // Both cuts are needed. setOffline stops the page's own requests, and closing the server stops
  // the worker's: Chromium still lets a service worker reach the network while the context reads
  // as offline, so setOffline alone proves nothing about a cache miss. With both, only a cache can
  // answer.
  record.online = false;
  await context.setOffline(true);
  server.closeAllConnections();
  await new Promise((done) => server.close(done));

  let reloaded = true;
  try {
    await page.reload({ waitUntil: 'load' });
  } catch (error) {
    reloaded = false;
  }
  const offlineTabs = reloaded ? await page.locator('.tab').count() : 0;
  check('an offline relaunch draws the shell', offlineTabs === 5, 'tabs ' + offlineTabs);
  check('an offline relaunch draws Search', await page.locator('.search-input').isVisible());
  await page.screenshot({ path: '/tmp/itadict-offline.png' });

  await page.fill('.search-input', 'casa');
  let cachedRows = 0;
  try {
    await page.waitForSelector('.row-headword', { timeout: 10000 });
    cachedRows = await page.locator('.row-headword').count();
  } catch (error) {
    cachedRows = 0;
  }
  check('a search works offline for a bucket already cached', cachedRows > 0, 'rows ' + cachedRows);

  // A bucket this session never fetched. The worker answers a miss with 504, and the app says so in
  // one line instead of throwing.
  await page.fill('.search-input', 'strada');
  await page.waitForTimeout(3000);
  const line = ((await page.textContent('.search-body')) ?? '').replace(/\s+/g, ' ').trim();
  check('an uncached bucket offline shows one line, not a crash', /not ready|No results/.test(line), 'body: ' + line.slice(0, 120));

  // The sentence page offline: the ex file and the casa entry came with the download of ca.
  if (casaSentence !== null) {
    await page.evaluate((sid) => {
      location.hash = '#/sentence/ca/' + sid;
    }, casaSentence.sid);
    let drawnIt = '';
    let drawnEn = '';
    try {
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.sentence-it', { timeout: 10000 });
      drawnIt = (await page.textContent('.sentence-it')) ?? '';
      drawnEn = (await page.locator('.sentence-en').textContent({ timeout: 1000 }).catch(() => null)) ?? '';
    } catch (error) {
      drawnIt = '';
    }
    check('a sentence link draws its Italian offline', drawnIt === casaSentence.it, JSON.stringify(drawnIt));
    check('a sentence link draws its English offline', casaSentence.en !== '' && drawnEn === casaSentence.en, JSON.stringify(drawnEn));
    await page.screenshot({ path: '/tmp/itadict-sentence-offline.png' });

    let tapped = '';
    try {
      await page.locator('.sentence-word', { hasText: /^casa$/ }).first().click();
      await page.waitForFunction(() => document.querySelector('.entry-screen .headword')?.textContent === 'casa', null, {
        timeout: 10000,
      });
      tapped = ((await page.textContent('.entry-screen .headword')) ?? '').trim();
    } catch (error) {
      tapped = '';
    }
    check('a tap on casa offline opens its entry', tapped === 'casa', 'headword ' + tapped);
  }

  check('no uncaught error in the page', record.pageErrors.length === 0, record.pageErrors.join(' | '));

  // -------------------------------------------------------------- the whole log
  const requests = record.requests.concat(deepRecord.requests);
  const strays = requests.filter((url) => !url.startsWith(app));
  check('every request stays on the /itadict/ subpath', strays.length === 0, strays.slice(0, 5).join(' | '));

  const responses = record.responses.concat(deepRecord.responses);
  const badResponses = responses
    .filter((entry) => entry.status >= 400 && !entry.url.includes('not-written'))
    .map((entry) => entry.status + ' ' + entry.url);
  check('no response is 4xx or 5xx', badResponses.length === 0, badResponses.slice(0, 5).join(' | '));

  const onlineErrors = record.consoleErrors
    .slice(0, consoleBefore)
    .filter((entry) => entry.online)
    .map((entry) => entry.text);
  check('no console error while online', onlineErrors.length === 0, onlineErrors.join(' | '));

  await context.close();
} catch (error) {
  check('the run finishes without throwing', false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
  server.close();
}

console.log('');
if (failures.length === 0) {
  console.log('verify:offline: ' + checks + ' checks passed.');
} else {
  console.log('verify:offline: ' + failures.length + ' of ' + checks + ' checks failed:');
  for (const failure of failures) console.log('  - ' + failure);
  process.exitCode = 1;
}
