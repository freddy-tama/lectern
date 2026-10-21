// AI drafting jobs: an outline the presenter approves, then slides written in batches.
// The job is saved after every batch, so a closed tab or a failed batch can pick up where it
// stopped and only the missing slides are written again.
//
// A job makes a list of decks. Making a deck uses one entry; planning a course would add one
// entry per lesson and reuse the same batches, status and resume.

import type { FitReport } from '../core/deck/fit';
import type { Audience, Deck, DeckPurpose, KeyNotes } from '../core/deck/types';
import { db } from './db';

/**
 * outline: waiting for the presenter to approve the outline.
 * drafting: slides are being written in this tab.
 * interrupted: stopped, failed or left mid-way; "Continue drafting" writes what's missing.
 * done: every deck is saved.
 */
export type JobStatus = 'outline' | 'drafting' | 'interrupted' | 'done';

/** One planned slide. */
export interface PlannedSlide {
  /** Stable while the outline is edited and reordered. */
  id: string;
  title: string;
  kind: string;
  minutes: number;
  /** One line: what the slide must get across. */
  point: string;
  /** Ids of the pictures it shows, such as "pic2" for the second picture. */
  pictures: string[];
}

/** A slide as the AI wrote it, numbered by its place in the approved outline (from 1). */
export interface WrittenSlide {
  number: number;
  kind: string;
  content: Record<string, unknown>;
  notes: Partial<KeyNotes>;
}

export interface JobBatch {
  /** The outline numbers this batch writes. */
  numbers: number[];
  status: 'todo' | 'done' | 'failed';
  /** Calls made for it, retries included. */
  tries: number;
  error?: string;
}

/** Tokens used, for one model. */
export interface TokenTally {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
}

/** Tokens used across a job's calls, by model id. */
export type UsageByModel = Record<string, TokenTally>;

export interface JobDeck {
  /** Stable within the job. */
  key: string;
  title: string;
  outline: PlannedSlide[];
  /** Planned when the outline is approved; empty before. */
  batches: JobBatch[];
  /** Slides written so far. */
  slides: WrittenSlide[];
  /** The saved deck, once it is made. */
  deckId?: string;
  /** What the check after drafting fixed, and the other version of the deck for Undo and Redo. */
  fit?: DeckFit;
}

export interface DeckFit {
  report: FitReport;
  /** The version not saved now: the draft as the AI wrote it, or, after Undo, the checked one. */
  other: Deck;
  /** True when the saved deck is the draft as the AI wrote it. */
  undone: boolean;
}

/**
 * What every AI call for this job sends, exactly as sent the first time. The calls share a prompt
 * cache only while this stays byte for byte the same, so later edits (a new title, a reordered
 * outline) travel beside it, never inside it.
 */
export interface DraftRequest {
  topic: string;
  audience: Audience;
  purpose: DeckPurpose;
  minutes: number;
  density?: string;
  material?: string;
  title?: string;
  answers?: { question: string; answer: string }[];
  pictures?: { id: string; name: string; mime: string; data: string }[];
  kinds: unknown[];
  hints: string;
  /** How much one slide holds for the audience, from the layout rules (DENSITY in core/kinds/kit). */
  budget?: { words: number; bullets: number };
}

export interface DraftJob {
  id: string;
  /** What the job makes. Planning a course would be a second type with several decks. */
  type: 'deck';
  status: JobStatus;
  request: DraftRequest;
  /** How each finished deck is set up. */
  settings: { audience: Audience; themeId: string; purpose: DeckPurpose };
  /** The pictures from the files, in order: "pic1" is the first. Kept so a resumed job can place them. */
  pictures: { name: string; blob: Blob }[];
  decks: JobDeck[];
  usage: UsageByModel;
  /** When the last call that shares the cached prompt started. */
  lastCallAt?: number;
  /** Why the job stopped, for the person. */
  error?: string;
  /** Set while the written deck is checked and fixed, before it is saved. */
  checking?: boolean;
  createdAt: number;
  updatedAt: number;
}

export async function saveJob(job: DraftJob): Promise<void> {
  job.updatedAt = Date.now();
  await db.jobs.put(job);
}

export function getJob(id: string): Promise<DraftJob | undefined> {
  return db.jobs.get(id);
}

/** The newest job still waiting for an outline approval or for slides. */
export async function openJob(): Promise<DraftJob | undefined> {
  const jobs = await db.jobs.orderBy('updatedAt').reverse().toArray();
  return jobs.find((j) => j.status !== 'done');
}

export async function deleteJob(id: string): Promise<void> {
  await db.jobs.delete(id);
}

/**
 * Saves a new job in place of any earlier one. One job is kept at a time: a finished job is only
 * needed for its result page, and an unfinished one is offered before a new deck is started.
 */
export async function replaceJobs(job: DraftJob): Promise<void> {
  await db.transaction('rw', db.jobs, async () => {
    await db.jobs.clear();
    await db.jobs.put(job);
  });
}

/**
 * Jobs left "drafting" by a closed tab or a reload are not running any more. They become
 * interrupted, so the page offers to continue them. Jobs this tab is running are left alone.
 */
export async function recoverJobs(running: (id: string) => boolean): Promise<void> {
  const stale = (await db.jobs.where('status').equals('drafting').toArray()).filter((j) => !running(j.id));
  for (const job of stale) {
    job.status = 'interrupted';
    job.error ??= 'Drafting stopped when the page closed.';
    await saveJob(job);
  }
}

/** Slides written out of planned, across the job's decks. */
export function jobProgress(job: Pick<DraftJob, 'decks'>): { written: number; planned: number } {
  return job.decks.reduce((t, d) => ({ written: t.written + d.slides.length, planned: t.planned + d.outline.length }), { written: 0, planned: 0 });
}
