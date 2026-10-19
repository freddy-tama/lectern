// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSeed } from '../src/data/seed';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { allKinds } from '../src/core/kinds/registry';
import { deckPurpose } from '../src/core/deck/types';
import { DENSITY } from '../src/core/kinds/kit';
import { layoutSlide } from '../src/core/engine/layout';
import { getTheme } from '../src/core/engine/themes';

registerCoreKinds();

const TODAY = new Date('2026-10-19T10:00:00');
const seed = buildSeed(TODAY);
const KINDS = new Set(allKinds().map((k) => k.kind));
const GENERAL_DECKS = seed.decks.filter((d) => !d.lessonId);

function words(value: unknown, key = ''): number {
  if (key === 'image') return 0;
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean).length;
  if (Array.isArray(value)) return value.reduce<number>((n, v) => n + words(v), 0);
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((n, [k, v]) => n + words(v, k), 0);
  }
  return 0;
}

const MINUTE_RANGE = { young: [17, 24], teen: [35, 50], adult: [35, 50] } as const;
// Talks and reports are not tied to a class period.
const GENERAL_MINUTES = [15, 40] as const;
const SCRIPT_WORDS = { young: [30, 110], teen: [55, 145], adult: [55, 145] } as const;

describe('seed data', () => {
  it('links lessons, courses and decks consistently', () => {
    const courseIds = new Set(seed.courses.map((c) => c.id));
    const deckById = new Map(seed.decks.map((d) => [d.id, d]));
    for (const lesson of seed.lessons) {
      expect(courseIds.has(lesson.courseId), lesson.id).toBe(true);
      expect(lesson.summary.trim().length, lesson.id).toBeGreaterThan(20);
      if (lesson.deckId) {
        const d = deckById.get(lesson.deckId);
        expect(d, lesson.id).toBeDefined();
        expect(d?.lessonId).toBe(lesson.id);
      }
    }
    for (const d of seed.decks) {
      if (!d.lessonId) continue;
      const lesson = seed.lessons.find((l) => l.id === d.lessonId);
      expect(lesson?.deckId).toBe(d.id);
    }
    const linked = new Set(seed.lessons.map((l) => l.deckId).filter(Boolean));
    for (const d of GENERAL_DECKS) expect(linked.has(d.id), d.id).toBe(false);
    expect(new Set(seed.lessons.map((l) => l.id)).size).toBe(seed.lessons.length);
    expect(new Set(seed.decks.flatMap((d) => d.slides.map((s) => s.id))).size)
      .toBe(seed.decks.reduce((n, d) => n + d.slides.length, 0));
  });

  it('starts courses on a Monday with today in the expected week', () => {
    const [y, m, d] = seed.courses[0]!.startDate.split('-').map(Number) as [number, number, number];
    expect(new Date(y, m - 1, d).getDay()).toBe(1);
    expect(seed.courses[0]!.startDate).toBe('2026-10-05');
    expect(seed.courses[1]!.startDate).toBe('2026-10-05');
    for (const c of seed.courses) {
      const [cy, cm, cd] = c.startDate.split('-').map(Number) as [number, number, number];
      expect(new Date(cy, cm - 1, cd).getDay(), c.id).toBe(1);
      expect(c.createdAt).toBeLessThanOrEqual(TODAY.getTime());
    }
  });

  it('has past, today-or-tomorrow and upcoming lessons', () => {
    const iso = '2026-10-19';
    const dates = seed.lessons.map((l) => l.date ?? '');
    expect(dates.some((x) => x < iso)).toBe(true);
    expect(dates.some((x) => x === iso || x === '2026-10-20')).toBe(true);
    expect(dates.some((x) => x > '2026-10-20')).toBe(true);
    const wc = seed.lessons.find((l) => l.id === 'lesson_earth_w3_1');
    expect((wc?.date ?? '') >= iso).toBe(true);
  });

  for (const deck of seed.decks) {
    describe(deck.title, () => {
      it('uses registered kinds and complete key notes', () => {
        const [lo, hi] = SCRIPT_WORDS[deck.audience];
        for (const s of deck.slides) {
          expect(KINDS.has(s.kind), `${s.id} kind`).toBe(true);
          expect(s.notes.script.trim().length, `${s.id} script`).toBeGreaterThan(0);
          expect(s.notes.minutes, `${s.id} minutes`).toBeGreaterThanOrEqual(0.5);
          expect(s.notes.minutes, `${s.id} minutes`).toBeLessThanOrEqual(6);
          expect(s.notes.cues.length, `${s.id} cues`).toBeLessThanOrEqual(3);
          expect(s.notes.keyPoints.length, `${s.id} keyPoints`).toBeLessThanOrEqual(4);
          expect(s.notes.links).toEqual([]);
          if (!['title', 'section'].includes(s.kind)) {
            expect(s.notes.keyPoints.length, `${s.id} keyPoints`).toBeGreaterThanOrEqual(s.kind === 'closing' ? 0 : 1);
            const n = words(s.notes.script);
            expect(n, `${s.id} script words (${n})`).toBeGreaterThanOrEqual(s.kind === 'closing' ? 30 : lo);
            expect(n, `${s.id} script words (${n})`).toBeLessThanOrEqual(hi);
          }
        }
      });

      it('has correct question indexes', () => {
        for (const s of deck.slides.filter((x) => x.kind === 'question')) {
          const options = s.content.options as string[];
          const correct = s.content.correct as number;
          if (options.length) {
            expect(correct, s.id).toBeGreaterThanOrEqual(0);
            expect(correct, s.id).toBeLessThan(options.length);
          } else {
            expect(correct, s.id).toBe(-1);
          }
          expect(String(s.content.answer ?? '').length, s.id).toBeGreaterThan(0);
        }
      });

      it('stays within the audience word budget', () => {
        const budget = DENSITY[deck.audience].words;
        for (const s of deck.slides.filter((x) => x.kind !== 'title')) {
          const n = words(s.content);
          expect(n, `${s.id} has ${n} words`).toBeLessThanOrEqual(budget);
        }
      });

      it('has realistic timing', () => {
        const total = deck.slides.reduce((sum, s) => sum + s.notes.minutes, 0);
        const [lo, hi] = deck.lessonId ? MINUTE_RANGE[deck.audience] : GENERAL_MINUTES;
        expect(total, `${deck.title}: ${total} min`).toBeGreaterThanOrEqual(lo);
        expect(total).toBeLessThanOrEqual(hi);
        expect(deck.minutes).toBe(Math.round(total));
      });

      it('lays out without overflow', () => {
        const theme = getTheme(deck.themeId);
        expect(theme.id).toBe(deck.themeId);
        const hard: string[] = [];
        const soft: string[] = [];
        deck.slides.forEach((slide, i) => {
          const layout = layoutSlide(slide, {
            theme, audience: deck.audience, mode: 'show',
            slideNumber: i + 1, slideCount: deck.slides.length, deckTitle: deck.title,
          });
          for (const w of layout.warnings) {
            const line = `${slide.id}: ${w}`;
            // The quote kind's decorative opening mark is always flagged by the estimator; not a content problem.
            if (w === 'Text is too long to fit: ““”') continue;
            (/too long to fit|too long for one slide/.test(w) ? hard : soft).push(line);
          }
        });
        if (soft.length) console.warn(`[${deck.id}] other layout warnings:\n  ${soft.join('\n  ')}`);
        expect(hard).toEqual([]);
      });
    });
  }

  it('includes general decks that are not classroom lessons', () => {
    expect(GENERAL_DECKS.map((d) => deckPurpose(d)).sort()).toEqual(['report', 'talk']);
    expect(new Set(GENERAL_DECKS.map((d) => d.themeId)).size).toBe(GENERAL_DECKS.length);
    const newest = Math.max(...seed.decks.map((d) => d.updatedAt));
    for (const d of GENERAL_DECKS) {
      expect(d.audience).toBe('adult');
      expect(d.updatedAt, d.id).toBeGreaterThan(newest - 3_600_000);
      expect(d.updatedAt).toBeLessThanOrEqual(TODAY.getTime());
    }
    const used = new Set(GENERAL_DECKS.flatMap((d) => d.slides.map((s) => s.kind)));
    for (const k of ['chart', 'table', 'timeline', 'statement', 'people', 'diagram', 'code']) {
      expect(used.has(k), k).toBe(true);
    }
  });

  it('shapes the decks as designed', () => {
    const byId = Object.fromEntries(seed.decks.map((d) => [d.id, d]));
    const wc = byId.deck_water_cycle!;
    expect(wc.slides.length).toBeGreaterThanOrEqual(12);
    expect(wc.slides.length).toBeLessThanOrEqual(14);
    const kinds = new Set(wc.slides.map((s) => s.kind));
    for (const k of ['title', 'agenda', 'section', 'term', 'steps', 'image', 'stats', 'compare', 'question', 'recall', 'quote', 'summary', 'closing']) {
      expect(kinds.has(k), k).toBe(true);
    }
    expect(wc.slides.filter((s) => s.kind === 'term').length).toBeGreaterThanOrEqual(2);
    expect(wc.slides.find((s) => s.kind === 'steps')?.content.reveal).toBe(true);
    expect(wc.slides.find((s) => s.kind === 'image')?.content.image).toBe('/samples/water-cycle.svg');
    expect(byId.deck_weather_climate!.slides.length).toBeGreaterThanOrEqual(10);
    expect(byId.deck_weather_climate!.slides.length).toBeLessThanOrEqual(12);
    expect(byId.deck_main_thing_first!.slides.length).toBeGreaterThanOrEqual(9);
    expect(byId.deck_main_thing_first!.slides.length).toBeLessThanOrEqual(11);
    const ah = byId.deck_animal_homes!;
    expect(ah.slides.length).toBeGreaterThanOrEqual(8);
    expect(ah.slides.length).toBeLessThanOrEqual(10);
    expect(ah.slides.find((s) => s.kind === 'recall')?.content.cards).toHaveLength(3);
    expect(ah.slides.filter((s) => s.kind === 'question').at(-1)?.content.options).toHaveLength(3);
  });

  it('ships its sample illustrations', () => {
    for (const name of ['water-cycle', 'burrow', 'nest']) {
      const file = resolve(__dirname, '..', 'public', 'samples', `${name}.svg`);
      expect(statSync(file).size, name).toBeLessThan(12 * 1024);
      const svg = readFileSync(file, 'utf8');
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('viewBox="0 0 1600 1200"');
      expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    }
  });
});
