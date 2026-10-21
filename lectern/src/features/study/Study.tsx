import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, BookOpen, Check, ChevronLeft, ChevronRight, Eye, Layers, ListChecks, RotateCcw, Shuffle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { NotFound } from '../../app/App';
import { wording } from '../../core/deck/purpose';
import { deckPurpose } from '../../core/deck/types';
import { getKind } from '../../core/kinds/registry';
import { type StudyMark, db } from '../../data/db';
import { useKeys } from '../../ui/hooks';
import { saveMark } from '../account/study-sync';
import { useLiveDeck } from '../present/useLiveDeck';
import { SlideView } from '../slides/SlideView';
import { type StudyCard, deckCards } from './cards';

type Mode = 'read' | 'cards' | 'points';

/** Saved in this browser, and to the account of whoever is signed in. */
async function mark(deckId: string, slideId: string, status: StudyMark['status']) {
  await saveMark({ deckId, slideId, status, updatedAt: Date.now() });
}

export default function Study() {
  const { deckId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const mode = (params.get('mode') as Mode) || 'read';
  const setMode = (m: Mode) => setParams({ mode: m }, { replace: true });
  const { deck, slides, steps } = useLiveDeck(deckId);
  const marks = useLiveQuery(() => db.study.where('deckId').equals(deckId).toArray(), [deckId]) ?? [];
  const markOf = useMemo(() => new Map(marks.map((m) => [m.slideId, m.status])), [marks]);

  if (deck === undefined) return <div className="study" />;
  if (deck === null) return <NotFound message="This deck was deleted." />;
  const w = wording(deckPurpose(deck));
  const known = slides.filter((s) => markOf.get(s.id) === 'known').length;

  return (
    <div className="study">
      <header className="study-top">
        <Link to={deck.lessonId ? `/lessons/${deck.lessonId}` : '/decks'} className="icon-btn" aria-label="Back"><ArrowLeft size={18} /></Link>
        <div className="study-title">
          <span className="eyebrow">{w.studyEyebrow}</span>
          <strong>{deck.title}</strong>
        </div>
        <div className="segmented" role="tablist" aria-label={w.studyName}>
          <button type="button" role="tab" aria-selected={mode === 'read'} onClick={() => setMode('read')}><BookOpen size={15} /> Read</button>
          <button type="button" role="tab" aria-selected={mode === 'cards'} onClick={() => setMode('cards')}><Layers size={15} /> Flashcards</button>
          <button type="button" role="tab" aria-selected={mode === 'points'} onClick={() => setMode('points')}><ListChecks size={15} /> Key points</button>
        </div>
        <div className="study-progress" aria-label={`${known} of ${slides.length} slides marked as understood`}>
          <div className="progress" style={{ width: 120, '--course': 'var(--good)' } as React.CSSProperties}><span style={{ width: `${slides.length ? (known / slides.length) * 100 : 0}%` }} /></div>
          <span className="faint tabular">{known}/{slides.length}</span>
        </div>
      </header>
      {mode === 'read' && <ReadMode deckId={deck.id} deck={deck} slides={slides} steps={steps} markOf={markOf} />}
      {mode === 'cards' && <CardsMode deck={deck} />}
      {mode === 'points' && <PointsMode deck={deck} slides={slides} />}
    </div>
  );
}

function ReadMode({ deckId, deck, slides, steps, markOf }: {
  deckId: string; deck: NonNullable<ReturnType<typeof useLiveDeck>['deck']>; slides: ReturnType<typeof useLiveDeck>['slides']; steps: number[]; markOf: Map<string, string>;
}) {
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [showCheck, setShowCheck] = useState(false);
  const slide = slides[Math.min(index, slides.length - 1)];
  useEffect(() => { setStep(0); setShowCheck(false); }, [index]);
  const max = steps[index] ?? 0;
  const go = (i: number) => setIndex(Math.max(0, Math.min(slides.length - 1, i)));
  useKeys((e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(index + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(index - 1); }
    else if (e.key === ' ' && step < max) { e.preventDefault(); setStep((s) => s + 1); }
  }, [index, step, max]);
  if (!slide) return <div className="study-body"><p className="muted">This deck has no slides yet.</p></div>;
  const n = slide.notes;
  const w = wording(deckPurpose(deck));
  const def = getKind(slide.kind);
  const status = markOf.get(slide.id);
  return (
    <div className="study-body study-read">
      <div className="study-slide-col">
        <SlideView slide={slide} deck={deck} number={index + 1} count={slides.length} step={step} framed label={`Slide ${index + 1}`} live />
        <div className="study-nav">
          <button type="button" className="btn btn-secondary" onClick={() => go(index - 1)} disabled={index === 0}><ChevronLeft size={16} /> Back</button>
          {max > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => (s < max ? s + 1 : 0))}>
              {step < max ? <><Eye size={16} /> {slide.kind === 'question' || slide.kind === 'recall' ? 'Show answer' : 'Show next'} ({step}/{max})</> : <><RotateCcw size={16} /> Hide again</>}
            </button>
          )}
          <span className="faint tabular" style={{ marginLeft: 'auto' }}>{index + 1} of {slides.length}</span>
          <button type="button" className="btn btn-primary" onClick={() => go(index + 1)} disabled={index >= slides.length - 1}>Next <ChevronRight size={16} /></button>
        </div>
        <div className="study-dots" role="list" aria-label="Slides">
          {slides.map((s, i) => (
            <button key={s.id} type="button" role="listitem" className={`study-dot ${i === index ? 'is-current' : ''} ${markOf.get(s.id) ?? ''}`} onClick={() => go(i)} aria-label={`Slide ${i + 1}${markOf.get(s.id) === 'known' ? ', understood' : markOf.get(s.id) === 'learning' ? ', to review' : ''}`} />
          ))}
        </div>
      </div>
      <article className="study-notes">
        <span className="eyebrow">{def?.label ?? 'Slide'} · {index + 1}</span>
        <h2>{def ? def.heading(slide.content) : 'Slide'}</h2>
        {n.keyPoints.length > 0 && (
          <section>
            <h3>{w.studyRemember}</h3>
            <ul className="study-points">{n.keyPoints.map((p, i) => <li key={i}><Check size={16} /> <span>{p}</span></li>)}</ul>
          </section>
        )}
        {n.script && (
          <section>
            <h3>Explanation</h3>
            {n.script.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}
          </section>
        )}
        {n.check && (
          <section className="study-check">
            <h3>{w.studyCheck}</h3>
            <p>{n.check.question}</p>
            {showCheck ? <p className="study-answer">{n.check.answer || 'No answer was given.'}</p> : <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCheck(true)}><Eye size={14} /> Show answer</button>}
          </section>
        )}
        {n.links.length > 0 && (
          <section>
            <h3>Read more</h3>
            <ul>{n.links.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noreferrer noopener">{l.label || l.url}</a></li>)}</ul>
          </section>
        )}
        <div className="study-mark">
          <span className="faint">{w.studyRate}</span>
          <button type="button" className={`btn btn-sm ${status === 'learning' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => mark(deckId, slide.id, 'learning')}>Review again</button>
          <button type="button" className={`btn btn-sm ${status === 'known' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { mark(deckId, slide.id, 'known'); go(index + 1); }}><Check size={14} /> Got it</button>
        </div>
      </article>
    </div>
  );
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function CardsMode({ deck }: { deck: NonNullable<ReturnType<typeof useLiveDeck>['deck']> }) {
  const all = useMemo(() => deckCards(deck), [deck]);
  const [queue, setQueue] = useState<StudyCard[]>(all);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const [again, setAgain] = useState(0);
  useEffect(() => { setQueue(all); setDone(0); setAgain(0); }, [all]);
  const card = queue[0];
  const answer = (ok: boolean) => {
    setFlipped(false);
    setQueue((q) => (ok ? q.slice(1) : [...q.slice(1), q[0]]));
    if (ok) setDone((d) => d + 1); else setAgain((a) => a + 1);
  };
  useKeys((e) => {
    if (!card) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped((f) => !f); }
    else if (flipped && (e.key === '1' || e.key === 'ArrowLeft')) answer(false);
    else if (flipped && (e.key === '2' || e.key === 'ArrowRight')) answer(true);
  }, [card, flipped]);

  if (!all.length) {
    return (
      <div className="study-body">
        <div className="empty">
          <div className="empty-icon"><Layers size={22} /></div>
          <h3>No flashcards in this deck yet</h3>
          <p>Cards come from Key term, Quick recall and Question slides, and from the check questions in key notes.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="study-body study-cards">
      <div className="cards-meta">
        <span className="faint tabular">{done} of {all.length} learned{again ? ` · ${again} to repeat` : ''}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQueue(shuffle(all)); setDone(0); setAgain(0); setFlipped(false); }}><Shuffle size={14} /> Shuffle and restart</button>
      </div>
      {card ? (
        <>
          <button type="button" className={`flashcard ${flipped ? 'is-flipped' : ''}`} onClick={() => setFlipped((f) => !f)} aria-label={flipped ? 'Show the question' : 'Show the answer'}>
            <span className="flashcard-face front"><span className="eyebrow">{card.source}</span><span className="flashcard-text">{card.front}</span><span className="faint flashcard-hint">Tap or press Space to turn over</span></span>
            <span className="flashcard-face back"><span className="eyebrow">Answer</span><span className="flashcard-text">{card.back}</span></span>
          </button>
          <div className="cards-actions" aria-hidden={!flipped}>
            <button type="button" className="btn btn-secondary btn-lg" disabled={!flipped} onClick={() => answer(false)}><RotateCcw size={16} /> Again <kbd>1</kbd></button>
            <button type="button" className="btn btn-primary btn-lg" disabled={!flipped} onClick={() => answer(true)}><Check size={16} /> Got it <kbd>2</kbd></button>
          </div>
        </>
      ) : (
        <div className="empty">
          <div className="empty-icon" style={{ background: 'var(--good-soft)', color: 'var(--good)' }}><Check size={22} /></div>
          <h3>All {all.length} cards done</h3>
          <p>{again ? `You repeated ${again} ${again === 1 ? 'card' : 'cards'} along the way.` : 'Every card right the first time.'}</p>
          <button type="button" className="btn btn-primary" onClick={() => { setQueue(shuffle(all)); setDone(0); setAgain(0); }}><Shuffle size={16} /> Go again</button>
        </div>
      )}
    </div>
  );
}

function PointsMode({ deck, slides }: { deck: NonNullable<ReturnType<typeof useLiveDeck>['deck']>; slides: ReturnType<typeof useLiveDeck>['slides'] }) {
  const rows = slides.map((s, i) => ({ s, i, def: getKind(s.kind) })).filter(({ s }) => s.notes.keyPoints.length || s.notes.check);
  return (
    <div className="study-body study-points-page">
      <div className="points-head">
        <h2 className="display">{deck.title}</h2>
        <Link className="btn btn-secondary btn-sm" to={`/print/${deck.id}`}>Print or save as PDF</Link>
      </div>
      {rows.length ? rows.map(({ s, i, def }) => (
        <section key={s.id} className="points-row">
          <div className="points-thumb"><SlideView slide={s} deck={deck} number={i + 1} count={slides.length} framed /></div>
          <div>
            <h3>{def ? def.heading(s.content) : 'Slide'}</h3>
            <ul>{s.notes.keyPoints.map((p, k) => <li key={k}>{p}</li>)}</ul>
            {s.notes.check && <p className="faint"><strong>Check:</strong> {s.notes.check.question}</p>}
          </div>
        </section>
      )) : <p className="muted">No key points yet. Add them in the editor’s key notes.</p>}
    </div>
  );
}
