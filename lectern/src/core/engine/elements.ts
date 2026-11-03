// Free elements: pictures, drawings, shapes, text and decorations placed anywhere on a slide,
// over or under what its layout draws. They become ordinary boxes inside layoutSlide, so the
// studio, present mode, phones, thumbnails and PowerPoint all show them the same way.

import type { ColorRef, Slide, SlideElement } from '../deck/types';
import { uid } from '../deck/types';
import { type LayoutContext, text } from '../kinds/kit';
import { type Box, CANVAS_H, CANVAS_W } from './boxes';
import { decorDataUrl, isDecorMotif } from './decor';
import type { Theme } from './themes';

/** Box ids of elements start with this, so the studio and the AI can tell them from the layout's own boxes. */
export const ELEMENT_BOX = 'el-';
/** The bind of an element's box: "@<element id>". Clicking it on the canvas selects the element. */
export const ELEMENT_BIND = '@';
/** The most elements one slide keeps. */
export const MAX_ELEMENTS = 40;

const TOKENS = ['accent', 'accent2', 'ink', 'muted', 'surface', 'bg', 'line', 'onAccent', 'sectionBg', 'sectionInk', 'good'] as const;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export const isColorRef = (v: unknown): v is ColorRef => typeof v === 'string' && ((TOKENS as readonly string[]).includes(v) || HEX.test(v));

/** A colour by theme name or hex, as drawn. */
export function colorOf(theme: Theme, ref: ColorRef | undefined, fallback: string): string {
  if (!ref) return fallback;
  if ((TOKENS as readonly string[]).includes(ref)) return theme.colors[ref as (typeof TOKENS)[number]];
  return HEX.test(ref) ? ref : fallback;
}

export const elementBoxId = (id: string) => `${ELEMENT_BOX}${id}`;
export const elementBind = (id: string) => `${ELEMENT_BIND}${id}`;
/** The element id a bind or box id names, or null. */
export function elementIdOf(ref: string | undefined | null): string | null {
  if (!ref) return null;
  if (ref.startsWith(ELEMENT_BIND)) return ref.slice(ELEMENT_BIND.length).split('.')[0] || null;
  if (ref.startsWith(ELEMENT_BOX)) return ref.slice(ELEMENT_BOX.length).replace(/-bg$/, '') || null;
  return null;
}

const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const picture = (v: unknown) => {
  const s = str(v, 2_000_000).trim();
  return /^asset:[A-Za-z0-9_-]{1,80}$/.test(s) || /^data:image\/[a-z0-9.+-]+[;,]/i.test(s) || /^https?:\/\/\S+$/i.test(s) ? s : '';
};

/** An element with sensible numbers, or null when it can't be drawn. */
export function cleanElement(raw: unknown): SlideElement | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = /^[A-Za-z0-9_-]{1,40}$/.test(String(o.id ?? '')) ? String(o.id) : uid('e');
  const w = Math.round(num(o.w, 8, CANVAS_W * 2, 400));
  const h = Math.round(num(o.h, o.type === 'shape' && o.shape === 'line' ? 0 : 8, CANVAS_H * 2, 300));
  const base = {
    id,
    // Keep at least a corner on the slide, so it can always be grabbed again.
    x: Math.round(num(o.x, 24 - w, CANVAS_W - 24, 200)),
    y: Math.round(num(o.y, 24 - Math.max(h, 24), CANVAS_H - 24, 200)),
    w,
    h,
    ...(o.layer === 'back' ? { layer: 'back' as const } : {}),
    ...(o.opacity !== undefined && Number(o.opacity) < 1 ? { opacity: Math.round(num(o.opacity, 0.05, 1, 1) * 100) / 100 } : {}),
    ...(Number.isInteger(o.step) && Number(o.step) > 0 ? { step: Math.min(20, Number(o.step)) } : {}),
  };
  switch (o.type) {
    case 'picture': {
      const src = picture(o.src);
      if (!src) return null;
      return {
        ...base, type: 'picture', src,
        ...(o.fit === 'cover' ? { fit: 'cover' as const } : {}),
        ...(Number(o.radius) > 0 ? { radius: Math.round(num(o.radius, 0, 600, 0)) } : {}),
        ...(str(o.alt, 300).trim() ? { alt: str(o.alt, 300).trim() } : {}),
      };
    }
    case 'shape': {
      const shape = o.shape === 'ellipse' || o.shape === 'line' ? o.shape : 'rect';
      return {
        ...base, type: 'shape', shape,
        ...(isColorRef(o.fill) ? { fill: o.fill } : shape === 'line' ? {} : { fill: 'accent' }),
        ...(isColorRef(o.stroke) ? { stroke: o.stroke } : shape === 'line' ? { stroke: 'accent' } : {}),
        ...(Number(o.strokeWidth) > 0 ? { strokeWidth: Math.round(num(o.strokeWidth, 1, 80, 4)) } : {}),
        ...(Number(o.radius) > 0 ? { radius: Math.round(num(o.radius, 0, 600, 0)) } : {}),
        ...(o.dash === true ? { dash: true } : {}),
      };
    }
    case 'text': {
      const value = str(o.text, 2_000);
      return {
        ...base, type: 'text', text: value,
        ...(Number(o.size) > 0 ? { size: Math.round(num(o.size, 12, 260, 40)) } : {}),
        ...(isColorRef(o.color) ? { color: o.color } : {}),
        ...(o.font === 'display' || o.font === 'mono' || o.font === 'body' ? { font: o.font } : {}),
        ...(Number(o.weight) >= 100 ? { weight: Math.round(num(o.weight, 100, 900, 400) / 100) * 100 } : {}),
        ...(o.italic === true ? { italic: true } : {}),
        ...(o.align === 'center' || o.align === 'right' || o.align === 'left' ? { align: o.align } : {}),
        ...(o.valign === 'middle' || o.valign === 'bottom' || o.valign === 'top' ? { valign: o.valign } : {}),
        ...(isColorRef(o.fill) ? { fill: o.fill } : {}),
      };
    }
    case 'decor': {
      const motif = o.motif;
      if (!isDecorMotif(motif)) return null;
      const colors = Array.isArray(o.colors) ? o.colors.filter(isColorRef).slice(0, 3) : [];
      return {
        ...base, type: 'decor', motif,
        ...(colors.length ? { colors } : {}),
        ...(Number.isInteger(o.seed) ? { seed: Math.abs(Number(o.seed)) % 100_000 } : {}),
        ...(o.flip === 'x' || o.flip === 'y' || o.flip === 'xy' ? { flip: o.flip } : {}),
      };
    }
    default:
      return null;
  }
}

/** A slide's elements, cleaned. Ids stay unique. */
export function cleanElements(raw: unknown): SlideElement[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, MAX_ELEMENTS).flatMap((e) => {
    const el = cleanElement(e);
    if (!el) return [];
    if (seen.has(el.id)) el.id = uid('e');
    seen.add(el.id);
    return [el];
  });
}

/** The boxes of one element. Text with a card behind it is two boxes that move together. */
export function elementBoxes(el: SlideElement, ctx: LayoutContext): Box[] {
  const c = ctx.theme.colors;
  const common = { id: elementBoxId(el.id), x: el.x, y: el.y, w: el.w, h: el.h, bind: elementBind(el.id), ...(el.step ? { step: el.step } : {}), ...(el.opacity !== undefined ? { opacity: el.opacity } : {}) };
  switch (el.type) {
    case 'picture': {
      const src = ctx.resolveImage && el.src.startsWith('asset:') ? ctx.resolveImage(el.src) : el.src;
      return [{ ...common, type: 'image', src, fit: el.fit ?? 'contain', ...(el.radius ? { radius: el.radius } : {}), alt: el.alt ?? '' }];
    }
    case 'shape':
      return [{
        ...common, type: 'shape', shape: el.shape,
        ...(el.shape === 'line' ? {} : { fill: colorOf(ctx.theme, el.fill, c.accent) }),
        ...(el.stroke || el.shape === 'line' ? { stroke: colorOf(ctx.theme, el.stroke, c.accent), strokeWidth: el.strokeWidth ?? (el.shape === 'line' ? 4 : 3) } : {}),
        ...(el.radius ? { radius: el.radius } : {}),
        ...(el.dash ? { dash: true } : {}),
      }];
    case 'text': {
      const pad = el.fill ? Math.round(Math.min(48, Math.max(16, (el.size ?? 40) * 0.6))) : 0;
      const size = el.size ?? 40;
      const box = text(ctx, {
        id: common.id, text: el.text, x: el.x + pad, y: el.y + pad, w: Math.max(8, el.w - pad * 2), h: Math.max(8, el.h - pad * 2),
        role: el.font ?? 'body', max: size, min: Math.max(12, Math.round(size * 0.55)), weight: el.weight, italic: el.italic,
        color: colorOf(ctx.theme, el.color, c.ink), align: el.align, valign: el.valign ?? (el.fill ? 'middle' : 'top'),
        scaled: false, step: el.step, bind: common.bind,
      });
      const shown = { ...box, ...(el.opacity !== undefined ? { opacity: el.opacity } : {}) };
      if (!el.fill) return [{ ...shown, x: el.x, y: el.y, w: el.w, h: el.h }];
      return [
        { id: `${common.id}-bg`, type: 'shape', shape: 'rect', x: el.x, y: el.y, w: el.w, h: el.h, fill: colorOf(ctx.theme, el.fill, c.surface), radius: ctx.theme.radius, moveWith: common.id, bind: common.bind, ...(el.step ? { step: el.step } : {}), ...(el.opacity !== undefined ? { opacity: el.opacity } : {}) },
        shown,
      ];
    }
    case 'decor': {
      const [a, b, third] = [el.colors?.[0], el.colors?.[1], el.colors?.[2]];
      const colors = { a: colorOf(ctx.theme, a, c.accent), b: colorOf(ctx.theme, b, c.accent2), c: colorOf(ctx.theme, third, c.muted) };
      return [{ ...common, type: 'image', src: decorDataUrl(el.motif as Parameters<typeof decorDataUrl>[0], colors, Math.max(8, el.w), Math.max(8, el.h), el.seed ?? 1, el.flip), fit: 'contain', alt: '' }];
    }
  }
}

/** The boxes of a slide's elements: those that go under its content, and those on top. */
export function layoutElements(slide: Pick<Slide, 'elements'>, ctx: LayoutContext): { back: Box[]; front: Box[] } {
  const back: Box[] = [];
  const front: Box[] = [];
  for (const el of slide.elements ?? []) {
    try {
      (el.layer === 'back' ? back : front).push(...elementBoxes(el, ctx));
    } catch {
      // One broken element never takes the slide down with it.
    }
  }
  return { back, front };
}

// ─── Changing a slide's elements ─────────────────────────────────────

export function findElement(slide: Pick<Slide, 'elements'>, id: string): SlideElement | undefined {
  return slide.elements?.find((e) => e.id === id);
}

/** The slide with an element added on top (or at the back). */
export function withElement<S extends Slide>(slide: S, el: SlideElement): S {
  const clean = cleanElement(el);
  if (!clean) return slide;
  const rest = (slide.elements ?? []).filter((e) => e.id !== clean.id);
  return { ...slide, elements: [...rest, clean].slice(-MAX_ELEMENTS) };
}

/** The slide with one element changed. */
export function updateElement<S extends Slide>(slide: S, id: string, patch: Partial<SlideElement>): S {
  if (!slide.elements?.some((e) => e.id === id)) return slide;
  return {
    ...slide,
    elements: slide.elements.flatMap((e) => {
      if (e.id !== id) return [e];
      const next = cleanElement({ ...e, ...patch, id: e.id, type: e.type });
      return next ? [next] : [e];
    }),
  };
}

/** The slide without one element. */
export function withoutElement<S extends Slide>(slide: S, id: string): S {
  if (!slide.elements?.some((e) => e.id === id)) return slide;
  const elements = slide.elements.filter((e) => e.id !== id);
  if (elements.length) return { ...slide, elements };
  const next: Slide = { ...slide };
  delete next.elements;
  return next as S;
}

/** Moves an element to the top or the bottom of its layer, or across to the other layer. */
export function restackElement<S extends Slide>(slide: S, id: string, to: 'front' | 'back'): S {
  const el = findElement(slide, id);
  if (!el) return slide;
  const rest = (slide.elements ?? []).filter((e) => e.id !== id);
  const moved: SlideElement = { ...el };
  if (to === 'back') moved.layer = 'back';
  else delete moved.layer;
  return { ...slide, elements: to === 'back' ? [moved, ...rest] : [...rest, moved] };
}

/** A new element's default place: centred on the slide at a size that suits its kind. */
export function centred(w: number, h: number): { x: number; y: number; w: number; h: number } {
  return { x: Math.round((CANVAS_W - w) / 2), y: Math.round((CANVAS_H - h) / 2), w, h };
}
