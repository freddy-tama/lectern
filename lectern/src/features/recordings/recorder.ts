// Records a class from the microphone. Lives outside React so recording carries on while
// you move around the app (or present slides). The audio is saved to this browser every
// half minute while recording, so a closed tab loses at most the last few seconds.

import { useSyncExternalStore } from 'react';
import { uid } from '../../core/deck/types';
import { db } from '../../data/db';
import { AUDIO_ASSET, createRecording, deleteRecording, updateRecording } from '../../data/recordings';
import { saveAsset } from '../../data/repo';
import { holdWakeLock, releaseWakeLock } from './wake';

export interface RecorderSnapshot {
  status: 'idle' | 'starting' | 'recording' | 'paused' | 'saving';
  error: string | null;
  recordingId: string | null;
  title: string;
  /** Milliseconds recorded before the current stretch. */
  elapsedBefore: number;
  /** When the current stretch started (Date.now()), while recording. */
  since: number | null;
  /** Input level, 0–1. */
  level: number;
}

const idle = (): RecorderSnapshot => ({ status: 'idle', error: null, recordingId: null, title: '', elapsedBefore: 0, since: null, level: 0 });

let snap: RecorderSnapshot = idle();
const listeners = new Set<() => void>();

function set(patch: Partial<RecorderSnapshot>) {
  snap = { ...snap, ...patch };
  listeners.forEach((l) => l());
}

/** Milliseconds recorded so far. */
export function recordedMs(s: RecorderSnapshot, now = Date.now()): number {
  return s.elapsedBefore + (s.since ? now - s.since : 0);
}

// Session resources, alive while recording.
let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let draftId: string | null = null;
let flushTimer: number | undefined;
let audioCtx: AudioContext | null = null;
let meterFrame = 0;

const TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];

export function canRecord(): boolean {
  return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

function pickType(): string {
  return TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
}

function extension(mime: string) {
  return /mp4/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm';
}

const beforeUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = '';
};

export interface RecordingMeta {
  title: string;
  courseId?: string;
  lessonId?: string;
  date?: string;
}

/** Asks for the microphone and starts recording. Returns the new recording's id. */
export async function startRecording(meta: RecordingMeta): Promise<string | null> {
  if (snap.status !== 'idle') return snap.recordingId;
  if (!canRecord()) {
    set({ error: 'This browser can’t record audio. Record on your phone, then drop the file here.' });
    return null;
  }
  set({ ...idle(), status: 'starting', title: meta.title });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    set({
      ...idle(),
      error: name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Microphone access is blocked. Allow it in the browser’s site settings, then try again.'
        : name === 'NotFoundError' ? 'No microphone was found. Plug one in and try again.' : 'The microphone couldn’t start. Check it isn’t in use by another app.',
    });
    return null;
  }
  const mimeType = pickType();
  try {
    recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
  } catch {
    cleanup();
    set({ ...idle(), error: 'This browser can’t record audio here.' });
    return null;
  }
  const mime = recorder.mimeType || mimeType || 'audio/webm';
  const rec = await createRecording({ ...meta, audio: '', mime, size: 0, source: 'recorded', status: 'new' });
  chunks = [];
  draftId = uid('a');
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start(1000);
  flushTimer = window.setInterval(() => { void flushDraft(); }, 30_000);
  startMeter(stream);
  holdWakeLock('record');
  window.addEventListener('beforeunload', beforeUnload);
  set({ status: 'recording', recordingId: rec.id, title: rec.title, since: Date.now(), elapsedBefore: 0, error: null });
  return rec.id;
}

/** Saves what has been recorded so far, so nothing is lost if the tab closes. */
async function flushDraft() {
  const id = snap.recordingId;
  if (!id || !draftId || !chunks.length) return;
  const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
  await db.assets.put({ id: draftId, blob, mime: blob.type, name: `${AUDIO_ASSET}draft`, createdAt: Date.now() });
  await updateRecording(id, { audio: `asset:${draftId}`, size: blob.size, durationSec: Math.round(recordedMs(snap) / 1000) });
}

export function pauseRecording() {
  if (snap.status !== 'recording' || !recorder) return;
  recorder.pause();
  set({ status: 'paused', elapsedBefore: recordedMs(snap), since: null, level: 0 });
}

export function resumeRecording() {
  if (snap.status !== 'paused' || !recorder) return;
  recorder.resume();
  set({ status: 'recording', since: Date.now() });
}

/** Stops and saves. Resolves with the recording id, or null when nothing was recorded. */
export async function stopRecording(): Promise<string | null> {
  const id = snap.recordingId;
  if (!recorder || !id || (snap.status !== 'recording' && snap.status !== 'paused')) return null;
  const ms = recordedMs(snap);
  set({ status: 'saving', elapsedBefore: ms, since: null, level: 0 });
  const r = recorder;
  await new Promise<void>((resolve) => {
    r.addEventListener('stop', () => resolve(), { once: true });
    r.stop();
  });
  const mime = r.mimeType || 'audio/webm';
  const blob = new Blob(chunks, { type: mime });
  const draft = draftId;
  cleanup();
  try {
    if (!blob.size) {
      await deleteRecording(id).catch(() => {});
      set({ ...idle(), error: 'Nothing was recorded. Check the microphone and try again.' });
      return null;
    }
    const audio = await saveAsset(blob, `${AUDIO_ASSET}Class recording.${extension(mime)}`);
    await updateRecording(id, { audio, size: blob.size, mime, durationSec: Math.max(1, Math.round(ms / 1000)) });
    if (draft) await db.assets.delete(draft);
    set(idle());
    return id;
  } catch {
    set({ ...idle(), error: 'The recording couldn’t be saved. The browser may be out of storage space.' });
    return null;
  }
}

/** Stops without keeping anything. */
export async function discardRecording() {
  const id = snap.recordingId;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  const draft = draftId;
  cleanup();
  set(idle());
  if (id) await deleteRecording(id);
  if (draft) await db.assets.delete(draft).catch(() => {});
}

export function clearRecorderError() {
  if (snap.error) set({ error: null });
}

function startMeter(s: MediaStream) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctx();
    const source = audioCtx.createMediaStreamSource(s);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let last = 0;
    const tick = (t: number) => {
      meterFrame = requestAnimationFrame(tick);
      if (t - last < 60 || snap.status !== 'recording') return;
      last = t;
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
      const dbfs = 20 * Math.log10(Math.sqrt(sum / data.length) || 1e-8);
      // −60 dB is silence, −10 dB is loud speech close to the microphone.
      const level = Math.max(0, Math.min(1, (dbfs + 60) / 50));
      if (Math.abs(level - snap.level) > 0.015) set({ level });
    };
    meterFrame = requestAnimationFrame(tick);
  } catch {
    // The meter is a nicety; recording works without it.
  }
}

function cleanup() {
  window.clearInterval(flushTimer);
  cancelAnimationFrame(meterFrame);
  audioCtx?.close().catch(() => {});
  audioCtx = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  recorder = null;
  chunks = [];
  draftId = null;
  releaseWakeLock('record');
  window.removeEventListener('beforeunload', beforeUnload);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useRecorder(): RecorderSnapshot {
  return useSyncExternalStore(subscribe, () => snap);
}

// ─── Opening the recorder from anywhere ───────────────────────────────

const OPEN = 'lectern:record';

export interface RecorderPreset {
  courseId?: string;
  lessonId?: string;
}

/** Opens the "Record a class" panel, optionally for a lesson. */
export function openRecorder(preset?: RecorderPreset) {
  window.dispatchEvent(new CustomEvent<RecorderPreset | undefined>(OPEN, { detail: preset }));
}

export function onOpenRecorder(listener: (preset?: RecorderPreset) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<RecorderPreset | undefined>).detail);
  window.addEventListener(OPEN, handler);
  return () => window.removeEventListener(OPEN, handler);
}
