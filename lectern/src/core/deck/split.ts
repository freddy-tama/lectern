// Splits a slide that holds too much into two slides of the same kind. Deterministic: no AI.
// The second slide repeats the heading marked "(cont.)". Rules follow Lesson Studio's paginate:
// fill the first slide, then even the two out so neither is left with a lone item.

import { layoutSlide } from '../engine/layout';
import { getTheme } from '../engine/themes';
import type { Deck, Slide } from './types';
import { emptyNotes, uid } from './types';

interface SplitRule {
  /** The content field holding the items. "cells" is a table: one row per line. */
  key: string;
  shape: 'list' | 'objects' | 'table';
  /** What the slide shows when its title is empty, so the copy can say "Today (cont.)". */
  fallback?: string;
  /** Most items the layout draws; any beyond it are silently left off the slide. */
  max?: number;
}

const RULES: Record<string, SplitRule> = {
  bullets: { key: 'bullets', shape: 'list' },
  agenda: { key: 'items', shape: 'list', fallback: 'Today' },
  summary: { key: 'points', shape: 'list', fallback: 'Key takeaways' },
  steps: { key: 'steps', shape: 'objects', max: 6 },
  timeline: { key: 'milestones', shape: 'objects', max: 6 },
  scorecard: { key: 'metrics', shape: 'objects', max: 6 },
  table: { key: 'cells', shape: 'table' },
};

/** The stage's warnings that mean "this does not fit", as opposed to advice such as word counts. */
const OVERFLOW = [/^Text is too long to fit/, /^This list is too long for one slide/, /^This table is too big for one slide/];

export function isOverflowWarning(warning: string): boolean {
  return OVERFLOW.some((re) => re.test(warning));
}

export const CONT = '(cont.)';

/** "Plan" → "Plan (cont.)". A heading already marked keeps a single mark. */
export function contHeading(title: string, fallback = ''): string {
  const base = title.trim() || fallback;
  if (!base) return CONT;
  return base.endsWith(CONT) ? base : `${base} ${CONT}`;
}

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** A table's source split into its head (header row and any Markdown separator) and body rows, as lines. */
export function tableLines(source: string, header: boolean): { head: string[]; body: string[] } {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (!header || !lines.length) return { head: [], body: lines };
  const head = [lines[0]];
  let i = 1;
  while (i < lines.length && TABLE_SEP.test(lines[i]) && /[|]|-{3,}/.test(lines[i])) head.push(lines[i++]);
  return { head, body: lines.slice(i) };
}

function items(slide: Slide, rule: SplitRule): unknown[] {
  const v = slide.content[rule.key];
  if (rule.shape === 'table') return tableLines(String(v ?? ''), slide.content.header !== false).body;
  if (!Array.isArray(v)) return [];
  if (rule.shape === 'list') return v.filter((s) => String(s ?? '').trim());
  return v.filter((o) => o && typeof o === 'object');
}

/** True for the kinds Split handles, when the slide has at least two items to share out. */
export function canSplit(slide: Slide): boolean {
  const rule = RULES[slide.kind];
  return Boolean(rule) && items(slide, rule).length >= 2;
}

function withItems(slide: Slide, rule: SplitRule, part: unknown[]): Record<string, unknown> {
  if (rule.shape !== 'table') return { ...slide.content, [rule.key]: part };
  const { head } = tableLines(String(slide.content.cells ?? ''), slide.content.header !== false);
  return { ...slide.content, cells: [...head, ...(part as string[])].join('\n') };
}

/** Whole and half minutes, never below half a minute. */
const halfMinutes = (m: number) => Math.max(0.5, Math.round(m * 2) / 2);

/** The two slides when the first `k` items stay and the rest move on. */
function splitAt(slide: Slide, rule: SplitRule, list: unknown[], k: number): [Slide, Slide] {
  const title = typeof slide.content.title === 'string' ? slide.content.title : '';
  const total = slide.notes.minutes || 2;
  const firstMinutes = halfMinutes(total * (k / list.length));
  const first: Slide = {
    ...slide,
    content: withItems(slide, rule, list.slice(0, k)),
    notes: { ...slide.notes, minutes: firstMinutes },
  };
  const second: Slide = {
    id: uid('s'),
    kind: slide.kind,
    content: { ...withItems(slide, rule, list.slice(k)), title: contHeading(title, rule.fallback) },
    // The script and key points stay with the slide they were written for; the copy starts clean.
    notes: emptyNotes({ minutes: halfMinutes(total - firstMinutes) }),
    ...(slide.variant ? { variant: slide.variant } : {}),
    ...(slide.hidden ? { hidden: true } : {}),
  };
  return [first, second];
}

export interface SplitOptions {
  /** Whether a slide fits without overflowing. Without it, the items are shared out evenly. */
  fits?(slide: Slide): boolean;
}

/**
 * Splits a slide into two of the same kind, or returns null when it can't be split.
 * The first slide keeps its id, title and key notes; the second gets a new id and the heading marked "(cont.)".
 * Split point: the most even one where both slides fit (3 + 2 rather than 2 + 3). When no even split fits,
 * the first slide takes as many items as fit and the rest move on.
 */
export function splitSlide(slide: Slide, options: SplitOptions = {}): [Slide, Slide] | null {
  const rule = RULES[slide.kind];
  if (!rule) return null;
  const list = items(slide, rule);
  const n = list.length;
  if (n < 2) return null;
  const holds = (k: number) => !rule.max || k <= rule.max;
  const fits = (s: Slide, k: number) => holds(k) && (options.fits?.(s) ?? true);
  const ks = Array.from({ length: n - 1 }, (_, i) => i + 1)
    .sort((a, b) => Math.abs(2 * a - n) - Math.abs(2 * b - n) || b - a);
  for (const k of ks) {
    const pair = splitAt(slide, rule, list, k);
    if (fits(pair[0], k) && fits(pair[1], n - k)) return pair;
  }
  for (let k = n - 1; k >= 1; k--) {
    const pair = splitAt(slide, rule, list, k);
    if (fits(pair[0], k)) return pair;
  }
  return splitAt(slide, rule, list, Math.ceil(n / 2));
}

/** Whether a slide lays out without overflowing in this deck's look and for its audience. */
export function fitsOnSlide(slide: Slide, deck: Pick<Deck, 'themeId' | 'audience' | 'title'>): boolean {
  const layout = layoutSlide(slide, { theme: getTheme(deck.themeId), audience: deck.audience, mode: 'edit', deckTitle: deck.title, slideCount: 2 });
  return !layout.warnings.some(isOverflowWarning);
}

/** Replaces the slide with its two halves in the deck, or returns the deck unchanged. */
export function splitInDeck(deck: Deck, slideId: string, pair: [Slide, Slide]): Deck {
  const i = deck.slides.findIndex((s) => s.id === slideId);
  if (i < 0) return deck;
  const slides = [...deck.slides];
  slides.splice(i, 1, ...pair);
  return { ...deck, slides };
}
