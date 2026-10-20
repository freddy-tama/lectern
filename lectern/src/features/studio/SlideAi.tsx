import { AlertTriangle, ArrowUp, Check, Feather, Lightbulb, ListPlus, NotebookPen, RotateCcw, Scissors, Shrink, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { wording } from '../../core/deck/purpose';
import { canSplit, splitInDeck } from '../../core/deck/split';
import type { Deck, DeckPurpose, KeyNotes, Slide } from '../../core/deck/types';
import { Menu } from '../../ui/Menu';
import { SlideView } from '../slides/SlideView';
import { saveCode, savedCode } from './ai';
import { PRESETS, type PresetId, type RevisionResult, SlideAiError, type SlideAiStatus, TONES, requestLabel, reviseSlide, slideAiStatus } from './slide-ai';

const PRESET_ICONS: Record<string, typeof Shrink> = { shorter: Shrink, simpler: Feather, detail: ListPlus, example: Lightbulb, notes: NotebookPen };

export interface Proposal {
  slideId: string;
  preset: PresetId;
  instruction: string;
  label: string;
  status: 'loading' | 'ready' | 'error';
  result?: RevisionResult;
  error?: string;
  needsCode?: boolean;
}

/** True when the parts of the key notes a reader sees differ. Time alone doesn't count. */
export function notesDiffer(a: KeyNotes, b: KeyNotes): boolean {
  const pick = (n: KeyNotes) => JSON.stringify([n.script.trim(), n.keyPoints, n.cues, n.check]);
  return pick(a) !== pick(b);
}

/**
 * One AI suggestion for the selected slide, previewed before it touches the deck.
 * Accept applies it as a single undo step; moving to another slide drops it.
 */
export function useSlideRevision({ deck, slide, change }: { deck: Deck | null | undefined; slide: Slide | undefined; change(fn: (d: Deck) => Deck): void }) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [useNotes, setUseNotes] = useState(true);
  const [showOriginal, setShowOriginal] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const discard = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setProposal(null);
    setShowOriginal(false);
  }, []);

  const slideId = slide?.id;
  useEffect(() => {
    setProposal((p) => {
      if (p && p.slideId !== slideId) { abort.current?.abort(); return null; }
      return p;
    });
  }, [slideId]);
  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback((preset: PresetId, instruction = '') => {
    if (!deck || !slide) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const base = { slideId: slide.id, preset, instruction, label: requestLabel(preset, instruction) };
    setProposal({ ...base, status: 'loading' });
    setShowOriginal(false);
    setUseNotes(true);
    reviseSlide(deck, slide, preset, instruction, ac.signal).then(
      (result) => { if (!ac.signal.aborted) setProposal({ ...base, status: 'ready', result }); },
      (e: Error) => {
        if (ac.signal.aborted || e.name === 'AbortError') return;
        setProposal({ ...base, status: 'error', error: e.message, needsCode: e instanceof SlideAiError && e.needsCode });
      },
    );
  }, [deck, slide]);

  const retry = useCallback(() => { if (proposal) run(proposal.preset, proposal.instruction); }, [proposal, run]);

  /** Applies the suggestion in one change, so a single undo puts the slide back. */
  const accept = useCallback(() => {
    const r = proposal?.status === 'ready' ? proposal.result : undefined;
    if (!proposal || !r) return;
    if (r.kind === 'two') {
      change((d) => splitInDeck(d, proposal.slideId, r.slides));
    } else {
      const notesOnly = proposal.preset === 'notes';
      change((d) => ({
        ...d,
        slides: d.slides.map((s) => (s.id !== proposal.slideId ? s : {
          ...s,
          content: notesOnly ? s.content : r.slide.content,
          notes: notesOnly || useNotes ? r.slide.notes : s.notes,
        })),
      }));
    }
    setProposal(null);
    setShowOriginal(false);
  }, [proposal, useNotes, change]);

  return { proposal, run, retry, accept, discard, useNotes, setUseNotes, showOriginal, setShowOriginal };
}

export type SlideRevision = ReturnType<typeof useSlideRevision>;

/** The AI button under the slide: preset rewrites, a tone, key notes, splitting, and a free request. */
export function AiMenu({ slide, disabled, onRun, onSplit }: { slide: Slide; disabled?: boolean; onRun(preset: PresetId, instruction?: string): void; onSplit(): void }) {
  const [status, setStatus] = useState<SlideAiStatus | null>(null);
  const [request, setRequest] = useState('');
  const [code, setCode] = useState(savedCode);
  const splittable = canSplit(slide);
  const ready = status?.available !== false;
  useEffect(() => { slideAiStatus().then(setStatus); }, []);

  return (
    <Menu
      align="end"
      width={330}
      trigger={(p) => (
        <button
          type="button"
          className="btn btn-secondary btn-sm ai-trigger"
          disabled={disabled}
          title="Revise this slide with AI"
          {...p}
          onClick={(e) => { slideAiStatus().then(setStatus); p.onClick(e); }}
        >
          <Sparkles size={15} /> AI
        </button>
      )}
    >
      {(close) => (
        <div className="ai-menu">
          {!ready ? (
            <div className="ai-off">
              <strong>AI isn’t set up on this server.</strong>
              <span>Add an <code>ANTHROPIC_API_KEY</code> to the deployment to revise slides with AI.</span>
            </div>
          ) : (
            <>
              <p className="menu-label faint">Revise this slide</p>
              {PRESETS.filter((x) => x.id !== 'notes').map((x) => {
                const Icon = PRESET_ICONS[x.id];
                return (
                  <button key={x.id} type="button" className="menu-item" onClick={() => { close(); onRun(x.id); }}>
                    <Icon size={16} /><span>{x.label}<span className="menu-detail">{x.detail}</span></span>
                  </button>
                );
              })}
              <div className="ai-tones" role="group" aria-label="Change tone">
                <span className="menu-label faint">Change tone</span>
                <div className="ai-tone-row">
                  {TONES.map((t) => (
                    <button key={t.id} type="button" className="ai-tone" onClick={() => { close(); onRun('tone', t.id); }}>{t.label}</button>
                  ))}
                </div>
              </div>
              <div className="menu-sep" />
              <button type="button" className="menu-item" onClick={() => { close(); onRun('notes'); }}>
                <NotebookPen size={16} /><span>Fill key notes<span className="menu-detail">Script, key points and a question. The slide stays as it is</span></span>
              </button>
            </>
          )}
          {splittable && (
            <>
              <div className="menu-sep" />
              <button type="button" className="menu-item" onClick={() => { close(); onSplit(); }}>
                <Scissors size={16} /><span>Split in two<span className="menu-detail">Moves half the items to a new slide, instantly</span></span>
              </button>
              {ready && (
                <button type="button" className="menu-item" onClick={() => { close(); onRun('split'); }}>
                  <Sparkles size={16} /><span>Split with AI<span className="menu-detail">Shares out and rewrites the points, with key notes for both</span></span>
                </button>
              )}
            </>
          )}
          {ready && (
            <>
              <div className="menu-sep" />
              <form
                className="ai-tell"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = request.trim();
                  if (!v) return;
                  close();
                  setRequest('');
                  onRun('custom', v);
                }}
              >
                <label className="menu-label faint" htmlFor="ai-tell-input">Tell AI what to change</label>
                <div className="ai-tell-row">
                  <input
                    id="ai-tell-input"
                    className="input"
                    value={request}
                    onChange={(e) => setRequest(e.target.value)}
                    placeholder="Turn the points into questions"
                    autoComplete="off"
                    maxLength={2000}
                  />
                  <button type="submit" className="icon-btn ai-send" aria-label="Send to AI" disabled={!request.trim()}><ArrowUp size={16} /></button>
                </div>
              </form>
              {status?.needsCode && (
                <label className="ai-code">
                  <span className="menu-label faint">Access code</span>
                  <input className="input" type="password" value={code} onChange={(e) => { setCode(e.target.value); saveCode(e.target.value); }} autoComplete="off" />
                </label>
              )}
            </>
          )}
        </div>
      )}
    </Menu>
  );
}

const STAGE_FLAGS = {};

/** What the stage shows while a suggestion is open: the suggestion, or the original for comparison. */
export function ProposalStage({ revision, slide, deck, number, count }: { revision: SlideRevision; slide: Slide; deck: Deck; number: number; count: number }) {
  const { proposal, showOriginal } = revision;
  const r = proposal?.status === 'ready' ? proposal.result : undefined;
  const view = (s: Slide, label: string, n = number, c = count) => (
    <SlideView slide={s} deck={deck} number={n} count={c} mode="edit" flags={STAGE_FLAGS} className="stage-slide" label={label} />
  );
  if (!r || showOriginal) {
    return (
      <div className={`proposal-wrap ${proposal?.status === 'loading' ? 'is-waiting' : ''}`}>
        {view(slide, 'Current slide')}
        {proposal?.status === 'loading' && <div className="proposal-busy" aria-hidden><span className="spinner" /></div>}
      </div>
    );
  }
  if (r.kind === 'one') return <div className="proposal-wrap is-suggestion">{view(r.slide, 'Suggested slide')}</div>;
  return (
    <div className="proposal-pair is-suggestion">
      {view(r.slides[0], 'Suggested first slide', number, count + 1)}
      {view(r.slides[1], 'Suggested second slide', number + 1, count + 1)}
    </div>
  );
}

/** The bar under the stage while a suggestion is open. */
export function ProposalBar({ revision }: { revision: SlideRevision }) {
  const { proposal, showOriginal, setShowOriginal, accept, retry, discard } = revision;
  const [code, setCode] = useState(savedCode);
  const acceptRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (proposal?.status === 'ready') acceptRef.current?.focus(); }, [proposal?.status]);
  if (!proposal) return null;

  if (proposal.status === 'loading') {
    return (
      <div className="proposal-bar" role="status">
        <span className="spinner" />
        <span>Working on it: <strong>{proposal.label}</strong></span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={discard}><X size={14} /> Cancel</button>
      </div>
    );
  }
  if (proposal.status === 'error') {
    return (
      <div className="proposal-bar is-error" role="alert">
        <AlertTriangle size={15} />
        <span className="proposal-error">{proposal.error}</span>
        {proposal.needsCode && (
          <input className="input proposal-code" type="password" placeholder="Access code" aria-label="Access code" value={code} onChange={(e) => { setCode(e.target.value); saveCode(e.target.value); }} autoComplete="off" />
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={discard}><X size={14} /> Close</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={retry}><RotateCcw size={14} /> Try again</button>
      </div>
    );
  }
  return (
    <div className="proposal-bar" role="status" aria-label="AI suggestion">
      <span className="chip chip-brand proposal-label"><Sparkles size={13} /> {proposal.label}</span>
      <div className="segmented" role="group" aria-label="Compare">
        <button type="button" aria-pressed={!showOriginal} onClick={() => setShowOriginal(false)}>Suggestion</button>
        <button type="button" aria-pressed={showOriginal} onClick={() => setShowOriginal(true)}>Original</button>
      </div>
      <span className="proposal-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={discard}><X size={14} /> Discard</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={retry}><RotateCcw size={14} /> Try again</button>
        <button type="button" ref={acceptRef} className="btn btn-primary btn-sm" onClick={accept}><Check size={14} /> Accept</button>
      </span>
    </div>
  );
}

/** The suggested key notes, read-only, with the choice to keep your own when only the slide was asked about. */
export function ProposalNotes({ revision, slide, purpose }: { revision: SlideRevision; slide: Slide; purpose: DeckPurpose }) {
  const { proposal, useNotes, setUseNotes } = revision;
  const r = proposal?.status === 'ready' ? proposal.result : undefined;
  if (!proposal || !r) return null;
  const w = wording(purpose);
  if (r.kind === 'two') {
    return (
      <section className="notes-panel proposal-notes is-pair" aria-label="Suggested key notes">
        {r.slides.map((s, i) => (
          <div key={s.id} className="proposal-notes-col">
            <h2>Key notes, slide {i + 1}</h2>
            <NotesPreview notes={s.notes} keyPointsLabel={w.keyPointsLabel} checkLabel={w.checkLabel} />
          </div>
        ))}
      </section>
    );
  }
  const changed = notesDiffer(slide.notes, r.slide.notes);
  const choosable = proposal.preset !== 'notes' && changed;
  return (
    <section className="notes-panel proposal-notes" aria-label="Suggested key notes">
      <div className="proposal-notes-col">
        <div className="notes-head">
          <h2>{changed ? 'Suggested key notes' : 'Key notes'}</h2>
          {choosable && (
            <label className="switch">
              <input type="checkbox" checked={useNotes} onChange={(e) => setUseNotes(e.target.checked)} />
              <span>Use these key notes too</span>
            </label>
          )}
        </div>
        {!changed && <p className="faint">The suggestion keeps the key notes as they are.</p>}
        <div className={choosable && !useNotes ? 'is-dimmed' : ''}>
          <NotesPreview notes={changed ? r.slide.notes : slide.notes} keyPointsLabel={w.keyPointsLabel} checkLabel={w.checkLabel} />
        </div>
      </div>
    </section>
  );
}

function NotesPreview({ notes, keyPointsLabel, checkLabel }: { notes: KeyNotes; keyPointsLabel: string; checkLabel: string }) {
  return (
    <div className="notes-preview">
      <div className="notes-preview-script">{notes.script.trim() || <span className="faint">No script</span>}</div>
      <div className="notes-preview-side">
        {notes.keyPoints.length > 0 && (
          <div>
            <span className="field-label">{keyPointsLabel}</span>
            <ul>{notes.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
        )}
        {notes.check && (
          <div>
            <span className="field-label">{checkLabel}</span>
            <p>{notes.check.question}</p>
            {notes.check.answer && <p className="faint">{notes.check.answer}</p>}
          </div>
        )}
        {notes.cues.length > 0 && <div className="cue-list is-static">{notes.cues.map((c) => <span key={c} className="chip">{c}</span>)}</div>}
        <span className="faint">{notes.minutes} min on this slide</span>
      </div>
    </div>
  );
}
