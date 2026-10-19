// The "Recording" section on a lesson page: record or add the class, see how the
// transcript is coming along, and open it. After class it gently suggests adding one.

import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, AudioLines, Mic, ShieldCheck, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { lengthLabel } from '../../core/transcribe/time';
import type { Lesson } from '../../data/db';
import { recordingsForLesson } from '../../data/recordings';
import { useToast } from '../../ui/Toast';
import { formatDate } from '../../ui/format';
import { AddRecordingDialog } from './AddRecordingDialog';
import { ACCEPT, isMediaFile } from './decode';
import { useTranscriber } from './engine';
import { openRecorder, useRecorder } from './recorder';
import { StateChip, recordingState } from './status';

export function LessonRecordings({ lesson, past }: { lesson: Lesson; past: boolean }) {
  const recordings = useLiveQuery(() => recordingsForLesson(lesson.id), [lesson.id]);
  const engine = useTranscriber();
  const recorder = useRecorder();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  if (recordings === undefined) return null;

  const recordingHere = recorder.recordingId !== null && recordings.some((r) => r.id === recorder.recordingId);
  const busyElsewhere = (recorder.status === 'recording' || recorder.status === 'paused') && !recordingHere;

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!isMediaFile(f)) {
      toast.show('That doesn’t look like an audio or video file.', { tone: 'error' });
      return;
    }
    setFile(f);
  };

  const actions = (
    <div className="rc-lesson-actions">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openRecorder({ lessonId: lesson.id, courseId: lesson.courseId })} disabled={busyElsewhere} title={busyElsewhere ? 'Another class is being recorded' : undefined}>
        <Mic size={15} /> {recordingHere ? 'Recording…' : 'Record'}
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()}>
        <Upload size={15} /> Add a file
      </button>
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
    </div>
  );

  return (
    <section
      className="section card rc-lesson"
      aria-labelledby="rc-lesson-title"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files); }}
    >
      <div className="rc-lesson-head">
        <div>
          <h2 id="rc-lesson-title">Recording</h2>
          <p className="faint">A transcript of the class, made on this device.</p>
        </div>
        {recordings.length > 0 && actions}
      </div>

      {recordings.length > 0 ? (
        <ul className="rc-lesson-list">
          {recordings.map((r) => {
            const state = recordingState(r, engine.jobs.find((j) => j.recordingId === r.id), recorder.recordingId);
            const bar = state.kind === 'active' || state.kind === 'elsewhere';
            return (
              <li key={r.id}>
                <Link className="rc-lesson-row" to={`/recordings/${r.id}`}>
                  <span className="rc-row-icon" aria-hidden><AudioLines size={17} /></span>
                  <span className="rc-row-main">
                    <strong className="rc-row-title">{r.title}</strong>
                    <span className="rc-row-meta">
                      {r.date && <span>{formatDate(r.date)}</span>}
                      {r.durationSec > 0 && <span>{lengthLabel(r.durationSec)}</span>}
                      {r.summary && <span>Class notes ready</span>}
                    </span>
                    {bar && <span className="progress rc-row-bar" aria-hidden><span style={{ width: `${Math.round((state.progress ?? 0) * 100)}%` }} /></span>}
                  </span>
                  <StateChip state={state} />
                  <span className="rc-lesson-open">{r.status === 'done' ? 'Open transcript' : 'Open'} <ArrowRight size={14} aria-hidden /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={`rc-lesson-empty ${past ? 'is-suggest' : ''}`}>
          <span className="rc-lesson-empty-icon" aria-hidden>{past ? <AudioLines size={20} /> : <Mic size={20} />}</span>
          <div>
            <p className="rc-lesson-empty-title">{past ? 'Recorded this class?' : 'Record the class as you teach'}</p>
            <p className="faint">
              {past
                ? 'Add the recording to get a transcript you can search, and class notes for anyone who missed it.'
                : 'Or add a recording afterwards. You get a transcript you can search and turn into notes.'}
            </p>
            <p className="rc-privacy-line"><ShieldCheck size={14} aria-hidden /> The audio never leaves your browser.</p>
          </div>
          {actions}
        </div>
      )}

      <AddRecordingDialog file={file} preset={{ lessonId: lesson.id, courseId: lesson.courseId }} onClose={() => setFile(null)} />
    </section>
  );
}
