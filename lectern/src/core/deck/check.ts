// Checks a deck against Lectern's own rules: slides whose text doesn't fit, words over the
// audience's budget, slides without key notes, and minutes that don't add up to the session.
// Code decides what fails, so the same check can run after an AI draft, on AI suggestions and
// as a list in the studio. Each rule reads the laid-out deck and returns issues; more rules
// (repeated layouts, repeated text, long stretches without a question, contrast) join the list.

import type { SlideLayout } from '../engine/boxes';
import { layoutDeck, layoutSlide } from '../engine/layout';
import { getTheme } from '../engine/themes';
import { isOverflowWarning } from './split';
import { type Deck, type KeyNotes, type Slide, deckMinutes } from './types';

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
  run: ({ slides }) => slides.flatMap((s): CheckIssue[] => (s.words && s.words.count > s.words.budget
    ? [{ rule: 'words', severity: 'warning', slideId: s.slide.id, message: `${s.words.count} words. For this audience, aim for ${s.words.budget} or fewer.` }]
    : [])),
};

export const NOTES_RULE: CheckRule = {
  id: 'notes',
  run: ({ slides }) => slides.filter((s) => notesEmpty(s.slide.notes)).map((s) => ({ rule: 'notes', severity: 'warning', slideId: s.slide.id, message: 'No key notes yet.' })),
};

export const MINUTES_RULE: CheckRule = {
  id: 'minutes',
  run: ({ minutes: { planned, target } }) => (target && minutesOff(planned, target)
    ? [{ rule: 'minutes', severity: 'warning', message: `The slides add up to ${fmt(planned)} min. The session is ${fmt(target)} min.` }]
    : []),
};

export const CORE_RULES: CheckRule[] = [OVERFLOW_RULE, WORDS_RULE, NOTES_RULE, MINUTES_RULE];

/** One slide laid out as the studio stage draws it: every warning, the overflow ones, and the words against the budget. */
export function slideProblems(slide: Slide, deck: Pick<Deck, 'themeId' | 'audience' | 'title'>): Pick<SlideCheck, 'overflow' | 'words'> & { warnings: string[] } {
  const layout = layoutSlide(slide, { theme: getTheme(deck.themeId), audience: deck.audience, mode: 'edit', deckTitle: deck.title, slideCount: 2 });
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
  const found = (options.rules ?? CORE_RULES).flatMap((rule) => rule.run({ deck, slides, minutes }));
  const byId = new Map(slides.map((s) => [s.slide.id, s]));
  for (const issue of found) if (issue.slideId) byId.get(issue.slideId)?.issues.push(issue);
  const order = new Map(slides.map((s, i) => [s.slide.id, i]));
  const issues = [
    ...found.filter((i) => i.slideId && order.has(i.slideId)).sort((a, b) => order.get(a.slideId!)! - order.get(b.slideId!)!),
    ...found.filter((i) => !i.slideId),
  ];
  return { slides, minutes, issues, overflowing: slides.filter((s) => s.overflow.length).map((s) => s.slide.id) };
}
