// Lesson page cards: open tasks before class, and a quick "How did it go?" reflection after it.

import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, ListTodo, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Lesson, Note, NoteMood } from '../../data/db';
import { createNote, noteTitle, notesForLesson, openTasks, stripMarks, toggleChecklistItem, updateNote } from '../../data/notes';
import { isoDate } from '../../data/repo';
import { useToast } from '../../ui/Toast';
import { plural, timeAgo } from '../../ui/format';
import { MoodIcon, MoodPicker, moodLabel } from './mood';
import { InlineText } from './NoteBody';

export function isReflection(note: Pick<Note, 'mood' | 'tags'>): boolean {
  return Boolean(note.mood) || note.tags.includes('reflection');
}

/** Unticked tasks from the lesson's notes. Shown first while the lesson is still ahead. */
export function LessonTasks({ lessonId, upcoming }: { lessonId: string; upcoming: boolean }) {
  const notes = useLiveQuery(() => notesForLesson(lessonId), [lessonId]);
  const titleId = useId();
  const tasks = notes ? openTasks(notes) : [];
  if (!tasks.length) return null;
  return (
    <section className={`card nt-lesson-tasks ${upcoming ? 'is-upcoming' : ''}`} aria-labelledby={titleId}>
      <div className="nt-card-head">
        <span className="nt-card-icon"><ListTodo size={16} /></span>
        <h2 id={titleId}>{upcoming ? 'Before class' : 'Still to do'}</h2>
        <span className="chip chip-brand">{plural(tasks.length, 'task')}</span>
      </div>
      <ul className="nt-task-list">
        {tasks.map(({ note, item }) => (
          <li key={`${note.id}:${item.line}`}>
            <label className="nt-check">
              <input type="checkbox" checked={false} onChange={() => updateNote(note.id, { body: toggleChecklistItem(note.body, item.line) })} />
              <span><InlineText text={item.text} /></span>
            </label>
            <Link className="nt-task-from" to={`/notes/${note.id}`}>{noteTitle(note)}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "How did it go?": a mood and a line, saved as a reflection note on the lesson. */
export function ReflectCard({ lesson, prominent }: { lesson: Lesson; prominent: boolean }) {
  const notes = useLiveQuery(() => notesForLesson(lesson.id), [lesson.id]);
  const [mood, setMood] = useState<NoteMood | undefined>();
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const navigate = useNavigate();
  const toast = useToast();
  const latest = notes?.filter(isReflection).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (notes === undefined) return null;

  const save = async () => {
    if ((!mood && !text.trim()) || busy) return;
    setBusy(true);
    try {
      const note = await createNote({
        title: `${lesson.title}: ${mood ? moodLabel(mood).toLowerCase() : 'reflection'}`,
        body: text.trim(),
        tags: ['reflection'],
        mood,
        date: lesson.date ?? isoDate(new Date()),
        lessonId: lesson.id,
        courseId: lesson.courseId,
        deckId: lesson.deckId,
      });
      setMood(undefined);
      setText('');
      setAdding(false);
      toast.show('Reflection saved', { action: { label: 'Add more', run: () => navigate(`/notes/${note.id}`) } });
    } finally {
      setBusy(false);
    }
  };

  if (latest && !adding) {
    const preview = latest.body.split('\n').map(stripMarks).filter(Boolean).join(' · ');
    return (
      <section className="card nt-reflect is-done" aria-labelledby={titleId}>
        <div className="nt-card-head">
          {latest.mood ? <MoodIcon mood={latest.mood} size={18} /> : null}
          <h2 id={titleId}>{latest.mood ? moodLabel(latest.mood) : 'Reflection'}</h2>
          <span className="faint nt-card-time">{timeAgo(latest.createdAt)}</span>
        </div>
        <p className="nt-reflect-text">{preview || noteTitle(latest)}</p>
        <div className="nt-reflect-actions">
          <Link className="btn btn-ghost btn-sm" to={`/notes/${latest.id}`}>Open <ArrowRight size={14} /></Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}><Plus size={14} /> Add another</button>
        </div>
      </section>
    );
  }

  return (
    <section className={`card nt-reflect ${prominent ? 'is-prominent' : ''}`} aria-labelledby={titleId}>
      <div className="nt-card-head">
        <h2 id={titleId}>How did it go?</h2>
        {adding && <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setAdding(false)}>Cancel</button>}
      </div>
      <MoodPicker value={mood} onChange={setMood} label="How did the lesson go?" />
      <form className="nt-reflect-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="One line: what worked, what to change"
          aria-label="What worked, what to change"
        />
        <button type="submit" className="btn btn-primary" disabled={(!mood && !text.trim()) || busy}>Save</button>
      </form>
    </section>
  );
}
