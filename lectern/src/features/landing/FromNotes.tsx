import { MonitorPlay, PenLine, RotateCcw, X } from 'lucide-react';
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AUTO_LOOK, notesToDeck, slideAtCaret } from '../../core/deck/notes-to-deck';
import { SAMPLE_TALK } from '../../core/deck/outline-examples';
import { type DeckPurpose, PURPOSES, uid } from '../../core/deck/types';
import { getTheme } from '../../core/engine/themes';
import { getKind } from '../../core/kinds/registry';
import { db } from '../../data/db';
import { saveDeck } from '../../data/repo';
import { SlideView } from '../slides/SlideView';
import { markWelcomed } from './hooks';

const STORE_KEY = 'lectern.fromNotes';
/** Thumbnails drawn in the filmstrip; the rest are counted. */
const FILMSTRIP_MAX = 24;
const MAX_CHARS = 12000;
/** The look used when Auto style is off: the New deck dialog's default. */
const PLAIN_LOOK = 'paper';

/** The purposes in the order the page offers them: decks first, lessons last. */
const MADE_FOR: DeckPurpose[] = ['talk', 'pitch', 'report', 'lesson'];

const LEGEND: { code: string; meaning: string }[] = [
  { code: '# title', meaning: 'the title slide' },
  { code: '## new slide', meaning: 'a new slide' },
  { code: '1. Step: detail', meaning: 'steps' },
  { code: 'Term: meaning', meaning: 'key terms, under ## Key terms' },
  { code: '| table |', meaning: 'a table' },
  { code: 'Q: …', meaning: 'a question, with * on the right answer' },
  { code: 'Notes: …', meaning: 'goes to your script' },
];

interface Saved {
  text: string;
  purpose: DeckPurpose;
  auto: boolean;
  /** The deck saved from these notes and a fingerprint of what was saved, so a second save updates it
      rather than adding a copy. */
  deckId?: string;
  savedSig?: string;
}

/** What the visitor typed last time in this tab, so coming back from Present keeps it. */
function restore(): Saved {
  const fallback: Saved = { text: SAMPLE_TALK, purpose: 'talk', auto: true };
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<Saved>;
    return {
      text: typeof v.text === 'string' ? v.text.slice(0, MAX_CHARS) : fallback.text,
      purpose: PURPOSES.some((p) => p.id === v.purpose) ? v.purpose as DeckPurpose : fallback.purpose,
      auto: typeof v.auto === 'boolean' ? v.auto : fallback.auto,
      deckId: typeof v.deckId === 'string' ? v.deckId : undefined,
      savedSig: typeof v.savedSig === 'string' ? v.savedSig : undefined,
    };
  } catch { return fallback; }
}

/** A short hash of a saved deck's content. The editor re-saves on leaving, so its timestamp can't tell an
    untouched deck from an edited one. */
function deckSig(d: { title: string; themeId: string; slides: unknown }) {
  const s = JSON.stringify([d.title, d.themeId, d.slides]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  return `${s.length}.${(h >>> 0).toString(36)}`;
}

/** A cheap fingerprint of what a thumbnail shows, to ring the one that just changed. */
function signature(s: { kind: string; variant?: string; content: unknown }) {
  return `${s.kind}|${s.variant ?? ''}|${JSON.stringify(s.content)}`;
}

export function FromNotes() {
  const initial = useMemo(restore, []);
  const [text, setText] = useState(initial.text);
  const [purpose, setPurpose] = useState<DeckPurpose>(initial.purpose);
  const [auto, setAuto] = useState(initial.auto);
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState<'deck' | 'present' | null>(null);
  const [error, setError] = useState(false);
  const idRef = useRef(initial.deckId ?? uid('d'));
  const savedSig = useRef(initial.savedSig);
  const ids = useId();
  const navigate = useNavigate();

  const notes = useDeferredValue(text);
  const deck = useMemo(
    () => notesToDeck(notes, { audience: 'adult', purpose, look: auto ? AUTO_LOOK : PLAIN_LOOK, id: idRef.current, maxSlides: Infinity }),
    [notes, purpose, auto],
  );
  const empty = !notes.trim();
  const count = deck.slides.length;
  const index = Math.min(selected, Math.max(0, count - 1));
  const slide = deck.slides[index];
  const minutes = Math.round(deck.slides.reduce((sum, s) => sum + (s.notes.minutes || 0), 0));
  const theme = getTheme(deck.themeId);
  const purposeLabel = PURPOSES.find((p) => p.id === purpose)?.label.toLowerCase() ?? purpose;

  // Rings the thumbnail whose content changed since the last parse; the first parse rings nothing.
  const previous = useRef<string[] | null>(null);
  const [changed, setChanged] = useState<{ index: number; n: number } | null>(null);
  useEffect(() => {
    const now = deck.slides.map(signature);
    const before = previous.current;
    previous.current = now;
    if (!before) return;
    const at = now.findIndex((s, i) => s !== before[i]);
    if (at >= 0 && at < FILMSTRIP_MAX) setChanged((c) => ({ index: at, n: (c?.n ?? 0) + 1 }));
  }, [deck]);

  const remember = () => {
    const saved: Saved = { text, purpose, auto, deckId: idRef.current, savedSig: savedSig.current };
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch { /* private mode */ }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(remember, [text, purpose, auto]);

  const follow = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    setSelected(slideAtCaret(el.value, el.selectionStart ?? 0));
  };

  const open = async (to: 'deck' | 'present') => {
    setSaving(to);
    setError(false);
    try {
      // A put under the same id, so saving again, even after coming back, updates this one deck. Once the deck
      // has been edited elsewhere it is the visitor's own, so these notes start a new one instead.
      const there = await db.decks.get(idRef.current);
      if (there && deckSig(there) !== savedSig.current) idRef.current = uid('d');
      const next = { ...deck, id: idRef.current };
      await saveDeck(next);
      savedSig.current = deckSig(next);
      remember();
      markWelcomed();
      navigate(to === 'deck' ? `/studio/${idRef.current}` : `/present/${idRef.current}`);
    } catch {
      setError(true);
      setSaving(null);
    }
  };

  const textareaId = 'notes-input';
  const statusText = empty ? 'No slides yet' : `${count} ${count === 1 ? 'slide' : 'slides'} · about ${minutes} min`;

  return (
    <section id="from-notes" className="lp-section nf" aria-labelledby="nf-title" tabIndex={-1}>
      <div className="lp-container">
        <div className="lp-head">
          <p className="lp-eyebrow">From notes</p>
          <h2 id="nf-title" className="lp-h2">Rough notes in. <em>Real slides out.</em></h2>
          <p className="lp-sub">
            Type below. Headings become slides, and Lectern picks each slide's type from what you wrote. This runs in
            your browser, with no AI.
          </p>
          <ul className="nf-legend" aria-label="What your notes can use">
            {LEGEND.map((l) => <li key={l.code}><code>{l.code}</code><span>{l.meaning}</span></li>)}
          </ul>
        </div>

        <div className="nf-layout">
          <div className="nf-input">
            <div className="nf-label-row">
              <label htmlFor={textareaId} className="nf-label">Your notes</label>
              {text === SAMPLE_TALK && <span className="lp-tag">Sample notes</span>}
            </div>
            <textarea
              id={textareaId}
              className="nf-textarea"
              value={text}
              maxLength={MAX_CHARS}
              spellCheck={false}
              onChange={(e) => setText(e.target.value)}
              onSelect={follow}
              onKeyUp={follow}
              aria-describedby={empty ? `${ids}-empty` : undefined}
            />
            {empty && <p id={`${ids}-empty`} className="nf-empty">Start with a heading like <code>## Why now</code>, then a few <code>-</code> points.</p>}
            <div className="nf-input-actions">
              <button type="button" className="lp-btn lp-btn-quiet lp-btn-sm" onClick={() => { setText(SAMPLE_TALK); setSelected(0); }} disabled={text === SAMPLE_TALK}>
                <RotateCcw size={14} aria-hidden /> Reset example
              </button>
              <button type="button" className="lp-btn lp-btn-quiet lp-btn-sm" onClick={() => { setText(''); setSelected(0); }} disabled={!text}>
                <X size={14} aria-hidden /> Clear
              </button>
            </div>
          </div>

          <div className="nf-output">
            <div className="nf-controls">
              <fieldset className="nf-purpose" role="radiogroup">
                <legend className="nf-control-label">Made for</legend>
                <div className="nf-radios">
                  {MADE_FOR.map((id) => PURPOSES.find((p) => p.id === id)).filter((p) => p !== undefined).map((p) => (
                    <label key={p.id} className="nf-radio">
                      <input type="radio" name={`${ids}-purpose`} value={p.id} checked={purpose === p.id} onChange={() => setPurpose(p.id)} />
                      <span>{p.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="bc-switch nf-auto">
                <input type="checkbox" role="switch" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                <span className="bc-switch-track" aria-hidden><span /></span>
                Auto style
              </label>
              <span className="nf-look">Look: {theme.name}{auto ? ` · picked for a ${purposeLabel}` : ''}</span>
            </div>

            <div className="nf-preview">
              {slide && !empty
                ? <SlideView slide={slide} deck={deck} number={index + 1} count={count} framed label={`Slide ${index + 1} of ${count}: ${getKind(slide.kind)?.label ?? slide.kind}`} />
                : <div className="nf-preview-empty"><PenLine size={22} aria-hidden /><span>Your slides appear here as you type.</span></div>}
            </div>

            {!empty && (
              <ul className="nf-strip" aria-label="Slides made from your notes">
                {deck.slides.slice(0, FILMSTRIP_MAX).map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={`nf-thumb ${i === index ? 'is-current' : ''}`}
                      aria-label={`Slide ${i + 1} of ${count}: ${getKind(s.kind)?.label ?? s.kind}`}
                      aria-current={i === index ? 'true' : undefined}
                      onClick={() => setSelected(i)}
                    >
                      <SlideView slide={s} deck={deck} number={i + 1} count={count} />
                      {changed?.index === i && <span key={changed.n} className="nf-ring" aria-hidden />}
                    </button>
                  </li>
                ))}
                {count > FILMSTRIP_MAX && <li className="nf-more">+{count - FILMSTRIP_MAX} more</li>}
              </ul>
            )}

            <p className="nf-status" role="status" aria-live="polite">{statusText}</p>

            {slide && !empty && (
              <div className="nf-starter">
                <p className="nf-control-label">Starter notes from your text <span className="nf-min">· {slide.notes.minutes} min</span></p>
                <p className="nf-script">{slide.notes.script || 'No script for this slide yet.'}</p>
              </div>
            )}

            <div className="nf-actions">
              <button type="button" className="lp-btn lp-btn-brand" onClick={() => open('deck')} disabled={empty || saving !== null} data-testid="notes-open-deck">
                <PenLine size={16} aria-hidden /> {saving === 'deck' ? 'Saving…' : 'Open as a deck'}
              </button>
              <button type="button" className="lp-btn lp-btn-quiet" onClick={() => open('present')} disabled={empty || saving !== null}>
                <MonitorPlay size={16} aria-hidden /> {saving === 'present' ? 'Saving…' : 'Present it'}
              </button>
            </div>
            {error && <p className="nf-error" role="alert">This browser won't let Lectern save here. Try a normal window.</p>}

            <p className="nf-foot">
              Lectern also reads PowerPoint, Word, PDF and Excel files on this device. With AI set up on the server, it can
              plan an outline you can reorder and write full key notes. AI is optional; everything in this section works
              without it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
