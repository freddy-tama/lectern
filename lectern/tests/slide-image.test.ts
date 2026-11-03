import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlideLayout } from '../src/core/engine/boxes';
import { THEMES } from '../src/core/engine/themes';
import { blockTop, contactSheet, drawLayout, fitRect, sheetGrid, slideShot } from '../src/features/slides/slide-image';

const theme = THEMES[0];
const layout: SlideLayout = {
  background: '#ffffff',
  steps: 1,
  warnings: [],
  boxes: [
    { id: 't', type: 'text', x: 100, y: 100, w: 800, h: 100, text: 'Hello world', overflow: true, style: { font: 'body', size: 48, color: '#111' } },
    { id: 's', type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 100, fill: '#f00', stroke: '#000', strokeWidth: 4 },
    { id: 'i', type: 'image', x: 0, y: 400, w: 300, h: 200, src: '', fit: 'cover' },
    { id: 'later', type: 'text', x: 0, y: 700, w: 400, h: 80, text: 'Later', step: 1, style: { font: 'body', size: 40, color: '#111' } },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe('without a 2D canvas (jsdom)', () => {
  it('draws nothing and does not throw', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await drawLayout(layout, theme)).toBeNull();
    expect(await slideShot(layout, theme)).toBeNull();
    expect(await contactSheet([{ layout, theme, label: '1' }])).toBeNull();
    expect(await contactSheet([])).toBeNull();
    expect(err).not.toHaveBeenCalled();
  });
});

describe('fitRect', () => {
  it('cover fills the frame and crops the long side', () => {
    const r = fitRect(2000, 1000, 400, 400, 'cover');
    expect(r.dh).toBe(400);
    expect(r.dw).toBe(800);
    expect(r.dx).toBe(-200);
    expect(r.dy).toBe(0);
  });
  it('contain keeps the whole picture and centres it', () => {
    const r = fitRect(2000, 1000, 400, 400, 'contain');
    expect(r).toEqual({ dx: 0, dy: 100, dw: 400, dh: 200 });
  });
  it('falls back to the frame for an image without a size', () => {
    expect(fitRect(0, 0, 300, 200, 'cover')).toEqual({ dx: 0, dy: 0, dw: 300, dh: 200 });
  });
});

describe('blockTop', () => {
  it('places text at the top, middle or bottom, and lets overflow spill both ways', () => {
    expect(blockTop('top', 100, 40)).toBe(0);
    expect(blockTop(undefined, 100, 40)).toBe(0);
    expect(blockTop('middle', 100, 40)).toBe(30);
    expect(blockTop('bottom', 100, 40)).toBe(60);
    expect(blockTop('middle', 100, 140)).toBe(-20);
  });
});

describe('sheetGrid', () => {
  it('places tiles row by row with gaps', () => {
    const g = sheetGrid(5, 3, 480);
    expect(g.cols).toBe(3);
    expect(g.rows).toBe(2);
    expect(g.tileW).toBe(480);
    expect(g.tileH).toBe(270);
    expect(g.cells).toHaveLength(5);
    expect(g.cells[1].x - g.cells[0].x).toBe(492);
    // Each tile has a 30 px strip above it for its label.
    expect(g.cells[0]).toEqual({ x: 12, y: 12 + 30 });
    expect(g.cells[3]).toEqual({ x: g.cells[0].x, y: g.cells[0].y + 270 + 30 + 12 });
    expect(g.width).toBe(12 * 2 + 3 * 480 + 2 * 12);
    expect(g.height).toBe(12 * 2 + 2 * (270 + 30) + 12);
  });
  it('shrinks tiles to stay within 1600 px wide', () => {
    const g = sheetGrid(8, 4, 480);
    expect(g.width).toBeLessThanOrEqual(1600);
    expect(g.tileW).toBeLessThan(480);
  });
  it('uses fewer columns than slides, and caps the height', () => {
    expect(sheetGrid(2, 3).cols).toBe(2);
    expect(sheetGrid(200, 3, 480).height).toBeLessThanOrEqual(6000);
  });
});

describe('with a recording canvas', () => {
  function stubCanvas() {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, prop: string) => {
        if (prop === 'measureText') return (t: string) => ({ width: t.length * 10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 });
        if (prop in target) return target[prop];
        return (...args: unknown[]) => { calls.push(`${prop}:${args.join(',')}`); };
      },
      set: (target, prop: string, value) => { target[prop] = value; return true; },
    });
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('stub');
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = real(tag);
      if (tag === 'canvas') {
        Object.assign(el, {
          getContext: () => ctx,
          toDataURL: () => 'data:image/jpeg;base64,QUJD',
        });
      }
      return el;
    });
    return calls;
  }

  it('draws boxes, marks overflow and empty pictures, and skips later steps', async () => {
    const calls = stubCanvas();
    const canvas = await drawLayout(layout, theme, { width: 960, step: 0 });
    expect(canvas?.width).toBe(960);
    expect(canvas?.height).toBe(540);
    const texts = calls.filter((c) => c.startsWith('fillText:')).map((c) => c.split(':')[1].split(',')[0]);
    expect(texts).toContain('Hello world');
    expect(texts).not.toContain('Later');
    expect(calls.some((c) => c.startsWith('strokeRect:100,100,800,100'))).toBe(true);
    expect(calls.some((c) => c.startsWith('setLineDash:16,10'))).toBe(true);
  });

  it('leaves the marks off on request', async () => {
    const calls = stubCanvas();
    await drawLayout(layout, theme, { marks: false });
    expect(calls.some((c) => c.startsWith('strokeRect:100,100'))).toBe(false);
  });

  it('returns base64 without the data: prefix', async () => {
    stubCanvas();
    const shot = await slideShot(layout, theme);
    expect(shot).toEqual({ data: 'QUJD', mime: 'image/jpeg', width: 960, height: 540 });
    const sheet = await contactSheet([{ layout, theme, label: '1' }, { layout, theme, label: '2' }], { cols: 2, tileWidth: 300 });
    expect(sheet?.data).toBe('QUJD');
    expect(sheet?.width).toBe(12 * 2 + 2 * 300 + 12);
  });
});
