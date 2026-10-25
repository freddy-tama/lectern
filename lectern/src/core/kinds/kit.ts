// Layout helpers shared by every slide kind (core and plugin kinds alike).

import type { Audience } from '../deck/types';
import { type Box, type FontRole, type ImageBox, type ShapeBox, type TextBox, CANVAS_H, CANVAS_W } from '../engine/boxes';
import { type DecorColors, type DecorMotif, decorDataUrl } from '../engine/decor';
import { type Measure, cssFont, fitText, wrapLines } from '../engine/measure';
import { type Theme, fontFamily, fontWeight } from '../engine/themes';

export interface LayoutContext {
  theme: Theme;
  audience: Audience;
  /** Which font names to measure with: web fonts on screen, PowerPoint fonts on export. */
  target: 'web' | 'pptx';
  /** Edit mode may draw placeholders (for example an empty image frame); show mode never does. */
  mode: 'edit' | 'show';
  measure: Measure;
  slideNumber: number;
  slideCount: number;
  deckTitle: string;
  warnings: string[];
  /** Resolves images the host stores itself ("asset:<id>"). */
  resolveImage?: (src: string) => string;
  /** Presenter toggles registered by mods, for example a pronunciation line. */
  flags: Record<string, boolean>;
}

/** Safe area on the 1920 × 1080 canvas. */
export const M = { x: 128, right: CANVAS_W - 128, top: 96, bottom: CANVAS_H - 96, w: CANVAS_W - 256 };

const AUDIENCE_SCALE: Record<Audience, number> = { young: 1.2, teen: 1.07, adult: 1 };

/** Most bullet points a slide should carry for this audience before the studio warns. */
export const DENSITY: Record<Audience, { bullets: number; words: number }> = {
  young: { bullets: 3, words: 25 },
  teen: { bullets: 5, words: 45 },
  adult: { bullets: 6, words: 70 },
};

export function sz(ctx: LayoutContext, px: number) {
  return Math.round(px * AUDIENCE_SCALE[ctx.audience] * ctx.theme.sizeBias);
}

export function fam(ctx: LayoutContext, role: FontRole) {
  return fontFamily(ctx.theme, role, ctx.target);
}

export interface TextOptions {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  role?: FontRole;
  max: number;
  min: number;
  weight?: number;
  italic?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  lh?: number;
  maxLines?: number;
  tracking?: number;
  uppercase?: boolean;
  step?: number;
  bind?: string;
  reveal?: 'answer';
  /** Shrink the box to the height the text actually needs. */
  hug?: boolean;
  /** Scale with the audience band (default true). */
  scaled?: boolean;
}

/** A fitted text box. Pass hug to get a box exactly as tall as its text. */
export function text(ctx: LayoutContext, o: TextOptions): TextBox {
  const role = o.role ?? 'body';
  const weight = o.weight ?? fontWeight(ctx.theme, role);
  const lh = o.lh ?? (role === 'display' ? 1.08 : 1.3);
  const value = o.uppercase ? o.text.toUpperCase() : o.text;
  const scale = (px: number) => (o.scaled === false ? px : sz(ctx, px));
  const max = scale(o.max);
  const min = Math.min(max, scale(o.min));
  const fit = fitText(value, {
    family: fam(ctx, role), weight, italic: o.italic, width: o.w, height: o.h,
    maxSize: max, minSize: min, lineHeight: lh, maxLines: o.maxLines, measure: ctx.measure,
  });
  if (fit.overflow && value.trim()) ctx.warnings.push(`Text is too long to fit: “${value.slice(0, 48)}${value.length > 48 ? '…' : ''}”`);
  const h = o.hug ? Math.min(o.h, Math.ceil(fit.height)) : o.h;
  return {
    type: 'text', id: o.id, x: o.x, y: o.y, w: o.w, h: Math.max(h, Math.ceil(fit.size * lh)),
    text: o.text,
    style: {
      font: role, size: fit.size, weight, italic: o.italic, color: o.color ?? ctx.theme.colors.ink,
      align: o.align ?? 'left', valign: o.valign ?? 'top', lineHeight: lh, tracking: o.tracking, uppercase: o.uppercase,
    },
    step: o.step, bind: o.bind, reveal: o.reveal, overflow: fit.overflow,
  };
}

/** Height of text at a fixed size and width. */
export function heightAt(ctx: LayoutContext, value: string, size: number, width: number, role: FontRole = 'body', lh = 1.3, weight?: number) {
  const font = cssFont(fam(ctx, role), size, weight ?? fontWeight(ctx.theme, role));
  return wrapLines(value, width * 0.97, font, ctx.measure).length * size * lh;
}

export function shape(o: Omit<ShapeBox, 'type'>): ShapeBox {
  return { type: 'shape', ...o };
}

export function card(ctx: LayoutContext, id: string, x: number, y: number, w: number, h: number, extra: Partial<ShapeBox> = {}): ShapeBox {
  return shape({ id, shape: 'rect', x, y, w, h, fill: ctx.theme.colors.surface, stroke: ctx.theme.colors.line, strokeWidth: 2, radius: ctx.theme.radius, ...extra });
}

/** The slide title at the top of content slides. Returns the box and where content may start. */
export function slideTitle(ctx: LayoutContext, value: string, opts: { w?: number; x?: number; bind?: string } = {}) {
  const box = text(ctx, {
    id: 'title', text: value || ' ', x: opts.x ?? M.x, y: M.top, w: opts.w ?? M.w, h: sz(ctx, 76) * 2.3,
    role: 'display', max: 76, min: 50, maxLines: 2, hug: true, bind: opts.bind ?? 'title',
  });
  return { box, bottom: box.y + box.h + sz(ctx, 44) };
}

export interface ListOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  max?: number;
  min?: number;
  marker?: 'dot' | 'number' | 'check' | 'none';
  reveal?: boolean;
  /** First reveal step when reveal is on. */
  startStep?: number;
  bindKey: string;
  gap?: number;
  vcenter?: boolean;
  color?: string;
  markerColor?: string;
  /** Index of the first item in the whole list, when this draws part of it (one column of two). */
  offset?: number;
  /** One font size for every item, in canvas px, instead of the largest that fits. */
  size?: number;
}

/**
 * A list where every item shares one font size, the largest that fits the area.
 * Pass the list as stored, blanks included: blank items are skipped, and each box binds
 * to its item's place in the stored list, so typing into it changes the right one.
 */
export function list(ctx: LayoutContext, items: string[], o: ListOptions): Box[] {
  const entries = items.map((s, i) => ({ value: String(s ?? '').trim(), i: i + (o.offset ?? 0) })).filter((e) => e.value);
  const values = entries.map((e) => e.value);
  if (!values.length) return [];
  const marker = o.marker ?? 'dot';
  const max = sz(ctx, o.max ?? 46);
  const min = Math.min(max, sz(ctx, o.min ?? 30));
  const lh = 1.3;
  let size = o.size ?? max;
  const indentFor = (s: number) => (marker === 'none' ? 0 : marker === 'number' ? s * 1.9 : s * 1.25);
  const gapFor = (s: number) => o.gap ?? s * 0.75;
  const total = (s: number) => values.reduce((sum, v) => sum + heightAt(ctx, v, s, o.w - indentFor(s), 'body', lh), 0) + gapFor(s) * (values.length - 1);
  while (!o.size && size > min && total(size) > o.h) size -= 2;
  if (total(size) > o.h) ctx.warnings.push('This list is too long for one slide. Split it or shorten the points.');
  const indent = indentFor(size);
  const gap = gapFor(size);
  let y = o.y;
  const used = total(size);
  if (o.vcenter && used < o.h) y += Math.min((o.h - used) / 2, sz(ctx, 80));
  const boxes: Box[] = [];
  entries.forEach(({ value, i }, k) => {
    const h = heightAt(ctx, value, size, o.w - indent, 'body', lh);
    const step = o.reveal ? (o.startStep ?? 1) + k : undefined;
    const lineMid = y + (size * lh) / 2;
    // Markers move with their item when it is dragged on the canvas.
    const item = `${o.bindKey}-${i}`;
    if (marker === 'dot') {
      const d = Math.round(size * 0.3);
      boxes.push(shape({ id: `${o.bindKey}-m${i}`, shape: 'ellipse', x: o.x + 4, y: lineMid - d / 2, w: d, h: d, fill: o.markerColor ?? ctx.theme.colors.accent, step, moveWith: item }));
    } else if (marker === 'number') {
      const d = Math.round(size * 1.35);
      boxes.push(shape({ id: `${o.bindKey}-m${i}`, shape: 'ellipse', x: o.x, y: lineMid - d / 2, w: d, h: d, fill: o.markerColor ?? ctx.theme.colors.accent, step, moveWith: item }));
      boxes.push({
        type: 'text', id: `${o.bindKey}-n${i}`, x: o.x, y: lineMid - d / 2, w: d, h: d, text: String(k + 1), step, moveWith: item,
        style: { font: 'body', size: Math.round(size * 0.72), weight: 700, color: ctx.theme.colors.onAccent, align: 'center', valign: 'middle', lineHeight: 1 },
      });
    } else if (marker === 'check') {
      const d = Math.round(size * 1.05);
      boxes.push(shape({ id: `${o.bindKey}-m${i}`, shape: 'ellipse', x: o.x, y: lineMid - d / 2, w: d, h: d, fill: o.markerColor ?? ctx.theme.colors.accent, step, moveWith: item }));
      boxes.push({
        type: 'text', id: `${o.bindKey}-c${i}`, x: o.x, y: lineMid - d / 2, w: d, h: d, text: '✓', step, moveWith: item,
        style: { font: 'body', size: Math.round(size * 0.66), weight: 800, color: ctx.theme.colors.onAccent, align: 'center', valign: 'middle', lineHeight: 1 },
      });
    }
    boxes.push({
      type: 'text', id: item, x: o.x + indent, y, w: o.w - indent, h: Math.ceil(h), text: value, step, bind: `${o.bindKey}.${i}`,
      style: { font: 'body', size, weight: fontWeight(ctx.theme, 'body'), color: o.color ?? ctx.theme.colors.ink, align: 'left', valign: 'top', lineHeight: lh },
    });
    y += h + gap;
  });
  return boxes;
}

/** Margin decoration for the theme. Kept outside the safe area wherever possible. */
export function decorate(ctx: LayoutContext, mode: 'content' | 'title' | 'section'): Box[] {
  const logo = mode === 'section' ? null : logoBox(ctx, mode);
  const boxes = decoration(ctx, mode);
  if (!logo) return boxes;
  // Small ornaments that would sit under the logo make way for it.
  const pad = 16;
  const clear = boxes.filter((b) => b.w > 120 || b.h > 120
    || b.x > logo.x + logo.w + pad || b.x + b.w < logo.x - pad || b.y > logo.y + logo.h + pad || b.y + b.h < logo.y - pad);
  return [...clear, logo];
}

function decoration(ctx: LayoutContext, mode: 'content' | 'title' | 'section'): Box[] {
  const c = ctx.theme.colors;
  const big = mode === 'title';
  switch (ctx.theme.decoration) {
    case 'corner':
      return mode === 'section' ? [] : [
        shape({ id: 'deco-a', shape: 'ellipse', x: CANVAS_W - (big ? 260 : 110), y: -(big ? 260 : 110), w: big ? 520 : 220, h: big ? 520 : 220, fill: c.accent2 }),
        shape({ id: 'deco-b', shape: 'ellipse', x: CANVAS_W - (big ? 330 : 150), y: big ? 300 : 70, w: big ? 36 : 22, h: big ? 36 : 22, fill: c.accent }),
      ];
    case 'band':
      return [
        shape({ id: 'deco-a', shape: 'rect', x: 0, y: CANVAS_H - 18, w: big ? CANVAS_W : 360, h: 18, fill: mode === 'section' ? c.accent2 : c.accent }),
        shape({ id: 'deco-b', shape: 'rect', x: big ? CANVAS_W - 220 : 360, y: CANVAS_H - 18, w: 120, h: 18, fill: c.accent2 }),
      ];
    case 'dots': {
      const dots: Box[] = [];
      const cols = big ? 7 : 5;
      for (let r = 0; r < 3; r++) for (let k = 0; k < cols; k++) {
        dots.push(shape({ id: `deco-${r}-${k}`, shape: 'ellipse', x: CANVAS_W - 70 - k * 34, y: 40 + r * 34, w: 10, h: 10, fill: mode === 'section' ? c.sectionInk : c.muted, opacity: 0.35 }));
      }
      return dots;
    }
    case 'grid':
      return mode === 'section' ? [] : [
        shape({ id: 'deco-a', shape: 'ellipse', x: CANVAS_W - (big ? 640 : 360), y: CANVAS_H - (big ? 420 : 200), w: big ? 900 : 560, h: big ? 900 : 560, fill: c.accent2, opacity: 0.85 }),
        shape({ id: 'deco-b', shape: 'rect', x: M.x, y: 52, w: 72, h: 8, fill: c.accent, radius: 4 }),
      ];
    case 'blobs':
      return [
        shape({ id: 'deco-a', shape: 'ellipse', x: CANVAS_W - (big ? 380 : 170), y: -(big ? 240 : 150), w: big ? 620 : 300, h: big ? 620 : 300, fill: mode === 'section' ? c.surface : c.accent2, opacity: mode === 'section' ? 0.5 : 0.9 }),
        shape({ id: 'deco-b', shape: 'ellipse', x: -(big ? 200 : 110), y: CANVAS_H - (big ? 230 : 120), w: big ? 420 : 220, h: big ? 420 : 220, fill: c.accent, opacity: mode === 'section' ? 0.35 : 0.22 }),
      ];
    case 'confetti':
      return mode === 'content'
        ? [
          motif(ctx, mode, 'a', 'confetti', topX(ctx, 'right', 420), 0, 420, 96, 3),
          motif(ctx, mode, 'b', 'confetti', 0, 640, 128, 440, 4),
          motif(ctx, mode, 'c', 'confetti', M.right, 600, 128, 480, 5),
        ]
        : [
          motif(ctx, mode, 'a', 'confetti', CANVAS_W - 860, 0, 860, 540, 1),
          motif(ctx, mode, 'b', 'confetti', 0, CANVAS_H - 360, 600, 360, 2),
        ];
    case 'waves':
      return mode === 'content'
        ? [motif(ctx, mode, 'a', 'waves', topX(ctx, 'left', 1100), 0, 1100, 84, 1, 'y')]
        : [motif(ctx, mode, 'a', 'waves', 0, CANVAS_H - (big ? 300 : 260), CANVAS_W, big ? 300 : 260, 1)];
    case 'sprigs':
      return mode === 'content'
        ? [
          motif(ctx, mode, 'a', 'sprigs', 0, 580, 128, 500, 1),
          motif(ctx, mode, 'b', 'sprigs', M.right, 0, 128, 400, 2, 'y'),
        ]
        : [
          motif(ctx, mode, 'a', 'sprigs', CANVAS_W - 500, CANVAS_H - 500, 500, 500, 1),
          motif(ctx, mode, 'b', 'sprigs', CANVAS_W - 320, 0, 320, 320, 2, 'y'),
        ];
    case 'sparkles':
      return mode === 'content'
        ? [
          motif(ctx, mode, 'a', 'sparkles', topX(ctx, 'right', 420), 0, 420, 96, 1),
          motif(ctx, mode, 'b', 'sparkles', M.right, 620, 128, 360, 2),
        ]
        : [
          motif(ctx, mode, 'a', 'sparkles', CANVAS_W - 760, 0, 760, 520, 1),
          motif(ctx, mode, 'b', 'sparkles', CANVAS_W - 380, CANVAS_H - 260, 380, 260, 2),
        ];
    case 'ribbons':
      return mode === 'content'
        ? [motif(ctx, mode, 'a', 'ribbons', topX(ctx, 'left', 1200), 0, 1200, 88, 1)]
        : [motif(ctx, mode, 'a', 'ribbons', 0, CANVAS_H - (big ? 360 : 300), CANVAS_W, big ? 360 : 300, 1)];
    case 'mosaic':
      return mode === 'content'
        ? [
          motif(ctx, mode, 'a', 'mosaic', topX(ctx, 'right', 380), 0, 380, 96, 1, topSide(ctx, 'right') === 'right' ? undefined : 'x'),
          motif(ctx, mode, 'b', 'mosaic', 0, 760, 128, 320, 2, 'xy'),
        ]
        : [
          motif(ctx, mode, 'a', 'mosaic', CANVAS_W - 620, 0, 620, 620, 1),
          motif(ctx, mode, 'b', 'mosaic', CANVAS_W - 340, CANVAS_H - 340, 340, 340, 2, 'y'),
        ];
    case 'circuit':
      return mode === 'content'
        ? [
          motif(ctx, mode, 'a', 'circuit', M.right, 0, 128, 420, 1),
          motif(ctx, mode, 'b', 'circuit', M.right, 660, 128, 420, 2),
        ]
        : [
          motif(ctx, mode, 'a', 'circuit', CANVAS_W - 820, 0, 820, 480, 1),
          motif(ctx, mode, 'b', 'circuit', CANVAS_W - 700, CANVAS_H - 360, 700, 360, 2, 'y'),
        ];
    default:
      return [];
  }
}

/** Colours a decoration motif is drawn in: the look's accents, or the section divider's ink. */
function decorColors(ctx: LayoutContext, mode: 'content' | 'title' | 'section'): DecorColors {
  const c = ctx.theme.colors;
  if (mode === 'section') return { a: c.sectionInk, b: c.surface, c: c.sectionInk };
  return { a: c.accent, b: c.accent2, c: c.muted };
}

/** A decoration motif as an image box. The part picks the box id and, with the seed, the picture. */
function motif(ctx: LayoutContext, mode: 'content' | 'title' | 'section', part: string, id: DecorMotif, x: number, y: number, w: number, h: number, seed: number, flip?: 'x' | 'y' | 'xy'): ImageBox {
  return { type: 'image', id: `deco-${id}-${part}`, src: decorDataUrl(id, decorColors(ctx, mode), w, h, seed, flip), x, y, w, h, fit: 'contain' };
}

/** Which side the logo leaves free along the top edge, starting from the side you would like. */
function topSide(ctx: LayoutContext, prefer: 'left' | 'right'): 'left' | 'right' {
  const pos = ctx.theme.logo ? ctx.theme.logoPosition ?? 'top-right' : '';
  return pos === `top-${prefer}` ? (prefer === 'left' ? 'right' : 'left') : prefer;
}

/** Left edge of a w-wide ornament hugging the top-left or top-right corner, whichever the logo leaves free. */
function topX(ctx: LayoutContext, prefer: 'left' | 'right', w: number) {
  return topSide(ctx, prefer) === 'right' ? CANVAS_W - w : 0;
}

/** The theme's logo in its corner, sized to the image's proportions. */
export function logoBox(ctx: LayoutContext, mode: 'content' | 'title'): ImageBox | null {
  const src = imageSrc(ctx, ctx.theme.logo);
  if (!src) return null;
  const big = mode === 'title';
  const h = big ? 60 : 50;
  const aspect = ctx.theme.logoAspect && Number.isFinite(ctx.theme.logoAspect) ? ctx.theme.logoAspect : 2;
  const w = Math.round(Math.min(big ? 340 : 280, Math.max(h * 0.6, h * aspect)));
  const pos = ctx.theme.logoPosition ?? 'top-right';
  const x = pos.endsWith('left') ? M.x : M.right - w;
  const y = pos.startsWith('top') ? (big ? 44 : 30) : CANVAS_H - (big ? 28 : 36) - h;
  return { type: 'image', id: 'logo', src, x, y, w, h, fit: 'contain', alt: `${ctx.theme.name} logo` };
}

/** The footer line and a quiet slide number, kept clear of a logo at the bottom. */
export function footer(ctx: LayoutContext): Box[] {
  const boxes: Box[] = [];
  const logo = logoBox(ctx, 'content');
  const pos = ctx.theme.logoPosition ?? 'top-right';
  const bottomLogo = logo && pos.startsWith('bottom') ? logo : null;
  const y = CANVAS_H - 72;
  let right = M.right;
  if (bottomLogo && pos === 'bottom-right') right = bottomLogo.x - 32;
  if (ctx.slideCount >= 2) {
    boxes.push({
      type: 'text', id: 'page', x: right - 200, y, w: 200, h: 34, text: String(ctx.slideNumber),
      style: { font: 'body', size: 24, weight: 500, color: ctx.theme.colors.muted, align: 'right', valign: 'middle', lineHeight: 1 },
    });
    right -= 120;
  }
  const line = ctx.theme.footerText?.trim();
  if (line) {
    const left = bottomLogo && pos === 'bottom-left' ? bottomLogo.x + bottomLogo.w + 32 : M.x;
    const w = Math.min(1100, right - left - 24);
    if (w > 160) {
      boxes.push(text(ctx, {
        id: 'footer', text: line, x: left, y, w, h: 34, max: 22, min: 16, scaled: false, maxLines: 1,
        color: ctx.theme.colors.muted, valign: 'middle', lh: 1.2,
      }));
    }
  }
  return boxes;
}

export function imageSrc(ctx: LayoutContext, src: unknown): string {
  const value = typeof src === 'string' ? src.trim() : '';
  if (!value) return '';
  return ctx.resolveImage ? ctx.resolveImage(value) : value;
}

/** Reads content fields defensively; content can come from AI, imports or old saves. */
export const read = {
  str(c: Record<string, unknown>, key: string, fallback = '') {
    const v = c[key];
    return typeof v === 'string' ? v : v == null ? fallback : String(v);
  },
  list(c: Record<string, unknown>, key: string): string[] {
    return read.items(c, key).filter((s) => s.trim());
  },
  /** A list as stored, blanks included, so positions match the content (for list() and binds). */
  items(c: Record<string, unknown>, key: string): string[] {
    const v = c[key];
    return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : String(x ?? ''))) : [];
  },
  objects<T extends Record<string, unknown>>(c: Record<string, unknown>, key: string): T[] {
    const v = c[key];
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as T[] : [];
  },
  bool(c: Record<string, unknown>, key: string, fallback = false) {
    const v = c[key];
    return typeof v === 'boolean' ? v : fallback;
  },
  num(c: Record<string, unknown>, key: string, fallback = -1) {
    const v = Number(c[key]);
    return Number.isFinite(v) ? v : fallback;
  },
};
