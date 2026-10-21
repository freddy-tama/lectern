// The pitch beside the headline: one slide of the sample talk and its key notes, carried through
// the places Lectern uses them. The slide is drawn by the real slide engine and every word comes
// from the sample deck; only the arrangement around it is illustration.

import { Check, Clock, FileDown, Pause, Play, QrCode, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Slide } from '../../core/deck/types';
import { formatClock } from '../../ui/hooks';
import { SlideView } from '../slides/SlideView';
import { usePrefersReducedMotion } from './hooks';
import { TALK_ID, deckRun, sampleDeck, slideHeading } from './samples';

/** The slide the film follows: the chart that hides its takeaway until a click. */
const SLIDE_ID = 's_mt_04';

/**
 * Each scene: its chapter name, the line under the film, how long it plays, and when its one action happens.
 * Chapter names avoid the exact names of the page's other controls, so tests that find those by text stay unambiguous.
 */
export const SCENES = [
  { label: 'Notes', caption: 'Each slide carries its own script, key points, cues, a likely question and planned minutes.', ms: 6200, beat: 0 },
  { label: 'On stage', caption: 'The room sees the slide. You see the script, the cue and the clock.', ms: 6000, beat: 1700 },
  { label: 'Phones', caption: 'Read the script on your phone while the room answers the quiz on theirs.', ms: 5800, beat: 1900 },
  { label: 'Study', caption: 'Rehearse alone: your likely questions come back as flashcards.', ms: 5200, beat: 1700 },
  { label: 'Share', caption: 'Print a handout, or download a .pptx with your script in the speaker notes.', ms: 5600, beat: 0 },
] as const;

const PRESENT = 1;
const PHONES = 2;
const SHARE = 4;

function sentences(text: string, count: number): string {
  return text.split(/(?<=[.!?])\s+/).slice(0, count).join(' ');
}

/** Everything the film shows, read from the sample talk. */
function filmData() {
  const deck = sampleDeck(TALK_ID);
  if (!deck) return null;
  const { slides } = deckRun(deck);
  const at = slides.findIndex((s) => s.id === SLIDE_ID);
  if (at < 0) return null;
  const slide = slides[at];
  const quiz = slides.filter((s) => s.kind === 'question' && optionsOf(s).length > 1);
  const minutesBefore = slides.slice(0, at).reduce((m, s) => m + s.notes.minutes, 0);
  const minutesTotal = slides.reduce((m, s) => m + s.notes.minutes, 0);
  return {
    deck,
    slide,
    number: at + 1,
    count: slides.length,
    next: slides[at + 1] ? slideHeading(slides[at + 1]) : '',
    quiz: quiz[0] ? { slide: quiz[0], count: quiz.length } : null,
    startSeconds: Math.round(minutesBefore * 60),
    total: formatClock(minutesTotal * 60_000),
  };
}

function optionsOf(slide: Slide): string[] {
  const options = (slide.content as { options?: unknown }).options;
  return Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string' && o.trim() !== '') : [];
}

/** Presenter view's clock, counting on from where the plan says this slide starts. */
function Elapsed({ from, running }: { from: number; running: boolean }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  return <>{formatClock((from + secs) * 1000)}</>;
}

export function PitchFilm() {
  const reduced = usePrefersReducedMotion();
  const data = useMemo(filmData, []);
  const [scene, setScene] = useState(0);
  const [beatRun, setBeatRun] = useState(-1);
  const [auto, setAuto] = useState(true);
  const [inView, setInView] = useState(true);
  const [pageShown, setPageShown] = useState(() => typeof document === 'undefined' || !document.hidden);
  const [mounted, setMounted] = useState<Set<number>>(() => new Set([0, 1]));
  const [run, setRun] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  /** The time left in this run of the scene. Each run gets its own object, so a stale timer can't change a new one. */
  const left = useRef<{ ms: number }>({ ms: SCENES[0].ms });
  const playing = auto && !reduced && inView && pageShown;
  const beat = reduced || beatRun === run;

  const show = (i: number) => {
    left.current = { ms: SCENES[i].ms };
    setScene(i);
    setRun((r) => r + 1);
    // The next scene's parts are drawn a scene early, so nothing pops in mid-move.
    const next = (i + 1) % SCENES.length;
    setMounted((m) => (m.has(i) && m.has(next) ? m : new Set(m).add(i).add(next)));
  };

  // Moves on when the scene's time is up. Pausing keeps the time left, so the progress bar and the scene agree.
  useEffect(() => {
    if (!playing) return;
    const time = left.current;
    const started = performance.now();
    const id = setTimeout(() => show((scene + 1) % SCENES.length), time.ms);
    return () => {
      clearTimeout(id);
      time.ms = Math.max(0, time.ms - (performance.now() - started));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, scene, run]);

  // The scene's one action (a click, a tap, a card flip) happens a moment after it appears.
  useEffect(() => {
    const at = SCENES[scene].beat;
    if (reduced || !at) return;
    const id = setTimeout(() => setBeatRun(run), at);
    return () => clearTimeout(id);
  }, [scene, run, reduced]);

  // Plays only while on screen and while the tab is in front.
  useEffect(() => {
    const el = box.current;
    const onVisibility = () => setPageShown(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    if (!el || typeof IntersectionObserver === 'undefined') return () => document.removeEventListener('visibilitychange', onVisibility);
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (!data) return null;
  const n = data.slide.notes;
  const quizOptions = data.quiz ? optionsOf(data.quiz.slide) : [];
  const quizRight = data.quiz ? Number((data.quiz.slide.content as { correct?: unknown }).correct) : -1;
  const slideStep = scene === 0 ? 0 : scene === PRESENT ? (beat ? 1 : 0) : undefined;
  const slideShown = scene === 0 || scene === PRESENT || scene === SHARE;
  const asideShown = scene === PHONES || scene === SHARE;
  const face = (i: number) => `pf-face ${scene === i ? 'is-on' : ''}`;

  return (
    <div ref={box} className="pf" data-playing={playing}>
      <div className="pf-glow" aria-hidden />
      <div
        className="pf-canvas"
        data-scene={scene}
        data-beat={beat}
        role="img"
        aria-label={`Animation: slide ${data.number} of the sample talk and its key notes, shown in present mode, on phones, in study mode, in a handout and in a PowerPoint file.`}
      >
        <div className="pf-dots" />

        <div className={`pf-actor pf-slide ${slideShown ? '' : 'is-hidden'}`}>
          <span className="pf-tag pf-tag-slide">{scene === PRESENT ? 'The room' : `Slide ${data.number}`}</span>
          <SlideView slide={data.slide} deck={data.deck} number={data.number} count={data.count} step={slideStep} framed />
        </div>

        <div className="pf-actor pf-notes">
          {/* Key notes, as the editor keeps them */}
          <div className={`${face(0)} pf-kn`}>
            <div className="pf-kn-head">
              <span className="pf-eyebrow">Key notes</span>
              <span className="pf-min"><Clock aria-hidden /> {n.minutes} min</span>
            </div>
            <div className="pf-kn-row" style={{ '--i': 0 } as React.CSSProperties}>
              <span className="pf-label">Script</span>
              <p className="pf-kn-script">{n.script}</p>
            </div>
            <div className="pf-kn-row" style={{ '--i': 1 } as React.CSSProperties}>
              <span className="pf-label">Key points</span>
              <ul className="pf-kn-points">{n.keyPoints.slice(0, 2).map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
            {n.cues[0] && (
              <div className="pf-kn-row" style={{ '--i': 2 } as React.CSSProperties}>
                <span className="pf-label">Cues</span>
                <span className="pf-cue">{n.cues[0]}</span>
              </div>
            )}
            {n.check && (
              <div className="pf-kn-row" style={{ '--i': 3 } as React.CSSProperties}>
                <span className="pf-label">Likely question</span>
                <p className="pf-kn-q">{n.check.question}</p>
              </div>
            )}
          </div>

          {/* Presenter view on the laptop */}
          <div className={`${face(PRESENT)} pf-pv`}>
            <span className="pf-tag">Your laptop</span>
            <div className="pf-pv-top">
              <span className="pf-pv-name">Presenter view</span>
              <span className="pf-pv-clock">
                <Elapsed key={scene === PRESENT ? 'run' : 'rest'} from={data.startSeconds} running={scene === PRESENT && !reduced} /> <span>of {data.total}</span>
              </span>
            </div>
            <p className="pf-pv-script">{sentences(n.script, 3)}</p>
            {n.cues[0] && <span className="pf-cue pf-pv-cue"><span className="pf-ripple" />{n.cues[0]}</span>}
            {data.next && <p className="pf-pv-next">Next: {data.next}</p>}
          </div>

          {/* The teleprompter on the presenter's phone */}
          <div className={`${face(PHONES)} pf-phone pf-tp`}>
            <span className="pf-tag">Your phone</span>
            <span className="pf-notch" />
            <p className="pf-phone-top">Teleprompter · Slide {data.number}</p>
            <div className="pf-tp-window">
              <p className="pf-tp-text">{n.script}</p>
            </div>
          </div>

          {/* Study mode flashcard */}
          <div className={`${face(3)} pf-card`}>
            <div className="pf-card-inner">
              <div className="pf-card-side pf-card-front">
                <span className="pf-label">Likely question · Slide {data.number}</span>
                <p className="pf-card-text">{n.check?.question}</p>
                <span className="pf-card-hint">Tap to turn over</span>
              </div>
              <div className="pf-card-side pf-card-back">
                <span className="pf-label">Answer</span>
                <p className="pf-card-text">{n.check?.answer}</p>
                <span className="pf-card-actions">
                  <span className="pf-card-btn"><RotateCcw aria-hidden /> Again</span>
                  <span className="pf-card-btn pf-card-got"><Check aria-hidden /> Got it</span>
                </span>
              </div>
            </div>
          </div>

          {/* The printed handout */}
          <div className={`${face(SHARE)} pf-paper`}>
            <span className="pf-tag">Printed handout</span>
            <p className="pf-paper-title">{data.deck.title}</p>
            <div className="pf-paper-slide">
              {mounted.has(SHARE) && <SlideView slide={data.slide} deck={data.deck} number={data.number} count={data.count} />}
            </div>
            <span className="pf-label">Key points</span>
            <ul className="pf-paper-points">{n.keyPoints.slice(0, 2).map((p) => <li key={p}>{p}</li>)}</ul>
            <span className="pf-paper-lines" />
          </div>
        </div>

        <div className={`pf-actor pf-aside ${asideShown ? '' : 'is-hidden'}`}>
          {/* The quiz on someone in the room's phone */}
          {data.quiz && (
            <div className={`${face(PHONES)} pf-phone pf-quiz`}>
              <span className="pf-tag">Their phones</span>
              <span className="pf-notch" />
              <p className="pf-phone-top"><QrCode aria-hidden /> Joined by QR</p>
              <p className="pf-quiz-count">Question 1 of {data.quiz.count}</p>
              <p className="pf-quiz-q">{slideHeading(data.quiz.slide)}</p>
              <ul className="pf-quiz-options">
                {quizOptions.map((o, i) => (
                  <li key={o} className={i === quizRight ? 'is-right' : undefined}>
                    <span>{String.fromCharCode(65 + i)}</span> {o}
                    {i === quizRight && <Check className="pf-quiz-tick" aria-hidden />}
                  </li>
                ))}
              </ul>
              <p className="pf-quiz-result">Correct</p>
            </div>
          )}

          {/* The .pptx, opened in PowerPoint */}
          <div className={`${face(SHARE)} pf-pptx`}>
            <p className="pf-pptx-bar"><FileDown aria-hidden /> <span>{data.deck.title}.pptx</span></p>
            <div className="pf-pptx-stage" />
            <div className="pf-pptx-notes">
              <span className="pf-label">Speaker notes</span>
              <p>{n.script}</p>
            </div>
          </div>
        </div>
      </div>

      <p className="pf-caption">
        <span key={scene} className="pf-caption-text">{SCENES[scene].caption}</span>
      </p>

      <div className="pf-rail">
        <ol className="pf-chapters" aria-label="Scenes">
          {SCENES.map((s, i) => (
            <li key={s.label}>
              <button
                type="button"
                className="pf-chapter"
                aria-current={scene === i ? 'step' : undefined}
                onClick={() => { setAuto(false); show(i); }}
              >
                <span className="pf-chapter-bar">
                  {scene === i && <span key={run} className="pf-chapter-fill" style={{ '--ms': `${s.ms}ms` } as React.CSSProperties} />}
                </span>
                <span className="pf-chapter-num" aria-hidden>{String(i + 1).padStart(2, '0')}</span> {s.label}
              </button>
            </li>
          ))}
        </ol>
        {!reduced && (
          <button
            type="button"
            className="lp-icon-btn pf-toggle"
            onClick={() => setAuto((a) => !a)}
            aria-label={auto ? 'Pause the animation' : 'Play the animation'}
            title={auto ? 'Pause' : 'Play'}
          >
            {auto ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          </button>
        )}
      </div>
    </div>
  );
}
