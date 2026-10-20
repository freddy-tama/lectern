// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CONT, canSplit, contHeading, fitsOnSlide, isOverflowWarning, splitInDeck, splitSlide, tableLines } from '../src/core/deck/split';
import { type Deck, type Slide, emptyNotes } from '../src/core/deck/types';
import { layoutSlide } from '../src/core/engine/layout';
import { getTheme } from '../src/core/engine/themes';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';

registerCoreKinds();

function slideOf(kind: string, content: Record<string, unknown>, extra: Partial<Slide> = {}): Slide {
  return { id: 's1', kind, content, notes: emptyNotes({ script: 'What I say here.', keyPoints: ['Keep this'], minutes: 4 }), ...extra };
}

const deck: Pick<Deck, 'themeId' | 'audience' | 'title'> = { themeId: 'paper', audience: 'adult', title: 'Deck' };

describe('overflow warnings', () => {
  it('knows the stage warnings that mean the slide is too full', () => {
    expect(isOverflowWarning('Text is too long to fit: “Something…”')).toBe(true);
    expect(isOverflowWarning('This list is too long for one slide. Split it or shorten the points.')).toBe(true);
    expect(isOverflowWarning('This table is too big for one slide. Split it, or shorten the cells.')).toBe(true);
    expect(isOverflowWarning('92 words on this slide. For this audience, aim for 70 or fewer and move the rest to the key notes.')).toBe(false);
  });

  it('marks the copied heading once', () => {
    expect(contHeading('Plan')).toBe(`Plan ${CONT}`);
    expect(contHeading(`Plan ${CONT}`)).toBe(`Plan ${CONT}`);
    expect(contHeading('  ', 'Today')).toBe(`Today ${CONT}`);
    expect(contHeading('')).toBe(CONT);
  });
});

describe('splitSlide', () => {
  it('only splits the six list-like kinds, and only with two or more items', () => {
    expect(canSplit(slideOf('bullets', { title: 'T', bullets: ['a', 'b'] }))).toBe(true);
    expect(canSplit(slideOf('bullets', { title: 'T', bullets: ['a', ' '] }))).toBe(false);
    expect(canSplit(slideOf('quote', { quote: 'Long' }))).toBe(false);
    expect(splitSlide(slideOf('quote', { quote: 'Long' }))).toBeNull();
    expect(splitSlide(slideOf('summary', { title: 'T', points: ['only one'] }))).toBeNull();
  });

  it('shares bullets out evenly, earlier slide first, and repeats the heading marked (cont.)', () => {
    const slide = slideOf('bullets', { title: 'Why it matters', bullets: ['a', 'b', 'c', 'd', 'e'], reveal: true, image: 'asset:pic' }, { variant: 'x' });
    const [first, second] = splitSlide(slide)!;
    expect(first.id).toBe('s1');
    expect(first.content.bullets).toEqual(['a', 'b', 'c']);
    expect(first.content.title).toBe('Why it matters');
    expect(first.notes.script).toBe('What I say here.');
    expect(first.notes.keyPoints).toEqual(['Keep this']);
    expect(second.id).not.toBe('s1');
    expect(second.kind).toBe('bullets');
    expect(second.variant).toBe('x');
    expect(second.content.bullets).toEqual(['d', 'e']);
    expect(second.content.title).toBe(`Why it matters ${CONT}`);
    expect(second.content.reveal).toBe(true);
    expect(second.content.image).toBe('asset:pic');
    expect(second.notes.script).toBe('');
    expect(first.notes.minutes + second.notes.minutes).toBe(4);
    // The original slide is not changed.
    expect(slide.content.bullets).toHaveLength(5);
  });

  it('handles agenda and summary, using the title the slide shows when its own is empty', () => {
    const [, agenda] = splitSlide(slideOf('agenda', { title: '', items: ['1', '2', '3', '4'] }))!;
    expect(agenda.content.items).toEqual(['3', '4']);
    expect(agenda.content.title).toBe(`Today ${CONT}`);
    const [a, b] = splitSlide(slideOf('summary', { title: 'Takeaways', points: ['p1', 'p2', 'p3'] }))!;
    expect(a.content.points).toEqual(['p1', 'p2']);
    expect(b.content.points).toEqual(['p3']);
    expect(b.content.title).toBe(`Takeaways ${CONT}`);
  });

  it('splits steps and timelines as objects, keeping each slide within the six the layout draws', () => {
    const steps = Array.from({ length: 8 }, (_, i) => ({ label: `Step ${i + 1}`, detail: '' }));
    const [a, b] = splitSlide(slideOf('steps', { title: 'How', steps, reveal: true }))!;
    expect(a.content.steps).toEqual(steps.slice(0, 4));
    expect(b.content.steps).toEqual(steps.slice(4));
    const milestones = [{ date: 'Jan', title: 'A', detail: '' }, { date: 'Apr', title: 'B', detail: '' }, { date: 'Jul', title: 'C', detail: '' }];
    const [c, d] = splitSlide(slideOf('timeline', { title: 'Roadmap', milestones }))!;
    expect(c.content.milestones).toEqual(milestones.slice(0, 2));
    expect(d.content.milestones).toEqual(milestones.slice(2));
    expect(d.content.title).toBe(`Roadmap ${CONT}`);
  });

  it('splits table rows and repeats the header row and any Markdown separator', () => {
    const cells = 'Plan | Seats\n|---|--:|\nA | 1\nB | 2\nC | 3\n\nD | 4';
    expect(tableLines(cells, true)).toEqual({ head: ['Plan | Seats', '|---|--:|'], body: ['A | 1', 'B | 2', 'C | 3', 'D | 4'] });
    const [a, b] = splitSlide(slideOf('table', { title: 'Plans', cells, header: true, caption: 'Per month' }))!;
    expect(a.content.cells).toBe('Plan | Seats\n|---|--:|\nA | 1\nB | 2');
    expect(b.content.cells).toBe('Plan | Seats\n|---|--:|\nC | 3\nD | 4');
    expect(b.content.caption).toBe('Per month');
    const [c, d] = splitSlide(slideOf('table', { title: 'Raw', cells: 'x\ty\nz\tw\nq\tr', header: false }))!;
    expect(c.content.cells).toBe('x\ty\nz\tw');
    expect(d.content.cells).toBe('q\tr');
  });

  it('fills the first slide as far as it fits when no even split fits both', () => {
    const slide = slideOf('bullets', { title: 'T', bullets: ['1', '2', '3', '4', '5'] });
    // Pretend a slide holds at most two points.
    const fits = (s: Slide) => (s.content.bullets as string[]).length <= 2;
    const [a, b] = splitSlide(slide, { fits })!;
    expect(a.content.bullets).toEqual(['1', '2']);
    expect(b.content.bullets).toEqual(['3', '4', '5']);
    // With room for three, 3 + 2 fits both and wins over 2 + 3.
    const [c, d] = splitSlide(slide, { fits: (s) => (s.content.bullets as string[]).length <= 3 })!;
    expect(c.content.bullets).toHaveLength(3);
    expect(d.content.bullets).toHaveLength(2);
  });

  it('turns a list that overflows the real layout into two that fit', () => {
    const point = 'A point that runs long enough to need two lines on the slide when it is set in the body type';
    const slide = slideOf('bullets', { title: 'Everything we learned', bullets: Array.from({ length: 14 }, (_, i) => `${i + 1}. ${point}`) });
    const before = layoutSlide(slide, { theme: getTheme('paper'), audience: 'adult', mode: 'edit' });
    expect(before.warnings.some(isOverflowWarning)).toBe(true);
    expect(fitsOnSlide(slide, deck)).toBe(false);
    const [a, b] = splitSlide(slide, { fits: (s) => fitsOnSlide(s, deck) })!;
    expect(fitsOnSlide(a, deck)).toBe(true);
    expect(fitsOnSlide(b, deck)).toBe(true);
    expect([...(a.content.bullets as string[]), ...(b.content.bullets as string[])]).toEqual(slide.content.bullets);
  });

  it('puts the two slides where the one was, in a single deck change', () => {
    const one = slideOf('bullets', { title: 'T', bullets: ['a', 'b'] });
    const d: Deck = { id: 'd', title: 'D', themeId: 'paper', audience: 'adult', createdAt: 0, updatedAt: 0, slides: [{ ...one, id: 'x' }, one, { ...one, id: 'y' }] };
    const pair = splitSlide(one)!;
    const next = splitInDeck(d, 's1', pair);
    expect(next.slides.map((s) => s.id)).toEqual(['x', 's1', pair[1].id, 'y']);
    expect(splitInDeck(d, 'missing', pair)).toBe(d);
  });
});
