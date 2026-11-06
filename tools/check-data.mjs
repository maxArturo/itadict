#!/usr/bin/env node
/**
 * Structural gate for data/ - dev only, never shipped.
 *
 * It fails loud on: a missing or malformed manifest, a file missing from the
 * manifest or not listed in it, a wrong byte count or hash, a file over 1 MB, a
 * total over 150 MB, an entry without word or POS, an empty sense list, an entry
 * that ships a "form of" gloss (a bare form), a malformed id, an id that does not
 * match its position, a form index target that is not a shipped entry, an example
 * position with no sentence, sentence text inside an entry, a shipped headword on
 * the copyright exclusion list, and a missing licence line.
 *
 * It never judges Italian and never re-derives the data.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const MAX_FILE = 1_000_000;
const MAX_TOTAL = 150_000_000;
const MAX_ERRORS = 100;

const BANDS = new Set(['a1', 'a2', 'b1', 'b2', 'c1', 'c2']);
const SETS = ['search', 'entry', 'ex', 'forms'];
const DIRS = { search: '', entry: 'entry/', ex: 'ex/', forms: 'forms/' };
const LICENCES = ['CC BY-SA 4.0', 'CC BY 2.0 FR'];
const ID = /^([a-z0-9_]+):(\d+)$/;
/** What an inflected-form gloss looks like in the source. Such a gloss never ships. */
const BARE_FORM = [
  /^(?:prima|seconda|terza) persona\s+(?:singolare|plurale)/i,
  /^(?:1|2|3)(?:ª|a)\s+persona/i,
  /^(?:femminile|maschile)\b/i,
  /^(?:plurale|singolare)\s+di\b/i,
  /^(?:participio|gerundio|infinito)\b.*\bdi\b/i,
];

const errors = [];
const fail = (message) => {
  if (errors.length < MAX_ERRORS) errors.push(message);
  else if (errors.length === MAX_ERRORS) errors.push('... further errors suppressed');
};

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const foldWord = (word) => String(word).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/');

async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function readJson(file) {
  const label = relative(file);
  const text = await readText(file);
  if (text === null) {
    fail(label + ': is missing');
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(label + ': is not valid JSON (' + err.message + ')');
    return null;
  }
}

async function listDataFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listDataFiles(target)));
    else if (entry.name.endsWith('.json')) out.push(relative(target));
  }
  return out;
}

function checkManifest(manifest) {
  if (!isText(manifest.version)) fail('index.json: "version" must be a non-empty string');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.built ?? '')) fail('index.json: "built" must be YYYY-MM-DD');
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) fail('index.json: "sources" must be a non-empty array');
  else for (const source of manifest.sources) {
    if (!isText(source?.url) || !isText(source?.licence)) fail('index.json: every source needs "url" and "licence"');
  }
  if (!Array.isArray(manifest.persons) || manifest.persons.length !== 6) fail('index.json: "persons" must list the six person labels');
  if (!isObject(manifest.buckets) || Object.keys(manifest.buckets).length === 0) fail('index.json: "buckets" must be a non-empty object');
  for (const field of ['entries', 'forms', 'examples', 'bytes']) {
    if (!Number.isInteger(manifest.totals?.[field])) fail('index.json: totals.' + field + ' must be an integer');
  }
}

async function checkLicences() {
  const notice = (await readText(path.join(ROOT, 'NOTICE'))) ?? '';
  const dataLicence = (await readText(path.join(DATA, 'LICENSE-DATA.md'))) ?? '';
  if (!notice) fail('NOTICE: is missing');
  if (!dataLicence) fail('data/LICENSE-DATA.md: is missing');
  for (const licence of LICENCES) {
    if (!notice.includes(licence)) fail('NOTICE: misses the licence line "' + licence + '"');
    if (!dataLicence.includes(licence)) fail('data/LICENSE-DATA.md: misses the licence line "' + licence + '"');
  }
}

function checkBuckets(manifest) {
  const listed = new Map();
  for (const [key, bucket] of Object.entries(manifest.buckets)) {
    let members = 0;
    for (const set of SETS) {
      const files = bucket?.[set];
      if (!Array.isArray(files)) {
        fail('index.json: bucket "' + key + '" ' + set + ' must be an array of files');
        continue;
      }
      members += files.length;
      for (const file of files) {
        const rel = file?.path;
        if (!isText(rel) || !/^data\/(?:[a-z0-9_]+\/){0,2}[a-z0-9_]+\.json$/.test(rel)) {
          fail('index.json: bucket "' + key + '" ' + set + ' has a bad path ' + JSON.stringify(rel));
          continue;
        }
        if (DIRS[set] && !rel.startsWith('data/' + DIRS[set])) fail('index.json: ' + rel + ' is not in data/' + DIRS[set]);
        if (!path.basename(rel, '.json').startsWith(key)) fail('index.json: ' + rel + ' does not start with its bucket key "' + key + '"');
        if (!Number.isInteger(file.bytes) || file.bytes < 0) fail('index.json: ' + rel + ' has no byte count');
        if (!/^[0-9a-f]{8}$/.test(file.hash ?? '')) fail('index.json: ' + rel + ' has no 8-hex hash');
        if (listed.has(rel)) fail('index.json: ' + rel + ' is listed twice');
        listed.set(rel, file);
      }
    }
    if (members === 0) fail('index.json: bucket "' + key + '" lists no file');
  }
  return listed;
}

/** The CEFR deck files join the same on-disk set as the bucket files. */
function checkCefrFiles(manifest, listed) {
  if (!isObject(manifest.cefr)) return;
  for (const [band, files] of Object.entries(manifest.cefr)) {
    if (!Array.isArray(files)) continue;
    for (const file of files) {
      const rel = file?.path;
      if (!isText(rel) || !/^data\/cefr\/[a-z0-9-]+\.json$/.test(rel)) {
        fail('index.json: cefr.' + band + ' has a bad path ' + JSON.stringify(rel));
        continue;
      }
      if (!Number.isInteger(file.bytes) || file.bytes <= 3) fail('index.json: ' + rel + ' has no byte count or is empty');
      if (!/^[0-9a-f]{8}$/.test(file.hash ?? '')) fail('index.json: ' + rel + ' has no 8-hex hash');
      if (listed.has(rel)) fail('index.json: ' + rel + ' is listed twice');
      listed.set(rel, file);
    }
  }
}

async function checkFiles(listed) {
  let total = 0;
  for (const rel of await listDataFiles(DATA)) {
    if (rel === 'data/index.json') continue;
    if (!listed.has(rel)) fail(rel + ': is on disk but not in index.json');
  }
  for (const [rel, file] of listed) {
    const absolute = path.join(ROOT, rel);
    let info;
    try {
      info = await stat(absolute);
    } catch {
      fail(rel + ': is listed in index.json but missing on disk');
      continue;
    }
    total += info.size;
    if (info.size > MAX_FILE) fail(rel + ': ' + info.size + ' bytes, over the 1 MB limit');
    if (info.size <= 3) fail(rel + ': is listed but holds no record');
    if (info.size !== file.bytes) fail(rel + ': ' + info.size + ' bytes on disk, ' + file.bytes + ' in index.json');
    const text = await readText(absolute);
    if (text === null) continue;
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 8);
    if (hash !== file.hash) fail(rel + ': hash ' + hash + ' does not match index.json ' + file.hash);
  }
  const index = await stat(path.join(DATA, 'index.json')).catch(() => null);
  if (index) total += index.size;
  if (total > MAX_TOTAL) fail('data/ is ' + total + ' bytes, over the 150 MB limit');
  return total;
}

/** The file the app would pick for a key: the longest listed prefix it starts with. */
function pickFile(files, key) {
  /** @type {any} */
  let best = null;
  let length = 0;
  for (const file of files) {
    const prefix = path.basename(file.path, '.json');
    if (prefix.length > length && key.startsWith(prefix)) {
      best = file;
      length = prefix.length;
    }
  }
  return best;
}

/** Entries and sentences first: the other two sets refer to them. */
async function checkBodies(manifest, exclusions, byId) {
  let entryCount = 0;
  let sentenceCount = 0;
  for (const [key, bucket] of Object.entries(manifest.buckets)) {
    /** @type {Map<string, string[]>} */
    const sentences = new Map();
    for (const file of bucket.ex) {
      const list = await readJson(path.join(ROOT, file.path));
      if (!Array.isArray(list)) {
        fail(file.path + ': must be a JSON array of [id, text]');
        continue;
      }
      if (list.length === 0) fail(file.path + ': is listed but holds no sentence');
      /** @type {string[]} */
      const rows = [];
      list.forEach((row, index) => {
        if (!Array.isArray(row) || row.length !== 2) return fail(file.path + ': row ' + index + ' must be [id, text]');
        const [id, text] = row;
        if (!isText(id) || !/^\d+$/.test(id)) fail(file.path + ': row ' + index + ' has a bad Tatoeba id');
        if (!isText(text)) fail(file.path + ': sentence ' + id + ' has no text');
        else if (text.length > 120) fail(file.path + ': sentence ' + id + ' is longer than 120 characters');
        if (rows[index] !== undefined) fail(file.path + ': row ' + index + ' is listed twice');
        rows[index] = text;
      });
      sentences.set(path.basename(file.path, '.json'), rows);
      sentenceCount += list.length;
    }

    for (const file of bucket.entry) {
      const entries = await readJson(path.join(ROOT, file.path));
      if (!Array.isArray(entries)) {
        fail(file.path + ': must be a JSON array');
        continue;
      }
      if (entries.length === 0) fail(file.path + ': is listed but holds no entry');
      const prefix = path.basename(file.path, '.json');
      const sibling = sentences.get(prefix);
      entries.forEach((entry, index) => {
        entryCount += 1;
        if (!isObject(entry)) return fail(file.path + ': entry ' + index + ' must be an object');
        const where = file.path + ': entry "' + entry.word + '"';
        if (!isText(entry.word)) fail(file.path + ': entry ' + index + ' has no "word"');
        if (!isText(entry.ipa) && entry.ipa !== undefined) fail(where + ' has a bad "ipa"');
        if ((String(entry.ipa ?? '').match(/\/[^/]*\//g) ?? []).length > 1) fail(where + ' has more than one IPA value');
        if (!BANDS.has(entry.cefr)) fail(where + ' has no CEFR band');
        if (!Array.isArray(entry.pos) || entry.pos.length === 0) return fail(where + ' has no POS groups');
        for (const group of entry.pos) {
          if (!isText(group?.pos)) fail(where + ' has a POS group without "pos"');
          if (!Array.isArray(group?.senses) || group.senses.length === 0) {
            fail(where + ' has an empty sense list');
            continue;
          }
          for (const sense of group.senses) {
            if (!isText(sense)) fail(where + ' has an empty sense');
            else if (BARE_FORM.some((pattern) => pattern.test(sense))) fail(where + ' ships a bare form gloss: ' + sense);
          }
        }
        const match = ID.exec(entry.id ?? '');
        if (!match) fail(where + ' has a malformed id ' + JSON.stringify(entry.id));
        else {
          if (match[1] !== prefix) fail(where + ' has id ' + entry.id + ' but lives in ' + prefix);
          if (Number(match[2]) !== index) fail(where + ' has id ' + entry.id + ' at position ' + index);
        }
        if (byId.has(entry.id)) fail(where + ' has a duplicate id ' + entry.id);
        byId.set(entry.id, entry);
        if (entry.ex !== undefined) {
          if (!Array.isArray(entry.ex)) fail(where + ' has a bad "ex"');
          else for (const position of entry.ex) {
            if (!Number.isInteger(position)) fail(where + ' has a non-integer example position');
            else if (sibling === undefined) fail(where + ': example position ' + position + ' has no sentence file');
            else if (sibling[position] === undefined) fail(where + ': example position ' + position + ' has no sentence');
          }
        }
        if (entry.conj !== undefined) {
          if (!Array.isArray(entry.conj) || entry.conj.length === 0) fail(where + ' has a bad "conj"');
          else for (const group of entry.conj) {
            if (!isText(group?.key) || typeof group?.personal !== 'boolean' || !Array.isArray(group?.forms)) {
              fail(where + ' has a malformed conjugation group');
              continue;
            }
            if (group.personal && group.forms.length !== 6) fail(where + ': "' + group.key + '" must have six person slots');
            for (const form of group.forms) if (form !== null && !isText(form)) fail(where + ': "' + group.key + '" has an empty form');
          }
        }
        if (exclusions.has(foldWord(entry.word))) fail(where + ' is on the copyright exclusion list');
      });
    }
  }
  return { entryCount, sentenceCount };
}

/**
 * The CEFR decks: one array per band, every id a shipped entry, every file listed.
 * @param {any} manifest
 * @param {Map<string, any>} byId
 */
async function checkCefr(manifest, byId) {
  const cefr = manifest.cefr;
  if (!isObject(cefr)) return void fail('index.json: "cefr" must list one deck file set per band');
  /** @type {Set<string>} */
  const listed = new Set();
  for (const [band, files] of Object.entries(cefr)) {
    if (!BANDS.has(band)) fail('index.json: "cefr" names an unknown band "' + band + '"');
    if (!Array.isArray(files)) {
      fail('index.json: cefr.' + band + ' must be an array of files');
      continue;
    }
    for (const file of files) {
      listed.add(file.path);
      for (const row of (await readJson(path.join(ROOT, file.path))) ?? []) {
        if (!Array.isArray(row) || row.length !== 4) {
          fail(file.path + ': every deck row must be [id, word, pos, gloss]');
          continue;
        }
        const [id, word, pos, gloss] = row;
        const entry = byId.get(id);
        if (!entry) fail(file.path + ': deck row points at unknown entry ' + id);
        else if (entry.word !== word) fail(file.path + ': deck row ' + word + ' does not match entry ' + id);
        if (!isText(pos)) fail(file.path + ': deck row ' + word + ' has no pos');
        if (!isText(gloss)) fail(file.path + ': deck row ' + word + ' has no gloss');
      }
    }
  }
  for (const band of BANDS) if (!(band in cefr)) fail('index.json: cefr misses the band ' + band);
  for (const rel of await listDataFiles(path.join(DATA, 'cefr'))) {
    if (!listed.has(rel)) fail(rel + ': is on disk but not listed under cefr in index.json');
  }
}

async function checkIndexes(manifest, byId) {
  let formRows = 0;
  let searchRows = 0;
  for (const bucket of Object.values(manifest.buckets)) {
    for (const file of bucket.search) {
      const rows = await readJson(path.join(ROOT, file.path));
      if (!Array.isArray(rows)) {
        fail(file.path + ': must be a JSON array');
        continue;
      }
      if (rows.length === 0) fail(file.path + ': is listed but holds no row');
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== 6) {
          fail(file.path + ': every search row must have 6 fields');
          continue;
        }
        const [folded, id, word, ipa, pos, gloss] = row;
        const entry = byId.get(id);
        if (!entry) {
          fail(file.path + ': search row points at unknown id ' + id);
          continue;
        }
        if (folded !== foldWord(word)) fail(file.path + ': search row ' + word + ' has a wrong folded key');
        if (word !== entry.word) fail(file.path + ': search row word ' + word + ' does not match entry ' + entry.word);
        if ((entry.ipa ?? '') !== (ipa ?? '')) fail(file.path + ': search row ' + word + ' has a different pronunciation than its entry');
        if (!entry.pos.some((group) => group.pos === pos)) fail(file.path + ': search row ' + word + ' has POS ' + pos + ' that the entry does not carry');
        if (!isText(gloss)) fail(file.path + ': search row ' + word + ' has an empty gloss');
        const picked = pickFile(bucket.search, foldWord(word));
        if (picked !== null && picked.path !== file.path) fail(file.path + ': search row ' + word + ' belongs in ' + picked.path);
        searchRows += 1;
      }
    }
    for (const file of bucket.forms) {
      const forms = await readJson(path.join(ROOT, file.path));
      if (!isObject(forms)) {
        fail(file.path + ': must be a JSON object of form -> lemma');
        continue;
      }
      if (Object.keys(forms).length === 0) fail(file.path + ': is listed but holds no form');
      const prefix = path.basename(file.path, '.json');
      for (const [form, claim] of Object.entries(forms)) {
        formRows += 1;
        if (!isText(claim?.id) || !isText(claim?.lemma) || !isText(claim?.label)) {
          fail(file.path + ': form "' + form + '" needs an id, a lemma and a label');
          continue;
        }
        const entry = byId.get(claim.id);
        if (!entry) fail(file.path + ': form "' + form + '" points at unknown entry ' + claim.id);
        else if (entry.word !== claim.lemma) fail(file.path + ': form "' + form + '" says lemma "' + claim.lemma + '" but ' + claim.id + ' is "' + entry.word + '"');
        if (!foldWord(form).replace(/[^a-z0-9]/g, '').startsWith(prefix)) fail(file.path + ': form "' + form + '" is in the wrong bucket');
        const picked = pickFile(bucket.forms, foldWord(form));
        if (picked !== null && picked.path !== file.path) fail(file.path + ': form "' + form + '" belongs in ' + picked.path);
      }
    }
  }
  return { formRows, searchRows };
}

async function main() {
  const manifest = await readJson(path.join(DATA, 'index.json'));
  if (!isObject(manifest)) {
    fail('data/index.json: is missing or not an object');
    return report({});
  }
  checkManifest(manifest);
  await checkLicences();
  const listed = await checkBuckets(manifest);
  checkCefrFiles(manifest, listed);
  const bytes = await checkFiles(listed);
  const exclusions = new Set(((await readJson(path.join(ROOT, 'tools', 'data-exclusions.json')))?.titles ?? []).map(foldWord));
  const byId = new Map();
  const { entryCount, sentenceCount } = await checkBodies(manifest, exclusions, byId);
  await checkCefr(manifest, byId);
  const { formRows, searchRows } = await checkIndexes(manifest, byId);
  if (manifest.totals?.entries !== entryCount) fail('index.json: totals.entries is ' + manifest.totals?.entries + ', counted ' + entryCount);
  if (manifest.totals?.forms !== formRows) fail('index.json: totals.forms is ' + manifest.totals?.forms + ', counted ' + formRows);
  if (manifest.totals?.examples !== sentenceCount) fail('index.json: totals.examples is ' + manifest.totals?.examples + ', counted ' + sentenceCount);
  if (searchRows !== entryCount) fail('there are ' + searchRows + ' search rows for ' + entryCount + ' entries');
  const split = Object.values(manifest.buckets).some((bucket) => SETS.some((set) => bucket[set].length > 1));
  if (!split) fail('no bucket lists more than one file: the longest-prefix rule is never exercised');
  return report({ bytes, entryCount, formRows, sentenceCount, buckets: Object.keys(manifest.buckets ?? {}).length });
}

function report(stats) {
  for (const error of errors) console.error('error: ' + error);
  if (errors.length > 0) {
    console.error('\ncheck-data failed: ' + errors.length + ' error(s).');
    process.exitCode = 1;
    return;
  }
  console.log(
    'check-data passed: ' + stats.entryCount + ' entries, ' + stats.formRows + ' forms, ' +
    stats.sentenceCount + ' sentences, ' + stats.buckets + ' buckets, ' + stats.bytes + ' bytes.',
  );
}

main().catch((err) => {
  console.error('check-data crashed:', err);
  process.exitCode = 1;
});
