import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { type Deck, type Slide, emptyNotes } from '../src/core/deck/types';
import { CANVAS_H, CANVAS_W, type Box, type ImageBox } from '../src/core/engine/boxes';
import { DECOR_MOTIFS, type DecorMotif, decorDataUrl, decorSvg, isDecorMotif } from '../src/core/engine/decor';
import { layoutSlide } from '../src/core/engine/layout';
import { DECORATIONS, type Decoration, type Theme, getTheme, registerTheme, unregisterTheme } from '../src/core/engine/themes';
import { exportDeckToPptx } from '../src/core/export/pptx';
import { M } from '../src/core/kinds/kit';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';

registerCoreKinds();

const COLORS = { a: '#112233', b: '#445566', c: '#778899' };
const SIZE_CAP = 6 * 1024;
const NEW_DECORATIONS = DECORATIONS.map((d) => d.id).filter((id): id is Decoration => !['none', 'corner', 'band', 'dots', 'grid', 'blobs'].includes(id));
const SCATTERED: DecorMotif[] = ['confetti', 'dots', 'sparkles', 'blob', 'brush', 'mosaic', 'sunburst', 'doodle-frame', 'circuit'];
/** Natural size and a few stretched ones, the way themes and users place them. */
const sizes = (aspect: number): [number, number][] => [[Math.round(600 * aspect), 600], [128, 440], [1920, 90], [420, 96], [900, 520]];

const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml');

describe('decor motifs', () => {
  it('lists 14 to 18 motifs, each described, with an id the guard accepts', () => {
    expect(DECOR_MOTIFS.length).toBeGreaterThanOrEqual(14);
    expect(DECOR_MOTIFS.length).toBeLessThanOrEqual(18);
    expect(new Set(DECOR_MOTIFS.map((m) => m.id)).size).toBe(DECOR_MOTIFS.length);
    for (const m of DECOR_MOTIFS) {
      expect(isDecorMotif(m.id)).toBe(true);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(20);
      expect(m.aspect).toBeGreaterThan(0);
    }
    expect(isDecorMotif('nope')).toBe(false);
    expect(isDecorMotif(3)).toBe(false);
    expect(isDecorMotif(undefined)).toBe(false);
  });

  it.each(DECOR_MOTIFS)('$id is well-formed, sized to its box and within the size cap', ({ id, aspect }) => {
    for (const [w, h] of sizes(aspect)) {
      const svg = decorSvg(id, COLORS, w, h, 5);
      const doc = parse(svg);
      expect(doc.getElementsByTagName('parsererror').length, `${id} ${w}×${h}`).toBe(0);
      const root = doc.documentElement;
      expect(root.tagName).toBe('svg');
      expect(root.getAttribute('viewBox')).toBe(`0 0 ${w} ${h}`);
      expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
      expect(svg.length, `${id} ${w}×${h} is ${svg.length} bytes`).toBeLessThan(SIZE_CAP);
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it.each(DECOR_MOTIFS)('$id draws only in the colours it is given', ({ id, aspect }) => {
    const [w, h] = sizes(aspect)[0]!;
    const svg = decorSvg(id, COLORS, w, h, 2);
    expect(svg).toContain(COLORS.a);
    expect(svg).toContain(COLORS.b);
    const used = new Set((svg.match(/#[0-9a-f]{6}/gi) ?? []).map((c) => c.toLowerCase()));
    for (const c of used) expect(Object.values(COLORS), `${id} uses ${c}`).toContain(c);
  });

  it.each(DECOR_MOTIFS)('$id is safe to embed and to rasterise', ({ id, aspect }) => {
    const [w, h] = sizes(aspect)[0]!;
    const svg = decorSvg(id, COLORS, w, h, 9);
    expect(svg).not.toMatch(/<script|<foreignObject|<filter|<image|<use|<text|<style|href|@import|on\w+=/i);
    // The only URLs are the SVG namespace and references to a gradient inside the file.
    const urls = svg.match(/https?:\/\/[^"')\s]+/g) ?? [];
    expect(urls).toEqual(['http://www.w3.org/2000/svg']);
    for (const ref of svg.match(/url\([^)]*\)/g) ?? []) expect(ref).toMatch(/^url\(#\w+\)$/);
  });

  it.each(DECOR_MOTIFS)('$id gives the same picture for the same seed', ({ id, aspect }) => {
    const [w, h] = sizes(aspect)[0]!;
    expect(decorSvg(id, COLORS, w, h, 4)).toBe(decorSvg(id, COLORS, w, h, 4));
    expect(decorSvg(id, COLORS, w, h)).toBe(decorSvg(id, COLORS, w, h, 1));
  });

  it.each(SCATTERED)('%s varies with the seed', (id) => {
    const m = DECOR_MOTIFS.find((x) => x.id === id)!;
    const [w, h] = sizes(m.aspect)[0]!;
    const seen = new Set([1, 2, 3, 4].map((seed) => decorSvg(id, COLORS, w, h, seed)));
    expect(seen.size).toBe(4);
  });

  it('draws different motifs differently and survives bad input', () => {
    expect(decorSvg('waves', COLORS, 800, 300)).not.toBe(decorSvg('zigzag', COLORS, 800, 300));
    for (const m of DECOR_MOTIFS) {
      const svg = decorSvg(m.id, { a: '#112233', b: 'url(javascript:alert(1))"><script>' }, Number.NaN, -5, Number.NaN);
      expect(parse(svg).getElementsByTagName('parsererror').length).toBe(0);
      expect(svg).not.toMatch(/<script|javascript|NaN/);
    }
  });

  it('mirrors a motif for another corner without changing its drawing', () => {
    const plain = decorSvg('rings', COLORS, 500, 500, 3);
    const flipped = decorSvg('rings', COLORS, 500, 500, 3, 'xy');
    expect(flipped).toContain('matrix(-1 0 0 -1 500 500)');
    expect(flipped).toContain(plain.slice(plain.indexOf('>') + 1, -'</svg>'.length));
    expect(decorSvg('rings', COLORS, 500, 300, 3, 'x')).toContain('matrix(-1 0 0 1 500 0)');
    expect(decorSvg('rings', COLORS, 500, 300, 3, 'y')).toContain('matrix(1 0 0 -1 0 300)');
  });

  it('turns into a data URL that decodes to the same SVG', () => {
    const url = decorDataUrl('clouds', COLORS, 800, 400, 7);
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(url.slice(url.indexOf(',') + 1))).toBe(decorSvg('clouds', COLORS, 800, 400, 7));
    expect(decorDataUrl('clouds', COLORS, 800, 400, 7)).toBe(url);
  });
});

// ─── Theme decorations ────────────────────────────────────────────────

const slideOf = (kind: string, content: Record<string, unknown>): Slide => ({ id: `s-${kind}`, kind, content, notes: emptyNotes() });
const BULLETS = slideOf('bullets', { title: 'Why it works', bullets: ['Short points', 'One idea each', 'A picture to anchor them'], image: '' });
const TITLE = slideOf('title', { title: 'The water cycle', subtitle: 'Where rain comes from', image: '' });
const SECTION = slideOf('section', { title: 'Part two', subtitle: '' });

function themed(decoration: Decoration, patch: Partial<Theme> = {}): Theme {
  return { ...getTheme('paper'), decoration, ...patch };
}

function lay(slide: Slide, theme: Theme) {
  return layoutSlide(slide, { theme, audience: 'adult', mode: 'show', slideCount: 8, slideNumber: 3 });
}

const decos = (boxes: Box[]) => boxes.filter((b): b is ImageBox => b.id.startsWith('deco-') && b.type === 'image');
const overlaps = (a: Box, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const SAFE = { x: M.x, y: M.top, w: M.w, h: M.bottom - M.top };

describe('theme decorations that use motifs', () => {
  it('adds several new recipes with short labels, and keeps the old ones', () => {
    expect(NEW_DECORATIONS.length).toBeGreaterThanOrEqual(5);
    expect(NEW_DECORATIONS.length).toBeLessThanOrEqual(7);
    for (const id of ['none', 'corner', 'band', 'dots', 'grid', 'blobs']) expect(DECORATIONS.some((d) => d.id === id)).toBe(true);
    for (const d of DECORATIONS) expect(d.label.split(/\s+/).length).toBeLessThanOrEqual(2);
  });

  it.each(NEW_DECORATIONS)('%s draws deco- image boxes on every kind of slide', (decoration) => {
    for (const slide of [BULLETS, TITLE, SECTION]) {
      const out = lay(slide, themed(decoration));
      const found = decos(out.boxes);
      expect(found.length, `${decoration} on ${slide.kind}`).toBeGreaterThan(0);
      expect(new Set(found.map((b) => b.id)).size).toBe(found.length);
      for (const b of found) {
        expect(b.src.startsWith('data:image/svg+xml')).toBe(true);
        expect(b.fit).toBe('contain');
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(CANVAS_W);
        expect(b.y + b.h).toBeLessThanOrEqual(CANVAS_H);
        expect(parse(decodeURIComponent(b.src.slice(b.src.indexOf(',') + 1))).getElementsByTagName('parsererror').length).toBe(0);
      }
    }
  });

  it.each(NEW_DECORATIONS)('%s stays out of the text area on content slides', (decoration) => {
    for (const theme of ['paper', 'chalk', 'campus', 'sunny', 'midnight', 'minimal']) {
      const out = lay(BULLETS, themed(decoration, { ...getTheme(theme), decoration }));
      for (const b of decos(out.boxes)) expect(overlaps(b, SAFE), `${decoration} ${b.id} on ${theme}`).toBe(false);
    }
  });

  it.each(NEW_DECORATIONS)('%s makes way for a logo and for the footer', (decoration) => {
    for (const logoPosition of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      const out = lay(BULLETS, themed(decoration, { logo: 'data:image/png;base64,iVBORw0KGgo=', logoAspect: 3, logoPosition, footerText: 'Northwind' }));
      const logo = out.boxes.find((b) => b.id === 'logo')!;
      expect(logo, `${decoration} ${logoPosition}`).toBeTruthy();
      for (const b of decos(out.boxes)) expect(overlaps(b, logo), `${decoration} ${b.id} under the ${logoPosition} logo`).toBe(false);
      for (const f of out.boxes.filter((x) => x.id === 'page' || x.id === 'footer')) {
        for (const b of decos(out.boxes)) expect(overlaps(b, f), `${decoration} ${b.id} under ${f.id}`).toBe(false);
      }
    }
  });

  it.each(NEW_DECORATIONS)('%s is drawn in the look colours, and in the section ink on dividers', (decoration) => {
    const theme = themed(decoration, { colors: { ...getTheme('paper').colors, accent: '#AA1122', accent2: '#BB3344', muted: '#CC5566', sectionInk: '#123ABC', surface: '#FEDCBA' } });
    const svgOf = (b: ImageBox) => decodeURIComponent(b.src.slice(b.src.indexOf(',') + 1));
    const content = decos(lay(BULLETS, theme).boxes).map(svgOf).join('');
    expect(content).toContain('#AA1122');
    expect(content).not.toContain('#123ABC');
    const section = decos(lay(SECTION, theme).boxes).map(svgOf).join('');
    expect(section).toContain('#123ABC');
    expect(section).not.toContain('#AA1122');
  });

  it('leaves the existing five recipes as they were', () => {
    const corner = lay(BULLETS, themed('corner'));
    expect(corner.boxes.filter((b) => b.id.startsWith('deco-')).map((b) => b.id)).toEqual(['deco-a', 'deco-b']);
    expect(decos(lay(BULLETS, themed('band')).boxes)).toHaveLength(0);
    expect(lay(BULLETS, themed('none')).boxes.some((b) => b.id.startsWith('deco-'))).toBe(false);
  });
});

// ─── PowerPoint ───────────────────────────────────────────────────────

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('decorations in PowerPoint', () => {
  afterEach(() => unregisterTheme('decor_test'));

  function deck(): Deck {
    return {
      id: 'd1', title: 'Decor', themeId: 'decor_test', audience: 'adult', createdAt: 0, updatedAt: 0,
      slides: [TITLE, BULLETS, SECTION].map((s, i) => ({ ...s, id: `s${i}` })),
    };
  }

  const media = async (data: Blob | Uint8Array) => Object.keys((await JSZip.loadAsync(data as Uint8Array)).files).filter((p) => /^ppt\/media\/.+/.test(p));

  it('are left off quietly when the host cannot rasterise SVG, with no warnings', async () => {
    registerTheme({ ...themed('waves'), id: 'decor_test', custom: true });
    const out = await exportDeckToPptx(deck(), { output: 'nodebuffer' });
    expect(out.warnings).toEqual([]);
    expect(await media(out.data)).toEqual([]);
  });

  it('become pictures when the host turns the SVG into a PNG', async () => {
    registerTheme({ ...themed('waves'), id: 'decor_test', custom: true });
    const asked: string[] = [];
    const out = await exportDeckToPptx(deck(), {
      output: 'nodebuffer',
      resolveImage: async (src) => { asked.push(src); return PNG; },
    });
    expect(out.warnings).toEqual([]);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((s) => s.startsWith('data:image/svg+xml'))).toBe(true);
    expect((await media(out.data)).length).toBeGreaterThan(0);
  });
});
