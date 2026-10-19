import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays, Check, Clock, MapPin, MonitorPlay, NotebookPen, Pencil, Plus, Presentation, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../../data/db';
import { checklistItems, createNote, noteTitle, stripMarks, toggleChecklistItem, updateNote } from '../../data/notes';
import { formatDate, formatTime, plural } from '../../ui/format';
import { type CalEvent, type ScheduleData, courseVar, timeRange } from './model';

interface DetailsProps {
  ev: CalEvent;
  data: ScheduleData;
  onClose(): void;
  onMove(ev: CalEvent, date: string | undefined, time: string | undefined): void;
  onMakeSlides(ev: CalEvent): void;
}

/** What an event popover shows: when, where, links to the lesson, deck or note, and quick changes. */
export function EventDetails({ ev, data, onClose, onMove, onMakeSlides }: DetailsProps) {
  return ev.kind === 'lesson'
    ? <LessonDetails ev={ev} data={data} onClose={onClose} onMove={onMove} onMakeSlides={onMakeSlides} />
    : <NoteDetails ev={ev} data={data} onClose={onClose} onMove={onMove} onMakeSlides={onMakeSlides} />;
}

function Head({ ev, eyebrow, onClose }: { ev: CalEvent; eyebrow: string; onClose(): void }) {
  return (
    <div className="pop-head">
      <div className="pop-titles">
        <p className="eyebrow pop-eyebrow">{ev.kind === 'note' ? <NotebookPen size={12} /> : <span className="dot" />} {eyebrow}</p>
        <h3>{ev.title}</h3>
      </div>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
    </div>
  );
}

function When({ ev }: { ev: CalEvent }) {
  return (
    <div className="pop-when">
      <span><CalendarDays size={14} /> {ev.date ? formatDate(ev.date, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Not scheduled yet'}</span>
      {ev.date && <span><Clock size={14} /> {timeRange(ev)}</span>}
      {ev.room && <span><MapPin size={14} /> {ev.room}</span>}
    </div>
  );
}

/** Date and time fields that move the event a moment after they change. */
function MoveFields({ ev, onMove }: { ev: CalEvent; onMove: DetailsProps['onMove'] }) {
  const [date, setDate] = useState(ev.date);
  const [time, setTime] = useState(ev.time ?? '');
  useEffect(() => { setDate(ev.date); setTime(ev.time ?? ''); }, [ev.date, ev.time]);
  useEffect(() => {
    if (!date || (date === ev.date && time === (ev.time ?? ''))) return;
    const id = window.setTimeout(() => onMove(ev, date, time || undefined), 650);
    return () => window.clearTimeout(id);
  }, [date, time, ev, onMove]);
  return (
    <div className="pop-move">
      <label>
        <span className="visually-hidden">Date</span>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        <span className="visually-hidden">Time</span>
        <input className="input" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} />
      </label>
      {time && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTime('')}>All day</button>}
    </div>
  );
}

function LessonDetails({ ev, data, onClose, onMove, onMakeSlides }: DetailsProps) {
  const navigate = useNavigate();
  const lesson = ev.lesson!;
  const course = ev.course;
  const deck = useLiveQuery(() => (lesson.deckId ? db.decks.get(lesson.deckId) : undefined), [lesson.deckId]);
  const notes = data.notes.filter((n) => n.lessonId === lesson.id);
  const weekName = course?.weekTitles?.[lesson.week];

  const addNote = async () => {
    const note = await createNote({ title: '', courseId: lesson.courseId, lessonId: lesson.id, deckId: lesson.deckId, date: lesson.date });
    navigate(`/notes/${note.id}`);
  };

  return (
    <div className="pop-body" style={courseVar(course)}>
      <Head ev={ev} eyebrow={[course?.title, `Week ${lesson.week}${weekName ? ` · ${weekName}` : ''}`].filter(Boolean).join(' · ')} onClose={onClose} />
      <When ev={ev} />
      {lesson.summary && <p className="pop-summary">{lesson.summary}</p>}
      {notes.length > 0 && (
        <ul className="pop-notes" aria-label="Notes for this lesson">
          {notes.slice(0, 3).map((n) => {
            const open = checklistItems(n.body).filter((i) => !i.done).length;
            return (
              <li key={n.id}>
                <Link to={`/notes/${n.id}`}><NotebookPen size={13} /> <span>{noteTitle(n)}</span>{open > 0 && <em>{open} to do</em>}</Link>
              </li>
            );
          })}
          {notes.length > 3 && <li><Link to={`/notes?lesson=${lesson.id}`} className="faint">{plural(notes.length - 3, 'more note')}</Link></li>}
        </ul>
      )}
      <MoveFields ev={ev} onMove={onMove} />
      <div className="pop-actions">
        <Link className="btn btn-primary btn-sm" to={`/lessons/${lesson.id}`} data-autofocus>Open lesson</Link>
        {lesson.deckId ? (
          <>
            <Link className="btn btn-secondary btn-sm" to={`/present/${lesson.deckId}`} title={deck?.title}><MonitorPlay size={15} /> Present</Link>
            <Link className="btn btn-ghost btn-sm" to={`/studio/${lesson.deckId}`}><Pencil size={14} /> Slides</Link>
          </>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onMakeSlides(ev)}><Sparkles size={14} /> Make slides</button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={addNote}><Plus size={14} /> Note</button>
      </div>
    </div>
  );
}

function NoteDetails({ ev, onClose, onMove }: DetailsProps) {
  const note = ev.note!;
  const items = checklistItems(note.body);
  const lines = note.body.split('\n');
  const text = lines
    .filter((_, i) => !items.some((it) => it.line === i))
    .map(stripMarks)
    .filter(Boolean)
    .filter((l, i) => !(i === 0 && !note.title.trim() && l === ev.title))
    .join(' ');
  const lesson = ev.lesson;
  const deckId = note.deckId ?? lesson?.deckId;
  const course = ev.course;

  const toggle = (line: number) => updateNote(note.id, { body: toggleChecklistItem(note.body, line) });

  return (
    <div className="pop-body" style={courseVar(course)}>
      <Head ev={ev} eyebrow={course ? `Note · ${course.title}` : 'Note'} onClose={onClose} />
      <When ev={ev} />
      {text && <p className="pop-summary">{text.length > 220 ? `${text.slice(0, 219)}…` : text}</p>}
      {items.length > 0 && (
        <ul className="pop-checklist" aria-label="Checklist">
          {items.slice(0, 8).map((it) => (
            <li key={it.line}>
              <label className={`check-row ${it.done ? 'is-done' : ''}`}>
                <input type="checkbox" checked={it.done} onChange={() => toggle(it.line)} />
                <span className="check-box" aria-hidden><Check size={12} strokeWidth={3} /></span>
                <span className="check-text">{stripMarks(it.text)}</span>
              </label>
            </li>
          ))}
          {items.length > 8 && <li className="faint">{plural(items.length - 8, 'more item')}</li>}
        </ul>
      )}
      {note.tags.length > 0 && (
        <div className="pop-tags">{note.tags.map((t) => <Link key={t} to={`/notes?tag=${encodeURIComponent(t)}`} className="chip">#{t}</Link>)}</div>
      )}
      <MoveFields ev={ev} onMove={onMove} />
      <div className="pop-actions">
        <Link className="btn btn-primary btn-sm" to={`/notes/${note.id}`} data-autofocus>Open note</Link>
        {lesson && <Link className="btn btn-secondary btn-sm" to={`/lessons/${lesson.id}`}>{lesson.title.length > 22 ? 'Lesson' : lesson.title}</Link>}
        {deckId && <Link className="btn btn-ghost btn-sm" to={`/present/${deckId}`}><Presentation size={14} /> Present</Link>}
        {!lesson && course && <Link className="btn btn-ghost btn-sm" to={`/courses/${course.id}`}>{course.title}</Link>}
      </div>
    </div>
  );
}

/** Every event of one day, for "+N more" in the month. */
export function DayEvents({ date, events, onPick, onAdd, onClose }: { date: string; events: CalEvent[]; onPick(ev: CalEvent, el: HTMLElement): void; onAdd(): void; onClose(): void }) {
  return (
    <div className="pop-body">
      <div className="pop-head">
        <div className="pop-titles">
          <p className="eyebrow">{formatDate(date, { weekday: 'long' })}</p>
          <h3>{formatDate(date, { month: 'long', day: 'numeric' })}</h3>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <ul className="pop-day">
        {events.map((ev) => (
          <li key={ev.key}>
            <button type="button" className={`pop-day-ev ${ev.kind}`} style={courseVar(ev.course)} onClick={(e) => onPick(ev, e.currentTarget)}>
              <span className="pop-day-time">{ev.time ? formatTime(ev.time) : 'All day'}</span>
              <span className="pop-day-title">{ev.kind === 'note' && <NotebookPen size={12} />}{ev.title}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="pop-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onAdd}><Plus size={14} /> Add</button>
      </div>
    </div>
  );
}
