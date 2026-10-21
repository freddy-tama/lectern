import { AArrowDown, AArrowUp, ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Pause, Play, QrCode as QrIcon, RotateCcw, ScrollText } from 'lucide-react';
import { openShare } from '../share/host';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { NotFound } from '../../app/App';
import { wording } from '../../core/deck/purpose';
import { deckPurpose } from '../../core/deck/types';
import { toggles } from '../../core/plugins/registry';
import { formatClock, useKeys, useNow } from '../../ui/hooks';
import { LOCALE } from '../../ui/format';
import { PresenterJot } from '../notes/PresenterJot';
import { useLiveSlide } from '../share/LiveScreen';
import { SlideView } from '../slides/SlideView';
import { HelpOverlay } from './HelpOverlay';
import { useShow } from './sync';
import { advance, retreat, useLiveDeck } from './useLiveDeck';

export default function PresenterView() {
  const { deckId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { deck, slides, steps } = useLiveDeck(deckId);
  const { state, update, peers } = useShow(deckId);
  const now = useNow(500);
  const [paused, setPaused] = useState<number | null>(null);
  const [size, setSize] = useState(() => { try { return Number(localStorage.getItem('lectern.notesSize')) || 22; } catch { return 22; } });
  const [help, setHelp] = useState(false);
  const [jot, setJot] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const count = slides.length;
  const index = Math.min(state.index, Math.max(0, count - 1));
  const slide = slides[index];
  const shown = useLiveSlide(deckId, slide);
  const nextSlide = slides[index + 1];

  useEffect(() => { try { localStorage.setItem('lectern.notesSize', String(size)); } catch { /* ignore */ } }, [size]);
  useEffect(() => { if (state.startedAt === null && count) update({ startedAt: Date.now() }); }, [count, state.startedAt, update]);
  useEffect(() => { stripRef.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [index]);

  const elapsed = state.startedAt ? (paused ?? now) - state.startedAt : 0;
  const plannedBefore = slides.slice(0, index).reduce((m, s) => m + s.notes.minutes, 0) * 60_000;
  const plannedTotal = slides.reduce((m, s) => m + s.notes.minutes, 0) * 60_000;
  const drift = elapsed - plannedBefore;
  const pace = Math.abs(drift) < 60_000 ? { label: 'On time', tone: 'good' } : drift > 0 ? { label: `${Math.round(drift / 60_000)} min behind`, tone: 'warn' } : { label: `${Math.round(-drift / 60_000)} min ahead`, tone: 'good' };

  const next = () => update((s) => ({ ...advance({ index, step: s.step }, steps, count), blank: false }));
  const prev = () => update((s) => ({ ...retreat({ index, step: s.step }, steps), blank: false }));
  const go = (i: number) => update({ index: i, step: 0, blank: false });
  const togglePause = () => {
    if (paused === null) setPaused(Date.now());
    else { update((s) => ({ startedAt: (s.startedAt ?? Date.now()) + (Date.now() - paused) })); setPaused(null); }
  };

  useKeys((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (help) { if (k === 'Escape' || k === '?') setHelp(false); return; }
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); prev(); }
    else if (k === 'Home') go(0);
    else if (k === 'End') go(count - 1);
    else if (k === 'b' || k === 'B' || k === '.') update((s) => ({ blank: !s.blank }));
    else if (k === '+' || k === '=') setSize((x) => Math.min(44, x + 2));
    else if (k === '-') setSize((x) => Math.max(14, x - 2));
    else if (k === 'p' && !toggles().some((t) => t.key === 'p')) togglePause();
    // preventDefault keeps the "j" out of the note box that opens.
    else if ((k === 'j' || k === 'J') && !toggles().some((t) => t.key.toLowerCase() === 'j')) {
      e.preventDefault();
      setJot(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.pjot .ln-input')?.focus());
    }
    else if (k === '?') setHelp(true);
    else {
      const t = toggles().find((x) => x.key.toLowerCase() === k.toLowerCase());
      if (t) update((s) => ({ flags: { ...s.flags, [t.flag]: !(s.flags[t.flag] ?? t.defaultOn ?? false) } }));
    }
  }, [index, count, steps, help, paused]);

  if (deck === undefined) return <div className="presenter" />;
  if (deck === null || !slide) return <NotFound message="This deck was deleted or has no slides to show." />;
  const n = slide.notes;
  const w = wording(deckPurpose(deck));

  return (
    <div className="presenter">
      <header className="presenter-top">
        <Link to={`/studio/${deck.id}`} className="pbtn" aria-label="Back to the editor" title="Back to the editor"><ArrowLeft size={18} /></Link>
        <strong className="presenter-title">{deck.title}</strong>
        <div className="presenter-clock">
          <span className="timer tabular" aria-label="Elapsed time">{formatClock(elapsed)}</span>
          <span className="faint tabular">of {formatClock(plannedTotal)}</span>
          <span className={`pace ${pace.tone}`}>{pace.label}</span>
          <button type="button" className="pbtn" onClick={togglePause} aria-label={paused === null ? 'Pause timer' : 'Resume timer'} title={paused === null ? 'Pause timer' : 'Resume timer'}>{paused === null ? <Pause size={16} /> : <Play size={16} />}</button>
          <button type="button" className="pbtn" onClick={() => { setPaused(null); update({ startedAt: Date.now() }); }} aria-label="Restart timer" title="Restart timer"><RotateCcw size={16} /></button>
          <span className="faint tabular">{new Date(now).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' })}</span>
        </div>
        <div className="presenter-actions">
          {peers === 0 && (
            <button type="button" className="btn btn-sm presenter-cta" onClick={() => window.open(`/present/${deck.id}?audience=1`, `lectern-audience-${deck.id}`, 'popup=yes,width=1280,height=720')}>
              <ExternalLink size={15} /> {params.get('blocked') ? 'Open audience window (pop-up was blocked)' : 'Open audience window'}
            </button>
          )}
          <button type="button" className="pbtn" onClick={() => openShare(deck.id)} aria-label="Share to phones" title="Share to phones"><QrIcon size={18} /></button>
          <button type="button" className="pbtn" onClick={() => navigate(`/prompter/${deck.id}`)} aria-label="Teleprompter" title="Teleprompter"><ScrollText size={18} /></button>
        </div>
      </header>

      <main className="presenter-main">
        <section className="presenter-current" aria-label="Current slide">
          <SlideView slide={shown ?? slide} deck={deck} number={index + 1} count={count} step={state.step} ghostLater flags={state.flags} framed />
          <div className="presenter-under">
            <button type="button" className="pbtn" onClick={prev} aria-label="Previous"><ChevronLeft size={20} /></button>
            <span className="tabular">Slide {index + 1} of {count}</span>
            {steps[index] > 0 && <span className="chip step-chip">{state.step < steps[index] ? `${steps[index] - state.step} more ${steps[index] - state.step === 1 ? 'click' : 'clicks'} on this slide` : 'All shown'}</span>}
            {state.blank && <span className="chip chip-warn">Screen blanked · B</span>}
            <button type="button" className="pbtn" onClick={next} aria-label="Next"><ChevronRight size={20} /></button>
          </div>
        </section>

        <section className="presenter-side has-jot">
          <div className="presenter-next" aria-label="Next slide">
            <span className="eyebrow">Next</span>
            {nextSlide ? <SlideView slide={nextSlide} deck={deck} number={index + 2} count={count} framed /> : <div className="presenter-end">End of deck</div>}
          </div>
          <div className="presenter-notes" style={{ fontSize: size }}>
            <div className="presenter-notes-head">
              <span className="eyebrow">Key notes</span>
              <span className="faint" style={{ fontSize: 13 }}>{n.minutes} min planned</span>
              <span style={{ marginLeft: 'auto', display: 'flex' }}>
                <button type="button" className="pbtn" onClick={() => setSize((x) => Math.max(14, x - 2))} aria-label="Smaller notes"><AArrowDown size={16} /></button>
                <button type="button" className="pbtn" onClick={() => setSize((x) => Math.min(44, x + 2))} aria-label="Larger notes"><AArrowUp size={16} /></button>
              </span>
            </div>
            {n.cues.length > 0 && <div className="cue-row">{n.cues.map((c) => <span key={c} className="cue">{c}</span>)}</div>}
            {n.script ? n.script.split(/\n\s*\n/).map((p, i) => <p key={i} className="script-para">{p}</p>) : <p className="faint">No script for this slide. Add one in the editor’s key notes.</p>}
            {n.keyPoints.length > 0 && (
              <div className="notes-block">
                <span className="eyebrow">{w.rememberEyebrow}</span>
                <ul>{n.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </div>
            )}
            {n.check && (
              <div className="notes-block check-block">
                <span className="eyebrow">{w.askEyebrow}</span>
                <p>{n.check.question}</p>
                {n.check.answer && <p className="faint">Answer: {n.check.answer}</p>}
              </div>
            )}
            {n.extra && Object.entries(n.extra).map(([mod, fields]) => Object.entries(fields).filter(([, v]) => v).map(([k, v]) => (
              <div key={`${mod}.${k}`} className="notes-block"><span className="eyebrow">{k}</span><p>{v}</p></div>
            )))}
          </div>
          <PresenterJot deck={deck} slideId={slide.id} slideNumber={index + 1} open={jot} onOpenChange={setJot} />
        </section>
      </main>

      <nav className="presenter-strip" ref={stripRef} aria-label="All slides">
        {slides.map((s, i) => (
          <button key={s.id} type="button" data-i={i} className={i === index ? 'is-current' : ''} onClick={() => go(i)} aria-label={`Go to slide ${i + 1}`}>
            <SlideView slide={s} deck={deck} number={i + 1} count={count} framed />
            <span className="tabular">{i + 1}</span>
          </button>
        ))}
      </nav>
      {help && <HelpOverlay onClose={() => setHelp(false)} extra={[[['+', '−'], 'Note size'], [['P'], 'Pause the timer'], [['J'], 'Jot a note on this slide']]} />}
    </div>
  );
}
