// What the audience window adds while a deck is shared: the join code, and the
// quiz (timer and answer count, leaderboard, final results).

import { Crown, Timer, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatCode } from '../../core/share/protocol';
import type { ScreenMessage, ScreenQuiz } from './host';
import { QrCode } from './QrCode';
import { useCountdown } from './QuizPhone';

function useScreen(deckId: string) {
  const [card, setCard] = useState<{ code: string; url: string } | null>(null);
  const [quiz, setQuiz] = useState<{ q: ScreenQuiz; at: number } | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(`lectern-live:${deckId}`);
    ch.onmessage = (e: MessageEvent<ScreenMessage>) => {
      const m = e.data;
      if (m?.type !== 'screen') return;
      setCard(m.show && m.code && m.url ? { code: m.code, url: m.url } : null);
      setQuiz(m.quiz ? { q: m.quiz, at: Date.now() } : null);
    };
    ch.postMessage({ type: 'ask' } satisfies ScreenMessage);
    return () => ch.close();
  }, [deckId]);
  return { card, quiz };
}

function Podium({ rows }: { rows: ScreenQuiz['view']['board'] }) {
  const [first, second, third] = rows;
  const place = (r: typeof first, n: number) => r && (
    <div className={`podium-place p${n}`}>
      <span className="podium-name">{r.name}</span>
      <span className="podium-score tabular">{r.score.toLocaleString()}</span>
      <div className="podium-step">{n === 1 ? <Crown aria-label="First" /> : n}</div>
    </div>
  );
  return <div className="podium">{place(second, 2)}{place(first, 1)}{place(third, 3)}</div>;
}

export function LiveScreen({ deckId }: { deckId: string }) {
  const { card, quiz } = useScreen(deckId);
  const q = quiz?.q.view.question;
  const left = useCountdown(q, quiz?.at ?? 0);
  const stage = quiz?.q.stage ?? 'play';
  const board = quiz?.q.view.board ?? [];

  return (
    <>
      {/* Out of the way while a question is up: it would cover the answers. */}
      {card && stage === 'play' && !q && (
        <div className="present-join" aria-label="Join on your phone">
          <QrCode value={card.url} label="QR code to follow on your phone" />
          <div>
            <p>Follow on your phone</p>
            <p>{new URL(card.url).host}/join</p>
            <strong>{formatCode(card.code)}</strong>
          </div>
        </div>
      )}

      {stage === 'play' && q && q.phase !== 'revealed' && (
        <div className="screen-quiz-status" aria-live="polite">
          {left !== null && <span className={`screen-timer ${left <= 5 ? 'is-low' : ''}`}><Timer aria-hidden /> <b className="tabular">{left}</b></span>}
          <span><Users aria-hidden /> <b className="tabular">{q.answered}</b> / {q.players} answered</span>
        </div>
      )}
      {stage === 'play' && q?.phase === 'revealed' && q.answered > 0 && q.correct !== undefined && q.counts && (
        <div className="screen-quiz-status is-result">
          <span><b className="tabular">{Math.round(((q.counts[q.correct] ?? 0) / q.answered) * 100)}%</b> got it right</span>
        </div>
      )}

      {stage !== 'play' && (
        <div className={`screen-board ${stage === 'podium' ? 'is-podium' : ''}`} role="dialog" aria-label={stage === 'podium' ? 'Final results' : 'Leaderboard'}>
          <div className="screen-board-card">
            <p className="screen-board-eyebrow">{stage === 'podium' ? 'Final results' : `Leaderboard · ${quiz?.q.view.done ?? 0} of ${quiz?.q.view.questions ?? 0} questions`}</p>
            {stage === 'podium' && board.length > 0 && <Podium rows={board} />}
            {board.length === 0
              ? <p className="screen-board-empty">No scores yet.</p>
              : (
                <ol className="screen-board-list">
                  {(stage === 'podium' ? board.slice(3) : board).map((r) => (
                    <li key={r.id}>
                      <span className="screen-rank">{r.rank}</span>
                      <span className="screen-who">{r.name}</span>
                      <span className="tabular">{r.score.toLocaleString()}</span>
                    </li>
                  ))}
                </ol>
              )}
          </div>
        </div>
      )}
    </>
  );
}
