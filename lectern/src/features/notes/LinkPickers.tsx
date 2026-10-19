// Selects for what a note links to: course → lesson (grouped by week) and deck → slide.

import { formatDate } from '../../ui/format';
import { lessonsByWeek } from './filters';
import type { NoteRefs } from './refs';

interface SelectProps {
  refs: NoteRefs;
  value?: string;
  onChange(id: string | undefined): void;
  className?: string;
  id?: string;
}

export function CourseSelect({ refs, value, onChange, className = 'select', id }: SelectProps) {
  return (
    <select id={id} className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">No course</option>
      {refs.courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
    </select>
  );
}

/** Lessons of one course grouped by week. With no course chosen, lessons are grouped by course. */
export function LessonSelect({ refs, value, onChange, className = 'select', id, courseId }: SelectProps & { courseId?: string }) {
  const label = (l: NoteRefs['lessons'][number]) => (l.date ? `${formatDate(l.date, { month: 'short', day: 'numeric' })} · ${l.title}` : l.title);
  const course = courseId ? refs.course.get(courseId) : undefined;
  const groups = course
    ? lessonsByWeek(refs.lessons.filter((l) => l.courseId === course.id), course).map((g) => ({ key: `w${g.week}`, label: g.label, lessons: g.lessons }))
    : refs.courses.map((c) => ({
      key: c.id,
      label: c.title,
      lessons: lessonsByWeek(refs.lessons.filter((l) => l.courseId === c.id), c).flatMap((g) => g.lessons),
    })).filter((g) => g.lessons.length);
  const empty = !groups.length;
  return (
    <select id={id} className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} disabled={empty && !value}>
      <option value="">{empty ? (course ? 'This course has no lessons' : 'No lessons yet') : 'No lesson'}</option>
      {groups.map((g) => (
        <optgroup key={g.key} label={g.label}>
          {g.lessons.map((l) => <option key={l.id} value={l.id}>{course ? label(l) : `Week ${l.week} · ${label(l)}`}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export function DeckSelect({ refs, value, onChange, className = 'select', id }: SelectProps) {
  const inLesson = refs.decks.filter((d) => d.lessonId && refs.lesson.has(d.lessonId));
  const other = refs.decks.filter((d) => !d.lessonId || !refs.lesson.has(d.lessonId));
  return (
    <select id={id} className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} disabled={!refs.decks.length && !value}>
      <option value="">{refs.decks.length ? 'No deck' : 'No decks yet'}</option>
      {inLesson.length > 0 && (
        <optgroup label="Lesson decks">
          {inLesson.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </optgroup>
      )}
      {other.length > 0 && (
        <optgroup label={inLesson.length ? 'Other decks' : 'Decks'}>
          {other.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </optgroup>
      )}
    </select>
  );
}

export function SlideSelect({ refs, value, onChange, className = 'select', id, deckId }: SelectProps & { deckId?: string }) {
  const deck = deckId ? refs.deck.get(deckId) : undefined;
  return (
    <select id={id} className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} disabled={!deck}>
      <option value="">{deck ? 'Whole deck' : 'Pick a deck first'}</option>
      {deck?.slides.map((s) => <option key={s.id} value={s.id}>{`${s.number}. ${s.heading}${s.hidden ? ' (hidden)' : ''}`}</option>)}
    </select>
  );
}
