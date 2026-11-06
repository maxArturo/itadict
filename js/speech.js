// @ts-check
/**
 * Text to speech, in Italian, one voice, one rate.
 *
 * The voice list loads asynchronously in some browsers, so available() is asked at drawing
 * time and the screen hides the speaker when it answers false. A button that cannot speak is
 * never shown.
 *
 * "target" is a parameter with a browser default, so the sanity suite can drive a fake
 * synthesiser with no audio and no DOM.
 */

/** The one rate the app speaks at. */
export const RATE = 0.9;

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
 *   speak: (text: string) => boolean,
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
     * Speak one Italian text. Returns false when no Italian voice exists.
     * @param {string} text
     * @returns {boolean}
     */
    speak(text) {
      if (!wired || voice === null || synth === undefined || Utterance === undefined) return false;
      const clean = String(text ?? '').trim();
      if (clean === '') return false;
      synth.cancel();
      const utterance = new Utterance(clean);
      utterance.lang = 'it-IT';
      utterance.voice = voice;
      utterance.rate = RATE;
      synth.speak(utterance);
      return true;
    },
    cancel() {
      if (wired && synth !== undefined) synth.cancel();
    },
  };
}
