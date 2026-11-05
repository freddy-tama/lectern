// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type CheckRule, CORE_RULES, DATA_RULE, LESSON_RULES, TALK_RULES, checkDeck, dataIssues, givenAway, lessonIssues, minutesOff, newestYear, notesEmpty, purposeIssues, rulesFor, sameChecks, sameTypeRuns, slideProblems } from '../src/core/deck/check';
import { retimeDeck, splitToFit } from '../src/core/deck/fit';
import { CONT, fitsOnSlide } from '../src/core/deck/split';
import { type Deck, type Slide, deckMinutes, emptyNotes } from '../src/core/deck/types';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { DENSITY, PURPOSE_WORDS, wordBudget } from '../src/core/kinds/kit';

registerCoreKinds();

const POINT = 'A point that runs long enough to need two lines on the slide when it is set in the body type';

function slideOf(id: string, kind: string, content: Record<string, unknown>, extra: Partial<Slide> = {}): Slide {
  return { id, kind, content, notes: emptyNotes({ script: 'What I say here.', minutes: 2 }), ...extra };
}

function deckOf(slides: Slide[], extra: Partial<Deck> = {}): Deck {
  return { id: 'd1', title: 'Deck', themeId: 'paper', audience: 'adult', createdAt: 0, updatedAt: 0, slides, ...extra };
}

const long = (id: string, n = 14) => slideOf(id, 'bullets', { title: 'Everything we learned', bullets: Array.from({ length: n }, (_, i) => `${i + 1}. ${POINT}`) });
const short = (id: string) => slideOf(id, 'bullets', { title: 'Plan', bullets: ['Ship the beta', 'Ask ten users'] });

describe('word budgets', () => {
  it('sets words a slide by what the deck is for and who it is for, never above the audience', () => {
    expect(wordBudget('adult', 'talk')).toBe(30);
    expect(wordBudget('adult', 'pitch')).toBe(35);
    expect(wordBudget('adult', 'report')).toBe(40);
    expect([wordBudget('young', 'lesson'), wordBudget('teen', 'lesson'), wordBudget('adult', 'lesson')]).toEqual([25, 45, 60]);
    expect(wordBudget('young', 'pitch')).toBe(DENSITY.young.words);
    // A detailed report is read alone, so it gets the audience's whole budget; a visual deck gets fewer.
    expect(wordBudget('adult', 'report', 'detailed')).toBe(DENSITY.adult.words);
    expect(wordBudget('adult', 'lesson', 'visual')).toBe(20);
    expect(wordBudget('adult')).toBe(DENSITY.adult.words);
    for (const purpose of ['lesson', 'talk', 'pitch', 'report'] as const) {
      for (const audience of ['young', 'teen', 'adult'] as const) expect(PURPOSE_WORDS[purpose][audience]).toBeLessThanOrEqual(DENSITY[audience].words);
    }
  });
});

describe('checkDeck', () => {
  it('reports slides that overflow, with the layout warning word for word', () => {
    const report = checkDeck(deckOf([short('a'), long('b'), short('c')]));
    expect(report.overflowing).toEqual(['b']);
    const b = report.slides[1];
    expect(b.overflow[0]).toMatch(/^This list is too long for one slide/);
    expect(b.issues.find((i) => i.rule === 'overflow')).toMatchObject({ severity: 'error', slideId: 'b', message: b.overflow[0] });
    expect(report.slides[0].issues).toEqual([]);
  });

  it('counts words against the audience budget from the layout rules, on content slides only', () => {
    const wordy = slideOf('w', 'bullets', { title: 'Words', bullets: ['one two three four five six seven eight nine ten', 'one two three four five six seven eight nine ten', 'one two three four five six seven eight nine'] });
    const young = checkDeck(deckOf([wordy], { audience: 'young', purpose: 'lesson' }));
    expect(young.slides[0].words).toEqual({ count: 30, budget: DENSITY.young.words });
    expect(young.issues).toContainEqual({ rule: 'words', severity: 'warning', slideId: 'w', message: `30 words. For this audience, aim for ${DENSITY.young.words} or fewer.` });
    expect(checkDeck(deckOf([wordy], { audience: 'adult', purpose: 'lesson' })).issues.some((i) => i.rule === 'words')).toBe(false);
    // A talk says the rest out loud: its slides carry fewer words than adults could read.
    const wordier = { ...wordy, content: { ...wordy.content, bullets: [...(wordy.content.bullets as string[]), 'and five more words here'] } };
    expect(checkDeck(deckOf([wordier], { audience: 'adult', purpose: 'talk' })).issues).toContainEqual({ rule: 'words', severity: 'warning', slideId: 'w', message: '35 words. For a talk, aim for 30 or fewer.' });
    // A question carries the words of its choices, so it keeps the audience's budget in a talk too.
    const asking = slideOf('q', 'question', { question: 'one two three four five six seven eight nine ten', options: ['one two three four five six seven eight nine ten', 'one two three four five six seven eight nine ten', 'one two three four five'], correct: 0, answer: '' });
    expect(checkDeck(deckOf([asking], { audience: 'adult', purpose: 'talk' })).issues.some((i) => i.rule === 'words')).toBe(false);
    const title = slideOf('t', 'title', { title: 'A very long title '.repeat(4), subtitle: '' });
    expect(checkDeck(deckOf([title], { audience: 'young' })).slides[0].words).toBeNull();
  });

  it('flags slides with no script, key points or question', () => {
    const bare = { ...short('e'), notes: emptyNotes() };
    expect(notesEmpty(bare.notes)).toBe(true);
    expect(notesEmpty(emptyNotes({ keyPoints: ['k'] }))).toBe(false);
    const report = checkDeck(deckOf([short('a'), bare]));
    expect(report.issues.filter((i) => i.rule === 'notes')).toEqual([{ rule: 'notes', severity: 'warning', slideId: 'e', message: 'No key notes yet.' }]);
  });

  it('warns when the session is too short for its slides, since slide times are shares of it', () => {
    const slides = [short('a'), short('b'), short('c')]; // 6 min of stored minutes
    expect(checkDeck(deckOf(slides, { minutes: 40 })).issues.some((i) => i.rule === 'minutes')).toBe(false);
    const off = checkDeck(deckOf(slides, { minutes: 0.5 }));
    expect(off.minutes).toEqual({ planned: 6, target: 0.5 });
    expect(off.issues.at(-1)).toEqual({ rule: 'minutes', severity: 'warning', message: '3 slides share 0.5 min: about 10 seconds each. Cut slides or give the session more time.' });
    expect(checkDeck(deckOf(slides)).minutes.target).toBeNull();
    expect(minutesOff(38, 40)).toBe(false);
    expect(minutesOff(30, 40)).toBe(true);
  });

  it('skips hidden slides and lists slide issues in deck order before deck issues', () => {
    const report = checkDeck(deckOf([long('a'), long('h', 16), { ...short('e'), notes: emptyNotes() }].map((s) => (s.id === 'h' ? { ...s, hidden: true } : s)), { minutes: 0.5 }));
    expect(report.slides.map((s) => s.slide.id)).toEqual(['a', 'e']);
    expect(report.issues.map((i) => [i.rule, i.slideId])).toEqual([['overflow', 'a'], ['words', 'a'], ['notes', 'e'], ['minutes', undefined]]);
  });

  it('takes more rules, which see every laid-out slide', () => {
    const repeated: CheckRule = {
      id: 'repeated-kind',
      run: ({ slides }) => slides.slice(1).filter((s, i) => s.slide.kind === slides[i].slide.kind)
        .map((s) => ({ rule: 'repeated-kind', severity: 'info', slideId: s.slide.id, message: 'Same layout as the slide before.' })),
    };
    const report = checkDeck(deckOf([short('a'), short('b')]), { rules: [...CORE_RULES, repeated] });
    expect(report.slides[1].issues).toEqual([{ rule: 'repeated-kind', severity: 'info', slideId: 'b', message: 'Same layout as the slide before.' }]);
    expect(checkDeck(deckOf([long('a')]), { rules: [] }).issues).toEqual([]);
  });

  it('checks one slide as the studio stage draws it', () => {
    const d = deckOf([]);
    const p = slideProblems(long('x'), d);
    expect(p.overflow.length).toBeGreaterThan(0);
    expect(p.warnings).toEqual(expect.arrayContaining(p.overflow));
    expect(slideProblems(short('y'), d)).toMatchObject({ overflow: [], warnings: [] });
  });
});

describe('lesson rules', () => {
  // A short lesson about one life, as a teacher reviewed it: the year is taught in the passage and asked
  // for afterwards, but the opening picture's caption had already given it away.
  const opening = slideOf('open', 'image', { title: 'Who is this?', caption: 'Sun Yat-sen, born in 1866 in Guangdong', image: '' });
  const passage = slideOf('read', 'text', { title: 'Read', body: 'Sun Yat-sen was born in 1866 in a village in Guangdong. As a boy he went to school in Hawaii.' });
  const when = slideOf('ask', 'question', { question: 'When was Sun Yat-sen born?', options: ['1866', '1966', '1886'], correct: 0, answer: '' });
  const judge = (items: { statement: string; isTrue: boolean; correction?: string }[], id = 'tf') => slideOf(id, 'true-false', { title: 'True or false?', items });

  it('finds an answer shown before the slide that teaches it, and quotes the slide that gave it away', () => {
    expect(givenAway([opening, passage, when])).toEqual([
      { rule: 'given-away', severity: 'info', slideId: 'ask', message: 'Slide 1 gives away “1866” before this slide asks for it.' },
    ]);
  });

  it('lets the slide that teaches the answer show it, and a copy of it shown again for a re-read', () => {
    expect(givenAway([passage, when])).toEqual([]);
    const think = slideOf('think', 'bullets', { title: 'Read again and think', bullets: ['Where did he go to school?'] });
    expect(givenAway([passage, think, { ...passage, id: 'again' }, when])).toEqual([]);
  });

  it('matches short answers as words, not as parts of words, and leaves the deck’s own topic alone', () => {
    const teach = slideOf('teach', 'bullets', { title: 'Energy', bullets: ['Wind turns the blades', 'Coal is burned'] });
    const intro = slideOf('intro', 'bullets', { title: 'Today', bullets: ['A windy day', 'Wind power'] });
    const ask = slideOf('q', 'question', { question: 'Which source is renewable?', options: ['Coal', 'Wind'], correct: 1, answer: '' });
    expect(givenAway([intro, teach, ask]).map((i) => i.message)).toEqual(['Slide 1 gives away “Wind” before this slide asks for it.']);
    expect(givenAway([slideOf('i2', 'bullets', { title: 'Today', bullets: ['A windy day'] }), teach, ask])).toEqual([]);
    expect(givenAway([intro, teach, ask], 'Wind energy')).toEqual([]);
  });

  it('reads Chinese answers without spaces between words, and ignores one-digit numbers', () => {
    const intro = slideOf('i', 'statement', { statement: '孙中山出生在广东香山。' });
    const text = slideOf('t', 'text', { title: '课文', body: '孙中山小时候住在广东香山的一个村子里。' });
    const ask = slideOf('q', 'recall', { title: '想一想', cards: [{ prompt: '孙中山出生在哪里？', answer: '广东香山' }, { prompt: '他有几个哥哥？', answer: '2' }] });
    expect(givenAway([intro, text, ask]).map((i) => i.message)).toEqual(['Slide 1 gives away “广东香山” before this slide asks for it.']);
  });

  it('finds one fact tested twice, across slides and on one slide', () => {
    const twice = judge([{ statement: 'Sun Yat-sen was born in 1966.', isTrue: false, correction: '1866' }]);
    expect(sameChecks([when, twice])).toEqual([
      { rule: 'same-check', severity: 'warning', slideId: 'tf', message: 'Slide 1 already tests “1866”.' },
    ]);
    // The same statement with only the number changed, even without a correction to compare.
    const pair = judge([{ statement: 'He was born in 1866.', isTrue: true }, { statement: 'He was born in 1966.', isTrue: false }]);
    expect(sameChecks([pair]).map((i) => i.message)).toEqual(['This slide tests “He was born in 1866.” twice.']);
    const echo = judge([{ statement: 'He went to school in Hawaii.', isTrue: true }], 'tf2');
    const reworded = slideOf('rc', 'recall', { title: 'Recall', cards: [{ prompt: 'He went to school in Hawaii.', answer: 'True' }] });
    expect(sameChecks([echo, reworded]).map((i) => i.message)).toEqual(['Slide 1 already tests “He went to school in Hawaii.”.']);
  });

  it('leaves different facts, verdict words and blanks of one passage alone', () => {
    const facts = judge([{ statement: 'He was born in 1866.', isTrue: true }, { statement: 'He went to school in Hawaii.', isTrue: true }]);
    const yesNo = slideOf('rc', 'recall', { title: 'Recall', cards: [{ prompt: 'Was he a doctor?', answer: 'Yes' }, { prompt: 'Did he live in Paris?', answer: 'Yes' }] });
    const cloze = slideOf('fi', 'fill-in', { title: 'Fill in', passage: 'He was [born] in a village and [born] again as a leader.' });
    expect(sameChecks([facts, yesNo, cloze])).toEqual([]);
    // A blank and a question that both ask for the year are one fact tested twice.
    const year = slideOf('fy', 'fill-in', { title: 'Fill in', passage: 'He was born in [1866].' });
    expect(sameChecks([year, when]).map((i) => i.message)).toEqual(['Slide 1 already tests “1866”.']);
  });

  it('runs for lessons only, from checkDeck and on their own for the studio', () => {
    const slides = [opening, passage, when, judge([{ statement: 'He was born in 1966.', isTrue: false, correction: '1866' }])];
    expect(rulesFor(deckOf([], { purpose: 'lesson' }))).toEqual([...CORE_RULES, ...LESSON_RULES]);
    expect(rulesFor(deckOf([], { purpose: 'pitch' }))).toEqual(CORE_RULES);
    const lesson = checkDeck(deckOf(slides, { purpose: 'lesson' }));
    expect(lesson.issues.filter((i) => i.rule === 'given-away' || i.rule === 'same-check').map((i) => `${i.slideId} ${i.rule}`)).toEqual(['ask given-away', 'tf given-away', 'tf same-check']);
    expect(checkDeck(deckOf(slides, { purpose: 'talk' })).issues.some((i) => i.rule === 'given-away')).toBe(false);
    expect(lessonIssues(deckOf(slides, { purpose: 'lesson' })).map((i) => i.rule)).toEqual(['given-away', 'given-away', 'same-check']);
    expect(lessonIssues(deckOf(slides, { purpose: 'pitch' }))).toEqual([]);
    // Hidden slides give nothing away and are numbered out.
    expect(lessonIssues(deckOf([{ ...opening, hidden: true }, passage, when], { purpose: 'lesson' }))).toEqual([]);
  });
});

describe('talk rules', () => {
  const run = (kinds: string[]) => kinds.map((k, i) => slideOf(`s${i}`, k, k === 'bullets' ? { title: 'Plan', bullets: ['Ship it'] } : { title: 'T' }));

  it('flags the fourth slide of one type in a row, once per run', () => {
    const issues = sameTypeRuns(run(['title', 'bullets', 'bullets', 'bullets', 'bullets', 'bullets', 'quote', 'bullets', 'bullets', 'bullets', 'bullets']));
    expect(issues.map((i) => i.slideId)).toEqual(['s4', 's10']);
    expect(issues[0]!.message).toMatch(/^4 Points slides in a row\./);
  });

  it('does not count designed slides or section dividers', () => {
    expect(sameTypeRuns(run(['designed', 'designed', 'designed', 'designed', 'section', 'section', 'section', 'section']))).toEqual([]);
  });

  it('runs for talks only, and shows on the stage', () => {
    const slides = run(['bullets', 'bullets', 'bullets', 'bullets']);
    expect(rulesFor({ purpose: 'talk' })).toEqual(expect.arrayContaining(TALK_RULES));
    expect(rulesFor({ purpose: 'report' })).not.toEqual(expect.arrayContaining(TALK_RULES));
    expect(checkDeck(deckOf(slides, { purpose: 'talk' })).issues.some((i) => i.rule === 'rhythm')).toBe(true);
    expect(checkDeck(deckOf(slides, { purpose: 'report' })).issues.some((i) => i.rule === 'rhythm')).toBe(false);
    expect(purposeIssues(deckOf(slides, { purpose: 'talk' }))).toHaveLength(1);
  });
});

describe('data source rules', () => {
  const NOW = new Date(2026, 10, 4);
  const rows = [{ label: 'Q1', value: '42', value2: '' }, { label: 'Q2', value: '55', value2: '' }];
  const chart = (source: string, id = 'c') => slideOf(id, 'chart', { title: 'Revenue', rows, source });
  const stats = (source: string) => slideOf('n', 'stats', { title: 'Reach', stats: [{ value: '71%', label: 'of people', detail: '' }], source });
  const table = (caption: string) => slideOf('t', 'table', { title: 'Prices', cells: 'Plan | Price\nStarter | $0', header: true, caption });
  const tips = (slides: Slide[], purpose: Deck['purpose']) => dataIssues(deckOf(slides, { purpose }), NOW).map((i) => `${i.slideId} ${i.rule}`);

  it('asks for a source on a report or pitch chart or big number with figures in it, as a tip', () => {
    expect(tips([chart('')], 'report')).toEqual(['c source']);
    expect(tips([chart('   ')], 'pitch')).toEqual(['c source']);
    expect(tips([stats('')], 'report')).toEqual(['n source']);
    expect(dataIssues(deckOf([chart('')], { purpose: 'report' }), NOW)[0]).toEqual({ rule: 'source', severity: 'info', slideId: 'c', message: 'Say where these figures come from. Add a source at the bottom of the slide.' });
    expect(tips([chart('Source: BPS 2025')], 'report')).toEqual([]);
    expect(tips([chart('')], 'lesson')).toEqual([]);
    expect(tips([chart('')], 'talk')).toEqual([]);
    // No figures, no need for a source; hidden slides are skipped.
    expect(tips([slideOf('e', 'chart', { title: 'Empty', rows: [{ label: '', value: '', value2: '' }], source: '' })], 'report')).toEqual([]);
    expect(tips([{ ...chart(''), hidden: true }], 'report')).toEqual([]);
  });

  it('flags a source whose newest year is three or more years back, for every purpose', () => {
    const issues = dataIssues(deckOf([chart('Source: BPS census 2020')], { purpose: 'lesson' }), NOW);
    expect(issues).toEqual([{ rule: 'old-figures', severity: 'info', slideId: 'c', message: 'These figures are from 2020. Look for newer ones if you can.' }]);
    expect(tips([chart('Survey 2024')], 'report')).toEqual([]);
    expect(tips([chart('Survey 2023')], 'report')).toEqual(['c old-figures']);
    expect(tips([stats('Census 2018 and 2019')], 'talk')).toEqual(['n old-figures']);
    expect(tips([chart('Census 2019, 2024')], 'talk')).toEqual([]);
  });

  it('reads a table caption for years', () => {
    expect(tips([table('Data: 2019')], 'report')).toEqual(['t old-figures']);
    expect(tips([table('Prices per seat, per month.')], 'report')).toEqual([]);
    expect(tips([table('')], 'report')).toEqual([]);
  });

  it('does not read amounts or years to come as years', () => {
    expect(newestYear('1,200,000 learners', NOW)).toBeNull();
    expect(tips([chart('1,200,000 learners')], 'report')).toEqual([]);
    expect(newestYear('2030 target', NOW)).toBeNull();
    expect(newestYear('12345 and 3.2020', NOW)).toBeNull();
    expect(newestYear('Census 2020; target 2030', NOW)).toBe(2020);
    expect(newestYear('FY2021-22', NOW)).toBe(2021);
    expect(newestYear('Since 1899', NOW)).toBeNull();
  });

  it('runs from checkDeck with the date pinned, and shows on the stage through purposeIssues', () => {
    const deck = deckOf([chart('Source: BPS census 2020'), chart('', 'd')], { purpose: 'report' });
    expect(rulesFor(deck)).toContain(DATA_RULE);
    expect(checkDeck(deck, { today: NOW }).issues.filter((i) => i.rule === 'old-figures' || i.rule === 'source').map((i) => `${i.slideId} ${i.rule}`)).toEqual(['c old-figures', 'd source']);
    expect(checkDeck(deck, { today: new Date(2022, 0, 1) }).issues.some((i) => i.rule === 'old-figures')).toBe(false);
    expect(purposeIssues(deck, NOW).map((i) => i.rule)).toEqual(['old-figures', 'source']);
  });
});

describe('deterministic fixes', () => {
  it('splits a slide over as many slides as it needs, up to four', () => {
    const d = deckOf([]);
    const fits = (s: Slide) => fitsOnSlide(s, d);
    const parts = splitToFit(long('x', 30), fits)!;
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every(fits)).toBe(true);
    expect(parts[0].id).toBe('x');
    expect(parts.slice(1).every((p) => p.content.title === `Everything we learned ${CONT}`)).toBe(true);
    expect(parts.flatMap((p) => p.content.bullets as string[])).toEqual(long('x', 30).content.bullets);
    expect(splitToFit(slideOf('q', 'quote', { quote: POINT.repeat(12), source: '' }), fits)).toBeNull();
    expect(splitToFit(long('x', 30), fits, 2)).toBeNull();
  });

  it('sets the session length and scales each slide to its share', () => {
    const slides = [short('a'), short('b'), { ...short('c'), notes: emptyNotes({ minutes: 6 }) }, { ...short('h'), hidden: true }];
    const next = retimeDeck(deckOf(slides), 25);
    expect(next.minutes).toBe(25);
    expect(deckMinutes(next)).toBe(25);
    // The hidden slide keeps its share for when it is shown again.
    expect(next.slides.map((s) => s.notes.minutes)).toEqual([5, 5, 15, 5]);
    const odd = retimeDeck(deckOf([short('a'), short('b'), short('c')]), 10);
    expect(deckMinutes(odd)).toBeCloseTo(10, 1);
    expect(retimeDeck(deckOf([]), 10).slides).toEqual([]);
  });
});
