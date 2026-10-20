// Backups: everything Lectern keeps in this browser in one .zip file, and restoring
// one without losing anything already here. Restoring adds and merges; it never wipes.
//
// Inside the zip: lectern-backup.json (every table) and files/ (pictures, logos and,
// when asked for, recordings' audio). Transcripts are always in the JSON.

import type JSZip from 'jszip';
import type { Deck } from '../core/deck/types';
import { deckPurpose, uid } from '../core/deck/types';
import { assetRefs } from './blobs';
import { type Asset, type Course, type Lesson, type Note, type Recording, type Setting, type StudyMark, db } from './db';
import { loadLooks } from './looks';
import { isoDate } from './repo';

export const BACKUP_FORMAT = 'lectern-backup';
export const BACKUP_VERSION = 1;
const MANIFEST = 'lectern-backup.json';

const README = `This is a Lectern backup.

To restore it, open Lectern and choose "Restore from a backup", then pick this .zip file.
Restoring adds what is in the backup and keeps everything already in that browser.
Don't change or rename the files inside, or Lectern may not be able to read it.
`;

export interface BackupTables {
  courses: Course[];
  lessons: Lesson[];
  decks: Deck[];
  notes: Note[];
  recordings: Recording[];
  study: StudyMark[];
  settings: Setting[];
}

export interface BackupAssetEntry {
  id: string;
  mime: string;
  name: string;
  createdAt: number;
  /** Bytes. */
  size: number;
  /** Path of the file inside the zip. */
  file: string;
  /** Where a picture came from and its licence, when the picture finder knows it. */
  credit?: Asset['credit'];
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  /** When the backup was made (ISO time). */
  exportedAt: string;
  /** Recordings' audio is included. */
  audio: boolean;
  tables: BackupTables;
  assets: BackupAssetEntry[];
}

/** What a backup holds, for the screens before and after. */
export interface BackupCounts {
  decks: number;
  courses: number;
  lessons: number;
  notes: number;
  recordings: number;
  /** Pictures and logos. */
  pictures: number;
  /** Recordings whose audio is included. */
  audio: number;
}

/** A backup could not be read. The message is written for the person. */
export class BackupError extends Error {
  override name = 'BackupError';
}

const NOT_A_BACKUP = 'This isn’t a Lectern backup. Choose the .zip file you saved with “Download a backup”.';

/** The asset ids recordings use for their audio. */
function audioIds(recordings: Pick<Recording, 'audio'>[]): Set<string> {
  return new Set(recordings.map((r) => r.audio).filter((a) => a?.startsWith('asset:')).map((a) => a.slice(6)));
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

function extension(mime: string) {
  return EXTENSIONS[mime.split(';')[0].trim().toLowerCase()] ?? 'bin';
}

async function loadZip() {
  const { default: Zip } = await import('jszip');
  return Zip;
}

// ─── Making a backup ──────────────────────────────────────────────────

export interface MadeBackup {
  blob: Blob;
  fileName: string;
  counts: BackupCounts;
}

export async function createBackup(options: { audio?: boolean } = {}): Promise<MadeBackup> {
  const audio = Boolean(options.audio);
  const tables: BackupTables = await db.transaction('r', [db.courses, db.lessons, db.decks, db.notes, db.recordings, db.study, db.settings], async () => {
    const [courses, lessons, decks, notes, recordings, study, settings] = await Promise.all([
      db.courses.toArray(), db.lessons.toArray(), db.decks.toArray(), db.notes.toArray(), db.recordings.toArray(), db.study.toArray(), db.settings.toArray(),
    ]);
    return { courses, lessons, decks, notes, recordings, study, settings };
  });

  // Only files something still uses: pictures in decks, notes and looks, and audio when asked for.
  const audioSet = audioIds(tables.recordings);
  const wanted = assetRefs({ courses: tables.courses, lessons: tables.lessons, decks: tables.decks, notes: tables.notes, settings: tables.settings });
  if (audio) for (const id of audioSet) wanted.add(id);

  const Zip = await loadZip();
  const zip = new Zip();
  const entries: BackupAssetEntry[] = [];
  let pictures = 0;
  let audioFiles = 0;
  for (const id of wanted) {
    const asset = await db.assets.get(id);
    if (!asset) continue;
    const file = `files/${id}.${extension(asset.mime || asset.blob.type)}`;
    // Pictures and audio are already compressed, so they're stored as they are.
    zip.file(file, new Uint8Array(await asset.blob.arrayBuffer()), { binary: true, compression: 'STORE' });
    entries.push({ id, mime: asset.mime || asset.blob.type, name: asset.name, createdAt: asset.createdAt, size: asset.blob.size, file, ...(asset.credit ? { credit: asset.credit } : {}) });
    if (audioSet.has(id)) audioFiles++;
    else pictures++;
  }

  const manifest: BackupManifest = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), audio, tables, assets: entries };
  zip.file(MANIFEST, JSON.stringify(manifest), { compression: 'DEFLATE' });
  zip.file('README.txt', README, { compression: 'DEFLATE' });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });

  return {
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    fileName: `Lectern backup ${isoDate(new Date())}.zip`,
    counts: countsOf(tables, pictures, audioFiles),
  };
}

function countsOf(tables: BackupTables, pictures: number, audio: number): BackupCounts {
  return {
    decks: tables.decks.length,
    courses: tables.courses.length,
    lessons: tables.lessons.length,
    notes: tables.notes.length,
    recordings: tables.recordings.length,
    pictures,
    audio,
  };
}

// ─── Reading a backup ─────────────────────────────────────────────────

/** A deck that is both here and in the backup, with different contents. */
export interface DeckConflict {
  id: string;
  title: string;
  /** The copy in this browser was changed after the backup's. */
  newerHere: boolean;
}

/** A backup that was read and checked, ready to restore. */
export interface OpenedBackup {
  manifest: BackupManifest;
  counts: BackupCounts;
  conflicts: DeckConflict[];
  zip: JSZip;
}

function hasId(value: unknown): boolean {
  const v = value as { id?: unknown } | null;
  return !!v && typeof v === 'object' && typeof v.id === 'string' && v.id.length > 0;
}

function list<T>(value: unknown, keep: (v: unknown) => boolean): T[] {
  return Array.isArray(value) ? (value.filter(keep) as T[]) : [];
}

/** Reads a backup file and checks it, or explains why it can't be used. Changes nothing. */
export async function openBackup(file: Blob): Promise<OpenedBackup> {
  const Zip = await loadZip();
  let zip: JSZip;
  try {
    zip = await Zip.loadAsync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new BackupError(NOT_A_BACKUP);
  }
  const text = await zip.file(MANIFEST)?.async('string');
  if (!text) throw new BackupError(NOT_A_BACKUP);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new BackupError('This backup is damaged, so it can’t be restored.');
  }
  if (!raw || raw.format !== BACKUP_FORMAT) throw new BackupError(NOT_A_BACKUP);
  const version = Number(raw.version);
  if (Number.isInteger(version) && version > BACKUP_VERSION) {
    throw new BackupError('This backup was made by a newer version of Lectern. Reload Lectern to update it, then try again.');
  }
  if (version !== BACKUP_VERSION) throw new BackupError('This backup is damaged, so it can’t be restored.');

  const t = (raw.tables && typeof raw.tables === 'object' ? raw.tables : {}) as Record<string, unknown>;
  const tables: BackupTables = {
    courses: list<Course>(t.courses, hasId),
    lessons: list<Lesson>(t.lessons, hasId),
    decks: list<Deck>(t.decks, (d) => hasId(d) && Array.isArray((d as Deck).slides)),
    notes: list<Note>(t.notes, hasId),
    recordings: list<Recording>(t.recordings, (r) => hasId(r) && Array.isArray((r as Recording).segments)),
    study: list<StudyMark>(t.study, (s) => typeof (s as StudyMark)?.deckId === 'string' && typeof (s as StudyMark)?.slideId === 'string'),
    settings: list<Setting>(t.settings, (s) => typeof (s as Setting)?.key === 'string'),
  };
  const assets = list<BackupAssetEntry>(raw.assets, (a) => hasId(a) && typeof (a as BackupAssetEntry).file === 'string' && !!zip.file((a as BackupAssetEntry).file));
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    audio: raw.audio === true,
    tables,
    assets,
  };

  const here = await db.decks.bulkGet(tables.decks.map((d) => d.id));
  const conflicts: DeckConflict[] = [];
  tables.decks.forEach((deck, i) => {
    const local = here[i];
    if (local && local.updatedAt !== deck.updatedAt) conflicts.push({ id: deck.id, title: local.title || deck.title, newerHere: local.updatedAt > deck.updatedAt });
  });

  const audioSet = audioIds(tables.recordings);
  const audio = assets.filter((a) => audioSet.has(a.id)).length;
  return { manifest, counts: countsOf(tables, assets.length - audio, audio), conflicts, zip };
}

// ─── Restoring ────────────────────────────────────────────────────────

/** What to do with decks that are in both places and differ. */
export type ConflictChoice = 'replace' | 'copy';

export interface RestoreResult {
  added: BackupCounts;
  /** Items here that the backup's newer copy replaced. */
  updated: Pick<BackupCounts, 'courses' | 'lessons' | 'notes' | 'recordings'>;
  decksReplaced: number;
  decksCopied: number;
  /** Recordings restored with their transcript but without audio. */
  withoutAudio: number;
  looks: number;
}

/** Keeps whichever copy of a record changed last. Returns what to write. */
function newer<T extends { id: string; updatedAt: number }>(incoming: T[], local: (T | undefined)[]) {
  const add: T[] = [];
  const replace: T[] = [];
  incoming.forEach((item, i) => {
    const mine = local[i];
    if (!mine) add.push(item);
    else if ((item.updatedAt ?? 0) > (mine.updatedAt ?? 0)) replace.push(item);
  });
  return { add, replace };
}

/**
 * Restores a backup into this browser. Nothing here is deleted: new items are added,
 * an item in both places keeps the copy changed last, and decks that differ are
 * replaced or kept side by side as the person chose.
 */
export async function restoreBackup(backup: OpenedBackup, choice: ConflictChoice = 'copy'): Promise<RestoreResult> {
  const { tables, assets } = backup.manifest;

  // Files are unpacked first: a database transaction can't wait on anything else.
  const present = await db.assets.bulkGet(assets.map((a) => a.id));
  const newFiles: Asset[] = [];
  for (const [i, entry] of assets.entries()) {
    if (present[i]) continue;
    const bytes = await backup.zip.file(entry.file)!.async('uint8array');
    const credit = entry.credit && typeof entry.credit === 'object' ? entry.credit : undefined;
    newFiles.push({ id: entry.id, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: entry.mime }), mime: entry.mime, name: entry.name, createdAt: entry.createdAt || Date.now(), ...(credit ? { credit } : {}) });
  }
  const inBackup = new Set(assets.map((a) => a.id));
  const audioSet = audioIds(tables.recordings);

  const result = await db.transaction('rw', [db.courses, db.lessons, db.decks, db.notes, db.recordings, db.study, db.settings, db.assets], async () => {
    // Audio that is neither in the backup nor in this browser: keep the transcript, drop the link.
    const notInBackup = [...audioSet].filter((id) => !inBackup.has(id));
    const found = notInBackup.length ? await db.assets.bulkGet(notInBackup) : [];
    const stillMissing = new Set(notInBackup.filter((_, i) => !found[i]));
    if (newFiles.length) await db.assets.bulkPut(newFiles);

    const courses = newer(tables.courses, await db.courses.bulkGet(tables.courses.map((c) => c.id)));
    const lessons = newer(tables.lessons, await db.lessons.bulkGet(tables.lessons.map((l) => l.id)));
    const notes = newer(tables.notes, await db.notes.bulkGet(tables.notes.map((n) => n.id)));
    const recordings = newer(tables.recordings, await db.recordings.bulkGet(tables.recordings.map((r) => r.id)));
    let withoutAudio = 0;
    const fixAudio = (r: Recording): Recording => {
      if (!r.audio?.startsWith('asset:') || !stillMissing.has(r.audio.slice(6))) return r;
      withoutAudio++;
      return { ...r, audio: '' };
    };
    await db.courses.bulkPut([...courses.add, ...courses.replace]);
    await db.lessons.bulkPut([...lessons.add, ...lessons.replace]);
    await db.notes.bulkPut([...notes.add, ...notes.replace]);
    await db.recordings.bulkPut([...recordings.add, ...recordings.replace].map(fixAudio));

    // Decks: new ones are added; ones that differ are replaced or kept as copies.
    const localDecks = await db.decks.bulkGet(tables.decks.map((d) => d.id));
    const deckWrites: Deck[] = [];
    let decksAdded = 0;
    let decksReplaced = 0;
    let decksCopied = 0;
    tables.decks.forEach((deck, i) => {
      const mine = localDecks[i];
      if (!mine) { deckWrites.push(deck); decksAdded++; return; }
      if (mine.updatedAt === deck.updatedAt) return;
      if (choice === 'replace') { deckWrites.push(deck); decksReplaced++; return; }
      const copy: Deck = { ...deck, id: uid('d'), title: `${deck.title} (from backup)`, purpose: deckPurpose(deck) };
      delete copy.lessonId;
      deckWrites.push(copy);
      decksCopied++;
    });
    await db.decks.bulkPut(deckWrites);

    // Study progress: the later mark wins.
    const marks = await db.study.bulkGet(tables.study.map((s) => [s.deckId, s.slideId] as [string, string]));
    await db.study.bulkPut(tables.study.filter((s, i) => !marks[i] || (s.updatedAt ?? 0) > (marks[i]!.updatedAt ?? 0)));

    // Settings: looks are merged by id (a look already here wins); other settings are only added.
    let looksAdded = 0;
    for (const setting of tables.settings) {
      const mine = await db.settings.get(setting.key);
      if (setting.key === 'looks') {
        const theirs = Array.isArray(setting.value) ? setting.value as { id?: string }[] : [];
        const ours = Array.isArray(mine?.value) ? mine.value as { id?: string }[] : [];
        const known = new Set(ours.map((l) => l?.id));
        const extra = theirs.filter((l) => l?.id && !known.has(l.id));
        looksAdded = extra.length;
        if (extra.length) await db.settings.put({ key: 'looks', value: [...ours, ...extra] });
      } else if (!mine) {
        await db.settings.put(setting);
      }
    }

    return {
      added: {
        decks: decksAdded,
        courses: courses.add.length,
        lessons: lessons.add.length,
        notes: notes.add.length,
        recordings: recordings.add.length,
        pictures: newFiles.filter((f) => !audioSet.has(f.id)).length,
        audio: newFiles.filter((f) => audioSet.has(f.id)).length,
      },
      updated: { courses: courses.replace.length, lessons: lessons.replace.length, notes: notes.replace.length, recordings: recordings.replace.length },
      decksReplaced,
      decksCopied,
      withoutAudio,
      looks: looksAdded,
    } satisfies RestoreResult;
  });

  if (result.looks) await loadLooks();
  return result;
}
