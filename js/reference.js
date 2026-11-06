// @ts-check
/**
 * The Reference catalogue: the alphabet table and the parts-of-speech index.
 *
 * Pure. The alphabet is app copy, not dictionary data: Italian letter names are common
 * knowledge. The parts-of-speech index is built from the CEFR deck rows the data client hands
 * over, which cover every entry and sit in frequency order, so the first 200 rows of a part of
 * speech are the most frequent ones.
 */

/** @typedef {import('./data.js').DeckRow} DeckRow */

/**
 * The 21 letters of the Italian alphabet and the six accented vowels, in school order.
 * "name" is the Italian name of the letter. "word" is the example word; the Reference screen
 * links it to its entry when the dictionary has that headword.
 * @type {Array<{ letter: string, name: string, word: string }>}
 */
export const ALPHABET = [
  { letter: 'a', name: 'a', word: 'albero' },
  { letter: 'b', name: 'bi', word: 'barca' },
  { letter: 'c', name: 'ci', word: 'casa' },
  { letter: 'd', name: 'di', word: 'dente' },
  { letter: 'e', name: 'e', word: 'elefante' },
  { letter: 'f', name: 'effe', word: 'farfalla' },
  { letter: 'g', name: 'gi', word: 'gatto' },
  { letter: 'h', name: 'acca', word: 'hotel' },
  { letter: 'i', name: 'i', word: 'isola' },
  { letter: 'l', name: 'elle', word: 'luna' },
  { letter: 'm', name: 'emme', word: 'mare' },
  { letter: 'n', name: 'enne', word: 'nave' },
  { letter: 'o', name: 'o', word: 'orso' },
  { letter: 'p', name: 'pi', word: 'pane' },
  { letter: 'q', name: 'cu', word: 'quadro' },
  { letter: 'r', name: 'erre', word: 'rosa' },
  { letter: 's', name: 'esse', word: 'sole' },
  { letter: 't', name: 'ti', word: 'tavolo' },
  { letter: 'u', name: 'u', word: 'uva' },
  { letter: 'v', name: 'vu', word: 'vino' },
  { letter: 'z', name: 'zeta', word: 'zebra' },
  { letter: 'à', name: 'a accentata', word: 'città' },
  { letter: 'è', name: 'e accentata grave', word: 'caffè' },
  { letter: 'é', name: 'e accentata acuta', word: 'perché' },
  { letter: 'ì', name: 'i accentata', word: 'così' },
  { letter: 'ò', name: 'o accentata', word: 'però' },
  { letter: 'ù', name: 'u accentata', word: 'più' },
];

/**
 * English names for the parts of speech the data build writes. A value not listed here gets its
 * underscores turned into spaces and a capital letter.
 * @type {Record<string, string>}
 */
export const POS_LABELS = {
  noun: 'Noun',
  adj: 'Adjective',
  verb: 'Verb',
  phrase: 'Phrase',
  name: 'Proper noun',
  adv: 'Adverb',
  abbrev: 'Abbreviation',
  adv_phrase: 'Adverbial phrase',
  prefix: 'Prefix',
  suffix: 'Suffix',
  conj: 'Conjunction',
  intj: 'Interjection',
  prep: 'Preposition',
  pron: 'Pronoun',
  symbol: 'Symbol',
  prep_phrase: 'Prepositional phrase',
  character: 'Character',
  article: 'Article',
  affix: 'Affix',
};

/**
 * A display name for a part of speech.
 * @param {string} pos
 * @returns {string}
 */
export function posLabel(pos) {
  const key = String(pos ?? '');
  if (POS_LABELS[key] !== undefined) return POS_LABELS[key];
  if (key === '') return 'Other';
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

/**
 * One group per part of speech: its count over every row, and the first "cap" rows in the order
 * given. With the CEFR decks in band order, that order is frequency order.
 *
 * @param {DeckRow[]} rows every deck row, easiest band first
 * @param {number} [cap] rows kept per part of speech
 * @returns {Array<{ pos: string, label: string, count: number, rows: DeckRow[] }>}
 */
export function posIndex(rows, cap = 200) {
  /** @type {Map<string, { pos: string, label: string, count: number, rows: DeckRow[] }>} */
  const groups = new Map();
  for (const row of rows) {
    const pos = typeof row.pos === 'string' && row.pos !== '' ? row.pos : 'other';
    let group = groups.get(pos);
    if (group === undefined) {
      group = { pos, label: posLabel(pos), count: 0, rows: [] };
      groups.set(pos, group);
    }
    group.count += 1;
    if (group.rows.length < cap) group.rows.push(row);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0));
}
