import { AlertTriangle, ArrowUp, Check, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, RotateCcw, Square, SquarePen, Trash2, WandSparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { wording } from '../../core/deck/purpose';
import { type Deck, type Slide, deckMinutes, deckPurpose } from '../../core/deck/types';
import { getKind } from '../../core/kinds/registry';
import { SlideView } from '../slides/SlideView';
import { saveCode, savedCode } from './ai';
import { type HistoryMessage, MAX_HISTORY_BYTES, type StepCard, type TurnResult, assistantStatus, runAssistantTurn } from './assistant-api';
import { type DeckOp, applyOp, kindsKey, needsTick, opApplies, opKey, opPreview, overflows } from './deck-ops';
import { SlideAiError } from './slide-ai';
import { NotesPreview } from './SlideAi';

type Decision = 'accepted' | 'discarded' | 'stale';

interface Turn {
  id: number;
  request: string;
  status: 'working' | 'review' | 'done' | 'error';
  startedAt: number;
  step: number;
  cards: StepCard[];
  summary?: string;
  stopped?: TurnResult['stopped'];
  ops: DeckOp[];
  decisions: Record<string, Decision>;
  /** How each decided card read at the time: slide numbers move once changes land. */
  described: Record<string, Described>;
  ticked: Record<string, boolean>;
  error?: string;
  needsCode?: boolean;
}

interface Chat {
  history: HistoryMessage[];
  turns: Turn[];
  /** The slide types the assistant was last told about. */
  kindsKey: string | null;
  /** What the presenter did with the last proposals, for the next turn. */
  since?: { proposed: number; applied: number };
}

const emptyChat = (): Chat => ({ history: [], turns: [], kindsKey: null });

/** One chat per deck for this session: it survives closing the panel and leaving the studio. */
const chats = new Map<string, Chat>();

const headingOf = (s: Slide | undefined) => {
  if (!s) return '';
  const def = getKind(s.kind);
  try { return (def ? def.heading(s.content) : s.kind).trim(); } catch { return s.kind; }
};

/**
 * The deck assistant: a chat about the whole deck whose answers are proposals. Proposals are previewed on the
 * stage and applied only when the presenter accepts them: one at a time, or all ticked ones as one undo step.
 */
export function useDeckAssistant({ deck, change, plannedMinutes, select, notify }: {
  deck: Deck | null | undefined;
  change(fn: (d: Deck) => Deck): void;
  plannedMinutes?: number;
  /** Selects a slide in the studio, so the preview sits where the change is. */
  select(id: string): void;
  /** A short message with an Undo button. */
  notify(message: string): void;
}) {
  const deckId = deck?.id ?? '';
  const [chat, setChat] = useState<Chat>(() => chats.get(deckId) ?? emptyChat());
  const [focus, setFocus] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const shown = useRef(deckId);
  const live = useRef(deck);
  live.current = deck;
  const showing = useRef(chat);
  showing.current = chat;

  useEffect(() => {
    shown.current = deckId;
    setChat(chats.get(deckId) ?? emptyChat());
    setFocus(null);
  }, [deckId]);

  /** Changes a deck's chat. A turn can finish after the presenter has moved on; its result still lands. */
  const update = useCallback((id: string, fn: (c: Chat) => Chat) => {
    // The chat on screen is the fallback, so the store and the panel can't drift apart (after a hot reload, say).
    const next = fn(chats.get(id) ?? (shown.current === id ? showing.current : emptyChat()));
    chats.set(id, next);
    if (shown.current === id) setChat(next);
  }, []);

  const patchTurn = useCallback((id: string, turnId: number, fn: (t: Turn) => Turn) => {
    update(id, (c) => ({ ...c, turns: c.turns.map((t) => (t.id === turnId ? fn(t) : t)) }));
  }, [update]);

  const current = chat.turns.at(-1);
  const working = current?.status === 'working';
  const pending = useMemo(() => (current?.status === 'review' ? current.ops.filter((op) => !current.decisions[opKey(op)]) : []), [current]);
  const historyBytes = useMemo(() => JSON.stringify(chat.history).length, [chat.history]);
  const full = historyBytes > MAX_HISTORY_BYTES;

  const send = useCallback((text: string) => {
    const request = text.trim();
    const d = live.current;
    if (!request || !d || working || pending.length || full) return;
    const id = d.id;
    const c = chats.get(id) ?? emptyChat();
    const key = kindsKey();
    const turnId = Date.now();
    update(id, (x) => ({ ...x, turns: [...x.turns, { id: turnId, request, status: 'working', startedAt: Date.now(), step: 0, cards: [], ops: [], decisions: {}, described: {}, ticked: {} }] }));
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    runAssistantTurn(
      { request, history: c.history, deck: d, plannedMinutes, withKinds: c.kindsKey !== key, since: c.since },
      (e) => {
        if (e.type === 'step') patchTurn(id, turnId, (t) => ({ ...t, step: e.step }));
        if (e.type === 'tool') {
          const card: StepCard = { id: e.id, name: e.name, label: e.label, status: e.status, ...(e.detail ? { detail: e.detail } : {}) };
          patchTurn(id, turnId, (t) => ({ ...t, cards: t.cards.some((x) => x.id === card.id) ? t.cards.map((x) => (x.id === card.id ? card : x)) : [...t.cards, card] }));
        }
      },
      ac.signal,
    ).then(
      (result) => {
        const now = live.current?.id === id ? live.current : d;
        // Deletions and rewrites start unticked: Accept all never takes them without the presenter's say-so.
        const ticked = Object.fromEntries(result.ops.map((op) => [opKey(op), !needsTick(now, op)]));
        update(id, (x) => ({
          ...x,
          history: result.history,
          kindsKey: key,
          since: undefined,
          turns: x.turns.map((t) => (t.id === turnId ? { ...t, status: result.ops.length ? 'review' : 'done', summary: result.summary, stopped: result.stopped, ops: result.ops, ticked } : t)),
        }));
      },
      (e: Error) => {
        if (ac.signal.aborted || e.name === 'AbortError') {
          patchTurn(id, turnId, (t) => ({ ...t, status: 'done', summary: 'Stopped. Nothing was proposed.' }));
          return;
        }
        patchTurn(id, turnId, (t) => ({ ...t, status: 'error', error: e.message, needsCode: e instanceof SlideAiError && e.needsCode }));
      },
    );
  }, [working, pending.length, full, plannedMinutes, update, patchTurn]);

  const stop = useCallback(() => abort.current?.abort(), []);

  const retry = useCallback(() => {
    if (current?.status !== 'error' || !deckId) return;
    const request = current.request;
    update(deckId, (c) => ({ ...c, turns: c.turns.filter((t) => t.id !== current.id) }));
    // The failed turn left the conversation as it was, so the request goes again as a fresh turn.
    setTimeout(() => send(request), 0);
  }, [current, deckId, update, send]);

  /** Records decisions; once nothing is left to decide, the turn is done and the next request says what happened. */
  const decide = useCallback((decisions: Record<string, Decision>) => {
    if (!current || !deckId) return;
    const d = live.current;
    update(deckId, (c) => {
      const turns = c.turns.map((t) => {
        if (t.id !== current.id) return t;
        const all = { ...t.decisions, ...decisions };
        const open = t.ops.some((op) => !all[opKey(op)]);
        // Called before the deck changes, so the card keeps the numbers the presenter decided on.
        const described = { ...t.described };
        for (const op of t.ops) if (decisions[opKey(op)] && d) described[opKey(op)] = describe(d, op);
        return { ...t, decisions: all, described, status: open ? t.status : 'done' as const };
      });
      const t = turns.find((x) => x.id === current.id);
      if (!t) return c;
      const settled = t.status === 'done';
      return settled ? { ...c, turns, since: { proposed: t.ops.length, applied: t.ops.filter((op) => t.decisions[opKey(op)] === 'accepted').length } } : { ...c, turns };
    });
  }, [current, deckId, update]);

  const accept = useCallback((key: string) => {
    const op = pending.find((o) => opKey(o) === key);
    const d = live.current;
    if (!op || !d) return;
    if (!opApplies(d, op)) { decide({ [key]: 'stale' }); return; }
    // Recorded first, so a proposal is never left on offer once it has changed the deck.
    decide({ [key]: 'accepted' });
    change((x) => applyOp(x, op));
    notify(op.op === 'delete' ? 'Slide deleted' : 'Change applied');
  }, [pending, change, decide, notify]);

  const discard = useCallback((key: string) => decide({ [key]: 'discarded' }), [decide]);

  /** Every ticked proposal in one deck change, so a single undo puts all of it back. */
  const acceptTicked = useCallback(() => {
    const d = live.current;
    if (!current || !d) return;
    const chosen = pending.filter((op) => current.ticked[opKey(op)]);
    if (!chosen.length) return;
    const decisions: Record<string, Decision> = {};
    let next = d;
    for (const op of chosen) {
      if (!opApplies(next, op)) { decisions[opKey(op)] = 'stale'; continue; }
      next = applyOp(next, op);
      decisions[opKey(op)] = 'accepted';
    }
    const applied = Object.values(decisions).filter((x) => x === 'accepted').length;
    decide(decisions);
    setFocus(null);
    if (applied) {
      const final = next;
      change(() => final);
      notify(`Applied ${applied} change${applied === 1 ? '' : 's'}`);
    }
  }, [current, pending, change, decide, notify]);

  const discardAll = useCallback(() => {
    decide(Object.fromEntries(pending.map((op) => [opKey(op), 'discarded' as const])));
    setFocus(null);
  }, [pending, decide]);

  const tick = useCallback((key: string, on: boolean) => {
    if (current && deckId) patchTurn(deckId, current.id, (t) => ({ ...t, ticked: { ...t.ticked, [key]: on } }));
  }, [current, deckId, patchTurn]);

  const newChat = useCallback(() => {
    if (!deckId) return;
    abort.current?.abort();
    update(deckId, () => emptyChat());
    setFocus(null);
  }, [deckId, update]);

  const focusedOp = focus ? pending.find((op) => opKey(op) === focus) ?? null : null;

  /** Where the studio's selection goes while a proposal is previewed: its slide, or the slide a new one follows. */
  const anchorOf = useCallback((op: DeckOp) => {
    const d = live.current;
    if (!d) return '';
    if (op.op !== 'add') return op.slideId;
    return op.after.find((id) => d.slides.some((s) => s.id === id)) ?? d.slides[0]?.id ?? '';
  }, []);

  const preview = useCallback((key: string | null) => {
    const op = key ? pending.find((o) => opKey(o) === key) : undefined;
    setShowOriginal(false);
    if (!op) { setFocus(null); return; }
    const anchor = anchorOf(op);
    if (anchor) select(anchor);
    setFocus(key);
  }, [pending, anchorOf, select]);

  const step = useCallback((delta: number) => {
    if (!pending.length) return;
    const at = pending.findIndex((op) => opKey(op) === focus);
    preview(opKey(pending[(at + delta + pending.length) % pending.length]));
  }, [pending, focus, preview]);

  /** Accept from the stage: the preview moves on to the next proposal. */
  const acceptFocused = useCallback(() => {
    if (!focusedOp) return;
    const key = opKey(focusedOp);
    const rest = pending.filter((op) => opKey(op) !== key);
    const at = pending.findIndex((op) => opKey(op) === key);
    accept(key);
    const next = rest[Math.min(at, rest.length - 1)];
    if (next) preview(opKey(next)); else setFocus(null);
  }, [focusedOp, pending, accept, preview]);

  const discardFocused = useCallback(() => {
    if (!focusedOp) return;
    const key = opKey(focusedOp);
    const rest = pending.filter((op) => opKey(op) !== key);
    const at = pending.findIndex((op) => opKey(op) === key);
    discard(key);
    const next = rest[Math.min(at, rest.length - 1)];
    if (next) preview(opKey(next)); else setFocus(null);
  }, [focusedOp, pending, discard, preview]);

  return {
    chat, current, working, pending, full,
    send, stop, retry, accept, discard, acceptTicked, discardAll, tick, newChat,
    focused: focusedOp, focusedSlideId: focusedOp ? anchorOf(focusedOp) : null, preview, step, acceptFocused, discardFocused,
    showOriginal, setShowOriginal,
  };
}

export type DeckAssistant = ReturnType<typeof useDeckAssistant>;

// ─── Describing a proposal ─────────────────────────────────────────────────────

interface Described { title: string; heading: string; changes: string[] }

/** What a proposal does, in a few words, with slide numbers as the deck stands now. */
function describe(deck: Deck, op: DeckOp): Described {
  const num = (id: string) => deck.slides.findIndex((s) => s.id === id) + 1;
  const { before, after } = opPreview(deck, op);
  if (op.op === 'add') {
    const anchor = op.after.find((id) => num(id) > 0);
    const label = getKind(op.slide.kind)?.label.toLowerCase() ?? 'new';
    return { title: anchor ? `New ${label} slide after slide ${num(anchor)}` : `New ${label} slide at the start`, heading: headingOf(after), changes: [] };
  }
  const n = num(op.slideId);
  const slide = n ? `slide ${n}` : 'a removed slide';
  if (op.op === 'delete') return { title: `Delete ${slide}`, heading: headingOf(before), changes: [] };
  if (op.op === 'move') {
    const anchor = op.after.find((id) => num(id) > 0 && id !== op.slideId);
    return { title: anchor ? `Move ${slide} after slide ${num(anchor)}` : `Move ${slide} to the start`, heading: headingOf(before), changes: [] };
  }
  const changes: string[] = [];
  if (op.content) changes.push('Wording');
  const notes = op.notes ?? {};
  if (Object.keys(notes).some((k) => k !== 'minutes')) changes.push('Key notes');
  // Slide times are in halves, so they are shown as they are rather than rounded.
  if (notes.minutes !== undefined && before) changes.push(`${before.notes.minutes} min → ${notes.minutes} min`);
  const was = headingOf(before);
  const now = headingOf(after);
  return { title: op.content ? `Edit ${slide}` : `Key notes, ${slide}`, heading: was !== now ? `${was} → ${now}` : was, changes };
}

const STOPPED: Record<string, string> = {
  steps: 'It stopped at its step limit.',
  time: 'It stopped early to stay within the time limit.',
  length: 'Its answer ran too long.',
};

// ─── The panel ─────────────────────────────────────────────────────────────────

/** The assistant's side panel: the chat, live step cards, and the proposals to review. */
export function AssistantPanel({ assistant, deck, plannedMinutes, onClose }: { assistant: DeckAssistant; deck: Deck; plannedMinutes?: number; onClose(): void }) {
  const [status, setStatus] = useState<{ available: boolean; needsCode: boolean } | null>(null);
  const [draft, setDraft] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const { chat, current, working, pending, full } = assistant;
  useEffect(() => { assistantStatus().then(setStatus); }, []);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [chat.turns.length, current?.cards.length, current?.status]);
  useEffect(() => { if (!working && !pending.length) input.current?.focus({ preventScroll: true }); }, [working, pending.length]);

  const total = deckMinutes(deck);
  const target = plannedMinutes && total > plannedMinutes ? plannedMinutes : Math.max(5, Math.round((total * 0.7) / 5) * 5);
  const suggestions = [
    total > 5 ? `Cut this to ${target} minutes` : 'Add more detail where it’s thin',
    'Add a summary at the end',
    'Make it less technical',
    'Fill in missing key notes',
  ];
  const blocked = working || pending.length > 0 || full;
  const submit = (text: string) => {
    if (!text.trim() || blocked) return;
    assistant.send(text);
    setDraft('');
  };

  return (
    <section className="assistant" aria-label="Deck assistant">
      <header className="assistant-head">
        <h2><WandSparkles size={16} /> Deck assistant</h2>
        <span className="assistant-head-tools">
          {chat.turns.length > 0 && (
            <button type="button" className="icon-btn" onClick={assistant.newChat} disabled={working} aria-label="Start a new chat" title="Start a new chat"><SquarePen size={16} /></button>
          )}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close the assistant" title="Close"><X size={16} /></button>
        </span>
      </header>

      <div className="assistant-log" ref={log}>
        {status && !status.available ? (
          <div className="assistant-empty">
            <strong>The assistant isn’t set up on this server.</strong>
            <p className="faint">Add an <code>ANTHROPIC_API_KEY</code> to the deployment to use it.</p>
          </div>
        ) : !chat.turns.length ? (
          <div className="assistant-empty">
            <p>Ask for changes across the whole deck. You’ll see each one before anything changes.</p>
            <div className="assistant-suggest">
              {suggestions.map((s) => <button key={s} type="button" className="ai-tone" onClick={() => submit(s)}>{s}</button>)}
            </div>
          </div>
        ) : (
          chat.turns.map((t) => <TurnView key={t.id} turn={t} deck={deck} assistant={assistant} last={t === current} />)
        )}
      </div>

      <footer className="assistant-foot">
        {current?.status === 'review' && pending.length > 0 ? (
          <ReviewBar assistant={assistant} turn={current} />
        ) : (
          <form className="assistant-form" onSubmit={(e) => { e.preventDefault(); submit(draft); }}>
            <label className="visually-hidden" htmlFor="assistant-input">Your request</label>
            <textarea
              id="assistant-input"
              ref={input}
              className="textarea"
              rows={2}
              value={draft}
              disabled={blocked || status?.available === false}
              placeholder={full ? 'This chat is full. Start a new one to go on.' : chat.turns.length ? 'Ask for another change' : 'What should change?'}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(draft); } }}
              maxLength={4000}
            />
            {working ? (
              <button type="button" className="icon-btn ai-send" onClick={assistant.stop} aria-label="Stop the assistant" title="Stop"><Square size={14} /></button>
            ) : (
              <button type="submit" className="icon-btn ai-send" aria-label="Send to the assistant" disabled={blocked || !draft.trim()}><ArrowUp size={16} /></button>
            )}
          </form>
        )}
        {(status?.needsCode || current?.needsCode) && <AccessCode />}
      </footer>
    </section>
  );
}

function AccessCode() {
  const [code, setCode] = useState(savedCode);
  return (
    <label className="ai-code">
      <span className="menu-label faint">Access code</span>
      <input className="input" type="password" value={code} onChange={(e) => { setCode(e.target.value); saveCode(e.target.value); }} autoComplete="off" />
    </label>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - since) / 1000));
  return <span className="faint">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

function StepCards({ cards }: { cards: StepCard[] }) {
  return (
    <ul className="assistant-steps">
      {cards.map((c) => (
        <li key={c.id} className={`assistant-step is-${c.status}`}>
          {c.status === 'running' ? <span className="spinner" aria-hidden /> : c.status === 'done' ? <CircleCheck size={14} aria-hidden /> : <CircleAlert size={14} aria-hidden />}
          <span>{c.label}{c.status === 'running' ? '…' : ''}{c.detail && <span className="assistant-step-detail">{c.detail}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

function TurnView({ turn, deck, assistant, last }: { turn: Turn; deck: Deck; assistant: DeckAssistant; last: boolean }) {
  const applied = turn.ops.filter((op) => turn.decisions[opKey(op)] === 'accepted').length;
  return (
    <div className="assistant-turn">
      <p className="assistant-request">{turn.request}</p>
      {turn.status === 'working' ? (
        <div className="assistant-working" role="status" aria-live="polite">
          <StepCards cards={turn.cards} />
          <p className="assistant-progress"><span className="spinner" aria-hidden /> {turn.step > 1 ? `Working on it, step ${turn.step}` : 'Reading the deck'} <Elapsed since={turn.startedAt} /></p>
        </div>
      ) : turn.cards.length > 0 ? (
        <details className="assistant-steps-done">
          <summary>{turn.cards.length} step{turn.cards.length === 1 ? '' : 's'}</summary>
          <StepCards cards={turn.cards} />
        </details>
      ) : null}
      {turn.status === 'error' && (
        <div className="assistant-error" role="alert">
          <AlertTriangle size={15} aria-hidden />
          <span>{turn.error}</span>
          {last && <button type="button" className="btn btn-secondary btn-sm" onClick={assistant.retry}><RotateCcw size={14} /> Try again</button>}
        </div>
      )}
      {turn.summary && (
        <div className="assistant-reply">
          <p>{turn.summary}</p>
          {turn.stopped && STOPPED[turn.stopped] && <p className="faint">{STOPPED[turn.stopped]}</p>}
        </div>
      )}
      {turn.ops.length > 0 && (
        <div className="assistant-changes">
          <h3>{turn.ops.length} proposed change{turn.ops.length === 1 ? '' : 's'}</h3>
          {turn.ops.map((op) => <ChangeCard key={opKey(op)} op={op} turn={turn} deck={deck} assistant={assistant} />)}
          {turn.status === 'done' && <p className="faint assistant-applied">Accepted {applied} of {turn.ops.length} change{turn.ops.length === 1 ? '' : 's'}.</p>}
        </div>
      )}
    </div>
  );
}

const DECIDED: Record<Decision, string> = { accepted: 'Accepted', discarded: 'Discarded', stale: 'Couldn’t apply: the slide has changed place or gone' };

function ChangeCard({ op, turn, deck, assistant }: { op: DeckOp; turn: Turn; deck: Deck; assistant: DeckAssistant }) {
  const key = opKey(op);
  const decided = turn.decisions[key];
  const open = turn.status === 'review' && !decided;
  const frozen = turn.described[key];
  const info = useMemo(() => frozen ?? describe(deck, op), [frozen, deck, op]);
  const tickReason = useMemo(() => (open ? needsTick(deck, op) : null), [open, deck, op]);
  const tooLong = useMemo(() => {
    if (!open || op.op === 'delete' || op.op === 'move') return false;
    const after = opPreview(deck, op).after;
    return Boolean(after && overflows(deck, after));
  }, [open, deck, op]);
  const focused = assistant.focused && opKey(assistant.focused) === key;
  return (
    <article className={`assistant-change ${focused ? 'is-focused' : ''} ${decided ? `is-${decided}` : ''}`}>
      {open && (
        <input
          type="checkbox"
          className="assistant-tick"
          checked={Boolean(turn.ticked[key])}
          onChange={(e) => assistant.tick(key, e.target.checked)}
          aria-label={`Include “${info.title}” in Accept all`}
        />
      )}
      <div className="assistant-change-body">
        <button type="button" className="assistant-change-title" onClick={() => assistant.preview(focused ? null : key)} disabled={!open} aria-pressed={Boolean(focused)} title={open ? 'Show on the stage' : undefined}>
          {info.title}
        </button>
        {info.heading && <span className="assistant-change-heading">{info.heading}</span>}
        {info.changes.length > 0 && <span className="assistant-change-what">{info.changes.join(' · ')}</span>}
        {op.reason && <span className="assistant-change-why">{op.reason}</span>}
        {(tickReason || tooLong) && (
          <span className="assistant-flags">
            {tickReason && <span className="chip chip-warn"><AlertTriangle size={12} aria-hidden /> {tickReason}{turn.ticked[key] ? '' : ', tick to include'}</span>}
            {tooLong && <span className="chip chip-warn"><AlertTriangle size={12} aria-hidden /> Too long for one slide</span>}
          </span>
        )}
        {decided ? (
          <span className={`assistant-decided ${decided === 'accepted' ? 'is-good' : ''}`}>{decided === 'accepted' && <Check size={13} aria-hidden />} {DECIDED[decided]}</span>
        ) : open && (
          <span className="assistant-change-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => assistant.discard(key)}>Discard</button>
            <button type="button" className={`btn btn-sm ${op.op === 'delete' ? 'btn-danger-solid' : 'btn-secondary'}`} onClick={() => assistant.accept(key)}>
              {op.op === 'delete' ? <><Trash2 size={13} /> Delete</> : <><Check size={13} /> Accept</>}
            </button>
          </span>
        )}
      </div>
    </article>
  );
}

function ReviewBar({ assistant, turn }: { assistant: DeckAssistant; turn: Turn }) {
  const { pending } = assistant;
  const ticked = pending.filter((op) => turn.ticked[opKey(op)]).length;
  const label = ticked === pending.length ? 'Accept all' : `Accept ${ticked} ticked`;
  return (
    <div className="assistant-review">
      <p className="faint">{ticked < pending.length ? `${pending.length - ticked} not ticked. Tick them to include them, or decide one by one.` : 'Accept everything at once or one by one. Undo puts it all back.'}</p>
      <span className="assistant-review-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={assistant.discardAll}><X size={14} /> Discard all</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={assistant.acceptTicked} disabled={!ticked}><Check size={14} /> {label}</button>
      </span>
    </div>
  );
}

// ─── On the stage ──────────────────────────────────────────────────────────────

const STAGE_FLAGS = {};

/** The proposal being reviewed, on the stage: the slide as it would be, or as it is. */
export function AssistantStage({ assistant, deck }: { assistant: DeckAssistant; deck: Deck }) {
  const op = assistant.focused;
  if (!op) return null;
  const { before, after } = opPreview(deck, op);
  const shown = deck.slides.filter((s) => !s.hidden);
  const count = op.op === 'add' ? shown.length + 1 : op.op === 'delete' ? shown.length - 1 : shown.length;
  const number = (s: Slide | undefined) => Math.max(1, shown.findIndex((x) => x.id === s?.id) + 1);
  const view = (s: Slide, label: string, n: number) => <SlideView slide={s} deck={deck} number={n} count={count} mode="edit" flags={STAGE_FLAGS} className="stage-slide" label={label} />;
  if (op.op === 'delete' && before) {
    return <div className="proposal-wrap is-deleting">{view(before, 'Slide to delete', number(before))}<span className="assistant-stage-note"><Trash2 size={14} /> Deleted if you accept</span></div>;
  }
  if (assistant.showOriginal && before) return <div className="proposal-wrap">{view(before, 'Current slide', number(before))}</div>;
  if (!after) return null;
  const anchor = op.op === 'add' ? op.after.find((id) => shown.some((s) => s.id === id)) : undefined;
  const n = op.op === 'add' ? (anchor ? shown.findIndex((s) => s.id === anchor) + 2 : 1) : number(after);
  return <div className="proposal-wrap is-suggestion">{view(after, 'Suggested slide', n)}</div>;
}

/** The bar under the stage while a proposal is previewed. */
export function AssistantBar({ assistant, deck }: { assistant: DeckAssistant; deck: Deck }) {
  const op = assistant.focused;
  const acceptRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { acceptRef.current?.focus({ preventScroll: true }); }, [op]);
  if (!op) return null;
  const { pending } = assistant;
  const at = pending.findIndex((o) => opKey(o) === opKey(op));
  const info = describe(deck, op);
  const comparable = op.op === 'edit';
  return (
    <div className="proposal-bar" role="status" aria-label="Proposed change">
      <span className="assistant-bar-nav">
        <button type="button" className="icon-btn" onClick={() => assistant.step(-1)} disabled={pending.length < 2} aria-label="Previous change"><ChevronLeft size={16} /></button>
        <span className="chip chip-brand proposal-label"><WandSparkles size={13} /> {at + 1} of {pending.length}: {info.title}</span>
        <button type="button" className="icon-btn" onClick={() => assistant.step(1)} disabled={pending.length < 2} aria-label="Next change"><ChevronRight size={16} /></button>
      </span>
      {comparable && (
        <div className="segmented" role="group" aria-label="Compare">
          <button type="button" aria-pressed={!assistant.showOriginal} onClick={() => assistant.setShowOriginal(false)}>Suggestion</button>
          <button type="button" aria-pressed={assistant.showOriginal} onClick={() => assistant.setShowOriginal(true)}>Original</button>
        </div>
      )}
      <span className="proposal-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => assistant.preview(null)}>Close</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={assistant.discardFocused}><X size={14} /> Discard</button>
        <button type="button" ref={acceptRef} className={`btn btn-sm ${op.op === 'delete' ? 'btn-danger-solid' : 'btn-primary'}`} onClick={assistant.acceptFocused}>
          {op.op === 'delete' ? <><Trash2 size={14} /> Delete</> : <><Check size={14} /> Accept</>}
        </button>
      </span>
    </div>
  );
}

/** The key notes of the previewed proposal, read-only. */
export function AssistantNotes({ assistant, deck }: { assistant: DeckAssistant; deck: Deck }) {
  const op = assistant.focused;
  if (!op) return null;
  const { before, after } = opPreview(deck, op);
  const s = assistant.showOriginal || op.op === 'delete' ? before : after;
  if (!s) return null;
  const w = wording(deckPurpose(deck));
  const changed = op.op === 'edit' && op.notes && !assistant.showOriginal;
  return (
    <section className="notes-panel proposal-notes" aria-label="Key notes of the proposed change">
      <div className="proposal-notes-col">
        <div className="notes-head"><h2>{changed ? 'Suggested key notes' : 'Key notes'}</h2></div>
        <NotesPreview notes={s.notes} keyPointsLabel={w.keyPointsLabel} checkLabel={w.checkLabel} />
      </div>
    </section>
  );
}
