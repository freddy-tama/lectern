// One small step after choosing a file: which class it was, and how to transcribe it.

import { FileAudio, FileVideo, Info, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { lengthLabel } from '../../core/transcribe/time';
import { lessonForNow, recordingTitle } from '../../data/recordings';
import { isoDate } from '../../data/repo';
import { Dialog } from '../../ui/Dialog';
import { useNoteRefs } from '../notes/refs';
import { addRecordingFile } from './actions';
import { LONG_SECONDS, isVideo, probeDuration } from './decode';
import { type TranscribePrefs, loadPrefs, savePrefs, transcribe } from './engine';
import { type LinkValue, LinkFields, TranscribeFields } from './Fields';
import { formatBytes } from './status';

export interface LinkPreset {
  courseId?: string;
  lessonId?: string;
}

/** Opens while a file is waiting to be added. */
export function AddRecordingDialog({ file, preset, onClose }: { file: File | null; preset?: LinkPreset; onClose(): void }) {
  return file ? <AddRecording key={`${file.name}-${file.size}-${file.lastModified}`} file={file} preset={preset} onClose={onClose} /> : null;
}

function AddRecording({ file, preset, onClose }: { file: File; preset?: LinkPreset; onClose(): void }) {
  const refs = useNoteRefs();
  const navigate = useNavigate();
  const [link, setLink] = useState<LinkValue>({ title: '' });
  const [titleTouched, setTitleTouched] = useState(false);
  const [prefs, setPrefs] = useState<TranscribePrefs>(loadPrefs);
  const [duration, setDuration] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState<'save' | 'start' | null>(null);
  const [error, setError] = useState('');
  const initialised = useRef(false);

  // Defaults, once: the lesson asked for, else one on today's schedule.
  useEffect(() => {
    if (!refs || initialised.current) return;
    initialised.current = true;
    const lesson = preset?.lessonId ? refs.lesson.get(preset.lessonId) : preset?.courseId ? undefined : lessonForNow(refs.lessons);
    const fileDay = file.lastModified ? isoDate(new Date(file.lastModified)) : isoDate(new Date());
    setLink({
      title: recordingTitle({ lesson, fileName: file.name, date: lesson?.date ?? fileDay }),
      courseId: lesson?.courseId ?? preset?.courseId,
      lessonId: lesson?.id,
      date: lesson?.date ?? fileDay,
    });
  }, [file, refs, preset?.lessonId, preset?.courseId]);

  useEffect(() => {
    let alive = true;
    probeDuration(file).then((d) => { if (alive) setDuration(d ?? null); });
    return () => { alive = false; };
  }, [file]);

  const video = isVideo(file);
  const long = (duration ?? 0) > LONG_SECONDS;
  const huge = file.size > 1.5 * 1024 ** 3;

  const save = async (start: boolean) => {
    setError('');
    setBusy(start ? 'start' : 'save');
    try {
      const rec = await addRecordingFile(file, { ...link, title: link.title.trim() || recordingTitle({ fileName: file.name, date: link.date }), durationSec: duration ?? 0 });
      savePrefs(prefs);
      if (start) void transcribe(rec.id, prefs);
      onClose();
      navigate(`/recordings/${rec.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file couldn’t be added.');
      setBusy(null);
    }
  };

  return (
    <Dialog
      open
      onClose={() => { if (!busy) onClose(); }}
      title="Add a recording"
      description="Which class is it from? Linking it puts the transcript beside the lesson."
      className="rc-dialog"
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={() => void save(false)} disabled={busy !== null}>
            {busy === 'save' ? <span className="spinner" aria-hidden /> : null} Save for later
          </button>
          <button type="button" className="btn btn-brand" onClick={() => void save(true)} disabled={busy !== null}>
            {busy === 'start' ? <><span className="spinner" aria-hidden /> {video ? 'Preparing audio…' : 'Adding…'}</> : 'Transcribe'}
          </button>
        </>
      )}
    >
      <div className="rc-file">
        <span className="rc-file-icon">{video ? <FileVideo size={20} /> : <FileAudio size={20} />}</span>
        <div className="rc-file-text">
          <strong>{file.name}</strong>
          <span className="faint">
            {formatBytes(file.size)}
            {duration === undefined ? ' · checking length…' : duration ? ` · ${lengthLabel(duration)}` : ''}
          </span>
        </div>
      </div>

      {(long || huge) && (
        <p className="rc-note is-warn" role="note">
          <Info size={16} aria-hidden />
          <span>
            {long ? `This is a long recording (${lengthLabel(duration ?? 0)}). Transcribing takes a while and uses a lot of memory; keep this tab open. It saves as it goes, so you can stop and carry on later.` : 'This is a very large file. If the browser runs out of memory, export just the audio as mp3 or m4a and try that.'}
          </span>
        </p>
      )}
      {duration === null && !video && (
        <p className="rc-note" role="note"><Info size={16} aria-hidden /><span>This browser couldn’t read the file’s length. It may not be able to read the audio either, but you can try.</span></p>
      )}
      {video && <p className="rc-note" role="note"><Info size={16} aria-hidden /><span>Only the sound is kept, as compact audio, so the video doesn’t fill up this browser’s storage.</span></p>}

      <LinkFields refs={refs} value={link} onChange={setLink} titleTouched={titleTouched} onTitleTouched={() => setTitleTouched(true)} />
      <TranscribeFields value={prefs} onChange={setPrefs} />

      <p className="rc-privacy-line"><ShieldCheck size={15} aria-hidden /> Transcribed on this device. The audio never leaves your browser.</p>
      {error && <p className="rc-error" role="alert">{error}</p>}
    </Dialog>
  );
}
