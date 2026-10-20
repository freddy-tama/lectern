// Local-first storage in IndexedDB. Everything stays in this browser.

import Dexie, { type EntityTable } from 'dexie';
import type { Deck } from '../core/deck/types';
import type { PictureCredit } from '../core/pictures/credits';
import type { LectureNotes, TranscriptSegment } from '../core/transcribe/types';
import { quotaWatch } from './storage';

export type CourseColor = 'coral' | 'amber' | 'olive' | 'teal' | 'sky' | 'indigo' | 'plum' | 'slate';

export const COURSE_COLORS: CourseColor[] = ['coral', 'amber', 'olive', 'teal', 'sky', 'indigo', 'plum', 'slate'];

export interface Course {
  id: string;
  title: string;
  /** Short subject line, for example "Science · Year 9". */
  subject: string;
  description: string;
  color: CourseColor;
  /** ISO date (YYYY-MM-DD) of the first day of week 1. */
  startDate: string;
  /** Optional names for weeks, keyed by week number. */
  weekTitles: Record<number, string>;
  /** The weekly timetable: when the class meets. Used to date new lessons. */
  meetings?: CourseMeeting[];
  createdAt: number;
  updatedAt: number;
}

/** One weekly class slot. */
export interface CourseMeeting {
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  /** 24-hour "HH:MM". */
  time: string;
  durationMinutes?: number;
  /** Optional place, for example "Room 12" or a video link. */
  room?: string;
}

export interface Lesson {
  id: string;
  courseId: string;
  week: number;
  /** Position inside its week. */
  order: number;
  title: string;
  summary: string;
  /** ISO date (YYYY-MM-DD) when the lesson is taught. */
  date?: string;
  /** 24-hour "HH:MM". */
  time?: string;
  durationMinutes?: number;
  deckId?: string;
  createdAt: number;
  updatedAt: number;
}

/** How a lesson went, recorded on reflection notes. */
export type NoteMood = 'great' | 'okay' | 'rough';

/**
 * A note: a plan, a reflection after class, a reminder or anything else.
 * Notes can stand alone or link to a course, a lesson, a deck and one of its slides.
 */
export interface Note {
  id: string;
  title: string;
  /**
   * Plain text with light Markdown: "# Heading", "- point", "1. step",
   * "- [ ] task" / "- [x] done", **bold**, _italic_ and links.
   */
  body: string;
  /** Lowercase tags without the "#". */
  tags: string[];
  courseId?: string;
  lessonId?: string;
  deckId?: string;
  /** A slide in deckId the note is about. */
  slideId?: string;
  /** ISO date (YYYY-MM-DD) the note is for or due. Dated notes show on the schedule. */
  date?: string;
  /** 24-hour "HH:MM", only with date. */
  time?: string;
  pinned?: boolean;
  /** Set on reflections: how the lesson went. */
  mood?: NoteMood;
  /** The recording this note was made from. */
  recordingId?: string;
  createdAt: number;
  updatedAt: number;
}

export type RecordingStatus = 'new' | 'transcribing' | 'done' | 'error';

/**
 * A recorded lecture or class, with its transcript. The audio stays in this browser
 * as an asset; transcription runs on this device.
 */
export interface Recording {
  id: string;
  title: string;
  courseId?: string;
  lessonId?: string;
  /** ISO date (YYYY-MM-DD) of the class. */
  date?: string;
  durationSec: number;
  /** "asset:<id>" of the audio. Empty while a recording is starting. */
  audio: string;
  mime: string;
  /** Bytes. */
  size: number;
  status: RecordingStatus;
  /** 0–1 while transcribing, and where a stopped transcription got to. */
  progress?: number;
  /** Seconds of audio transcribed so far, so a stopped transcription can resume. */
  transcribedSec?: number;
  /** ISO 639-1 code of the spoken language, chosen or detected. */
  language?: string;
  /** Speech model id used for the transcript. */
  model?: string;
  segments: TranscriptSegment[];
  /** Class notes made from the transcript by AI. */
  summary?: LectureNotes;
  error?: string;
  /** Where the audio came from. */
  source?: 'upload' | 'recorded';
  /** The original file name of an upload. */
  fileName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Asset {
  id: string;
  blob: Blob;
  mime: string;
  name: string;
  createdAt: number;
  /** Where a picture came from and its licence. Pictures from before the picture finder have none. */
  credit?: PictureCredit;
}

export interface StudyMark {
  deckId: string;
  slideId: string;
  status: 'learning' | 'known';
  updatedAt: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

export class LecternDB extends Dexie {
  courses!: EntityTable<Course, 'id'>;
  lessons!: EntityTable<Lesson, 'id'>;
  decks!: EntityTable<Deck, 'id'>;
  assets!: EntityTable<Asset, 'id'>;
  study!: Dexie.Table<StudyMark, [string, string]>;
  settings!: EntityTable<Setting, 'key'>;
  notes!: EntityTable<Note, 'id'>;
  recordings!: EntityTable<Recording, 'id'>;

  constructor() {
    super('lectern');
    this.version(1).stores({
      courses: 'id, updatedAt',
      lessons: 'id, courseId, [courseId+week], date, deckId, updatedAt',
      decks: 'id, lessonId, updatedAt',
      assets: 'id',
      study: '[deckId+slideId], deckId',
      settings: 'key',
    });
    this.version(2).stores({
      notes: 'id, courseId, lessonId, deckId, date, updatedAt, *tags',
    });
    this.version(3).stores({
      notes: 'id, courseId, lessonId, deckId, date, updatedAt, *tags, recordingId',
      recordings: 'id, courseId, lessonId, date, updatedAt',
    });
  }
}

export const db = new LecternDB();

// A save that fails because the browser is out of space reaches the app's storage warning.
db.use(quotaWatch);
