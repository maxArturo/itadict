#!/usr/bin/env node
/**
 * Build data/ for itadict.
 *
 * One bucket key everywhere: fold to lowercase, strip diacritics, take the first
 * two letters or digits. Four sets share the key:
 *
 *   data/<bucket>.json         search rows  [folded, id, word, ipa, pos, gloss]
 *   data/entry/<bucket>.json   entry bodies, one per headword
 *   data/ex/<bucket>.json      Tatoeba sentences: [ [id, text] ]
 *   data/forms/<bucket>.json   folded form -> { id, lemma, label }
 *   data/index.json            manifest, the one file the app reads first
 *
 * An entry id is "<file>:<position>", for example "ca:42". The id carries its own
 * file, so a cold deep link needs one fetch. File is the entry file basename, two
 * letters normally, three when a bucket split.
 *
 * A bucket that grows past 1 MB splits on one more folded character
 * (data/entry/ca/cao.json). Same input, same bytes: "built" comes from the source
 * files, never from the clock.
 *
 * Usage
 *   node tools/build-data.mjs                 # full build
 *   node tools/build-data.mjs --limit 2000    # fixture: the 2000 most frequent headwords
 *   node tools/build-data.mjs --no-download   # fail instead of downloading
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const DATA = path.join(ROOT, 'data');
const EXCLUSIONS = path.join(ROOT, 'tools', 'data-exclusions.json');

/** 1 MB means 1,000,000 bytes. The gate checks the same numbers. */
const MAX_FILE = 1_000_000;
/** Entry and form files split at 250 KB: one cold tap must not pull a whole fat bucket. */
const ENTRY_CAP = 250_000;
const FORM_CAP = 250_000;

/** English glosses: three per part of speech, each as short as an Italian sense. */
const MAX_EN_GLOSSES = 3;

/**
 * The en.wiktionary part-of-speech names this app joins on, mapped to ours. Every name not
 * listed here is reported and not joined: an Italian entry never carries those pos values.
 */
const POS_MAP = new Map([
  ['verb', 'verb'],
  ['noun', 'noun'],
  ['adj', 'adj'],
  ['adv', 'adv'],
  ['adv_phrase', 'adv_phrase'],
  ['name', 'name'],
  ['phrase', 'phrase'],
  ['prep', 'prep'],
  ['prep_phrase', 'prep_phrase'],
  ['pron', 'pron'],
  ['conj', 'conj'],
  ['intj', 'intj'],
  ['prefix', 'prefix'],
  ['suffix', 'suffix'],
  ['abbrev', 'abbrev'],
  ['article', 'article'],
  ['num', 'num'],
  ['symbol', 'symbol'],
  ['character', 'character'],
  ['affix', 'affix'],
  ['particle', 'particle'],
]);
const MAX_SENSES = 4;
const MAX_GLOSS = 200;
const MAX_LABEL = 60;
const MAX_EXAMPLE = 120;
const MAX_EXAMPLES = 3;
const MAX_PREFIX = 4;

const SETS = [['search', ''], ['entry', 'entry/'], ['ex', 'ex/'], ['forms', 'forms/'], ['en', 'en/']];
const DIR_OF = new Map(SETS);

/** CEFR bands by rank in the FrequencyWords Italian 50k list. */
const BANDS = [[1000, 'a1'], [2000, 'a2'], [5000, 'b1'], [10000, 'b2'], [25000, 'c1']];
const BAND_ORDER = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];

const MOODS = ['indicativo', 'congiuntivo', 'condizionale', 'imperativo', 'infinito', 'gerundio', 'participio'];
const TENSES = ['passato remoto', 'passato prossimo', 'presente', 'imperfetto', 'futuro', 'passato'];
const PERSON_INDEX = { io: 0, tu: 1, 'lui/lei': 2, noi: 3, voi: 4, 'essi/esse': 5 };
const PERSON_LABELS = ['io', 'tu', 'lui/lei', 'noi', 'voi', 'loro'];
const IMPERSONAL = new Set(['gerundio', 'participio', 'infinito']);

/** The order the entry screen draws. Unknown groups come after, alphabetically. */
const CONJ_ORDER = [
  ['indicativo', 'presente'],
  ['indicativo', 'imperfetto'],
  ['indicativo', 'futuro'],
  ['condizionale', 'presente'],
  ['congiuntivo', 'presente'],
  ['congiuntivo', 'imperfetto'],
  ['indicativo', 'passato remoto'],
  ['imperativo', ''],
  ['gerundio', ''],
  ['participio', 'passato'],
  ['participio', 'presente'],
];

const SOURCES = [
  {
    name: 'it.wiktionary via kaikki.org',
    url: 'https://kaikki.org/itwiktionary/Italiano/kaikki.org-dictionary-Italiano.jsonl',
    file: 'kaikki.org-dictionary-Italiano.jsonl',
    licence: 'CC BY-SA 4.0',
  },
  {
    name: 'English Wiktionary Italian entries via kaikki.org',
    url: 'https://kaikki.org/dictionary/Italian/kaikki.org-dictionary-Italian.jsonl',
    file: 'kaikki.org-dictionary-Italian.jsonl',
    licence: 'CC BY-SA 4.0',
  },
  {
    name: 'Tatoeba Italian sentences',
    url: 'https://downloads.tatoeba.org/exports/per_language/ita/ita_sentences.tsv.bz2',
    file: 'ita_sentences.tsv.bz2',
    licence: 'CC BY 2.0 FR',
  },
  {
    name: 'FrequencyWords Italian 50k (Hermit Dave)',
    url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/it/it_50k.txt',
    file: 'it_50k.txt',
    licence: 'CC BY-SA 4.0',
  },
];

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
  const opts = { limit: 0, download: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit') opts.limit = Number(argv[(i += 1)]);
    else if (arg.startsWith('--limit=')) opts.limit = Number(arg.slice('--limit='.length));
    else if (arg === '--no-download') opts.download = false;
    else throw new Error('unknown argument: ' + arg);
  }
  if (!Number.isInteger(opts.limit) || opts.limit < 0) throw new Error('--limit needs a whole number');
  return opts;
}

/* --------------------------------------------------------------- sources */

async function sizeOf(file) {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

async function fetchToFile(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

function curlToFile(url, file) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['-sSL', '--retry', '2', '--connect-timeout', '30', '-o', file, url], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('curl exited ' + code))));
  });
}

async function ensureSource(source, download) {
  const target = path.join(CACHE, source.file);
  if ((await sizeOf(target)) > 0) return target;
  if (!download) throw new Error(source.file + ' is not in .cache and --no-download is set');
  await mkdir(CACHE, { recursive: true });
  const part = target + '.part';
  console.log('downloading ' + source.url);
  let last = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await fetchToFile(source.url, part);
      await rename(part, target);
      console.log('downloaded ' + source.file + ': ' + (await sizeOf(target)) + ' bytes');
      return target;
    } catch (err) {
      last = err.cause?.code ?? err.message;
      await rm(part, { force: true });
      // Node's fetch times out on kaikki.org from some networks; curl does not.
      try {
        await curlToFile(source.url, part);
        await rename(part, target);
        console.log('downloaded ' + source.file + ': ' + (await sizeOf(target)) + ' bytes');
        return target;
      } catch (curlErr) {
        last = curlErr.message;
        await rm(part, { force: true });
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw new Error('download failed for ' + source.url + ': ' + last);
}

/* ---------------------------------------------------------------- corpus */

const WORD = /[\p{L}\p{N}]+/gu;

function tokensOf(text) {
  return text.toLowerCase().match(WORD) ?? [];
}

async function* corpusLines(file) {
  const child = spawn('bzip2', ['-dc', file], { stdio: ['ignore', 'pipe', 'inherit'] });
  const closed = new Promise((resolve) => child.on('close', resolve));
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const first = line.indexOf('\t');
      const second = line.indexOf('\t', first + 1);
      if (first < 0 || second < 0) continue;
      yield { id: line.slice(0, first), text: line.slice(second + 1) };
    }
  } finally {
    lines.close();
    if (child.exitCode === null) child.kill();
  }
  const code = await closed;
  if (code !== 0 && code !== null) throw new Error('bzip2 exited with ' + code);
}

async function countCorpus(file) {
  const counts = new Map();
  let sentences = 0;
  let tokens = 0;
  for await (const { text } of corpusLines(file)) {
    sentences += 1;
    for (const word of tokensOf(text)) {
      tokens += 1;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return { counts, sentences, tokens };
}

/** Rank of each word in the 50k list, 1 = most frequent. */
async function readFrequency(file) {
  const rank = new Map();
  let index = 0;
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    const word = line.slice(0, line.indexOf(' '));
    if (!word) continue;
    index += 1;
    const key = foldWord(word);
    if (!rank.has(key)) rank.set(key, index);
  }
  return rank;
}

function bandOf(rank) {
  if (!rank) return 'c2';
  for (const [limit, band] of BANDS) if (rank <= limit) return band;
  return 'c2';
}

/* ------------------------------------------------------------------ text */

function foldWord(word) {
  return String(word).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

function prefixKey(text, length) {
  const folded = foldWord(text).replace(/[^a-z0-9]/g, '');
  return folded.slice(0, length) || '_';
}

function filePath(dir, key) {
  return dir + (key.length <= 2 ? key + '.json' : key.slice(0, 2) + '/' + key + '.json');
}

const WIKI_NOISE = /\((?:\s*(?:approfondimento|citazioni?|senza fonte|immagine|foto|audio|video)\s*)\)/gi;
/** Trailing grammar tags the source leaves in a gloss: "casa f sing". */
const GRAMMAR_TAIL = /(?:\s+(?:m|f|mf|sing|pl|inv|loc|dim|accr|pegg|fig|raro|lett|pop|volg|ecc)\.?)+$/i;

function truncate(text, max) {
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:]$/, '') + '\u2026';
}

function cleanGloss(raw, word) {
  const text = String(raw ?? '')
    .replace(WIKI_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 2) return '';
  if (/^definizione mancante/i.test(text)) return '';
  if (text.replace(GRAMMAR_TAIL, '').toLowerCase() === word.toLowerCase()) return '';
  // The source sometimes describes an adjective by its participle ("participio
  // passato di suonare"). That is a form gloss, not a definition.
  if (FORM_GLOSS.some((pattern) => pattern.test(text))) return '';
  return text.length > MAX_GLOSS ? truncate(text, MAX_GLOSS) : text;
}

/** The source sometimes glues two values: "/kasaˈlese//kasaˈleze/". Keep the first. */
function oneIpa(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/\/[^/]*\//);
  return match ? match[0] : text;
}

/** One pronunciation, used by the row and the entry alike. */
function pickIpa(sounds) {
  const candidates = (sounds ?? []).filter((sound) => typeof sound.ipa === 'string' && oneIpa(sound.ipa) !== '');
  const standard = candidates.find(
    (sound) => /standard/i.test(sound.sense ?? '') || (sound.raw_tags ?? []).some((tag) => /standard/i.test(tag)),
  );
  return { preferred: standard ? oneIpa(standard.ipa) : '', any: candidates.length ? oneIpa(candidates[0].ipa) : '' };
}

/** "prima persona singolare dell'indicativo presente" -> mood, tense, person index. */
function describe(sourceText) {
  const text = String(sourceText ?? '').toLowerCase();
  const mood = MOODS.find((name) => text.includes(name));
  if (!mood) return { mood: '', tense: '', person: -1, base: -1, rank: 900 };
  const tense = TENSES.find((name) => text.includes(name)) ?? '';
  const ordinal = text.match(/(?:^|\s)(1|2|3)(?:ª|a|\.)?\s*persona/);
  const personWord = ordinal
    ? PERSON_LABELS[Number(ordinal[1]) - 1]
    : text.includes('prima persona')
      ? 'io'
      : text.includes('seconda persona')
        ? 'tu'
        : text.includes('terza persona')
          ? 'lui/lei'
          : '';
  const plural = /plurale/.test(text);
  const singular = /singolare/.test(text);
  const base = personWord ? PERSON_INDEX[personWord] : -1;
  let person = -1;
  if (base >= 0 && (plural || singular)) person = singular ? base : base + 3;
  const rank = MOODS.indexOf(mood) * 100 + Math.max(TENSES.indexOf(tense), -1) * 10 + (person >= 0 ? person : 9);
  return { mood, tense, person, base, rank };
}

/**
 * A form record names its lemma three ways: a "form_of" field, a "form-of" tag,
 * or only a gloss ("femminile plurale di alpino"). All three are form records.
 */
const FORM_GLOSS = [
  /^(?:prima|seconda|terza) persona\s+(?:singolare|plurale)\b/i,
  /^(?:femminile|maschile)\b[^.]*di\b/i,
  /^(?:plurale|singolare)\s+di\b/i,
  /^(?:participio|gerundio|infinito)\b[^.]*\bdi\b/i,
];

function formOfLemma(sense) {
  const named = sense.form_of?.[0]?.word;
  const gloss = (sense.glosses?.[0] ?? '').trim();
  const tagged = (sense.tags ?? []).includes('form-of');
  if (!named && !tagged && !FORM_GLOSS.some((pattern) => pattern.test(gloss))) return { isForm: false, lemma: '' };
  const at = gloss.lastIndexOf(' di ');
  return { isForm: true, lemma: named ?? (at < 0 ? '' : gloss.slice(at + 4).trim()) };
}

/** "plurale di Cosa, vedi Coso" -> "plurale". This is the source's own wording. */
function formOfText(gloss, lemma) {
  const text = String(gloss ?? '').replace(/\s+/g, ' ').trim();
  const suffix = ' di ' + lemma;
  const label = text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
  return label.length > MAX_LABEL ? truncate(label, MAX_LABEL) : label;
}

/* ------------------------------------------------------------- dictionary */

/**
 * One pass over the JSONL. Records whose senses are all "form of" become form
 * index claims. The rest are lemma records, merged into one entry per headword
 * (lowercase spelling, not accent-folded: "si" and "sì" are different words),
 * with one POS group per part of speech.
 */
/**
 * The tokens of the English index: fold with NFD, strip marks, lowercase, split on non-letters.
 * @param {string} text
 * @returns {string[]}
 */
function englishTokens(text) {
  return String(text).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * A trailing Wiktionary sense marker that carries no meaning: "(all senses)", "(sense 1)".
 * A qualifier that does carry meaning, like "(figuratively)" or "(idiomatic)", stays.
 */
const SENSE_MARKER = /\s*\(\s*(?:all senses|sense\s+\d+)\s*\)\s*$/i;

/** An English gloss: sense markers stripped, whitespace collapsed, capped like a sense. */
function cleanEnglish(raw) {
  let text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  while (SENSE_MARKER.test(text)) text = text.replace(SENSE_MARKER, '').trim();
  if (text === '') return '';
  return text.length > MAX_GLOSS ? truncate(text, MAX_GLOSS) : text;
}

/**
 * Read the en.wiktionary Italian extract once. It keeps word, pos and the senses' glosses and
 * nothing else: three short English glosses per headword and part of speech.
 *
 * @param {string} file
 * @param {Map<string, number>} unmapped en pos names this app cannot join
 * @returns {Promise<Map<string, Map<string, string[]>>>} lowercase headword -> pos -> glosses
 */
async function readEnglish(file, unmapped) {
  /** @type {Map<string, Map<string, string[]>>} */
  const byWord = new Map();
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (raw.lang_code !== undefined && raw.lang_code !== 'it') continue;
    if (typeof raw.word !== 'string' || raw.word === '' || typeof raw.pos !== 'string') continue;
    const pos = POS_MAP.get(raw.pos);
    if (pos === undefined) {
      unmapped.set(raw.pos, (unmapped.get(raw.pos) ?? 0) + 1);
      continue;
    }
    const key = raw.word.toLowerCase();
    let groups = byWord.get(key);
    if (groups === undefined) byWord.set(key, (groups = new Map()));
    let glosses = groups.get(pos);
    if (glosses === undefined) groups.set(pos, (glosses = []));
    if (glosses.length >= MAX_EN_GLOSSES) continue;
    for (const sense of raw.senses ?? []) {
      for (const text of sense.glosses ?? []) {
        if (glosses.length >= MAX_EN_GLOSSES) break;
        const gloss = cleanEnglish(text);
        if (gloss !== '' && !glosses.includes(gloss)) glosses.push(gloss);
      }
    }
  }
  return byWord;
}

/**
 * Person hints from the source verb tables. That field is partial and noisy, so
 * it never adds a form; it only tells which person an already attested form
 * belongs to, where the form record's gloss omits the number.
 */
async function readPersonHints(file) {
  const hints = new Map();
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (raw.pos !== 'verb' || !Array.isArray(raw.forms)) continue;
    for (const form of raw.forms) {
      if (!form?.form || /[\s()]/.test(form.form)) continue;
      const tags = new Set(form.tags ?? []);
      const rawPerson = String((form.raw_tags ?? [])[0] ?? '').replace(/che\s+/g, '');
      const tagBase = tags.has('first-person') ? 0 : tags.has('second-person') ? 1 : tags.has('third-person') ? 2 : -1;
      const plural = tags.has('plural');
      const person = PERSON_INDEX[rawPerson] ?? (tagBase < 0 || (!plural && !tags.has('singular')) ? -1 : plural ? tagBase + 3 : tagBase);
      if (person < 0) continue;
      const key = foldWord(form.form);
      if (!hints.has(key)) hints.set(key, person);
    }
  }
  return hints;
}

async function readDictionary(file, hints) {
  const entries = new Map();
  const forms = new Map();
  const slots = new Map();
  const stats = { lines: 0, lemmaRecords: 0, formRecords: 0, lost: 0, rescued: 0, lemmaWords: new Set() };

  const claim = (word, lemma, label, info) => {
    const key = foldWord(word);
    if (!key || key === foldWord(lemma) || word.length > 40 || /[\s()]/.test(word)) return;
    if (!forms.has(key)) forms.set(key, { form: word, lemma, label, mood: info.mood, tense: info.tense, person: info.person, rank: info.rank });
  };

  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    stats.lines += 1;
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (raw.lang_code !== 'it' || typeof raw.word !== 'string' || typeof raw.pos !== 'string') continue;
    const senses = (raw.senses ?? []).map((sense) => ({ sense, ...formOfLemma(sense) }));
    const lemmaSenses = senses.filter((item) => !item.isForm).map((item) => item.sense);

    for (const { sense, isForm, lemma } of senses) {
      if (!isForm || !lemma) continue;
      const source = formOfText(sense.glosses?.[0], lemma);
      const info = describe(source);
      claim(raw.word, lemma, source, info);
      if (!info.mood) continue;
      // Number missing in the label: the hint wins when it agrees with the named
      // person, then singular is the safe default.
      const hint = hints.get(foldWord(raw.word));
      const person = info.person >= 0
        ? info.person
        : info.base >= 0
          ? (hint !== undefined && hint % 3 === info.base ? hint : info.base)
          : (hint ?? -1);
      if (IMPERSONAL.has(info.mood) || person >= 0) {
        const key = lemma + '\u0000' + info.mood + '\u0000' + info.tense + '\u0000' + person;
        if (!slots.has(key)) slots.set(key, raw.word);
      }
    }
    if (lemmaSenses.length === 0) {
      stats.formRecords += 1;
      continue;
    }

    stats.lemmaRecords += 1;
    stats.lemmaWords.add(raw.word);
    const key = raw.word.toLowerCase();
    let entry = entries.get(key);
    if (!entry) {
      entry = { word: raw.word, pos: [], ex: [], conj: [] };
      entries.set(key, entry);
    }
    const ipa = pickIpa(raw.sounds);
    let group = entry.pos.find((item) => item.pos === raw.pos);
    if (!group) {
      group = { pos: raw.pos, senses: [], rescue: '', ipa: '', ipaFallback: '' };
      entry.pos.push(group);
    }
    if (!group.ipa) group.ipa = ipa.preferred;
    if (!group.ipaFallback) group.ipaFallback = ipa.any;
    if (!group.rescue) group.rescue = (raw.translations ?? []).find((item) => item.sense)?.sense ?? '';
    for (const sense of lemmaSenses) {
      const gloss = cleanGloss(sense.glosses?.[0], entry.word);
      if (gloss && group.senses.length < MAX_SENSES && !group.senses.includes(gloss)) group.senses.push(gloss);
    }
  }

  for (const entry of entries.values()) {
    if (!entry.ipa) entry.ipa = entry.ipaFallback;
    delete entry.ipaFallback;
    for (const group of entry.pos) {
      if (!group.ipa) group.ipa = group.ipaFallback;
      delete group.ipaFallback;
      if (group.senses.length === 0) {
        // Last resort: the source's own sense label from its translation table.
        const gloss = cleanGloss(group.rescue, entry.word);
        if (gloss) {
          group.senses.push(gloss);
          stats.rescued += 1;
        }
      }
      delete group.rescue;
    }
    entry.pos = entry.pos.filter((group) => group.senses.length > 0);
    entry.pos.sort((a, b) => b.senses.length - a.senses.length);
    // The pronunciation of the primary POS, and only that one value.
    entry.ipa = entry.pos.find((group) => group.ipa)?.ipa ?? '';
    for (const group of entry.pos) delete group.ipa;
    if (entry.pos.length === 0) stats.lost += 1;
  }
  return { entries: [...entries.values()].filter((entry) => entry.pos.length > 0), forms, slots, stats };
}

/* --------------------------------------------------------------- writing */

const renderArray = (bodies) => '[\n' + bodies.join(',\n') + '\n]\n';
const renderObject = (bodies) => '{\n' + bodies.join(',\n') + '\n}\n';

function groupBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function entryJson(entry, id, examples) {
  const out = { id, word: entry.word };
  if (entry.ipa) out.ipa = entry.ipa;
  out.cefr = entry.cefr;
  out.pos = entry.pos;
  // No English match means no key at all, so the screen draws no section.
  if (entry.en) out.en = entry.en;
  if (examples.length) out.ex = examples;
  if (entry.conj.length) out.conj = entry.conj;
  return JSON.stringify(out);
}

/** Entry bodies, split until every file fits. The file name is the id prefix. */
function planEntryFiles(items) {
  const files = [];
  for (const [, list] of groupBy(items, (item) => prefixKey(item.key, 2))) files.push(...splitEntryList(list, 2));
  return files;
}

function splitEntryList(list, length) {
  const prefix = prefixKey(list[0].key, length);
  // A word shorter than the split prefix ("in") would take the bucket's own file name and
  // shadow every split file for a two-letter query. Such a group gets a name no query matches,
  // so the app falls back to the whole bucket instead of missing the rest of it.
  const key = prefix.length < length ? prefix + '_' : prefix;
  const body = renderArray(list.map((item, index) => entryJson(item.entry, key + ':' + index, item.entry.ex)));
  const files = [{ key, items: list, body }];
  if (Buffer.byteLength(body) <= ENTRY_CAP || length >= MAX_PREFIX) return files;
  const parts = groupBy(list, (item) => prefixKey(item.key, length + 1));
  if (parts.size === 1) return files;
  return [...parts.values()].flatMap((group) => splitEntryList(group, length + 1));
}

/** Object files (forms) split the same way, keyed by the form itself. */
function planObjectFiles(list, length, shortSuffix = true) {
  const prefix = prefixKey(list[0].key, length);
  const key = shortSuffix && prefix.length < length ? prefix + '_' : prefix;
  const body = renderObject(list.map((item) => item.body));
  if (Buffer.byteLength(body) <= FORM_CAP || length >= MAX_PREFIX) return [{ key, body }];
  const parts = groupBy(list, (item) => prefixKey(item.key, length + 1));
  if (parts.size === 1) return [{ key, body }];
  return [...parts.values()].flatMap((group) => planObjectFiles(group, length + 1));
}

/* ---------------------------------------------------------------- licence */

function licenceText() {
  return '# Data licence\n\n' +
    'The files in this directory are built by tools/build-data.mjs from three sources.\n\n' +
    '| Source | Licence | URL |\n| --- | --- | --- |\n' +
    '| it.wiktionary | CC BY-SA 4.0 | https://it.wiktionary.org/ |\n' +
    '| en.wiktionary (Italian entries) | CC BY-SA 4.0 | https://en.wiktionary.org/ |\n' +
    '| Tatoeba | CC BY 2.0 FR | https://tatoeba.org/ |\n' +
    '| FrequencyWords 50k list (Hermit Dave) | CC BY-SA 4.0 | https://github.com/hermitdave/FrequencyWords |\n\n' +
    '## Required attribution\n\n' +
    '- Italian definitions and inflected forms come from it.wiktionary, CC BY-SA 4.0.\n' +
    '  The extraction is https://kaikki.org/itwiktionary/Italiano/kaikki.org-dictionary-Italiano.jsonl\n' +
    '- English translations come from en.wiktionary, CC BY-SA 4.0.\n' +
    '  The extraction is https://kaikki.org/dictionary/Italian/kaikki.org-dictionary-Italian.jsonl\n' +
    '- Italian example sentences come from Tatoeba, CC BY 2.0 FR. Entries keep\n' +
    '  positions; every sentence in data/ex/ keeps its Tatoeba id.\n' +
    '- CEFR bands come from the FrequencyWords Italian 50k list by Hermit Dave,\n' +
    '  CC BY-SA 4.0.\n' +
    '- Derived data stays under the same licences. Changing it does not put it under\n' +
    '  a freer licence.\n\n' +
    'See NOTICE at the repository root for the full text.\n';
}

/* ------------------------------------------------------------------- main */

async function main() {
  const started = Date.now();
  const opts = parseArgs(process.argv.slice(2));
  const [jsonl, enJsonl, tsv, frequencyFile] = await Promise.all(SOURCES.map((source) => ensureSource(source, opts.download)));
  const excluded = new Set((JSON.parse(await readFile(EXCLUSIONS, 'utf8')).titles ?? []).map(foldWord));

  const corpus = await countCorpus(tsv);
  const ranks = await readFrequency(frequencyFile);
  const hints = await readPersonHints(jsonl);
  const { entries, forms, slots, stats } = await readDictionary(jsonl, hints);

  const excludedHits = entries.filter((entry) => excluded.has(foldWord(entry.word))).length;
  const kept = entries.filter((entry) => !excluded.has(foldWord(entry.word)));

  const frequency = (entry) => corpus.counts.get(entry.word.toLowerCase()) ?? 0;
  kept.sort((a, b) => {
    const delta = frequency(b) - frequency(a);
    if (delta !== 0) return delta;
    return a.word < b.word ? -1 : a.word > b.word ? 1 : 0;
  });
  const shipped = opts.limit > 0 ? kept.slice(0, opts.limit) : kept;
  for (const entry of shipped) entry.cefr = bandOf(ranks.get(foldWord(entry.word)));

  // English glosses: join on the lowercase headword and the mapped part of speech.
  const unmappedPos = new Map();
  const english = await readEnglish(enJsonl, unmappedPos);
  const perPos = new Map();
  let withEnglish = 0;
  for (const entry of shipped) {
    const groups = english.get(entry.word.toLowerCase());
    /** @type {Array<{ pos: string, glosses: string[] }>} */
    const en = [];
    for (const group of entry.pos) {
      const stat = perPos.get(group.pos) ?? { total: 0, matched: 0 };
      stat.total += 1;
      perPos.set(group.pos, stat);
      const glosses = groups?.get(group.pos);
      if (glosses !== undefined && glosses.length > 0) {
        en.push({ pos: group.pos, glosses });
        stat.matched += 1;
      }
    }
    if (en.length > 0) {
      entry.en = en;
      withEnglish += 1;
    }
  }
  const top5000 = shipped.slice(0, 5000).filter((entry) => entry.en).length;
  const lemmaWords = new Set(shipped.map((entry) => entry.word));

  // The form index only points at lemmas we ship.
  const formMisses = { unshipped: 0, unknown: 0 };
  for (const [key, claim] of forms) {
    if (lemmaWords.has(claim.lemma)) continue;
    forms.delete(key);
    if (stats.lemmaWords.has(claim.lemma)) formMisses.unshipped += 1;
    else formMisses.unknown += 1;
  }

  // Conjugation tables: from the form records, in the order the entry screen draws.
  const byLemma = new Map();
  for (const [key, form] of slots) {
    const [lemma, mood, tense, person] = key.split('\u0000');
    const list = byLemma.get(lemma);
    const claim = { form, mood, tense, person: Number(person) };
    if (list) list.push(claim);
    else byLemma.set(lemma, [claim]);
  }
  for (const entry of shipped) {
    const list = byLemma.get(entry.word);
    if (!list || !entry.pos.some((group) => group.pos === 'verb')) continue;
    entry.conj = buildConjugation(list);
  }

  // Examples: three Tatoeba sentences per headword, matched on the lowercase token.
  const headwords = new Set(shipped.map((entry) => entry.word.toLowerCase()));
  const examples = new Map();
  const textById = new Map();
  for await (const { id, text } of corpusLines(tsv)) {
    if (text.length > MAX_EXAMPLE) continue;
    const used = new Set();
    for (const token of tokensOf(text)) {
      if (used.has(token) || !headwords.has(token)) continue;
      used.add(token);
      const list = examples.get(token) ?? [];
      if (!examples.has(token)) examples.set(token, list);
      if (list.length < MAX_EXAMPLES) {
        list.push(id);
        textById.set(id, text);
      }
    }
  }
  let attachments = 0;
  for (const entry of shipped) {
    const list = examples.get(entry.word.toLowerCase());
    if (!list) continue;
    entry.ex = list;
    attachments += list.length;
  }

  await rm(DATA, { recursive: true, force: true });
  await mkdir(DATA, { recursive: true });
  await writeFile(path.join(DATA, 'LICENSE-DATA.md'), licenceText());

  // Bucket keys are always two characters. A split file keeps its longer name, but it is
  // listed under its two-character bucket, so the app finds it by longest prefix.
  const files = new Map(SETS.map(([name]) => [name, new Map()]));
  const addFile = (name, key, body) => {
    const bucket = key.slice(0, 2);
    let list = files.get(name).get(bucket);
    if (!list) files.get(name).set(bucket, (list = []));
    list.push({ key, body });
  };
  const entryFiles = planEntryFiles(shipped.map((entry) => ({ key: entry.word, entry })));
  let exampleRows = 0;

  // Ids are <file>:<position>.
  for (const file of entryFiles) {
    file.items.forEach((item, index) => {
      item.entry.id = file.key + ':' + index;
    });
  }

  // Example ids are positions in the bucket's one example file. A split would shift every
  // position after the split point, so the build fails instead of splitting. The gate
  // repeats the rule because a silent mis-index is worse than a failed build.
  const exampleSets = new Map();
  for (const file of entryFiles) {
    const bucket = file.key.slice(0, 2);
    let set = exampleSets.get(bucket);
    if (!set) exampleSets.set(bucket, (set = new Set()));
    for (const item of file.items) for (const id of item.entry.ex) set.add(id);
  }
  /** @type {Map<string, Map<string, number>>} */
  const examplePositions = new Map();
  for (const [bucket, set] of exampleSets) {
    const sentences = [...set].sort((a, b) => Number(a) - Number(b));
    examplePositions.set(bucket, new Map(sentences.map((id, index) => [id, index])));
    if (sentences.length === 0) continue;
    const body = renderArray(sentences.map((id) => JSON.stringify([id, textById.get(id)])));
    const bytes = Buffer.byteLength(body);
    if (bytes > MAX_FILE) {
      throw new Error('data/ex/' + bucket + '.json would need a split (' + bytes + ' bytes); example positions cannot survive it');
    }
    addFile('ex', bucket, body);
    exampleRows += sentences.length;
  }

  for (const file of entryFiles) {
    const positions = examplePositions.get(file.key.slice(0, 2));
    file.items.forEach((item) => {
      item.entry.ex = item.entry.ex.map((id) => positions.get(id));
    });
    const body = renderArray(file.items.map((item) => entryJson(item.entry, item.entry.id, item.entry.ex)));
    if (Buffer.byteLength(body) > MAX_FILE) throw new Error(file.key + ': entry file grew over 1 MB after ids were assigned');
    addFile('entry', file.key, body);
    addFile('search', file.key, renderArray(file.items.map((item) => {
      const entry = item.entry;
      // Seven fields: the gloss is Italian again, and the English one has its own slot.
      const en = entry.en?.[0]?.glosses[0] ?? '';
      return JSON.stringify([foldWord(entry.word), entry.id, entry.word, entry.ipa, entry.pos[0].pos, entry.pos[0].senses[0], en]);
    })));
  }

  // English lookup: folded gloss token -> entry ids, 100 postings per token, sharded by the
  // first two folded letters. The cap keeps the most frequent entries: entries are in
  // frequency order, so the first 100 postings for a token are the ones a learner meets first.
  const EN_POSTINGS = 100;
  /** @type {Map<string, string[]>} */
  const enTokens = new Map();
  let enPostings = 0;
  let enDropped = 0;
  for (const entry of shipped) {
    if (!entry.en) continue;
    /** @type {Set<string>} */
    const tokens = new Set();
    for (const group of entry.en) for (const gloss of group.glosses) for (const token of englishTokens(gloss)) tokens.add(token);
    for (const token of tokens) {
      let ids = enTokens.get(token);
      if (ids === undefined) enTokens.set(token, (ids = []));
      if (ids.length >= EN_POSTINGS) {
        enDropped += 1;
        continue;
      }
      ids.push(entry.id);
      enPostings += 1;
    }
  }
  const enItems = [...enTokens.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([token, ids]) => ({ key: token, body: JSON.stringify(token) + ':' + JSON.stringify(ids) }));
  for (const [, list] of groupBy(enItems, (item) => prefixKey(item.key, 2))) {
    // An English token is looked up exactly, never by prefix, so a one-letter token keeps its
    // plain file name ("a.json") and no suffix is needed.
    for (const file of planObjectFiles(list, 2, false)) addFile('en', file.key, file.body);
  }

  const idByWord = new Map(shipped.map((entry) => [entry.word, entry.id]));
  const formItems = [...forms.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([form, claim]) => ({
      key: form,
      body: JSON.stringify(form) + ':' + JSON.stringify({ id: idByWord.get(claim.lemma), lemma: claim.lemma, label: claim.label }),
    }));
  for (const [, list] of groupBy(formItems, (item) => prefixKey(item.key, 2))) {
    for (const file of planObjectFiles(list, 2)) addFile('forms', file.key, file.body);
  }

  // Buckets are the union of the four sets. A set with no record in a bucket lists no file.
  const buckets = new Map();
  for (const [name, byBucket] of files) {
    for (const [key, list] of byBucket) {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = Object.fromEntries(SETS.map(([set]) => [set, []]));
        buckets.set(key, bucket);
      }
      for (const file of list) {
        bucket[name].push({ path: 'data/' + filePath(DIR_OF.get(name), file.key), body: file.body });
      }
    }
  }

  const written = [];
  const setBytes = Object.fromEntries(SETS.map(([set]) => [set, 0]));
  for (const [, bucket] of buckets) {
    for (const [name] of SETS) {
      bucket[name].sort((a, b) => (a.path < b.path ? -1 : 1));
      for (const file of bucket[name]) {
        const target = path.join(ROOT, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.body);
        const bytes = Buffer.byteLength(file.body);
        if (bytes > MAX_FILE) throw new Error(file.path + ' is ' + bytes + ' bytes');
        file.bytes = bytes;
        file.hash = createHash('sha256').update(file.body).digest('hex').slice(0, 8);
        delete file.body;
        setBytes[name] += bytes;
        written.push(file);
      }
    }
  }

  // CEFR decks: one array per band, split to stay under the file cap.
  const cefr = {};
  for (const band of BAND_ORDER) {
    const rows = shipped
      .filter((entry) => entry.cefr === band)
      .map((entry) => JSON.stringify([entry.id, entry.word, entry.pos[0].pos, entry.pos[0].senses[0]]));
    /** @type {Array<{ path: string, bytes: number, hash: string }>} */
    const deckFiles = [];
    let chunk = [];
    let size = 2;
    let part = 1;
    const flush = async () => {
      const name = part === 1 ? band + '.json' : band + '-' + part + '.json';
      const body = '[\n' + chunk.join(',\n') + '\n]\n';
      const rel = 'cefr/' + name;
      await mkdir(path.join(DATA, 'cefr'), { recursive: true });
      await writeFile(path.join(DATA, rel), body);
      const record = {
        path: 'data/' + rel,
        bytes: Buffer.byteLength(body),
        hash: createHash('sha256').update(body).digest('hex').slice(0, 8),
        rows: chunk.length,
      };
      deckFiles.push(record);
      written.push(record);
      part += 1;
      chunk = [];
      size = 2;
    };
    for (const row of rows) {
      const bytes = Buffer.byteLength(row) + 2;
      if (chunk.length > 0 && size + bytes > MAX_FILE) await flush();
      chunk.push(row);
      size += bytes;
    }
    if (chunk.length > 0) await flush();
    cefr[band] = deckFiles;
  }

  const sourceStats = await Promise.all(SOURCES.map((source) => stat(path.join(CACHE, source.file))));
  const buildDate = new Date(Math.max(...sourceStats.map((info) => info.mtime))).toISOString().slice(0, 10);
  const version = 'v1-' + createHash('sha256')
    .update(written.map((file) => file.path + '\t' + file.bytes + '\t' + file.hash).sort().join('\n'))
    .digest('hex').slice(0, 12);

  const keys = [...buckets.keys()].sort();
  const bytes = written.reduce((total, file) => total + file.bytes, 0);
  const manifest = {
    version,
    built: buildDate,
    partial: opts.limit > 0,
    bucketKey: 'fold to lowercase, strip diacritics, first two letters or digits',
    idShape: '<file>:<position> in data/entry/<file>.json',
    persons: PERSON_LABELS,
    sources: SOURCES.map((source) => ({ url: source.url, licence: source.licence })),
    buckets: Object.fromEntries(keys.map((key) => [key, buckets.get(key)])),
    cefr,
    coverage: { withEnglish, top5000 },
    totals: { entries: shipped.length, forms: forms.size, examples: exampleRows, bytes, enTokens: enTokens.size },
  };
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(path.join(DATA, 'index.json'), manifestText);

  const bands = BAND_ORDER.map((band) => band + ':' + shipped.filter((entry) => entry.cefr === band).length).join(' ');
  const percent = (part, whole) => (whole === 0 ? '0' : ((part / whole) * 100).toFixed(1));
  const verbs = shipped.filter((entry) => entry.pos.some((group) => group.pos === 'verb'));
  const with30 = verbs.filter((entry) => entry.conj.length > 0 && entry.conj.reduce((n, group) => n + group.forms.filter(Boolean).length, 0) >= 30).length;
  const largest = Math.max(...written.map((file) => file.bytes));
  const searchBytes = setBytes.search;
  const entryBytes = setBytes.entry;
  const formBytes = setBytes.forms;
  const exBytes = setBytes.ex;
  const merged = shipped.filter((entry) => entry.pos.length > 1).length;

  console.log([
    'source lines          ' + stats.lines,
    'lemma records         ' + stats.lemmaRecords + ', form records ' + stats.formRecords,
    'dropped, no gloss     ' + stats.lost + ' (rescued from translation labels: ' + stats.rescued + ')',
    'excluded headwords    ' + excludedHits + ' of ' + excluded.size + ' listed',
    'entries shipped       ' + shipped.length + ' (' + merged + ' with more than one POS)' + (opts.limit > 0 ? ' --limit ' + opts.limit : ''),
    'with IPA              ' + shipped.filter((entry) => entry.ipa).length + ' (' + percent(shipped.filter((entry) => entry.ipa).length, shipped.length) + '%)',
    'en coverage           ' + withEnglish + ' / ' + shipped.length + ' (' + percent(withEnglish, shipped.length) + '%), top 5000 ' +
      top5000 + ' / ' + Math.min(5000, shipped.length) + ' (' + percent(top5000, Math.min(5000, shipped.length)) + '%)',
    'en index              ' + enTokens.size + ' tokens, ' + enPostings + ' postings, ' + enDropped + ' dropped by the cap',
    'en per pos            ' + [...perPos.entries()].sort((a, b) => b[1].total - a[1].total)
      .map(([pos, stat]) => pos + ' ' + stat.matched + '/' + stat.total + ' (' + percent(stat.matched, stat.total) + '%)').join(', '),
    'en unmapped pos       ' + ([...unmappedPos.entries()].sort((a, b) => b[1] - a[1]).map(([pos, count]) => pos + ':' + count).join(' ') || 'none'),
    'CEFR bands            ' + bands,
    'verbs                 ' + verbs.length + ', with a table ' + verbs.filter((entry) => entry.conj.length > 0).length + ', with 30+ forms ' + with30,
    'conj rows             ' + verbs.reduce((total, entry) => total + entry.conj.reduce((n, group) => n + group.forms.filter(Boolean).length, 0), 0),
    'form index            ' + forms.size + ' rows, ' + formBytes + ' bytes; dropped targets ' +
      (formMisses.unshipped + formMisses.unknown) + ' (lemma not shipped ' + formMisses.unshipped + ', no lemma record ' + formMisses.unknown + ')',
    'examples              ' + attachments + ' attachments, ' + textById.size + ' distinct sentences, ' + exampleRows + ' rows, ' + exBytes + ' bytes',
    'bytes                 search ' + searchBytes + ', entry ' + entryBytes + ', forms ' + formBytes + ', ex ' + exBytes + ', en ' + setBytes.en + ', total ' + bytes,
    'cefr decks            ' + BAND_ORDER.map((band) => band + ':' + cefr[band].reduce((n, file) => n + 1, 0) + 'f/' + cefr[band].reduce((n, file) => n + file.bytes, 0) + 'B').join(' '),
    'files                 ' + written.length + ', largest ' + largest + ', buckets ' + keys.length,
    'build time            ' + ((Date.now() - started) / 1000).toFixed(1) + 's',
    'manifest              ' + Buffer.byteLength(manifestText) + ' bytes, ' + version,
  ].join('\n'));

  const sample = shipped.find((entry) => entry.word === 'andare' && entry.conj.length > 0);
  if (sample) console.log('\nsample entry\n' + entryJson(sample, sample.id, sample.ex));
}

/** Group forms by mood and tense, persons in slot order. */
function buildConjugation(claims) {
  const groups = new Map();
  for (const claim of claims) {
    const tense = (claim.mood === 'gerundio' || claim.mood === 'imperativo') && claim.tense === 'presente' ? '' : claim.tense;
    const key = claim.mood + (tense ? ' ' + tense : '');
    let group = groups.get(key);
    if (!group) {
      group = { key, personal: !IMPERSONAL.has(claim.mood), forms: [] };
      groups.set(key, group);
    }
    if (!group.personal) group.forms.push(claim.form);
    else if (claim.person >= 0) group.forms[claim.person] = claim.form;
  }
  const rankOf = (key) => {
    const at = CONJ_ORDER.findIndex(([mood, tense]) => (mood + (tense ? ' ' + tense : '')) === key);
    return at < 0 ? 100 : at;
  };
  return [...groups.values()]
    .map((group) => ({
      key: group.key,
      personal: group.personal,
      forms: group.personal ? Array.from({ length: 6 }, (_, index) => group.forms[index] ?? null) : group.forms.map((form) => form ?? null),
    }))
    .sort((a, b) => rankOf(a.key) - rankOf(b.key) || (a.key < b.key ? -1 : 1));
}

main().catch((err) => {
  console.error('build failed:', err);
  process.exit(1);
});
