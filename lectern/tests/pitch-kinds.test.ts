// @vitest-environment node
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { canSplit, isOverflowWarning, splitSlide } from '../src/core/deck/split';
import { type Deck, type Slide, emptyNotes } from '../src/core/deck/types';
import { CANVAS_H, CANVAS_W, type Box, type ImageBox, type ShapeBox, type TextBox } from '../src/core/engine/boxes';
import { layoutSlide } from '../src/core/engine/layout';
import { THEMES, getTheme } from '../src/core/engine/themes';
import { exportDeckToPptx } from '../src/core/export/pptx';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { PITCH_KINDS, detailLabel, featureLines, progressOf, statusOf } from '../src/core/kinds/pitch-kinds';
import { getKind } from '../src/core/kinds/registry';

registerCoreKinds();

const AUDIENCES = ['young', 'teen', 'adult'] as const;
const PX = 'data:image/png;base64,iVBORw0KGgo=';

const slideOf = (kind: string, content: Record<string, unknown>): Slide => ({ id: `s-${kind}`, kind, content, notes: emptyNotes() });

function lay(kind: string, content: Record<string, unknown>, o: { theme?: string; audience?: (typeof AUDIENCES)[number]; mode?: 'edit' | 'show'; target?: 'web' | 'pptx' } = {}) {
  return layoutSlide(slideOf(kind, content), { theme: getTheme(o.theme ?? 'paper'), audience: o.audience ?? 'adult', mode: o.mode ?? 'show', target: o.target, slideCount: 8, slideNumber: 3 });
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

/** Text boxes that cover each other, apart from a tick and its line. */
function collisions(boxes: Box[]) {
  const t = boxes.filter((b): b is TextBox => b.type === 'text' && !!b.text.trim() && !['page', 'footer'].includes(b.id));
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

const texts = (boxes: Box[]) => boxes.filter((b): b is TextBox => b.type === 'text');
const shapes = (boxes: Box[]) => boxes.filter((b): b is ShapeBox => b.type === 'shape');
const byId = (boxes: Box[], id: string) => boxes.find((b) => b.id === id);

describe('pitch kinds', () => {
  it('registers scorecard, pricing and contact with valid definitions', () => {
    expect(PITCH_KINDS.map((k) => k.kind)).toEqual(['scorecard', 'pricing', 'contact']);
    for (const def of PITCH_KINDS) {
      expect(getKind(def.kind)).toBe(def);
      expect(def.plugin ?? '').toBe('');
      for (const f of def.fields) expect(f.label.length, `${def.kind}.${f.key}`).toBeGreaterThan(0);
      expect(def.heading(def.create()).length).toBeGreaterThan(0);
      expect(def.text(def.create()).length).toBeGreaterThan(0);
    }
    expect(getKind('scorecard')!.group).toBe('Data');
    expect(getKind('pricing')!.group).toBe('Data');
    expect(getKind('contact')!.group).toBe('Close');
  });

  for (const def of PITCH_KINDS) {
    it(`${def.kind}: lays out its example with no warnings for every audience, look and mode`, () => {
      for (const theme of THEMES) for (const audience of AUDIENCES) for (const mode of ['show', 'edit'] as const) {
        const out = lay(def.kind, def.create(), { theme: theme.id, audience, mode });
        // A price list is more words than young learners' slides allow; that advice is all it may get.
        const warnings = def.kind === 'pricing' && audience === 'young' ? out.warnings.filter((w) => !/words on this slide/.test(w)) : out.warnings;
        expect(warnings, `${def.kind} ${theme.id} ${audience} ${mode}`).toEqual([]);
        inside(out.boxes);
        expect(collisions(out.boxes), `${def.kind} ${theme.id} ${audience}`).toEqual([]);
      }
    });

    it(`${def.kind}: survives empty and junk content`, () => {
      for (const content of [{}, { title: 42, metrics: 'x', plans: [null, 3], details: [1, null] }]) {
        const out = lay(def.kind, content as Record<string, unknown>, { mode: 'edit' });
        expect(out.boxes.length).toBeGreaterThan(0);
        inside(out.boxes);
      }
    });
  }
});

describe('scorecard', () => {
  it('reads what a typed status means', () => {
    expect(statusOf('On track')).toBe('good');
    expect(statusOf('on-track')).toBe('good');
    expect(statusOf('Done ✓')).toBe('good');
    expect(statusOf('At risk')).toBe('warn');
    expect(statusOf('Off track')).toBe('bad');
    expect(statusOf('Behind plan')).toBe('bad');
    expect(statusOf('Paused')).toBe('neutral');
    expect(statusOf('  ')).toBeNull();
  });

  it('measures progress towards the target, either way round', () => {
    expect(progressOf('8,200', '10,000')).toBeCloseTo(0.82);
    expect(progressOf('$1.5M', '$1M')).toBe(1);
    expect(progressOf('2.5%', '2%', true)).toBeCloseTo(0.8);
    expect(progressOf('1%', '2%', true)).toBe(1);
    expect(progressOf('lots', '10')).toBeNull();
    expect(progressOf('5', '0')).toBeNull();
  });

  it('fills each bar to its share of the target, coloured by status', () => {
    const out = lay('scorecard', {
      title: 'Goals',
      metrics: [
        { label: 'Users', value: '50', target: '100', status: 'At risk' },
        { label: 'Teams', value: '100', target: '100', status: 'Off track' },
        { label: 'Revenue', value: '30', target: '100', status: '' },
      ],
    });
    const track = byId(out.boxes, 'track-0') as ShapeBox;
    expect((byId(out.boxes, 'bar-0') as ShapeBox).w).toBeCloseTo(track.w * 0.5, 0);
    expect((byId(out.boxes, 'bar-1') as ShapeBox).w).toBeCloseTo(track.w, 0);
    expect((byId(out.boxes, 'bar-0') as ShapeBox).fill).not.toBe((byId(out.boxes, 'bar-1') as ShapeBox).fill);
    // No status: the bar takes the accent and no pill is drawn.
    expect((byId(out.boxes, 'bar-2') as ShapeBox).fill).toBe(getTheme('paper').colors.accent);
    expect(byId(out.boxes, 'pill-2')).toBeUndefined();
    expect((byId(out.boxes, 'pct-0') as TextBox).text).toBe('50%');
    expect((byId(out.boxes, 'target-0') as TextBox).text).toBe('Target 100');
  });

  it('skips the bar when the numbers are missing, and the percentage when lower is better', () => {
    const out = lay('scorecard', { metrics: [{ label: 'Mood', value: 'Good' }, { label: 'Cost', value: '$90', target: '$100', lower: true }] });
    expect(byId(out.boxes, 'track-0')).toBeUndefined();
    expect(byId(out.boxes, 'bar-1')).toBeDefined();
    expect(byId(out.boxes, 'pct-1')).toBeUndefined();
  });

  it('reveals one measure per click when asked', () => {
    const out = lay('scorecard', { ...getKind('scorecard')!.create(), reveal: true });
    expect(out.steps).toBe(4);
    expect((byId(out.boxes, 'label-2') as TextBox).step).toBe(3);
  });

  it('says when measures are left off, and splits like the other lists', () => {
    const metrics = Array.from({ length: 8 }, (_, i) => ({ label: `Measure ${i + 1}`, value: '1', target: '2' }));
    expect(lay('scorecard', { metrics }).warnings.join(' ')).toMatch(/first six/);
    const slide = slideOf('scorecard', { title: 'Goals', metrics });
    expect(canSplit(slide)).toBe(true);
    const [a, b] = splitSlide(slide)!;
    expect((a.content.metrics as unknown[]).length + (b.content.metrics as unknown[]).length).toBe(8);
    expect(b.content.title).toBe('Goals (cont.)');
  });

  it('binds each row to the measure it shows, even after a blank one', () => {
    const out = lay('scorecard', { metrics: [{ label: 'A', value: '1' }, { label: '', value: '' }, { label: 'C', value: '3' }] });
    expect((byId(out.boxes, 'label-1') as TextBox).bind).toBe('metrics.2.label');
  });
});

describe('pricing', () => {
  it('reads one feature per line without the bullets people type', () => {
    expect(featureLines('- One\n• Two\n\n✓ Three  \r\n* Four')).toEqual(['One', 'Two', 'Three', 'Four']);
  });

  it('lifts the recommended plan out in the accent colour with its label', () => {
    const out = lay('pricing', getKind('pricing')!.create());
    const plain = byId(out.boxes, 'plan-0') as ShapeBox;
    const featured = byId(out.boxes, 'plan-1') as ShapeBox;
    expect(featured.fill).toBe(getTheme('paper').colors.accent);
    expect(featured.y).toBeLessThan(plain.y);
    expect(featured.h).toBeGreaterThan(plain.h);
    expect(plain.w).toBe(featured.w);
    expect((byId(out.boxes, 'badge-1') as TextBox).text).toBe('Most popular');
    expect(byId(out.boxes, 'badge-0')).toBeUndefined();
    expect(texts(out.boxes).filter((t) => t.text === '✓')).toHaveLength(8);
  });

  it('keeps one or two plans to a readable width, centred', () => {
    const out = lay('pricing', { plans: [{ name: 'Only', price: '$5', features: 'All of it' }] });
    const c = byId(out.boxes, 'plan-0') as ShapeBox;
    expect(c.w).toBeLessThanOrEqual(760);
    expect(Math.abs(c.x + c.w / 2 - CANVAS_W / 2)).toBeLessThan(2);
  });

  it('warns, in words Split understands, when the features do not fit', () => {
    const features = Array.from({ length: 8 }, (_, i) => `A long feature line number ${i + 1} that goes on and on about what it does`).join('\n');
    const out = lay('pricing', { plans: [1, 2, 3, 4].map((i) => ({ name: `Plan ${i}`, price: '$9', features })) }, { audience: 'young' });
    expect(out.warnings.some(isOverflowWarning)).toBe(true);
  });

  it('shows a footnote under the plans', () => {
    const out = lay('pricing', { ...getKind('pricing')!.create(), caption: 'Prices exclude tax.' });
    const cap = byId(out.boxes, 'caption') as TextBox;
    expect(cap.y).toBeGreaterThan((byId(out.boxes, 'plan-0') as ShapeBox).y + (byId(out.boxes, 'plan-0') as ShapeBox).h);
  });
});

describe('contact', () => {
  it('names each way to reach someone', () => {
    expect(detailLabel('maya@example.com')).toBe('Email');
    expect(detailLabel('lectern.app')).toBe('Web');
    expect(detailLabel('https://lectern.app/talks')).toBe('Web');
    expect(detailLabel('+44 20 7946 0958')).toBe('Phone');
    expect(detailLabel('@mayachen')).toBe('Handle');
    expect(detailLabel('Room 4B, second floor')).toBe('');
  });

  it('adds a QR code for the link, with the address under it', () => {
    const out = lay('contact', { ...getKind('contact')!.create(), link: 'https://lectern.app/talk' });
    const qr = out.boxes.find((b): b is ImageBox => b.type === 'image' && b.id === 'qr');
    expect(qr).toBeDefined();
    expect((byId(out.boxes, 'qr-label') as TextBox).text).toBe('lectern.app/talk');
    expect(lay('contact', getKind('contact')!.create()).boxes.some((b) => b.id === 'qr')).toBe(false);
  });

  it('shows the photo large without a QR code, and small beside the name with one', () => {
    const big = lay('contact', { ...getKind('contact')!.create(), photo: PX }).boxes.find((b) => b.id === 'photo')!;
    const small = lay('contact', { ...getKind('contact')!.create(), photo: PX, link: 'https://x.org' }).boxes.find((b) => b.id === 'photo')!;
    expect(big.w).toBeGreaterThan(400);
    expect(small.w).toBeLessThan(220);
  });

  it('binds each detail to its own line, even after a blank one', () => {
    const out = lay('contact', { name: 'Sam', details: ['sam@example.com', '', 'sam.dev'] });
    expect((byId(out.boxes, 'detail-1') as TextBox).bind).toBe('details.2');
    expect((byId(out.boxes, 'detail-label-1') as TextBox).text).toBe('Web');
  });
});

describe('pitch kinds in PowerPoint', () => {
  it('export as native shapes and text', async () => {
    const deck: Deck = {
      id: 'd', title: 'Q3 review', themeId: 'paper', audience: 'adult', createdAt: 0, updatedAt: 0,
      slides: PITCH_KINDS.map((def) => ({ ...slideOf(def.kind, def.kind === 'contact' ? { ...def.create(), link: 'https://lectern.app' } : def.create()), id: `s-${def.kind}` })),
    };
    const { data, warnings } = await exportDeckToPptx(deck, { output: 'nodebuffer' });
    expect(warnings).toEqual([]);
    const zip = await JSZip.loadAsync(data as Uint8Array);
    const xml = await Promise.all([1, 2, 3].map((n) => zip.file(`ppt/slides/slide${n}.xml`)!.async('string')));
    expect(xml[0]).toContain('Active users');
    expect(xml[1]).toContain('MOST POPULAR');
    expect(xml[2]).toContain('maya@example.com');
    expect(Object.keys(zip.files).some((f) => f.startsWith('ppt/media/'))).toBe(true);
    expect(shapes(lay('scorecard', getKind('scorecard')!.create(), { target: 'pptx' }).boxes).length).toBeGreaterThan(8);
  });
});
