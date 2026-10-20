// The look auto style gives a deck: the built-in look that suits it, with its
// accent taken from the deck's own pictures when they share a strong colour.

import { suggestLook } from '../../core/deck/auto-style';
import type { Deck } from '../../core/deck/types';
import { type Theme, getTheme } from '../../core/engine/themes';
import { deckPictures } from '../../core/pictures/credits';
import { assetUrl } from '../../data/repo';
import { copyLook, saveLook } from '../../data/looks';
import { contrast, isDark, mix, readableOn } from './color';

/** Auto looks are saved per deck under this prefix, and kept out of the Your looks list. */
export const AUTO_LOOK_PREFIX = 'auto-';

export const isAutoLook = (id: string) => id.startsWith(AUTO_LOOK_PREFIX);

interface Bucket { weight: number; r: number; g: number; b: number }

const HUES = 18;

/** Adds one picture's colourful pixels to the hue buckets. Grey, near-black and near-white pixels don't count. */
async function sample(src: string, buckets: Bucket[]): Promise<boolean> {
  const url = await assetUrl(src);
  if (!url) return false;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, 48, 48);
    const { data } = ctx.getImageData(0, 0, 48, 48);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const s = max ? (max - min) / max : 0;
      if (s < 0.3 || max < 0.25 || max > 0.97) continue;
      let h = 0;
      if (max === r) h = ((g - b) / (max - min)) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      const k = Math.floor((((h * 60) + 360) % 360) / (360 / HUES));
      const w = s * s * max;
      const bucket = buckets[k];
      bucket.weight += w;
      bucket.r += data[i] * w;
      bucket.g += data[i + 1] * w;
      bucket.b += data[i + 2] * w;
    }
    return true;
  } catch {
    // A picture from another site may not allow reading its pixels.
    return false;
  }
}

/** The strongest colour the deck's pictures share, or null when they're mostly grey. */
export async function pictureAccent(deck: Deck): Promise<string | null> {
  const refs = deckPictures(deck).map((u) => u.ref).slice(0, 6);
  if (!refs.length) return null;
  const buckets: Bucket[] = Array.from({ length: HUES }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  let read = 0;
  for (const ref of refs) if (await sample(ref, buckets)) read++;
  if (!read) return null;
  // Neighbouring hues count together, so a colour split across two buckets still wins.
  let best = -1;
  let bestWeight = 0;
  buckets.forEach((b, k) => {
    const w = b.weight + 0.5 * (buckets[(k + 1) % HUES].weight + buckets[(k + HUES - 1) % HUES].weight);
    if (w > bestWeight) { bestWeight = w; best = k; }
  });
  const total = buckets.reduce((sum, b) => sum + b.weight, 0);
  // Too little colour (under about 3% of the picture area by weight) to build a look on.
  if (best < 0 || bestWeight < read * 48 * 48 * 0.03 || bestWeight / total < 0.18) return null;
  const b = buckets[best];
  const hex = `#${[b.r, b.g, b.b].map((v) => Math.round(v / b.weight).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  return hex;
}

/** An accent that stands out on the background: darkened or lightened until it reaches 3:1. */
export function fitAccent(accent: string, bg: string): string {
  let out = accent;
  const toward = isDark(bg) ? '#FFFFFF' : '#000000';
  for (let i = 0; i < 12 && contrast(out, bg) < 3; i++) out = mix(out, toward, 0.12);
  return out;
}

/** The base look with the deck's picture colour as its accent. */
export function accentLook(base: Theme, accent: string, deck: Pick<Deck, 'id' | 'title'>): Theme {
  const look = copyLook(base, `${base.name}, your colours`);
  const c = base.colors;
  const a = fitAccent(accent, c.bg);
  return {
    ...look,
    id: `${AUTO_LOOK_PREFIX}${deck.id}`,
    description: `${base.name} with the main colour of the pictures in “${deck.title}”.`,
    colors: {
      ...c,
      accent: a,
      onAccent: readableOn(a),
      accent2: mix(c.bg, a, isDark(c.bg) ? 0.32 : 0.16),
      line: mix(c.line, a, 0.12),
    },
  };
}

/** Picks the deck's look for auto style. Returns the id to use; a picture-matched look is saved first. */
export async function autoLook(deck: Deck): Promise<{ themeId: string; matched: boolean }> {
  const base = getTheme(suggestLook(deck));
  const accent = await pictureAccent(deck).catch(() => null);
  if (!accent) return { themeId: base.id, matched: false };
  const saved = await saveLook(accentLook(base, accent, deck));
  return { themeId: saved.id, matched: true };
}
