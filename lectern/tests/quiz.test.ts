// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { makeSlide } from '../src/core/deck/draft';
import { makeQuiz, quizCandidates } from '../src/core/deck/quiz-maker';
import type { Slide } from '../src/core/deck/types';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { encodePack, fitsQr, packUrl } from '../src/core/share/pack';
import { QuizEngine, points, quizItem, rankRows, resultsCsv, resultsNote } from '../src/core/share/quiz';
import { buildSeed } from '../src/data/seed';
import { quizPackFor } from '../src/features/share/offline';

registerCoreKinds();

const q = (id: string, correct: number | undefined, options = ['Red', 'Green', 'Blue']): Slide =>
  ({ ...makeSlide('question', { question: `Question ${id}?`, options, ...(correct === undefined ? { correct: -1 } : { correct }) }), id });
const plain = (id: string): Slide => ({ ...makeSlide('bullets'), id });

describe('quiz questions', () => {
  it('scores only question slides with a correct choice', () => {
    expect(quizItem(q('a', 1))?.choices).toEqual(['Red', 'Green', 'Blue']);
    expect(quizItem(q('b', undefined))).toBeNull();
    expect(quizItem(q('c', 5))).toBeNull();
    expect(quizItem(plain('d'))).toBeNull();
  });

  it('gives 500 to 1000 points, more for fast answers', () => {
    expect(points(0, 20_000)).toBe(1000);
    expect(points(10_000, 20_000)).toBe(750);
    expect(points(60_000, 20_000)).toBe(500);
  });

  it('ranks ties together', () => {
    expect(rankRows([{ name: 'B', score: 5 }, { name: 'A', score: 9 }, { name: 'C', score: 5 }, { name: 'D', score: 1 }]).map((r) => `${r.name}${r.rank}`))
      .toEqual(['A1', 'B2', 'C2', 'D4']);
  });
});

describe('a live quiz', () => {
  const slides = [plain('intro'), q('q1', 1), plain('mid'), q('q2', 0), q('poll', undefined)];

  function play() {
    const quiz = new QuizEngine({ on: true, seconds: 20 });
    quiz.setSlides(slides);
    quiz.join('ana', 'Ana');
    quiz.join('ben', 'Ben');
    quiz.join('cy');
    return quiz;
  }

  it('opens with the slide, locks on time, scores on reveal', () => {
    const quiz = play();
    const t0 = 1_000_000;
    expect(quiz.follow(slides[1], 0, t0)).toBe(true);
    expect(quiz.view('audience', t0).question).toMatchObject({ number: 1, of: 2, phase: 'open', closesIn: 20_000, players: 3 });
    expect(quiz.answer('ana', 'q1', 1, t0 + 2_000)).toBe(true);
    expect(quiz.answer('ana', 'q1', 0, t0 + 3_000)).toBe(false); // one answer each
    expect(quiz.answer('ben', 'q1', 2, t0 + 5_000)).toBe(true);
    // Viewers don't see counts or the answer before the reveal; the presenter does.
    expect(quiz.view('audience', t0 + 5_000).question?.counts).toBeUndefined();
    expect(quiz.view('presenter', t0 + 5_000).question?.counts).toEqual([0, 1, 1]);
    expect(quiz.board().every((r) => r.score === 0)).toBe(true);
    // Time runs out.
    expect(quiz.tick(t0 + 21_000)).toBe(true);
    expect(quiz.answer('cy', 'q1', 1, t0 + 21_500)).toBe(false);
    // The presenter clicks to reveal.
    quiz.follow(slides[1], 1, t0 + 25_000);
    const view = quiz.view('audience', t0 + 25_000);
    expect(view.question).toMatchObject({ phase: 'revealed', correct: 1, counts: [0, 1, 1] });
    expect(view.board[0]).toMatchObject({ name: 'Ana', score: points(2_000, 20_000), rank: 1, correct: 1 });
    expect(quiz.playerView('ben')).toMatchObject({ score: 0, rank: 2, of: 3, last: { correct: false, choice: 2, answer: 1 } });
    expect(quiz.playerView('cy').last).toMatchObject({ choice: null, correct: false });
  });

  it('locks a question when the presenter moves on, and keeps scores across questions', () => {
    const quiz = play();
    quiz.follow(slides[1], 0, 0);
    quiz.answer('ana', 'q1', 1, 1_000);
    quiz.follow(slides[2], 0, 2_000);
    expect(quiz.answer('ben', 'q1', 1, 2_500)).toBe(false);
    quiz.follow(slides[1], 1, 3_000); // back, and reveal
    quiz.follow(slides[3], 0, 4_000);
    quiz.answer('ben', 'q2', 0, 5_500); // slower than Ana was
    quiz.answer('ana', 'q2', 1, 6_000); // wrong
    quiz.answer('cy', 'q2', 2, 6_500); // wrong: only a third got q2 right
    quiz.follow(slides[3], 1, 8_000);
    const board = quiz.board();
    expect(board.map((r) => r.name)).toEqual(['Ana', 'Ben', 'Player 3']);
    expect(quiz.view('audience', 8_000).done).toBe(2);
    const csv = resultsCsv(quiz.results());
    expect(csv.split('\r\n')[0]).toContain('Q1 Question q1?');
    expect(csv).toContain('1,Ana,');
    expect(csv).toContain('B ✓');
    const note = resultsNote(quiz.results());
    expect(note).toContain('3 players · 2 questions');
    expect(note).toContain('## Follow up');
  });

  it('treats unscored question slides as polls and does nothing when off', () => {
    const quiz = play();
    quiz.follow(slides[4], 0, 0);
    expect(quiz.view('audience', 0).question).toBeNull();
    quiz.settings.on = false;
    expect(quiz.follow(slides[1], 0, 0)).toBe(false);
    expect(quiz.isQuizSlide('q1')).toBe(false);
  });
});

describe('making a quiz from a deck', () => {
  it('turns check questions and key terms into four-choice questions', () => {
    const deck = buildSeed(new Date('2026-10-19T10:00:00')).decks.find((d) => d.id === 'deck_water_cycle')!;
    expect(quizCandidates(deck.slides).length).toBeGreaterThan(2);
    const slides = makeQuiz(deck);
    expect(slides[0]!.kind).toBe('section');
    const questions = slides.slice(1);
    expect(questions.length).toBeGreaterThan(1);
    for (const s of questions) {
      const item = quizItem(s);
      expect(item, JSON.stringify(s.content)).not.toBeNull();
      expect(item!.choices.length).toBeGreaterThanOrEqual(3);
      expect(new Set(item!.choices).size).toBe(item!.choices.length);
      expect(item!.choices[item!.correct]).toBe((s.content as { answer: string }).answer);
    }
    // Stable: the same deck makes the same quiz.
    expect(makeQuiz(deck).slice(1).map((s) => s.content)).toEqual(questions.map((s) => s.content));
  });

  it('returns nothing when there is too little to ask', () => {
    expect(makeQuiz({ id: 'x', slides: [plain('a')] })).toEqual([]);
  });

  const seed = buildSeed(new Date('2026-10-19T10:00:00'));
  const deckById = (id: string) => seed.decks.find((d) => d.id === id)!;
  const digit = (s: string) => /\d/.test(s);

  it('never mixes number answers with word answers', () => {
    for (const deck of seed.decks) {
      for (const s of makeQuiz(deck).slice(1)) {
        const { options, answer } = s.content as { options: string[]; answer: string };
        for (const o of options) expect(digit(o), `${deck.id}: ${o} for ${answer}`).toBe(digit(answer));
      }
    }
  });

  it('only borrows wrong choices that could pass for the answer', () => {
    const q3 = makeQuiz(deckById('deck_q3_update')).slice(1);
    expect(q3.length).toBeGreaterThanOrEqual(5);
    expect(q3.map((s) => (s.content as { question: string }).question)).toContain('How many users did we add in Q3?');
    for (const s of q3) {
      const { question, options } = s.content as { question: string; options: string[] };
      expect(options.length, question).toBeGreaterThanOrEqual(3);
      if (question === 'How many users did we add in Q3?') expect(options).not.toContain('High impact for relatively low effort.');
    }
    // A key term's meaning is never offered as the answer to a check question, or the other way round.
    const deck = { id: 'mixed', slides: [
      { ...makeSlide('bullets', {}, { check: { question: 'Which colour is the sky?', answer: 'Blue on a clear day.' } }), id: 'a' },
      { ...makeSlide('term', { term: 'Orbit', definition: 'The path one body takes around another.' }), id: 'b' },
      { ...makeSlide('term', { term: 'Phase', definition: 'The part of the lit half we can see.' }), id: 'c' },
    ] };
    expect(makeQuiz(deck)).toEqual([]);
  });

  it('has a quiz for every sample the landing page offers to try', () => {
    for (const id of ['deck_meetings_talk', 'deck_q3_update', 'deck_water_cycle', 'deck_main_thing_first']) {
      expect(quizPackFor(deckById(id))?.pack.items.length ?? 0, id).toBeGreaterThan(0);
    }
  });

  it("carries the sample talk's own three questions in a QR-sized link", async () => {
    const found = quizPackFor(deckById('deck_meetings_talk'));
    expect(found?.made).toBe(false);
    expect(found?.pack.items).toHaveLength(3);
    const url = packUrl('https://lectern-sooty.vercel.app', await encodePack(found!.pack));
    expect(fitsQr(url), `${url.length} characters`).toBe(true);
  });
});
