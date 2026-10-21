import { ChevronLeft, ChevronRight, HardDrive, MonitorSpeaker, Play, Presentation } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { tryHref } from '../../app/try-samples';
import { getKind } from '../../core/kinds/registry';
import { useFontsReady } from '../../ui/hooks';
import { LogoMark } from '../../ui/Logo';
import { advance, retreat } from '../present/useLiveDeck';
import { SlideView } from '../slides/SlideView';
import { Cta } from './Cta';
import { useMedia } from './hooks';
import { TALK_ID, deckRun, sampleDeck, slideHeading } from './samples';

/** The slide the stage opens on: a chart with a click to reveal its takeaway. */
const FIRST_SLIDE = 's_mt_04';

type View = 'presenter' | 'audience';

export function Hero({ onNotes }: { onNotes(): void }) {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="lp-container hero-grid">
        <div className="hero-copy">
          <p className="lp-kicker"><span className="lp-kicker-dot" aria-hidden /> For talks, pitches, reports and lessons</p>
          <h1 id="hero-title" className="hero-title">
            Slides that know <em>what to say.</em>
          </h1>
          <p className="hero-lede">
            Every slide carries its own script, cues, timing and a likely question. Present from your laptop, read the
            script on your phone, and quiz the room, all from the same deck.
          </p>
          <div className="hero-ctas">
            <Cta to={tryHref('talk', 'present')} variant="brand" size="lg" testId="hero-present">
              <Play size={18} aria-hidden /> <span>Present the sample<span className="hero-cta-long">{' talk'}</span></span>
            </Cta>
            <button type="button" className="lp-btn lp-btn-quiet lp-btn-lg" onClick={onNotes}>Turn your notes into slides</button>
          </div>
          <p className="hero-fine"><HardDrive size={15} aria-hidden /> No account. Your decks stay in this browser. Works offline once loaded.</p>
        </div>
        <HeroStage />
      </div>
    </section>
  );
}

/** The sample talk in a presenter's window: a real slide, its script, and the controls present mode uses. */
export function HeroStage() {
  const deck = useMemo(() => sampleDeck(TALK_ID), []);
  const fonts = useFontsReady();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useMemo(() => (deck ? deckRun(deck) : { slides: [], steps: [] }), [deck, fonts]);
  const start = Math.max(0, run.slides.findIndex((s) => s.id === FIRST_SLIDE));
  const [pos, setPos] = useState({ index: start, step: 0 });
  const [view, setView] = useState<View>('presenter');
  const [answer, setAnswer] = useState(false);
  const [more, setMore] = useState(false);
  const [moved, setMoved] = useState(false);
  const narrow = useMedia('(max-width: 639px)');
  const ids = useId();

  if (!deck || !run.slides.length) return null;
  const count = run.slides.length;
  const index = Math.min(pos.index, count - 1);
  const slide = run.slides[index];
  const steps = run.steps[index] ?? 0;
  const n = slide.notes;
  const next = run.slides[index + 1];

  const go = (to: { index: number; step: number }) => {
    if (to.index !== index) { setAnswer(false); setMore(false); }
    setMoved(true);
    setPos(to);
  };
  const forward = () => go(advance({ index, step: pos.step }, run.steps, count));
  const back = () => go(retreat({ index, step: pos.step }, run.steps));
  const atStart = index === 0 && pos.step === 0;
  const atEnd = index === count - 1 && pos.step >= steps;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('a, input, textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); forward(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
  };

  const showView = (v: View) => { setMoved(true); setView(v); };
  const extraId = `${ids}-extra`;
  const answerId = `${ids}-answer`;

  return (
    <div
      id="sample"
      className="hero-stage"
      role="region"
      aria-label={`Sample talk: ${deck.title}`}
      tabIndex={0}
      aria-keyshortcuts="ArrowLeft ArrowRight"
      onKeyDown={onKey}
    >
      <div className="stage-glow" aria-hidden />
      <div className="stage-window">
        <div className="stage-bar">
          <span className="stage-bar-title"><LogoMark size={18} /> <span className="stage-bar-name">{deck.title}</span></span>
          <span className="stage-chip"><span>Sample talk<span className="stage-chip-more"> · made-up figures</span></span></span>
          <div className="stage-seg" role="group" aria-label="Who sees what">
            <button type="button" className="stage-seg-btn" aria-pressed={view === 'presenter'} onClick={() => showView('presenter')}>
              <MonitorSpeaker size={15} aria-hidden /><span className="stage-seg-text">Presenter view</span>
            </button>
            <button type="button" className="stage-seg-btn" aria-pressed={view === 'audience'} onClick={() => showView('audience')}>
              <Presentation size={15} aria-hidden /><span className="stage-seg-text">Audience view</span>
            </button>
          </div>
        </div>

        <div className="stage-slide">
          <div key={index} className={moved ? 'stage-fade' : undefined}>
            <SlideView
              slide={slide}
              deck={deck}
              number={index + 1}
              count={count}
              step={pos.step}
              framed
              label={`Slide ${index + 1}: ${slideHeading(slide)}`}
            />
          </div>
        </div>

        <div className="stage-notes">
          <div key={`${view}-${index}`} className={`stage-notes-inner ${moved ? 'stage-fade' : ''}`}>
            {view === 'audience' ? (
              <p className="stage-audience">This is what the room sees. Your script stays on your screen or your phone.</p>
            ) : (
              <div className="stage-notes-grid">
                <div className="stage-script-col">
                  <p className="stage-label">Script · {n.minutes} min</p>
                  <p className="stage-script">{n.script}</p>
                  {narrow && (
                    <button type="button" className="stage-more" aria-expanded={more} aria-controls={extraId} onClick={() => setMore((m) => !m)}>
                      {more ? 'Hide key notes' : 'Show key notes'}
                    </button>
                  )}
                </div>
                <div id={extraId} className="stage-extra" hidden={narrow && !more}>
                  {n.cues.length > 0 && (
                    <div className="stage-cue-row">
                      <p className="stage-label">Cues</p>
                      <div className="stage-cues">{n.cues.slice(0, 2).map((c) => <span key={c} className="lp-cue" title={c}>{c}</span>)}</div>
                    </div>
                  )}
                  {n.check ? (
                    <div className={`stage-check ${answer ? 'is-answered' : ''}`}>
                      <div className="stage-check-head">
                        <p className="stage-label">Likely question</p>
                        <button type="button" className="stage-answer-btn" aria-expanded={answer} aria-controls={answerId} onClick={() => setAnswer((a) => !a)}>
                          {answer ? 'Hide answer' : 'Show answer'}
                        </button>
                      </div>
                      <p className="stage-q">{n.check.question}</p>
                      <p id={answerId} className="stage-answer" hidden={!answer}>{n.check.answer}</p>
                    </div>
                  ) : next ? (
                    <p className="stage-next"><span className="stage-label">Next:</span> {getKind(next.kind)?.label ?? next.kind} · {slideHeading(next)}</p>
                  ) : (
                    <p className="stage-next"><span className="stage-label">Last slide</span></p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="stage-controls">
          <button type="button" className="lp-icon-btn" onClick={back} aria-disabled={atStart} aria-label="Previous slide" title="Previous slide">
            <ChevronLeft size={18} aria-hidden />
          </button>
          <button type="button" className="lp-icon-btn" onClick={forward} aria-disabled={atEnd} aria-label="Next slide" title="Next slide">
            <ChevronRight size={18} aria-hidden />
          </button>
          <p className="stage-pos" role="status" aria-live="polite">
            Slide {index + 1} of {count}{steps > 0 ? ` · click ${pos.step} of ${steps}` : ''}
          </p>
          <Cta to={tryHref('talk', 'present', index)} variant="brand" className="lp-btn-sm stage-present">
            <Play size={14} aria-hidden /> Present
          </Cta>
        </div>
      </div>
    </div>
  );
}
