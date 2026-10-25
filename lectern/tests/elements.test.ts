import { describe, expect, it } from 'vitest';
import type { Slide } from '../src/core/deck/types';
import type { ShapeBox, TextBox } from '../src/core/engine/boxes';
import { MAX_ELEMENTS, cleanElement, cleanElements, elementIdOf, restackElement, updateElement, withElement, withoutElement } from '../src/core/engine/elements';
import { layoutSlide } from '../src/core/engine/layout';
import { withOverride } from '../src/core/engine/overrides';
import { getTheme } from '../src/core/engine/themes';
import { normalizeDeck } from '../src/data/deck-file';
import { sampleDeck, slide } from './assistant-fixtures';

const theme = getTheme('paper');
const lay = (s: Slide) => layoutSlide(s, { theme, audience: 'adult', slideNumber: 2, slideCount: 5 });
const ids = (s: Slide) => lay(s).boxes.map((b) => b.id);
const points = () => slide('s_p', 'bullets', { title: 'Why', bullets: ['Fast', 'Cheap'] });

describe('cleaning elements', () => {
  it('keeps text with sensible numbers, leaving a corner on the slide', () => {
    expect(cleanElement({ id: 'e1', type: 'text', text: 'Hi', x: 5000, y: -5000, w: 99_999, h: 2, size: 900, color: 'accent', weight: 655, align: 'middle', font: 'comic' }))
      .toEqual({ id: 'e1', type: 'text', text: 'Hi', x: 1896, y: 0, w: 3840, h: 8, size: 260, color: 'accent', weight: 700 });
  });

  it('takes only pictures it can show, and colours by theme name or hex', () => {
    expect(cleanElement({ type: 'picture', src: 'javascript:alert(1)', x: 0, y: 0, w: 10, h: 10 })).toBeNull();
    expect(cleanElement({ id: 'p', type: 'picture', src: 'asset:a_1', fit: 'contain', alt: '  A lamp ', x: 0, y: 0, w: 100, h: 100 })).toEqual({ id: 'p', type: 'picture', src: 'asset:a_1', alt: 'A lamp', x: 0, y: 0, w: 100, h: 100 });
    expect(cleanElement({ id: 's', type: 'shape', shape: 'star', fill: 'red', stroke: '#ff0000', x: 0, y: 0, w: 100, h: 100 })).toEqual({ id: 's', type: 'shape', shape: 'rect', fill: 'accent', stroke: '#ff0000', x: 0, y: 0, w: 100, h: 100 });
    expect(cleanElement({ id: 'l', type: 'shape', shape: 'line', x: 0, y: 50, w: 600, h: 0 })).toEqual({ id: 'l', type: 'shape', shape: 'line', stroke: 'accent', x: 0, y: 50, w: 600, h: 0 });
  });

  it('keeps decorations of a known motif, with their colours and flip', () => {
    expect(cleanElement({ type: 'decor', motif: 'fireworks', x: 0, y: 0, w: 10, h: 10 })).toBeNull();
    expect(cleanElement({ id: 'd', type: 'decor', motif: 'waves', colors: ['accent2', 'url(x)', '#123456'], flip: 'x', layer: 'back', opacity: 0.5, x: 0, y: 860, w: 1920, h: 220 }))
      .toEqual({ id: 'd', type: 'decor', motif: 'waves', colors: ['accent2', '#123456'], flip: 'x', layer: 'back', opacity: 0.5, x: 0, y: 860, w: 1920, h: 220 });
  });

  it('cleans a list: drops what can’t be drawn, keeps ids unique and the count in bounds', () => {
    const list = cleanElements([
      { id: 'a', type: 'text', text: 'One', x: 0, y: 0, w: 100, h: 50 },
      { id: 'a', type: 'text', text: 'Two', x: 0, y: 0, w: 100, h: 50 },
      { type: 'hologram' },
      'nonsense',
    ]);
    expect(list.map((e) => (e.type === 'text' ? e.text : ''))).toEqual(['One', 'Two']);
    expect(new Set(list.map((e) => e.id)).size).toBe(2);
    expect(cleanElements(Array.from({ length: 60 }, (_, i) => ({ type: 'shape', x: i, y: 0, w: 10, h: 10 })))).toHaveLength(MAX_ELEMENTS);
  });

  it('finds the element a box or a bind names', () => {
    expect(elementIdOf('@e_1.text')).toBe('e_1');
    expect(elementIdOf('el-e_1')).toBe('e_1');
    expect(elementIdOf('el-e_1-bg')).toBe('e_1');
    expect(elementIdOf('title')).toBeNull();
  });
});

describe('elements on a slide', () => {
  it('draws the back layer under the slide’s content and the rest on top of everything', () => {
    let s = withElement(points(), { id: 'back', type: 'decor', motif: 'sprigs', layer: 'back', x: 1400, y: 40, w: 480, h: 360 });
    s = withElement(s, { id: 'front', type: 'shape', shape: 'ellipse', fill: 'accent2', x: 100, y: 100, w: 200, h: 200 });
    const order = ids(s);
    expect(order.indexOf('el-back')).toBeGreaterThan(order.indexOf('deco-a'));
    expect(order.indexOf('el-back')).toBeLessThan(order.indexOf('title'));
    expect(order.at(-1)).toBe('el-front');
    const boxes = lay(s).boxes;
    expect(boxes.find((b) => b.id === 'el-back')).toMatchObject({ type: 'image', bind: '@back', src: expect.stringMatching(/^data:image\/svg\+xml/) });
    expect(boxes.find((b) => b.id === 'el-front') as ShapeBox).toMatchObject({ type: 'shape', shape: 'ellipse', fill: theme.colors.accent2, x: 100, y: 100, w: 200, h: 200 });
  });

  it('puts a card behind text with a fill, moving with it', () => {
    const s = withElement(points(), { id: 'note', type: 'text', text: 'New!', fill: 'surface', color: 'accent', size: 40, x: 1400, y: 100, w: 400, h: 120 });
    const boxes = lay(s).boxes;
    const card = boxes.find((b) => b.id === 'el-note-bg') as ShapeBox;
    const words = boxes.find((b) => b.id === 'el-note') as TextBox;
    expect(card).toMatchObject({ type: 'shape', fill: theme.colors.surface, x: 1400, y: 100, w: 400, h: 120, moveWith: 'el-note', bind: '@note' });
    expect(words).toMatchObject({ type: 'text', text: 'New!', style: expect.objectContaining({ color: theme.colors.accent }), bind: '@note' });
    expect(words.x).toBeGreaterThan(1400);
    expect(boxes.indexOf(card)).toBe(boxes.indexOf(words) - 1);
  });

  it('leaves boxes off a slide, with the boxes that move with them, including the look’s decorations', () => {
    const q = slide('s_q', 'quote', { quote: 'Make it work, then make it fast.', attribution: 'Kent Beck' });
    expect(ids(q)).toEqual(expect.arrayContaining(['deco-a', 'quote', 'mark']));
    let hidden = withOverride(q, 'deco-a', { x: 0, y: 0, w: 10, h: 10, hidden: true });
    hidden = withOverride(hidden, 'quote', { x: 0, y: 0, w: 10, h: 10, hidden: true });
    expect(ids(hidden)).not.toContain('deco-a');
    expect(ids(hidden)).not.toContain('quote');
    expect(ids(hidden)).not.toContain('mark');
    expect(ids(hidden)).toContain('deco-b');
  });

  it('moves the look’s decorations like any other box', () => {
    const s = withOverride(points(), 'deco-a', { x: 40, y: 900, w: 300, h: 120 });
    expect(lay(s).boxes.find((b) => b.id === 'deco-a')).toMatchObject({ x: 40, y: 900, w: 300, h: 120 });
  });

  it('changes, restacks and removes elements, dropping the list with the last one', () => {
    let s = withElement(points(), { id: 'a', type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 100 });
    s = withElement(s, { id: 'b', type: 'text', text: 'Hi', x: 0, y: 0, w: 100, h: 100 });
    s = updateElement(s, 'b', { x: 300, w: 99_999 } as never);
    expect(s.elements![1]).toMatchObject({ id: 'b', type: 'text', x: 300, w: 3840 });
    s = restackElement(s, 'b', 'back');
    expect(s.elements!.map((e) => [e.id, e.layer])).toEqual([['b', 'back'], ['a', undefined]]);
    s = restackElement(s, 'b', 'front');
    expect(s.elements!.map((e) => [e.id, e.layer])).toEqual([['a', undefined], ['b', undefined]]);
    s = withoutElement(withoutElement(s, 'a'), 'b');
    expect(s).not.toHaveProperty('elements');
  });
});

describe('deck files', () => {
  it('keep elements, boxes moved by hand, pinned layouts and the deck’s own style', () => {
    const deck = sampleDeck();
    deck.autoStyle = true;
    deck.slides[1] = {
      ...deck.slides[1],
      variant: 'columns',
      variantPinned: true,
      overrides: { title: { x: 200, y: 96, w: 1500, h: 83 }, 'deco-a': { x: 0, y: 0, w: 10, h: 10, hidden: true }, junk: { x: 'left' } as never },
      elements: [{ id: 'e_1', type: 'decor', motif: 'confetti', layer: 'back', x: 1360, y: 40, w: 520, h: 330 }, { type: 'hologram' } as never],
    };
    const back = normalizeDeck(JSON.parse(JSON.stringify(deck)))!;
    expect(back.autoStyle).toBe(true);
    expect(back.slides[1]).toMatchObject({ variant: 'columns', variantPinned: true });
    expect(back.slides[1].overrides).toEqual({ title: { x: 200, y: 96, w: 1500, h: 83 }, 'deco-a': { x: 0, y: 0, w: 24, h: 24, hidden: true } });
    expect(back.slides[1].elements).toEqual([{ id: 'e_1', type: 'decor', motif: 'confetti', layer: 'back', x: 1360, y: 40, w: 520, h: 330 }]);
    expect(back.slides[0]).not.toHaveProperty('elements');
    expect(back.slides[0]).not.toHaveProperty('overrides');
  });
});
