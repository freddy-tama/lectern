// The video under the pitch: a screen recording of the real app with the sample talk, captions
// burned in so it works muted. It loads only when someone scrolls near it, plays muted on a loop
// while it is on screen, and never starts on its own for people who ask for reduced motion.

import { useEffect, useRef, useState } from 'react';
import { useSeen } from './hooks';

const SRC = '/media/lectern-tour.mp4';
const POSTER = '/media/lectern-tour.jpg';
const SECONDS = 75;

/** How long the video runs, for the link to it at the top of the page. */
export const TOUR_LENGTH = `${SECONDS} sec`;

/**
 * Where each part of the recording starts, in seconds. The names stay clear of the page's other button names
 * ("Presenter view" is one), since tests find buttons by a part of their name.
 */
const CHAPTERS = [
  { at: 0, label: 'Key notes' },
  { at: 14, label: 'Present mode' },
  { at: 22, label: 'Script and clock' },
  { at: 30, label: 'Teleprompter' },
  { at: 38, label: 'Phone quiz' },
  { at: 54, label: 'Notes to slides' },
];

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Tour({ reduced }: { reduced: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const seen = useSeen(frame, '400px');
  const [chapter, setChapter] = useState(0);

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

  return (
    <section id="tour" className="lp-section tour" aria-labelledby="tour-title" tabIndex={-1}>
      <div className="lp-container">
        <div className="lp-head lp-head-center">
          <p className="lp-eyebrow">Watch it run</p>
          <h2 id="tour-title" className="lp-h2">The real app, <em>start to finish.</em></h2>
          <p className="lp-sub">
            A {SECONDS}-second screen recording of Lectern with the sample talk: its key notes, present mode, presenter
            view, the teleprompter, the phone quiz, and rough notes turned into slides. The captions are on screen, so
            it needs no sound.
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
            aria-label="Screen recording of Lectern running the sample talk, with on-screen captions"
          />
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
