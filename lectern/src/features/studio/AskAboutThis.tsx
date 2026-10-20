import { ArrowUp, Check, Copy, MessageCircleQuestionMark, NotebookPen, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Deck, Slide } from '../../core/deck/types';
import { type ChatMessage, askAboutSlide, slideAiStatus } from './slide-ai';

/** Where the selected text sits on screen, and what it says. */
interface Picked {
  text: string;
  x: number;
  top: number;
  bottom: number;
}

interface Turn extends ChatMessage {
  pending?: boolean;
  error?: boolean;
  inserted?: boolean;
}

const SUGGESTIONS = ['Explain this', 'Give an example', 'Is this accurate?', 'How could I say it more simply?'];
const MAX_SELECTION = 2_000;

/** Text selected on the slide, or in a key notes field. Fields keep their own selection, so they are read first. */
function readSelection(e?: MouseEvent): Picked | null {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && active.type === 'text')) {
    if (!active.closest('.notes-panel')) return null;
    const { selectionStart: s, selectionEnd: end } = active;
    if (s == null || end == null || s === end) return null;
    const box = active.getBoundingClientRect();
    const x = e ? e.clientX : box.left + 40;
    const y = e ? e.clientY : box.top + 20;
    return { text: active.value.slice(s, end), x, top: y - 10, bottom: y + 10 };
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const node = sel.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el?.closest('.stage .stage-slide, .notes-panel')) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return { text: sel.toString(), x: r.left + r.width / 2, top: r.top, bottom: r.bottom };
}

/** Strips the Markdown a model may still use, so replies read as plain text. */
const plain = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^#+\s+/gm, '').trim();

/**
 * Select text on the slide or in its key notes and an "Ask" button appears beside it. It opens a short
 * chat about the selection with the slide as context. Read-only: the only change it makes is
 * "Insert into notes", which the presenter chooses.
 */
export function AskAboutThis({ deck, slide, disabled, onInsert }: { deck: Deck; slide: Slide; disabled?: boolean; onInsert(text: string): void }) {
  const [available, setAvailable] = useState(false);
  const [chip, setChip] = useState<Picked | null>(null);
  const [chat, setChat] = useState<{ selection: string; anchor: Picked; turns: Turn[] } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const live = useRef({ deck, slide });
  live.current = { deck, slide };

  useEffect(() => { slideAiStatus().then((s) => setAvailable(s.available)); }, []);

  const close = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setChat(null);
  }, []);

  // A chat is about one slide.
  useEffect(() => { setChip(null); close(); }, [slide.id, close]);
  useEffect(() => { if (disabled) { setChip(null); close(); } }, [disabled, close]);

  useEffect(() => {
    if (!available || disabled || chat) return;
    const show = (e?: MouseEvent) => {
      // Wait a tick so the selection is final once the click has been handled.
      window.setTimeout(() => {
        const p = readSelection(e);
        setChip(p && p.text.trim().length > 1 ? p : null);
      }, 0);
    };
    const onUp = (e: MouseEvent) => { if (!(e.target as Element | null)?.closest?.('.ask-chip')) show(e); };
    const onKeyUp = (e: KeyboardEvent) => { if (e.shiftKey || e.key === 'Shift') show(); };
    const onDown = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('.ask-chip')) setChip(null); };
    const hide = () => setChip(null);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [available, disabled, chat]);

  const send = useCallback((question: string) => {
    const q = question.trim();
    if (!q || !chat || chat.turns.some((t) => t.pending)) return;
    const history: ChatMessage[] = [...chat.turns.filter((t) => !t.pending && !t.error).map(({ role, text }) => ({ role, text })), { role: 'user', text: q }];
    setChat((c) => c && { ...c, turns: [...c.turns, { role: 'user', text: q }, { role: 'assistant', text: '', pending: true }] });
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const finish = (turn: Turn) => {
      if (ac.signal.aborted) return;
      setChat((c) => c && { ...c, turns: [...c.turns.filter((t) => !t.pending), turn] });
    };
    askAboutSlide(live.current.deck, live.current.slide, chat.selection, history, ac.signal).then(
      (reply) => finish({ role: 'assistant', text: plain(reply) }),
      (e: Error) => { if (e.name !== 'AbortError') finish({ role: 'assistant', text: e.message, error: true }); },
    );
  }, [chat]);

  const open = () => {
    if (!chip) return;
    setChat({ selection: chip.text.trim().slice(0, MAX_SELECTION), anchor: chip, turns: [] });
    setChip(null);
  };

  return createPortal(
    <>
      {chip && !chat && (
        <button
          type="button"
          className="ask-chip"
          style={{ left: Math.round(chip.x), top: Math.round(chip.bottom + 8) }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={open}
          title="Ask AI about the selected text"
        >
          <MessageCircleQuestionMark size={14} /> Ask
        </button>
      )}
      {chat && (
        <AskPopover
          selection={chat.selection}
          anchor={chat.anchor}
          turns={chat.turns}
          onSend={send}
          onClose={close}
          onInsert={(i) => {
            onInsert(chat.turns[i].text);
            setChat((c) => c && { ...c, turns: c.turns.map((t, k) => (k === i ? { ...t, inserted: true } : t)) });
          }}
        />
      )}
    </>,
    document.body,
  );
}

function AskPopover({ selection, anchor, turns, onSend, onClose, onInsert }: {
  selection: string; anchor: Picked; turns: Turn[]; onSend(q: string): void; onClose(): void; onInsert(index: number): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [pos, setPos] = useState({ left: anchor.x - 190, top: anchor.bottom + 10 });
  const [copied, setCopied] = useState(-1);
  const busy = turns.some((t) => t.pending);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(12, Math.min(anchor.x - width / 2, window.innerWidth - width - 12));
    const below = anchor.bottom + 10;
    const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - height - 10);
    setPos({ left, top });
  }, [anchor, turns.length]);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { if (!busy) input.current?.focus(); }, [busy]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [turns]);

  const submit = (q: string) => {
    if (!q.trim() || busy) return;
    onSend(q);
    setDraft('');
  };

  return (
    <div
      ref={ref}
      className="ask-pop"
      role="dialog"
      aria-label="Ask about the selected text"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
    >
      <div className="ask-head">
        <strong><MessageCircleQuestionMark size={15} /> Ask about this</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <blockquote className="ask-quote">{selection}</blockquote>
      <div className="ask-log" ref={log} aria-live="polite">
        {turns.map((t, i) => (
          <div key={i} className={`ask-turn ${t.role} ${t.error ? 'is-error' : ''}`}>
            {t.pending ? <span className="ask-thinking"><span className="spinner" /> Thinking…</span> : <p>{t.text}</p>}
            {t.role === 'assistant' && !t.pending && !t.error && (
              <div className="ask-turn-actions">
                <button type="button" className="btn btn-ghost btn-sm" disabled={t.inserted} onClick={() => onInsert(i)}>
                  {t.inserted ? <><Check size={13} /> Added to notes</> : <><NotebookPen size={13} /> Insert into notes</>}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { navigator.clipboard?.writeText(t.text).then(() => setCopied(i), () => {}); }}
                >
                  {copied === i ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                </button>
              </div>
            )}
          </div>
        ))}
        {!turns.length && (
          <div className="ask-suggest">
            {SUGGESTIONS.map((s) => <button key={s} type="button" className="ai-tone" onClick={() => submit(s)}>{s}</button>)}
          </div>
        )}
      </div>
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); submit(draft); }}>
        <textarea
          ref={input}
          className="textarea"
          rows={2}
          value={draft}
          placeholder={turns.length ? 'Ask a follow-up' : 'Ask anything about this text'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(draft); } }}
          aria-label="Your question"
          maxLength={2000}
        />
        <button type="submit" className="icon-btn ai-send" aria-label="Ask" disabled={busy || !draft.trim()}><ArrowUp size={16} /></button>
      </form>
      <p className="ask-foot faint">Answers don’t change your slide. Insert one into the key notes if it helps.</p>
    </div>
  );
}
