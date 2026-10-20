// Fixes what checkDeck finds after an AI draft. Slides that don't fit go to the AI to be
// shortened, a few at a time; code re-checks every answer and falls back to the deterministic
// split. Minutes are rescaled in code to the session length. The AI call is passed in, so the
// loop runs the same in tests, offline (split only) and in the browser.

import { getKind } from '../kinds/registry';
import { checkDeck, minutesOff } from './check';
import { fitsOnSlide, splitSlide } from './split';
import { type Deck, type Slide, deckMinutes } from './types';
import { countWords } from './words';

/** Whole and half minutes, never below half a minute. */
const half = (m: number) => Math.max(0.5, Math.round(m * 2) / 2);

/**
 * Scales the visible slides' minutes so they add up to the session length, in half minutes.
 * Each slide keeps its share; rounding is evened out on the longest slides.
 */
export function retimeDeck(deck: Deck, target: number): Deck {
  const shown = deck.slides.filter((s) => !s.hidden);
  const planned = deckMinutes(deck);
  if (!shown.length || !(target > 0) || planned <= 0) return deck;
  const minutes = new Map(shown.map((s) => [s.id, half((s.notes.minutes || 0) * (target / planned))]));
  const longest = [...shown].sort((a, b) => (b.notes.minutes || 0) - (a.notes.minutes || 0)).map((s) => s.id);
  let drift = Math.round((target - [...minutes.values()].reduce((a, b) => a + b, 0)) * 2) / 2;
  for (let i = 0; drift !== 0 && i < longest.length * 4; i++) {
    const id = longest[i % longest.length];
    const m = minutes.get(id)!;
    const step = drift > 0 ? 0.5 : -0.5;
    if (m + step < 0.5) continue;
    minutes.set(id, m + step);
    drift -= step;
  }
  return {
    ...deck,
    slides: deck.slides.map((s) => (minutes.has(s.id) ? { ...s, notes: { ...s.notes, minutes: minutes.get(s.id)! } } : s)),
  };
}

/**
 * Splits a slide until every part fits, up to `maxParts` slides of the same kind.
 * Returns null when the slide can't be split or the parts still don't fit.
 */
export function splitToFit(slide: Slide, fits: (s: Slide) => boolean, maxParts = 4): Slide[] | null {
  const parts: Slide[] = [];
  let rest = slide;
  while (parts.length < maxParts - 1) {
    const pair = splitSlide(rest, { fits });
    if (!pair || !fits(pair[0])) return null;
    parts.push(pair[0]);
    if (fits(pair[1])) return [...parts, pair[1]];
    rest = pair[1];
  }
  return null;
}

const wordsOn = (s: Slide) => countWords((getKind(s.kind)?.text(s.content ?? {}) ?? []).join(' '));

/** Runs `run` over the items with at most `size` running at once. */
async function inPool<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await run(items[next++]);
  }));
}

export interface FitOptions {
  /** Shortens one slide with AI, given the layout's warnings. Without it, slides are only split. */
  fit?(slide: Slide, problems: string[]): Promise<Slide>;
  /** Whether a slide fits. Defaults to fitsOnSlide in the deck's look and audience. */
  fits?(slide: Slide): boolean;
  /** Most slides sent to the AI. The rest are only split. */
  limit?: number;
  /** AI calls running at once. */
  concurrency?: number;
  /** Stops the run: slides not finished yet stay as they are, and minutes aren't rescaled. */
  signal?: AbortSignal;
  /** Called once, before the first AI call, with how many slides go to the AI. */
  onFixing?(slides: number): void;
}

export interface FitReport {
  /** Slides that didn't fit, before the run. */
  found: number;
  /** Slides the AI shortened until they fit. */
  fitted: number;
  /** Slides split over two or more slides. */
  split: number;
  /** Slides that still don't fit. */
  left: number;
  /** Whether the minutes were rescaled to the session length. */
  retimed: boolean;
  /** Whether the run was stopped before it finished. */
  stopped: boolean;
}

/** True when the run changed the deck. */
export function fitChanged(report: FitReport): boolean {
  return report.fitted + report.split > 0 || report.retimed;
}

/**
 * Checks the deck and fixes the slides that don't fit: AI first (up to `limit`, `concurrency`
 * at a time), each answer re-checked in code, then a deterministic split. Finally rescales the
 * minutes when they are well off the session length. Never throws for one slide's failure.
 */
export async function fitDeck(deck: Deck, options: FitOptions = {}): Promise<{ deck: Deck; report: FitReport }> {
  const { fit, signal, limit = 8, concurrency = 3 } = options;
  const fits = options.fits ?? ((s: Slide) => fitsOnSlide(s, deck));
  const todo = checkDeck(deck, { rules: [] }).slides.filter((s) => s.overflow.length);
  const report: FitReport = { found: todo.length, fitted: 0, split: 0, left: 0, retimed: false, stopped: false };
  const replace = new Map<string, Slide[]>();

  const settle = (slide: Slide, candidate: Slide | null) => {
    if (candidate && fits(candidate)) {
      replace.set(slide.id, [candidate]);
      report.fitted++;
      return;
    }
    // Split the AI's version only when it is shorter than the slide was; never keep a wordier answer.
    const base = candidate && candidate.kind === slide.kind && wordsOn(candidate) < wordsOn(slide) ? candidate : slide;
    const parts = splitToFit(base, fits) ?? (base !== slide ? splitToFit(slide, fits) : null);
    if (parts) {
      replace.set(slide.id, parts);
      report.split++;
    }
  };

  const viaAi = fit ? todo.slice(0, limit) : [];
  if (viaAi.length) options.onFixing?.(viaAi.length);
  await inPool(viaAi, concurrency, async ({ slide, layout }) => {
    if (signal?.aborted) return;
    let candidate: Slide | null = null;
    try {
      candidate = await fit!(slide, layout.warnings);
    } catch {
      // A failed call is not a stop: the slide falls back to splitting.
    }
    if (!signal?.aborted) settle(slide, candidate);
  });
  if (!signal?.aborted) for (const { slide } of todo.slice(viaAi.length)) settle(slide, null);
  report.stopped = Boolean(signal?.aborted);
  report.left = report.found - report.fitted - report.split;

  let next: Deck = replace.size ? { ...deck, slides: deck.slides.flatMap((s) => replace.get(s.id) ?? [s]) } : deck;
  const target = Number(deck.minutes);
  if (!report.stopped && target > 0 && minutesOff(deckMinutes(next), target)) {
    next = retimeDeck(next, target);
    report.retimed = true;
  }
  return { deck: next, report };
}
