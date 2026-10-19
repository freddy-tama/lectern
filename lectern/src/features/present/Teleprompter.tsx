import { ArrowLeft, FlipHorizontal2, Link2, Link2Off, Minus, Pause, Play, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { NotFound } from '../../app/App';
import { countWords } from '../../core/deck/words';
import { getKind } from '../../core/kinds/registry';
import { useKeys } from '../../ui/hooks';
import { HelpOverlay } from './HelpOverlay';
import { useShow } from './sync';
import { useLiveDeck } from './useLiveDeck';

interface Prefs {
  wpm: number;
  size: number;
  mirror: boolean;
  link: boolean;
}

function loadPrefs(): Prefs {
  try {
    return { wpm: 140, size: 48, mirror: false, link: true, ...JSON.parse(localStorage.getItem('lectern.prompter') ?? '{}') };
  } catch {
    return { wpm: 140, size: 48, mirror: false, link: true };
  }
}

/** Reading line, as a share of the viewport height. */
const LINE = 0.36;

export default function Teleprompter() {
  const { deckId = '' } = useParams();
  const navigate = useNavigate();
  const { deck, slides } = useLiveDeck(deckId);
  const { state, update } = useShow(deckId);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [playing, setPlaying] = useState(false);
  const [section, setSection] = useState(0);
  const [hud, setHud] = useState(true);
  const [help, setHelp] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const markers = useRef<(HTMLElement | null)[]>([]);
  const carry = useRef(0);
  const lastSent = useRef(-1);
  const hudTimer = useRef<number | undefined>(undefined);

  useEffect(() => { try { localStorage.setItem('lectern.prompter', JSON.stringify(prefs)); } catch { /* ignore */ } }, [prefs]);

  const words = useMemo(() => slides.reduce((n, s) => n + countWords(s.notes.script || s.notes.keyPoints.join(' ')), 0), [slides]);

  // Auto-scroll at the chosen words per minute.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const el = scroller.current;
      if (el && words > 0) {
        const textHeight = el.scrollHeight - el.clientHeight;
        const pxPerWord = textHeight / words;
        carry.current += ((t - last) / 1000) * (prefs.wpm / 60) * pxPerWord;
        const whole = Math.floor(carry.current);
        if (whole >= 1) { el.scrollTop += whole; carry.current -= whole; }
        if (el.scrollTop >= textHeight - 1) setPlaying(false);
      }
      last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, prefs.wpm, words]);

  // Which slide's script sits on the reading line.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const line = el.scrollTop + el.clientHeight * LINE;
    let current = 0;
    markers.current.forEach((m, i) => { if (m && m.offsetTop <= line + 4) current = i; });
    if (current !== section) setSection(current);
  };

  // Linked: reaching a new slide's script moves the audience screen.
  useEffect(() => {
    if (!prefs.link || !playing || section === lastSent.current) return;
    lastSent.current = section;
    if (state.index !== section) update({ index: section, step: 0 });
  }, [section, prefs.link, playing, state.index, update]);

  // Linked: when someone else changes slide, jump the script there (unless scrolling).
  useEffect(() => {
    if (!prefs.link || playing || state.index === section) return;
    scrollTo(state.index);
    lastSent.current = state.index;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.index]);

  const scrollTo = (i: number) => {
    const el = scroller.current;
    const m = markers.current[Math.max(0, Math.min(slides.length - 1, i))];
    if (el && m) el.scrollTo({ top: m.offsetTop - el.clientHeight * LINE + 8, behavior: 'smooth' });
  };

  const poke = () => {
    setHud(true);
    window.clearTimeout(hudTimer.current);
    hudTimer.current = window.setTimeout(() => setHud(false), 2800);
  };
  useEffect(() => { poke(); return () => window.clearTimeout(hudTimer.current); }, []);
  useEffect(() => { if (!playing) setHud(true); }, [playing]);

  const set = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));

  useKeys((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (help) { if (k === 'Escape' || k === '?') setHelp(false); return; }
    poke();
    if (k === ' ' || k === 'Enter') { e.preventDefault(); setPlaying((p) => !p); }
    else if (k === 'ArrowUp') { e.preventDefault(); set({ wpm: Math.min(260, prefs.wpm + 10) }); }
    else if (k === 'ArrowDown') { e.preventDefault(); set({ wpm: Math.max(60, prefs.wpm - 10) }); }
    else if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); scrollTo(section + 1); if (prefs.link) update({ index: Math.min(slides.length - 1, section + 1), step: 0 }); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); scrollTo(section - 1); if (prefs.link) update({ index: Math.max(0, section - 1), step: 0 }); }
    else if (k === '+' || k === '=') set({ size: Math.min(96, prefs.size + 4) });
    else if (k === '-') set({ size: Math.max(24, prefs.size - 4) });
    else if (k === 'm' || k === 'M') set({ mirror: !prefs.mirror });
    else if (k === 'l' || k === 'L') set({ link: !prefs.link });
    else if (k === 'r' || k === 'R') { setPlaying(false); scroller.current?.scrollTo({ top: 0 }); }
    else if (k === '?') setHelp(true);
    else if (k === 'Escape') navigate(-1);
  }, [prefs, section, slides.length, help, playing]);

  if (deck === undefined) return <div className="prompter" />;
  if (deck === null) return <NotFound message="This deck was deleted." />;

  const minutesLeft = (() => {
    const el = scroller.current;
    if (!el || !words) return null;
    const share = 1 - el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
    return Math.max(0, Math.round((words * share) / prefs.wpm));
  })();

  return (
    <div className={`prompter ${hud ? 'show-hud' : ''}`} onMouseMove={poke}>
      <div className="prompter-line" style={{ top: `${LINE * 100}%` }} aria-hidden />
      <div className="prompter-scroll" ref={scroller} onScroll={onScroll} onClick={() => setPlaying((p) => !p)}>
        <div className="prompter-text" style={{ fontSize: prefs.size, transform: prefs.mirror ? 'scaleX(-1)' : undefined }}>
          <div style={{ height: `${LINE * 100}vh` }} />
          {slides.map((s, i) => {
            const def = getKind(s.kind);
            const paras = s.notes.script.trim() ? s.notes.script.split(/\n\s*\n/) : [];
            return (
              <section key={s.id} ref={(el) => { markers.current[i] = el; }} className={`prompter-section ${i === section ? 'is-current' : ''}`}>
                <div className="prompter-marker"><span>{i + 1}</span>{def ? def.heading(s.content) : s.kind}</div>
                {paras.length ? paras.map((p, k) => <p key={k}>{p}</p>) : (
                  <p className="prompter-fallback">{s.notes.keyPoints.length ? s.notes.keyPoints.join(' · ') : 'No script for this slide.'}</p>
                )}
                {s.notes.cues.length > 0 && <p className="prompter-cues">{s.notes.cues.join(' · ')}</p>}
              </section>
            );
          })}
          <div className="prompter-end">End</div>
          <div style={{ height: '70vh' }} />
        </div>
      </div>

      <div className="prompter-hud" role="toolbar" aria-label="Teleprompter controls">
        <button type="button" className="pbtn" onClick={() => navigate(-1)} aria-label="Leave teleprompter"><ArrowLeft size={18} /></button>
        <span className="pbar-sep" />
        <button type="button" className="pbtn play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
        <button type="button" className="pbtn" onClick={() => { setPlaying(false); scroller.current?.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-label="Back to the start"><RotateCcw size={17} /></button>
        <span className="pbar-sep" />
        <span className="hud-group" aria-label="Speed">
          <button type="button" className="pbtn" onClick={() => set({ wpm: Math.max(60, prefs.wpm - 10) })} aria-label="Slower"><Minus size={16} /></button>
          <span className="tabular hud-value">{prefs.wpm} wpm</span>
          <button type="button" className="pbtn" onClick={() => set({ wpm: Math.min(260, prefs.wpm + 10) })} aria-label="Faster"><Plus size={16} /></button>
        </span>
        <span className="hud-group" aria-label="Text size">
          <button type="button" className="pbtn" onClick={() => set({ size: Math.max(24, prefs.size - 4) })} aria-label="Smaller text">A−</button>
          <button type="button" className="pbtn" onClick={() => set({ size: Math.min(96, prefs.size + 4) })} aria-label="Larger text">A+</button>
        </span>
        <button type="button" className="pbtn" aria-pressed={prefs.mirror} onClick={() => set({ mirror: !prefs.mirror })} aria-label="Mirror text" title="Mirror for a glass teleprompter (M)"><FlipHorizontal2 size={18} /></button>
        <button type="button" className="pbtn" aria-pressed={prefs.link} onClick={() => set({ link: !prefs.link })} aria-label={prefs.link ? 'Linked to the slides' : 'Not linked to the slides'} title="Move the slides as you read (L)">{prefs.link ? <Link2 size={18} /> : <Link2Off size={18} />}</button>
        <span className="pbar-sep" />
        <span className="tabular hud-value faint">Slide {section + 1}/{slides.length}{minutesLeft !== null ? ` · ~${minutesLeft} min left` : ''}</span>
      </div>
      {help && (
        <HelpOverlay
          onClose={() => setHelp(false)}
          base={false}
          extra={[[['Space'], 'Play or pause'], [['↑', '↓'], 'Faster or slower'], [['→', '←'], 'Next or previous slide'], [['+', '−'], 'Text size'], [['M'], 'Mirror'], [['L'], 'Link to the slides'], [['R'], 'Back to the start'], [['Esc'], 'Leave']]}
        />
      )}
    </div>
  );
}
