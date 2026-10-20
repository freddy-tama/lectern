// Runs drafting jobs: once the presenter approves an outline, its slides are written in batches,
// a few batches at a time, and the job is saved after every batch. A run lives outside the page,
// so it carries on while the person visits another page. A reload leaves the job interrupted,
// and continuing it writes only the slides that are missing.

import { draftToDeck } from '../../core/deck/draft';
import { type Deck, uid } from '../../core/deck/types';
import { getKind } from '../../core/kinds/registry';
import type { DeckDraft } from '../../core/plugins/api';
import {
  type DraftJob, type DraftRequest, type JobBatch, type JobDeck, type PlannedSlide, type WrittenSlide,
  getJob, jobProgress, recoverJobs, replaceJobs, saveJob,
} from '../../data/draft-jobs';
import { addDeck, saveAsset } from '../../data/repo';
import { DraftCallError, STOPS_THE_JOB, draftSlides } from './ai';
import { placePictures } from './make';
import { pictureForDeck } from './pictures';
import { type CallUsage, addUsage } from './usage';

/** Batches written at the same time. */
export const CONCURRENCY = 3;
/** A cached prompt lasts 5 minutes from the start of the call that last used it. This leaves a margin. */
export const WARM_MS = 4 * 60_000;

/** Splits an outline into batches of about 4 to 6 slides; a short deck is one batch. */
export function planBatches(count: number): JobBatch[] {
  if (count <= 0) return [];
  const groups = count <= 6 ? 1 : Math.ceil(count / 5);
  const base = Math.floor(count / groups);
  let extra = count % groups;
  const batches: JobBatch[] = [];
  let next = 1;
  for (let g = 0; g < groups; g++) {
    const size = base + (extra > 0 ? 1 : 0);
    extra -= 1;
    batches.push({ numbers: Array.from({ length: size }, (_, i) => next + i), status: 'todo', tries: 0 });
    next += size;
  }
  return batches;
}

/** The batch's slides that haven't been written yet. */
export function missingIn(deck: Pick<JobDeck, 'slides'>, batch: Pick<JobBatch, 'numbers'>): number[] {
  const have = new Set(deck.slides.map((s) => s.number));
  return batch.numbers.filter((n) => !have.has(n));
}

/** Keeps only slides that were asked for and aren't written yet, in outline order. */
export function mergeSlides(deck: JobDeck, slides: WrittenSlide[], asked: number[]): void {
  const wanted = new Set(asked);
  const have = new Set(deck.slides.map((s) => s.number));
  for (const s of slides) {
    const plan = deck.outline[s.number - 1];
    if (!wanted.has(s.number) || have.has(s.number) || !plan || plan.kind !== s.kind) continue;
    have.add(s.number);
    deck.slides.push(s);
  }
  deck.slides.sort((a, b) => a.number - b.number);
}

/** The outline as the slides calls send it, after the cached prompt. */
export function outlinePayload(deck: JobDeck) {
  return { title: deck.title, slides: deck.outline.map(({ id: _id, ...s }) => s) };
}

// ─── Starting and approving ───────────────────────────────────────────

/** Saves a new job with the AI's outline, waiting for the presenter to approve it. */
export async function createJob(o: {
  request: DraftRequest;
  settings: DraftJob['settings'];
  pictures: File[];
  title: string;
  outline: Omit<PlannedSlide, 'id'>[];
  usage: CallUsage[];
  /** When the outline call started: it wrote the cached prompt. */
  startedAt: number;
}): Promise<DraftJob> {
  const now = Date.now();
  const job: DraftJob = {
    id: uid('job'),
    type: 'deck',
    status: 'outline',
    request: o.request,
    settings: o.settings,
    pictures: o.pictures.map((f) => ({ name: f.name, blob: f })),
    decks: [{ key: uid('jd'), title: o.title, outline: o.outline.map((s) => ({ id: uid('o'), ...s })), batches: [], slides: [] }],
    usage: addUsage({}, o.usage),
    lastCallAt: o.startedAt,
    createdAt: now,
    updatedAt: now,
  };
  await replaceJobs(job);
  return job;
}

/** Saves the presenter's edits to the outline. */
export async function saveOutline(job: DraftJob, title: string, outline: PlannedSlide[]): Promise<void> {
  const deck = job.decks[0]!;
  deck.title = title;
  deck.outline = outline;
  await saveJob(job);
}

/** Fixes the outline and plans its batches. Run the job next to write them. */
export async function approveOutline(job: DraftJob, title: string, outline: PlannedSlide[]): Promise<void> {
  const deck = job.decks[0]!;
  deck.title = title.trim() || 'Untitled deck';
  deck.outline = outline;
  deck.batches = planBatches(outline.length);
  deck.slides = [];
  job.status = 'drafting';
  job.error = undefined;
  await saveJob(job);
}

// ─── Running ──────────────────────────────────────────────────────────

export type SlidesApi = typeof draftSlides;

interface Run {
  controller: AbortController;
  /** "<deck key>:<number>" for each slide being written now. */
  writing: Set<string>;
  done: Promise<void>;
}

const runs = new Map<string, Run>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, ReadonlySet<string>> = new Map();

function notify() {
  snapshot = new Map([...runs].map(([id, r]) => [id, new Set(r.writing)]));
  listeners.forEach((l) => l());
}

/** For useSyncExternalStore: which jobs run in this tab, and which slides they are writing. */
export function subscribeRuns(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function runsSnapshot(): ReadonlyMap<string, ReadonlySet<string>> {
  return snapshot;
}

export const isRunning = (id: string) => runs.has(id);

/** Stops a run and waits for its last save. Written slides stay; the job can be continued. */
export async function stopJob(id: string): Promise<void> {
  const run = runs.get(id);
  run?.controller.abort();
  await run?.done;
}

/** Marks jobs a closed tab left drafting as interrupted. */
export function recover(): Promise<void> {
  return recoverJobs(isRunning);
}

/**
 * Writes every missing slide of a job, then finishes it. Calling it again while it runs returns
 * the same run. When the cached prompt may have gone cold, one batch goes first to write it,
 * and the others follow and read it.
 */
export function runJob(id: string, o: { api?: SlidesApi; finish?: (job: DraftJob) => Promise<unknown>; now?: () => number } = {}): Promise<void> {
  const existing = runs.get(id);
  if (existing) return existing.done;
  const run: Run = { controller: new AbortController(), writing: new Set(), done: Promise.resolve() };
  runs.set(id, run);
  run.done = drive(id, run, o.api ?? draftSlides, o.finish ?? finishJob, o.now ?? Date.now).finally(() => {
    runs.delete(id);
    notify();
  });
  notify();
  return run.done;
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>, stop: () => boolean) {
  let next = 0;
  const lane = async () => {
    while (next < items.length && !stop()) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
}

const halves = (n: number[]) => [n.slice(0, Math.ceil(n.length / 2)), n.slice(Math.ceil(n.length / 2))];

async function drive(id: string, run: Run, api: SlidesApi, finish: (job: DraftJob) => Promise<unknown>, now: () => number) {
  const job = await getJob(id);
  if (!job || job.status === 'done' || job.status === 'outline') return;
  const { signal } = run.controller;
  job.status = 'drafting';
  job.error = undefined;
  await saveJob(job);

  let fatal: DraftCallError | null = null;
  const stopped = () => signal.aborted || fatal !== null;
  const mark = (deck: JobDeck, numbers: number[], on: boolean) => {
    for (const n of numbers) run.writing[on ? 'add' : 'delete'](`${deck.key}:${n}`);
    notify();
  };

  const write = async ({ deck, batch }: { deck: JobDeck; batch: JobBatch }) => {
    if (stopped()) return;
    let want = missingIn(deck, batch);
    let problem = '';
    let retry = true;
    let split = false;
    mark(deck, want, true);
    try {
      // The first try, and one retry for whatever is still missing. A batch that ran too long is retried in halves.
      for (let attempt = 0; attempt < 2 && want.length && (attempt === 0 || retry) && !stopped(); attempt++) {
        const groups = split && want.length > 1 ? halves(want) : [want];
        split = false;
        await Promise.all(groups.map(async (numbers) => {
          job.lastCallAt = now();
          try {
            const r = await api(job.request, outlinePayload(deck), numbers, signal);
            job.usage = addUsage(job.usage, r.usage);
            mergeSlides(deck, r.slides, numbers);
            const gone = missingIn(deck, { numbers });
            if (gone.length) problem = gone.length === 1 ? `Slide ${gone[0]} didn’t come back from the AI.` : `${gone.length} slides didn’t come back from the AI.`;
          } catch (e) {
            if ((e as Error).name === 'AbortError') return;
            const err = e instanceof DraftCallError ? e : new DraftCallError((e as Error).message || 'Something went wrong while drafting.', 'service', 0);
            job.usage = addUsage(job.usage, err.usage);
            problem = err.message;
            if (STOPS_THE_JOB.has(err.code)) fatal = err;
            if (err.code === 'refused') retry = false;
            if (err.code === 'too_long') split = true;
          }
        }));
        batch.tries += groups.length;
        want = missingIn(deck, batch);
        await saveJob(job);
      }
    } finally {
      mark(deck, batch.numbers, false);
    }
    batch.status = !want.length ? 'done' : signal.aborted ? 'todo' : 'failed';
    batch.error = batch.status === 'failed' ? problem || 'These slides couldn’t be written.' : undefined;
    await saveJob(job);
  };

  const queue = job.decks.flatMap((deck) => deck.batches.filter((batch) => missingIn(deck, batch).length).map((batch) => ({ deck, batch })));
  const warm = job.lastCallAt !== undefined && now() - job.lastCallAt < WARM_MS;
  if (!warm && queue.length > 1) await write(queue.shift()!);
  await pool(queue, CONCURRENCY, write, stopped);

  if (signal.aborted || fatal) {
    job.status = 'interrupted';
    job.error = fatal ? (fatal as DraftCallError).message : 'You stopped drafting.';
    await saveJob(job);
    return;
  }
  const { written, planned } = jobProgress(job);
  if (written < planned) {
    const failed = job.decks.flatMap((d) => d.batches).find((b) => b.status === 'failed');
    const left = planned - written;
    job.status = 'interrupted';
    job.error = `${left === 1 ? '1 slide wasn’t' : `${left} slides weren’t`} written. ${failed?.error ?? ''}`.trim();
    await saveJob(job);
    return;
  }
  await finish(job);
}

// ─── Finishing ────────────────────────────────────────────────────────

/**
 * Runs once on each assembled deck, after the last batch and before it is saved. The “check and
 * fix AI drafts” build plugs in here: `(await fitDraft(deck)).deck` from studio/fit-deck, which
 * runs checkDeck and fixes what doesn't fit. Until that lands the deck passes through unchanged.
 */
export async function checkDraft(deck: Deck): Promise<Deck> {
  return deck;
}

/** The field a slide type shows as its heading, for slides kept from the outline. */
function headingKey(kind: string): string | undefined {
  const fields = getKind(kind)?.fields ?? [];
  return (fields.find((f) => f.key === 'title') ?? fields.find((f) => f.type === 'text' || f.type === 'textarea'))?.key;
}

/** A deck draft from what has been written. Slides that weren't written keep their outline heading and point. */
export function jobDraft(job: Pick<DraftJob, 'request'>, deck: JobDeck): DeckDraft {
  const written = new Map(deck.slides.map((s) => [s.number, s]));
  return {
    title: deck.title,
    minutes: job.request.minutes,
    slides: deck.outline.map((plan, i) => {
      const s = written.get(i + 1);
      if (s) return { kind: s.kind, content: s.content, notes: s.notes };
      const key = headingKey(plan.kind);
      return { kind: plan.kind, content: key ? { [key]: plan.title } : {}, notes: { script: plan.point, minutes: plan.minutes } };
    }),
  };
}

/** Saves each deck of the job, places its pictures and marks the job done. Returns the new deck ids. */
export async function finishJob(job: DraftJob): Promise<string[]> {
  const files = job.pictures.map((p) => new File([p.blob], p.name, { type: p.blob.type }));
  const made: string[] = [];
  for (const deck of job.decks) {
    if (deck.deckId || !deck.outline.length) continue;
    const draft = await placePictures(jobDraft(job, deck), files, async (f) => saveAsset(await pictureForDeck(f), f.name));
    const result = await checkDraft(draftToDeck(draft, { ...job.settings, source: 'ai' }));
    await addDeck(result);
    deck.deckId = result.id;
    made.push(result.id);
  }
  // Only the result page needs the job now: drop the material and pictures it kept for resuming.
  job.status = 'done';
  job.error = undefined;
  job.pictures = [];
  job.request = { ...job.request, material: '', pictures: [] };
  await saveJob(job);
  return made;
}
