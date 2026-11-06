// @ts-check
/**
 * Text to speech, in Italian, one voice, the rate Settings holds.
 *
 * The voice list loads asynchronously in some browsers, so available() is asked at drawing
 * time and the screen hides the speaker when it answers false. A button that cannot speak is
 * never shown.
 *
 * "target" is a parameter with a browser default, so the sanity suite can drive a fake
 * synthesiser with no audio and no DOM.
 */

/** The rate the app speaks at when Settings holds nothing. */
export const RATE = 0.9;

/** The speech rate the platform accepts, and the range a stored value is clamped to. */
export const RATE_MIN = 0.5;
export const RATE_MAX = 1.5;

/** @typedef {{ lang: string }} VoiceLike */
/**
 * @typedef {{
 *   speechSynthesis?: {
 *     getVoices: () => VoiceLike[],
 *     speak: (utterance: any) => void,
 *     cancel: () => void,
 *     addEventListener?: (type: string, listener: () => void) => void,
 *   },
 *   SpeechSynthesisUtterance?: new (text: string) => any,
 * }} SpeechTarget
 */

/**
 * @param {SpeechTarget} [target] defaults to the browser; inject a fake in Node checks
 * @returns {{
 *   available: () => boolean,
 *   speak: (text: string, rate?: number) => boolean,
 *   cancel: () => void,
 * }}
 */
export function createSpeech(target = /** @type {SpeechTarget} */ (/** @type {unknown} */ (globalThis))) {
  const synth = target.speechSynthesis;
  const Utterance = target.SpeechSynthesisUtterance;
  const wired = Boolean(synth && typeof synth.getVoices === 'function' && typeof Utterance === 'function');

  /** @type {VoiceLike | null} */
  let voice = null;

  function pick() {
    if (!wired || synth === undefined) return;
    /** @type {VoiceLike[]} */
    let voices = [];
    try {
      voices = synth.getVoices() ?? [];
    } catch {
      voices = [];
    }
    voice = voices.find((candidate) => candidate.lang === 'it-IT') ?? voices.find((candidate) => candidate.lang.startsWith('it')) ?? null;
  }

  pick();
  if (wired && synth !== undefined && typeof synth.addEventListener === 'function') {
    // Chrome fills the voice list after the first paint.
    synth.addEventListener('voiceschanged', pick);
  }

  return {
    available: () => wired && voice !== null,
    /**
     * Speak one Italian text at one rate. Returns false when no Italian voice exists.
     * @param {string} text
     * @param {number} [rate] the stored rate; a value outside the platform range is clamped
     * @returns {boolean}
     */
    speak(text, rate = RATE) {
      if (!wired || voice === null || synth === undefined || Utterance === undefined) return false;
      const clean = String(text ?? '').trim();
      if (clean === '') return false;
      const speed =
        typeof rate === 'number' && Number.isFinite(rate) ? Math.min(RATE_MAX, Math.max(RATE_MIN, rate)) : RATE;
      synth.cancel();
      const utterance = new Utterance(clean);
      utterance.lang = 'it-IT';
      utterance.voice = voice;
      utterance.rate = speed;
      synth.speak(utterance);
      return true;
    },
    cancel() {
      if (wired && synth !== undefined) synth.cancel();
    },
  };
}
