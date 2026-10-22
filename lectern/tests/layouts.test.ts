// @vitest-environment node
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { autoVariants } from '../src/core/deck/auto-style';
import { type Deck, type Slide, emptyNotes } from '../src/core/deck/types';
import { CANVAS_H, CANVAS_W, type Box, type ImageBox, type ShapeBox, type TextBox } from '../src/core/engine/boxes';
import { layoutSlide } from '../src/core/engine/layout';
import { cleanOverride, hasOverrides, withOverride, withoutOverrides } from '../src/core/engine/overrides';
import { THEMES, getTheme } from '../src/core/engine/themes';
import { exportDeckToPptx } from '../src/core/export/pptx';
import { initials, registerCoreKinds } from '../src/core/kinds/core-kinds';
import { getKind } from '../src/core/kinds/registry';
import { convertSlide } from '../src/features/studio/convert';

registerCoreKinds();

const AUDIENCES = ['young', 'teen', 'adult'] as const;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const slideOf = (kind: string, content: Record<string, unknown>, extra: Partial<Slide> = {}): Slide => ({ id: `s-${kind}`, kind, content, notes: emptyNotes(), ...extra });

function lay(slide: Slide, o: { theme?: string; audience?: (typeof AUDIENCES)[number]; mode?: 'edit' | 'show' } = {}) {
  return layoutSlide(slide, { theme: getTheme(o.theme ?? 'paper'), audience: o.audience ?? 'adult', mode: o.mode ?? 'show', slideCount: 8, slideNumber: 3 });
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

/** Text boxes that cover each other, apart from markers on their items. */
function collisions(boxes: Box[]) {
  const t = boxes.filter((b): b is TextBox => b.type === 'text' && !!b.text.trim() && !['page', 'footer', 'mark', 'avatar-t'].includes(b.id) && !(b.moveWith && /-[nc]\d+$|^num-/.test(b.id)));
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
const textOf = (boxes: Box[], id: string) => byId(boxes, id) as TextBox;
const auto = (previous?: string) => ({ index: 2, count: 8, nth: 1, previous });

const EXAMPLES: [string, string, Record<string, unknown>][] = [
  ['quote', 'testimonial', { quote: 'Lectern turned our weekly review into twenty minutes.', attribution: 'Priya Shah', role: 'Head of operations, Northwind', photo: PNG }],
  ['quote', 'testimonial', { quote: 'Lectern turned our weekly review into twenty minutes.', attribution: 'Priya Shah', role: 'Head of operations' }],
  ['stats', 'hero', { title: 'Since launch', stats: [{ value: '3×', label: 'faster to build a deck', detail: 'Measured over 400 decks' }] }],
  ['steps', 'down', { title: 'How we onboard', steps: [
    { label: 'Welcome call', detail: 'A thirty-minute call to learn what the team needs and who will run it.' },
    { label: 'Set up', detail: 'We import the old decks and set the look to the brand.' },
    { label: 'First talk', detail: 'The team gives one real talk with Lectern, with us on hand.' },
    { label: 'Review', detail: 'We look at what worked and what to change, then hand over.' },
  ] }],
  ['agenda', 'here', { title: 'Today', items: ['The problem', 'What we found', 'What it means', 'Next steps'], current: 1 }],
  ['bullets', 'left', { title: 'Why it works', bullets: ['Short points', 'One idea each', 'A picture to anchor them'], image: PNG }],
  ['bullets', 'columns', { title: 'Checklist', bullets: ['Agenda sent', 'Room booked', 'Slides shared', 'Notes ready', 'Timer set', 'Questions planned', 'Follow-up drafted'] }],
];

describe('layouts of existing slide types', () => {
  for (const [kind, variant, content] of EXAMPLES) {
    it(`${kind} (${variant}) lays out with no warnings for every audience, look and mode`, () => {
      expect(getKind(kind)!.variants!.some((v) => v.id === variant)).toBe(true);
      for (const theme of THEMES) for (const audience of AUDIENCES) for (const mode of ['show', 'edit'] as const) {
        const out = lay(slideOf(kind, content, { variant }), { theme: theme.id, audience, mode });
        // Word counts are advice; these examples carry more words than some audiences' budgets.
        const warnings = out.warnings.filter((w) => !/words on this slide/.test(w));
        expect(warnings, `${kind} ${variant} ${theme.id} ${audience} ${mode}`).toEqual([]);
        inside(out.boxes);
        expect(collisions(out.boxes), `${kind} ${variant} ${theme.id} ${audience}`).toEqual([]);
      }
    });
  }

  it('testimonial: a round photo beside the words, or initials beside the name', () => {
    const withPhoto = lay(slideOf('quote', EXAMPLES[0]![2], { variant: 'testimonial' }));
    const photo = byId(withPhoto.boxes, 'photo') as ImageBox;
    expect(photo.radius).toBe(photo.w / 2);
    expect(textOf(withPhoto.boxes, 'quote').x).toBeGreaterThan(photo.x + photo.w);
    expect(textOf(withPhoto.boxes, 'role').text).toBe('Head of operations, Northwind');
    const without = lay(slideOf('quote', EXAMPLES[1]![2], { variant: 'testimonial' }));
    expect(textOf(without.boxes, 'avatar-t').text).toBe('PS');
    expect(byId(without.boxes, 'avatar')!.bind).toBe('photo');
    expect(initials('— ada lovelace')).toBe('AL');
    // The plain quote names the role after the person.
    expect(textOf(lay(slideOf('quote', EXAMPLES[1]![2])).boxes, 'attribution').text).toBe('— Priya Shah, Head of operations');
    expect(getKind('quote')!.autoVariant!({ photo: PNG }, auto())).toBe('testimonial');
    expect(getKind('quote')!.autoVariant!({ quote: 'Hi' }, auto())).toBe('plain');
  });

  it('one big number: the first figure alone, centred and huge', () => {
    const out = lay(slideOf('stats', EXAMPLES[2]![2], { variant: 'hero' }));
    const v = textOf(out.boxes, 'v0');
    expect(v.style.align).toBe('center');
    expect(v.style.size).toBeGreaterThan(250);
    expect(textOf(out.boxes, 'l0').moveWith).toBe('v0');
    const two = lay(slideOf('stats', { stats: [{ value: '1' }, { value: '2' }] }, { variant: 'hero' }));
    expect(two.warnings.join(' ')).toMatch(/first figure only/);
    expect(byId(two.boxes, 'v1')).toBeUndefined();
    expect(getKind('stats')!.autoVariant!(EXAMPLES[2]![2], auto())).toBe('hero');
    expect(getKind('stats')!.autoVariant!(getKind('stats')!.create(), auto())).toBe('row');
  });

  it('steps top to bottom: one row per step, details beside their labels', () => {
    const out = lay(slideOf('steps', EXAMPLES[3]![2], { variant: 'down' }));
    const nodes = out.boxes.filter((b) => /^node-\d$/.test(b.id));
    expect(new Set(nodes.map((n) => n.x)).size).toBe(1);
    expect(nodes[1]!.y).toBeGreaterThan(nodes[0]!.y);
    expect(textOf(out.boxes, 'detail-0').x).toBe(textOf(out.boxes, 'label-0').x);
    expect(getKind('steps')!.autoVariant!(EXAMPLES[3]![2], auto())).toBe('down');
    expect(getKind('steps')!.autoVariant!(getKind('steps')!.create(), auto())).toBe('across');
  });

  it('agenda, you are here: the current part on an accent band, earlier ones faded', () => {
    const out = lay(slideOf('agenda', EXAMPLES[4]![2], { variant: 'here' }));
    const colors = getTheme('paper').colors;
    const band = byId(out.boxes, 'here') as ShapeBox;
    const current = textOf(out.boxes, 'items-1');
    expect(band.fill).toBe(colors.accent);
    expect(band.y).toBeLessThanOrEqual(current.y);
    expect(band.y + band.h).toBeGreaterThanOrEqual(current.y + current.h);
    expect(current.style.color).toBe(colors.onAccent);
    expect(byId(out.boxes, 'items-0')!.opacity).toBeLessThan(1);
    expect(byId(out.boxes, 'items-2')!.opacity ?? 1).toBe(1);
    expect(out.boxes.indexOf(band)).toBeLessThan(out.boxes.indexOf(current));
    // Nothing marked: the plain list.
    expect(byId(lay(slideOf('agenda', { items: ['A', 'B'] }, { variant: 'here' })).boxes, 'here')).toBeUndefined();
    expect(getKind('agenda')!.autoVariant!(EXAMPLES[4]![2], auto())).toBe('here');
    expect(getKind('agenda')!.autoVariant!(getKind('agenda')!.create(), auto())).toBe('list');
  });

  it('points: the picture on either side, or two columns of one size', () => {
    const right = lay(slideOf('bullets', EXAMPLES[5]![2], { variant: 'right' }));
    const left = lay(slideOf('bullets', EXAMPLES[5]![2], { variant: 'left' }));
    expect(byId(right.boxes, 'image')!.x).toBeGreaterThan(textOf(right.boxes, 'bullets-0').x);
    expect(byId(left.boxes, 'image')!.x).toBeLessThan(textOf(left.boxes, 'bullets-0').x);
    // Picture left keeps a frame to drop into while editing, and none when presenting.
    expect(byId(lay(slideOf('bullets', { bullets: ['A'] }, { variant: 'left' }), { mode: 'edit' }).boxes, 'image-ph')).toBeDefined();
    expect(byId(lay(slideOf('bullets', { bullets: ['A'] }, { variant: 'left' })).boxes, 'image-ph')).toBeUndefined();
    const cols = lay(slideOf('bullets', EXAMPLES[6]![2], { variant: 'columns' }));
    const first = textOf(cols.boxes, 'bullets-0');
    const fifth = textOf(cols.boxes, 'bullets-4');
    expect(fifth.x).toBeGreaterThan(first.x + first.w);
    expect(fifth.y).toBe(first.y);
    expect(fifth.style.size).toBe(first.style.size);
    expect(fifth.bind).toBe('bullets.4');
    expect(lay(slideOf('bullets', { ...EXAMPLES[6]![2], image: PNG }, { variant: 'columns' })).warnings.join(' ')).toMatch(/no room for the picture/);
  });

  it('points: auto style alternates picture sides and puts long lists of short points in columns', () => {
    const def = getKind('bullets')!;
    expect(def.autoVariant!({ image: PNG }, auto())).toBe('right');
    expect(def.autoVariant!({ image: PNG }, auto('right'))).toBe('left');
    expect(def.autoVariant!(EXAMPLES[6]![2], auto())).toBe('columns');
    expect(def.autoVariant!(def.create(), auto())).toBe('right');
  });

  it('lists bind each item to its place in the stored list, even after a blank one', () => {
    const out = lay(slideOf('bullets', { bullets: ['One', '', 'Three'] }));
    expect(textOf(out.boxes, 'bullets-2').bind).toBe('bullets.2');
    expect(byId(out.boxes, 'bullets-m2')!.moveWith).toBe('bullets-2');
    const q = lay(slideOf('question', { question: 'Which?', options: ['A', '', 'C'], correct: 2 }));
    expect(textOf(q.boxes, 'opt-1-text').bind).toBe('options.2');
    expect(byId(q.boxes, 'opt-1-ring')).toBeDefined();
  });
});

describe('boxes moved by hand', () => {
  const base = slideOf('bullets', { title: 'Main idea', bullets: ['First point', 'Second point'] });

  it('cleans what it stores: whole numbers, at least a corner on the slide', () => {
    expect(cleanOverride({ x: 10.4, y: 20.6, w: 300.2, h: 100 })).toEqual({ x: 10, y: 21, w: 300, h: 100 });
    expect(cleanOverride({ x: 5000, y: -5000, w: 200, h: 100 })).toMatchObject({ x: CANVAS_W - 24, y: 24 - 100 });
    expect(cleanOverride({ x: 1, y: 1, w: 2, h: 2, scale: 1 })).toEqual({ x: 1, y: 1, w: 24, h: 24 });
    expect(cleanOverride({ x: 'a', y: 1, w: 2, h: 2 })).toBeNull();
    expect(cleanOverride(null)).toBeNull();
  });

  it('adds, replaces and clears overrides without touching the rest of the slide', () => {
    const moved = withOverride(base, 'title', { x: 300, y: 200, w: 900, h: 120 });
    expect(hasOverrides(moved)).toBe(true);
    expect(moved.content).toBe(base.content);
    expect(withOverride(moved, 'title', null)).not.toHaveProperty('overrides');
    expect(withoutOverrides(moved)).not.toHaveProperty('overrides');
    expect(hasOverrides(base)).toBe(false);
  });

  it('moves a box where the presenter put it, and its marker with it', () => {
    const before = lay(base);
    const item = textOf(before.boxes, 'bullets-0');
    const marker = byId(before.boxes, 'bullets-m0')!;
    const to = { x: Math.round(item.x + 200), y: Math.round(item.y + 100) };
    const moved = lay(withOverride(base, 'bullets-0', { ...to, w: item.w, h: item.h }));
    expect(textOf(moved.boxes, 'bullets-0')).toMatchObject(to);
    const m = byId(moved.boxes, 'bullets-m0')!;
    expect(m.x - marker.x).toBeCloseTo(to.x - item.x, 5);
    expect(m.y - marker.y).toBeCloseTo(to.y - item.y, 5);
    // The other point stays put.
    expect(textOf(moved.boxes, 'bullets-1').y).toBe(textOf(before.boxes, 'bullets-1').y);
  });

  it('fits text again when its box is resized: a corner scales it, a narrower box wraps it', () => {
    const before = textOf(lay(base).boxes, 'title');
    const bigger = textOf(lay(withOverride(base, 'title', { x: before.x, y: before.y, w: before.w, h: before.h * 1.5, scale: 1.5 })).boxes, 'title');
    expect(bigger.style.size).toBeGreaterThan(before.style.size * 1.3);
    const narrow = textOf(lay(withOverride(base, 'title', { x: before.x, y: before.y, w: 260, h: before.h })).boxes, 'title');
    expect(narrow.style.size).toBe(before.style.size);
    expect(narrow.h).toBeGreaterThan(before.h);
  });

  it('ignores overrides for boxes the layout no longer draws', () => {
    const out = lay(withOverride(base, 'gone', { x: 1, y: 1, w: 100, h: 100 }));
    expect(out.boxes.map((b) => b.id)).toEqual(lay(base).boxes.map((b) => b.id));
  });

  it('keeps a slide arranged by hand out of auto style, and drops the arrangement when the type changes', () => {
    const slide = slideOf('bullets', { title: 'Look', bullets: ['A'], image: PNG }, { variant: 'right' });
    const deck = (s: Slide): Deck => ({ id: 'd', title: 'T', themeId: 'paper', audience: 'adult', autoStyle: true, createdAt: 0, updatedAt: 0, slides: [slideOf('bullets', { image: PNG }, { id: 'a', variant: 'right' }), s] });
    expect(autoVariants(deck(slide)).slides[1]!.variant).toBe('left');
    const arranged = withOverride(slide, 'title', { x: 400, y: 300, w: 800, h: 100 });
    expect(autoVariants(deck(arranged)).slides[1]!.variant).toBe('right');
    expect(convertSlide(arranged, 'summary')).not.toHaveProperty('overrides');
  });

  it('exports the moved place to PowerPoint', async () => {
    const moved = withOverride(base, 'title', { x: 720, y: 576, w: 720, h: 144 });
    const deck: Deck = { id: 'd', title: 'T', themeId: 'paper', audience: 'adult', createdAt: 0, updatedAt: 0, slides: [moved] };
    const { data } = await exportDeckToPptx(deck, { output: 'nodebuffer' });
    const xml = await (await JSZip.loadAsync(data as Uint8Array)).file('ppt/slides/slide1.xml')!.async('string');
    // 720 canvas px is 5 inches: 4572000 EMU across and 3657600 down for 576 px.
    expect(xml).toMatch(/<a:off x="4572000" y="3657600"\/>/);
  });
});
