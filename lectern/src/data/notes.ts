// Notes: storage, queries and the small text helpers the notes UI shares.

import { uid } from '../core/deck/types';
import { db, type Note } from './db';

// ─── Storage ──────────────────────────────────────────────────────────

export async function createNote(input: Partial<Note> = {}): Promise<Note> {
  const now = Date.now();
  const note: Note = {
    id: uid('n'),
    title: input.title?.trim() ?? '',
    body: input.body ?? '',
    tags: normalizeTags(input.tags ?? []),
    courseId: input.courseId,
    lessonId: input.lessonId,
    deckId: input.deckId,
    slideId: input.slideId,
    date: input.date,
    time: input.date ? input.time : undefined,
    pinned: input.pinned,
    mood: input.mood,
    createdAt: now,
    updatedAt: now,
  };
  await db.notes.add(note);
  return note;
}

export async function updateNote(id: string, patch: Partial<Note>) {
  const next = { ...patch, updatedAt: Date.now() };
  if (patch.tags) next.tags = normalizeTags(patch.tags);
  await db.notes.update(id, next);
}

/** Deletes a note. Returns a function that restores it. */
export async function deleteNote(id: string): Promise<() => Promise<void>> {
  const note = await db.notes.get(id);
  await db.notes.delete(id);
  return async () => {
    if (note) await db.notes.put(note);
  };
}

// ─── Queries ──────────────────────────────────────────────────────────

/** Pinned first, then most recently changed. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
}

export async function notesForLesson(lessonId: string) {
  return sortNotes(await db.notes.where('lessonId').equals(lessonId).toArray());
}

export async function notesForCourse(courseId: string) {
  return sortNotes(await db.notes.where('courseId').equals(courseId).toArray());
}

export async function notesForDeck(deckId: string) {
  return sortNotes(await db.notes.where('deckId').equals(deckId).toArray());
}

export async function notesForSlide(deckId: string, slideId: string) {
  return sortNotes((await db.notes.where('deckId').equals(deckId).toArray()).filter((n) => n.slideId === slideId));
}

/** Dated notes between two ISO dates, inclusive, in date and time order. */
export async function notesBetween(from: string, to: string) {
  const notes = await db.notes.where('date').between(from, to, true, true).toArray();
  return notes.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.time ?? '99').localeCompare(b.time ?? '99'));
}

/** Every tag in use with how many notes carry it, most used first. */
export async function allTags(): Promise<{ tag: string; count: number }[]> {
  const counts = new Map<string, number>();
  for (const note of await db.notes.toArray()) {
    for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Filters notes by words in the title, body and tags. Every word must match. */
export function searchNotes(notes: Note[], query: string): Note[] {
  const words = query.toLowerCase().split(/\s+/).map((w) => w.replace(/^#+/, '')).filter(Boolean);
  if (!words.length) return notes;
  return notes.filter((n) => {
    const hay = `${n.title}\n${n.body}\n${n.tags.join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ─── Text helpers ─────────────────────────────────────────────────────

/** The note's title, or its first line when it has none. */
export function noteTitle(note: Pick<Note, 'title' | 'body'>): string {
  if (note.title.trim()) return note.title.trim();
  const first = note.body.split('\n').map((l) => stripMarks(l)).find(Boolean);
  return first ? (first.length > 60 ? `${first.slice(0, 59)}…` : first) : 'Untitled note';
}

/** A one-paragraph plain-text preview of the body. */
export function notePreview(note: Pick<Note, 'title' | 'body'>, max = 160): string {
  const lines = note.body.split('\n').map((l) => stripMarks(l)).filter(Boolean);
  // When the title came from the first line, don't repeat it.
  if (!note.title.trim()) lines.shift();
  const text = lines.join(' · ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Removes Markdown marks from one line. */
export function stripMarks(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '');
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))];
}

/** Reads tags from free text such as "planning, #week-3 reflection". */
export function parseTags(input: string): string[] {
  return normalizeTags(input.split(/[\s,]+/));
}

// ─── Checklists ───────────────────────────────────────────────────────

export interface ChecklistItem {
  /** Line index in the body. */
  line: number;
  text: string;
  done: boolean;
}

const TASK = /^(\s*[-*+]\s+)\[([ xX])\](\s+)(.*)$/;

export function checklistItems(body: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  body.split('\n').forEach((line, i) => {
    const m = TASK.exec(line);
    if (m) items.push({ line: i, text: m[4]!.trim(), done: m[2] !== ' ' });
  });
  return items;
}

/** Flips the checkbox on one line of the body. */
export function toggleChecklistItem(body: string, line: number): string {
  const lines = body.split('\n');
  const m = TASK.exec(lines[line] ?? '');
  if (!m) return body;
  lines[line] = `${m[1]}[${m[2] === ' ' ? 'x' : ' '}]${m[3]}${m[4]}`;
  return lines.join('\n');
}

export function checklistProgress(body: string): { done: number; total: number } {
  const items = checklistItems(body);
  return { done: items.filter((i) => i.done).length, total: items.length };
}

/** Open tasks across notes, for to-do lists on Home and lesson pages. */
export function openTasks(notes: Note[]): { note: Note; item: ChecklistItem }[] {
  return notes.flatMap((note) => checklistItems(note.body).filter((i) => !i.done).map((item) => ({ note, item })));
}
