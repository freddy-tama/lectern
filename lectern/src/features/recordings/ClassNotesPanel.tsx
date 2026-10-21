// "Turn into class notes": the optional AI step, and what you can make from its result.

import { Check, Layers, MoreHorizontal, NotebookPen, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { languageName } from '../../core/transcribe/languages';
import type { Course, Lesson, Recording } from '../../data/db';
import { updateRecording } from '../../data/recordings';
import { Menu } from '../../ui/Menu';
import { useToast } from '../../ui/Toast';
import { formatDate, timeAgo } from '../../ui/format';
import { AiAccessNotice } from '../account/AccountUi';
import { useAiAccess } from '../account/session';
import { saveCode, savedCode } from '../studio/ai';
import { makeQuizDeck, saveClassNotesAsNote, stampedTranscript } from './actions';
import { MAX_TRANSCRIPT, type NotesAiStatus, makeClassNotes, notesAiStatus } from './ai';

const LETTERS = 'ABCD';

interface Props {
  rec: Recording;
  lesson?: Lesson;
  course?: Course;
  onSaveTranscript(): void;
}

export function ClassNotesPanel({ rec, lesson, course, onSaveTranscript }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const [ai, setAi] = useState<NotesAiStatus | null>(null);
  const access = useAiAccess();
  const [code, setCode] = useState(savedCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState(true);
  const [making, setMaking] = useState<'note' | 'deck' | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    notesAiStatus().then(setAi);
    return () => abort.current?.abort();
  }, []);

  const notes = rec.summary;
  const hasTranscript = rec.segments.length > 0;

  const generate = async () => {
    setError('');
    const transcript = stampedTranscript(rec.segments);
    if (transcript.length > MAX_TRANSCRIPT) {
      setError('This transcript is longer than the AI step takes in one go. Select a part of it and save that as a note instead.');
      return;
    }
    if (ai?.needsCode) saveCode(code.trim());
    setBusy(true);
    abort.current = new AbortController();
    try {
      const result = await makeClassNotes({
        transcript,
        title: rec.title,
        course: course?.title,
        lesson: lesson ? `${lesson.title}${lesson.date ? ` (${formatDate(lesson.date)})` : ''}` : undefined,
        language: languageName(rec.language),
      }, abort.current.signal);
      await updateRecording(rec.id, { summary: result });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    if (!notes) return;
    setMaking('note');
    try {
      const note = await saveClassNotesAsNote(rec, notes, lesson);
      toast.show('Saved class notes to Notes', { action: { label: 'Open', run: () => navigate(`/notes/${note.id}`) } });
    } finally {
      setMaking(null);
    }
  };

  const makeDeck = async () => {
    if (!notes?.questions.length) return;
    setMaking('deck');
    try {
      const deck = await makeQuizDeck(rec, notes, lesson, course);
      navigate(`/studio/${deck.id}`);
      toast.show(deck.lessonId ? `Made a quiz deck for “${lesson?.title}”` : `Made a quiz deck with ${notes.questions.length} questions`);
    } catch {
      toast.show('The quiz deck couldn’t be made. Try again.', { tone: 'error' });
      setMaking(null);
    }
  };

  if (!hasTranscript) {
    return (
      <div className="empty rc-notes-empty">
        <div className="empty-icon"><Sparkles size={22} /></div>
        <h3>Class notes come from the transcript</h3>
        <p>Once the recording is transcribed, you can turn it into a summary, key points, a to-do list and quiz questions.</p>
      </div>
    );
  }

  if (!notes) {
    return (
      <div className="card rc-notes-start">
        <div className="rc-notes-start-icon"><Sparkles size={22} /></div>
        <h3>Turn the transcript into class notes</h3>
        <p className="muted">A summary, key points, a to-do list and quiz questions, written by AI from the transcript text. The audio stays on this device.</p>
        {ai === null ? (
          <div className="rc-notes-row"><span className="spinner" aria-hidden /> <span className="faint">Checking whether AI is set up…</span></div>
        ) : !ai.available ? (
          <div className="rc-notes-off">
            <p><strong>AI class notes aren’t set up on this server.</strong> The person who runs it can add an Anthropic API key to turn them on. Everything else works without it.</p>
            <button type="button" className="btn btn-secondary" onClick={onSaveTranscript}><NotebookPen size={16} /> Save the transcript as a note</button>
          </div>
        ) : access === 'sign_in' || access === 'no_credits' ? (
          <div className="rc-notes-off">
            <AiAccessNotice access={access} what="make class notes with AI">You can still save the transcript as a note.</AiAccessNotice>
            <button type="button" className="btn btn-secondary" onClick={onSaveTranscript}><NotebookPen size={16} /> Save the transcript as a note</button>
          </div>
        ) : (
          <>
            {ai.needsCode && (
              <label className="field rc-code">
                <span className="field-label">Access code</span>
                <input className="input" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code for this server" />
              </label>
            )}
            <div className="rc-notes-row">
              <button type="button" className="btn btn-brand" onClick={generate} disabled={busy || (ai.needsCode && !code.trim())}>
                {busy ? <><span className="spinner" aria-hidden /> Writing notes…</> : <><Sparkles size={16} /> Make class notes</>}
              </button>
              {busy && <button type="button" className="btn btn-ghost" onClick={() => abort.current?.abort()}>Cancel</button>}
              {busy && <span className="faint">This takes up to a minute.</span>}
            </div>
          </>
        )}
        {error && <p className="rc-error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <article className="rc-notes" aria-labelledby="rc-notes-title">
      <header className="rc-notes-head">
        <div>
          <p className="eyebrow">Class notes{notes.createdAt ? ` · ${timeAgo(notes.createdAt)}` : ''}</p>
          <h2 id="rc-notes-title">{notes.title}</h2>
        </div>
        <div className="rc-notes-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={saveNote} disabled={making !== null}>
            {making === 'note' ? <span className="spinner" aria-hidden /> : <NotebookPen size={15} />} Save as note
          </button>
          {notes.questions.length > 0 && (
            <button type="button" className="btn btn-primary btn-sm" onClick={makeDeck} disabled={making !== null}>
              {making === 'deck' ? <span className="spinner" aria-hidden /> : <Layers size={15} />} Make a quiz deck
            </button>
          )}
          <Menu align="end" trigger={(p) => <button type="button" className="icon-btn" aria-label="More for class notes" {...p}><MoreHorizontal size={18} /></button>}>
            {(close) => (
              <>
                <button type="button" className="menu-item" disabled={busy || !ai?.available} onClick={() => { close(); void generate(); }}><RefreshCw size={16} /> Make them again</button>
                <button type="button" className="menu-item btn-danger" onClick={() => { close(); void updateRecording(rec.id, { summary: undefined }); }}><Trash2 size={16} /> Remove class notes</button>
              </>
            )}
          </Menu>
        </div>
      </header>
      {busy && <p className="rc-notes-busy"><span className="spinner" aria-hidden /> Writing new notes…</p>}
      {error && <p className="rc-error" role="alert">{error}</p>}

      {notes.summary && <p className="rc-summary">{notes.summary}</p>}

      {notes.keyPoints.length > 0 && (
        <section className="rc-notes-section">
          <h3>Key points</h3>
          <ul className="rc-points">{notes.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </section>
      )}

      {notes.actionItems.length > 0 && (
        <section className="rc-notes-section">
          <h3>To do</h3>
          <ul className="rc-todo">
            {notes.actionItems.map((a, i) => <li key={i}><span className="rc-box" aria-hidden />{a}</li>)}
          </ul>
          <p className="faint rc-hint">Saved as a checklist when you save the notes.</p>
        </section>
      )}

      {notes.questions.length > 0 && (
        <section className="rc-notes-section">
          <div className="rc-quiz-head">
            <h3>Quiz questions</h3>
            <label className="switch rc-toggle">
              <input type="checkbox" checked={answers} onChange={(e) => setAnswers(e.target.checked)} />
              <span>Show answers</span>
            </label>
          </div>
          <ol className="rc-quiz">
            {notes.questions.map((q, qi) => (
              <li key={qi} className="rc-q">
                <p className="rc-q-text">{q.question}</p>
                <ul className="rc-options">
                  {q.options.map((o, oi) => {
                    const right = answers && oi === q.correct;
                    return (
                      <li key={oi} className={right ? 'is-right' : undefined}>
                        <span className="rc-letter" aria-hidden>{right ? <Check size={13} /> : LETTERS[oi]}</span>
                        <span>{o}</span>
                        {right && <span className="visually-hidden"> (correct)</span>}
                      </li>
                    );
                  })}
                </ul>
                {answers && q.explanation && <p className="rc-q-why">{q.explanation}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
