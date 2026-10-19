// The weekly timetable of a course: when it meets, which slots are free, and
// how to date a whole course from it.

import type { Course, CourseMeeting, Lesson } from '../../data/db';
import { addDays, isoDate, parseIso, weekOf, weekRange } from '../../data/repo';
import { overlaps, toMinutes, weekdayIndex } from './calendar';

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DEFAULT_LESSON_MINUTES = 45;

/** One dated occurrence of a weekly meeting. */
export interface Slot {
  date: string;
  time: string;
  durationMinutes?: number;
  room?: string;
  /** Course week the slot falls in. */
  week: number;
}

type CourseTimes = Pick<Course, 'id' | 'startDate' | 'meetings'>;

export function sortMeetings(meetings: CourseMeeting[] = []): CourseMeeting[] {
  return [...meetings].sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time));
}

/** The meeting slots of one course week, in order. Slots before the course starts are left out. */
export function slotsInWeek(course: CourseTimes, week: number): Slot[] {
  const [monday] = weekRange(course, week);
  return sortMeetings(course.meetings)
    .map((m) => ({ date: isoDate(addDays(monday, m.weekday)), time: m.time, durationMinutes: m.durationMinutes, room: m.room, week }))
    .filter((s) => s.date >= course.startDate);
}

/** A lesson of the course already sits in this slot: same day, and no time or an overlapping one. */
export function isSlotTaken(course: Pick<Course, 'id'>, slot: Pick<Slot, 'date' | 'time' | 'durationMinutes'>, lessons: Lesson[], ignoreId?: string): boolean {
  const start = toMinutes(slot.time);
  const minutes = slot.durationMinutes ?? DEFAULT_LESSON_MINUTES;
  return lessons.some((l) => l.id !== ignoreId && l.courseId === course.id && l.date === slot.date
    && (!l.time || overlaps(start, minutes, toMinutes(l.time), l.durationMinutes ?? DEFAULT_LESSON_MINUTES)));
}

/**
 * The next n free meeting slots on or after a date, for suggesting when to
 * schedule a new lesson. Slots already holding a lesson of the course are skipped.
 */
export function nextSlots(course: CourseTimes, from: Date | string, n: number, lessons: Lesson[] = []): Slot[] {
  if (!course.meetings?.length || n <= 0) return [];
  const fromIso = typeof from === 'string' ? from : isoDate(from);
  const out: Slot[] = [];
  const first = Math.max(1, weekOf(course, parseIso(fromIso)));
  for (let week = first; week < first + 520 && out.length < n; week++) {
    for (const slot of slotsInWeek(course, week)) {
      if (slot.date < fromIso || isSlotTaken(course, slot, lessons)) continue;
      out.push(slot);
      if (out.length >= n) break;
    }
  }
  return out;
}

/** The weekly meeting that matches a date (and time, when given). */
export function meetingOn(course: Pick<Course, 'meetings'>, date: string, time?: string): CourseMeeting | undefined {
  const day = weekdayIndex(date);
  const same = (course.meetings ?? []).filter((m) => m.weekday === day);
  return time ? same.find((m) => m.time === time) : same[0];
}

/** Length of a new lesson: the matching meeting's, else the course's usual length, else 45 minutes. */
export function defaultDuration(course: Pick<Course, 'meetings'> | undefined, date?: string, time?: string): number {
  if (!course) return DEFAULT_LESSON_MINUTES;
  const exact = date ? meetingOn(course, date, time) : undefined;
  return exact?.durationMinutes ?? course.meetings?.find((m) => m.durationMinutes)?.durationMinutes ?? DEFAULT_LESSON_MINUTES;
}

// ─── Filling dates ────────────────────────────────────────────────────

export type FillMode = 'undated' | 'all';

export interface FillChange {
  id: string;
  title: string;
  week: number;
  before: Pick<Lesson, 'date' | 'time' | 'durationMinutes'>;
  date: string;
  time: string;
  durationMinutes?: number;
}

export interface FillPlan {
  changes: FillChange[];
  /** Lessons that found no slot: more lessons in a week than meetings. */
  unplaced: Lesson[];
}

/**
 * Dates lessons from the timetable. Walks the course week by week and gives
 * each week's lessons, in their order, that week's meeting slots.
 * "undated" only fills lessons without a date and leaves taken slots alone;
 * "all" re-dates every lesson. Only real changes are returned.
 */
export function planFill(course: CourseTimes, lessons: Lesson[], mode: FillMode): FillPlan {
  const own = lessons.filter((l) => l.courseId === course.id);
  const changes: FillChange[] = [];
  const unplaced: Lesson[] = [];
  if (!course.meetings?.length) return { changes, unplaced: mode === 'all' ? own : own.filter((l) => !l.date) };
  const weeks = [...new Set(own.map((l) => l.week))].sort((a, b) => a - b);
  for (const week of weeks) {
    const inWeek = own.filter((l) => l.week === week).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    const todo = mode === 'all' ? inWeek : inWeek.filter((l) => !l.date);
    if (!todo.length) continue;
    const slots = slotsInWeek(course, Math.max(1, week)).filter((s) => mode === 'all' || !isSlotTaken(course, s, own));
    todo.forEach((lesson, i) => {
      const slot = slots[i];
      if (!slot) { unplaced.push(lesson); return; }
      const durationMinutes = slot.durationMinutes ?? lesson.durationMinutes;
      if (lesson.date === slot.date && lesson.time === slot.time && lesson.durationMinutes === durationMinutes) return;
      changes.push({
        id: lesson.id,
        title: lesson.title,
        week: lesson.week,
        before: { date: lesson.date, time: lesson.time, durationMinutes: lesson.durationMinutes },
        date: slot.date,
        time: slot.time,
        durationMinutes,
      });
    });
  }
  return { changes, unplaced };
}
