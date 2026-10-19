// The Quiz tab of the share window: settings, the question in play, the
// leaderboard on the big screen, and results to keep.

import { useLiveQuery } from 'dexie-react-hooks';
import { Crown, Download, NotebookPen, RotateCcw, Trophy } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QUIZ_SECONDS, quizItem, resultsCsv, resultsNote } from '../../core/share/quiz';
import { db } from '../../data/db';
import { createNote } from '../../data/notes';
import { isoDate } from '../../data/repo';
import { useToast } from '../../ui/Toast';
import { downloadBlob, safeName } from '../studio/download';
import { liveHost, useLiveHost } from './host';

const LETTER = (i: number) => String.fromCharCode(65 + i);

/** Quiz settings, shown before sharing starts and in the Quiz tab. */
export function QuizSettingsRow() {
  const live = useLiveHost();
  const s = live.quizSettings;
  return (
    <div className="quiz-settings">
      <label className="switch"><input type="checkbox" checked={s.on} onChange={(e) => liveHost.setQuizSettings({ on: e.target.checked })} /><span>Score question slides as a quiz</span></label>
      {s.on && (
        <div className="quiz-seconds">
          <span className="field-label">Time to answer</span>
          <div className="segmented" role="group" aria-label="Time to answer">
            {QUIZ_SECONDS.map((n) => (
              <button key={n} type="button" aria-pressed={s.seconds === n} onClick={() => liveHost.setQuizSettings({ seconds: n })}>{n ? `${n}s` : 'No limit'}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function QuizPanel({ deckId }: { deckId: string }) {
  const live = useLiveHost();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const deck = useLiveQuery(() => db.decks.get(deckId), [deckId]);
  const quiz = live.quiz;
  const q = quiz?.question;
  const slide = q && deck ? deck.slides.find((s) => s.id === q.slideId) : undefined;
  const item = quizItem(slide);
  const board = live.quizBoard;

  const saveNote = async () => {
    if (!deck) return;
    const lesson = deck.lessonId ? await db.lessons.get(deck.lessonId) : undefined;
    const note = await createNote({
      title: `Quiz results: ${deck.title}`,
      body: resultsNote(liveHost.quizResults()),
      tags: ['quiz'],
      deckId: deck.id,
      lessonId: lesson?.id,
      courseId: lesson?.courseId,
      date: isoDate(new Date()),
    });
    toast.show('Results saved as a note', { action: { label: 'Open', run: () => { liveHost.closePanel(); navigate(`/notes/${note.id}`); } } });
  };

  const download = () => {
    const csv = resultsCsv(liveHost.quizResults());
    // A byte-order mark so spreadsheet apps read names with accents correctly.
    downloadBlob(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }), `${safeName(deck?.title ?? 'Quiz')} results.csv`);
  };

  return (
    <div className="quiz-panel" role="tabpanel">
      <QuizSettingsRow />

      {live.quizSettings.on && quiz && quiz.questions === 0 && (
        <p className="share-note">This deck has no scored questions yet. Mark the correct choice on a question slide, or use <strong>Present ▸ Make a quiz</strong> in the editor to build questions from your key notes.</p>
      )}

      {live.quizSettings.on && quiz && quiz.questions > 0 && (
        <>
          <p className="quiz-status muted">
            {quiz.done} of {quiz.questions} {quiz.questions === 1 ? 'question' : 'questions'} done · {quiz.players} {quiz.players === 1 ? 'player' : 'players'}
          </p>

          {q && item ? (
            <section className="quiz-now" aria-label="Question in play">
              <div className="quiz-now-head">
                <span className={`chip ${q.phase === 'open' ? 'chip-brand' : q.phase === 'revealed' ? 'chip-good' : ''}`}>
                  {q.phase === 'open' ? 'Answering' : q.phase === 'closed' ? 'Locked' : 'Revealed'}
                </span>
                <strong>Question {q.number}: {item.question}</strong>
                <span className="faint tabular">{q.answered}/{q.players}</span>
              </div>
              <ol>
                {item.choices.map((c, i) => {
                  const n = q.counts?.[i] ?? 0;
                  const pct = q.answered ? Math.round((n / q.answered) * 100) : 0;
                  return (
                    <li key={i} className={i === item.correct ? 'is-right' : ''}>
                      <span className="share-poll-label"><b>{LETTER(i)}</b> {c}</span>
                      <span className="share-poll-bar"><span style={{ width: `${pct}%` }} /></span>
                      <span className="share-poll-n tabular">{n}</span>
                    </li>
                  );
                })}
              </ol>
              {q.phase !== 'revealed' && <p className="faint">Click to the next step on the slide to reveal the answer and score it.</p>}
            </section>
          ) : (
            <p className="faint">Questions open by themselves when their slide comes up.</p>
          )}

          <div className="quiz-stage-btns">
            <button type="button" className="btn btn-secondary btn-sm" aria-pressed={live.stage === 'leaderboard'} onClick={() => liveHost.setStage(live.stage === 'leaderboard' ? 'play' : 'leaderboard')}>
              <Trophy size={15} /> {live.stage === 'leaderboard' ? 'Hide leaderboard' : 'Leaderboard on screen'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" aria-pressed={live.stage === 'podium'} onClick={() => liveHost.setStage(live.stage === 'podium' ? 'play' : 'podium')}>
              <Crown size={15} /> {live.stage === 'podium' ? 'Back to slides' : 'Final results on screen'}
            </button>
          </div>

          {board.length > 0 && (
            <ol className="quiz-board quiz-board-panel">
              {board.slice(0, 10).map((r) => (
                <li key={r.id}>
                  <span className="quiz-rank">{r.rank}</span>
                  <span className="quiz-who">{r.name}</span>
                  <span className="faint">{r.correct} right</span>
                  <span className="tabular">{r.score.toLocaleString()}</span>
                </li>
              ))}
              {board.length > 10 && <li className="faint">and {board.length - 10} more</li>}
            </ol>
          )}

          <div className="quiz-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={saveNote} disabled={!quiz.done}><NotebookPen size={15} /> Save results as a note</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={download} disabled={!board.length}><Download size={15} /> Download (.csv)</button>
            <button
              type="button"
              className="btn btn-ghost btn-sm share-stop"
              onClick={() => { if (confirmReset) { liveHost.resetQuiz(); setConfirmReset(false); } else { setConfirmReset(true); window.setTimeout(() => setConfirmReset(false), 4000); } }}
            >
              <RotateCcw size={15} /> {confirmReset ? 'Click again to clear all scores' : 'Start over'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
