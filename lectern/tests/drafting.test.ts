import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';
import { getKind } from '../src/core/kinds/registry';
import { db } from '../src/data/db';
import { type DraftJob, type DraftRequest, type WrittenSlide, getJob, openJob, saveJob } from '../src/data/draft-jobs';
import { DraftCallError } from '../src/features/autodeck/ai';
import {
  CONCURRENCY, WARM_MS, approveOutline, createJob, finishJob, isRunning, jobDraft, mergeSlides, planBatches, recover, runJob, stopJob, type SlidesApi,
} from '../src/features/autodeck/drafting';
import { pictureRoom, withKind } from '../src/features/autodeck/outline';
import { addUsage, usageCost, usageLine } from '../src/features/autodeck/usage';

registerCoreKinds();

const request: DraftRequest = { topic: 'Tides', audience: 'teen', purpose: 'lesson', minutes: 30, material: 'The moon pulls the sea.', kinds: [], hints: '' };
const settings = { audience: 'teen' as const, themeId: 'paper', purpose: 'lesson' as const };
const KINDS = ['title', 'bullets', 'image', 'question', 'summary'];

/** An outline of n slides cycling through a few kinds. */
const outline = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Slide ${i + 1}`, kind: KINDS[i % KINDS.length]!, minutes: 2, point: `Point ${i + 1}`, pictures: [] }));

const written = (n: number, kind: string): WrittenSlide => ({ number: n, kind, content: { title: `Written ${n}` }, notes: { script: `Script ${n}` } });

const usage = [{ model: 'claude-opus-5-5', input: 50, output: 1000, cacheRead: 8000, cacheWrite: 0 }];

/** A fake slides API: answers each call with what `answer` returns, and records calls and how many ran at once. */
function fakeApi(answer: (numbers: number[], call: number) => { skip?: number[]; error?: DraftCallError } = () => ({})) {
  const calls: { numbers: number[]; at: number }[] = [];
  let active = 0;
  let peak = 0;
  let clock = 0;
  const api: SlidesApi = async (_req, plan, numbers) => {
    active += 1;
    peak = Math.max(peak, active);
    calls.push({ numbers, at: clock++ });
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    const a = answer(numbers, calls.length);
    if (a.error) throw a.error;
    return {
      slides: numbers.filter((n) => !a.skip?.includes(n)).map((n) => written(n, plan.slides[n - 1]!.kind)),
      missing: a.skip ?? [],
      usage,
    };
  };
  return { api, calls, peak: () => peak };
}

async function approvedJob(n: number, lastCallAt = Date.now()): Promise<DraftJob> {
  const job = await createJob({ request, settings, pictures: [], title: 'Tides', outline: outline(n), usage, startedAt: lastCallAt });
  await approveOutline(job, 'Tides', job.decks[0]!.outline);
  return (await getJob(job.id))!;
}

const noFinish = async (job: DraftJob) => { job.status = 'done'; await saveJob(job); };

beforeEach(async () => {
  await db.jobs.clear();
  await db.decks.clear();
});

describe('batches', () => {
  it('splits an outline into batches of about four to six', () => {
    const sizes = (n: number) => planBatches(n).map((b) => b.numbers.length);
    expect(sizes(0)).toEqual([]);
    expect(sizes(5)).toEqual([5]);
    expect(sizes(6)).toEqual([6]);
    expect(sizes(7)).toEqual([4, 3]);
    expect(sizes(14)).toEqual([5, 5, 4]);
    expect(sizes(20)).toEqual([5, 5, 5, 5]);
    expect(planBatches(14).flatMap((b) => b.numbers)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });

  it('merges only the slides asked for, with the outline’s kind, once', async () => {
    const job = await approvedJob(5);
    const deck = job.decks[0]!;
    mergeSlides(deck, [written(2, 'bullets'), written(3, 'summary'), written(4, 'question'), written(2, 'bullets')], [2, 3]);
    expect(deck.slides.map((s) => s.number)).toEqual([2]);
  });
});

describe('running a job', () => {
  it('writes every batch, a few at a time, then finishes', async () => {
    const job = await approvedJob(20);
    const fake = fakeApi();
    let finished = false;
    await runJob(job.id, { api: fake.api, finish: async (j) => { finished = true; await noFinish(j); } });
    const saved = (await getJob(job.id))!;
    expect(saved.decks[0]!.slides).toHaveLength(20);
    expect(saved.decks[0]!.batches.every((b) => b.status === 'done')).toBe(true);
    expect(fake.calls).toHaveLength(4);
    expect(fake.peak()).toBeLessThanOrEqual(CONCURRENCY);
    expect(fake.peak()).toBeGreaterThan(1);
    expect(finished).toBe(true);
    // The outline call's usage plus four batches.
    expect(saved.usage['claude-opus-5-5']!.calls).toBe(5);
    expect(isRunning(job.id)).toBe(false);
  });

  it('runs one batch alone first when the cached prompt may have gone cold', async () => {
    const job = await approvedJob(14, Date.now() - WARM_MS - 1000);
    const fake = fakeApi();
    let firstDoneBeforeOthers = false;
    const wrapped: SlidesApi = async (...args) => {
      const r = await fake.api(...args);
      if (fake.calls.length === 1) firstDoneBeforeOthers = true;
      return r;
    };
    await runJob(job.id, { api: wrapped, finish: noFinish });
    expect(fake.calls).toHaveLength(3);
    expect(firstDoneBeforeOthers).toBe(true);
    expect(fake.peak()).toBe(2);
  });

  it('starts batches together while the cache is warm', async () => {
    const job = await approvedJob(14);
    const fake = fakeApi();
    await runJob(job.id, { api: fake.api, finish: noFinish });
    expect(fake.peak()).toBe(3);
  });

  it('retries a bad batch once, asking only for what is missing', async () => {
    const job = await approvedJob(5);
    const fake = fakeApi((_numbers, call) => (call === 1 ? { skip: [2, 4] } : {}));
    await runJob(job.id, { api: fake.api, finish: noFinish });
    expect(fake.calls.map((c) => c.numbers)).toEqual([[1, 2, 3, 4, 5], [2, 4]]);
    const saved = (await getJob(job.id))!;
    expect(saved.status).toBe('done');
    expect(saved.decks[0]!.batches[0]).toMatchObject({ status: 'done', tries: 2 });
  });

  it('retries a batch that ran too long in two halves', async () => {
    const job = await approvedJob(6);
    const fake = fakeApi((_n, call) => (call === 1 ? { error: new DraftCallError('Too long', 'too_long', 422) } : {}));
    await runJob(job.id, { api: fake.api, finish: noFinish });
    expect(fake.calls.map((c) => c.numbers)).toEqual([[1, 2, 3, 4, 5, 6], [1, 2, 3], [4, 5, 6]]);
    expect((await getJob(job.id))!.status).toBe('done');
  });

  it('leaves a failed batch for later, keeps the rest, and continues with only what is missing', async () => {
    const job = await approvedJob(14);
    const busy = new DraftCallError('The AI is busy right now. Wait a minute and try again.', 'busy', 429, [{ model: 'claude-opus-5-5', input: 10, output: 0, cacheRead: 0, cacheWrite: 0 }]);
    const failing = fakeApi((numbers) => (numbers.includes(6) ? { error: busy } : {}));
    await runJob(job.id, { api: failing.api, finish: noFinish });
    let saved = (await getJob(job.id))!;
    expect(saved.status).toBe('interrupted');
    expect(saved.error).toBe('5 slides weren’t written. The AI is busy right now. Wait a minute and try again.');
    expect(saved.decks[0]!.slides).toHaveLength(9);
    expect(saved.decks[0]!.batches.map((b) => b.status)).toEqual(['done', 'failed', 'done']);
    expect(failing.calls.filter((c) => c.numbers.includes(6))).toHaveLength(2);
    expect(await openJob()).toMatchObject({ id: job.id });

    const fine = fakeApi();
    await runJob(job.id, { api: fine.api, finish: noFinish });
    expect(fine.calls.map((c) => c.numbers)).toEqual([[6, 7, 8, 9, 10]]);
    saved = (await getJob(job.id))!;
    expect(saved.status).toBe('done');
    expect(saved.decks[0]!.slides.map((s) => s.number)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });

  it('doesn’t retry a refusal', async () => {
    const job = await approvedJob(5);
    const fake = fakeApi(() => ({ error: new DraftCallError('Declined', 'refused', 422) }));
    await runJob(job.id, { api: fake.api, finish: noFinish });
    expect(fake.calls).toHaveLength(1);
    expect((await getJob(job.id))!.decks[0]!.batches[0]!.status).toBe('failed');
  });

  it('stops the whole job when the server needs the access code', async () => {
    const job = await approvedJob(20);
    const fake = fakeApi(() => ({ error: new DraftCallError('Enter the access code for this server to use AI drafting.', 'needs_code', 401) }));
    await runJob(job.id, { api: fake.api, finish: noFinish });
    expect(fake.calls.length).toBeLessThanOrEqual(CONCURRENCY);
    const saved = (await getJob(job.id))!;
    expect(saved.status).toBe('interrupted');
    expect(saved.error).toBe('Enter the access code for this server to use AI drafting.');
  });

  it('stops when asked, keeping what was written', async () => {
    const job = await approvedJob(20);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let calls = 0;
    const api: SlidesApi = async (_req, plan, numbers, signal) => {
      calls += 1;
      if (calls > 1) {
        await new Promise<void>((resolve, reject) => {
          signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          gate.then(resolve);
        });
      }
      return { slides: numbers.map((n) => written(n, plan.slides[n - 1]!.kind)), missing: [], usage };
    };
    const running = runJob(job.id, { api, finish: noFinish });
    await new Promise((r) => setTimeout(r, 30));
    await stopJob(job.id);
    release();
    await running;
    const saved = (await getJob(job.id))!;
    expect(saved.status).toBe('interrupted');
    expect(saved.error).toBe('You stopped drafting.');
    expect(saved.decks[0]!.slides.length).toBeGreaterThan(0);
    expect(saved.decks[0]!.slides.length).toBeLessThan(20);
    expect(saved.decks[0]!.batches.some((b) => b.status === 'todo')).toBe(true);
  });

  it('marks a job a closed tab left drafting as interrupted', async () => {
    const job = await approvedJob(5);
    expect(job.status).toBe('drafting');
    await recover();
    expect((await getJob(job.id))!.status).toBe('interrupted');
  });

  it('keeps one job at a time', async () => {
    const a = await approvedJob(5);
    const b = await approvedJob(6);
    expect(await getJob(a.id)).toBeUndefined();
    expect((await openJob())!.id).toBe(b.id);
  });
});

describe('finishing', () => {
  it('saves the deck in outline order, with unwritten slides kept from the outline', async () => {
    const job = await approvedJob(5);
    const deck = job.decks[0]!;
    mergeSlides(deck, [written(1, 'title'), written(3, 'image')], [1, 3]);
    const draft = jobDraft(job, deck);
    expect(draft.slides.map((s) => s.kind)).toEqual(['title', 'bullets', 'image', 'question', 'summary']);
    expect(draft.slides[1]).toEqual({ kind: 'bullets', content: { title: 'Slide 2' }, notes: { script: 'Point 2', minutes: 2 } });
    expect(draft.slides[3]!.content).toEqual({ question: 'Slide 4' });

    const [id] = await finishJob(job);
    const saved = await db.decks.get(id!);
    expect(saved!.title).toBe('Tides');
    expect(saved!.source).toBe('ai');
    expect(saved!.slides).toHaveLength(5);
    expect(saved!.slides[0]!.content.title).toBe('Written 1');
    const after = (await getJob(job.id))!;
    expect(after.status).toBe('done');
    expect(after.request.material).toBe('');
    expect(after.decks[0]!.deckId).toBe(id);
    expect(await openJob()).toBeUndefined();
  });
});

describe('outline editing and usage', () => {
  it('keeps only the pictures a new slide type has room for', () => {
    expect(pictureRoom(getKind('gallery')!)).toBe(4);
    expect(pictureRoom(getKind('quote')!)).toBe(0);
    const slide = { id: 'o1', title: 'Look', kind: 'gallery', minutes: 2, point: '', pictures: ['pic1', 'pic2'] };
    expect(withKind(slide, 'image')).toEqual({ kind: 'image', pictures: ['pic1'] });
    expect(withKind(slide, 'quote')).toEqual({ kind: 'quote', pictures: [] });
  });

  it('adds up tokens per model and prices them', () => {
    let total = addUsage({}, [{ model: 'claude-opus-5-5', input: 1_000, output: 10_000, cacheRead: 100_000, cacheWrite: 20_000 }]);
    total = addUsage(total, [{ model: 'claude-opus-5-5', input: 1_000, output: 10_000, cacheRead: 0, cacheWrite: 0 }]);
    expect(total['claude-opus-5-5']).toEqual({ input: 2_000, output: 20_000, cacheRead: 100_000, cacheWrite: 20_000, calls: 2 });
    // 2k × $4 + 20k × $20 + 100k × $0.20 + 20k × $5, per million
    expect(usageCost(total)).toBeCloseTo(0.008 + 0.4 + 0.02 + 0.1, 6);
    expect(usageLine(total)).toBe('142,000 tokens · about $0.53');
    expect(usageCost(addUsage(total, [{ model: 'some-other-model', input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }]))).toBeNull();
  });
});
