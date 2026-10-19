import { ArrowRight, HardDrive, Pause, Play } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { getTheme } from '../../core/engine/themes';
import { LogoMark } from '../../ui/Logo';
import { SlideView } from '../slides/SlideView';
import { Cta } from './Cta';
import { useOnScreen } from './hooks';
import { heroSlides } from './samples';

export function Hero({ reduced }: { reduced: boolean }) {
  const slides = useMemo(heroSlides, []);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(!reduced);
  const [held, setHeld] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(stage);
  const current = slides[index] ?? slides[0];
  const running = playing && !reduced;

  const next = () => setIndex((i) => (i + 1) % slides.length);

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="lp-container">
        <div className="hero-copy" data-reveal>
          <p className="lp-kicker"><span className="lp-kicker-dot" aria-hidden /> Presentations, courses and notes in one place</p>
          <h1 id="hero-title" className="hero-title">
            Slides that know <em>what to say.</em>
          </h1>
          <p className="hero-lede">
            Lectern lays out talks, pitches, reports and lessons for you. Every slide carries key notes for your
            presenter view, teleprompter and handout. Then it plans the course around them, week by week.
          </p>
          <div className="hero-ctas">
            <Cta to="/decks" variant="brand" size="lg">Start a deck <ArrowRight size={18} aria-hidden /></Cta>
            <Cta to="/" variant="quiet" size="lg">Open Lectern</Cta>
          </div>
          <p className="hero-fine"><HardDrive size={15} aria-hidden /> No account needed. Saved in your browser.</p>
        </div>

        <div
          ref={stage}
          className={`hero-stage ${running ? 'is-playing' : ''} ${held || !onScreen ? 'is-held' : ''}`}
          data-reveal
          role="region"
          aria-roledescription="carousel"
          aria-label="Sample slides made with Lectern"
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false); }}
        >
          <div className="stage-frame">
          <div className="stage-glow" aria-hidden />
          <div className="stage-window">
            <div className="stage-bar" aria-hidden>
              <span className="stage-bar-title"><LogoMark size={18} /> <span className="stage-bar-name">{current.deck.title}</span></span>
              <span className="stage-bar-chips">
                <span className="stage-chip"><span className="stage-swatch" style={{ background: getTheme(current.deck.themeId).colors.accent }} /> {current.look} look</span>
                <span className="stage-chip stage-chip-strong"><Play size={12} /> Present</span>
              </span>
            </div>
            <div className="stage-slides" aria-live={running ? 'off' : 'polite'}>
              {slides.map((s, i) => (
                <div key={s.key} className={`stage-slide ${i === index ? 'is-active' : ''}`} aria-hidden={i !== index}>
                  <SlideView slide={s.slide} deck={s.deck} number={s.number} count={s.count} label={`${s.purpose} slide: ${s.deck.title}`} />
                </div>
              ))}
            </div>
          </div>

          <aside className="stage-notes" aria-label="Key notes for this slide">
            <div className="stage-notes-head">
              <span className="lp-eyebrow">Key notes</span>
              <span className="stage-notes-min">{current.slide.notes.minutes} min</span>
            </div>
            {current.slide.notes.cues.length > 0 && (
              <div className="stage-cues">
                {current.slide.notes.cues.slice(0, 2).map((c) => <span key={c} className="lp-cue">{c}</span>)}
              </div>
            )}
            <p className="stage-script" key={current.key}>{current.slide.notes.script}</p>
          </aside>
          </div>

          <div className="stage-picker">
            <div className="stage-tabs" role="group" aria-label="Choose a sample">
              {slides.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  className={`stage-tab ${i === index ? 'is-active' : ''}`}
                  aria-pressed={i === index}
                  onClick={() => setIndex(i)}
                >
                  <span className="stage-tab-label">{s.purpose}</span>
                  <span className="stage-tab-look">{s.look}</span>
                  {i === index && running && <span key={index} className="stage-tab-progress" onAnimationEnd={next} aria-hidden />}
                </button>
              ))}
            </div>
            {!reduced && (
              <button
                type="button"
                className="lp-icon-btn"
                onClick={() => setPlaying((p) => !p)}
                aria-label={running ? 'Pause slideshow' : 'Play slideshow'}
                title={running ? 'Pause slideshow' : 'Play slideshow'}
              >
                {running ? <Pause size={16} /> : <Play size={16} />}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
