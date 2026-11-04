// Checks a deck against Lectern's own rules: slides whose text doesn't fit, words over the
// audience's budget, slides without key notes, and a session too short for its slides. Talks
// add one: four slides of the same type in a row.
// Code decides what fails, so the same check can run after an AI draft, on AI suggestions and
// as a list in the studio. Each rule reads the laid-out deck and returns issues; more rules
// (repeated layouts, repeated text, long stretches without a question, contrast) join the list.
// Lessons add two rules that read only text: an answer given away before the slide that asks
// for it, and one thing tested twice. Data slides add two tips: figures with no source (reports
// and pitches) and a source whose newest year is three or more years old.

import type { SlideLayout } from '../engine/boxes';
import { layoutDeck, layoutSlide } from '../engine/layout';
import { getTheme } from '../engine/themes';
import { budgetFor } from '../kinds/kit';
import { getKind } from '../kinds/registry';
import { isOverflowWarning } from './split';
import { minutesPerSlide, sessionMinutes } from './timing';
import { type Deck, type KeyNotes, type Slide, deckMinutes, deckPurpose } from './types';

export type CheckSeverity = 'error' | 'warning' | 'info';

export interface CheckIssue {
  /** The rule that found it, for example "overflow". */
  rule: string;
  severity: CheckSeverity;
  /** One sentence, for a list of issues. */
  message: string;
  /** The slide it is about. Deck-wide issues have none. */
  slideId?: string;
}

/** One visible slide, laid out as the studio draws it, with what the rules read. */
export interface SlideCheck {
  slide: Slide;
  /** Position among the visible slides, from 0. */
  index: number;
  layout: SlideLayout;
  /** The layout's warnings that mean the slide doesn't fit, word for word. */
  overflow: string[];
  /** Words on the slide against the audience's budget. Null where no budget applies (title and section slides). */
  words: { count: number; budget: number } | null;
  issues: CheckIssue[];
}

export interface DeckCheck {
  slides: SlideCheck[];
  /** Planned minutes of the visible slides, and the session length when the deck has one. */
  minutes: { planned: number; target: number | null };
  /** Every issue: slide issues in deck order, then deck-wide ones. */
  issues: CheckIssue[];
  /** Ids of the slides that don't fit, in deck order. */
  overflowing: string[];
}

export interface CheckInput {
  deck: Deck;
  slides: SlideCheck[];
  minutes: DeckCheck['minutes'];
  /** The date "recent" is measured from; the rules that need it default to now. */
  today?: Date;
}

/** A rule reads the laid-out deck and reports what it finds. It never changes the deck. */
export interface CheckRule {
  id: string;
  run(input: CheckInput): CheckIssue[];
}

/** Whether the planned minutes are far enough from the session length to matter. */
export function minutesOff(planned: number, target: number): boolean {
  return Math.abs(planned - target) > Math.max(2, target * 0.15);
}

/** No script, no key points and no question: nothing for the presenter or a reader. */
export function notesEmpty(notes: KeyNotes): boolean {
  return !notes.script.trim() && !notes.keyPoints.length && !notes.check;
}

const fmt = (m: number) => (Number.isInteger(m) ? String(m) : m.toFixed(1));

export const OVERFLOW_RULE: CheckRule = {
  id: 'overflow',
  run: ({ slides }) => slides.filter((s) => s.overflow.length).map((s) => ({ rule: 'overflow', severity: 'error', slideId: s.slide.id, message: s.overflow[0] })),
};

export const WORDS_RULE: CheckRule = {
  id: 'words',
  run: ({ deck, slides }) => slides.flatMap((s): CheckIssue[] => (s.words && s.words.count > s.words.budget
    ? [{ rule: 'words', severity: 'warning', slideId: s.slide.id, message: `${s.words.count} words. ${budgetFor(deckPurpose(deck))}, aim for ${s.words.budget} or fewer.` }]
    : [])),
};

export const NOTES_RULE: CheckRule = {
  id: 'notes',
  run: ({ slides }) => slides.filter((s) => notesEmpty(s.slide.notes)).map((s) => ({ rule: 'notes', severity: 'warning', slideId: s.slide.id, message: 'No key notes yet.' })),
};

/** Slides that get less than this on average, in minutes, go by too fast to present. */
export const FASTEST_PACE = 1 / 3;

/** Slide times are shares of the session, so they always add up; what can go wrong is too many slides for the time. */
export const MINUTES_RULE: CheckRule = {
  id: 'minutes',
  run: ({ deck }) => {
    const shown = deck.slides.filter((s) => !s.hidden).length;
    const each = minutesPerSlide(deck);
    return shown > 1 && each < FASTEST_PACE
      ? [{ rule: 'minutes', severity: 'warning', message: `${shown} slides share ${fmt(sessionMinutes(deck))} min: about ${Math.round(each * 60)} seconds each. Cut slides or give the session more time.` }]
      : [];
  },
};

// ─── Data rules ───────────────────────────────────────────────────────
// Charts and big numbers carry a source line; a table carries a caption that may say it. Text only.

/** Figures this many years old, or older, are worth a second look. */
export const STALE_YEARS = 3;

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const filled = (items: unknown, key: string) => Array.isArray(items) && items.some((o) => o && typeof o === 'object' && str((o as Record<string, unknown>)[key]).trim());

/** Whether a slide has figures in it, and the text that says where they come from (null for slides that carry neither). */
function dataOf(slide: Slide): { figures: boolean; source: string } | null {
  const c = slide.content;
  if (slide.kind === 'chart') return { figures: filled(c.rows, 'value') || filled(c.rows, 'value2'), source: str(c.source) };
  if (slide.kind === 'stats') return { figures: filled(c.stats, 'value'), source: str(c.source) };
  if (slide.kind === 'table') return { figures: false, source: str(c.caption) };
  return null;
}

/** The newest year written in a text, from 1900 up to this year. Numbers like 1,200,000 or a year to come are not read as years. */
export function newestYear(text: string, today: Date = new Date()): number | null {
  const now = today.getFullYear();
  const years = [...text.normalize('NFKC').matchAll(/(?<!\d)(?<!\d[.,])(?:19|20)\d{2}(?!\d)(?![.,]\d)/g)].map((m) => Number(m[0])).filter((y) => y >= 1900 && y <= now);
  return years.length ? Math.max(...years) : null;
}

/** A tip on chart and big-number slides with figures and no source (reports and pitches only), and on any data slide whose source is old. */
export function dataIssues(deck: Pick<Deck, 'slides' | 'purpose' | 'lessonId'>, today: Date = new Date()): CheckIssue[] {
  const purpose = deckPurpose(deck);
  const wantsSource = purpose === 'report' || purpose === 'pitch';
  const out: CheckIssue[] = [];
  for (const slide of deck.slides) {
    if (slide.hidden) continue;
    const data = dataOf(slide);
    if (!data) continue;
    if (wantsSource && data.figures && !data.source.trim()) {
      out.push({ rule: 'source', severity: 'info', slideId: slide.id, message: 'Say where these figures come from. Add a source at the bottom of the slide.' });
      continue;
    }
    const year = newestYear(data.source, today);
    if (year !== null && today.getFullYear() - year >= STALE_YEARS) out.push({ rule: 'old-figures', severity: 'info', slideId: slide.id, message: `These figures are from ${year}. Look for newer ones if you can.` });
  }
  return out;
}

export const DATA_RULE: CheckRule = {
  id: 'data',
  run: ({ deck, today }) => dataIssues(deck, today),
};

export const CORE_RULES: CheckRule[] = [OVERFLOW_RULE, WORDS_RULE, NOTES_RULE, MINUTES_RULE, DATA_RULE];

// ─── Talk rules ───────────────────────────────────────────────────────

/** More slides of one type in a row than this, and a talk loses its rhythm. */
export const MOST_IN_A_ROW = 3;

/** Kinds that don't count towards a run: a finished deck is all designed slides, and dividers break a run anyway. */
const RUN_BREAKERS = new Set(['designed', 'section']);

/** The slide where a run of one type grows past three, once per run. */
export function sameTypeRuns(slides: Slide[]): CheckIssue[] {
  const out: CheckIssue[] = [];
  let run = 0;
  slides.forEach((s, i) => {
    run = i > 0 && s.kind === slides[i - 1]!.kind && !RUN_BREAKERS.has(s.kind) ? run + 1 : 1;
    if (run !== MOST_IN_A_ROW + 1) return;
    const label = getKind(s.kind)?.label ?? s.kind;
    out.push({ rule: 'rhythm', severity: 'info', slideId: s.id, message: `${run} ${label} slides in a row. Change the slide type every one to three slides: a picture, a quote or a big number keeps a talk moving.` });
  });
  return out;
}

export const RHYTHM_RULE: CheckRule = {
  id: 'rhythm',
  run: ({ slides }) => sameTypeRuns(slides.map((s) => s.slide)),
};

export const TALK_RULES: CheckRule[] = [RHYTHM_RULE];

// ─── Lesson rules ─────────────────────────────────────────────────────
// What a slide asks comes from its kind's checks(): a question, a recall prompt, a statement to judge,
// a blank. An answer rests on facts: each number of two digits or more (a year, an amount) and the
// whole answer when it is short. Text only, so these run on every edit without laying the deck out.

/** Chinese, Japanese and Korean script, where words aren't separated by spaces. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** Answers that are a verdict, not a fact. */
const VERDICTS = new Set(['yes', 'no', 'true', 'false']);

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const numbersIn = (s: string) => [...s.normalize('NFKC').matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/,/g, '')).filter((n) => n.replace(/\D/g, '').length >= 2);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Fact {
  /** How it is matched: a number as written, or the normalised answer. */
  key: string;
  /** How it is quoted in a message. */
  show: string;
}

/** The facts an answer rests on. */
function factsOf(answer: string): Fact[] {
  const facts = numbersIn(answer).map((n) => ({ key: n, show: n }));
  const n = norm(answer);
  const short = CJK.test(n) ? n.replace(/\s/g, '').length <= 8 : n.split(' ').length <= 4;
  if (short && n.length >= 2 && !VERDICTS.has(n) && !facts.some((f) => f.key === n)) facts.push({ key: n, show: clip(answer.trim(), 40) });
  return facts;
}

/** One thing a slide asks the room. */
interface Asked {
  slide: Slide;
  /** Position among the visible slides, from 0. */
  index: number;
  prompt: string;
  facts: Fact[];
  /** The prompt with its numbers taken out, to spot one statement asked twice with a different number. */
  wording: string;
}

function askedIn(slides: Slide[]): Asked[] {
  return slides.flatMap((slide, index) => (getKind(slide.kind)?.checks?.(slide.content) ?? []).map(({ prompt, answer }) => {
    const wording = norm(prompt).replace(/\d+/g, '#');
    return { slide, index, prompt, facts: factsOf(answer), wording: wording.length >= 8 ? wording : '' };
  }));
}

/** What a slide shows, for finding facts in it. */
interface Shown {
  norm: string;
  numbers: Set<string>;
  /** The slide asks something itself (a question, a true or false), so what it shows is not teaching. */
  asks: boolean;
}

function shownOn(slide: Slide): Shown {
  const def = getKind(slide.kind);
  const raw = def ? def.text(slide.content).join('\n') : '';
  return { norm: norm(raw), numbers: new Set(numbersIn(raw)), asks: Boolean(def?.checks) };
}

function shows(on: Shown, fact: Fact): boolean {
  if (/^\d+(\.\d+)?$/.test(fact.key)) return on.numbers.has(fact.key);
  if (CJK.test(fact.key)) return on.norm.replace(/\s/g, '').includes(fact.key.replace(/\s/g, ''));
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(fact.key)}(?![\\p{L}\\p{N}])`, 'u').test(on.norm);
}

/**
 * Answers shown before the slide that asks for them. The last slide before the question that shows the
 * fact is taken to teach it (a passage, a point), as are copies of that slide shown again for a re-read;
 * an earlier slide that shows it too gave it away. Words of the deck's title are no secret.
 */
export function givenAway(slides: Slide[], deckTitle = ''): CheckIssue[] {
  const shown = slides.map(shownOn);
  const title = norm(deckTitle);
  const out: CheckIssue[] = [];
  const told = new Set<string>();
  for (const a of askedIn(slides)) {
    for (const fact of a.facts) {
      const key = `${a.slide.id} ${fact.key}`;
      if (told.has(key) || (!/^\d/.test(fact.key) && title.includes(fact.key))) continue;
      const hits = shown.slice(0, a.index).flatMap((s, i) => (!s.asks && shows(s, fact) ? [i] : []));
      const taught = hits[hits.length - 1];
      const gave = hits.find((i) => i !== taught && shown[i]!.norm !== shown[taught!]!.norm);
      if (gave === undefined) continue;
      told.add(key);
      out.push({ rule: 'given-away', severity: 'info', slideId: a.slide.id, message: `Slide ${gave + 1} gives away “${fact.show}” before this slide asks for it.` });
      break;
    }
  }
  return out;
}

/**
 * Two things asked that test the same statement: they rest on the same fact, or say the same with only
 * a number changed. Blanks in one passage may share a word, so they aren't compared with each other.
 */
export function sameChecks(slides: Slide[]): CheckIssue[] {
  const asked = askedIn(slides);
  const out: CheckIssue[] = [];
  asked.forEach((b, j) => {
    for (const a of asked.slice(0, j)) {
      const here = a.slide === b.slide;
      if (here && !a.prompt && !b.prompt) continue;
      const shared = b.facts.find((f) => a.facts.some((g) => g.key === f.key));
      if (!shared && !(b.wording && b.wording === a.wording)) continue;
      const what = shared?.show ?? clip(a.prompt.trim(), 50);
      out.push({ rule: 'same-check', severity: 'warning', slideId: b.slide.id, message: here ? `This slide tests “${what}” twice.` : `Slide ${a.index + 1} already tests “${what}”.` });
      break;
    }
  });
  return out;
}

export const GIVEN_AWAY_RULE: CheckRule = {
  id: 'given-away',
  run: ({ deck, slides }) => givenAway(slides.map((s) => s.slide), deck.title),
};

export const SAME_CHECK_RULE: CheckRule = {
  id: 'same-check',
  run: ({ slides }) => sameChecks(slides.map((s) => s.slide)),
};

export const LESSON_RULES: CheckRule[] = [GIVEN_AWAY_RULE, SAME_CHECK_RULE];

/** The rules a deck is checked against: the core ones, with the lesson rules for a lesson and the talk rules for a talk. */
export function rulesFor(deck: Pick<Deck, 'purpose' | 'lessonId'>): CheckRule[] {
  const purpose = deckPurpose(deck);
  return purpose === 'lesson' ? [...CORE_RULES, ...LESSON_RULES] : purpose === 'talk' ? [...CORE_RULES, ...TALK_RULES] : CORE_RULES;
}

/** The lesson rules alone, on the visible slides, for the studio and the assistant. Empty for other purposes. */
export function lessonIssues(deck: Pick<Deck, 'slides' | 'title' | 'purpose' | 'lessonId'>): CheckIssue[] {
  if (deckPurpose(deck) !== 'lesson') return [];
  const shown = deck.slides.filter((s) => !s.hidden);
  return [...givenAway(shown, deck.title), ...sameChecks(shown)];
}

/** The text-only rules of the deck's purpose, on the visible slides: the lesson rules, or the talk's rhythm, with the data tips for every purpose. */
export function purposeIssues(deck: Pick<Deck, 'slides' | 'title' | 'purpose' | 'lessonId'>, today: Date = new Date()): CheckIssue[] {
  const own = deckPurpose(deck) === 'talk' ? sameTypeRuns(deck.slides.filter((s) => !s.hidden)) : lessonIssues(deck);
  return [...own, ...dataIssues(deck, today)];
}

/** One slide laid out as the studio stage draws it: every warning, the overflow ones, and the words against the budget. */
export function slideProblems(slide: Slide, deck: Pick<Deck, 'themeId' | 'audience' | 'title'> & Partial<Pick<Deck, 'purpose' | 'lessonId' | 'density'>>): Pick<SlideCheck, 'overflow' | 'words'> & { warnings: string[] } {
  const layout = layoutSlide(slide, { theme: getTheme(deck.themeId), audience: deck.audience, mode: 'edit', deckTitle: deck.title, slideCount: 2, purpose: deckPurpose(deck), density: deck.density });
  return { warnings: layout.warnings, overflow: layout.warnings.filter(isOverflowWarning), words: layout.words ?? null };
}

/** Lays out the visible slides as the studio does and runs every rule over them. */
export function checkDeck(deck: Deck, options: { rules?: CheckRule[]; today?: Date } = {}): DeckCheck {
  const slides: SlideCheck[] = layoutDeck(deck, { mode: 'edit' }).map(({ slide, layout }, index) => ({
    slide,
    index,
    layout,
    overflow: layout.warnings.filter(isOverflowWarning),
    words: layout.words ?? null,
    issues: [],
  }));
  const target = Number(deck.minutes);
  const minutes = { planned: deckMinutes(deck), target: Number.isFinite(target) && target > 0 ? target : null };
  const found = (options.rules ?? rulesFor(deck)).flatMap((rule) => rule.run({ deck, slides, minutes, today: options.today }));
  const byId = new Map(slides.map((s) => [s.slide.id, s]));
  for (const issue of found) if (issue.slideId) byId.get(issue.slideId)?.issues.push(issue);
  const order = new Map(slides.map((s, i) => [s.slide.id, i]));
  const issues = [
    ...found.filter((i) => i.slideId && order.has(i.slideId)).sort((a, b) => order.get(a.slideId!)! - order.get(b.slideId!)!),
    ...found.filter((i) => !i.slideId),
  ];
  return { slides, minutes, issues, overflowing: slides.filter((s) => s.overflow.length).map((s) => s.slide.id) };
}
