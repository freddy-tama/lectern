// "Record a class": the microphone recorder, its floating indicator, and the global
// listeners that tell you when a transcript is ready. Mounted once, in the app shell.

import { Check, Mic, Pause, Play, ShieldCheck, Square, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { clock, lengthLabel } from '../../core/transcribe/time';
import { lessonForNow, recordingTitle } from '../../data/recordings';
import { isoDate } from '../../data/repo';
import { Dialog } from '../../ui/Dialog';
import { useToast } from '../../ui/Toast';
import { useNow } from '../../ui/hooks';
import { useNoteRefs } from '../notes/refs';
import { type TranscribePrefs, loadPrefs, onTranscriptionEnd, savePrefs, transcribe } from './engine';
import { type LinkValue, LinkFields, TranscribeFields } from './Fields';
import {
  type RecorderPreset, canRecord, clearRecorderError, discardRecording, onOpenRecorder, pauseRecording, recordedMs,
  resumeRecording, startRecording, stopRecording, useRecorder,
} from './recorder';

const BARS = 24;

/** A live input meter: bars rise with the level, newest on the right. */
function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const [history, setHistory] = useState<number[]>(() => Array(BARS).fill(0));
  useEffect(() => {
    if (!active) return;
    setHistory((h) => [...h.slice(1), level]);
  }, [level, active]);
  return (
    <div className={`rc-meter ${active ? '' : 'is-paused'}`} aria-hidden>
      {history.map((v, i) => <span key={i} style={{ '--v': Math.max(0.06, v) } as React.CSSProperties} />)}
    </div>
  );
}

/** The class fields, with defaults from the lesson asked for or today's schedule. Mounted only while open. */
function RecorderLinks({ preset, link, setLink, titleTouched, setTitleTouched, needsDefaults, onDefaulted }: {
  preset?: RecorderPreset;
  link: LinkValue;
  setLink(link: LinkValue): void;
  titleTouched: boolean;
  setTitleTouched(): void;
  needsDefaults: boolean;
  onDefaulted(): void;
}) {
  const refs = useNoteRefs();
  useEffect(() => {
    if (!needsDefaults || !refs) return;
    const lesson = preset?.lessonId ? refs.lesson.get(preset.lessonId) : preset?.courseId ? undefined : lessonForNow(refs.lessons);
    const date = lesson?.date ?? isoDate(new Date());
    setLink({ title: recordingTitle({ lesson, date }), courseId: lesson?.courseId ?? preset?.courseId, lessonId: lesson?.id, date });
    onDefaulted();
  }, [needsDefaults, refs, preset, setLink, onDefaulted]);
  return <LinkFields refs={refs} value={link} onChange={setLink} titleTouched={titleTouched} onTitleTouched={setTitleTouched} />;
}

export function RecordingsGlobal() {
  const rec = useRecorder();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const now = useNow(rec.status === 'recording' ? 500 : 60_000);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<LinkValue>({ title: '' });
  const [titleTouched, setTitleTouched] = useState(false);
  const [preset, setPreset] = useState<RecorderPreset | undefined>();
  const [needsDefaults, setNeedsDefaults] = useState(false);
  const touchTitle = useCallback(() => setTitleTouched(true), []);
  const defaulted = useCallback(() => setNeedsDefaults(false), []);
  const [saved, setSaved] = useState<{ id: string; seconds: number } | null>(null);
  const [prefs, setPrefs] = useState<TranscribePrefs>(loadPrefs);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Opened from anywhere: the lesson page, the recordings page.
  useEffect(() => onOpenRecorder((next?: RecorderPreset) => {
    setOpen(true);
    setSaved(null);
    setConfirmDiscard(false);
    clearRecorderError();
    if (rec.status !== 'idle') return;
    setPreset(next);
    setLink({ title: '' });
    setNeedsDefaults(true);
    setTitleTouched(false);
    setPrefs(loadPrefs());
  }), [rec.status]);

  // Tell people when a transcript is ready, wherever they are in the app.
  useEffect(() => onTranscriptionEnd((e) => {
    if (e.outcome === 'stopped') return;
    const here = location.pathname === `/recordings/${e.recordingId}`;
    if (e.outcome === 'done') {
      if (!here) toast.show(`Transcript ready: ${e.title}`, { action: { label: 'Open', run: () => navigate(`/recordings/${e.recordingId}`) } });
    } else {
      toast.show(here ? (e.message ?? 'Transcription stopped.') : `Couldn’t transcribe “${e.title}”`, {
        tone: 'error',
        ...(here ? {} : { action: { label: 'Open', run: () => navigate(`/recordings/${e.recordingId}`) } }),
      });
    }
  }), [location.pathname, navigate, toast]);

  const live = rec.status === 'recording' || rec.status === 'paused';
  const ms = recordedMs(rec, now);

  const start = () => startRecording({ ...link, title: link.title.trim() || recordingTitle({ date: link.date }) });

  const stop = async () => {
    const seconds = Math.round(recordedMs(rec) / 1000);
    const id = await stopRecording();
    if (id) {
      setSaved({ id, seconds });
      setOpen(true);
    }
  };

  const transcribeNow = () => {
    if (!saved) return;
    savePrefs(prefs);
    void transcribe(saved.id, prefs);
    setOpen(false);
    navigate(`/recordings/${saved.id}`);
  };

  return (
    <>
      {live && !open && (
        <div className="rc-pill" role="status">
          <button type="button" className="rc-pill-main" onClick={() => setOpen(true)} title="Open the recorder">
            <span className={`rc-live-dot ${rec.status === 'paused' ? 'is-paused' : ''}`} aria-hidden />
            <span className="tabular">{clock(ms / 1000)}</span>
            <span className="rc-pill-label">{rec.status === 'paused' ? 'Paused' : 'Recording'}</span>
          </button>
          <button type="button" className="rc-pill-stop" onClick={() => void stop()} aria-label="Stop and save the recording" title="Stop and save">
            <Square size={13} fill="currentColor" />
          </button>
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => { setOpen(false); setConfirmDiscard(false); }}
        title={saved ? 'Recording saved' : live || rec.status === 'saving' ? 'Recording a class' : 'Record a class'}
        description={saved ? undefined : live ? 'You can close this and keep using Lectern in this tab. Recording carries on.' : 'Uses this device’s microphone. Keep this tab open while you record.'}
        className="rc-dialog rc-recorder"
        footer={saved ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); navigate(`/recordings/${saved.id}`); }}>Later</button>
            <button type="button" className="btn btn-brand" onClick={transcribeNow}>Transcribe now</button>
          </>
        ) : live ? (
          <>
            {confirmDiscard ? (
              <>
                <span className="rc-confirm">Delete this recording?</span>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmDiscard(false)}>Keep it</button>
                <button type="button" className="btn btn-danger" onClick={() => { setConfirmDiscard(false); setOpen(false); void discardRecording(); }}><Trash2 size={15} /> Delete</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost rc-discard" onClick={() => setConfirmDiscard(true)}><Trash2 size={15} /> Discard</button>
                {rec.status === 'paused'
                  ? <button type="button" className="btn btn-secondary" onClick={resumeRecording}><Play size={15} /> Resume</button>
                  : <button type="button" className="btn btn-secondary" onClick={pauseRecording}><Pause size={15} /> Pause</button>}
                <button type="button" className="btn btn-brand" onClick={() => void stop()}><Square size={14} fill="currentColor" /> Stop and save</button>
              </>
            )}
          </>
        ) : rec.status === 'saving' ? undefined : (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-brand" onClick={() => void start()} disabled={rec.status === 'starting' || !canRecord()}>
              {rec.status === 'starting' ? <><span className="spinner" aria-hidden /> Waiting for the microphone…</> : <><Mic size={16} /> Start recording</>}
            </button>
          </>
        )}
      >
        {saved ? (
          <div className="rc-saved">
            <p className="rc-saved-line"><span className="rc-saved-icon"><Check size={16} /></span> {lengthLabel(saved.seconds)} recorded and saved in this browser.</p>
            <TranscribeFields value={prefs} onChange={setPrefs} compact />
            <p className="rc-privacy-line"><ShieldCheck size={15} aria-hidden /> Transcribed on this device. The audio never leaves your browser.</p>
          </div>
        ) : live || rec.status === 'saving' ? (
          <div className="rc-live">
            <div className="rc-live-head">
              <span className={`rc-live-dot ${rec.status === 'paused' ? 'is-paused' : ''}`} aria-hidden />
              <span>{rec.status === 'saving' ? 'Saving…' : rec.status === 'paused' ? 'Paused' : 'Recording'}</span>
            </div>
            <div className="rc-clock tabular" role="timer" aria-live="off">{clock(ms / 1000)}</div>
            <LevelMeter level={rec.level} active={rec.status === 'recording'} />
            <p className="faint rc-live-title">{rec.title}</p>
          </div>
        ) : (
          <>
            {!canRecord() && <p className="rc-error" role="alert">This browser can’t record audio. Record on your phone, then drop the file on the Recordings page.</p>}
            {open && (
              <RecorderLinks
                preset={preset}
                link={link}
                setLink={setLink}
                titleTouched={titleTouched}
                setTitleTouched={touchTitle}
                needsDefaults={needsDefaults}
                onDefaulted={defaulted}
              />
            )}
            <p className="rc-privacy-line"><ShieldCheck size={15} aria-hidden /> Saved in this browser as you go. Nothing is uploaded.</p>
          </>
        )}
        {rec.error && <p className="rc-error" role="alert">{rec.error}</p>}
      </Dialog>
    </>
  );
}
