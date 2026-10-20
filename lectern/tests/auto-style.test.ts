// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { autoVariants, suggestLook } from '../src/core/deck/auto-style';
import { type Deck, type Slide, emptyNotes } from '../src/core/deck/types';
import { autoChart } from '../src/core/kinds/data-kinds';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';

registerCoreKinds();

const PX = 'data:image/png;base64,iVBORw0KGgo=';

let n = 0;
const slide = (kind: string, content: Record<string, unknown>, extra: Partial<Slide> = {}): Slide => ({
  id: `s${++n}`, kind, content, notes: emptyNotes(), ...extra,
});

const deckOf = (slides: Slide[], extra: Partial<Deck> = {}): Deck => ({
  id: 'd1', title: 'A deck', themeId: 'paper', audience: 'adult', createdAt: 0, updatedAt: 0, slides, ...extra,
});

const picture = (title = 'A view', body = 'Some words about it') => slide('image', { title, body, image: PX, caption: '' });
const variants = (d: Deck) => d.slides.map((s) => s.variant);

describe('auto layouts', () => {
  it('alternates picture sides and statement colours along the deck', () => {
    const d = autoVariants(deckOf([picture(), slide('statement', { statement: 'One' }), picture(), slide('statement', { statement: 'Two' }), picture()]));
    expect(variants(d)).toEqual(['right', 'bold', 'left', 'plain', 'right']);
  });

  it('reads the content: a captionless picture goes full screen, four named-axis items make a matrix', () => {
    const d = autoVariants(deckOf([
      picture('Sunrise', ''),
      slide('image', { title: 'No picture yet', body: '', image: '' }),
      slide('title', { title: 'Hello', image: PX }),
      slide('diagram', { title: 'Where it lands', xAxis: 'Effort', yAxis: 'Impact', items: [1, 2, 3, 4].map((i) => ({ label: `Item ${i}` })) }),
    ]));
    expect(variants(d)).toEqual(['full', 'right', 'left', 'matrix']);
  });

  it('leaves pinned layouts alone, and counts them as the previous one', () => {
    const d = autoVariants(deckOf([picture(), { ...picture(), variant: 'right', variantPinned: true }, picture()]));
    expect(variants(d)).toEqual(['right', 'right', 'left']);
  });

  it('returns the same deck when every layout is already right', () => {
    const once = autoVariants(deckOf([picture(), picture(), slide('statement', { statement: 'x' })]));
    expect(autoVariants(once)).toBe(once);
  });

  it('picks media layouts from what is filled in', () => {
    const d = autoVariants(deckOf([
      slide('video', { title: '', video: 'https://youtu.be/dQw4w9WgXcQ', body: '' }),
      slide('video', { title: 'Watch', video: 'https://youtu.be/dQw4w9WgXcQ', body: 'Look for the turn.' }),
      slide('cards', { title: 'Four', cards: [1, 2, 3, 4].map((i) => ({ icon: '⭐', heading: `H${i}`, text: '' })) }),
      slide('qr', { title: 'Scan', url: 'https://example.com', body: '' }),
    ]));
    expect(variants(d)).toEqual(['full', 'side', 'grid', 'center']);
  });
});

describe('auto chart type', () => {
  const rows = (pairs: [string, number][]) => pairs.map(([label, value]) => ({ label, value, value2: 0, hasValue2: false }));

  it('shows shares of a whole as a doughnut', () => {
    expect(autoChart(rows([['Yes', 60], ['No', 30], ['Unsure', 10]]))).toBe('doughnut');
  });

  it('shows a series over time as a line', () => {
    expect(autoChart(rows([['Q1', 3], ['Q2', 5], ['Q3', 4], ['Q4', 8]]))).toBe('line');
    expect(autoChart(rows([['2021', 3], ['2022', 5], ['2023', 4], ['2024', 8]]))).toBe('line');
  });

  it('turns long labels or many rows into bars, and keeps columns otherwise', () => {
    expect(autoChart(rows([['A very long category name', 3], ['Short', 5]]))).toBe('bar');
    expect(autoChart(rows('abcdefgh'.split('').map((l, i) => [l, i + 1])))).toBe('bar');
    expect(autoChart(rows([['Small', 4], ['Large', 9]]))).toBe('column');
    expect(autoChart([])).toBe('column');
  });
});

describe('suggested look', () => {
  it('gives young audiences the bright look', () => {
    expect(suggestLook(deckOf([], { audience: 'young' }))).toBe('sunny');
  });

  it('gives technical decks the dark look when the title or the slides say so', () => {
    expect(suggestLook(deckOf([], { title: 'Our API in ten minutes' }))).toBe('midnight');
    const code = slide('code', { title: 'x', code: 'let a = 1', language: 'js' });
    expect(suggestLook(deckOf([code, { ...code, id: 'c2' }]))).toBe('midnight');
  });

  it('does not turn dark over one passing technical word', () => {
    const d = deckOf([slide('summary', { title: 'Who', points: ['Product, Engineering and Support leads'] })], { title: 'Better meetings' });
    expect(suggestLook(d)).toBe('paper');
  });

  it('follows the purpose for reports and pitches', () => {
    expect(suggestLook(deckOf([], { purpose: 'report' }))).toBe('minimal');
    expect(suggestLook(deckOf([], { purpose: 'pitch' }))).toBe('midnight');
  });
});
