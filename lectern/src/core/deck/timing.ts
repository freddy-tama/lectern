// Slide time is relative. Each slide's planned minutes are its share of the deck's session
// length: change the session length and every slide rescales, keeping its share. Give one slide
// more time and the other slides share what is left, in their proportions, so the session stays
// as long as it was. A deck with no session length is as long as its slides add up to.

import { estimateMinutes } from './draft';
import { type Deck, type Slide, deckMinutes } from './types';

/** The least time a slide can be given when the others make room: 15 seconds. */
export const MIN_SLIDE_MINUTES = 0.25;

/** Session lengths the studio accepts, in minutes. */
export const SESSION_RANGE = { min: 1, max: 600 } as const;

/** Slide minutes are stored to the hundredth, so shares survive rescaling. */
const stored = (m: number) => Math.max(0.01, Math.round(m * 100) / 100);

/** Each weight's share of `total`. All-zero weights share it evenly. */
export function shares(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (!weights.length) return [];
  if (!(sum > 0)) return weights.map(() => total / weights.length);
  return weights.map((w) => ((w > 0 ? w : 0) * total) / sum);
}

/**
 * Gives item `index` `minutes` of `total`; the others share the rest in their proportions.
 * The item never takes so much that another would drop under the floor. Returns the new minutes, adding up to `total`.
 */
export function giveTime(weights: number[], index: number, minutes: number, total: number, floor = MIN_SLIDE_MINUTES): number[] {
  const now = shares(weights, total);
  if (index < 0 || index >= now.length) return now;
  if (now.length === 1) return [total];
  const most = Math.max(floor, total - floor * (now.length - 1));
  const mine = Math.min(most, Math.max(floor, minutes));
  const others = now.reduce((a, m, i) => (i === index ? a : a + m), 0);
  const rest = shares(now.map((m, i) => (i === index ? 0 : others > 0 ? m : 1)), total - mine);
  return rest.map((m, i) => (i === index ? mine : m));
}

/** The deck's length in minutes: its session length when set, else what its shown slides add up to. */
export function sessionMinutes(deck: Pick<Deck, 'slides' | 'minutes'>): number {
  const set = Number(deck.minutes);
  return Number.isFinite(set) && set > 0 ? set : deckMinutes(deck);
}

/** Whether the deck has a session length that slide times are shares of. */
export function hasSession(deck: Pick<Deck, 'minutes'>): boolean {
  const set = Number(deck.minutes);
  return Number.isFinite(set) && set > 0;
}

/** Minutes each shown slide gets of the session, by slide id. Hidden slides take no time. */
export function slideTimes(deck: Pick<Deck, 'slides' | 'minutes'>): Map<string, number> {
  const shown = deck.slides.filter((s) => !s.hidden);
  const times = shares(shown.map((s) => s.notes?.minutes || 0), sessionMinutes(deck));
  return new Map(shown.map((s, i) => [s.id, times[i]]));
}

const withMinutes = (s: Slide, minutes: number): Slide => ({ ...s, notes: { ...s.notes, minutes: stored(minutes) } });

/**
 * Sets the session length. Every slide keeps its share, and its stored minutes become its time at
 * the new length. Hidden slides scale too, so they keep their share when shown again.
 */
export function setSessionMinutes(deck: Deck, total: number): Deck {
  const length = Math.min(SESSION_RANGE.max, Math.max(SESSION_RANGE.min, Math.round(total * 2) / 2));
  const planned = deckMinutes(deck);
  const shown = deck.slides.filter((s) => !s.hidden);
  const even = !(planned > 0) && shown.length ? length / shown.length : 0;
  const scale = planned > 0 ? length / planned : 0;
  return {
    ...deck,
    minutes: length,
    slides: deck.slides.map((s) => (s.hidden && !scale ? s : withMinutes(s, scale ? (s.notes.minutes || 0) * scale : even))),
  };
}

/**
 * Gives one slide `minutes`. With a session length, the other shown slides share the rest in
 * their proportions and the session stays as long. Without one, the deck just grows or shrinks.
 */
export function setSlideMinutes(deck: Deck, slideId: string, minutes: number): Deck {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return deck;
  if (slide.hidden || !hasSession(deck)) {
    return { ...deck, slides: deck.slides.map((s) => (s.id === slideId ? withMinutes(s, Math.max(MIN_SLIDE_MINUTES, minutes)) : s)) };
  }
  const shown = deck.slides.filter((s) => !s.hidden);
  if (shown.length === 1) return setSessionMinutes(deck, minutes);
  const next = giveTime(shown.map((s) => s.notes.minutes || 0), shown.indexOf(slide), minutes, sessionMinutes(deck));
  const times = new Map(shown.map((s, i) => [s.id, next[i]]));
  return { ...deck, slides: deck.slides.map((s) => (times.has(s.id) ? withMinutes(s, times.get(s.id)!) : s)) };
}

/**
 * The stored minutes that give one slide `minutes` of the session while the other slides keep
 * theirs as stored, so a change to a single slide (an assistant's proposal) times it exactly.
 * `slideId` may be a slide not in the deck yet. Without a session length, minutes are as they are.
 */
export function weightFor(deck: Pick<Deck, 'slides' | 'minutes'>, slideId: string | null, minutes: number): number {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!hasSession(deck) || slide?.hidden) return stored(minutes);
  const others = deck.slides.filter((s) => !s.hidden && s.id !== slideId);
  const rest = others.reduce((a, s) => a + (s.notes.minutes || 0), 0);
  const total = sessionMinutes(deck);
  const most = total - MIN_SLIDE_MINUTES * others.length;
  if (!(rest > 0) || most <= 0) return stored(minutes);
  const mine = Math.min(most, Math.max(MIN_SLIDE_MINUTES, minutes));
  return stored((mine * rest) / (total - mine));
}

/** Shares the session by what each slide's notes take to say (see estimateMinutes). */
export function timeByNotes(deck: Deck): Deck {
  const total = sessionMinutes(deck);
  const estimated = { ...deck, slides: deck.slides.map((s) => withMinutes(s, estimateMinutes(s.notes, s.kind))) };
  return hasSession(deck) ? setSessionMinutes(estimated, total) : estimated;
}

/** Shares the session evenly between the shown slides. */
export function timeEvenly(deck: Deck): Deck {
  const total = sessionMinutes(deck);
  const shown = deck.slides.filter((s) => !s.hidden);
  if (!shown.length) return deck;
  const each = total / shown.length;
  return { ...deck, slides: deck.slides.map((s) => withMinutes(s, each)) };
}

/** The deck with every shown slide's stored minutes set to its time, for readers that take minutes as they are (exports). */
export function withSlideTimes<D extends Pick<Deck, 'slides' | 'minutes'>>(deck: D): D {
  const times = slideTimes(deck);
  return { ...deck, slides: deck.slides.map((s) => (times.has(s.id) ? { ...s, notes: { ...s.notes, minutes: stored(times.get(s.id)!) } } : s)) };
}

/** A slide's time for people: seconds under a minute ("45 s"), else whole and half minutes ("1.5 min"). */
export function slideTimeLabel(minutes: number): string {
  if (!(minutes > 0)) return '0 min';
  if (minutes < 0.95) return `${Math.max(5, Math.round((minutes * 60) / 5) * 5)} s`;
  const half = Math.round(minutes * 2) / 2;
  return `${Number.isInteger(half) ? half : half.toFixed(1)} min`;
}

/** The next time up or down from `minutes`: half a minute at a time, and quarters under a minute, never under the least a slide can have. */
export function stepTime(minutes: number, up: boolean): number {
  const unit = (up ? minutes < 1 : minutes <= 1) ? 0.25 : 0.5;
  const next = up ? Math.floor(minutes / unit + 1e-6) * unit + unit : Math.ceil(minutes / unit - 1e-6) * unit - unit;
  return Math.max(MIN_SLIDE_MINUTES, next);
}

/** The average time a shown slide gets, in minutes. */
export function minutesPerSlide(deck: Pick<Deck, 'slides' | 'minutes'>): number {
  const shown = deck.slides.filter((s) => !s.hidden).length;
  return shown ? sessionMinutes(deck) / shown : 0;
}
