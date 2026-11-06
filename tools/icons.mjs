// @ts-check
/**
 * Generate the four home-screen icons. Dev-only: the PNGs are committed, the site never runs this.
 * Run: node tools/icons.mjs
 *
 * No dependency. The PNG is written by hand: an RGB raster, deflate, four chunks. One ink colour
 * on one paper colour, a bold "A", full-bleed square corners. The 180 icon carries no alpha,
 * because iOS composites an icon with alpha onto black.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../icons/', import.meta.url));

/** The ink the glyph is drawn in. */
const INK = [17, 17, 17];
/** The paper behind it. Opaque, so iOS never fills the corners with black. */
const PAPER = [255, 255, 255];

/** The CRC-32 every PNG chunk ends with. */
const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** @param {Uint8Array} bytes @returns {number} */
function crc32(bytes) {
  let c = -1;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * @param {string} type four ASCII letters
 * @param {Uint8Array} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const body = Buffer.concat([head.subarray(4, 8), Buffer.from(data)]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, Buffer.from(data), tail]);
}

/**
 * A truecolour PNG from a pixel function.
 * @param {number} size
 * @param {(x: number, y: number) => [number, number, number]} pixel
 * @returns {Buffer}
 */
function png(size, pixel) {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x, y);
      const at = y * (stride + 1) + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB, no alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Distance from a point to a line segment, which is the stroke of a letter. */
function toSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * A bold "A": two legs and a crossbar, drawn as three round-ended strokes. The apex is a real
 * point, so the glyph stays readable at 60px.
 * @param {number} size
 * @param {number} height the glyph height as a fraction of the canvas
 */
function glyph(size, height) {
  const half = (height * size) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const apexY = cy - half;
  const footY = cy + half;
  const footX = half * 0.86;
  const stroke = half * 0.3;
  const barY = apexY + (footY - apexY) * 0.7;
  const t = (barY - apexY) / (footY - apexY);
  const barX = footX * t;
  return {
    stroke,
    segments: /** @type {Array<[number, number, number, number]>} */ ([
      [cx, apexY, cx - footX, footY],
      [cx, apexY, cx + footX, footY],
      [cx - barX, barY, cx + barX, barY],
    ]),
  };
}

/**
 * The icon canvas: paper with the glyph composited on top, 4 by 4 samples per pixel so the
 * diagonal edges are smooth.
 * @param {number} size
 * @param {number} height
 * @returns {(x: number, y: number) => [number, number, number]}
 */
function canvas(size, height) {
  const { stroke, segments } = glyph(size, height);
  const samples = 4;
  return (x, y) => {
    let hits = 0;
    for (let sy = 0; sy < samples; sy += 1) {
      for (let sx = 0; sx < samples; sx += 1) {
        const px = x + (sx + 0.5) / samples;
        const py = y + (sy + 0.5) / samples;
        for (const [ax, ay, bx, by] of segments) {
          if (toSegment(px, py, ax, ay, bx, by) <= stroke) {
            hits += 1;
            break;
          }
        }
      }
    }
    const cover = hits / (samples * samples);
    return /** @type {[number, number, number]} */ (
      INK.map((ink, at) => Math.round(PAPER[at] + (ink - PAPER[at]) * cover))
    );
  };
}

/**
 * Write one icon.
 * @param {string} name
 * @param {number} size
 * @param {number} height
 * @returns {Buffer}
 */
function write(name, size, height) {
  const bytes = png(size, canvas(size, height));
  writeFileSync(OUT + name, bytes);
  console.log(name + ': ' + size + 'x' + size + ', ' + bytes.length + ' bytes');
  return bytes;
}

mkdirSync(OUT, { recursive: true });

write('icon-180.png', 180, 0.6);
write('icon-192.png', 192, 0.6);
write('icon-512.png', 512, 0.6);
// Maskable: the glyph must stay inside the safe circle, so it is smaller on a full-bleed paper.
write('maskable-512.png', 512, 0.5);

// A cheap self-check of the geometry: the paper corners stay paper, and the crossbar is ink.
const plate = canvas(512, 0.6);
const corner = plate(4, 4);
const bar = plate(256, 512 / 2 + (0.6 * 512) / 2 * 0.4);
if (corner.some((value) => value !== 255)) throw new Error('icon: the corner is not paper');
if (bar.every((value) => value > 128)) throw new Error('icon: the crossbar is not ink');
console.log('icons written to icons/');
