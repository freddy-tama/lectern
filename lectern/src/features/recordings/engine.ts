// The transcription engine. It lives outside React, like the sharing session, so a
// transcription keeps running while you move around the app. One recording is
// transcribed at a time; others wait in a queue. Segments are saved as each section
// finishes, so a stopped or interrupted transcription resumes where it left off.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { collapseRepeats } from '../../core/transcribe/segments';
import { type Recording, db } from '../../data/db';
import { appendSegments, audioBlob, purgeOrphanAudio, updateRecording } from '../../data/recordings';
import { decodeAudio } from './decode';
import type { Device, FromWorker } from './protocol';
import { holdWakeLock, releaseWakeLock } from './wake';

// ─── Models and preferences ───────────────────────────────────────────

export type Quality = 'fast' | 'balanced' | 'accurate';

/** Download sizes differ by device: the graphics-chip build keeps more of the model at full precision. */
export const QUALITIES: { id: Quality; label: string; model: string; detail: string; size: Record<Device, string> }[] = [
  { id: 'fast', label: 'Faster', model: 'onnx-community/whisper-tiny', detail: 'Quick draft, more slips', size: { wasm: 'about 40 MB', webgpu: 'about 120 MB' } },
  { id: 'balanced', label: 'Balanced', model: 'onnx-community/whisper-base', detail: 'Good for most classes', size: { wasm: 'about 80 MB', webgpu: 'about 200 MB' } },
  { id: 'accurate', label: 'More accurate', model: 'onnx-community/whisper-small', detail: 'Slower; better with names and accents', size: { wasm: 'about 250 MB', webgpu: 'about 600 MB' } },
];

let device: Promise<Device> | null = null;

/** Whether this browser can run the model on the graphics chip (WebGPU) or only the processor. */
export function speechDevice(): Promise<Device> {
  device ??= (async (): Promise<Device> => {
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean } } | null> } }).gpu;
      const adapter = gpu ? await gpu.requestAdapter() : null;
      return adapter && !adapter.isFallbackAdapter && !adapter.info?.isFallbackAdapter ? 'webgpu' : 'wasm';
    } catch {
      return 'wasm';
    }
  })();
  return device;
}

export function useSpeechDevice(): Device {
  const [value, setValue] = useState<Device>('wasm');
  useEffect(() => {
    let alive = true;
    speechDevice().then((d) => { if (alive) setValue(d); });
    return () => { alive = false; };
  }, []);
  return value;
}

export function qualityOf(model?: string): Quality | undefined {
  return QUALITIES.find((q) => q.model === model)?.id;
}

export function modelLabel(model?: string): string {
  return QUALITIES.find((q) => q.model === model)?.label ?? '';
}

export interface TranscribePrefs {
  quality: Quality;
  /** ISO 639-1 code, or "auto". */
  language: string;
}

const PREFS_KEY = 'lectern.transcribe';

export function loadPrefs(): TranscribePrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<TranscribePrefs>;
    return {
      quality: QUALITIES.some((q) => q.id === saved.quality) ? saved.quality! : 'balanced',
      language: typeof saved.language === 'string' && saved.language ? saved.language : 'auto',
    };
  } catch {
    return { quality: 'balanced', language: 'auto' };
  }
}

export function savePrefs(prefs: TranscribePrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
}

// ─── State ────────────────────────────────────────────────────────────

export type Phase = 'waiting' | 'reading' | 'model' | 'detecting' | 'transcribing';

export interface Job {
  recordingId: string;
  phase: Phase;
  device: Device | null;
  /** Model download, bytes. */
  modelLoaded: number;
  modelTotal: number;
  /** 0–1 of the whole recording. */
  progress: number;
  /** The latest recognised words, for a live preview. */
  preview: string;
  /** Seconds left, once there is enough to estimate. */
  eta: number | null;
  stopping: boolean;
}

export interface EngineSnapshot {
  /** The running job first, then the queue. */
  jobs: Job[];
}

export interface EndEvent {
  recordingId: string;
  title: string;
  outcome: 'done' | 'stopped' | 'error';
  message?: string;
}

let snap: EngineSnapshot = { jobs: [] };
const listeners = new Set<() => void>();
const endListeners = new Set<(e: EndEvent) => void>();

function emit() {
  listeners.forEach((l) => l());
}

function setJob(id: string, patch: Partial<Job> | null) {
  const jobs = snap.jobs.slice();
  const i = jobs.findIndex((j) => j.recordingId === id);
  if (patch === null) {
    if (i >= 0) jobs.splice(i, 1);
  } else if (i >= 0) {
    jobs[i] = { ...jobs[i]!, ...patch };
  } else {
    jobs.push({ recordingId: id, phase: 'waiting', device: null, modelLoaded: 0, modelTotal: 0, progress: 0, preview: '', eta: null, stopping: false, ...patch });
  }
  // Running job first.
  jobs.sort((a, b) => Number(b.recordingId === running?.recordingId) - Number(a.recordingId === running?.recordingId));
  snap = { jobs };
  emit();
}

// ─── Queue ────────────────────────────────────────────────────────────

interface Pending {
  recordingId: string;
  jobId: number;
  model: string;
  language: string | null;
  restart: boolean;
  cancelled: boolean;
  posted: boolean;
  duration: number;
  startedAt: number;
  startProgress: number;
  lastBeat: number;
  writes: Promise<void>;
}

const queue: Pending[] = [];
let running: Pending | null = null;
let worker: Worker | null = null;
let nextJob = 1;

export interface TranscribeOptions {
  quality: Quality;
  /** ISO 639-1 code, or "auto" to detect it. */
  language: string;
  /** Start over instead of continuing a stopped transcription. */
  restart?: boolean;
}

/** Queues a recording for transcription. Continues from where it stopped unless restart is set. */
export async function transcribe(recordingId: string, options: TranscribeOptions) {
  if (starting.has(recordingId) || running?.recordingId === recordingId || queue.some((p) => p.recordingId === recordingId)) return;
  starting.add(recordingId);
  try {
    await enqueue(recordingId, options);
  } finally {
    starting.delete(recordingId);
  }
}

const starting = new Set<string>();

async function enqueue(recordingId: string, options: TranscribeOptions) {
  const model = QUALITIES.find((q) => q.id === options.quality)!.model;
  const rec = await db.recordings.get(recordingId);
  if (!rec) return;
  const wanted = options.language === 'auto' ? null : options.language;
  // A different model or language can't continue another run's transcript.
  const restart = Boolean(options.restart)
    || !((rec.transcribedSec ?? 0) > 0)
    || (rec.model !== undefined && rec.model !== model)
    || (wanted !== null && rec.language !== undefined && rec.language !== wanted);
  const language = wanted ?? (restart ? null : rec.language ?? null);
  await updateRecording(recordingId, {
    status: 'transcribing',
    error: undefined,
    model,
    ...(restart ? { segments: [], progress: 0, transcribedSec: 0, language: language ?? undefined } : language ? { language } : {}),
  });
  queue.push({
    recordingId, jobId: nextJob++, model, language, restart, cancelled: false, posted: false,
    duration: rec.durationSec, startedAt: 0, startProgress: 0, lastBeat: Date.now(), writes: Promise.resolve(),
  });
  setJob(recordingId, { phase: 'waiting', progress: restart ? 0 : rec.progress ?? 0 });
  holdWakeLock('transcribe');
  pump();
}

/** Stops a transcription. What was transcribed so far is kept. */
export async function cancelTranscription(recordingId: string) {
  const waiting = queue.findIndex((p) => p.recordingId === recordingId);
  if (waiting >= 0) {
    queue.splice(waiting, 1);
    setJob(recordingId, null);
    await updateRecording(recordingId, { status: 'new' });
    if (!running && !queue.length) releaseWakeLock('transcribe');
    return;
  }
  const job = running;
  if (!job || job.recordingId !== recordingId) {
    // Not running here (an interrupted run): just mark it stopped.
    const rec = await db.recordings.get(recordingId);
    if (rec?.status === 'transcribing') await updateRecording(recordingId, { status: 'new' });
    return;
  }
  job.cancelled = true;
  setJob(recordingId, { stopping: true });
  if (!job.posted) return; // runJob notices before handing the audio to the worker.
  worker?.postMessage({ type: 'cancel', jobId: job.jobId });
  // A busy worker may not read the message until its current window finishes. Don't wait.
  setTimeout(() => {
    if (running?.jobId !== job.jobId) return;
    worker?.terminate();
    worker = null;
    void finish(job, 'stopped');
  }, 1500);
}

export function isTranscribing(recordingId: string): boolean {
  return snap.jobs.some((j) => j.recordingId === recordingId);
}

function pump() {
  if (running || !queue.length) {
    if (!running && !queue.length) releaseWakeLock('transcribe');
    return;
  }
  running = queue.shift()!;
  void runJob(running);
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module', name: 'transcriber' });
  w.addEventListener('message', (e: MessageEvent<FromWorker>) => onMessage(e.data));
  w.addEventListener('error', (e) => {
    e.preventDefault();
    if (worker === w) worker = null;
    w.terminate();
    if (running) void finish(running, 'error', 'The transcriber couldn’t start in this browser.');
  });
  worker = w;
  return w;
}

async function runJob(job: Pending) {
  const id = job.recordingId;
  setJob(id, { phase: 'reading' });
  try {
    const rec = await db.recordings.get(id);
    if (!rec) return void finish(job, 'error', 'This recording was deleted.');
    const blob = await audioBlob(rec.audio);
    if (!blob) return void finish(job, 'error', 'The audio for this recording is missing.');
    const audio = await decodeAudio(blob);
    if (job.cancelled) return void finish(job, 'stopped');
    job.duration = audio.duration;
    if (Math.abs(rec.durationSec - audio.duration) > 1) await updateRecording(id, { durationSec: Math.round(audio.duration) });
    const startSeconds = job.restart ? 0 : Math.min(rec.transcribedSec ?? 0, audio.duration);
    if (startSeconds >= audio.duration - 0.5) return void finish(job, 'done');
    job.startProgress = startSeconds / audio.duration;
    setJob(id, { phase: 'model', progress: job.startProgress });
    job.posted = true;
    ensureWorker().postMessage(
      { type: 'run', jobId: job.jobId, model: job.model, language: job.language, samples: audio.samples, startSeconds },
      [audio.samples.buffer],
    );
  } catch (error) {
    await finish(job, 'error', friendly(error));
  }
}

function onMessage(m: FromWorker) {
  const job = running;
  if (!job || m.jobId !== job.jobId) return;
  const id = job.recordingId;
  switch (m.type) {
    case 'model':
      setJob(id, { modelLoaded: m.loaded, modelTotal: m.total });
      beat(job, {});
      break;
    case 'phase':
      if (m.phase === 'transcribing' && !job.startedAt) job.startedAt = Date.now();
      setJob(id, { phase: m.phase, device: m.device ?? null });
      break;
    case 'language':
      job.writes = job.writes.then(() => updateRecording(id, { language: m.language }));
      break;
    case 'progress': {
      const now = Date.now();
      const done = m.progress - job.startProgress;
      const elapsed = (now - job.startedAt) / 1000;
      const eta = job.startedAt && elapsed > 8 && done > 0.005 ? (elapsed * (1 - m.progress)) / done : null;
      setJob(id, { progress: m.progress, preview: collapseRepeats(m.preview), eta });
      beat(job, { progress: m.progress });
      break;
    }
    case 'section':
      job.lastBeat = Date.now();
      job.writes = job.writes.then(() => appendSegments(id, m.segments, { progress: m.progress, transcribedSec: m.endSeconds }));
      setJob(id, { progress: m.progress });
      break;
    case 'done':
      void finish(job, 'done', undefined, m.language);
      break;
    case 'error':
      void finish(job, m.cancelled ? 'stopped' : 'error', m.cancelled ? undefined : friendly(new Error(m.message)));
      break;
  }
}

/** A save every 15 seconds or so, so other tabs can tell a live run from an interrupted one. */
function beat(job: Pending, patch: Partial<Recording>) {
  const now = Date.now();
  if (now - job.lastBeat < 15_000) return;
  job.lastBeat = now;
  job.writes = job.writes.then(() => updateRecording(job.recordingId, patch));
}

async function finish(job: Pending, outcome: EndEvent['outcome'], message?: string, language?: string | null) {
  if (running !== job) return;
  const id = job.recordingId;
  try {
    await job.writes.catch(() => {});
    if (outcome === 'done') {
      await updateRecording(id, {
        status: 'done', progress: 1, error: undefined,
        ...(job.duration ? { transcribedSec: job.duration } : {}),
        ...(language ? { language } : {}),
      });
    } else if (outcome === 'stopped') {
      await updateRecording(id, { status: 'new' });
    } else {
      await updateRecording(id, { status: 'error', error: message ?? 'Transcription stopped unexpectedly.' });
    }
  } finally {
    running = null;
    setJob(id, null);
    const rec = await db.recordings.get(id).catch(() => undefined);
    endListeners.forEach((l) => l({ recordingId: id, title: rec?.title ?? 'Recording', outcome, message }));
    pump();
  }
}

/** Plain words for what went wrong. */
function friendly(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/fetch|network|load failed|404|403|cors/i.test(text)) return 'The speech model couldn’t download. Check your connection and try again. After the first download it works offline.';
  if (/memory|allocation|RangeError|OOM/i.test(text)) return 'This device ran out of memory. Try the Faster model, or a shorter recording.';
  if (/couldn’t read|no audio/i.test(text)) return text;
  return `Transcription stopped: ${text.slice(0, 200)}`;
}

// ─── React ────────────────────────────────────────────────────────────

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useTranscriber(): EngineSnapshot {
  return useSyncExternalStore(subscribe, () => snap);
}

export function useJob(recordingId: string | undefined): Job | undefined {
  const s = useTranscriber();
  return recordingId ? s.jobs.find((j) => j.recordingId === recordingId) : undefined;
}

export function onTranscriptionEnd(listener: (e: EndEvent) => void): () => void {
  endListeners.add(listener);
  return () => { endListeners.delete(listener); };
}

/**
 * A transcription that says it is running but has no live job in this tab and hasn't
 * saved for a while was interrupted (the tab closed or reloaded). It can resume.
 */
export function isStalled(rec: { id: string; status: string; updatedAt: number }, now = Date.now()): boolean {
  return rec.status === 'transcribing' && !isTranscribing(rec.id) && now - rec.updatedAt > 40_000;
}

// Tidy up after a closed tab: interrupted runs become resumable, and stray audio is removed.
if (typeof window !== 'undefined') {
  setTimeout(() => {
    const cutoff = Date.now() - 5 * 60_000;
    db.recordings.where('updatedAt').below(cutoff).filter((r) => r.status === 'transcribing' && !isTranscribing(r.id))
      .modify({ status: 'new' })
      .catch(() => {});
    purgeOrphanAudio().catch(() => {});
  }, 4000);
}
