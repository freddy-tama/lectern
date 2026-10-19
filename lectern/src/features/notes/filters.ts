// Pure helpers for the notes list: filters that round-trip through the address bar,
// grouping, and the link rules used by the editor's pickers.

import { type Course, type Lesson, type Note } from '../../data/db';
import { checklistItems, searchNotes } from '../../data/notes';

export interface NoteFilter {
  q: string;
  course?: string;
  lesson?: string;
  deck?: string;
  slide?: string;
  tag?: string;
  /** Only notes linked to a lesson. */
  linked?: boolean;
  /** Only notes with unticked tasks. */
  tasks?: boolean;
  /** Only notes with a date. */
  dated?: boolean;
}

const KEYS = ['course', 'lesson', 'deck', 'slide', 'tag'] as const;
const FLAGS = ['linked', 'tasks', 'dated'] as const;

export function filterFromParams(params: URLSearchParams): NoteFilter {
  const f: NoteFilter = { q: params.get('q') ?? '' };
  for (const k of KEYS) {
    const v = params.get(k);
    if (v) f[k] = k === 'tag' ? v.replace(/^#+/, '').toLowerCase() : v;
  }
  for (const k of FLAGS) if (params.get(k) === '1') f[k] = true;
  return f;
}

export function filterToParams(f: NoteFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  for (const k of KEYS) if (f[k]) p.set(k, f[k]!);
  for (const k of FLAGS) if (f[k]) p.set(k, '1');
  return p;
}

/** True when anything narrows the list. */
export function isFiltering(f: NoteFilter): boolean {
  return Boolean(f.q.trim() || KEYS.some((k) => f[k]) || FLAGS.some((k) => f[k]));
}

export function hasOpenTasks(note: Pick<Note, 'body'>): boolean {
  return checklistItems(note.body).some((i) => !i.done);
}

export function applyFilter(notes: Note[], f: NoteFilter): Note[] {
  const narrowed = notes.filter((n) =>
    (!f.course || n.courseId === f.course)
    && (!f.lesson || n.lessonId === f.lesson)
    && (!f.deck || n.deckId === f.deck)
    && (!f.slide || n.slideId === f.slide)
    && (!f.tag || n.tags.includes(f.tag))
    && (!f.linked || Boolean(n.lessonId))
    && (!f.dated || Boolean(n.date))
    && (!f.tasks || hasOpenTasks(n)));
  return searchNotes(narrowed, f.q);
}

/** Tags with how many of these notes use them, most used first. */
export function tagCounts(notes: Note[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// ─── Links between notes, courses, lessons and decks ──────────────────

export interface LinkRefs {
  lesson: Map<string, Pick<Lesson, 'id' | 'courseId' | 'deckId'>>;
  deck: Map<string, { id: string; lessonId?: string }>;
}

type Links = Pick<Note, 'courseId' | 'lessonId' | 'deckId' | 'slideId'>;

/** Picking a course drops a lesson from another course. */
export function linkCourse(note: Links, courseId: string | undefined, refs: LinkRefs): Partial<Note> {
  const patch: Partial<Note> = { courseId };
  if (note.lessonId && refs.lesson.get(note.lessonId)?.courseId !== courseId) patch.lessonId = undefined;
  return patch;
}

/** Picking a lesson sets its course, and its deck when the note has none. */
export function linkLesson(note: Links, lessonId: string | undefined, refs: LinkRefs): Partial<Note> {
  if (!lessonId) return { lessonId: undefined };
  const lesson = refs.lesson.get(lessonId);
  const patch: Partial<Note> = { lessonId, courseId: lesson?.courseId ?? note.courseId };
  if (!note.deckId && lesson?.deckId) patch.deckId = lesson.deckId;
  return patch;
}

/** Picking a deck clears the slide, and links the deck's lesson when the note has none. */
export function linkDeck(note: Links, deckId: string | undefined, refs: LinkRefs): Partial<Note> {
  const patch: Partial<Note> = { deckId, slideId: undefined };
  const lessonId = deckId ? refs.deck.get(deckId)?.lessonId : undefined;
  if (lessonId && !note.lessonId) {
    patch.lessonId = lessonId;
    const courseId = refs.lesson.get(lessonId)?.courseId;
    if (courseId) patch.courseId = courseId;
  }
  return patch;
}

/** Values for a new note made while a filter is on, so it shows up in the list. */
export function defaultsFor(f: NoteFilter, refs?: LinkRefs): Partial<Note> {
  const d: Partial<Note> = {};
  if (f.course) d.courseId = f.course;
  if (f.deck) Object.assign(d, linkDeck(d, f.deck, refs ?? { lesson: new Map(), deck: new Map() }), f.slide ? { slideId: f.slide } : {});
  if (f.lesson) Object.assign(d, linkLesson(d, f.lesson, refs ?? { lesson: new Map(), deck: new Map() }));
  if (f.tag) d.tags = [f.tag];
  if (f.tasks) d.body = '- [ ] ';
  return d;
}

/**
 * Whether a lesson has been taught: its day is past, or it is today and its time slot has ended.
 * Undated lessons are never over.
 */
export function lessonOver(lesson: Pick<Lesson, 'date' | 'time' | 'durationMinutes'>, today: string, now = new Date()): boolean {
  if (!lesson.date) return false;
  if (lesson.date < today) return true;
  if (lesson.date > today || !lesson.time) return false;
  const [h, m] = lesson.time.split(':').map(Number);
  const end = (h || 0) * 60 + (m || 0) + (lesson.durationMinutes ?? 45);
  return now.getHours() * 60 + now.getMinutes() >= end;
}

/** Lessons grouped by week, in teaching order. */
export function lessonsByWeek(lessons: Lesson[], course?: Pick<Course, 'weekTitles'>): { week: number; label: string; lessons: Lesson[] }[] {
  const weeks = new Map<number, Lesson[]>();
  for (const l of lessons) weeks.set(l.week, [...(weeks.get(l.week) ?? []), l]);
  return [...weeks].sort((a, b) => a[0] - b[0]).map(([week, list]) => ({
    week,
    label: course?.weekTitles?.[week] ? `Week ${week} · ${course.weekTitles[week]}` : `Week ${week}`,
    lessons: list.sort((a, b) => `${a.date ?? '9'}${a.time ?? ''}`.localeCompare(`${b.date ?? '9'}${b.time ?? ''}`) || a.order - b.order),
  }));
}
