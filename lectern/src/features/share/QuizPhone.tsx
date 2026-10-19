// Quiz play on phones: a name, the answer buttons with a countdown, the result
// after the reveal, and standings. Plus the presenter phone's quiz controls.

import { Check, Crown, Medal, Timer, Trophy, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { QuestionView, QuizView } from '../../core/share/quiz';
import { type LinkSnapshot, liveLink } from './guest';

const LETTER = (i: number) => String.fromCharCode(65 + i);

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Seconds left on the current question, counting down locally. */
export function useCountdown(q: QuestionView | null | undefined, receivedAt: number): number | null {
  const [now, setNow] = useState(Date.now());
  const running = !!q && q.phase === 'open' && q.closesIn !== null;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [running]);
  if (!q || q.closesIn === null || q.phase !== 'open') return null;
  return Math.max(0, Math.ceil((q.closesIn - (now - receivedAt)) / 1000));
}

function TimerBar({ left, total }: { left: number; total: number }) {
  const pct = total ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  return (
    <div className={`quiz-timer ${left <= 5 ? 'is-low' : ''}`} role="timer" aria-label={`${left} seconds left`}>
      <Timer size={15} aria-hidden />
      <span className="quiz-timer-bar"><span style={{ width: `${pct}%` }} /></span>
      <span className="tabular">{left}s</span>
    </div>
  );
}

/** Asks for a name once, so the leaderboard can show it. */
export function NameCard({ onDone }: { onDone(): void }) {
  const [value, setValue] = useState('');
  return (
    <form className="phone-card quiz-name" onSubmit={(e) => { e.preventDefault(); if (value.trim()) { liveLink.setName(value); onDone(); } }}>
      <p className="eyebrow">There’s a quiz</p>
      <label htmlFor="quiz-name">Your name for the leaderboard</label>
      <div className="quiz-name-row">
        <input id="quiz-name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={24} placeholder="First name or nickname" autoComplete="nickname" enterKeyHint="done" />
        <button type="submit" className="btn btn-brand" disabled={!value.trim()}>Play</button>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>Skip</button>
    </form>
  );
}

/** The current question on a viewer's phone. */
export function QuizCard({ link, choices }: { link: LinkSnapshot; choices: string[] }) {
  const q = link.quiz?.question;
  const left = useCountdown(q, link.quizAt);
  if (!q) return null;
  const mine = link.myAnswers[q.slideId];
  const you = link.you;
  const last = you?.last?.slideId === q.slideId ? you.last : undefined;

  if (q.phase === 'revealed') {
    const right = mine !== undefined && mine === q.correct;
    return (
      <section className={`phone-card quiz-card quiz-result ${right ? 'is-right' : 'is-wrong'}`} aria-live="polite">
        <div className="quiz-result-head">
          <span className="quiz-result-icon">{right ? <Check size={22} /> : <X size={22} />}</span>
          <div>
            <strong>{right ? 'Correct!' : mine === undefined ? 'No answer this time' : 'Not this time'}</strong>
            <span>{right ? `+${(last?.points ?? 0).toLocaleString()} points` : `The answer was ${LETTER(q.correct ?? 0)}: ${choices[q.correct ?? 0] ?? ''}`}</span>
          </div>
        </div>
        {you && you.of > 0 && (
          <p className="quiz-standing">You’re <strong>{ordinal(you.rank)}</strong> of {you.of} · <span className="tabular">{you.score.toLocaleString()}</span> points</p>
        )}
      </section>
    );
  }

  if (mine !== undefined || q.phase === 'closed') {
    return (
      <section className="phone-card quiz-card quiz-wait" aria-live="polite">
        <p className="eyebrow">Question {q.number} of {q.of}</p>
        {mine !== undefined
          ? <p className="quiz-locked"><span className="quiz-letter">{LETTER(mine)}</span> Locked in. Waiting for the answer…</p>
          : <p className="quiz-locked">Time’s up. Waiting for the answer…</p>}
        <p className="faint">{q.answered} of {q.players} answered</p>
      </section>
    );
  }

  return (
    <section className="phone-card quiz-card" aria-label={`Question ${q.number} of ${q.of}`}>
      <div className="quiz-card-head">
        <p className="eyebrow">Question {q.number} of {q.of}</p>
        {left !== null && <TimerBar left={left} total={q.seconds} />}
      </div>
      <div className="quiz-choices">
        {choices.map((c, i) => (
          <button key={i} type="button" className={`quiz-choice c${i}`} onClick={() => liveLink.answer(q.slideId, i)}>
            <b>{LETTER(i)}</b><span>{c}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Leaderboard or final results, when the presenter shows them. */
export function QuizStandings({ link }: { link: LinkSnapshot }) {
  const quiz = link.quiz;
  const you = link.you;
  if (!quiz || link.stage === 'play') return null;
  const final = link.stage === 'podium';
  const top = you && you.rank <= 3 && you.score > 0;
  return (
    <section className={`phone-card quiz-standings ${final ? 'is-final' : ''}`} aria-live="polite">
      {final && you && (
        <div className="quiz-final">
          <span className="quiz-final-icon">{top ? <Trophy size={28} /> : <Medal size={28} />}</span>
          <strong>{you.score > 0 ? `You finished ${ordinal(you.rank)} of ${you.of}` : 'Thanks for playing'}</strong>
          <span>{you.score.toLocaleString()} points · {you.correct} right</span>
        </div>
      )}
      <p className="eyebrow">{final ? 'Final results' : 'Leaderboard'}</p>
      <Board rows={quiz.board} highlight={you?.rank} />
    </section>
  );
}

export function Board({ rows, highlight }: { rows: QuizView['board']; highlight?: number }) {
  if (!rows.length) return <p className="faint">No scores yet.</p>;
  return (
    <ol className="quiz-board">
      {rows.map((r) => (
        <li key={r.id} className={r.rank === highlight ? 'is-you' : ''}>
          <span className="quiz-rank">{r.rank === 1 ? <Crown size={15} aria-label="First" /> : r.rank}</span>
          <span className="quiz-who">{r.name}</span>
          <span className="tabular">{r.score.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}

/** A compact score for the phone's top bar. */
export function ScoreChip({ link }: { link: LinkSnapshot }) {
  const you = link.you;
  if (!link.quiz?.on || !link.quiz.questions || !you || !link.quiz.done) return null;
  return <span className="quiz-chip tabular" title="Your score">{you.score.toLocaleString()} · {ordinal(you.rank)}</span>;
}

/** On the presenter's phone: how answers are coming in, and the leaderboard controls. */
export function QuizPresenter({ link, choices }: { link: LinkSnapshot; choices: string[] | null }) {
  const quiz = link.quiz;
  const q = quiz?.question;
  const left = useCountdown(q, link.quizAt);
  if (!quiz?.on || !quiz.questions) return null;
  const right = q?.correct !== undefined && q.counts ? q.counts[q.correct] ?? 0 : 0;
  return (
    <div className="phone-block quiz-presenter">
      {q && choices ? (
        <>
          <span className="eyebrow">Question {q.number} of {q.of} · {q.answered} of {q.players} answered{left !== null ? ` · ${left}s` : ''}</span>
          {q.phase === 'revealed'
            ? <p>{q.answered ? `${Math.round((right / q.answered) * 100)}% got it right.` : 'No one answered.'}</p>
            : <p className="faint">{q.phase === 'open' ? 'Tap Next to reveal the answer when you’re ready.' : 'Answers are locked. Tap Next to reveal.'}</p>}
          <ol className="quiz-mini-bars">
            {choices.map((c, i) => {
              const n = q.counts?.[i] ?? 0;
              const pct = q.answered ? Math.round((n / q.answered) * 100) : 0;
              return (
                <li key={i} className={q.correct === i ? 'is-right' : ''}>
                  <span><b>{LETTER(i)}</b> {c}</span>
                  <span className="phone-poll-bar"><span style={{ width: `${pct}%` }} /></span>
                  <span className="tabular">{n}</span>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <span className="eyebrow">Quiz · {quiz.done} of {quiz.questions} questions done · {quiz.players} playing</span>
      )}
      <div className="quiz-stage-btns">
        <button type="button" className="btn btn-sm btn-secondary" aria-pressed={link.stage === 'leaderboard'} onClick={() => liveLink.setStage(link.stage === 'leaderboard' ? 'play' : 'leaderboard')}>
          <Trophy size={14} /> {link.stage === 'leaderboard' ? 'Hide leaderboard' : 'Show leaderboard'}
        </button>
        <button type="button" className="btn btn-sm btn-secondary" aria-pressed={link.stage === 'podium'} onClick={() => liveLink.setStage(link.stage === 'podium' ? 'play' : 'podium')}>
          <Crown size={14} /> {link.stage === 'podium' ? 'Back to slides' : 'Final results'}
        </button>
      </div>
      {link.stage !== 'play' && <Board rows={quiz.board} />}
    </div>
  );
}
