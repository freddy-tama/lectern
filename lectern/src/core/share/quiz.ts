// Live quizzes. Every question slide with a marked correct choice becomes a scored
// question while a deck is shared: it opens when its slide comes up, locks when
// the timer runs out, and is scored when the presenter reveals the answer.
// Framework-free and clock-injected, so it can be tested without phones.

import type { Slide } from '../deck/types';
import { pollChoices } from './protocol';

export interface QuizSettings {
  /** Score question slides that have a correct choice. */
  on: boolean;
  /** Seconds to answer; 0 means no timer. */
  seconds: number;
}

export const DEFAULT_QUIZ: QuizSettings = { on: true, seconds: 20 };

/** What the big screen and phones show between questions. */
export type QuizStage = 'play' | 'leaderboard' | 'podium';
export const QUIZ_SECONDS = [0, 10, 20, 30, 60];

/** Without a timer, speed still counts within this window. */
const SPEED_WINDOW = 30_000;
/** Answers that arrive just after the timer, sent before it ran out, still count. */
const GRACE = 800;

export interface QuizItem {
  slideId: string;
  question: string;
  choices: string[];
  correct: number;
}

export type Phase = 'open' | 'closed' | 'revealed';

export interface QuestionView {
  slideId: string;
  /** 1-based position among the deck's scored questions. */
  number: number;
  of: number;
  phase: Phase;
  /** Milliseconds left to answer, when a timer is running. */
  closesIn: number | null;
  /** Total seconds for this question, for drawing the timer. */
  seconds: number;
  answered: number;
  players: number;
  /** Only after the reveal (or for the presenter). */
  correct?: number;
  counts?: number[];
}

export interface BoardRow {
  id: string;
  name: string;
  score: number;
  correct: number;
  rank: number;
}

export interface QuizView {
  on: boolean;
  seconds: number;
  question: QuestionView | null;
  /** Top of the leaderboard. */
  board: BoardRow[];
  players: number;
  questions: number;
  /** Questions revealed so far. */
  done: number;
}

export interface PlayerView {
  score: number;
  rank: number;
  of: number;
  correct: number;
  answered: number;
  /** The latest revealed question, from this player's side. */
  last?: { slideId: string; choice: number | null; correct: boolean; points: number; answer: number };
}

interface Answer { choice: number; at: number }
interface Round { slideId: string; openedAt: number; closesAt: number | null; phase: Phase; answers: Map<string, Answer> }

/** A question slide that can be scored, or null. */
export function quizItem(slide: Pick<Slide, 'id' | 'kind' | 'content'> | undefined): QuizItem | null {
  const choices = pollChoices(slide);
  if (!slide || !choices) return null;
  const correct = Number((slide.content as { correct?: unknown }).correct);
  if (!Number.isInteger(correct) || correct < 0 || correct >= choices.length) return null;
  const question = String((slide.content as { question?: unknown }).question ?? '').trim();
  return { slideId: slide.id, question, choices, correct };
}

/** 500 for a right answer, plus up to 500 more for answering fast. */
export function points(elapsed: number, windowMs: number): number {
  const share = Math.max(0, Math.min(1, 1 - elapsed / Math.max(1, windowMs)));
  return Math.round(500 + 500 * share);
}

/** Sorts by score and gives tied players the same rank (1, 2, 2, 4). */
export function rankRows<T extends { score: number; name: string }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || r.score !== sorted[i - 1]!.score) rank = i + 1;
    return { ...r, rank };
  });
}

export class QuizEngine {
  settings: QuizSettings;
  private items: QuizItem[] = [];
  private rounds = new Map<string, Round>();
  private players = new Map<string, string>();
  private current: string | null = null;

  constructor(settings: QuizSettings = DEFAULT_QUIZ) {
    this.settings = { ...settings };
  }

  /** The deck's visible slides; call again after edits. */
  setSlides(slides: Slide[]) {
    this.items = slides.map(quizItem).filter((q): q is QuizItem => !!q);
  }

  get questions(): QuizItem[] {
    return this.items;
  }

  join(id: string, name?: string) {
    const clean = (name ?? '').trim().slice(0, 24);
    const existing = this.players.get(id);
    this.players.set(id, clean || existing || `Player ${this.players.size + 1}`);
  }

  playerName(id: string) {
    return this.players.get(id);
  }

  /**
   * Follows the show. A scored question opens when its slide comes up and is
   * revealed on the presenter's next click. Returns true when something changed.
   */
  follow(slide: Slide | undefined, step: number, now: number): boolean {
    if (!this.settings.on) return false;
    let changed = false;
    const item = quizItem(slide);
    const id = item?.slideId ?? null;
    // Leaving a question locks it.
    if (this.current && this.current !== id) {
      const left = this.rounds.get(this.current);
      if (left?.phase === 'open') { left.phase = 'closed'; changed = true; }
    }
    if (this.current !== id) { this.current = id; changed = true; }
    if (!item) return changed;
    let round = this.rounds.get(item.slideId);
    if (!round) {
      round = { slideId: item.slideId, openedAt: now, closesAt: this.settings.seconds ? now + this.settings.seconds * 1000 : null, phase: 'open', answers: new Map() };
      this.rounds.set(item.slideId, round);
      changed = true;
    }
    if (step >= 1 && round.phase !== 'revealed') { round.phase = 'revealed'; changed = true; }
    return changed;
  }

  /** Locks questions whose time ran out. */
  tick(now: number): boolean {
    let changed = false;
    for (const r of this.rounds.values()) {
      if (r.phase === 'open' && r.closesAt !== null && now > r.closesAt + GRACE) { r.phase = 'closed'; changed = true; }
    }
    return changed;
  }

  /** When the next timer runs out, if one is running. */
  nextDeadline(): number | null {
    let next: number | null = null;
    for (const r of this.rounds.values()) {
      if (r.phase === 'open' && r.closesAt !== null) next = next === null ? r.closesAt : Math.min(next, r.closesAt);
    }
    return next === null ? null : next + GRACE + 50;
  }

  /** One answer per player per question, while it is open. */
  answer(playerId: string, slideId: string, choice: number, now: number): boolean {
    const round = this.rounds.get(slideId);
    const item = this.items.find((q) => q.slideId === slideId);
    if (!round || !item || round.phase !== 'open' || round.answers.has(playerId)) return false;
    if (round.closesAt !== null && now > round.closesAt + GRACE) return false;
    if (!Number.isInteger(choice) || choice < 0 || choice >= item.choices.length) return false;
    if (!this.players.has(playerId)) this.join(playerId);
    round.answers.set(playerId, { choice, at: now });
    return true;
  }

  /** Clears one question so it can be asked again. */
  resetQuestion(slideId: string) {
    this.rounds.delete(slideId);
    if (this.current === slideId) this.current = null;
  }

  /** Clears every answer and score; players stay. */
  reset() {
    this.rounds.clear();
    this.current = null;
  }

  isQuizSlide(slideId: string) {
    return this.settings.on && this.items.some((q) => q.slideId === slideId);
  }

  private pointsFor(round: Round, a: Answer | undefined, item: QuizItem): number {
    if (!a || a.choice !== item.correct) return 0;
    const window = round.closesAt !== null ? round.closesAt - round.openedAt : SPEED_WINDOW;
    return points(a.at - round.openedAt, window);
  }

  /** Every player's totals, ranked. Only revealed questions count. */
  board(): BoardRow[] {
    const rows = [...this.players].map(([id, name]) => {
      let score = 0;
      let correct = 0;
      for (const item of this.items) {
        const round = this.rounds.get(item.slideId);
        if (round?.phase !== 'revealed') continue;
        const p = this.pointsFor(round, round.answers.get(id), item);
        score += p;
        if (p > 0) correct += 1;
      }
      return { id, name, score, correct };
    });
    return rankRows(rows);
  }

  view(role: 'presenter' | 'audience', now: number, top = 5): QuizView {
    const revealed = this.items.filter((q) => this.rounds.get(q.slideId)?.phase === 'revealed').length;
    const item = this.current ? this.items.find((q) => q.slideId === this.current) : undefined;
    const round = item ? this.rounds.get(item.slideId) : undefined;
    let question: QuestionView | null = null;
    if (item && round && this.settings.on) {
      const showAnswers = role === 'presenter' || round.phase === 'revealed';
      const counts = item.choices.map(() => 0);
      for (const a of round.answers.values()) counts[a.choice] = (counts[a.choice] ?? 0) + 1;
      question = {
        slideId: item.slideId,
        number: this.items.indexOf(item) + 1,
        of: this.items.length,
        phase: round.phase,
        closesIn: round.phase === 'open' && round.closesAt !== null ? Math.max(0, round.closesAt - now) : null,
        seconds: round.closesAt !== null ? Math.round((round.closesAt - round.openedAt) / 1000) : 0,
        answered: round.answers.size,
        players: this.players.size,
        ...(showAnswers ? { counts } : {}),
        ...(round.phase === 'revealed' ? { correct: item.correct } : {}),
      };
    }
    return {
      on: this.settings.on,
      seconds: this.settings.seconds,
      question,
      board: this.board().slice(0, top),
      players: this.players.size,
      questions: this.items.length,
      done: revealed,
    };
  }

  playerView(id: string): PlayerView {
    const board = this.board();
    const row = board.find((r) => r.id === id);
    let answered = 0;
    let last: PlayerView['last'];
    for (const item of this.items) {
      const round = this.rounds.get(item.slideId);
      const a = round?.answers.get(id);
      if (a) answered += 1;
      if (round?.phase === 'revealed') {
        const pts = this.pointsFor(round, a, item);
        last = { slideId: item.slideId, choice: a?.choice ?? null, correct: pts > 0, points: pts, answer: item.correct };
      }
    }
    // "Latest" means the question being shown, when it has been revealed.
    if (this.current) {
      const item = this.items.find((q) => q.slideId === this.current);
      const round = item && this.rounds.get(item.slideId);
      if (item && round?.phase === 'revealed') {
        const a = round.answers.get(id);
        const pts = this.pointsFor(round, a, item);
        last = { slideId: item.slideId, choice: a?.choice ?? null, correct: pts > 0, points: pts, answer: item.correct };
      }
    }
    return { score: row?.score ?? 0, rank: row?.rank ?? board.length + 1, of: board.length, correct: row?.correct ?? 0, answered, last };
  }

  /** Everything needed for a results file or note. */
  results(): QuizResults {
    const board = this.board();
    const questions = this.items.map((item) => {
      const round = this.rounds.get(item.slideId);
      const answers = round ? [...round.answers.values()] : [];
      const right = answers.filter((a) => a.choice === item.correct).length;
      return {
        ...item,
        asked: !!round,
        revealed: round?.phase === 'revealed',
        answered: answers.length,
        right,
        choicesBy: Object.fromEntries([...(round?.answers ?? new Map<string, Answer>())].map(([pid, a]) => [pid, a.choice])) as Record<string, number>,
        pointsBy: Object.fromEntries(board.map((p) => [p.id, round?.phase === 'revealed' ? this.pointsFor(round, round.answers.get(p.id), item) : 0])) as Record<string, number>,
      };
    });
    return { board, questions };
  }
}

export interface QuizResults {
  board: BoardRow[];
  questions: (QuizItem & { asked: boolean; revealed: boolean; answered: number; right: number; choicesBy: Record<string, number>; pointsBy: Record<string, number> })[];
}

const LETTER = (i: number) => String.fromCharCode(65 + i);

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A spreadsheet of results: one row per player, one column per asked question. */
export function resultsCsv(r: QuizResults): string {
  const asked = r.questions.filter((q) => q.asked);
  const head = ['Rank', 'Name', 'Score', 'Correct', ...asked.map((q, i) => `Q${i + 1} ${q.question}`.slice(0, 60))];
  const rows = r.board.map((p) => [
    p.rank, p.name, p.score, `${p.correct}/${asked.filter((q) => q.revealed).length}`,
    ...asked.map((q) => {
      const c = q.choicesBy[p.id];
      if (c === undefined) return '';
      return `${LETTER(c)}${q.revealed ? (c === q.correct ? ' ✓' : ' ✗') : ''}`;
    }),
  ]);
  return [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** A note body: who did best, how each question went, and what to revisit. */
export function resultsNote(r: QuizResults): string {
  const asked = r.questions.filter((q) => q.revealed);
  const pct = (q: (typeof asked)[number]) => (q.answered ? Math.round((q.right / q.answered) * 100) : 0);
  const avg = asked.length ? Math.round(asked.reduce((n, q) => n + pct(q), 0) / asked.length) : 0;
  const lines: string[] = [];
  lines.push(`**${r.board.length} ${r.board.length === 1 ? 'player' : 'players'} · ${asked.length} ${asked.length === 1 ? 'question' : 'questions'} · ${avg}% right on average**`, '');
  if (r.board.length) {
    lines.push('## Leaderboard');
    r.board.slice(0, 10).forEach((p) => lines.push(`${p.rank}. ${p.name}: ${p.score.toLocaleString('en-US')} (${p.correct}/${asked.length})`));
    lines.push('');
  }
  if (asked.length) {
    lines.push('## Questions');
    asked.forEach((q, i) => lines.push(`${i + 1}. ${q.question || 'Question'}: ${pct(q)}% right (${q.answered} answered)`));
    lines.push('');
  }
  const weak = asked.filter((q) => q.answered > 0 && pct(q) < 50);
  if (weak.length) {
    lines.push('## Follow up');
    weak.forEach((q) => lines.push(`- [ ] Go over "${q.question || 'this question'}" again (${pct(q)}% right; the answer is ${LETTER(q.correct)}: ${q.choices[q.correct]})`));
  }
  return lines.join('\n').trim();
}
