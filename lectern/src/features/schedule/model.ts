// What the schedule shows: lessons and dated notes as one list of events.

import { toHHMM, toMinutes } from '../../core/schedule/calendar';
import { DEFAULT_LESSON_MINUTES, meetingOn } from '../../core/schedule/timetable';
import type { Course, Lesson, Note } from '../../data/db';
import { checklistProgress, noteTitle } from '../../data/notes';
import { formatTime } from '../../ui/format';

export const NOTE_MINUTES = 30;

export interface CalEvent {
  /** "l:<id>" or "n:<id>". */
  key: string;
  kind: 'lesson' | 'note';
  id: string;
  title: string;
  /** Empty for a lesson that has no date yet. */
  date: string;
  time?: string;
  /** Minutes after midnight; 0 when there is no time. */
  start: number;
  duration: number;
  course?: Course;
  lesson?: Lesson;
  note?: Note;
  room?: string;
  /** Open checklist items: the note's own, or for a lesson, those in its notes. */
  open: number;
  total: number;
}

export interface ScheduleData {
  courses: Course[];
  courseById: Map<string, Course>;
  lessons: Lesson[];
  notes: Note[];
  /** Dated events after the course filter. */
  events: CalEvent[];
  byDate: Map<string, CalEvent[]>;
  byKey: Map<string, CalEvent>;
  /** Lessons without a date, after the course filter. */
  unscheduled: CalEvent[];
}

/** Untimed first, then by time; lessons before notes at the same time. */
export function compareEvents(a: CalEvent, b: CalEvent): number {
  return Number(Boolean(a.time)) - Number(Boolean(b.time)) || a.start - b.start || (a.kind === b.kind ? 0 : a.kind === 'lesson' ? -1 : 1) || a.title.localeCompare(b.title);
}

export function buildSchedule(courses: Course[], lessons: Lesson[], notes: Note[], courseFilter?: string | null): ScheduleData {
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const lessonById = new Map(lessons.map((l) => [l.id, l]));
  const lessonTasks = new Map<string, { open: number; total: number }>();
  for (const n of notes) {
    if (!n.lessonId) continue;
    const p = checklistProgress(n.body);
    const t = lessonTasks.get(n.lessonId) ?? { open: 0, total: 0 };
    lessonTasks.set(n.lessonId, { open: t.open + p.total - p.done, total: t.total + p.total });
  }

  const events: CalEvent[] = [];
  const unscheduled: CalEvent[] = [];
  for (const l of lessons) {
    if (courseFilter && l.courseId !== courseFilter) continue;
    const course = courseById.get(l.courseId);
    const tasks = lessonTasks.get(l.id) ?? { open: 0, total: 0 };
    const meeting = course && l.date && l.time ? meetingOn(course, l.date, l.time) : undefined;
    const ev: CalEvent = {
      key: `l:${l.id}`,
      kind: 'lesson',
      id: l.id,
      title: l.title,
      date: l.date ?? '',
      time: l.time,
      start: l.time ? toMinutes(l.time) : 0,
      duration: l.durationMinutes ?? meeting?.durationMinutes ?? DEFAULT_LESSON_MINUTES,
      course,
      lesson: l,
      room: meeting?.room,
      ...tasks,
    };
    (l.date ? events : unscheduled).push(ev);
  }
  for (const n of notes) {
    if (!n.date) continue;
    const courseId = n.courseId ?? (n.lessonId ? lessonById.get(n.lessonId)?.courseId : undefined);
    if (courseFilter && courseId !== courseFilter) continue;
    const p = checklistProgress(n.body);
    events.push({
      key: `n:${n.id}`,
      kind: 'note',
      id: n.id,
      title: noteTitle(n),
      date: n.date,
      time: n.time,
      start: n.time ? toMinutes(n.time) : 0,
      duration: NOTE_MINUTES,
      course: courseId ? courseById.get(courseId) : undefined,
      lesson: n.lessonId ? lessonById.get(n.lessonId) : undefined,
      note: n,
      open: p.total - p.done,
      total: p.total,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || compareEvents(a, b));
  unscheduled.sort((a, b) => (a.course?.title ?? '').localeCompare(b.course?.title ?? '') || (a.lesson!.week - b.lesson!.week) || (a.lesson!.order - b.lesson!.order));
  const byDate = new Map<string, CalEvent[]>();
  for (const ev of events) {
    const list = byDate.get(ev.date);
    if (list) list.push(ev);
    else byDate.set(ev.date, [ev]);
  }
  const byKey = new Map([...events, ...unscheduled].map((e) => [e.key, e]));
  return { courses, courseById, lessons, notes, events, byDate, byKey, unscheduled };
}

/** "9:00 – 9:50 AM" style range, or "All day". */
export function timeRange(ev: Pick<CalEvent, 'time' | 'start' | 'duration'>): string {
  if (!ev.time) return 'All day';
  return `${formatTime(ev.time)} – ${formatTime(toHHMM(ev.start + ev.duration))}`;
}

export function courseVar(course?: Pick<Course, 'color'>): React.CSSProperties | undefined {
  return course ? ({ '--course': `var(--c-${course.color})` } as React.CSSProperties) : undefined;
}
