// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CANVAS_W, type Box } from '../src/core/engine/boxes';
import { MIN_BOX } from '../src/core/engine/overrides';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { M } from '../src/core/kinds/kit';
import { getKind } from '../src/core/kinds/registry';
import {
  addItemAfter, canAdd, canDelete, clearField, handlesFor, itemOf, keepsShape, percentIn, removeItemAt, resizeRect, shiftItemOverrides, snapLines, snapMove, snapResize,
} from '../src/features/studio/canvas';

registerCoreKinds();

const rect = (id: string, x: number, y: number, w: number, h: number, bind?: string): Box => ({ type: 'shape', shape: 'rect', id, x, y, w, h, bind });
const kind = (k: string) => getKind(k)!;

describe('moving boxes on the canvas', () => {
  const others = [rect('a', 400, 300, 300, 100, 'title'), rect('deco', 900, 900, 50, 50), rect('me', 0, 0, 10, 10, 'x')];
  const lines = snapLines(others, new Set(['me']));

  it('snaps to the slide centre, the safe margins and other content, not to ornaments or itself', () => {
    expect(lines.xs).toEqual(expect.arrayContaining([M.x, CANVAS_W / 2, M.right, 400, 550, 700]));
    expect(lines.xs).not.toContain(900);
    expect(lines.xs).not.toContain(0);
  });

  it('pulls an edge or the centre onto a line within reach, and says which', () => {
    const out = snapMove({ x: 405, y: 512, w: 200, h: 60 }, lines, 8);
    expect(out.rect.x).toBe(400);
    expect(out.rect.y + out.rect.h / 2).toBe(540);
    expect(out.guides).toEqual([{ axis: 'x', at: 400 }, { axis: 'y', at: 540 }]);
    expect(snapMove({ x: 420, y: 600, w: 200, h: 60 }, lines, 8).guides).toEqual([]);
  });

  it('resizes from any handle, keeping the opposite side put', () => {
    const start = { x: 100, y: 100, w: 400, h: 200 };
    expect(resizeRect(start, 'e', 50, 999, false)).toEqual({ x: 100, y: 100, w: 450, h: 200 });
    expect(resizeRect(start, 'w', 50, 0, false)).toEqual({ x: 150, y: 100, w: 350, h: 200 });
    expect(resizeRect(start, 'n', 0, -40, false)).toEqual({ x: 100, y: 60, w: 400, h: 240 });
    expect(resizeRect(start, 'se', 100, 10, true)).toEqual({ x: 100, y: 100, w: 500, h: 250 });
    expect(resizeRect(start, 'nw', 200, 0, true)).toEqual({ x: 300, y: 200, w: 200, h: 100 });
    expect(resizeRect(start, 'e', -999, 0, false).w).toBe(MIN_BOX);
  });

  it('snaps only the edges a resize moves', () => {
    const out = snapResize({ x: 100, y: 100, w: 295, h: 200 }, 'e', lines, 8);
    expect(out.rect).toEqual({ x: 100, y: 100, w: 300, h: 200 });
    expect(snapResize({ x: 100, y: 100, w: 295, h: 200 }, 'n', lines, 8).rect.w).toBe(295);
  });

  it('gives text corners to scale and sides to rewrap; pictures keep their shape at the corners', () => {
    const t: Box = { type: 'text', id: 't', x: 0, y: 0, w: 10, h: 10, text: 'Hi', style: { font: 'body', size: 20, color: '#000' } };
    expect(handlesFor(t)).toEqual(['e', 'w', 'nw', 'ne', 'se', 'sw']);
    expect(handlesFor(rect('r', 0, 0, 1, 1))).toHaveLength(8);
    expect(keepsShape(t, 'se')).toBe(true);
    expect(keepsShape(t, 'e')).toBe(false);
    expect(keepsShape(rect('r', 0, 0, 1, 1), 'se')).toBe(false);
  });

  it('turns a dragged callout dot into percentages of the screen it sits on', () => {
    expect(percentIn({ x: 140, y: 290, w: 20, h: 20 }, { x: 100, y: 100, w: 200, h: 400 })).toEqual({ x: 25, y: 50 });
    expect(percentIn({ x: -500, y: 900, w: 20, h: 20 }, { x: 100, y: 100, w: 200, h: 400 })).toEqual({ x: 0, y: 100 });
  });
});

describe('adding and deleting from the toolbar', () => {
  it('finds the list a box belongs to, or none for a plain field', () => {
    const c = { bullets: ['A', 'B'], title: 'T' };
    expect(itemOf(kind('bullets').fields, c, 'bullets.1')).toMatchObject({ key: 'bullets', index: 1, count: 2 });
    expect(itemOf(kind('stats').fields, { stats: [{}, {}] }, 'stats.0.value')).toMatchObject({ key: 'stats', index: 0, count: 2 });
    expect(itemOf(kind('bullets').fields, c, 'title')).toBeNull();
  });

  it('adds an empty point after the one picked, moving the agenda mark along', () => {
    const c = { items: ['A', 'B', 'C'], current: 2 };
    const item = itemOf(kind('agenda').fields, c, 'items.0')!;
    const out = addItemAfter(c, item);
    expect(out.content.items).toEqual(['A', '', 'B', 'C']);
    expect(out.content.current).toBe(3);
    expect(out.bind).toBe('items.1');
    expect(out.hint).toBe('');
  });

  it('adds a figure with a hint to type over, from its placeholder', () => {
    const c = { stats: [{ value: '1', label: 'a', detail: '' }] };
    const out = addItemAfter(c, itemOf(kind('stats').fields, c, 'stats.0.label')!);
    expect(out.content.stats).toEqual([{ value: '1', label: 'a', detail: '' }, { value: '71%', label: '', detail: '' }]);
    expect(out.bind).toBe('stats.1.value');
    expect(out.hint).toBe('71%');
  });

  it('removes the item and keeps the right one marked', () => {
    const c = { options: ['A', 'B', 'C'], correct: 2 };
    const item = itemOf(kind('question').fields, c, 'options.0')!;
    expect(removeItemAt(c, item)).toMatchObject({ options: ['B', 'C'], correct: 1 });
    expect(removeItemAt(c, itemOf(kind('question').fields, c, 'options.2')!)).toMatchObject({ correct: -1 });
  });

  it('respects the most and fewest items a list allows', () => {
    const full = { stats: [{}, {}, {}, {}] };
    expect(canAdd(itemOf(kind('stats').fields, full, 'stats.0.value')!)).toBe(false);
    const one = { stats: [{ value: '1' }] };
    expect(canDelete(itemOf(kind('stats').fields, one, 'stats.0.value')!)).toBe(false);
    expect(canDelete(itemOf(kind('bullets').fields, { bullets: ['A'] }, 'bullets.0')!)).toBe(true);
  });

  it('keeps moved points with their points when one above is added or removed', () => {
    const o = { x: 1, y: 2, w: 30, h: 40 };
    const slide = { id: 's', kind: 'bullets', content: {}, notes: {} as never, overrides: { 'bullets-1': o, 'bullets-3': o, title: o, 'bullets-m3': o } };
    expect(Object.keys(shiftItemOverrides(slide, 'bullets', 0, -1).overrides!).sort()).toEqual(['bullets-0', 'bullets-2', 'bullets-m3', 'title']);
    expect(Object.keys(shiftItemOverrides(slide, 'bullets', 1, -1).overrides!).sort()).toEqual(['bullets-2', 'bullets-m3', 'title']);
    expect(Object.keys(shiftItemOverrides(slide, 'bullets', 1, 1).overrides!).sort()).toEqual(['bullets-1', 'bullets-4', 'bullets-m3', 'title']);
    expect(shiftItemOverrides({ ...slide, overrides: { 'bullets-0': o } }, 'bullets', 0, -1)).not.toHaveProperty('overrides');
  });

  it('empties a plain field', () => {
    expect(clearField({ title: 'T', image: 'x' }, 'image')).toEqual({ title: 'T', image: '' });
    expect(clearField({ reveal: true }, 'reveal')).toEqual({ reveal: false });
  });
});
