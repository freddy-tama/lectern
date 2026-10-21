// Slide types the room answers from their phones: the word cloud. Registered with
// the core kinds. The slide draws whatever words its content holds; while a deck is
// shared, the screens put the live answers in that content before drawing it.

import { type Box, CANVAS_H } from '../engine/boxes';
import { cssFont } from '../engine/measure';
import { fontWeight } from '../engine/themes';
import { M, type LayoutContext, fam, read, shape, slideTitle, sz, text } from './kit';
import type { AnyKind, SlideKindDefinition } from './types';

type C = Record<string, unknown>;

export interface CloudWord {
  text: string;
  count: number;
}

/** Most answers one person may send to a word cloud. */
export function perPerson(c: C): number {
  const n = Math.round(Number(String(c.perPerson ?? '').trim() || 3));
  return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 3;
}

/**
 * The words a slide holds, merged when they differ only in case, biggest count first.
 * Counts that aren't positive numbers count once.
 */
export function cloudWords(c: C, max = 50): CloudWord[] {
  const merged = new Map<string, CloudWord>();
  for (const o of read.objects<Record<string, unknown>>(c, 'answers')) {
    const value = String(o.text ?? '').replace(/\s+/g, ' ').trim();
    if (!value) continue;
    const n = Number(String(o.count ?? '').trim());
    const count = Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
    const key = value.toLocaleLowerCase();
    const had = merged.get(key);
    if (had) had.count += count;
    else merged.set(key, { text: value, count });
  }
  return [...merged.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)).slice(0, max);
}

interface Rect { x: number; y: number; w: number; h: number }

const hits = (a: Rect, b: Rect, pad: number) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/**
 * Places words on a spiral out from the middle of the area, biggest first, so no two
 * overlap. Sizes follow the square root of each count. When words are left over, every
 * size shrinks and the cloud is placed again; whatever still doesn't fit is the smallest
 * and is left off. Deterministic: the same words always land in the same places.
 */
export function placeCloud(ctx: LayoutContext, words: CloudWord[], area: Rect, o: { step?: number } = {}): { boxes: Box[]; dropped: number } {
  if (!words.length) return { boxes: [], dropped: 0 };
  const colors = ctx.theme.colors;
  const family = fam(ctx, 'display');
  const weight = Math.max(600, fontWeight(ctx.theme, 'display'));
  const hi = words[0].count;
  const lo = words[words.length - 1].count;
  const maxSize = Math.min(sz(ctx, words.length <= 3 ? 150 : 128), area.h * 0.34);
  const minSize = Math.min(maxSize, sz(ctx, 34));
  // The commonest word takes the accent; the rest take turns so neighbours differ.
  const palette = [colors.ink, colors.muted, colors.accent];
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const stretch = Math.max(1, area.w / Math.max(1, area.h));

  let best: { boxes: Box[]; dropped: number } | null = null;
  for (let attempt = 0, scale = 1; attempt < 6; attempt++, scale *= 0.85) {
    const placed: Rect[] = [];
    const boxes: Box[] = [];
    let dropped = 0;
    words.forEach((word, i) => {
      const t = hi === lo ? (words.length <= 3 ? 1 : 0.55) : Math.sqrt((word.count - lo) / (hi - lo));
      const size = Math.max(14, Math.round((minSize + (maxSize - minSize) * t) * scale));
      const w = Math.ceil(ctx.measure(word.text, cssFont(family, size, weight)) / 0.97 + size * 0.2);
      const h = Math.ceil(size * 1.18);
      if (w > area.w || h > area.h) { dropped++; return; }
      let spot: Rect | null = null;
      // Steps shrink as the spiral widens, so the outer turns are searched as finely as the inner ones.
      for (let k = 0, angle = 0; k < 6000 && !spot; k++) {
        const r = angle * 4.2;
        angle += Math.min(0.3, 24 / (r * stretch + 1));
        const rect = { x: Math.round(cx + r * Math.cos(angle) * stretch - w / 2), y: Math.round(cy + r * Math.sin(angle) - h / 2), w, h };
        if (rect.x < area.x || rect.y < area.y || rect.x + w > area.x + area.w || rect.y + h > area.y + area.h) {
          // Past the area on every side: no later point of the spiral lands inside it.
          if (r * stretch > area.w && r > area.h) break;
          continue;
        }
        if (!placed.some((p) => hits(p, rect, Math.round(size * 0.12)))) spot = rect;
      }
      if (!spot) { dropped++; return; }
      placed.push(spot);
      boxes.push({
        type: 'text', id: `word-${i}`, ...spot, text: word.text, step: o.step,
        style: { font: 'display', size, weight, color: i === 0 ? colors.accent : palette[(i - 1) % palette.length], align: 'center', valign: 'middle', lineHeight: 1.18 },
      });
    });
    if (!best || dropped < best.dropped) best = { boxes, dropped };
    if (!dropped) break;
  }
  // A cloud of a few words sits in the middle of the area, not wherever the spiral left it.
  const { boxes } = best!;
  if (boxes.length) {
    const left = Math.min(...boxes.map((b) => b.x));
    const right = Math.max(...boxes.map((b) => b.x + b.w));
    const top = Math.min(...boxes.map((b) => b.y));
    const bottom = Math.max(...boxes.map((b) => b.y + b.h));
    const dx = Math.round(cx - (left + right) / 2);
    const dy = Math.round(cy - (top + bottom) / 2);
    for (const b of boxes) { b.x += dx; b.y += dy; }
  }
  return best!;
}

const wordcloud: SlideKindDefinition<C> = {
  kind: 'wordcloud', label: 'Word cloud', description: 'Ask the room for a word or two. Answers sent from phones grow into a cloud on the screen, biggest where most people agree.', icon: 'cloud', group: 'Engage',
  fields: [
    { key: 'prompt', label: 'Question', type: 'textarea', rows: 2, placeholder: 'In one word: what makes a great meeting?' },
    { key: 'perPerson', label: 'Answers per person', type: 'text', placeholder: '3', help: 'From 1 to 5. People answer on their phones when you share the deck.' },
    {
      key: 'answers', label: 'Words on the slide', type: 'objects', itemLabel: 'Word', max: 40, more: true, ai: false,
      help: 'Kept from a live session, or typed in. A higher count draws the word bigger.',
      fields: [
        { key: 'text', label: 'Word', type: 'text' },
        { key: 'count', label: 'Count', type: 'text', placeholder: '1' },
      ],
    },
  ],
  create: () => ({ prompt: 'In one word: what makes a great meeting?', perPerson: '3', answers: [] }),
  heading: (c) => read.str(c, 'prompt').slice(0, 70) || 'Word cloud',
  text: (c) => [read.str(c, 'prompt')].filter(Boolean),
  layout(c, ctx) {
    const colors = ctx.theme.colors;
    const { box, bottom } = slideTitle(ctx, read.str(c, 'prompt') || 'Word cloud', { bind: 'prompt' });
    const boxes: Box[] = [box];
    const area = { x: M.x, y: bottom, w: M.w, h: M.bottom - bottom };
    const words = cloudWords(c);
    if (words.length) {
      const cloud = placeCloud(ctx, words, area);
      boxes.push(...cloud.boxes);
      return { boxes };
    }
    if (ctx.mode === 'edit') {
      boxes.push(shape({ id: 'cloud-ph', shape: 'rect', ...area, fill: colors.surface, stroke: colors.line, strokeWidth: 3, radius: ctx.theme.radius, dash: true, bind: 'prompt' }));
    }
    const hint = ctx.target === 'pptx'
      ? 'Answers are collected live when you present from Lectern.'
      : 'Answer on your phone. Words appear here as they come in.';
    const y = Math.min(area.y + area.h / 2 - 40, CANVAS_H - 200);
    boxes.push(text(ctx, { id: 'cloud-hint', text: hint, x: area.x + 80, y, w: area.w - 160, h: 80, max: 36, min: 24, color: colors.muted, align: 'center', valign: 'middle', maxLines: 2 }));
    return { boxes };
  },
};

export const LIVE_KINDS: AnyKind[] = [wordcloud];
