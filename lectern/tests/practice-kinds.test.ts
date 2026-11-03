// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { canSplit, splitSlide } from '../src/core/deck/split';
import { type Slide, emptyNotes } from '../src/core/deck/types';
import { CANVAS_H, CANVAS_W, type Box, type TextBox } from '../src/core/engine/boxes';
import { layoutSlide } from '../src/core/engine/layout';
import { getTheme } from '../src/core/engine/themes';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { blanksOf, isOn } from '../src/core/kinds/practice-kinds';
import { getKind } from '../src/core/kinds/registry';

registerCoreKinds();

const slideOf = (kind: string, content: Record<string, unknown>): Slide => ({ id: `s-${kind}`, kind, content, notes: emptyNotes() });

function lay(kind: string, content: Record<string, unknown>, o: { audience?: 'young' | 'teen' | 'adult'; mode?: 'edit' | 'show' } = {}) {
  return layoutSlide(slideOf(kind, content), { theme: getTheme('paper'), audience: o.audience ?? 'adult', mode: o.mode ?? 'show', slideCount: 8, slideNumber: 3 });
}

const texts = (boxes: Box[]) => boxes.filter((b): b is TextBox => b.type === 'text');
const byId = (boxes: Box[], id: string) => boxes.find((b) => b.id === id);

function inside(boxes: Box[]) {
  for (const b of boxes) {
    if (b.id.startsWith('deco')) continue;
    expect(b.x + b.w, `${b.id} right`).toBeLessThanOrEqual(CANVAS_W + 1);
    expect(b.y + b.h, `${b.id} bottom`).toBeLessThanOrEqual(CANVAS_H + 1);
  }
}

describe('true or false', () => {
  const content = {
    title: 'True or false?',
    items: [
      { statement: 'Sun Yat-sen was born in 1866.', isTrue: true, correction: '' },
      { statement: 'He went to school in Paris.', isTrue: 'false', correction: 'He went to school in Hawaii.' },
      { statement: 'He was a doctor.', isTrue: 'true', correction: '' },
    ],
  };

  it('reveals each verdict on its own click, with the correction of a false statement', () => {
    for (const audience of ['young', 'teen', 'adult'] as const) {
      const layout = lay('true-false', content, { audience });
      expect(layout.warnings).toEqual([]);
      expect(layout.steps).toBe(3);
      inside(layout.boxes);
    }
    const { boxes } = lay('true-false', content);
    expect(texts(boxes).filter((b) => b.id.startsWith('mark-')).map((b) => [b.text, b.step, b.reveal])).toEqual([['✓', 1, 'answer'], ['✗', 2, 'answer'], ['✓', 3, 'answer']]);
    expect(byId(boxes, 'correction-1')).toMatchObject({ text: 'He went to school in Hawaii.', step: 2, bind: 'items.1.correction' });
    expect(byId(boxes, 'correction-0')).toBeUndefined();
    // The statements and their empty rings are there from the start.
    expect(boxes.filter((b) => b.id.startsWith('statement-') || b.id.startsWith('slot-')).every((b) => !b.step)).toBe(true);
  });

  it('reads verdicts written as text, offers its statements to the check, and splits like a list', () => {
    expect([true, 'true', 'Yes', false, 'false', '', undefined].map(isOn)).toEqual([true, true, true, false, false, false, false]);
    const def = getKind('true-false')!;
    expect(def.checks!(content)).toEqual([
      { prompt: 'Sun Yat-sen was born in 1866.', answer: 'Sun Yat-sen was born in 1866.' },
      { prompt: 'He went to school in Paris.', answer: 'He went to school in Hawaii.' },
      { prompt: 'He was a doctor.', answer: 'He was a doctor.' },
    ]);
    expect(def.text(content)).toEqual(['True or false?', 'Sun Yat-sen was born in 1866.', 'He went to school in Paris.', 'He went to school in Hawaii.', 'He was a doctor.']);
    const many = slideOf('true-false', { title: 'Check', items: Array.from({ length: 6 }, (_, i) => ({ statement: `Statement ${i + 1}`, isTrue: i % 2 === 0, correction: '' })) });
    expect(canSplit(many)).toBe(true);
    const parts = splitSlide(many);
    expect(parts?.map((p) => (p.content.items as unknown[]).length)).toEqual([3, 3]);
    expect(parts?.[1].content.title).toBe('Check (cont.)');
  });
});

describe('fill in the blanks', () => {
  const passage = 'Sun Yat-sen was born in [1866]. As a boy he went to school in [Hawaii] and later studied [medicine].';

  it('numbers the blanks in the passage and reveals each answer on its own click', () => {
    expect(blanksOf(passage)).toEqual(['1866', 'Hawaii', 'medicine']);
    for (const audience of ['young', 'teen', 'adult'] as const) {
      const layout = lay('fill-in', { title: 'Fill in the blanks', passage, bank: [] }, { audience });
      expect(layout.warnings).toEqual([]);
      expect(layout.steps).toBe(3);
      inside(layout.boxes);
    }
    const { boxes } = lay('fill-in', { title: 'Fill in the blanks', passage, bank: [] });
    expect(byId(boxes, 'passage')).toMatchObject({ text: 'Sun Yat-sen was born in (1)______. As a boy he went to school in (2)______ and later studied (3)______.', bind: 'passage' });
    expect(texts(boxes).filter((b) => b.id.endsWith('-answer')).map((b) => [b.text, b.step, b.reveal])).toEqual([['1866', 1, 'answer'], ['Hawaii', 2, 'answer'], ['medicine', 3, 'answer']]);
    // An empty bank shows the answers from A to Z, so their order gives nothing away.
    expect(byId(boxes, 'bank-words')).toMatchObject({ text: '1866   ·   Hawaii   ·   medicine' });
  });

  it('shows the bank it is given, hides it on request, and says how to make a blank', () => {
    const given = lay('fill-in', { title: 'T', passage, bank: ['medicine', 'Hawaii', '1866', 'law'] });
    expect(byId(given.boxes, 'bank-words')).toMatchObject({ text: 'medicine   ·   Hawaii   ·   1866   ·   law' });
    expect(byId(lay('fill-in', { title: 'T', passage, bank: ['x'], hideBank: true }).boxes, 'bank-words')).toBeUndefined();
    expect(lay('fill-in', { title: 'T', passage: 'No blanks here.' }, { mode: 'edit' }).warnings).toEqual(['Put each answer in [square brackets] to make a blank.']);
    const def = getKind('fill-in')!;
    expect(def.checks!({ passage })).toEqual([{ prompt: '', answer: '1866' }, { prompt: '', answer: 'Hawaii' }, { prompt: '', answer: 'medicine' }]);
    // Words are counted as the room finally sees them: the passage filled in, and any extra word in the bank.
    expect(def.text({ title: 'T', passage, bank: ['law', 'Hawaii'] })).toEqual(['T', 'Sun Yat-sen was born in 1866. As a boy he went to school in Hawaii and later studied medicine.', 'law']);
  });

  it('keeps Chinese passages and answers as they are', () => {
    const { boxes } = lay('fill-in', { title: '填空', passage: '孙中山出生于[1866]年，小时候在[檀香山]读书。', bank: [] });
    expect(byId(boxes, 'passage')).toMatchObject({ text: '孙中山出生于(1)______年，小时候在(2)______读书。' });
    expect(texts(boxes).filter((b) => b.id.endsWith('-answer')).map((b) => b.text)).toEqual(['1866', '檀香山']);
  });
});

describe('title credits', () => {
  it('puts a second credit line under the presenter, in both layouts', () => {
    for (const variant of ['left', 'center']) {
      const slide = { ...slideOf('title', { title: 'The story of Sun Yat-sen', subtitle: '', presenter: 'Ms Lu', credit: 'Supervisor: Mr Wang' }), variant };
      const { boxes, warnings } = layoutSlide(slide, { theme: getTheme('paper'), audience: 'adult', mode: 'show', slideCount: 8, slideNumber: 1 });
      expect(warnings).toEqual([]);
      const presenter = byId(boxes, 'presenter')!;
      const credit = byId(boxes, 'credit')!;
      expect(credit).toMatchObject({ text: 'Supervisor: Mr Wang', bind: 'credit' });
      expect(credit.y).toBeGreaterThanOrEqual(presenter.y + presenter.h);
      inside(boxes);
    }
    const alone = lay('title', { title: 'T', presenter: 'Ms Lu' }).boxes;
    expect(byId(alone, 'credit')).toBeUndefined();
    expect(getKind('title')!.text({ title: 'T', presenter: 'Ms Lu', credit: 'Supervisor: Mr Wang' })).toEqual(['T', 'Ms Lu', 'Supervisor: Mr Wang']);
  });
});
