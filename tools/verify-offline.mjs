// @ts-check
/**
 * The offline gate: the deployed shape, in a browser that behaves like an iPhone. Dev-only.
 * Run: npm run verify:offline
 *
 * Serves the parent directory, so the app loads under /itadict/ exactly as it deploys. Check
 * docs/verification/gate-2.md for what this cannot prove: the safe areas, the home-screen install,
 * the status bar, the voices, the swipe and the eviction.
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
  await deepContext.close();

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
