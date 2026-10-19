import { BookOpen, NotebookPen, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { defaultDuration, meetingOn, nextSlots } from '../../core/schedule/timetable';
import type { Course, Lesson } from '../../data/db';
import { createNote } from '../../data/notes';
import { useToast } from '../../ui/Toast';
import { formatDate, formatTime } from '../../ui/format';
import { courseWeek, scheduleLesson } from './actions';

export interface CreateRequest {
  date: string;
  time?: string;
  courseId?: string;
  durationMinutes?: number;
  kind?: 'lesson' | 'note';
}

let lastKind: 'lesson' | 'note' | null = null;

/** Adds a lesson or a note on a day, from a click on the calendar. */
export function CreateForm({ req, courses, lessons, onClose }: { req: CreateRequest; courses: Course[]; lessons: Lesson[]; onClose(): void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [kind, setKind] = useState<'lesson' | 'note'>(req.kind ?? (courses.length ? lastKind ?? 'lesson' : 'note'));
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(req.date);
  const [courseId, setCourseId] = useState(req.courseId ?? courses[0]?.id ?? '');
  const [noteCourseId, setNoteCourseId] = useState(req.courseId ?? '');
  const course = courses.find((c) => c.id === courseId);
  // With no time picked, a lesson takes the course's meeting time that day.
  const [timeEdited, setTimeEdited] = useState(Boolean(req.time));
  const [timeValue, setTime] = useState(req.time ?? '');
  const time = kind === 'lesson' && !timeEdited ? (course && date ? meetingOn(course, date)?.time ?? '09:00' : '09:00') : timeValue;
  const [minutesText, setMinutes] = useState(req.durationMinutes ? String(req.durationMinutes) : '');
  const usual = defaultDuration(course, date, time);
  const duration = Number(minutesText) >= 5 ? Math.min(600, Number(minutesText)) : usual;
  const week = course && date ? courseWeek(course, date) : 1;
  const weekName = course?.weekTitles?.[week];
  const early = course && date ? date < course.startDate : false;
  // Off the timetable: offer the course's next free class times instead.
  const onTimetable = Boolean(course && date && meetingOn(course, date, time));
  const suggestions = kind === 'lesson' && course && date && !onTimetable ? nextSlots(course, date, 2, lessons) : [];

  const pick = (k: 'lesson' | 'note') => { setKind(k); lastKind = k; };

  const submit = async (open = false) => {
    if (!date) return;
    if (kind === 'lesson') {
      if (!course) return;
      const lesson = await scheduleLesson(course, { title, date, time, durationMinutes: duration });
      onClose();
      if (open) navigate(`/lessons/${lesson.id}?edit=1`);
      else toast.show(`Added “${lesson.title}” to week ${lesson.week}`, { action: { label: 'Open', run: () => navigate(`/lessons/${lesson.id}`) } });
    } else {
      const note = await createNote({ title, date, time: time || undefined, courseId: noteCourseId || undefined });
      onClose();
      if (open) navigate(`/notes/${note.id}`);
      else toast.show(title.trim() ? `Added “${title.trim()}”` : 'Note added', { action: { label: 'Open', run: () => navigate(`/notes/${note.id}`) } });
    }
  };

  return (
    <form className="pop-body pop-create" onSubmit={(e) => { e.preventDefault(); submit(); }} style={kind === 'lesson' && course ? ({ '--course': `var(--c-${course.color})` } as React.CSSProperties) : undefined}>
      <div className="pop-head">
        <div className="segmented" role="group" aria-label="What to add">
          <button type="button" aria-pressed={kind === 'lesson'} onClick={() => pick('lesson')} disabled={!courses.length} title={courses.length ? undefined : 'Make a course first'}><BookOpen size={14} /> Lesson</button>
          <button type="button" aria-pressed={kind === 'note'} onClick={() => pick('note')}><NotebookPen size={14} /> Note</button>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>

      <label className="pop-title-field">
        <span className="visually-hidden">Title</span>
        <input
          className="input-bare"
          data-autofocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === 'lesson' ? 'Lesson title' : 'Note title, for example “Print handouts”'}
        />
      </label>

      <div className="pop-grid">
        <label className="field">
          <span className="field-label">Date</span>
          <input className="input" type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Time</span>
          <input className="input" type="time" step={300} value={time} onChange={(e) => { setTimeEdited(true); setTime(e.target.value); }} />
        </label>
        {kind === 'lesson' ? (
          <>
            <label className="field">
              <span className="field-label">Course</span>
              <select className="select" value={courseId} onChange={(e) => { setCourseId(e.target.value); setMinutes(''); }}>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Minutes</span>
              <input className="input" type="number" min={5} max={600} step={5} value={minutesText} placeholder={String(usual)} onChange={(e) => setMinutes(e.target.value)} />
            </label>
            <p className="pop-hint">
              {course ? <>Week {week}{weekName ? ` · ${weekName}` : ''}{early ? ' (before the course starts)' : ''}</> : null}
            </p>
            {suggestions.length > 0 && (
              <div className="pop-suggest">
                <span>Class times</span>
                {suggestions.map((slot) => (
                  <button
                    key={`${slot.date}${slot.time}`}
                    type="button"
                    className="chip"
                    onClick={() => { setDate(slot.date); setTime(slot.time); setTimeEdited(true); setMinutes(slot.durationMinutes ? String(slot.durationMinutes) : ''); }}
                  >
                    {formatDate(slot.date)} · {formatTime(slot.time)}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <label className="field pop-span">
            <span className="field-label">Course</span>
            <select className="select" value={noteCourseId} onChange={(e) => setNoteCourseId(e.target.value)}>
              <option value="">No course</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="pop-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={!date || (kind === 'lesson' && !course)}>
          {kind === 'lesson' ? 'Add lesson' : 'Add note'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => submit(true)} disabled={!date || (kind === 'lesson' && !course)}>
          Add and open
        </button>
        <span className="pop-when-inline faint">{date ? formatDate(date) : ''}</span>
      </div>
    </form>
  );
}
