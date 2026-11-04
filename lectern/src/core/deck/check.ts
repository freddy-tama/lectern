// Checks a deck against Lectern's own rules: slides whose text doesn't fit, words over the
// audience's budget, slides without key notes, and a session too short for its slides.
// Code decides what fails, so the same check can run after an AI draft, on AI suggestions and
// as a list in the studio. Each rule reads the laid-out deck and returns issues; more rules
// (repeated layouts, repeated text, long stretches without a question, contrast) join the list.
// Lessons add two rules that read only text: an answer given away before the slide that asks
// for it, and one thing tested twice.

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

export const CORE_RULES: CheckRule[] = [OVERFLOW_RULE, WORDS_RULE, NOTES_RULE, MINUTES_RULE];

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

/** The rules a deck is checked against: the core ones, and the lesson rules for a lesson. */
export function rulesFor(deck: Pick<Deck, 'purpose' | 'lessonId'>): CheckRule[] {
  return deckPurpose(deck) === 'lesson' ? [...CORE_RULES, ...LESSON_RULES] : CORE_RULES;
}

/** The lesson rules alone, on the visible slides, for the studio and the assistant. Empty for other purposes. */
export function lessonIssues(deck: Pick<Deck, 'slides' | 'title' | 'purpose' | 'lessonId'>): CheckIssue[] {
  if (deckPurpose(deck) !== 'lesson') return [];
  const shown = deck.slides.filter((s) => !s.hidden);
  return [...givenAway(shown, deck.title), ...sameChecks(shown)];
}

/** One slide laid out as the studio stage draws it: every warning, the overflow ones, and the words against the budget. */
export function slideProblems(slide: Slide, deck: Pick<Deck, 'themeId' | 'audience' | 'title'> & Partial<Pick<Deck, 'purpose' | 'lessonId' | 'density'>>): Pick<SlideCheck, 'overflow' | 'words'> & { warnings: string[] } {
  const layout = layoutSlide(slide, { theme: getTheme(deck.themeId), audience: deck.audience, mode: 'edit', deckTitle: deck.title, slideCount: 2, purpose: deckPurpose(deck), density: deck.density });
  return { warnings: layout.warnings, overflow: layout.warnings.filter(isOverflowWarning), words: layout.words ?? null };
}

/** Lays out the visible slides as the studio does and runs every rule over them. */
export function checkDeck(deck: Deck, options: { rules?: CheckRule[] } = {}): DeckCheck {
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
  const found = (options.rules ?? rulesFor(deck)).flatMap((rule) => rule.run({ deck, slides, minutes }));
  const byId = new Map(slides.map((s) => [s.slide.id, s]));
  for (const issue of found) if (issue.slideId) byId.get(issue.slideId)?.issues.push(issue);
  const order = new Map(slides.map((s, i) => [s.slide.id, i]));
  const issues = [
    ...found.filter((i) => i.slideId && order.has(i.slideId)).sort((a, b) => order.get(a.slideId!)! - order.get(b.slideId!)!),
    ...found.filter((i) => !i.slideId),
  ];
  return { slides, minutes, issues, overflowing: slides.filter((s) => s.overflow.length).map((s) => s.slide.id) };
}
