// One recording: the player, the transcript that follows it, links to the class, and
// what you can make from it (notes, class notes, a quiz deck, subtitle files).

import { useLiveQuery } from 'dexie-react-hooks';
import {
  AudioLines, CalendarDays, ChevronDown, ChevronRight, ChevronUp, Copy, Cpu, Download, GraduationCap, Mic, MoreHorizontal,
  NotebookPen, Play, RefreshCw, Search, Sparkles, Square, Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { NotFound } from '../../app/App';
import { type TranscriptFormat, exportTranscript, fileName } from '../../core/transcribe/export';
import { languageName } from '../../core/transcribe/languages';
import { findMatches, segmentAt, transcriptText, wordCount } from '../../core/transcribe/segments';
import { lengthLabel } from '../../core/transcribe/time';
import { db } from '../../data/db';
import { audioBlob, linkToCourse, linkToLesson, notesForRecording, updateRecording } from '../../data/recordings';
import { assetUrl } from '../../data/repo';
import { Dialog } from '../../ui/Dialog';
import { Menu } from '../../ui/Menu';
import { useToast } from '../../ui/Toast';
import { formatDate, plural, timeAgo } from '../../ui/format';
import { CourseSelect, LessonSelect } from '../notes/LinkPickers';
import { courseStyle, useNoteRefs } from '../notes/refs';
import { downloadBlob } from '../studio/download';
import { audioExtension, removeRecording, saveTranscriptAsNote } from './actions';
import { ClassNotesPanel } from './ClassNotesPanel';
import {
  type TranscribePrefs, cancelTranscription, loadPrefs, modelLabel, qualityOf, savePrefs, transcribe, useJob,
} from './engine';
import { TranscribeFields } from './Fields';
import { Player, usePlayer } from './Player';
import { openRecorder, useRecorder } from './recorder';
import { StateChip, etaLabel, formatBytes, jobLabel, recordingState } from './status';
import { type Selection, Transcript, revealInView } from './Transcript';

type Tab = 'transcript' | 'notes';

export default function RecordingDetail() {
  const { recordingId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const data = useLiveQuery(async () => {
    const rec = await db.recordings.get(recordingId);
    if (!rec) return { rec: null };
    const [lesson, course] = await Promise.all([
      rec.lessonId ? db.lessons.get(rec.lessonId) : undefined,
      rec.courseId ? db.courses.get(rec.courseId) : undefined,
    ]);
    return { rec, lesson, course };
  }, [recordingId]);
  const notes = useLiveQuery(() => notesForRecording(recordingId), [recordingId]);
  const refs = useNoteRefs();
  const job = useJob(recordingId);
  const recorder = useRecorder();
  const rec = data?.rec ?? undefined;
  const player = usePlayer(rec?.durationSec ?? 0);
  const [src, setSrc] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => (params.get('tab') === 'notes' ? 'notes' : 'transcript'));
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);
  const [follow, setFollow] = useState(true);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [again, setAgain] = useState(false);
  const [prefs, setPrefs] = useState<TranscribePrefs>(loadPrefs);
  const playing = useRef(false);
  playing.current = player.playing;
  const stepped = useRef(false);

  const live = recorder.recordingId === recordingId;
  const audioRef = rec?.audio ?? '';

  useEffect(() => {
    let alive = true;
    if (!audioRef || live) { setSrc(null); return; }
    assetUrl(audioRef).then((url) => { if (alive) setSrc(url); });
    return () => { alive = false; };
  }, [audioRef, live]);

  // Re-transcribing defaults to the model and language used last time.
  useEffect(() => {
    if (!rec) return;
    const base = loadPrefs();
    setPrefs({ quality: qualityOf(rec.model) ?? base.quality, language: rec.language ?? base.language });
    // Only when another recording opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.id]);

  const segments = useMemo(() => rec?.segments ?? [], [rec?.segments]);
  const started = player.playing || player.time > 0;
  const active = started ? segmentAt(segments, player.time) : -1;
  const matches = useMemo(() => findMatches(segments, query), [segments, query]);

  // The transcript scrolls with the audio until you scroll it yourself.
  useEffect(() => {
    const stop = () => { if (playing.current) setFollow(false); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key)) stop();
    };
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchmove', stop, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Pressing play picks the transcript back up.
  useEffect(() => {
    if (player.playing) setFollow(true);
  }, [player.playing]);

  useEffect(() => {
    if (!follow || !player.playing || active < 0 || tab !== 'transcript') return;
    revealInView(document.querySelector(`.rc-transcript [data-seg="${active}"]`));
  }, [active, follow, player.playing, tab]);

  const showMatch = useCallback((index: number) => {
    if (!matches.length) return;
    const k = ((index % matches.length) + matches.length) % matches.length;
    setCurrent(k);
    setFollow(false);
    requestAnimationFrame(() => revealInView(document.querySelector(`.rc-transcript mark[data-match="${k}"]`), true));
  }, [matches.length]);

  // Typing a search shows its first match.
  useEffect(() => {
    setCurrent(0);
    stepped.current = false;
    if (!query.trim() || !matches.length) return;
    const t = setTimeout(() => revealInView(document.querySelector('.rc-transcript mark[data-match="0"]')), 250);
    return () => clearTimeout(t);
    // Only when the words change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const playerSeek = player.seek;
  const seek = useCallback((seconds: number) => {
    playerSeek(seconds, true);
    setFollow(true);
  }, [playerSeek]);

  const onSelection = useCallback((s: Selection | null) => setSelection(s), []);

  if (data === undefined) return <div className="page"><div className="skeleton" style={{ height: 280 }} /></div>;
  if (!data.rec) return <NotFound message="This recording was deleted or never existed." />;
  const { lesson, course } = data;
  const r = data.rec;
  const state = recordingState(r, job, recorder.recordingId);
  const busy = Boolean(job) || live;

  const save = (patch: Parameters<typeof updateRecording>[1]) => updateRecording(r.id, patch);

  const saveNote = async () => {
    const note = await saveTranscriptAsNote(r, lesson, selection ?? undefined);
    toast.show(selection ? 'Saved the passage to Notes' : 'Saved the transcript to Notes', { action: { label: 'Open', run: () => navigate(`/notes/${note.id}`) } });
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(transcriptText(segments));
      toast.show('Copied the transcript');
    } catch {
      toast.show('Copying isn’t allowed here. Export a text file instead.', { tone: 'error' });
    }
  };

  const exportAs = (format: TranscriptFormat) => {
    const out = exportTranscript(segments, format, r.title);
    downloadBlob(new Blob([out.text], { type: `${out.mime};charset=utf-8` }), fileName(r.title, out.ext));
  };

  const downloadAudio = async () => {
    const blob = await audioBlob(r.audio);
    if (blob) downloadBlob(blob, fileName(r.title, audioExtension(blob.type || r.mime)));
  };

  const remove = async () => {
    const undo = await removeRecording(r.id);
    navigate('/recordings');
    toast.show(`Deleted “${r.title}”`, { action: { label: 'Undo', run: () => { undo(); } } });
  };

  const start = (restart: boolean) => {
    savePrefs(prefs);
    void transcribe(r.id, { ...prefs, restart });
    setAgain(false);
  };

  const resume = () => void transcribe(r.id, { quality: qualityOf(r.model) ?? prefs.quality, language: r.language ?? prefs.language });

  return (
    <div className="page rc-detail" style={courseStyle(course)}>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/recordings">Recordings</Link>
        {course && <><ChevronRight size={14} /><Link to={`/courses/${course.id}`}>{course.title}</Link></>}
        {lesson && <><ChevronRight size={14} /><Link to={`/lessons/${lesson.id}`}>{lesson.title}</Link></>}
      </nav>

      <header className="rc-head">
        <div className="rc-head-main">
          <input
            className="input-bare rc-title"
            defaultValue={r.title}
            key={`t-${r.id}-${r.title}`}
            aria-label="Recording title"
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.title) void save({ title: v }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
          <div className="rc-meta">
            <StateChip state={state} />
            {r.date && <span className="rc-meta-item"><CalendarDays size={14} aria-hidden /> {formatDate(r.date)}</span>}
            {r.durationSec > 0 && <span className="rc-meta-item"><AudioLines size={14} aria-hidden /> {lengthLabel(r.durationSec)}</span>}
            {segments.length > 0 && <span className="rc-meta-item">{plural(wordCount(segments), 'word')}</span>}
            {r.language && <span className="rc-meta-item">{languageName(r.language)}</span>}
          </div>
        </div>
        <Menu align="end" trigger={(p) => <button type="button" className="icon-btn rc-head-menu" aria-label="Recording actions" {...p}><MoreHorizontal size={18} /></button>}>
          {(close) => (
            <>
              <button type="button" className="menu-item" disabled={busy || !r.audio} onClick={() => { close(); setAgain(true); }}><RefreshCw size={16} /> Transcribe again…</button>
              <button type="button" className="menu-item" disabled={!r.audio || live} onClick={() => { close(); void downloadAudio(); }}><Download size={16} /> Download the audio</button>
              {lesson && <Link className="menu-item" to={`/lessons/${lesson.id}`} onClick={close}><GraduationCap size={16} /> Open the lesson</Link>}
              <button type="button" className="menu-item btn-danger" disabled={live} onClick={() => { close(); void remove(); }}><Trash2 size={16} /> Delete recording</button>
            </>
          )}
        </Menu>
      </header>

      <StatusPanel
        live={live}
        job={job}
        state={state}
        hasSegments={segments.length > 0}
        error={r.error}
        prefs={prefs}
        setPrefs={setPrefs}
        onStart={() => start(false)}
        onResume={resume}
        onRestart={() => setAgain(true)}
        onStop={() => void cancelTranscription(r.id)}
      />

      <div className="rc-layout">
        <div className="rc-main">
          <div
            className="segmented rc-tabs"
            role="tablist"
            aria-label="Recording views"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              e.stopPropagation();
              const next: Tab = tab === 'transcript' ? 'notes' : 'transcript';
              setTab(next);
              requestAnimationFrame(() => document.getElementById(`rc-tab-${next}`)?.focus());
            }}
          >
            <button type="button" role="tab" id="rc-tab-transcript" aria-controls="rc-panel-transcript" aria-selected={tab === 'transcript'} tabIndex={tab === 'transcript' ? 0 : -1} onClick={() => setTab('transcript')}>
              Transcript
            </button>
            <button type="button" role="tab" id="rc-tab-notes" aria-controls="rc-panel-notes" aria-selected={tab === 'notes'} tabIndex={tab === 'notes' ? 0 : -1} onClick={() => setTab('notes')}>
              <Sparkles size={14} /> Class notes
            </button>
          </div>

          {tab === 'transcript' ? (
            <section id="rc-panel-transcript" role="tabpanel" aria-labelledby="rc-tab-transcript" className="rc-panel">
              {segments.length > 0 && (
                <div className="rc-tools">
                  <div className="rc-find">
                    <label className="search rc-search">
                      <Search size={16} />
                      <span className="visually-hidden">Search the transcript</span>
                      <input
                        className="input"
                        type="search"
                        placeholder="Search the transcript"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            // The first Enter shows the current match; later ones step through.
                            showMatch(stepped.current ? current + (e.shiftKey ? -1 : 1) : current);
                            stepped.current = true;
                          }
                          if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); }
                        }}
                      />
                    </label>
                    {query.trim() && (
                      <span className="rc-find-nav">
                        <span className="faint tabular" aria-live="polite">{matches.length ? `${current + 1} of ${matches.length}` : 'No matches'}</span>
                        <button type="button" className="icon-btn" onClick={() => showMatch(current - 1)} disabled={!matches.length} aria-label="Previous match"><ChevronUp size={16} /></button>
                        <button type="button" className="icon-btn" onClick={() => showMatch(current + 1)} disabled={!matches.length} aria-label="Next match"><ChevronDown size={16} /></button>
                      </span>
                    )}
                  </div>
                  <div className="rc-tool-buttons">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyAll()}><Copy size={15} /> Copy all</button>
                    <Menu align="end" trigger={(p) => <button type="button" className="btn btn-ghost btn-sm" {...p}><Download size={15} /> Export</button>}>
                      {(close) => (
                        <>
                          <button type="button" className="menu-item" onClick={() => { close(); exportAs('txt'); }}>Text (.txt)</button>
                          <button type="button" className="menu-item" onClick={() => { close(); exportAs('srt'); }}>Subtitles (.srt)</button>
                          <button type="button" className="menu-item" onClick={() => { close(); exportAs('vtt'); }}>Web subtitles (.vtt)</button>
                        </>
                      )}
                    </Menu>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void saveNote()}
                      title={selection ? 'Save the selected passage as a note' : 'Save the whole transcript as a note'}
                    >
                      <NotebookPen size={15} /> {selection ? 'Save selection as note' : 'Save as note'}
                    </button>
                  </div>
                </div>
              )}
              {segments.length ? (
                <>
                  <Transcript
                    recordingId={r.id}
                    segments={segments}
                    active={active}
                    matches={matches}
                    currentMatch={current}
                    onSeek={seek}
                    onSelection={onSelection}
                  />
                  {job && <p className="rc-more faint"><span className="spinner" aria-hidden /> More is on the way as the transcription continues.</p>}
                </>
              ) : (
                <div className="empty rc-transcript-empty">
                  <div className="empty-icon">{live ? <Mic size={22} /> : <AudioLines size={22} />}</div>
                  <h3>{live ? 'Recording in progress' : job ? 'The transcript appears here as it’s made' : 'No transcript yet'}</h3>
                  <p>{live ? 'Stop the recording to transcribe it.' : job ? 'Sections show up every few minutes of audio. You can leave this page; it carries on.' : 'Transcribe the recording to read along, search it and make notes from it.'}</p>
                </div>
              )}
            </section>
          ) : (
            <section id="rc-panel-notes" role="tabpanel" aria-labelledby="rc-tab-notes" className="rc-panel">
              <ClassNotesPanel rec={r} lesson={lesson} course={course} onSaveTranscript={() => void saveNote()} />
            </section>
          )}
        </div>

        <aside className="rc-side">
          <section className="card rc-card" aria-labelledby="rc-links-title">
            <h2 id="rc-links-title" className="rc-card-title">Class</h2>
            {refs ? (
              <div className="rc-side-fields">
                <div className="field">
                  <label className="field-label" htmlFor="rc-course">Course</label>
                  <CourseSelect id="rc-course" refs={refs} value={r.courseId} onChange={(v) => void save(linkToCourse(r, v, refs.lesson))} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="rc-lesson">Lesson</label>
                  <LessonSelect id="rc-lesson" refs={refs} courseId={r.courseId} value={r.lessonId} onChange={(v) => void save(linkToLesson(r, v ? refs.lesson.get(v) : undefined))} />
                </div>
                <label className="field">
                  <span className="field-label">Date</span>
                  <input className="input" type="date" value={r.date ?? ''} onChange={(e) => void save({ date: e.target.value || undefined })} />
                </label>
              </div>
            ) : <div className="skeleton" style={{ height: 140 }} />}
          </section>

          <section className="card rc-card" aria-labelledby="rc-notes-list-title">
            <h2 id="rc-notes-list-title" className="rc-card-title">Notes from this recording</h2>
            {notes && notes.length > 0 ? (
              <ul className="rc-note-links">
                {notes.map((n) => (
                  <li key={n.id}>
                    <Link to={`/notes/${n.id}`}><NotebookPen size={14} aria-hidden /><span>{n.title || 'Untitled note'}</span></Link>
                    <span className="faint">{timeAgo(n.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="faint rc-card-text">Save the transcript, a passage or the class notes as a note, and it shows here and on the lesson.</p>
            )}
            {segments.length > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => void saveNote()}>
                <NotebookPen size={15} /> {selection ? 'Save selection as note' : 'Save transcript as note'}
              </button>
            )}
          </section>

          <section className="card rc-card rc-about" aria-labelledby="rc-about-title">
            <h2 id="rc-about-title" className="rc-card-title">About</h2>
            <dl>
              {r.durationSec > 0 && <><dt>Length</dt><dd>{lengthLabel(r.durationSec)}</dd></>}
              {r.language && <><dt>Language</dt><dd>{languageName(r.language)}</dd></>}
              {r.model && <><dt>Speech model</dt><dd>{modelLabel(r.model) || r.model}</dd></>}
              <dt>Audio</dt><dd>{r.size ? formatBytes(r.size) : '—'}{r.source === 'recorded' ? ', recorded here' : r.fileName ? `, ${r.fileName}` : ''}</dd>
              <dt>Added</dt><dd>{timeAgo(r.createdAt)}</dd>
            </dl>
            <p className="faint rc-card-text"><Cpu size={13} aria-hidden /> Transcribed on this device. The audio never leaves your browser.</p>
          </section>
        </aside>
      </div>

      {live ? (
        <div className="rc-player rc-player-live">
          <span className="rc-live-dot" aria-hidden />
          <span>This class is being recorded.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openRecorder()}><Square size={13} fill="currentColor" /> Open the recorder</button>
        </div>
      ) : (
        <Player player={player} src={src} following={follow} onFollow={() => { setFollow(true); if (active >= 0) revealInView(document.querySelector(`.rc-transcript [data-seg="${active}"]`), true); }} />
      )}

      <Dialog
        open={again}
        onClose={() => setAgain(false)}
        title="Transcribe again"
        description="Try another model or language. This replaces the current transcript, including your edits."
        className="rc-dialog"
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setAgain(false)}>Cancel</button>
            <button type="button" className="btn btn-brand" onClick={() => start(true)}><RefreshCw size={15} /> Transcribe again</button>
          </>
        )}
      >
        <TranscribeFields value={prefs} onChange={setPrefs} />
      </Dialog>
    </div>
  );
}

function StatusPanel({ live, job, state, hasSegments, error, prefs, setPrefs, onStart, onResume, onRestart, onStop }: {
  live: boolean;
  job: ReturnType<typeof useJob>;
  state: ReturnType<typeof recordingState>;
  hasSegments: boolean;
  error?: string;
  prefs: TranscribePrefs;
  setPrefs(p: TranscribePrefs): void;
  onStart(): void;
  onResume(): void;
  onRestart(): void;
  onStop(): void;
}) {
  if (live) return null;
  if (job) {
    const value = job.phase === 'model' && job.modelTotal ? job.modelLoaded / job.modelTotal : job.progress;
    const indeterminate = job.phase === 'reading' || job.phase === 'detecting' || job.phase === 'waiting' || (job.phase === 'model' && !job.modelTotal);
    return (
      <section className="card rc-status is-active" aria-label="Transcription">
        <div className="rc-status-row">
          <div className="rc-status-text">
            <strong>{job.stopping ? 'Stopping…' : jobLabel(job)}</strong>
            <span className="faint">
              {job.phase === 'model' && job.modelTotal ? `${formatBytes(job.modelLoaded)} of ${formatBytes(job.modelTotal)} · downloads once, then works offline` : ''}
              {job.phase === 'transcribing' ? [etaLabel(job.eta), job.device === 'webgpu' ? 'using the graphics chip' : job.device === 'wasm' ? 'using the processor' : ''].filter(Boolean).join(' · ') : ''}
              {job.phase === 'reading' ? 'Decoding the audio in this browser' : ''}
              {job.phase === 'waiting' ? 'Another recording is being transcribed first' : ''}
            </span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onStop} disabled={job.stopping}><Square size={13} fill="currentColor" /> Stop</button>
        </div>
        <div
          className={`progress rc-status-bar ${indeterminate ? 'is-indeterminate' : ''}`}
          role="progressbar"
          aria-label="Transcription progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={indeterminate ? undefined : Math.round(value * 100)}
        >
          <span style={{ width: indeterminate ? undefined : `${Math.max(2, Math.round(value * 100))}%` }} />
        </div>
        {job.preview && job.phase === 'transcribing' && <p className="rc-preview" aria-hidden>…{job.preview.trim().slice(-150)}</p>}
      </section>
    );
  }
  if (state.kind === 'done') return null;
  if (state.kind === 'elsewhere') {
    return <section className="card rc-status"><p className="muted">This recording is being transcribed in another tab.</p></section>;
  }
  if (state.kind === 'stopped' && hasSegments) {
    return (
      <section className="card rc-status">
        <div className="rc-status-row">
          <div className="rc-status-text">
            <strong>{state.label}</strong>
            <span className="faint">The transcript so far is below. Carry on from where it stopped.</span>
          </div>
          <div className="rc-status-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRestart}>Start over</button>
            <button type="button" className="btn btn-brand btn-sm" onClick={onResume}><Play size={14} /> Resume</button>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className={`card rc-status rc-start ${state.kind === 'error' ? 'is-error' : ''}`} aria-labelledby="rc-start-title">
      <div className="rc-status-text">
        <strong id="rc-start-title">{state.kind === 'error' ? 'This recording couldn’t be transcribed' : 'Transcribe this recording'}</strong>
        <span className="faint">{state.kind === 'error' ? error ?? 'Try again, or try the Faster model.' : 'It runs on this device. The first time, the speech model downloads once.'}</span>
      </div>
      <TranscribeFields value={prefs} onChange={setPrefs} compact />
      <div className="rc-status-actions">
        <button type="button" className="btn btn-brand" onClick={onStart}>{state.kind === 'error' ? <><RefreshCw size={15} /> Try again</> : <><Play size={15} /> Transcribe</>}</button>
      </div>
    </section>
  );
}
