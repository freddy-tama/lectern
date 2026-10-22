// Boxes moved and resized by hand. The layout places every box first; a slide's
// overrides then put the boxes it names somewhere else. This runs inside
// layoutSlide, so the studio, present mode, phones, thumbnails and PowerPoint
// all show the same arrangement.

import type { BoxOverride, Slide } from '../deck/types';
import { type LayoutContext, fam } from '../kinds/kit';
import { type Box, CANVAS_H, CANVAS_W, type TextBox } from './boxes';
import { fitText } from './measure';

/** Smallest box someone can resize to, in canvas px. */
export const MIN_BOX = 24;

/** An override with sensible numbers, or null when it can't be used. */
export function cleanOverride(o: unknown): BoxOverride | null {
  if (!o || typeof o !== 'object') return null;
  const v = o as Record<string, unknown>;
  const [x, y, w, h] = [v.x, v.y, v.w, v.h].map(Number);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  const scale = Number(v.scale);
  const width = Math.round(Math.min(CANVAS_W * 2, Math.max(MIN_BOX, w)));
  const height = Math.round(Math.min(CANVAS_H * 2, Math.max(MIN_BOX, h)));
  return {
    // Keep at least a corner of the box on the slide, so it can always be grabbed again.
    x: Math.round(Math.min(CANVAS_W - MIN_BOX, Math.max(MIN_BOX - width, x))),
    y: Math.round(Math.min(CANVAS_H - MIN_BOX, Math.max(MIN_BOX - height, y))),
    w: width,
    h: height,
    ...(Number.isFinite(scale) && scale > 0 && Math.abs(scale - 1) > 0.001 ? { scale: Math.round(Math.min(6, Math.max(0.2, scale)) * 1000) / 1000 } : {}),
  };
}

export function hasOverrides(slide: Pick<Slide, 'overrides'>): boolean {
  return Boolean(slide.overrides && Object.keys(slide.overrides).length);
}

/** The slide with one box placed by hand, or put back where the layout places it (null). */
export function withOverride<S extends Slide>(slide: S, boxId: string, o: BoxOverride | null): S {
  const rest = { ...(slide.overrides ?? {}) };
  delete rest[boxId];
  const clean = o ? cleanOverride(o) : null;
  if (clean) rest[boxId] = clean;
  if (!Object.keys(rest).length) return withoutOverrides(slide);
  return { ...slide, overrides: rest };
}

/** The slide with every box back where its layout places it. */
export function withoutOverrides<S extends Slide>(slide: S): S {
  if (!slide.overrides) return slide;
  const next = { ...slide };
  delete next.overrides;
  return next;
}

/** Text at a size, fitted again into a box someone resized. It grows down when it needs more lines. */
function refit(ctx: LayoutContext, box: TextBox, o: BoxOverride, scale: number): TextBox {
  const s = box.style;
  const size = Math.max(8, Math.round(s.size * scale));
  const lh = s.lineHeight ?? 1.3;
  const value = s.uppercase ? box.text.toUpperCase() : box.text;
  if (!value.trim()) return { ...box, ...pos(o), style: { ...s, size } };
  const fit = fitText(value, {
    family: fam(ctx, s.font), weight: s.weight ?? 400, italic: s.italic, width: o.w,
    height: Math.max(o.h, CANVAS_H - o.y), maxSize: size, minSize: Math.max(10, Math.round(size * 0.5)), lineHeight: lh, measure: ctx.measure,
  });
  return { ...box, ...pos(o), h: Math.max(o.h, Math.ceil(fit.height)), style: { ...s, size: fit.size }, overflow: fit.overflow };
}

function pos(o: BoxOverride) {
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}

/** A box at a new place and size. Text fits itself again; tables and charts keep their proportions. */
function place(ctx: LayoutContext, box: Box, o: BoxOverride, scale: number): Box {
  if (box.type === 'text') return refit(ctx, box, o, scale);
  if (box.type === 'table') {
    const sx = o.w / box.w;
    const sy = o.h / box.h;
    return {
      ...box, ...pos(o),
      colWidths: box.colWidths.map((w) => w * sx),
      rowHeights: box.rowHeights.map((h) => h * sy),
      fontSize: Math.max(8, Math.round(box.fontSize * scale)),
    };
  }
  if (box.type === 'chart') return { ...box, ...pos(o), fontSize: Math.max(8, Math.round(box.fontSize * scale)) };
  return { ...box, ...pos(o) };
}

/**
 * The boxes with the slide's overrides applied. Boxes that move with another (a list marker
 * with its item) keep their offset from it, scaled with it.
 */
export function applyOverrides(boxes: Box[], overrides: Record<string, BoxOverride> | undefined, ctx: LayoutContext): Box[] {
  if (!overrides) return boxes;
  const valid = new Map<string, BoxOverride>();
  for (const [id, o] of Object.entries(overrides)) {
    const clean = cleanOverride(o);
    if (clean) valid.set(id, clean);
  }
  if (!valid.size) return boxes;
  const original = new Map(boxes.map((b) => [b.id, b]));
  return boxes.map((box) => {
    const own = valid.get(box.id);
    if (own) return place(ctx, box, own, own.scale ?? 1);
    const lead = box.moveWith ? original.get(box.moveWith) : undefined;
    const o = lead ? valid.get(lead.id) : undefined;
    if (!lead || !o) return box;
    const s = o.scale ?? 1;
    const follow: BoxOverride = {
      x: o.x + (box.x - lead.x) * s,
      y: o.y + (box.y - lead.y) * s,
      w: box.w * s,
      h: box.h * s,
    };
    if (box.type === 'text') return { ...box, ...follow, style: { ...box.style, size: Math.max(8, Math.round(box.style.size * s)) } };
    return place(ctx, box, follow, s);
  });
}
