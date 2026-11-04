// Questions answered with pictures, and a picture to guess from behind tiles.
import { describe, expect, it } from 'vitest';
import { type Slide, emptyNotes } from '../src/core/deck/types';
import { CANVAS_H, CANVAS_W } from '../src/core/engine/boxes';
import { layoutSlide } from '../src/core/engine/layout';
import { THEMES, getTheme } from '../src/core/engine/themes';
import { pollChoices } from '../src/core/share/protocol';
import { quizItem } from '../src/core/share/quiz';

const PIC = 'data:image/png;base64,iVBORw0KGgo=';
const slide = (content: Record<string, unknown>): Slide => ({ id: 'q', kind: 'question', content, notes: emptyNotes({}) });
const lay = (content: Record<string, unknown>, theme = 'paper', audience: 'young' | 'teen' | 'adult' = 'young') =>
  layoutSlide(slide(content), { theme: getTheme(theme), audience, mode: 'edit', slideCount: 3, slideNumber: 2 });
const inside = (layout: ReturnType<typeof lay>) => layout.boxes.filter((b) => !b.id.startsWith('deco')).every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= CANVAS_W + 0.5 && b.y + b.h <= CANVAS_H + 0.5);

const animals = {
  question: 'Which one is a horse?', options: ['cow', 'horse', 'goat', ''], correct: 1, answer: '',
  pictures: [{ image: PIC }, { image: PIC }, { image: PIC }, { image: PIC }],
};

describe('picture choices', () => {
  it('shows a picture per choice, lettered, with the right one ringed on click', () => {
    for (const theme of THEMES) for (const audience of ['young', 'teen', 'adult'] as const) {
      const layout = lay(animals, theme.id, audience);
      expect(layout.warnings, `${theme.id} ${audience}`).toEqual([]);
      expect(inside(layout), `${theme.id} ${audience}`).toBe(true);
      expect(layout.boxes.filter((b) => b.type === 'image' && /^opt-\d-picture$/.test(b.id))).toHaveLength(4);
    }
    const layout = lay(animals);
    expect(layout.boxes.find((b) => b.id === 'opt-1-ring')).toMatchObject({ step: 1, reveal: 'answer' });
    expect(layout.boxes.find((b) => b.id === 'opt-1-picture')).toMatchObject({ bind: 'pictures.1.image' });
    // The fourth choice is only a picture: no words under it.
    expect(layout.boxes.some((b) => b.id === 'opt-3-text')).toBe(false);
    expect(layout.boxes.find((b) => b.id === 'opt-3-letter')).toMatchObject({ text: 'D' });
  });

  it('names a picture-only choice by its letter on phones', () => {
    expect(pollChoices(slide(animals))).toEqual(['cow', 'horse', 'goat', 'Picture D']);
    expect(quizItem(slide(animals))).toMatchObject({ correct: 1, choices: ['cow', 'horse', 'goat', 'Picture D'] });
    expect(pollChoices(slide({ question: 'Q', options: ['a', 'b'] }))).toEqual(['a', 'b']);
  });

  it('leaves the picture to look at out when the choices are pictures, and says so', () => {
    const layout = lay({ ...animals, image: PIC });
    expect(layout.boxes.some((b) => b.id === 'image')).toBe(false);
    expect(layout.warnings.join(' ')).toMatch(/picture to look at isn’t shown/);
  });
});

describe('a picture to look at', () => {
  const look = { question: 'What is this animal?', options: [], answer: 'A horse.', image: PIC };

  it('puts the picture beside the question, with words choices kept to the left', () => {
    const layout = lay({ ...look, options: ['a horse', 'a cow'], correct: 0 }, 'campus', 'teen');
    expect(layout.warnings).toEqual([]);
    expect(inside(layout)).toBe(true);
    const pic = layout.boxes.find((b) => b.id === 'image')!;
    const question = layout.boxes.find((b) => b.id === 'question')!;
    expect(pic.x).toBeGreaterThan(question.x + question.w);
    expect(layout.boxes.find((b) => b.id === 'opt-0')!.x + layout.boxes.find((b) => b.id === 'opt-0')!.w).toBeLessThan(pic.x);
    expect(pic.step).toBeUndefined();
  });

  it('hides the picture behind tiles for a guessing game, and shows it whole with the answer', () => {
    const layout = lay({ ...look, guess: true });
    expect(layout.warnings).toEqual([]);
    expect(layout.boxes.filter((b) => /^tile-\d$/.test(b.id))).toHaveLength(7);
    const peek = layout.boxes.findIndex((b) => b.id === 'image-peek');
    const whole = layout.boxes.findIndex((b) => b.id === 'image');
    expect(peek).toBeGreaterThanOrEqual(0);
    expect(whole).toBeGreaterThan(layout.boxes.findIndex((b) => b.id === 'tile-8'));
    expect(layout.boxes[whole]!.step).toBe(1);
    expect(layout.boxes.find((b) => b.id === 'answer')!.step).toBe(1);
    expect(layout.steps).toBe(1);
  });
});
