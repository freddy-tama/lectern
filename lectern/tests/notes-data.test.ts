// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Note } from '../src/data/db';
import {
  checklistItems, checklistProgress, createNote, deleteNote, noteTitle, notePreview, notesBetween, notesForSlide,
  openTasks, parseTags, searchNotes, sortNotes, toggleChecklistItem,
} from '../src/data/notes';
import { createCourse, createLesson, deleteCourse, deleteLesson } from '../src/data/repo';
import { buildSeed } from '../src/data/seed';

const TODAY = new Date('2026-10-19T10:00:00');

describe('note text helpers', () => {
  const body = '# Plan\n- [ ] Print cards\n- [x] Book lab\n  - [ ] Check Wi-Fi\nplain line';

  it('reads, toggles and counts checklist items', () => {
    expect(checklistItems(body).map((i) => [i.line, i.text, i.done])).toEqual([[1, 'Print cards', false], [2, 'Book lab', true], [3, 'Check Wi-Fi', false]]);
    const toggled = toggleChecklistItem(body, 1);
    expect(toggled.split('\n')[1]).toBe('- [x] Print cards');
    expect(toggleChecklistItem(toggled, 1)).toBe(body);
    expect(toggleChecklistItem(body, 4)).toBe(body);
    expect(checklistProgress(body)).toEqual({ done: 1, total: 3 });
  });

  it('falls back to the first line for a title and skips it in the preview', () => {
    expect(noteTitle({ title: '', body })).toBe('Plan');
    expect(noteTitle({ title: '', body: '' })).toBe('Untitled note');
    expect(notePreview({ title: '', body })).toBe('Print cards · Book lab · Check Wi-Fi · plain line');
    expect(notePreview({ title: 'Prep', body: '**Bring** the [map](https://x.y)' })).toBe('Bring the map');
  });

  it('normalises tags and searches title, body and tags', () => {
    expect(parseTags('Planning, #Week 3 #planning')).toEqual(['planning', 'week', '3']);
    const notes = [{ title: 'Lab', body: 'climate maps', tags: ['admin'] }, { title: 'Ideas', body: 'weather station', tags: ['idea'] }] as Note[];
    expect(searchNotes(notes, '#admin').map((n) => n.title)).toEqual(['Lab']);
    expect(searchNotes(notes, 'weather idea').map((n) => n.title)).toEqual(['Ideas']);
    expect(searchNotes(notes, '  ')).toHaveLength(2);
  });

  it('sorts pinned first, then newest', () => {
    const notes = [{ id: 'a', updatedAt: 3 }, { id: 'b', updatedAt: 1, pinned: true }, { id: 'c', updatedAt: 5 }] as Note[];
    expect(sortNotes(notes).map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('sample notes', () => {
  const seed = buildSeed(TODAY);
  const lessonIds = new Set(seed.lessons.map((l) => l.id));
  const courseIds = new Set(seed.courses.map((c) => c.id));
  const decks = new Map(seed.decks.map((d) => [d.id, d]));

  it('link only to lessons, courses, decks and slides that exist', () => {
    expect(seed.notes.length).toBeGreaterThan(5);
    for (const n of seed.notes) {
      if (n.lessonId) expect(lessonIds.has(n.lessonId), n.id).toBe(true);
      if (n.courseId) expect(courseIds.has(n.courseId), n.id).toBe(true);
      if (n.deckId) expect(decks.has(n.deckId), n.id).toBe(true);
      if (n.slideId) expect(decks.get(n.deckId!)?.slides.some((s) => s.id === n.slideId), n.id).toBe(true);
      if (n.lessonId) expect(seed.lessons.find((l) => l.id === n.lessonId)?.courseId, n.id).toBe(n.courseId);
    }
  });

  it('give every course a weekly timetable', () => {
    for (const c of seed.courses) {
      expect(c.meetings?.length, c.id).toBeGreaterThan(0);
      for (const m of c.meetings!) expect(m.weekday).toBeGreaterThanOrEqual(0);
    }
    expect(openTasks(seed.notes).length).toBeGreaterThan(5);
  });
});

describe('notes storage', () => {
  beforeEach(async () => {
    await Promise.all([db.notes.clear(), db.courses.clear(), db.lessons.clear(), db.decks.clear()]);
  });

  it('creates, queries by date and slide, deletes and restores', async () => {
    const a = await createNote({ title: 'Slide idea', deckId: 'd1', slideId: 's2', tags: ['Idea', '#idea'] });
    const b = await createNote({ title: 'Reminder', date: '2026-10-21', time: '09:00' });
    await createNote({ title: 'Undated' });
    expect(a.tags).toEqual(['idea']);
    expect((await notesForSlide('d1', 's2')).map((n) => n.id)).toEqual([a.id]);
    expect((await notesBetween('2026-10-19', '2026-10-25')).map((n) => n.id)).toEqual([b.id]);
    const undo = await deleteNote(b.id);
    expect(await db.notes.get(b.id)).toBeUndefined();
    await undo();
    expect((await db.notes.get(b.id))?.title).toBe('Reminder');
  });

  it('keeps notes when a lesson is deleted and removes them with the course', async () => {
    const course = await createCourse({ title: 'Course' });
    const lesson = await createLesson(course.id, 1);
    const note = await createNote({ title: 'Plan', courseId: course.id, lessonId: lesson.id });
    const undoLesson = await deleteLesson(lesson.id);
    expect((await db.notes.get(note.id))?.lessonId).toBeUndefined();
    expect((await db.notes.get(note.id))?.courseId).toBe(course.id);
    await undoLesson();
    expect((await db.notes.get(note.id))?.lessonId).toBe(lesson.id);
    const undoCourse = await deleteCourse(course.id);
    expect(await db.notes.get(note.id)).toBeUndefined();
    await undoCourse();
    expect(await db.notes.get(note.id)).toBeDefined();
  });
});
