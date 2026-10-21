// Draws Lectern's app icons from the logo in public/favicon.svg and writes them to public/icons.
// The logo is three shapes on a 64-unit square, so each pixel is worked out from the distance
// to those shapes (16 samples a pixel) and written as a PNG with Node's zlib. Run: npm run icons

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const TILE = [0x1c, 0x1b, 0x19];
const BRAND = [0xe0, 0x56, 0x2c];
const INK = [0xf7, 0xf6, 0xf3];
const STROKE = 2.5;

/** Distance from (px, py) to the segment a–b. */
function toSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Signed distance to the 64×64 tile with 16-unit corners: negative inside. */
function toTile(px, py) {
  const qx = Math.abs(px - 32) - 16;
  const qy = Math.abs(py - 32) - 16;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 16;
}

const UNDERLINE = [[20, 46], [44, 46]];
const LETTER = [[24, 40], [28, 18], [36, 18], [40, 40]];

/** The colour at one point of the logo, in logo units, or null outside the tile. */
function logoAt(x, y, rounded) {
  if (rounded && toTile(x, y) > 0) return null;
  if (toSegment(x, y, ...UNDERLINE) <= STROKE) return BRAND;
  for (let i = 0; i < LETTER.length - 1; i++) {
    if (toSegment(x, y, LETTER[i], LETTER[i + 1]) <= STROKE) return INK;
  }
  return TILE;
}

/**
 * Renders a square icon. `rounded` keeps the logo's corners (transparent outside them);
 * otherwise the tile fills the square, for maskable and Apple icons that the system crops.
 * `scale` shrinks the letter towards the centre so it stays inside a mask's safe zone.
 */
function render(size, { rounded, scale = 1 }) {
  const n = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const ux = ((px + (sx + 0.5) / n) / size) * 64;
          const uy = ((py + (sy + 0.5) / n) / size) * 64;
          const c = rounded ? logoAt(ux, uy, true) : logoAt(32 + (ux - 32) / scale, 32 + (uy - 32) / scale, false);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const i = (py * size + px) * 4;
      if (a) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
      }
      rgba[i + 3] = Math.round((a / (n * n)) * 255);
    }
  }
  return png(size, size, rgba);
}

const CRC = new Uint32Array(256).map((_, k) => {
  let c = k;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ICONS = [
  ['icon-192.png', 192, { rounded: true }],
  ['icon-512.png', 512, { rounded: true }],
  // Masks keep the centre 80%; the letter and underline sit well inside it.
  ['icon-maskable-512.png', 512, { rounded: false, scale: 0.84 }],
  // iOS rounds the corners itself and fills transparency with black.
  ['apple-touch-icon.png', 180, { rounded: false, scale: 0.9 }],
];

mkdirSync(OUT, { recursive: true });
for (const [name, size, options] of ICONS) {
  writeFileSync(join(OUT, name), render(size, options));
  console.log(`icons/${name} (${size}×${size})`);
}
