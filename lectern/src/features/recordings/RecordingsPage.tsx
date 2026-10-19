// Recordings: every recorded class, grouped by course, with a place to drop new ones.
// Deep links: /recordings?lesson=<id> or ?course=<id> prefill where a new recording goes.

import { useLiveQuery } from 'dexie-react-hooks';
import { AudioLines, GraduationCap, Mic, MoreHorizontal, Search, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { lengthLabel } from '../../core/transcribe/time';
import { type Course, type Lesson, type Recording, db } from '../../data/db';
import { searchRecordings, sortRecordings } from '../../data/recordings';
import { Menu } from '../../ui/Menu';
import { useToast } from '../../ui/Toast';
import { formatDate, plural } from '../../ui/format';
import { courseStyle } from '../notes/refs';
import { removeRecording } from './actions';
import { AddRecordingDialog } from './AddRecordingDialog';
import { ACCEPT, isMediaFile } from './decode';
import { useTranscriber } from './engine';
import { openRecorder, useRecorder } from './recorder';
import { StateChip, recordingState } from './status';

export default function RecordingsPage() {
  const [params] = useSearchParams();
  const toast = useToast();
  const data = useLiveQuery(async () => {
    const [recordings, courses, lessons] = await Promise.all([db.recordings.toArray(), db.courses.toArray(), db.lessons.toArray()]);
    return { recordings: sortRecordings(recordings), course: new Map(courses.map((c) => [c.id, c])), lesson: new Map(lessons.map((l) => [l.id, l])) };
  }, []);
  const engine = useTranscriber();
  const recorder = useRecorder();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const preset = { lessonId: params.get('lesson') ?? undefined, courseId: params.get('course') ?? undefined };

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!isMediaFile(f)) {
      toast.show('That doesn’t look like an audio or video file.', { tone: 'error' });
      return;
    }
    setFile(f);
  };

  const groups = useMemo(() => {
    if (!data) return [];
    const list = searchRecordings(data.recordings, query);
    const byCourse = new Map<string, Recording[]>();
    for (const r of list) {
      const key = r.courseId && data.course.has(r.courseId) ? r.courseId : '';
      byCourse.set(key, [...(byCourse.get(key) ?? []), r]);
    }
    return [...byCourse]
      .map(([id, items]) => ({ course: data.course.get(id), items }))
      .sort((a, b) => (a.course ? 0 : 1) - (b.course ? 0 : 1) || (a.course?.title ?? '').localeCompare(b.course?.title ?? ''));
  }, [data, query]);

  const remove = async (rec: Recording) => {
    const undo = await removeRecording(rec.id);
    toast.show(`Deleted “${rec.title}”`, { action: { label: 'Undo', run: () => { undo(); } } });
  };

  const total = data?.recordings.length ?? 0;

  return (
    <div
      className="page rc-page"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files); }}
    >
      <div className="page-head">
        <div>
          <p className="eyebrow">Classes</p>
          <h1 className="display">Recordings</h1>
        </div>
      </div>

      <div className="rc-intake">
        <button
          type="button"
          className={`rc-drop ${dragging ? 'is-dragging' : ''}`}
          onClick={() => input.current?.click()}
          aria-describedby="rc-drop-help"
        >
          <span className="rc-drop-icon"><Upload size={22} /></span>
          <span className="rc-drop-text">
            <strong>Drop a lecture recording</strong>
            <span id="rc-drop-help" className="muted">or choose a file · mp3, m4a, wav, webm, ogg, or a video</span>
          </span>
        </button>
        <button type="button" className="rc-record-card" onClick={() => openRecorder(preset)}>
          <span className="rc-record-icon">{recorder.status === 'recording' || recorder.status === 'paused' ? <span className="rc-live-dot" aria-hidden /> : <Mic size={22} />}</span>
          <span className="rc-drop-text">
            <strong>{recorder.status === 'recording' || recorder.status === 'paused' ? 'Recording now' : 'Record a class'}</strong>
            <span className="muted">{recorder.status === 'recording' || recorder.status === 'paused' ? 'Open the recorder' : 'With this device’s microphone'}</span>
          </span>
        </button>
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
      </div>

      {data && total > 0 && (
        <div className="toolbar rc-toolbar">
          <label className="search">
            <Search size={16} />
            <span className="visually-hidden">Search recordings</span>
            <input className="input" type="search" placeholder="Search titles and transcripts" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <span className="faint rc-count">{query ? `${groups.reduce((n, g) => n + g.items.length, 0)} of ${plural(total, 'recording')}` : plural(total, 'recording')}</span>
        </div>
      )}

      {data === undefined && <div className="skeleton" style={{ height: 160, marginTop: 24 }} />}

      {data && total === 0 && (
        <div className="empty rc-empty">
          <div className="empty-icon"><AudioLines size={22} /></div>
          <h3>No recordings yet</h3>
          <p>Add a recording of a class and get a transcript you can search, play from any line and turn into notes.</p>
          <p className="rc-privacy-line"><ShieldCheck size={15} aria-hidden /> Transcribed on this device. The audio never leaves your browser.</p>
        </div>
      )}

      {data && total > 0 && !groups.length && (
        <div className="empty rc-empty">
          <div className="empty-icon"><Search size={22} /></div>
          <h3>Nothing matches</h3>
          <p>Try another word from the title or what was said.</p>
        </div>
      )}

      {groups.map(({ course, items }) => (
        <section key={course?.id ?? 'none'} className="rc-group" style={courseStyle(course)} aria-label={course?.title ?? 'Not in a course'}>
          <h2 className="rc-group-head">
            {course ? <Link to={`/courses/${course.id}`}><span className="dot" />{course.title}</Link> : <span>Not in a course</span>}
            <span className="faint">{items.length}</span>
          </h2>
          <ul className="rc-list">
            {items.map((r) => (
              <RecordingRow
                key={r.id}
                rec={r}
                course={course}
                lesson={r.lessonId ? data?.lesson.get(r.lessonId) : undefined}
                job={engine.jobs.find((j) => j.recordingId === r.id)}
                liveId={recorder.recordingId}
                onDelete={() => void remove(r)}
              />
            ))}
          </ul>
        </section>
      ))}

      {data && total > 0 && (
        <p className="rc-privacy-line rc-foot"><ShieldCheck size={15} aria-hidden /> Transcribed on this device. The audio never leaves your browser.</p>
      )}

      <AddRecordingDialog file={file} preset={preset} onClose={() => setFile(null)} />
    </div>
  );
}

function RecordingRow({ rec, course, lesson, job, liveId, onDelete }: {
  rec: Recording;
  course?: Course;
  lesson?: Lesson;
  job: ReturnType<typeof useTranscriber>['jobs'][number] | undefined;
  liveId: string | null;
  onDelete(): void;
}) {
  const state = recordingState(rec, job, liveId);
  const showBar = state.kind === 'active' || state.kind === 'elsewhere';
  return (
    <li className="rc-row" style={courseStyle(course)}>
      <Link className="rc-row-link" to={`/recordings/${rec.id}`}>
        <span className="rc-row-icon" aria-hidden><AudioLines size={18} /></span>
        <span className="rc-row-main">
          <strong className="rc-row-title">{rec.title}</strong>
          <span className="rc-row-meta">
            {lesson && <span className="rc-row-lesson"><GraduationCap size={13} aria-hidden /> {lesson.title}</span>}
            {rec.date && <span>{formatDate(rec.date)}</span>}
            {rec.durationSec > 0 && <span>{lengthLabel(rec.durationSec)}</span>}
          </span>
        </span>
        <span className="rc-row-status">
          <StateChip state={state} />
          {showBar && <span className="progress rc-row-bar" aria-hidden><span style={{ width: `${Math.round((state.progress ?? 0) * 100)}%` }} /></span>}
        </span>
      </Link>
      <Menu align="end" trigger={(p) => <button type="button" className="icon-btn rc-row-menu" aria-label={`Actions for ${rec.title}`} {...p}><MoreHorizontal size={18} /></button>}>
        {(close) => (
          <>
            {lesson && <Link className="menu-item" to={`/lessons/${lesson.id}`} onClick={close}><GraduationCap size={16} /> Open the lesson</Link>}
            <button type="button" className="menu-item btn-danger" onClick={() => { close(); onDelete(); }} disabled={liveId === rec.id}><Trash2 size={16} /> Delete recording</button>
          </>
        )}
      </Menu>
    </li>
  );
}
