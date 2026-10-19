// Changes the schedule makes to lessons and notes, each with a way to undo.

import { scheduleToIcs } from '../../core/schedule/ics';
import type { FillChange } from '../../core/schedule/timetable';
import { type Course, type Lesson, db } from '../../data/db';
import { updateNote } from '../../data/notes';
import { createLesson, parseIso, updateLesson, weekOf } from '../../data/repo';
import { downloadBlob, safeName } from '../studio/download';
import type { CalEvent } from './model';

export type Undo = () => Promise<void>;

/** Course week for a date, never before week 1. */
export function courseWeek(course: Pick<Course, 'startDate'>, date: string): number {
  return Math.max(1, weekOf(course, parseIso(date)));
}

/**
 * Moves a lesson to a date and time. When the date lands in another course
 * week, the lesson moves to the end of that week too.
 */
export async function rescheduleLesson(lesson: Lesson, course: Course | undefined, date: string | undefined, time: string | undefined): Promise<Undo> {
  const before: Partial<Lesson> = { date: lesson.date, time: lesson.time, week: lesson.week, order: lesson.order };
  const patch: Partial<Lesson> = { date, time: date ? time : undefined };
  if (date && course) {
    const week = courseWeek(course, date);
    if (week !== lesson.week) {
      const siblings = await db.lessons.where('[courseId+week]').equals([lesson.courseId, week]).toArray();
      patch.week = week;
      patch.order = siblings.reduce((m, l) => Math.max(m, l.order), -1) + 1;
    }
  }
  await updateLesson(lesson.id, patch);
  return () => updateLesson(lesson.id, before);
}

export async function moveEvent(ev: CalEvent, date: string | undefined, time: string | undefined): Promise<Undo> {
  if (ev.kind === 'lesson' && ev.lesson) return rescheduleLesson(ev.lesson, ev.course, date, time);
  const note = ev.note!;
  const before = { date: note.date, time: note.time };
  await updateNote(note.id, { date, time: date ? time : undefined });
  return () => updateNote(note.id, before);
}

/** Adds a lesson on a date; its week follows from the date. */
export async function scheduleLesson(course: Course, input: { title: string; date: string; time?: string; durationMinutes?: number }) {
  return createLesson(course.id, courseWeek(course, input.date), {
    title: input.title,
    date: input.date,
    time: input.time || undefined,
    durationMinutes: input.durationMinutes,
  });
}

/** Writes the dates a timetable fill planned. */
export async function applyFill(changes: FillChange[]): Promise<Undo> {
  const now = Date.now();
  await db.transaction('rw', db.lessons, async () => {
    for (const c of changes) await db.lessons.update(c.id, { date: c.date, time: c.time, durationMinutes: c.durationMinutes, updatedAt: now });
  });
  return async () => {
    await db.transaction('rw', db.lessons, async () => {
      for (const c of changes) await db.lessons.update(c.id, { ...c.before, updatedAt: Date.now() });
    });
  };
}

/** Downloads an .ics file of dated lessons and notes, for one course or all. Returns how many events it holds. */
export async function exportCalendar(courseId?: string | null): Promise<number> {
  const [courses, allLessons, allNotes] = await Promise.all([db.courses.toArray(), db.lessons.toArray(), db.notes.where('date').above('').toArray()]);
  const course = courseId ? courses.find((c) => c.id === courseId) : undefined;
  const lessons = course ? allLessons.filter((l) => l.courseId === course.id) : allLessons;
  const lessonIds = new Set(lessons.map((l) => l.id));
  const notes = course ? allNotes.filter((n) => n.courseId === course.id || (n.lessonId && lessonIds.has(n.lessonId))) : allNotes;
  const deckIds = [...new Set(lessons.map((l) => l.deckId).filter(Boolean) as string[])];
  const decks = await db.decks.bulkGet(deckIds);
  const deckTitles = new Map(decks.filter(Boolean).map((d) => [d!.id, d!.title]));
  const ics = scheduleToIcs({
    courses,
    lessons,
    notes,
    deckTitles,
    name: course ? course.title : 'Lectern schedule',
    origin: typeof location !== 'undefined' ? location.origin : undefined,
  });
  const count = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
  if (!count) return 0;
  downloadBlob(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), `${safeName(course ? course.title : 'Lectern schedule')}.ics`);
  return count;
}
