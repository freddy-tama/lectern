// @vitest-environment node
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { type Deck, type Slide, emptyNotes } from '../src/core/deck/types';
import { CANVAS_H, CANVAS_W, type Box, type ShapeBox, type TextBox } from '../src/core/engine/boxes';
import { layoutSlide } from '../src/core/engine/layout';
import { THEMES, getTheme } from '../src/core/engine/themes';
import { exportDeckToPptx } from '../src/core/export/pptx';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { REPORT_KINDS, calloutAt, paragraphs, periodIndex, periodsOf, roadmapBars } from '../src/core/kinds/report-kinds';
import { getKind } from '../src/core/kinds/registry';

registerCoreKinds();

const AUDIENCES = ['young', 'teen', 'adult'] as const;
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const NL = String.fromCharCode(10);

const slideOf = (kind: string, content: Record<string, unknown>, variant?: string): Slide => ({ id: `s-${kind}`, kind, content, notes: emptyNotes(), ...(variant ? { variant } : {}) });

function lay(kind: string, content: Record<string, unknown>, o: { variant?: string; theme?: string; audience?: (typeof AUDIENCES)[number]; mode?: 'edit' | 'show' } = {}) {
  return layoutSlide(slideOf(kind, content, o.variant), { theme: getTheme(o.theme ?? 'paper'), audience: o.audience ?? 'adult', mode: o.mode ?? 'show', slideCount: 8, slideNumber: 3 });
}

function inside(boxes: Box[]) {
  for (const b of boxes) {
    if (b.id.startsWith('deco')) continue;
    expect(b.x, `${b.id} x`).toBeGreaterThanOrEqual(0);
    expect(b.y, `${b.id} y`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w, `${b.id} right`).toBeLessThanOrEqual(CANVAS_W + 1);
    expect(b.y + b.h, `${b.id} bottom`).toBeLessThanOrEqual(CANVAS_H + 1);
  }
}

/** Text boxes that cover each other, apart from numbers on their markers. */
function collisions(boxes: Box[]) {
  const t = boxes.filter((b): b is TextBox => b.type === 'text' && !!b.text.trim() && !['page', 'footer'].includes(b.id) && !b.moveWith?.startsWith('dot-'));
  const out: string[] = [];
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
    const a = t[i]!;
    const b = t[j]!;
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (w > 2 && h > 2) out.push(`${a.id} × ${b.id}`);
  }
  return out;
}

const byId = (boxes: Box[], id: string) => boxes.find((b) => b.id === id);
const text = (boxes: Box[], id: string) => byId(boxes, id) as TextBox;

describe('text, roadmap and screenshot', () => {
  it('register with valid definitions', () => {
    expect(REPORT_KINDS.map((k) => k.kind)).toEqual(['text', 'roadmap', 'screenshot']);
    for (const def of REPORT_KINDS) {
      expect(getKind(def.kind)).toBe(def);
      expect(def.plugin ?? '').toBe('');
      for (const f of def.fields) expect(f.label.length, `${def.kind}.${f.key}`).toBeGreaterThan(0);
      expect(def.heading(def.create()).length).toBeGreaterThan(0);
      expect(def.text(def.create()).length).toBeGreaterThan(0);
    }
    expect(getKind('screenshot')!.group).toBe('Visual');
  });

  for (const def of REPORT_KINDS) {
    for (const variant of def.variants?.map((v) => v.id) ?? [undefined]) {
      it(`${def.kind}${variant ? ` (${variant})` : ''}: lays out its example with no warnings for every audience, look and mode`, () => {
        for (const theme of THEMES) for (const audience of AUDIENCES) for (const mode of ['show', 'edit'] as const) {
          const content = def.kind === 'screenshot' ? { ...def.create(), image: PX } : def.create();
          const out = lay(def.kind, content, { variant, theme: theme.id, audience, mode });
          expect(out.warnings, `${def.kind} ${theme.id} ${audience} ${mode}`).toEqual([]);
          inside(out.boxes);
          expect(collisions(out.boxes), `${def.kind} ${theme.id} ${audience}`).toEqual([]);
        }
      });
    }

    it(`${def.kind}: survives empty and junk content`, () => {
      for (const content of [{}, { title: 42, body: 7, bars: 'x', callouts: [null, 3], periods: null }]) {
        const out = lay(def.kind, content as Record<string, unknown>, { mode: 'edit' });
        expect(out.boxes.length).toBeGreaterThan(0);
        inside(out.boxes);
      }
    });
  }
});

describe('text', () => {
  const long = Array.from({ length: 4 }, (_, i) => `Paragraph ${i + 1}. ${'Teams that plan their meetings decide more and talk less about status. '.repeat(2)}`).join(NL + NL);

  it('reads paragraphs at blank lines, keeping single line breaks', () => {
    expect(paragraphs(`One${NL}still one${NL}${NL}  ${NL}Two`)).toEqual([`One${NL}still one`, 'Two']);
  });

  it('picks two columns for long text', () => {
    const def = getKind('text')!;
    const auto = { index: 1, count: 4, nth: 0 };
    expect(def.autoVariant!(def.create(), auto)).toBe('one');
    expect(def.autoVariant!({ body: long }, auto)).toBe('two');
  });

  it('sets two columns side by side at one size, both editing the text', () => {
    const out = lay('text', { title: 'Report', body: long }, { variant: 'two' });
    const [a, b] = [text(out.boxes, 'body-0'), text(out.boxes, 'body-1')];
    expect(a.style.size).toBe(b.style.size);
    expect(b.x).toBeGreaterThan(a.x + a.w);
    expect(a.y).toBe(b.y);
    expect([a.bind, b.bind]).toEqual(['body', 'body']);
    expect(`${a.text}${NL}${NL}${b.text}`).toBe(paragraphs(long).join(NL + NL));
  });

  it('shares one long paragraph out by sentence', () => {
    const one = 'First sentence here. Second one follows. Third makes a point. Fourth closes it.';
    const out = lay('text', { body: one }, { variant: 'two' });
    expect(text(out.boxes, 'body-0').text.endsWith('.')).toBe(true);
    expect(text(out.boxes, 'body-1').text.length).toBeGreaterThan(0);
  });

  it('carries more words than a glance-at slide before it suggests trimming', () => {
    const out = lay('text', { title: 'Report', body: long });
    expect(out.words!.budget).toBeGreaterThan(200);
    expect(out.warnings.some((w) => /words on this slide/.test(w))).toBe(false);
  });
});

describe('roadmap', () => {
  it('reads periods and matches bars to them by name, part of a name or number', () => {
    const periods = periodsOf('Q1 2026, Q2 2026; Q3 2026');
    expect(periods).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026']);
    expect(periodIndex('q2 2026', periods)).toBe(1);
    expect(periodIndex('Q3', periods)).toBe(2);
    expect(periodIndex('1', periods)).toBe(0);
    expect(periodIndex('Q9', periods)).toBe(-1);
  });

  it('gives overlapping bars in one workstream their own rows', () => {
    const { lanes, rows, bars } = roadmapBars({
      periods: 'Jan, Feb, Mar',
      bars: [
        { lane: 'Web', label: 'A', from: 'Jan', to: 'Feb' },
        { lane: 'Web', label: 'B', from: 'Feb', to: 'Mar' },
        { lane: 'web', label: 'C', from: 'Mar' },
        { lane: 'App', label: 'D', from: 'Mar', to: 'Jan' },
      ],
    });
    expect(lanes).toEqual(['Web', 'App']);
    expect(rows).toEqual([2, 1]);
    expect(bars.map((b) => [b.label, b.row, b.from, b.to])).toEqual([['A', 0, 0, 1], ['B', 1, 1, 2], ['C', 0, 2, 2], ['D', 0, 0, 2]]);
  });

  it('draws each bar across the periods it runs, with a line for now', () => {
    const out = lay('roadmap', getKind('roadmap')!.create());
    const one = byId(out.boxes, 'bar-2') as ShapeBox;
    const three = byId(out.boxes, 'bar-4') as ShapeBox;
    expect(three.w).toBeGreaterThan(one.w * 2.8);
    expect(byId(out.boxes, 'now')).toBeDefined();
    expect(text(out.boxes, 'period-1').style.color).toBe(getTheme('paper').colors.accent);
    expect(text(out.boxes, 'bar-0-label').bind).toBe('bars.0.label');
    expect(text(out.boxes, 'lane-0').text).toBe('Product');
  });

  it('says which bars it left off because their dates match no period', () => {
    const out = lay('roadmap', { periods: 'Q1, Q2', bars: [{ lane: 'X', label: 'Ship', from: 'Q1' }, { lane: 'X', label: 'Later', from: 'Next year' }] });
    expect(out.warnings.join(' ')).toMatch(/Later/);
  });

  it('reveals one workstream per click when asked', () => {
    const out = lay('roadmap', { ...getKind('roadmap')!.create(), reveal: true });
    expect(out.steps).toBe(4);
  });
});

describe('screenshot', () => {
  it('places callouts from their percentages, spreading the ones without a place', () => {
    expect(calloutAt({ x: '25', y: '80%' }, 0, 1)).toEqual({ x: 0.25, y: 0.8 });
    expect(calloutAt({ x: '140', y: '-5' }, 0, 1)).toEqual({ x: 1, y: 0 });
    expect(calloutAt({}, 1, 3)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('puts each dot where it points on the screen, numbered like its line', () => {
    const out = lay('screenshot', { title: 'App', image: PX, callouts: [{ label: 'Menu', x: '0', y: '0' }, { label: 'Save', x: '100', y: '100' }] });
    const screen = byId(out.boxes, 'screen')!;
    const first = byId(out.boxes, 'dot-0')!;
    const last = byId(out.boxes, 'dot-1')!;
    expect(first.x).toBe(screen.x);
    expect(first.y).toBe(screen.y);
    expect(last.x + last.w).toBeCloseTo(screen.x + screen.w, 0);
    expect(first.drag).toEqual({ x: 'callouts.0.x', y: 'callouts.0.y', within: 'screen' });
    expect(text(out.boxes, 'callout-1').bind).toBe('callouts.1.label');
    expect(text(out.boxes, 'callout-1-n').text).toBe('2');
  });

  it('frames the picture as a phone, standing tall', () => {
    const out = lay('screenshot', { ...getKind('screenshot')!.create(), image: PX }, { variant: 'phone' });
    const screen = byId(out.boxes, 'screen')!;
    expect(screen.h).toBeGreaterThan(screen.w * 1.8);
    expect(byId(out.boxes, 'url')).toBeUndefined();
  });

  it('asks for a screenshot while editing, and draws no empty frame hint when shown', () => {
    expect(lay('screenshot', {}, { mode: 'edit' }).boxes.some((b) => b.id === 'screen-hint')).toBe(true);
    expect(lay('screenshot', {}, { mode: 'show' }).boxes.some((b) => b.id === 'screen-hint')).toBe(false);
  });
});

describe('new kinds in PowerPoint', () => {
  it('export as native shapes, text and pictures', async () => {
    const deck: Deck = {
      id: 'd', title: 'Plan', themeId: 'paper', audience: 'adult', createdAt: 0, updatedAt: 0,
      slides: REPORT_KINDS.map((def) => slideOf(def.kind, def.kind === 'screenshot' ? { ...def.create(), image: PX } : def.create())).map((s, i) => ({ ...s, id: `s${i}` })),
    };
    const { data, warnings } = await exportDeckToPptx(deck, { output: 'nodebuffer' });
    expect(warnings).toEqual([]);
    const zip = await JSZip.loadAsync(data as Uint8Array);
    const xml = await Promise.all([1, 2, 3].map((n) => zip.file(`ppt/slides/slide${n}.xml`)!.async('string')));
    expect(xml[0]).toContain('What we learned');
    expect(xml[1]).toContain('Design system');
    expect(xml[2]).toContain('Click any text to type');
  });
});
