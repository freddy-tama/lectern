// Adds a sound to a slide: a recording of the text, a pronunciation, a clip. It plays from a
// button while presenting, on phones that follow, in study mode and in the exported PowerPoint.

import { Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { SlideAudio } from '../../core/deck/types';
import { SLIDE_AUDIO_MAX, audioMime, isAudioName } from '../../core/media/audio';
import { saveAsset } from '../../data/repo';
import { SlideAudioPlayer } from '../slides/SlideAudioPlayer';

export function SlideAudioField({ audio, onChange }: { audio?: SlideAudio; onChange(audio: SlideAudio | undefined): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const take = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (!file.type.startsWith('audio/') && !isAudioName(file.name)) { setError('Choose a sound file: MP3, M4A or WAV.'); return; }
    if (file.size > SLIDE_AUDIO_MAX) { setError('This sound is over 30 MB. Choose a shorter one.'); return; }
    try {
      // Some browsers leave the type empty, and a phone needs it to play the file.
      const typed = file.type ? file : new Blob([file], { type: audioMime(file.name) });
      const title = file.name.replace(/\.[^.]+$/, '').slice(0, 80);
      onChange({ src: await saveAsset(typed, file.name), ...(title ? { title } : {}) });
    } catch (e) {
      setError(`The sound couldn’t be saved in this browser. ${(e as Error).message}`);
    }
  };

  return (
    <div className="field slide-audio-field">
      <span className="field-label">Sound</span>
      {audio ? (
        <>
          <SlideAudioPlayer key={audio.src} audio={audio} missing="This sound isn’t in this browser any more. Add it again." />
          <input
            className="input"
            value={audio.title ?? ''}
            maxLength={80}
            placeholder="What it is, like “Paragraph 1”"
            aria-label="Name of the sound"
            onChange={(e) => onChange({ ...audio, title: e.target.value })}
          />
          <div className="slide-audio-field-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()}><Upload size={14} /> Replace</button>
            <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => onChange(undefined)}><Trash2 size={14} /> Remove</button>
          </div>
        </>
      ) : (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()}><Upload size={14} /> Add a sound</button>
      )}
      <p className="field-help">Plays from a button when you present and on phones. It travels with the deck, so it works without a connection.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <input ref={input} type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac" hidden onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
