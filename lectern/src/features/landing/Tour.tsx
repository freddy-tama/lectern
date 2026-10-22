// The video under the pitch: a screen recording of Lectern, narrated, with captions burned in so it works muted. The
// sample talk was recorded on a build of the app, and the AI run live on this site. It loads only when someone scrolls near it, plays muted on a loop while it is on screen, and never starts
// on its own for people who ask for reduced motion. "Play with sound" starts it again from the top with the voice.

import { Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSeen } from './hooks';

const SRC = '/media/lectern-tour.mp4';
const POSTER = '/media/lectern-tour.jpg';
const SECONDS = 124;

/** How long the video runs, for the link to it at the top of the page. */
export const TOUR_LENGTH = `${SECONDS} sec`;

/**
 * Where each part of the recording starts, in whole seconds, rounded down so a jump with the sound on doesn't clip
 * the start of the narration. The names stay clear of the page's other button names
 * ("Presenter view", "Present it" and "Teleprompter" are some), since tests find buttons by a part of their name.
 */
const CHAPTERS = [
  { at: 0, label: 'Script on every slide' },
  { at: 14, label: 'On the big screen' },
  { at: 22, label: 'Script and clock' },
  { at: 30, label: 'Auto-scrolling script' },
  { at: 38, label: 'Quiz by QR code' },
  { at: 54, label: 'Two files, one brief' },
  { at: 72, label: 'Opus plans and drafts' },
  { at: 95, label: 'Changes in plain words' },
  { at: 113, label: 'Three screens in step' },
];

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Tour({ reduced }: { reduced: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const seen = useSeen(frame, '400px');
  const [chapter, setChapter] = useState(0);
  const [muted, setMuted] = useState(true);

  // Plays while on screen. It resumes on its own only if it was this page that paused it.
  useEffect(() => {
    const el = frame.current;
    const v = video.current;
    if (!seen || reduced || !el || !v || typeof IntersectionObserver === 'undefined') return;
    let started = false;
    let pausedByPage = false;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && (!started || pausedByPage)) {
        started = true;
        pausedByPage = false;
        v.play().catch(() => { /* the browser said no; the controls are there */ });
      } else if (!entry.isIntersecting && !v.paused) {
        pausedByPage = true;
        v.pause();
      }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, reduced]);

  const onTime = () => {
    const t = video.current?.currentTime ?? 0;
    let i = 0;
    while (i + 1 < CHAPTERS.length && CHAPTERS[i + 1].at <= t) i++;
    if (i !== chapter) setChapter(i);
  };

  const seek = (at: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = at;
    void v.play().catch(() => {});
  };

  // The narration starts with the video, so sound on means from the top.
  const toggleSound = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (!v.muted) seek(0);
  };

  return (
    <section id="tour" className="lp-section tour" aria-labelledby="tour-title" tabIndex={-1}>
      <div className="lp-container">
        <div className="lp-head lp-head-center">
          <p className="lp-eyebrow">Watch it run</p>
          <h2 id="tour-title" className="lp-h2">The real app, <em>start to finish.</em></h2>
          <p className="lp-sub">
            A {SECONDS}-second recording of Lectern, narrated and captioned. First the sample talk: its key notes,
            present mode, presenter view, the teleprompter and the phone quiz. Then a live AI run on this site: Claude
            Opus turns two sample files and a demanding brief into a deck, the deck assistant changes it on request, and
            it plays on a laptop, the room’s screen and a phone. The AI’s waits are cut, and each cut says how long it
            was.
          </p>
        </div>

        <div ref={frame} className="tour-frame">
          <div className="tour-glow" aria-hidden />
          <video
            ref={video}
            className="tour-video"
            src={seen ? SRC : undefined}
            poster={seen ? POSTER : undefined}
            width={1280}
            height={720}
            muted
            loop
            playsInline
            controls
            preload="none"
            onTimeUpdate={onTime}
            onVolumeChange={() => setMuted(video.current?.muted ?? true)}
            aria-label="Screen recording of Lectern, with narration and on-screen captions"
          />
          <button type="button" className="tour-sound" onClick={toggleSound} disabled={!seen}>
            {muted ? <><Volume2 size={16} aria-hidden /> Play with sound</> : <><VolumeX size={16} aria-hidden /> Mute</>}
          </button>
        </div>

        <ol className="tour-chapters" aria-label="Jump to a part of the video">
          {CHAPTERS.map((c, i) => (
            <li key={c.label}>
              <button type="button" className="tour-chapter" aria-current={chapter === i ? 'step' : undefined} onClick={() => seek(c.at)} disabled={!seen}>
                <span className="tour-time">{clock(c.at)}</span> {c.label}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
