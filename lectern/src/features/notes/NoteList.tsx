// Pieces of the notes list: one row per note, and the overview shown when no note is open.

import { CalendarDays, Layers, ListChecks, NotebookPen, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Note } from '../../data/db';
import { checklistProgress, noteTitle, notePreview, openTasks, toggleChecklistItem, updateNote } from '../../data/notes';
import { isoDate } from '../../data/repo';
import { formatTime, plural, relativeDay, timeAgo } from '../../ui/format';
import { MoodIcon } from './mood';
import { InlineText } from './NoteBody';
import { type NoteRefs, courseStyle } from './refs';

export function NoteItem({ note, refs, active, to }: { note: Note; refs?: NoteRefs; active: boolean; to: string }) {
  const course = note.courseId ? refs?.course.get(note.courseId) : undefined;
  const lesson = note.lessonId ? refs?.lesson.get(note.lessonId) : undefined;
  const deck = note.deckId ? refs?.deck.get(note.deckId) : undefined;
  const slide = deck && note.slideId ? deck.slides.find((s) => s.id === note.slideId) : undefined;
  const progress = checklistProgress(note.body);
  const preview = notePreview(note, 140);
  const today = isoDate(new Date());
  return (
    <Link
      to={to}
      className={`nt-item ${active ? 'is-active' : ''}`}
      data-note={note.id}
      aria-current={active ? 'page' : undefined}
      style={courseStyle(course)}
    >
      <span className="nt-item-top">
        {note.mood && <MoodIcon mood={note.mood} size={15} />}
        <strong className="nt-item-title">{noteTitle(note)}</strong>
        <span className="nt-item-time">{timeAgo(note.updatedAt)}</span>
      </span>
      {preview && <span className="nt-item-preview">{preview}</span>}
      <span className="nt-item-meta">
        {(course || lesson) && (
          <span className="nt-meta nt-meta-link"><span className="dot" /><span className="nt-meta-text">{lesson?.title ?? course?.title}</span></span>
        )}
        {deck && (!lesson || slide) && (
          <span className="nt-meta nt-meta-link"><Layers size={12} aria-hidden /><span className="nt-meta-text">{lesson ? `Slide ${slide!.number}` : `${deck.title}${slide ? ` · slide ${slide.number}` : ''}`}</span></span>
        )}
        {note.date && (
          <span className={`nt-meta ${note.date < today ? '' : 'nt-meta-date'}`}><CalendarDays size={12} aria-hidden />{relativeDay(note.date, today)}{note.time ? `, ${formatTime(note.time)}` : ''}</span>
        )}
        {progress.total > 0 && (
          <span className={`nt-meta ${progress.done === progress.total ? 'is-done' : 'nt-meta-tasks'}`} title={`${progress.done} of ${progress.total} tasks done`}>
            <ListChecks size={12} aria-hidden /><span className="tabular">{progress.done}/{progress.total}</span>
          </span>
        )}
        {note.tags.slice(0, 3).map((t) => <span key={t} className="nt-tag">#{t}</span>)}
        {note.tags.length > 3 && <span className="nt-tag">+{note.tags.length - 3}</span>}
      </span>
    </Link>
  );
}

/** Shown beside the list when no note is open: a nudge, open tasks and dated notes coming up. */
export function NotesOverview({ notes, refs, search, onNew }: { notes: Note[]; refs?: NoteRefs; search: string; onNew(): void }) {
  const today = isoDate(new Date());
  const tasks = openTasks([...notes].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || b.updatedAt - a.updatedAt));
  const soon = notes.filter((n) => n.date && n.date >= today).sort((a, b) => a.date!.localeCompare(b.date!) || (a.time ?? '99').localeCompare(b.time ?? '99')).slice(0, 6);
  return (
    <div className="nt-overview">
      <div className="nt-overview-hero">
        <div className="empty-icon"><NotebookPen size={22} /></div>
        <h2>Pick a note, or start a new one</h2>
        <p className="muted">Press <kbd>N</kbd> anywhere in Lectern to jot something down.</p>
        <button type="button" className="btn btn-primary" onClick={onNew}><Plus size={16} /> New note</button>
      </div>

      {tasks.length > 0 && (
        <section className="nt-ov-section" aria-labelledby="nt-ov-tasks">
          <div className="nt-ov-head">
            <h3 id="nt-ov-tasks">Open tasks</h3>
            <span className="faint">{plural(tasks.length, 'task')}</span>
          </div>
          <ul className="nt-ov-tasks">
            {tasks.slice(0, 8).map(({ note, item }) => {
              const course = note.courseId ? refs?.course.get(note.courseId) : undefined;
              return (
                <li key={`${note.id}:${item.line}`} style={courseStyle(course)}>
                  <label className="nt-check">
                    <input type="checkbox" checked={false} onChange={() => updateNote(note.id, { body: toggleChecklistItem(note.body, item.line) })} />
                    <span><InlineText text={item.text} /></span>
                  </label>
                  <Link to={`/notes/${note.id}${search}`} className="nt-ov-from"><span className="dot" />{noteTitle(note)}</Link>
                </li>
              );
            })}
          </ul>
          {tasks.length > 8 && <p className="faint nt-ov-more">And {plural(tasks.length - 8, 'more task')}. Use the “Has open tasks” filter to see them all.</p>}
        </section>
      )}

      {soon.length > 0 && (
        <section className="nt-ov-section" aria-labelledby="nt-ov-soon">
          <div className="nt-ov-head">
            <h3 id="nt-ov-soon">Coming up</h3>
            <Link className="btn btn-ghost btn-sm" to={`/schedule?view=week&date=${today}`}><CalendarDays size={14} /> Schedule</Link>
          </div>
          <ul className="nt-ov-soon">
            {soon.map((n) => {
              const course = n.courseId ? refs?.course.get(n.courseId) : undefined;
              return (
                <li key={n.id} style={courseStyle(course)}>
                  <Link to={`/notes/${n.id}${search}`}>
                    <span className="nt-ov-day">{relativeDay(n.date!, today)}{n.time ? <small>{formatTime(n.time)}</small> : null}</span>
                    <span className="nt-ov-title"><span className="dot" />{noteTitle(n)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
