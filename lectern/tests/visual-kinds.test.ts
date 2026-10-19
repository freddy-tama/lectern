// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Slide } from '../src/core/deck/types';
import { CANVAS_H, CANVAS_W, type Box, type ImageBox, type ShapeBox, type TextBox } from '../src/core/engine/boxes';
import { layoutSlide } from '../src/core/engine/layout';
import { THEMES, getTheme } from '../src/core/engine/themes';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { getKind } from '../src/core/kinds/registry';
import { VISUAL_KINDS } from '../src/core/kinds/visual-kinds';

registerCoreKinds();

const AUDIENCES = ['young', 'teen', 'adult'] as const;
const IDS = ['timeline', 'statement', 'gallery', 'people', 'diagram', 'code'];
const PX = 'data:image/png;base64,iVBORw0KGgo=';

function slideOf(kind: string, content: Record<string, unknown>, variant?: string): Slide {
  return { id: 's1', kind, content, variant, notes: { script: '', keyPoints: [], cues: [], check: null, minutes: 2, links: [] } };
}

function lay(kind: string, content: Record<string, unknown>, o: { variant?: string; theme?: string; audience?: (typeof AUDIENCES)[number]; mode?: 'edit' | 'show' } = {}) {
  return layoutSlide(slideOf(kind, content, o.variant), { theme: getTheme(o.theme ?? 'paper'), audience: o.audience ?? 'adult', mode: o.mode ?? 'show' });
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

const texts = (boxes: Box[]) => boxes.filter((b): b is TextBox => b.type === 'text');
const images = (boxes: Box[]) => boxes.filter((b): b is ImageBox => b.type === 'image');
const shapes = (boxes: Box[]) => boxes.filter((b): b is ShapeBox => b.type === 'shape');

describe('visual kinds', () => {
  it('registers all six with valid definitions', () => {
    expect(VISUAL_KINDS.map((k) => k.kind)).toEqual(IDS);
    for (const id of IDS) {
      const def = getKind(id)!;
      expect(def, id).toBeDefined();
      expect(def.plugin ?? '').toBe('');
      expect(def.fields.length).toBeGreaterThan(0);
      for (const f of def.fields) expect(f.label.length, `${id}.${f.key}`).toBeGreaterThan(0);
      expect(def.heading(def.create()).length).toBeGreaterThan(0);
      expect(def.text(def.create()).length).toBeGreaterThan(0);
    }
  });

  for (const def of VISUAL_KINDS) {
    const variants = def.variants?.map((v) => v.id) ?? [undefined];
    describe(def.kind, () => {
      it('lays out its example with no warnings for every audience, theme, variant and mode', () => {
        for (const variant of variants) for (const theme of THEMES) for (const audience of AUDIENCES) for (const mode of ['show', 'edit'] as const) {
          const out = lay(def.kind, def.create(), { variant, theme: theme.id, audience, mode });
          expect(out.warnings, `${def.kind}/${variant ?? '-'} ${theme.id} ${audience} ${mode}`).toEqual([]);
          inside(out.boxes);
        }
      });

      it('binds every field-backed box to a real field', () => {
        const keys = new Set(def.fields.map((f) => f.key));
        for (const variant of variants) {
          const out = lay(def.kind, def.create(), { variant, mode: 'edit' });
          for (const b of out.boxes) if (b.bind) expect(keys.has(b.bind.split('.')[0]!), `${variant ?? '-'} ${b.id} -> ${b.bind}`).toBe(true);
          for (const t of texts(out.boxes)) {
            if (!t.text.trim() || t.id === 'page' || /^(num|badge|initials|code-ph)/.test(t.id) || t.id.includes('-ph')) continue;
            expect(t.bind, `${variant ?? '-'} ${t.id}`).toBeTruthy();
          }
        }
      });

      it('survives empty and partial content', () => {
        for (const variant of variants) for (const content of [{}, { title: 'Only a title' }, { items: [{}], milestones: [{}], images: [{}], people: [{}] }]) {
          const out = lay(def.kind, content, { variant, mode: 'edit' });
          inside(out.boxes);
        }
      });
    });
  }
});

describe('timeline', () => {
  const create = () => getKind('timeline')!.create();
  const many = (n: number) => ({ title: 'Plan', milestones: Array.from({ length: n }, (_, i) => ({ date: `Q${i + 1}`, title: `Phase ${i + 1}`, detail: 'A short note' })), reveal: false });

  it('puts a date, marker and title on the axis for each milestone', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      for (const audience of AUDIENCES) {
        const out = lay('timeline', many(n), { audience });
        expect(out.warnings.filter((w) => !/words on this slide/.test(w)), `${n} ${audience}`).toEqual([]);
        expect(shapes(out.boxes).filter((s) => s.id.startsWith('marker-'))).toHaveLength(n);
        expect(texts(out.boxes).filter((t) => t.id.startsWith('date-'))).toHaveLength(n);
        expect(out.steps).toBe(0);
        inside(out.boxes);
      }
    }
  });

  it('reveals one milestone per click when asked', () => {
    for (const n of [2, 4, 6]) {
      const out = lay('timeline', { ...many(n), reveal: true });
      expect(out.steps).toBe(n);
      for (let k = 0; k < n; k++) {
        const group = out.boxes.filter((b) => b.id.endsWith(`-${k}`) && b.id !== 'page');
        expect(group.length).toBeGreaterThanOrEqual(3);
        for (const b of group) expect(b.step, b.id).toBe(k + 1);
      }
      expect(out.boxes.find((b) => b.id === 'axis')?.step).toBeUndefined();
    }
  });

  it('ignores blank milestones but keeps bind indexes', () => {
    const out = lay('timeline', { title: 'T', milestones: [{ date: 'A', title: 'One' }, {}, { date: 'C', title: 'Three' }] });
    expect(texts(out.boxes).filter((t) => t.id.startsWith('date-')).map((t) => t.bind)).toEqual(['milestones.0.date', 'milestones.2.date']);
  });

  it('has a sensible heading and text', () => {
    const def = getKind('timeline')!;
    expect(def.heading(create())).toBe('Product roadmap');
    expect(def.text(create())[0]).toBe('Product roadmap');
    expect(def.heading({})).toBe('Timeline');
  });
});

describe('statement', () => {
  it('uses the theme background in plain and the accent in bold', () => {
    for (const theme of THEMES) {
      const plain = lay('statement', getKind('statement')!.create(), { theme: theme.id, variant: 'plain' });
      const bold = lay('statement', getKind('statement')!.create(), { theme: theme.id, variant: 'bold' });
      expect(plain.background).toBe(theme.colors.bg);
      expect(bold.background).toBe(theme.colors.accent);
      for (const t of texts(bold.boxes)) expect(t.style.color, `${theme.id} ${t.id}`).toBe(theme.colors.onAccent);
      expect(bold.boxes.some((b) => b.id.startsWith('deco') || b.id === 'page')).toBe(false);
    }
  });

  it('works with just the message', () => {
    const out = lay('statement', { statement: 'One line.' }, { variant: 'bold' });
    expect(texts(out.boxes).map((t) => t.id)).toEqual(['statement']);
    expect(out.warnings).toEqual([]);
  });

  it('warns when the message cannot fit', () => {
    const out = lay('statement', { statement: 'word '.repeat(300) });
    expect(out.warnings.some((w) => /too long to fit/.test(w))).toBe(true);
  });
});

describe('gallery', () => {
  const content = (n: number, image = '') => ({ title: 'Photos', images: Array.from({ length: n }, (_, i) => ({ image, caption: `Shot ${i + 1}` })) });

  it('draws image placeholders only in edit mode', () => {
    for (const variant of ['grid', 'strip']) for (const n of [2, 3, 4]) {
      const show = lay('gallery', content(n), { variant, mode: 'show' });
      const edit = lay('gallery', content(n), { variant, mode: 'edit' });
      expect(shapes(show.boxes).filter((s) => s.id.endsWith('-ph'))).toHaveLength(0);
      expect(images(show.boxes)).toHaveLength(0);
      expect(shapes(edit.boxes).filter((s) => s.id.endsWith('-ph'))).toHaveLength(n);
    }
  });

  it('shows every image with its caption, inside the canvas, without overlap', () => {
    for (const variant of ['grid', 'strip']) for (const n of [2, 3, 4]) for (const audience of AUDIENCES) {
      const out = lay('gallery', content(n, PX), { variant, audience });
      expect(out.warnings).toEqual([]);
      const imgs = images(out.boxes);
      expect(imgs).toHaveLength(n);
      expect(imgs.map((i) => i.bind)).toEqual(Array.from({ length: n }, (_, i) => `images.${i}.image`));
      expect(texts(out.boxes).filter((t) => t.id.startsWith('caption-'))).toHaveLength(n);
      inside(out.boxes);
      imgs.forEach((a, i) => imgs.slice(i + 1).forEach((b) => {
        const apart = a.x + a.w <= b.x + 1 || b.x + b.w <= a.x + 1 || a.y + a.h <= b.y + 1 || b.y + b.h <= a.y + 1;
        expect(apart, `${variant} ${n}: ${a.id} vs ${b.id}`).toBe(true);
      }));
    }
  });

  it('works without a title or captions', () => {
    const out = lay('gallery', { images: [{ image: PX }, { image: PX }] }, { variant: 'strip' });
    expect(images(out.boxes)).toHaveLength(2);
    expect(texts(out.boxes)).toHaveLength(0);
  });
});

describe('people', () => {
  const people = (n: number, photo = '') => ({
    title: 'Team',
    people: Array.from({ length: n }, (_, i) => ({ photo, name: `Person Number${i + 1}`, role: 'Role here' })),
  });

  it('lays out one to six people without warnings', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) for (const audience of AUDIENCES) for (const theme of THEMES) {
      const out = lay('people', people(n), { audience, theme: theme.id });
      expect(out.warnings, `${n} ${audience} ${theme.id}`).toEqual([]);
      inside(out.boxes);
      expect(texts(out.boxes).filter((t) => t.id.startsWith('name-'))).toHaveLength(n);
    }
  });

  it('draws an initials circle in every mode when there is no photo', () => {
    for (const mode of ['show', 'edit'] as const) {
      const theme = getTheme('midnight');
      const out = lay('people', { people: [{ name: 'Maya Chen', role: 'Lead' }, { name: 'Sam' }] }, { mode, theme: 'midnight' });
      const circles = shapes(out.boxes).filter((s) => s.id.startsWith('photo-'));
      expect(circles).toHaveLength(2);
      for (const c of circles) { expect(c.shape).toBe('ellipse'); expect(c.fill).toBe(theme.colors.accent2); expect(c.w).toBe(c.h); }
      expect(texts(out.boxes).filter((t) => t.id.startsWith('initials-')).map((t) => t.text)).toEqual(['MC', 'SA']);
    }
  });

  it('draws round photos when there is one', () => {
    for (const n of [1, 3, 6]) {
      const out = lay('people', people(n, PX));
      const imgs = images(out.boxes);
      expect(imgs).toHaveLength(n);
      for (const i of imgs) { expect(i.w).toBe(i.h); expect(i.radius).toBe(i.w / 2); }
      expect(texts(out.boxes).filter((t) => t.id.startsWith('initials-'))).toHaveLength(0);
    }
  });

  it('mixes photos and initials', () => {
    const out = lay('people', { people: [{ photo: PX, name: 'A B' }, { name: 'C D' }] });
    expect(images(out.boxes)).toHaveLength(1);
    expect(texts(out.boxes).filter((t) => t.id.startsWith('initials-'))).toHaveLength(1);
  });
});

describe('diagram', () => {
  const diagram = (n: number, reveal = false) => ({
    title: 'Process',
    items: Array.from({ length: n }, (_, i) => ({ label: `Stage ${i + 1}`, detail: 'Short detail' })),
    xAxis: 'Effort', yAxis: 'Impact', reveal,
  });

  it('lays out cycles of three to six without warnings or overlap', () => {
    for (const n of [3, 4, 5, 6]) for (const audience of AUDIENCES) for (const theme of THEMES) {
      const out = lay('diagram', diagram(n), { variant: 'cycle', audience, theme: theme.id });
      expect(out.warnings.filter((w) => !/words on this slide/.test(w)), `${n} ${audience} ${theme.id}`).toEqual([]);
      inside(out.boxes);
      const nodes = shapes(out.boxes).filter((s) => s.id.startsWith('node-'));
      expect(nodes).toHaveLength(n);
      nodes.forEach((a, i) => nodes.slice(i + 1).forEach((b) => {
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${n} nodes ${a.id} vs ${b.id}`).toBe(true);
      }));
    }
  });

  it('narrows the funnel bars downward', () => {
    for (const n of [2, 3, 5, 6]) {
      const out = lay('diagram', diagram(n), { variant: 'funnel' });
      expect(out.warnings).toEqual([]);
      inside(out.boxes);
      const widths = shapes(out.boxes).filter((s) => s.id.startsWith('bar-')).map((s) => s.w);
      expect(widths).toHaveLength(n);
      for (let k = 1; k < n; k++) expect(widths[k]!).toBeLessThan(widths[k - 1]!);
    }
  });

  it('draws four quadrants and both axis labels in the matrix', () => {
    const out = lay('diagram', diagram(4), { variant: 'matrix' });
    expect(out.warnings).toEqual([]);
    inside(out.boxes);
    expect(shapes(out.boxes).filter((s) => s.id.startsWith('quad-') && !s.id.endsWith('-bar'))).toHaveLength(4);
    expect(texts(out.boxes).find((t) => t.id === 'x-axis')?.text).toContain('Effort');
    expect(texts(out.boxes).find((t) => t.id === 'y-axis')?.text).toContain('Impact');
  });

  it('reveals items one at a time in every variant', () => {
    for (const variant of ['cycle', 'funnel', 'matrix']) {
      const n = variant === 'matrix' ? 4 : 5;
      const out = lay('diagram', diagram(n, true), { variant });
      expect(out.steps, variant).toBe(n);
      expect(lay('diagram', diagram(n, false), { variant }).steps).toBe(0);
    }
  });

  it('uses only the first four items in the matrix', () => {
    const out = lay('diagram', diagram(6), { variant: 'matrix' });
    expect(shapes(out.boxes).filter((s) => /^quad-\d$/.test(s.id))).toHaveLength(4);
  });
});

describe('code', () => {
  const snippet = ['function greet(name) {', '  if (!name) {', '    return "Hello";', '  }', '  return `Hi ${name}`;', '}'].join('\n');

  it('keeps indentation, on a dark panel with light text, on every theme', () => {
    for (const theme of THEMES) {
      const out = lay('code', { title: 'Greeting', language: 'JavaScript', code: snippet, caption: 'Early return' }, { theme: theme.id });
      expect(out.warnings, theme.id).toEqual([]);
      const body = texts(out.boxes).find((t) => t.id === 'code')!;
      expect(body.text).toBe(snippet);
      expect(body.text).toContain('\n    return "Hello";');
      expect(body.style.font).toBe('mono');
      const panel = shapes(out.boxes).find((s) => s.id === 'panel')!;
      const lum = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0) / 3;
      expect(lum(panel.fill!)).toBeLessThan(60);
      expect(lum(body.style.color)).toBeGreaterThan(200);
    }
  });

  it('turns tabs and Windows line endings into plain spaces and newlines', () => {
    const out = lay('code', { code: 'a:\r\n\tb\r\n' });
    expect(texts(out.boxes).find((t) => t.id === 'code')!.text).toBe('a:\n  b');
  });

  it('shrinks long snippets to fit and warns when it cannot', () => {
    const size = (code: string) => texts(lay('code', { title: 'T', code }).boxes).find((t) => t.id === 'code')!.style.size;
    const short = Array.from({ length: 4 }, (_, i) => `line ${i}`).join('\n');
    const long = Array.from({ length: 14 }, (_, i) => `  statement_${i}();`).join('\n');
    expect(size(long)).toBeLessThan(size(short));
    expect(lay('code', { title: 'T', code: long }).warnings).toEqual([]);

    const tooMany = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    expect(lay('code', { title: 'T', code: tooMany }).warnings.some((w) => /too long to fit/.test(w))).toBe(true);
    const tooWide = `const x = "${'y'.repeat(200)}";`;
    expect(lay('code', { title: 'T', code: tooWide }).warnings.some((w) => /too long to fit/.test(w))).toBe(true);
  });

  it('keeps a long snippet and its caption inside the canvas', () => {
    const out = lay('code', { title: 'Long title for a code slide', language: 'Go', code: Array.from({ length: 12 }, (_, i) => `x${i} := ${i}`).join('\n'), caption: 'Note this.' }, { audience: 'young' });
    inside(out.boxes);
  });

  it('shows a prompt for empty code in edit mode only', () => {
    expect(texts(lay('code', {}, { mode: 'edit' }).boxes).some((t) => t.id === 'code-ph')).toBe(true);
    expect(texts(lay('code', {}, { mode: 'show' }).boxes).some((t) => t.id === 'code-ph')).toBe(false);
  });
});
