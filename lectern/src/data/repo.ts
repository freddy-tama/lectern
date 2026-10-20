import type { Deck } from '../core/deck/types';
import { uid } from '../core/deck/types';
import { type Asset, type Course, type CourseColor, COURSE_COLORS, type Lesson, type Note, type Recording, db } from './db';
import { keepStorage } from './storage';

export async function ensureSeeded() {
  const seeded = await db.settings.get('seeded');
  if (!seeded) {
    const count = await db.courses.count();
    if (count === 0) await loadSampleData();
    await db.settings.put({ key: 'seeded', value: true });
  }
  await addSampleNotes();
}

/** Sample notes and timetables came after the first samples. Adds them once where the sample courses still exist. */
async function addSampleNotes() {
  if (await db.settings.get('seeded-notes')) return;
  await db.settings.put({ key: 'seeded-notes', value: true });
  if (!(await db.courses.get('course_earth'))) return;
  const { buildSeed } = await import('./seed');
  const { buildSeedNotes } = await import('./seed-notes');
  const today = new Date();
  const notes = buildSeedNotes(today, isoDate(today), await db.lessons.toArray());
  const { courses } = buildSeed(today);
  await db.transaction('rw', db.notes, db.courses, async () => {
    await db.notes.bulkPut(notes);
    for (const c of courses) {
      const stored = await db.courses.get(c.id);
      if (stored && !stored.meetings && c.meetings) await db.courses.update(c.id, { meetings: c.meetings });
    }
  });
}

export async function loadSampleData() {
  const { buildSeed } = await import('./seed');
  const { courses, lessons, decks, notes } = buildSeed(new Date());
  await db.transaction('rw', [db.courses, db.lessons, db.decks, db.notes], async () => {
    await db.courses.bulkPut(courses);
    await db.lessons.bulkPut(lessons);
    await db.decks.bulkPut(decks);
    await db.notes.bulkPut(notes);
  });
  await db.settings.put({ key: 'seeded-notes', value: true });
}

/** Removes everything and loads the samples again. */
export async function resetAll(withSamples = true) {
  await db.transaction('rw', [db.courses, db.lessons, db.decks, db.assets, db.study, db.notes, db.recordings], async () => {
    await Promise.all([db.courses.clear(), db.lessons.clear(), db.decks.clear(), db.assets.clear(), db.study.clear(), db.notes.clear(), db.recordings.clear()]);
  });
  if (withSamples) await loadSampleData();
}

// ─── Dates ────────────────────────────────────────────────────────────

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIso(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function mondayOf(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  return copy;
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

/** Week number (1-based) of a date within a course. */
export function weekOf(course: Pick<Course, 'startDate'>, date: Date): number {
  const start = mondayOf(parseIso(course.startDate));
  const diff = Math.floor((mondayOf(date).getTime() - start.getTime()) / (7 * 86_400_000));
  return diff + 1;
}

export function weekRange(course: Pick<Course, 'startDate'>, week: number): [Date, Date] {
  const start = addDays(mondayOf(parseIso(course.startDate)), (week - 1) * 7);
  return [start, addDays(start, 6)];
}

// ─── Courses ──────────────────────────────────────────────────────────

export async function createCourse(input: Partial<Course> = {}): Promise<Course> {
  const now = Date.now();
  const used = new Set((await db.courses.toArray()).map((c) => c.color));
  const color: CourseColor = input.color ?? COURSE_COLORS.find((c) => !used.has(c)) ?? 'slate';
  const course: Course = {
    id: uid('c'),
    title: input.title?.trim() || 'Untitled course',
    subject: input.subject ?? '',
    description: input.description ?? '',
    color,
    startDate: input.startDate ?? isoDate(mondayOf(new Date())),
    weekTitles: input.weekTitles ?? {},
    ...(input.meetings ? { meetings: input.meetings } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await db.courses.add(course);
  return course;
}

export async function updateCourse(id: string, patch: Partial<Course>) {
  await db.courses.update(id, { ...patch, updatedAt: Date.now() });
}

/** Deletes a course with its lessons, decks, notes and recordings. Returns a function that restores them. */
export async function deleteCourse(id: string): Promise<() => Promise<void>> {
  const course = await db.courses.get(id);
  const lessons = await db.lessons.where('courseId').equals(id).toArray();
  const deckIds = lessons.map((l) => l.deckId).filter(Boolean) as string[];
  const decks = (await db.decks.bulkGet(deckIds)).filter(Boolean) as Deck[];
  const notes = await db.notes.where('courseId').equals(id).toArray();
  const recordings = await db.recordings.where('courseId').equals(id).toArray();
  await db.transaction('rw', [db.courses, db.lessons, db.decks, db.notes, db.recordings], async () => {
    await db.courses.delete(id);
    await db.lessons.bulkDelete(lessons.map((l) => l.id));
    await db.decks.bulkDelete(deckIds);
    await db.notes.bulkDelete(notes.map((n) => n.id));
    await db.recordings.bulkDelete(recordings.map((r) => r.id));
  });
  purgeAudioLater(recordings.map((r) => r.audio));
  return async () => {
    await db.transaction('rw', [db.courses, db.lessons, db.decks, db.notes, db.recordings], async () => {
      if (course) await db.courses.put(course);
      await db.lessons.bulkPut(lessons);
      await db.decks.bulkPut(decks);
      await db.notes.bulkPut(notes);
      await db.recordings.bulkPut(recordings);
    });
  };
}

// ─── Lessons ──────────────────────────────────────────────────────────

export async function createLesson(courseId: string, week: number, input: Partial<Lesson> = {}): Promise<Lesson> {
  const now = Date.now();
  const siblings = await db.lessons.where('[courseId+week]').equals([courseId, week]).toArray();
  const lesson: Lesson = {
    id: uid('l'),
    courseId,
    week,
    order: siblings.reduce((m, l) => Math.max(m, l.order), -1) + 1,
    title: input.title?.trim() || `Lesson ${siblings.length + 1}`,
    summary: input.summary ?? '',
    date: input.date,
    time: input.time,
    durationMinutes: input.durationMinutes ?? 45,
    createdAt: now,
    updatedAt: now,
  };
  await db.lessons.add(lesson);
  return lesson;
}

export async function updateLesson(id: string, patch: Partial<Lesson>) {
  await db.lessons.update(id, { ...patch, updatedAt: Date.now() });
}

/** Deletes a lesson and its deck. Its notes and recordings stay with the course. Returns a function that restores them. */
export async function deleteLesson(id: string): Promise<() => Promise<void>> {
  const lesson = await db.lessons.get(id);
  const deck = lesson?.deckId ? await db.decks.get(lesson.deckId) : undefined;
  const notes = await db.notes.where('lessonId').equals(id).toArray();
  const recordings = await db.recordings.where('lessonId').equals(id).toArray();
  await db.transaction('rw', [db.lessons, db.decks, db.notes, db.recordings], async () => {
    await db.lessons.delete(id);
    if (deck) await db.decks.delete(deck.id);
    await db.notes.bulkPut(notes.map((n) => unlink(n, deck?.id, id)));
    await db.recordings.bulkPut(recordings.map((r): Recording => {
      const next = { ...r };
      delete next.lessonId;
      return next;
    }));
  });
  return async () => {
    await db.transaction('rw', [db.lessons, db.decks, db.notes, db.recordings], async () => {
      if (lesson) await db.lessons.put(lesson);
      if (deck) await db.decks.put(deck);
      await db.notes.bulkPut(notes);
      await db.recordings.bulkPut(recordings);
    });
  };
}

/** A copy of a note without its link to a deleted deck or lesson. */
function unlink(note: Note, deckId?: string, lessonId?: string): Note {
  const next = { ...note };
  if (lessonId && next.lessonId === lessonId) delete next.lessonId;
  if (deckId && next.deckId === deckId) { delete next.deckId; delete next.slideId; }
  return next;
}

// ─── Decks ────────────────────────────────────────────────────────────

export async function saveDeck(deck: Deck) {
  await db.decks.put({ ...deck, updatedAt: Date.now() });
  keepStorage();
}

/** Stores a new deck and, when it belongs to a lesson, links it. */
export async function addDeck(deck: Deck) {
  await db.transaction('rw', db.decks, db.lessons, async () => {
    await db.decks.put(deck);
    if (deck.lessonId) await db.lessons.update(deck.lessonId, { deckId: deck.id, updatedAt: Date.now() });
  });
  keepStorage();
}

export async function deleteDeck(id: string): Promise<() => Promise<void>> {
  const deck = await db.decks.get(id);
  const lessons = await db.lessons.where('deckId').equals(id).toArray();
  const notes = await db.notes.where('deckId').equals(id).toArray();
  await db.transaction('rw', [db.decks, db.lessons, db.notes], async () => {
    await db.decks.delete(id);
    for (const l of lessons) await db.lessons.update(l.id, { deckId: undefined });
    await db.notes.bulkPut(notes.map((n) => unlink(n, id)));
  });
  return async () => {
    await db.transaction('rw', [db.decks, db.lessons, db.notes], async () => {
      if (deck) await db.decks.put(deck);
      for (const l of lessons) await db.lessons.update(l.id, { deckId: id });
      await db.notes.bulkPut(notes);
    });
  };
}

export async function duplicateDeck(id: string): Promise<Deck | undefined> {
  const deck = await db.decks.get(id);
  if (!deck) return undefined;
  const now = Date.now();
  const copy: Deck = { ...structuredClone(deck), id: uid('d'), title: `${deck.title} (copy)`, lessonId: undefined, createdAt: now, updatedAt: now };
  await db.decks.put(copy);
  return copy;
}

// ─── Assets ───────────────────────────────────────────────────────────

const urlCache = new Map<string, string>();

export async function saveAsset(file: Blob, name = 'image'): Promise<string> {
  const asset: Asset = { id: uid('a'), blob: file, mime: file.type || 'application/octet-stream', name, createdAt: Date.now() };
  await db.assets.add(asset);
  return `asset:${asset.id}`;
}

/**
 * Deletes audio assets a little later, unless something links to them again by then
 * (an undo restores the recording within that time). Audio is large, so it isn't left behind.
 */
export function purgeAudioLater(refs: string[], delayMs = 20_000) {
  const ids = refs.filter((r) => r?.startsWith('asset:')).map((r) => r.slice(6));
  if (!ids.length) return;
  setTimeout(async () => {
    const used = new Set((await db.recordings.toArray()).map((r) => r.audio));
    const gone = ids.filter((id) => !used.has(`asset:${id}`));
    if (gone.length) await db.assets.bulkDelete(gone);
    for (const id of gone) {
      const url = urlCache.get(id);
      if (url) URL.revokeObjectURL(url);
      urlCache.delete(id);
    }
  }, delayMs);
}

/** Object URL for "asset:<id>", or the value itself for normal URLs. */
export async function assetUrl(src: string): Promise<string | null> {
  if (!src.startsWith('asset:')) return src;
  const id = src.slice(6);
  const hit = urlCache.get(id);
  if (hit) return hit;
  const asset = await db.assets.get(id);
  if (!asset) return null;
  const url = URL.createObjectURL(asset.blob);
  urlCache.set(id, url);
  return url;
}

/** A data URL for export. SVGs and other formats are rasterised to PNG. */
export async function imageDataUrl(src: string): Promise<string | null> {
  try {
    let blob: Blob | null = null;
    if (src.startsWith('data:')) {
      if (!/^data:image\/svg/i.test(src)) return src;
      blob = await (await fetch(src)).blob();
    } else if (src.startsWith('asset:')) {
      blob = (await db.assets.get(src.slice(6)))?.blob ?? null;
    } else {
      const res = await fetch(src);
      if (!res.ok) return null;
      blob = await res.blob();
    }
    if (!blob) return null;
    if (/^image\/(png|jpeg|gif)$/.test(blob.type)) return await blobToDataUrl(blob);
    return await rasterise(blob);
  } catch {
    return null;
  }
}

/** A stored video as a data URL for export, or null when it is missing or larger than maxBytes. */
export async function mediaDataUrl(src: string, maxBytes = 150 * 1024 * 1024): Promise<string | null> {
  if (src.startsWith('data:')) return src;
  if (!src.startsWith('asset:')) return null;
  const blob = (await db.assets.get(src.slice(6)))?.blob;
  if (!blob || blob.size > maxBytes) return null;
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function rasterise(blob: Blob, maxSide = 2000): Promise<string | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 1600;
    const h = img.naturalHeight || 1200;
    const scale = Math.min(1, maxSide / Math.max(w, h)) * (blob.type.includes('svg') ? Math.max(1, 1600 / Math.max(w, h)) : 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
