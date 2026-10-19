// Recordings: storage and queries for recorded lectures and their transcripts.

import { uid } from '../core/deck/types';
import type { TranscriptSegment } from '../core/transcribe/types';
import { type Lesson, type Recording, db } from './db';
import { createNote } from './notes';
import { isoDate, purgeAudioLater } from './repo';

/** Asset names for audio start with this, so stray audio can be found and removed. */
export const AUDIO_ASSET = 'recording:';

// ─── Storage ──────────────────────────────────────────────────────────

export async function createRecording(input: Partial<Recording> & Pick<Recording, 'audio' | 'mime' | 'size'>): Promise<Recording> {
  const now = Date.now();
  const recording: Recording = {
    id: uid('r'),
    title: input.title?.trim() || 'Untitled recording',
    courseId: input.courseId,
    lessonId: input.lessonId,
    date: input.date ?? isoDate(new Date()),
    durationSec: input.durationSec ?? 0,
    audio: input.audio,
    mime: input.mime,
    size: input.size,
    status: input.status ?? 'new',
    segments: input.segments ?? [],
    ...(input.language ? { language: input.language } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.fileName ? { fileName: input.fileName } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await db.recordings.add(recording);
  return recording;
}

export async function updateRecording(id: string, patch: Partial<Recording>) {
  await db.recordings.update(id, { ...patch, updatedAt: Date.now() });
}

/** Adds newly transcribed segments to the end of the transcript. */
export async function appendSegments(id: string, segments: TranscriptSegment[], patch: Partial<Recording> = {}) {
  await db.transaction('rw', db.recordings, async () => {
    const rec = await db.recordings.get(id);
    if (!rec) return;
    const from = segments[0]?.start ?? Infinity;
    // A resumed run may overlap what was already saved: the new text wins.
    const kept = rec.segments.filter((s) => s.start < from - 0.05);
    await db.recordings.update(id, { ...patch, segments: [...kept, ...segments], updatedAt: Date.now() });
  });
}

/** Replaces the text of segments, by index. Emptied segments are removed. */
export async function editSegments(id: string, edits: Record<number, string>) {
  await db.transaction('rw', db.recordings, async () => {
    const rec = await db.recordings.get(id);
    if (!rec) return;
    const segments = rec.segments
      .map((s, i) => (i in edits ? { ...s, text: (edits[i] ?? '').replace(/\s+/g, ' ').trim() } : s))
      .filter((s) => s.text);
    await db.recordings.update(id, { segments, updatedAt: Date.now() });
  });
}

/** Deletes a recording and, a little later, its audio. Notes made from it lose the link. Returns undo. */
export async function deleteRecording(id: string): Promise<() => Promise<void>> {
  const rec = await db.recordings.get(id);
  const notes = await db.notes.where('recordingId').equals(id).toArray();
  await db.transaction('rw', db.recordings, db.notes, async () => {
    await db.recordings.delete(id);
    for (const n of notes) await db.notes.update(n.id, { recordingId: undefined });
  });
  if (rec) purgeAudioLater([rec.audio]);
  return async () => {
    if (!rec) return;
    await db.transaction('rw', db.recordings, db.notes, async () => {
      await db.recordings.put(rec);
      for (const n of notes) await db.notes.update(n.id, { recordingId: id });
    });
  };
}

/**
 * Removes audio no recording uses, left behind when the tab closed before a delete finished.
 * Only touches audio assets older than an hour, so audio being saved right now is safe.
 */
export async function purgeOrphanAudio() {
  const used = new Set((await db.recordings.toArray()).map((r) => r.audio));
  const cutoff = Date.now() - 3_600_000;
  const stale: string[] = [];
  await db.assets.each((a) => {
    if (a.name.startsWith(AUDIO_ASSET) && a.createdAt < cutoff && !used.has(`asset:${a.id}`)) stale.push(a.id);
  });
  if (stale.length) await db.assets.bulkDelete(stale);
}

export async function audioBlob(ref: string): Promise<Blob | null> {
  if (!ref.startsWith('asset:')) return null;
  return (await db.assets.get(ref.slice(6)))?.blob ?? null;
}

// ─── Queries ──────────────────────────────────────────────────────────

/** Newest class first. */
export function sortRecordings(list: Recording[]): Recording[] {
  return [...list].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.createdAt - a.createdAt);
}

export async function recordingsForLesson(lessonId: string) {
  return sortRecordings(await db.recordings.where('lessonId').equals(lessonId).toArray());
}

export async function recordingsForCourse(courseId: string) {
  return sortRecordings(await db.recordings.where('courseId').equals(courseId).toArray());
}

export async function notesForRecording(recordingId: string) {
  return (await db.notes.where('recordingId').equals(recordingId).toArray()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Words in the title or transcript. Every word must match. */
export function searchRecordings(list: Recording[], query: string): Recording[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((r) => {
    const hay = `${r.title}\n${r.fileName ?? ''}\n${r.segments.map((s) => s.text).join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ─── Links ────────────────────────────────────────────────────────────

/** A default title from the lesson, or the date. */
export function recordingTitle(o: { lesson?: Pick<Lesson, 'title'>; fileName?: string; date?: string }): string {
  if (o.lesson) return o.lesson.title;
  if (o.fileName) {
    const base = o.fileName.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').trim();
    if (base && !/^(rec|recording|audio|voice|new recording|untitled)[\s\d-]*$/i.test(base)) return base.slice(0, 120);
  }
  const date = o.date ? new Date(`${o.date}T12:00:00`) : new Date();
  return `Class on ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`;
}

/** Picking a lesson also sets its course and, when the recording has none, its date. */
export function linkToLesson(rec: Pick<Recording, 'date'> | undefined, lesson: Lesson | undefined): Partial<Recording> {
  if (!lesson) return { lessonId: undefined };
  return { lessonId: lesson.id, courseId: lesson.courseId, ...(lesson.date && !rec?.date ? { date: lesson.date } : {}) };
}

/** Picking a course drops a lesson from another course. */
export function linkToCourse(rec: Pick<Recording, 'lessonId'>, courseId: string | undefined, lessons: Map<string, Lesson>): Partial<Recording> {
  const patch: Partial<Recording> = { courseId };
  if (rec.lessonId && lessons.get(rec.lessonId)?.courseId !== courseId) patch.lessonId = undefined;
  return patch;
}

/**
 * The lesson a new recording most likely belongs to: one on today's schedule,
 * preferring the one under way or the latest that has started.
 */
export function lessonForNow(lessons: Lesson[], now = new Date()): Lesson | undefined {
  const today = isoDate(now);
  const todays = lessons.filter((l) => l.date === today);
  if (todays.length <= 1) return todays[0];
  const minutes = now.getHours() * 60 + now.getMinutes();
  const startOf = (l: Lesson) => {
    const [h, m] = (l.time ?? '').split(':').map(Number);
    return Number.isFinite(h) ? (h ?? 0) * 60 + (m || 0) : -1;
  };
  const started = todays.filter((l) => startOf(l) <= minutes).sort((a, b) => startOf(b) - startOf(a));
  return started[0] ?? [...todays].sort((a, b) => startOf(a) - startOf(b))[0];
}

/** Creates a note made from a recording, linked to the same lesson and course. */
export async function noteFromRecording(rec: Recording, o: { title: string; body: string; tags: string[]; lesson?: Lesson }) {
  const note = await createNote({
    title: o.title,
    body: o.body,
    tags: o.tags,
    courseId: rec.courseId ?? o.lesson?.courseId,
    lessonId: rec.lessonId,
    deckId: o.lesson?.deckId,
    date: o.lesson?.date ?? rec.date,
  });
  await db.notes.update(note.id, { recordingId: rec.id });
  return note;
}
