// The audio player on a recording's page: play, scrub, skip and speed, with Space and
// the arrow keys. The transcript follows its time.

import { LocateFixed, Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { clock } from '../../core/transcribe/time';
import { useKeys } from '../../ui/hooks';

export const SPEEDS = [1, 1.25, 1.5, 2];
const RATE_KEY = 'lectern.playbackRate';

export interface PlayerState {
  /** Callback ref for the <audio> element. */
  attach(el: HTMLAudioElement | null): void;
  time: number;
  duration: number;
  playing: boolean;
  rate: number;
  seek(seconds: number, play?: boolean): void;
  toggle(): void;
  skip(seconds: number): void;
  setRate(rate: number): void;
}

/** Wires an <audio> element to React state. Time updates about ten times a second while playing. */
export function usePlayer(fallbackDuration: number): PlayerState {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [el, setEl] = useState<HTMLAudioElement | null>(null);
  const attach = useCallback((node: HTMLAudioElement | null) => { ref.current = node; setEl(node); }, []);
  const [time, setTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(() => {
    try { const r = Number(localStorage.getItem(RATE_KEY)); return SPEEDS.includes(r) ? r : 1; } catch { return 1; }
  });

  useEffect(() => {
    if (!el) return;
    el.playbackRate = rate;
    const onTime = () => setTime(el.currentTime);
    const onDuration = () => setMediaDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => { setPlaying(false); setTime(el.currentTime); };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('seeked', onTime);
    el.addEventListener('durationchange', onDuration);
    el.addEventListener('loadedmetadata', onDuration);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onPause);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('seeked', onTime);
      el.removeEventListener('durationchange', onDuration);
      el.removeEventListener('loadedmetadata', onDuration);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onPause);
    };
    // The rate is applied by setRate afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el]);

  // Smoother than timeupdate while playing, so the highlighted line keeps pace.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = 0;
    const tick = (t: number) => {
      frame = requestAnimationFrame(tick);
      if (t - last < 100) return;
      last = t;
      if (ref.current) setTime(ref.current.currentTime);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const duration = mediaDuration || fallbackDuration;

  const seek = useCallback((seconds: number, play = false) => {
    const el = ref.current;
    if (!el) return;
    const max = (Number.isFinite(el.duration) && el.duration) || duration || seconds;
    el.currentTime = Math.max(0, Math.min(max, seconds));
    setTime(el.currentTime);
    if (play && el.paused) el.play().catch(() => {});
  }, [duration]);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);

  const skip = useCallback((seconds: number) => {
    const el = ref.current;
    if (el) seek(el.currentTime + seconds);
  }, [seek]);

  const setRate = useCallback((r: number) => {
    setRateState(r);
    if (ref.current) ref.current.playbackRate = r;
    try { localStorage.setItem(RATE_KEY, String(r)); } catch { /* private mode */ }
  }, []);

  return { attach, time, duration, playing, rate, seek, toggle, skip, setRate };
}

interface PlayerProps {
  player: PlayerState;
  src: string | null;
  /** Shown at the end of the bar, for example "Follow the audio". */
  extra?: ReactNode;
  following: boolean;
  onFollow(): void;
}

export function Player({ player, src, extra, following, onFollow }: PlayerProps) {
  const { attach, time, duration, playing, rate, seek, toggle, skip, setRate } = player;

  useKeys((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (e.key === ' ' || e.key === 'k') {
      // Space on a focused button presses that button instead.
      if (e.key === ' ' && target?.closest('button, a, [role="button"], summary')) return;
      e.preventDefault();
      toggle();
    } else if (e.key === 'ArrowLeft' || e.key === 'j') {
      e.preventDefault();
      skip(-10);
    } else if (e.key === 'ArrowRight' || e.key === 'l') {
      e.preventDefault();
      skip(10);
    }
  }, [toggle, skip]);

  const pct = duration ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className="rc-player" role="region" aria-label="Audio player">
      <audio ref={attach} src={src ?? undefined} preload="metadata" />
      <div className="rc-player-buttons">
        <button type="button" className="icon-btn rc-skip" onClick={() => skip(-10)} aria-label="Back 10 seconds" title="Back 10 seconds (←)">
          <RotateCcw size={17} /><span aria-hidden>10</span>
        </button>
        <button type="button" className="rc-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'} disabled={!src}>
          {playing ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button type="button" className="icon-btn rc-skip" onClick={() => skip(10)} aria-label="Forward 10 seconds" title="Forward 10 seconds (→)">
          <RotateCw size={17} /><span aria-hidden>10</span>
        </button>
      </div>
      <div className="rc-scrubber">
        <span className="rc-time tabular">{clock(time)}</span>
        <input
          type="range"
          className="rc-range"
          min={0}
          max={Math.max(1, duration)}
          step={0.1}
          value={Math.min(time, Math.max(1, duration))}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Position"
          aria-valuetext={`${clock(time)} of ${clock(duration)}`}
          style={{ '--pct': `${pct}%` } as React.CSSProperties}
          disabled={!src}
        />
        <span className="rc-time tabular faint">{clock(duration)}</span>
      </div>
      <div className="rc-player-end">
        <div className="segmented rc-speed" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" aria-pressed={rate === s} onClick={() => setRate(s)}>{s}×</button>
          ))}
        </div>
        {!following && playing && (
          <button type="button" className="btn btn-secondary btn-sm rc-follow" onClick={onFollow} title="Scroll the transcript with the audio again">
            <LocateFixed size={15} /> Follow
          </button>
        )}
        {extra}
      </div>
    </div>
  );
}
