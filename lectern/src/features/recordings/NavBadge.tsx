// What the "Recordings" nav item shows while something runs: a red dot when recording,
// the progress while transcribing.

import { useTranscriber } from './engine';
import { useRecorder } from './recorder';

export function RecordingsNavBadge() {
  const recorder = useRecorder();
  const { jobs } = useTranscriber();
  if (recorder.status === 'recording' || recorder.status === 'paused') {
    return <span className="nav-count rc-nav-live" title="Recording a class"><span className={`rc-live-dot ${recorder.status === 'paused' ? 'is-paused' : ''}`} /><span className="visually-hidden">Recording</span></span>;
  }
  const job = jobs[0];
  if (!job) return null;
  const pct = job.phase === 'transcribing' ? `${Math.round(job.progress * 100)}%` : '…';
  return <span className="nav-count tabular" title="Transcribing">{pct}<span className="visually-hidden"> transcribed</span></span>;
}
