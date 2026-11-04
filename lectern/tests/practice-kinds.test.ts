// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { canSplit, splitSlide } from '../src/core/deck/split';
import { type Slide, emptyNotes } from '../src/core/deck/types';
import { CANVAS_H, CANVAS_W, type Box, type TextBox } from '../src/core/engine/boxes';
import { layoutSlide } from '../src/core/engine/layout';
import { getTheme } from '../src/core/engine/themes';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { blanksOf, inOrder, isOn, shownOrder } from '../src/core/kinds/practice-kinds';
import { getKind } from '../src/core/kinds/registry';
import { quizItem } from '../src/core/share/quiz';

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

describe('true or false, with a reason', () => {
  const content = {
    title: 'True or false, and why?',
    items: [
      { statement: 'Plants get their food from the soil.', isTrue: false, correction: 'They make it in their leaves.', reason: 'they use light to make sugar', otherReason: 'roots take in food' },
      { statement: 'Leaves are green because of chlorophyll.', isTrue: true, correction: '', reason: 'chlorophyll reflects green light' },
    ],
  };

  it('offers two reasons to pick from, and the click rings the right one', () => {
    for (const audience of ['young', 'teen', 'adult'] as const) {
      const layout = lay('true-false', content, { audience });
      expect(layout.warnings.filter((w) => !w.includes('words on this slide'))).toEqual([]);
      inside(layout.boxes);
    }
    const { boxes } = lay('true-false', content);
    const chips = texts(boxes).filter((b) => /^reason-0-\d-text$/.test(b.id));
    expect(chips.map((b) => b.text).sort()).toEqual(['because roots take in food', 'because they use light to make sugar']);
    const right = chips.findIndex((b) => b.text === 'because they use light to make sugar');
    expect(byId(boxes, `reason-0-${right}-ring`)).toMatchObject({ step: 1, reveal: 'answer' });
    expect(byId(boxes, `reason-0-${1 - right}-dim`)).toMatchObject({ step: 1, reveal: 'answer' });
    expect(byId(boxes, 'correction-0')).toMatchObject({ text: 'They make it in their leaves.', step: 1, reveal: 'answer' });
    // With one reason, it appears with the verdict.
    expect(byId(boxes, 'correction-1')).toMatchObject({ text: 'Because chlorophyll reflects green light', step: 2, bind: 'items.1.reason' });
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

describe('put in order', () => {
  const events = ['Sun Yat-sen is born in Cuiheng', 'He goes to school in Hawaii', 'He studies medicine in Hong Kong', 'He founds the Revive China Society', 'The Qing dynasty falls'];

  it('mixes the items up the same way every time, and never in the right order', () => {
    for (let n = 2; n <= 8; n++) {
      const items = events.concat(['Six', 'Seven', 'Eight']).slice(0, n);
      const shown = shownOrder(items);
      expect([...shown].sort((a, b) => a - b)).toEqual(items.map((_, i) => i));
      expect(shown).not.toEqual(items.map((_, i) => i));
      expect(shownOrder([...items])).toEqual(shown);
    }
    expect(shownOrder(['Only'])).toEqual([0]);
  });

  it('shows lettered cards, and each click puts the next item’s number on its card', () => {
    for (const audience of ['young', 'teen', 'adult'] as const) {
      const layout = lay('order', { title: 'Put his life in order', items: events }, { audience });
      // Everything fits; young learners would want fewer words, which the word check says.
      expect(layout.warnings.filter((w) => !w.includes('words on this slide'))).toEqual([]);
      expect(layout.steps).toBe(5);
      inside(layout.boxes);
    }
    const { boxes } = lay('order', { title: 'Put his life in order', items: events });
    const shown = shownOrder(events);
    expect(texts(boxes).filter((b) => b.id.startsWith('letter-')).map((b) => b.text)).toEqual(['A', 'B', 'C', 'D', 'E']);
    shown.forEach((i, at) => {
      expect(byId(boxes, `item-${at}`)).toMatchObject({ text: events[i], bind: `items.${i}` });
      expect(byId(boxes, `number-${at}`)).toMatchObject({ text: String(i + 1), step: i + 1, reveal: 'answer' });
    });
    // The items and their empty rings are there from the start.
    expect(boxes.filter((b) => b.id.startsWith('item-') || b.id.startsWith('slot-')).every((b) => !b.step)).toBe(true);
  });

  it('lays short items out as tiles, with the whole line on the last click', () => {
    const words = ['小马', '终于', '过了', '河'];
    const def = getKind('order')!;
    expect(def.autoVariant!({ items: words }, { index: 0, count: 1, nth: 0 })).toBe('tiles');
    expect(def.autoVariant!({ items: events }, { index: 0, count: 1, nth: 0 })).toBe('list');
    const layout = lay('order', { title: '连词成句', items: words });
    expect(layout.warnings).toEqual([]);
    inside(layout.boxes);
    expect(byId(layout.boxes, 'answer')).toMatchObject({ text: '小马终于过了河', step: 4, reveal: 'answer' });
    expect(inOrder(['The', 'pony', 'crossed'])).toBe('The pony crossed');
  });

  it('asks for the order in the check, binds past blank items, and wants two items', () => {
    const def = getKind('order')!;
    expect(def.checks!({ title: 'Order', items: ['First', 'Second'] })).toEqual([{ prompt: 'Order', answer: 'First Second' }]);
    expect(def.checks!({ items: ['Alone'] })).toEqual([]);
    const { boxes } = lay('order', { items: ['First', '', 'Second', 'Third'] });
    expect(texts(boxes).filter((b) => b.id.startsWith('item-')).map((b) => b.bind).sort()).toEqual(['items.0', 'items.2', 'items.3']);
    expect(lay('order', { items: ['Alone'] }, { mode: 'edit' }).warnings).toEqual(['Add at least two items to put in order.']);
  });
});

describe('match or sort', () => {
  const pairs = [
    { item: 'evaporate', match: 'turn from liquid into gas', picture: '' },
    { item: 'condense', match: 'turn from gas into liquid', picture: '' },
    { item: 'precipitation', match: 'water falling from clouds', picture: '' },
    { item: 'run-off', match: 'water flowing over land', picture: '' },
  ];
  const sorts = [
    { item: 'lion', match: 'Mammals', picture: '' },
    { item: 'eagle', match: 'Birds', picture: '' },
    { item: 'whale', match: 'Mammals', picture: '' },
    { item: 'owl', match: 'Birds', picture: '' },
    { item: 'bat', match: 'Mammals', picture: '' },
    { item: 'shark', match: 'Fish', picture: '' },
  ];

  it('mixes the matches up, and each click puts the number of an item’s match beside it', () => {
    for (const audience of ['young', 'teen', 'adult'] as const) {
      const layout = lay('match', { title: 'Match', items: pairs }, { audience });
      expect(layout.warnings.filter((w) => !w.includes('words on this slide'))).toEqual([]);
      expect(layout.steps).toBe(4);
      inside(layout.boxes);
    }
    const { boxes } = lay('match', { title: 'Match', items: pairs });
    const shown = shownOrder(pairs.map((p) => p.match));
    shown.forEach((i, at) => expect(byId(boxes, `match-${at}`)).toMatchObject({ text: pairs[i]!.match, bind: `items.${i}.match` }));
    pairs.forEach((p, k) => {
      expect(byId(boxes, `item-${k}-text`)).toMatchObject({ text: p.item, bind: `items.${k}.item` });
      expect(byId(boxes, `answer-${k}`)).toMatchObject({ text: String(shown.indexOf(k) + 1), step: k + 1, reveal: 'answer' });
    });
    expect(getKind('match')!.checks!({ items: pairs })[0]).toEqual({ prompt: 'evaporate', answer: 'turn from liquid into gas' });
  });

  it('sorts items that share a match into groups, filling one group a click', () => {
    const def = getKind('match')!;
    expect(def.autoVariant!({ items: sorts }, { index: 0, count: 1, nth: 0 })).toBe('groups');
    expect(def.autoVariant!({ items: pairs }, { index: 0, count: 1, nth: 0 })).toBe('pairs');
    for (const audience of ['young', 'teen', 'adult'] as const) {
      const layout = lay('match', { title: 'Sort the animals', items: sorts }, { audience });
      expect(layout.warnings.filter((w) => !w.includes('words on this slide'))).toEqual([]);
      expect(layout.steps).toBe(3);
      inside(layout.boxes);
    }
    const { boxes } = lay('match', { title: 'Sort the animals', items: sorts });
    expect(['group-0', 'group-1', 'group-2'].map((id) => (byId(boxes, id) as TextBox).text)).toEqual(['Mammals', 'Birds', 'Fish']);
    const mammals = byId(boxes, 'group-0-items') as TextBox;
    expect(mammals).toMatchObject({ step: 1, reveal: 'answer' });
    expect(mammals.text.split('\n').map((l) => l.replace(/^[A-L] +/, ''))).toEqual(['lion', 'whale', 'bat']);
    // The pool shows every item from the start, lettered A to F.
    expect(texts(boxes).filter((b) => b.id.startsWith('letter-')).map((b) => b.text)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(boxes.filter((b) => b.id.startsWith('item-')).every((b) => !b.step)).toBe(true);
    // Sorted items share their answers, so they ask without prompts of their own, like blanks.
    expect(def.checks!({ items: sorts }).every((c) => c.prompt === '')).toBe(true);
    expect(def.text({ title: 'T', items: sorts })).toEqual(['T', 'lion', 'eagle', 'whale', 'owl', 'bat', 'shark', 'Mammals', 'Birds', 'Fish']);
  });

  it('shows pictures as items, with or without words', () => {
    const withPictures = sorts.slice(0, 4).map((s, i) => ({ ...s, item: i % 2 ? s.item : '', picture: `https://example.com/${s.item}.jpg` }));
    const layout = lay('match', { items: withPictures });
    inside(layout.boxes);
    expect(layout.boxes.filter((b) => b.type === 'image')).toHaveLength(4);
    expect((byId(layout.boxes, 'group-0-items') as TextBox).text).toMatch(/\([A-D]\)/);
    const matched = lay('match', { items: pairs.slice(0, 2).map((p) => ({ ...p, item: '', picture: 'https://example.com/p.jpg' })) }, { mode: 'edit' });
    expect(matched.warnings).toEqual([]);
    expect(matched.boxes.filter((b) => b.type === 'image')).toHaveLength(2);
    expect(lay('match', { items: pairs.slice(0, 1) }, { mode: 'edit' }).warnings).toEqual(['Add at least two items, each with its match or group.']);
  });
});

describe('judging a claim', () => {
  it('shows who says what in a card above the question, and asks whether they are right', () => {
    const claim = { speaker: 'Sam', claim: 'Heavier objects fall faster.', question: '', options: ['Agree', 'Disagree'], correct: 1, answer: 'Without air, everything falls at the same rate.' };
    for (const audience of ['young', 'teen', 'adult'] as const) {
      const layout = lay('question', claim, { audience });
      expect(layout.warnings).toEqual([]);
      inside(layout.boxes);
    }
    const { boxes } = lay('question', claim);
    expect(byId(boxes, 'speaker')).toMatchObject({ text: 'Sam', bind: 'speaker' });
    expect(byId(boxes, 'claim')).toMatchObject({ text: '“Heavier objects fall faster.”', bind: 'claim' });
    const card = byId(boxes, 'claim-card')!;
    expect(byId(boxes, 'question')).toMatchObject({ text: 'Do you agree? Why?' });
    expect(byId(boxes, 'question')!.y).toBeGreaterThan(card.y + card.h);
    const def = getKind('question')!;
    expect(def.checks!(claim)).toEqual([{ prompt: 'Heavier objects fall faster. Do you agree? Why?', answer: 'Disagree' }]);
    expect(def.heading(claim)).toBe('Heavier objects fall faster.');
    expect(quizItem({ id: 'q', kind: 'question', content: claim })).toMatchObject({ question: 'Sam: “Heavier objects fall faster.” Do you agree? Why?', correct: 1 });
  });
});

describe('task and model answer', () => {
  const content = {
    title: 'Task A',
    task: 'Read paragraph 2 again, then answer in full sentences.',
    parts: [
      { prompt: 'Why did the boy leave school in Hawaii?', answer: 'His brother sent him home because he wanted to become a Christian.' },
      { prompt: 'What did he study next?', answer: 'Medicine, in Hong Kong.' },
    ],
    checklist: ['Uses evidence from the text', 'Answers in full sentences'],
  };

  it('letters the parts, shows what a good answer includes, and gives each model answer its own click', () => {
    for (const audience of ['young', 'teen', 'adult'] as const) {
      const layout = lay('task', content, { audience });
      expect(layout.warnings.filter((w) => !w.includes('words on this slide'))).toEqual([]);
      expect(layout.steps).toBe(2);
      inside(layout.boxes);
    }
    const { boxes } = lay('task', content);
    expect(texts(boxes).filter((b) => b.id.startsWith('letter-')).map((b) => b.text)).toEqual(['a)', 'b)']);
    expect(byId(boxes, 'answer-1')).toMatchObject({ text: 'Medicine, in Hong Kong.', step: 2, reveal: 'answer', bind: 'parts.1.answer' });
    expect(byId(boxes, 'checklist')).toMatchObject({ text: '•  Uses evidence from the text\n•  Answers in full sentences' });
    expect(getKind('task')!.checks!(content)).toEqual(content.parts);
  });

  it('shows the answers from the start on the answer slide, ticks the checklist, and asks nothing', () => {
    const answers = { ...content, showAnswers: true };
    const layout = lay('task', answers);
    expect(layout.steps).toBe(0);
    expect(byId(layout.boxes, 'answer-0')).toMatchObject({ step: undefined, reveal: undefined });
    expect((byId(layout.boxes, 'checklist') as TextBox).text.startsWith('✓')).toBe(true);
    // It tells rather than asks, so the check doesn't count the same thing tested twice.
    expect(getKind('task')!.checks!(answers)).toEqual([]);
    expect(getKind('task')!.heading({ showAnswers: true })).toBe('Model answer');
  });

  it('takes one model answer for a task without parts', () => {
    const whole = { title: 'Write it', task: 'Describe the water cycle in three sentences.', answer: 'Water evaporates. It condenses into clouds. It falls as rain.' };
    const layout = lay('task', whole);
    inside(layout.boxes);
    expect(byId(layout.boxes, 'answer')).toMatchObject({ step: 1, reveal: 'answer' });
    expect(getKind('task')!.checks!(whole)).toEqual([{ prompt: whole.task, answer: whole.answer }]);
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
