// The play button for a sound on a slide. The file is stored on the device with the deck,
// so it keeps playing when the network drops. Sound starts only from a tap, since phones
// refuse anything else, and if it can't start the player says why.

import { Pause, Play, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SlideAudio } from '../../core/deck/types';
import { audioClock, audioProblem } from '../../core/media/audio';
import { assetUrl } from '../../data/repo';

// Clicks and keys on the player belong to it, not to the "next slide" handlers around it.
const keep = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerUp: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

export function SlideAudioPlayer({ audio, className = '', missing = 'This sound isn’t on this device. Listen on the presenter’s screen.' }: {
  audio: SlideAudio;
  className?: string;
  /** What to say when the file isn't here. */
  missing?: string;
}) {
  const el = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [problem, setProblem] = useState('');
  const title = audio.title?.trim() || 'Listen';

  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    setProblem('');
    assetUrl(audio.src).then((u) => { if (alive) setUrl(u); }).catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [audio.src]);

  // Leaving the slide stops the sound.
  useEffect(() => {
    const player = el.current;
    return () => { player?.pause(); };
  }, [url]);

  const toggle = () => {
    const player = el.current;
    if (!player) return;
    if (!player.paused) { player.pause(); return; }
    setProblem('');
    // After an error the file has to be loaded again: a link that failed may work now.
    if (player.error) player.load();
    if (player.ended) player.currentTime = 0;
    // Right inside the tap: phones only allow sound that starts from one.
    player.play()?.catch((err: { name?: string }) => setProblem(audioProblem(err)));
  };

  if (url === null) {
    return (
      <div className={`slide-audio is-missing ${className}`} role="status" {...keep}>
        <Volume2 size={18} aria-hidden />
        <span className="slide-audio-note">{missing}</span>
      </div>
    );
  }

  return (
    <div className={`slide-audio ${problem ? 'has-problem' : ''} ${className}`} {...keep}>
      {url && (
        <audio
          ref={el}
          src={url}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setTime(0); }}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setLength(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
          onError={(e) => { setPlaying(false); setProblem(audioProblem(e.currentTarget.error)); }}
        />
      )}
      <button type="button" className="slide-audio-play" onClick={toggle} disabled={!url} aria-label={`${playing ? 'Pause' : 'Play'}: ${title}`}>
        {playing ? <Pause size={20} fill="currentColor" strokeWidth={0} /> : <Play size={20} fill="currentColor" strokeWidth={0} />}
      </button>
      <div className="slide-audio-main">
        <span className="slide-audio-title"><Volume2 size={14} aria-hidden /> <span>{title}</span></span>
        <input
          type="range"
          className="slide-audio-seek"
          min={0}
          max={length || 1}
          step={0.1}
          value={Math.min(time, length || 1)}
          disabled={!length}
          aria-label={`Position in ${title}`}
          onChange={(e) => { const at = Number(e.target.value); setTime(at); if (el.current) el.current.currentTime = at; }}
        />
      </div>
      <span className="slide-audio-time tabular">{audioClock(time)} / {audioClock(length)}</span>
      {problem && <p className="slide-audio-note" role="alert">{problem}</p>}
    </div>
  );
}
