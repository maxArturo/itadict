// @ts-check
/**
 * The explicit offline download: every data file the manifest lists, fetched one at a time through
 * the normal path, so the service worker caches each one. ADR 0003.
 *
 * No UI and no storage. The screen that calls it owns the button and the progress line.
 */

import { shardUrl } from './data.js';

/**
 * Every file URL of a manifest, without duplicates.
 * @param {import('./data.js').Manifest} manifest
 * @returns {string[]}
 */
export function fileUrls(manifest) {
  const urls = new Set();
  for (const bucket of Object.values(manifest.buckets ?? {})) {
    for (const kind of /** @type {const} */ (['search', 'entry', 'ex', 'forms'])) {
      for (const shard of bucket[kind] ?? []) urls.add(shardUrl(shard));
    }
  }
  return [...urls];
}

/**
 * Fetch every file and report progress. One failure is counted and the run goes on, so one bad
 * file never throws away the rest.
 *
 * Sequential on purpose: the progress number is honest, and a phone on a weak signal is not
 * flooded with a thousand requests at once.
 *
 * @param {import('./data.js').Manifest} manifest
 * @param {{
 *   fetch?: (url: string) => Promise<{ ok: boolean, status?: number }>,
 *   onProgress?: (done: number, total: number, failed: number) => void,
 * }} [options]
 * @returns {Promise<{ total: number, done: number, failures: Array<{ url: string, reason: string }> }>}
 */
export async function downloadAll(manifest, options = {}) {
  const doFetch = options.fetch ?? ((url) => globalThis.fetch(url));
  const urls = fileUrls(manifest);
  const total = urls.length;
  /** @type {Array<{ url: string, reason: string }>} */
  const failures = [];
  let done = 0;

  for (const url of urls) {
    try {
      const response = await doFetch(url);
      if (!response || response.ok !== true) {
        throw new Error('answered ' + (response?.status ?? 'nothing'));
      }
    } catch (error) {
      failures.push({ url, reason: error instanceof Error ? error.message : String(error) });
    }
    done += 1;
    options.onProgress?.(done, total, failures.length);
  }

  return { total, done, failures };
}
