// Editing on the canvas: moving and resizing boxes, snapping them to lines, and adding
// or deleting the item a box shows. Pure functions, so the rules are easy to test.

import { type Box, CANVAS_H, CANVAS_W } from '../../core/engine/boxes';
import { MIN_BOX, withoutOverrides } from '../../core/engine/overrides';
import { getAt, setAt, splitBind } from '../../core/deck/paths';
import type { Slide } from '../../core/deck/types';
import { M } from '../../core/kinds/kit';
import type { FieldSpec } from '../../core/kinds/types';

type Content = Record<string, unknown>;

export interface Rect { x: number; y: number; w: number; h: number }

/** A resize handle: a corner or the middle of a side, by compass point. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** A line a box snapped to, drawn while dragging. */
export interface Guide { axis: 'x' | 'y'; at: number }

export const CORNERS: Handle[] = ['nw', 'ne', 'se', 'sw'];
/** Sides first, so the corners are drawn on top where their targets meet on a small box. */
export const ALL_HANDLES: Handle[] = ['n', 'e', 's', 'w', ...CORNERS];

/**
 * The handles a box offers. Text takes corners, which scale it, and sides, which rewrap it;
 * everything else takes all eight.
 */
export function handlesFor(box: Box): Handle[] {
  return box.type === 'text' ? ['e', 'w', ...CORNERS] : ALL_HANDLES;
}

/** Corners keep the shape of text and pictures; sides stretch freely. */
export function keepsShape(box: Box, handle: Handle): boolean {
  return CORNERS.includes(handle) && (box.type === 'text' || box.type === 'image' || box.type === 'video');
}

/** Lines a box snaps to: the slide's centre and safe margins, and the edges and centres of the other content boxes. */
export function snapLines(boxes: Box[], skip: Set<string>): { xs: number[]; ys: number[] } {
  const xs = [M.x, CANVAS_W / 2, M.right];
  const ys = [M.top, CANVAS_H / 2, M.bottom];
  for (const b of boxes) {
    if (skip.has(b.id) || !b.bind) continue;
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}

function nearest(values: number[], lines: number[], within: number): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const v of values) for (const at of lines) {
    const delta = at - v;
    if (Math.abs(delta) <= within && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at };
  }
  return best;
}

/** A moved box, pulled onto a line when one of its edges or its centre comes within reach of it. */
export function snapMove(r: Rect, lines: { xs: number[]; ys: number[] }, within: number): { rect: Rect; guides: Guide[] } {
  const sx = nearest([r.x, r.x + r.w / 2, r.x + r.w], lines.xs, within);
  const sy = nearest([r.y, r.y + r.h / 2, r.y + r.h], lines.ys, within);
  const guides: Guide[] = [];
  if (sx) guides.push({ axis: 'x', at: sx.at });
  if (sy) guides.push({ axis: 'y', at: sy.at });
  return { rect: { ...r, x: r.x + (sx?.delta ?? 0), y: r.y + (sy?.delta ?? 0) }, guides };
}

/** A box with one handle dragged by (dx, dy) canvas px. The opposite side or corner stays put. */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, keepShape: boolean): Rect {
  const west = handle.endsWith('w');
  const east = handle.endsWith('e');
  const north = handle.startsWith('n');
  const south = handle.startsWith('s');
  let w = east ? start.w + dx : west ? start.w - dx : start.w;
  let h = south ? start.h + dy : north ? start.h - dy : start.h;
  if (keepShape && (east || west) && (north || south)) {
    // Follow whichever way the pointer moved further, relative to the box's size.
    const s = Math.abs(dx) / start.w >= Math.abs(dy) / start.h ? w / start.w : h / start.h;
    const least = MIN_BOX / Math.min(start.w, start.h);
    w = start.w * Math.max(least, s);
    h = start.h * Math.max(least, s);
  }
  w = Math.max(MIN_BOX, w);
  h = Math.max(MIN_BOX, h);
  return { x: west ? start.x + start.w - w : start.x, y: north ? start.y + start.h - h : start.y, w, h };
}

/** A resized box with its moving edges pulled onto nearby lines. Shape-keeping resizes don't snap. */
export function snapResize(r: Rect, handle: Handle, lines: { xs: number[]; ys: number[] }, within: number): { rect: Rect; guides: Guide[] } {
  const out = { ...r };
  const guides: Guide[] = [];
  if (handle.endsWith('e') || handle.endsWith('w')) {
    const edge = handle.endsWith('e') ? r.x + r.w : r.x;
    const s = nearest([edge], lines.xs, within);
    if (s) {
      guides.push({ axis: 'x', at: s.at });
      if (handle.endsWith('e')) out.w = Math.max(MIN_BOX, r.w + s.delta);
      else { out.x = r.x + s.delta; out.w = Math.max(MIN_BOX, r.w - s.delta); }
    }
  }
  if (handle.startsWith('n') || handle.startsWith('s')) {
    const edge = handle.startsWith('s') ? r.y + r.h : r.y;
    const s = nearest([edge], lines.ys, within);
    if (s) {
      guides.push({ axis: 'y', at: s.at });
      if (handle.startsWith('s')) out.h = Math.max(MIN_BOX, r.h + s.delta);
      else { out.y = r.y + s.delta; out.h = Math.max(MIN_BOX, r.h - s.delta); }
    }
  }
  return { rect: out, guides };
}

/** Where a dragged box's centre lands, as whole percentages across and down an area (0 to 100). */
export function percentIn(r: Rect, area: Rect): { x: number; y: number } {
  const pct = (v: number) => Math.round(Math.max(0, Math.min(100, v * 100)));
  return { x: pct((r.x + r.w / 2 - area.x) / area.w), y: pct((r.y + r.h / 2 - area.y) / area.h) };
}

// ─── The item a box shows ─────────────────────────────────────────────

type ListSpec = Extract<FieldSpec, { type: 'list' }>;
type ObjectsSpec = Extract<FieldSpec, { type: 'objects' }>;

export interface ItemRef {
  key: string;
  index: number;
  spec: ListSpec | ObjectsSpec;
  /** How many items the list holds now. */
  count: number;
}

/** The list a bind is an item of: "bullets.2" is item 2 of Points, "stats.1.value" item 1 of Figures. */
export function itemOf(fields: FieldSpec[], content: Content, bind: string): ItemRef | null {
  const [key, index] = splitBind(bind);
  if (typeof key !== 'string' || typeof index !== 'number') return null;
  const spec = fields.find((f) => f.key === key);
  if (spec?.type !== 'list' && spec?.type !== 'objects') return null;
  const list = content[key];
  return { key, index, spec, count: Array.isArray(list) ? list.length : 0 };
}

/** Moves a list's mark ("correct" or "current") when items are added or removed above it. */
export function shiftMark(content: Content, spec: FieldSpec | undefined, at: number, delta: 1 | -1): Content {
  if (spec?.type !== 'list' || !spec.correctKey) return content;
  const c = Number(content[spec.correctKey] ?? -1);
  if (!(c >= 0)) return content;
  const next = delta === 1 ? (c > at ? c + 1 : c) : (c === at ? -1 : c > at ? c - 1 : c);
  return { ...content, [spec.correctKey]: next };
}

export function canAdd(item: ItemRef): boolean {
  return item.count < (item.spec.max ?? 10);
}

export function canDelete(item: ItemRef): boolean {
  return item.count > (item.spec.type === 'objects' ? Math.max(item.spec.min ?? 0, 0) : 0);
}

/**
 * The content with a new item after the given one, and the bind to type into.
 * A new list item starts empty; a new object starts with its first text field filled
 * with a hint (its placeholder or the item's name), selected so typing replaces it.
 */
export function addItemAfter(content: Content, item: ItemRef): { content: Content; bind: string; hint: string } {
  const list = Array.isArray(content[item.key]) ? [...(content[item.key] as unknown[])] : [];
  const at = Math.min(item.index + 1, list.length);
  if (item.spec.type === 'list') {
    list.splice(at, 0, '');
    return { content: shiftMark({ ...content, [item.key]: list }, item.spec, item.index, 1), bind: `${item.key}.${at}`, hint: '' };
  }
  const blank: Record<string, unknown> = {};
  for (const f of item.spec.fields) blank[f.key] = f.type === 'toggle' ? false : '';
  const first = item.spec.fields.find((f) => f.type === 'text' || f.type === 'textarea');
  const hint = first ? (('placeholder' in first && first.placeholder) || item.spec.itemLabel) : '';
  if (first) blank[first.key] = hint;
  list.splice(at, 0, blank);
  return { content: { ...content, [item.key]: list }, bind: first ? `${item.key}.${at}.${first.key}` : `${item.key}.${at}`, hint };
}

/** The content without the item. */
export function removeItemAt(content: Content, item: ItemRef): Content {
  const list = Array.isArray(content[item.key]) ? [...(content[item.key] as unknown[])] : [];
  list.splice(item.index, 1);
  return shiftMark({ ...content, [item.key]: list }, item.spec, item.index, -1);
}

/** The content with a plain field emptied: a title cleared, a picture removed. */
export function clearField(content: Content, bind: string): Content {
  const v = getAt(content, bind);
  return setAt(content, bind, typeof v === 'boolean' ? false : '');
}

/**
 * The slide with its moved list items following their items when one is added (+1) or removed (-1)
 * at `at`. List items are drawn as boxes named "<list>-<index>", so their overrides carry over.
 */
export function shiftItemOverrides(slide: Slide, key: string, at: number, delta: 1 | -1): Slide {
  if (!slide.overrides) return slide;
  const next: NonNullable<Slide['overrides']> = {};
  for (const [id, o] of Object.entries(slide.overrides)) {
    const m = id.startsWith(`${key}-`) ? /^\d+$/.exec(id.slice(key.length + 1)) : null;
    const i = m ? Number(m[0]) : -1;
    if (i < 0) next[id] = o;
    else if (delta === -1 && i === at) continue;
    else if (delta === -1 && i > at) next[`${key}-${i - 1}`] = o;
    else if (delta === 1 && i > at) next[`${key}-${i + 1}`] = o;
    else next[id] = o;
  }
  return Object.keys(next).length ? { ...slide, overrides: next } : withoutOverrides(slide);
}
