// Builds a multiple-choice quiz from a deck's own material, with no AI: each
// slide's check question and each key term becomes a question, and similar
// answers elsewhere in the deck become the wrong choices.

import { makeSlide } from './draft';
import type { Deck, Slide } from './types';

interface Candidate {
  from: string;
  question: string;
  answer: string;
  /** Questions only borrow wrong choices from the same group. */
  group: 'check' | 'term';
}

const MAX_ANSWER = 90;

function clean(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** A small, stable hash so the same deck always gets the same quiz. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function quizCandidates(slides: Slide[]): Candidate[] {
  const found: Candidate[] = [];
  for (const s of slides) {
    if (s.hidden) continue;
    const check = s.notes.check;
    if (check && clean(check.question) && clean(check.answer) && clean(check.answer).length <= MAX_ANSWER) {
      found.push({ from: s.id, question: clean(check.question), answer: clean(check.answer), group: 'check' });
    }
    if (s.kind === 'term') {
      const term = clean((s.content as { term?: unknown }).term);
      const definition = clean((s.content as { definition?: unknown }).definition);
      if (term && definition) {
        // Short definitions make good answers; long ones make good questions.
        if (definition.length <= MAX_ANSWER) found.push({ from: s.id, question: `What does “${term}” mean?`, answer: definition, group: 'term' });
        else found.push({ from: s.id, question: `Which term means: “${definition.slice(0, 140)}${definition.length > 140 ? '…' : ''}”`, answer: term, group: 'term' });
      }
    }
  }
  // One question per distinct answer.
  const seen = new Set<string>();
  return found.filter((c) => {
    const key = c.answer.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const hasDigit = (s: string) => /\d/.test(s);

/**
 * Whether one answer can stand as a wrong choice for another question: from the same group,
 * with numbers only where the right answer has one, and of a similar length, so the right
 * answer doesn't stand out and no choice is plainly about something else.
 */
function alike(wrong: Candidate, right: Candidate): boolean {
  if (wrong.group !== right.group || hasDigit(wrong.answer) !== hasDigit(right.answer)) return false;
  const ratio = wrong.answer.length / right.answer.length;
  return ratio >= 0.4 && ratio <= 2.5;
}

/**
 * Question slides (four choices where the deck has enough material, at least
 * three otherwise), plus a section slide to open the quiz. Empty when the deck
 * has too little to ask about.
 */
export function makeQuiz(deck: Pick<Deck, 'id' | 'slides'>, max = 8): Slide[] {
  const all = quizCandidates(deck.slides);
  const questions: Slide[] = [];
  for (const c of all) {
    if (questions.length >= max) break;
    const pool = all
      .filter((o) => o !== c && alike(o, c))
      .map((o) => o.answer)
      .filter((a) => a.toLowerCase() !== c.answer.toLowerCase());
    const wrong = shuffled([...new Set(pool)], hash(c.from + c.answer)).slice(0, 3);
    if (wrong.length < 2) continue;
    const choices = shuffled([c.answer, ...wrong], hash(c.question));
    const correct = choices.indexOf(c.answer);
    questions.push(makeSlide('question', { question: c.question, options: choices, correct, answer: c.answer }, {
      script: 'Give everyone time to answer on their phones, then reveal the answer.',
      cues: ['Wait for answers'],
      minutes: 1,
    }));
  }
  if (!questions.length) return [];
  const opener = makeSlide('section', { number: '', title: 'Quiz time', subtitle: 'Answer on your phone' }, { script: 'Phones out: scan the code to join the quiz.', minutes: 0.5 });
  return [opener, ...questions];
}
