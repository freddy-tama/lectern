import { ChevronLeft, ChevronRight, Keyboard, Maximize, NotebookText, PresentationIcon, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { NotFound } from '../../app/App';
import { toggles } from '../../core/plugins/registry';
import { useKeys } from '../../ui/hooks';
import { LiveScreen } from '../share/LiveScreen';
import { SlideView } from '../slides/SlideView';
import { HelpOverlay } from './HelpOverlay';
import { openPresenter, useShow } from './sync';
import { advance, retreat, useLiveDeck } from './useLiveDeck';

export default function Present() {
  const { deckId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const audienceOnly = params.get('audience') === '1';
  const { deck, slides, steps } = useLiveDeck(deckId);
  const { state, update } = useShow(deckId, { index: Number(params.get('from')) || 0 });
  const [chrome, setChrome] = useState(true);
  const [notes, setNotes] = useState(false);
  const [help, setHelp] = useState(false);
  const [jump, setJump] = useState('');
  const hideTimer = useRef<number | undefined>(undefined);
  const count = slides.length;
  const index = Math.min(state.index, Math.max(0, count - 1));
  const slide = slides[index];

  const poke = useCallback(() => {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setChrome(false), 2600);
  }, []);
  useEffect(() => { poke(); return () => window.clearTimeout(hideTimer.current); }, [poke]);
  useEffect(() => { if (state.startedAt === null && count) update({ startedAt: Date.now() }); }, [count, state.startedAt, update]);

  const next = () => update((s) => ({ ...advance({ index, step: s.step }, steps, count), blank: false }));
  const prev = () => update((s) => ({ ...retreat({ index, step: s.step }, steps), blank: false }));
  const go = (i: number) => update({ index: Math.max(0, Math.min(count - 1, i)), step: 0, blank: false });
  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (audienceOnly) window.close();
    else navigate(-1);
  };
  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  useKeys((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (help && k !== '?') { if (k === 'Escape') setHelp(false); return; }
    if (/^[0-9]$/.test(k)) { setJump((j) => (j + k).slice(-3)); return; }
    if (k === 'Enter' && jump) { e.preventDefault(); go(Number(jump) - 1); setJump(''); return; }
    setJump('');
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); prev(); }
    else if (k === 'Home') go(0);
    else if (k === 'End') go(count - 1);
    else if (k === 'b' || k === 'B' || k === '.') update((s) => ({ blank: !s.blank }));
    else if (k === 'f' || k === 'F') fullscreen();
    else if (k === 'n' || k === 'N') setNotes((x) => !x);
    else if (k === '?') setHelp((x) => !x);
    else if (k === 'Escape') { if (notes) setNotes(false); else if (!document.fullscreenElement) exit(); }
    else {
      const t = toggles().find((x) => x.key.toLowerCase() === k.toLowerCase());
      if (t) update((s) => ({ flags: { ...s.flags, [t.flag]: !(s.flags[t.flag] ?? t.defaultOn ?? false) } }));
    }
  }, [index, count, steps, help, jump, notes]);

  if (deck === undefined) return <div className="present" />;
  if (deck === null || !slide) return <NotFound message="This deck was deleted or has no slides to show." />;

  return (
    <div className={`present ${chrome ? 'show-chrome' : ''}`} onMouseMove={poke} onClick={(e) => { if ((e.target as HTMLElement).closest('button, a, .present-notes')) return; next(); }}>
      <div className="present-stage">
        <div className="present-slide" key={slide.id}>
          <SlideView slide={slide} deck={deck} number={index + 1} count={count} step={state.step} flags={state.flags} label={`Slide ${index + 1} of ${count}`} />
        </div>
        {state.blank && <div className="present-blank" aria-label="Screen blanked" />}
        <LiveScreen deckId={deckId} />
      </div>

      <div className="present-progress" aria-hidden><span style={{ width: `${((index + 1) / count) * 100}%` }} /></div>

      {!audienceOnly && notes && (
        <aside className="present-notes" aria-label="Key notes">
          <div className="present-notes-head">
            <strong>Key notes · slide {index + 1}</strong>
            <button type="button" className="icon-btn" onClick={() => setNotes(false)} aria-label="Close notes"><X size={16} /></button>
          </div>
          {slide.notes.script ? <p className="present-script">{slide.notes.script}</p> : <p className="faint">No script for this slide.</p>}
          {slide.notes.keyPoints.length > 0 && <ul>{slide.notes.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          {slide.notes.check && <p><strong>Ask:</strong> {slide.notes.check.question} <span className="faint">— {slide.notes.check.answer}</span></p>}
        </aside>
      )}

      {!audienceOnly && (
        <div className="present-bar" role="toolbar" aria-label="Presentation controls">
          <button type="button" className="pbtn" onClick={exit} aria-label="Exit presentation" title="Exit (Esc)"><X size={18} /></button>
          <span className="pbar-sep" />
          <button type="button" className="pbtn" onClick={prev} aria-label="Previous" title="Previous (←)"><ChevronLeft size={20} /></button>
          <span className="pcount tabular">{jump ? `Go to ${jump}…` : `${index + 1} / ${count}`}</span>
          <button type="button" className="pbtn" onClick={next} aria-label="Next" title="Next (→ or Space)"><ChevronRight size={20} /></button>
          <span className="pbar-sep" />
          <button type="button" className="pbtn" aria-pressed={notes} onClick={() => setNotes((x) => !x)} aria-label="Key notes" title="Key notes (N)"><NotebookText size={18} /></button>
          <button type="button" className="pbtn" onClick={() => openPresenter(deck.id, navigate)} aria-label="Presenter view" title="Open presenter view"><PresentationIcon size={18} /></button>
          <button type="button" className="pbtn" onClick={fullscreen} aria-label="Full screen" title="Full screen (F)"><Maximize size={18} /></button>
          <button type="button" className="pbtn" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts" title="Shortcuts (?)"><Keyboard size={18} /></button>
        </div>
      )}

      {help && <HelpOverlay onClose={() => setHelp(false)} />}
    </div>
  );
}
