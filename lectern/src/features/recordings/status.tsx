// How a recording's state reads in lists and headers.

import { AlertCircle, Check, CirclePause, Loader2, Mic } from 'lucide-react';
import type { Recording } from '../../data/db';
import { type Job, isStalled } from './engine';

export type StateKind = 'live' | 'active' | 'done' | 'error' | 'stopped' | 'new' | 'elsewhere';

export interface RecordingState {
  kind: StateKind;
  label: string;
  /** 0–1 when there is progress to show. */
  progress?: number;
}

const pct = (n: number) => `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;

export function jobLabel(job: Job): string {
  switch (job.phase) {
    case 'waiting': return 'Waiting its turn';
    case 'reading': return 'Reading the audio';
    case 'model': return job.modelTotal ? `Getting the speech model · ${pct(job.modelLoaded / job.modelTotal)}` : 'Getting the speech model';
    case 'detecting': return 'Detecting the language';
    default: return `Transcribing · ${pct(job.progress)}`;
  }
}

export function recordingState(rec: Recording, job: Job | undefined, liveId: string | null, now = Date.now()): RecordingState {
  if (liveId === rec.id) return { kind: 'live', label: 'Recording now' };
  if (job) return { kind: 'active', label: job.stopping ? 'Stopping…' : jobLabel(job), progress: job.phase === 'model' && job.modelTotal ? job.modelLoaded / job.modelTotal : job.progress };
  if (rec.status === 'done') return { kind: 'done', label: 'Transcript ready' };
  if (rec.status === 'error') return { kind: 'error', label: 'Couldn’t transcribe' };
  if (rec.status === 'transcribing') {
    return isStalled(rec, now)
      ? { kind: 'stopped', label: `Interrupted at ${pct(rec.progress ?? 0)}`, progress: rec.progress ?? 0 }
      : { kind: 'elsewhere', label: `Transcribing in another tab · ${pct(rec.progress ?? 0)}`, progress: rec.progress ?? 0 };
  }
  if ((rec.transcribedSec ?? 0) > 0 && rec.segments.length) return { kind: 'stopped', label: `Stopped at ${pct(rec.progress ?? 0)}`, progress: rec.progress ?? 0 };
  if (!rec.audio) return { kind: 'error', label: 'No audio' };
  return { kind: 'new', label: 'Not transcribed' };
}

export function StateChip({ state }: { state: RecordingState }) {
  const icon = {
    live: <span className="rc-live-dot" aria-hidden />,
    active: <Loader2 size={13} className="rc-spin" aria-hidden />,
    done: <Check size={13} aria-hidden />,
    error: <AlertCircle size={13} aria-hidden />,
    stopped: <CirclePause size={13} aria-hidden />,
    new: <Mic size={13} aria-hidden />,
    elsewhere: <Loader2 size={13} className="rc-spin" aria-hidden />,
  }[state.kind];
  const tone = state.kind === 'done' ? 'chip-good' : state.kind === 'error' || state.kind === 'stopped' ? 'chip-warn' : state.kind === 'live' ? 'rc-chip-live' : state.kind === 'active' || state.kind === 'elsewhere' ? 'chip-brand' : '';
  return <span className={`chip rc-chip ${tone}`}>{icon}{state.label}</span>;
}

/** "about 4 min left". */
export function etaLabel(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  if (seconds < 50) return 'less than a minute left';
  const min = Math.round(seconds / 60);
  if (min < 60) return `about ${min} min left`;
  const h = Math.floor(min / 60);
  return `about ${h} h ${min % 60 ? `${min % 60} min ` : ''}left`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
