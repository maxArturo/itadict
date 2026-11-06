// @ts-check
/**
 * Study: the schedule rule, the due rule, the deck order and the band names.
 *
 * Pure. Every function takes "now" as a number, so the sanity suite can move the clock
 * without a browser. The screen draws; this module decides.
 *
 * A card is five numbers: "step" (how far up the ladder it climbed), "ease" (how easy the
 * learner finds it, 2.5 at the start, 1.3 at the floor), "due" (a timestamp in ms), "reps"
 * (how many times it was remembered) and "lapses" (how many times it was forgot).
 *
 * Forgot: back to step 0, ease down 0.2, due again in ten minutes, one more lapse.
 * Remembered: one step up, the interval of the current step scaled by ease / 2.5, reps + 1.
 */

/** The six CEFR decks, easiest first. */
export const BANDS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];

/** The starting ease, and the floor a forgot can reach. */
export const EASE_START = 2.5;
export const EASE_MIN = 1.3;
export const EASE_STEP = 0.2;

/** A forgot card comes back this soon. */
export const RELEARN_MINUTES = 10;

/** The interval ladder in days. The last step repeats at the top. */
export const INTERVALS = [1, 3, 7, 16, 35, 75, 160];

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** @typedef {{ step: number, ease: number, due: number, reps: number, lapses: number }} Card */

/**
 * One stored card, or null when the value is not a card. Unknown keys are dropped.
 * @param {unknown} value
 * @returns {Card | null}
 */
export function readCard(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = /** @type {Record<string, unknown>} */ (value);
  /** @type {unknown[]} */
  const numbers = ['step', 'ease', 'due', 'reps', 'lapses'].map((key) => raw[key]);
  if (!numbers.every((number) => typeof number === 'number' && Number.isFinite(number))) return null;
  const [step, ease, due, reps, lapses] = /** @type {number[]} */ (numbers);
  return {
    step: Math.max(0, Math.floor(step)),
    ease: Math.max(EASE_MIN, ease),
    due,
    reps: Math.max(0, Math.floor(reps)),
    lapses: Math.max(0, Math.floor(lapses)),
  };
}

/**
 * Round to two decimals, so a stored ease reads 2.3 and not 2.2999999999999998.
 * @param {number} value
 * @returns {number}
 */
const tidy = (value) => Math.round(value * 100) / 100;

/**
 * A card nobody has graded: due now, step 0, ease 2.5.
 * @param {number} now
 * @returns {Card}
 */
export function newCard(now) {
  return { step: 0, ease: EASE_START, due: now, reps: 0, lapses: 0 };
}

/**
 * The next card after one grade.
 * @param {unknown} stored the card as stored, or the new-card shape
 * @param {boolean} remembered true for a swipe right, false for a swipe left
 * @param {number} now
 * @returns {Card}
 */
export function gradeCard(stored, remembered, now) {
  const card = readCard(stored) ?? newCard(now);
  if (!remembered) {
    return {
      step: 0,
      ease: Math.max(EASE_MIN, tidy(card.ease - EASE_STEP)),
      due: now + RELEARN_MINUTES * MINUTE,
      reps: card.reps,
      lapses: card.lapses + 1,
    };
  }
  const days = INTERVALS[Math.min(card.step, INTERVALS.length - 1)] * (card.ease / EASE_START);
  return {
    step: card.step + 1,
    ease: card.ease,
    due: now + days * DAY,
    reps: card.reps + 1,
    lapses: card.lapses,
  };
}

/**
 * The first millisecond that is not today, in local time.
 * @param {number} now
 * @returns {number}
 */
export function endOfToday(now) {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

/**
 * Due at or before the end of today, local time.
 * @param {unknown} stored
 * @param {number} now
 * @returns {boolean}
 */
export function isDue(stored, now) {
  const card = readCard(stored);
  return card !== null && card.due <= endOfToday(now);
}

/**
 * How many cards are due today.
 * @param {Record<string, unknown>} schedule
 * @param {number} now
 * @returns {number}
 */
export function dueCount(schedule, now) {
  const today = endOfToday(now);
  let count = 0;
  for (const stored of Object.values(schedule ?? {})) {
    const card = readCard(stored);
    if (card !== null && card.due <= today) count += 1;
  }
  return count;
}

/**
 * The ids due today, soonest first.
 * @param {Record<string, unknown>} schedule
 * @param {number} now
 * @returns {string[]}
 */
export function dueIds(schedule, now) {
  const today = endOfToday(now);
  /** @type {Array<{ id: string, due: number }>} */
  const out = [];
  for (const [id, stored] of Object.entries(schedule ?? {})) {
    const card = readCard(stored);
    if (card !== null && card.due <= today) out.push({ id, due: card.due });
  }
  return out.sort((a, b) => a.due - b.due || (a.id < b.id ? -1 : 1)).map((entry) => entry.id);
}

/**
 * The order one run shows: due cards first, then cards never studied, then the rest of the
 * deck soonest first. Ties keep the deck order.
 *
 * @param {string[]} ids
 * @param {Record<string, unknown>} schedule
 * @param {number} now
 * @returns {string[]}
 */
export function orderDeck(ids, schedule, now) {
  const today = endOfToday(now);
  /** @type {string[]} */
  const due = [];
  /** @type {string[]} */
  const fresh = [];
  /** @type {string[]} */
  const later = [];
  for (const id of ids) {
    const card = readCard(schedule?.[id]);
    if (card === null) fresh.push(id);
    else if (card.due <= today) due.push(id);
    else later.push(id);
  }
  const byDue = (/** @type {string} */ a, /** @type {string} */ b) =>
    (readCard(schedule[a])?.due ?? 0) - (readCard(schedule[b])?.due ?? 0);
  return [...due.sort(byDue), ...fresh, ...later.sort(byDue)];
}

/**
 * One deck: a name, a count and the ids it holds.
 * @typedef {{ id: string, title: string, count: number, note?: string }} Deck
 */
