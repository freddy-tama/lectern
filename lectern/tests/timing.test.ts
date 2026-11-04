// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  giveTime, hasSession, minutesPerSlide, sessionMinutes, setSessionMinutes, setSlideMinutes, shares, slideTimeLabel, slideTimes, stepTime, timeByNotes, timeEvenly, withSlideTimes,
} from '../src/core/deck/timing';
import { type Deck, type Slide, deckMinutes, emptyNotes, normalizeNotes } from '../src/core/deck/types';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';

registerCoreKinds();

const slide = (id: string, minutes: number, extra: Partial<Slide> = {}): Slide => ({ id, kind: 'bullets', content: { title: id, bullets: [] }, notes: emptyNotes({ minutes }), ...extra });
const deckOf = (slides: Slide[], minutes?: number): Deck => ({ id: 'd', title: 'D', themeId: 'paper', audience: 'adult', createdAt: 0, updatedAt: 0, slides, ...(minutes ? { minutes } : {}) });
const times = (d: Deck) => [...slideTimes(d).values()].map((m) => Math.round(m * 100) / 100);

describe('relative slide time', () => {
  it('shares the session by each slide’s minutes, and hidden slides take none', () => {
    const d = deckOf([slide('a', 1), slide('b', 3), slide('h', 5, { hidden: true })], 20);
    expect(times(d)).toEqual([5, 15]);
    expect(slideTimes(d).has('h')).toBe(false);
    expect(sessionMinutes(d)).toBe(20);
    expect(minutesPerSlide(d)).toBe(10);
  });

  it('adds the slides up when the deck has no session length', () => {
    const d = deckOf([slide('a', 1), slide('b', 2.5)]);
    expect(hasSession(d)).toBe(false);
    expect(sessionMinutes(d)).toBe(3.5);
    expect(times(d)).toEqual([1, 2.5]);
  });

  it('rescales every slide when the session length changes, and keeps the shares both ways', () => {
    const d = deckOf([slide('a', 0.7), slide('b', 1.4), slide('c', 2.1)], 21);
    const short = setSessionMinutes(d, 7);
    expect(short.minutes).toBe(7);
    expect(times(short)).toEqual([1.17, 2.33, 3.5]);
    setSessionMinutes(short, 21).slides.forEach((s, i) => expect(s.notes.minutes).toBeCloseTo(d.slides[i].notes.minutes * 5, 1));
    // Stored minutes become the slides' times, so exports that read them as they are stay right.
    expect(deckMinutes(short)).toBeCloseTo(7, 1);
  });

  it('gives one slide more time and takes it from the others in their proportions', () => {
    const d = deckOf([slide('a', 2), slide('b', 2), slide('c', 4)], 8);
    const next = setSlideMinutes(d, 'a', 4);
    expect(next.minutes).toBe(8);
    expect(times(next)).toEqual([4, 1.33, 2.67]);
    // It never takes so much that another slide drops under 15 seconds.
    expect(times(setSlideMinutes(d, 'a', 100))[0]).toBe(7.5);
    // A new slide takes its share from the rest; the session stays as long.
    const added = { ...d, slides: [...d.slides, slide('d', 2)] };
    expect(times(added).reduce((a, b) => a + b, 0)).toBeCloseTo(8, 5);
  });

  it('lets a deck with no session length grow, and a one-slide deck sets its length', () => {
    const d = deckOf([slide('a', 2), slide('b', 2)]);
    expect(times(setSlideMinutes(d, 'a', 5))).toEqual([5, 2]);
    expect(setSlideMinutes(deckOf([slide('a', 2)], 10), 'a', 4).minutes).toBe(4);
  });

  it('shares the session evenly, or by what each slide’s notes take to say', () => {
    const talky = { ...slide('b', 1), notes: emptyNotes({ script: 'word '.repeat(390) }) };
    const d = deckOf([slide('a', 1), talky], 12);
    expect(times(timeEvenly(d))).toEqual([6, 6]);
    const byNotes = times(timeByNotes(d));
    expect(byNotes[1]).toBeGreaterThan(byNotes[0]);
    expect(byNotes[0] + byNotes[1]).toBeCloseTo(12, 1);
  });

  it('gives items time in plain arrays, as the outline does', () => {
    expect(shares([1, 1, 2], 8)).toEqual([2, 2, 4]);
    expect(shares([0, 0], 6)).toEqual([3, 3]);
    expect(giveTime([1, 1, 2], 2, 2, 8)).toEqual([3, 3, 2]);
  });

  it('writes each slide’s time into its notes for exports', () => {
    const d = withSlideTimes(deckOf([slide('a', 1), slide('b', 3)], 2));
    expect(d.slides.map((s) => s.notes.minutes)).toEqual([0.5, 1.5]);
  });

  it('labels slide times in seconds under a minute, else whole and half minutes', () => {
    expect(slideTimeLabel(0.7)).toBe('40 s');
    expect(slideTimeLabel(1.4)).toBe('1.5 min');
    expect(slideTimeLabel(2)).toBe('2 min');
    expect(slideTimeLabel(0)).toBe('0 min');
  });

  it('steps by quarters under a minute and halves above', () => {
    expect(stepTime(0.7, true)).toBe(0.75);
    expect(stepTime(1, true)).toBe(1.5);
    expect(stepTime(1.4, true)).toBe(1.5);
    expect(stepTime(1, false)).toBe(0.75);
    expect(stepTime(1.4, false)).toBe(1);
    expect(stepTime(0.25, false)).toBe(0.25);
  });

  it('keeps stored minutes to the hundredth, so small shares survive', () => {
    expect(normalizeNotes({ minutes: 0.7 }).minutes).toBe(0.7);
    expect(normalizeNotes({ minutes: 0.001 }).minutes).toBe(0.01);
  });
});
