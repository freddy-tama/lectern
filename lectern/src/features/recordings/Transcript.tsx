// The transcript: timed paragraphs that follow the audio. Click a time or a sentence to
// jump there; edit a paragraph's lines in place; search highlights every match.

import { Check, Pencil, X } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { type Match, highlightRuns, paragraphs } from '../../core/transcribe/segments';
import { clock } from '../../core/transcribe/time';
import type { TranscriptSegment } from '../../core/transcribe/types';
import { editSegments } from '../../data/recordings';

export interface Selection {
  text: string;
  /** Start of the first selected segment, seconds. */
  at?: number;
}

interface TranscriptProps {
  recordingId: string;
  segments: TranscriptSegment[];
  active: number;
  matches: Match[];
  currentMatch: number;
  onSeek(seconds: number): void;
  onSelection(selection: Selection | null): void;
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Scrolls an element into the comfortable middle of the window when it's out of view. */
export function revealInView(el: Element | null, force = false) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const top = 90;
  const bottom = window.innerHeight - 150;
  if (force || r.top < top || r.bottom > bottom) el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

export const Transcript = memo(function Transcript({ recordingId, segments, active, matches, currentMatch, onSeek, onSelection }: TranscriptProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ para: number; focus: number } | null>(null);
  const paras = useMemo(() => paragraphs(segments), [segments]);

  const bySegment = useMemo(() => {
    const map = new Map<number, { from: number; to: number; key: number }[]>();
    matches.forEach((m, key) => map.set(m.segment, [...(map.get(m.segment) ?? []), { from: m.from, to: m.to, key }]));
    return map;
  }, [matches]);

  // Report text selected inside the transcript, for "Save selection as note".
  useEffect(() => {
    const onChange = () => {
      const sel = window.getSelection();
      const root = ref.current;
      if (!sel || sel.isCollapsed || !root || !sel.anchorNode || !root.contains(sel.anchorNode)) {
        onSelection(null);
        return;
      }
      const text = sel.toString().trim();
      const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement;
      const seg = Number(node?.closest('[data-seg]')?.getAttribute('data-seg'));
      onSelection(text ? { text, at: Number.isFinite(seg) ? segments[seg]?.start : undefined } : null);
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [onSelection, segments]);

  const onClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-seg]');
    if (!target || !window.getSelection()?.isCollapsed) return;
    const seg = segments[Number(target.dataset.seg)];
    if (seg) onSeek(seg.start);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-seg]');
    const para = Number(target?.closest<HTMLElement>('[data-para]')?.dataset.para);
    if (!target || !Number.isFinite(para)) return;
    window.getSelection()?.removeAllRanges();
    setEditing({ para, focus: Number(target.dataset.seg) });
  };

  return (
    <div className="rc-transcript" ref={ref} onClick={onClick} onDoubleClick={onDoubleClick}>
      {paras.map((p, pi) => {
        const live = active >= p.indexes[0]! && active <= p.indexes[p.indexes.length - 1]!;
        if (editing?.para === pi) {
          return (
            <ParagraphEditor
              key={`e${p.start}`}
              recordingId={recordingId}
              segments={segments}
              indexes={p.indexes}
              focus={editing.focus}
              onSeek={onSeek}
              onDone={() => setEditing(null)}
            />
          );
        }
        return (
          <div key={`${p.start}-${p.indexes[0]}`} className={`rc-para ${live ? 'is-live' : ''}`} data-para={pi}>
            <div className="rc-para-side">
              <button type="button" className="rc-stamp tabular" onClick={(e) => { e.stopPropagation(); onSeek(p.start); }} aria-label={`Play from ${clock(p.start)}`}>
                {clock(p.start)}
              </button>
              <button type="button" className="icon-btn rc-para-edit" onClick={(e) => { e.stopPropagation(); setEditing({ para: pi, focus: p.indexes[0]! }); }} aria-label={`Edit the paragraph at ${clock(p.start)}`} title="Edit">
                <Pencil size={14} />
              </button>
            </div>
            <p className="rc-para-text">
              {p.indexes.map((i) => {
                const s = segments[i]!;
                const runs = highlightRuns(s.text, bySegment.get(i) ?? []);
                return (
                  <span key={i} data-seg={i} className={`rc-seg ${i === active ? 'is-active' : ''}`}>
                    {runs.map((r, ri) => (r.mark === undefined ? r.text : (
                      <mark key={ri} className={r.mark === currentMatch ? 'is-current' : undefined} data-match={r.mark}>{r.text}</mark>
                    )))}{' '}
                  </span>
                );
              })}
            </p>
          </div>
        );
      })}
    </div>
  );
});

/** Grows a textarea to fit its text. */
function fit(t: HTMLTextAreaElement) {
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight + 2}px`;
}

function ParagraphEditor({ recordingId, segments, indexes, focus, onSeek, onDone }: {
  recordingId: string;
  segments: TranscriptSegment[];
  indexes: number[];
  focus: number;
  onSeek(seconds: number): void;
  onDone(): void;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>(() => Object.fromEntries(indexes.map((i) => [i, segments[i]!.text])));
  const first = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.querySelectorAll('textarea').forEach(fit);
    const el = first.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const save = async () => {
    const changed = Object.fromEntries(Object.entries(drafts).filter(([i, t]) => t.trim() !== segments[Number(i)]?.text));
    if (Object.keys(changed).length) await editSegments(recordingId, changed);
    onDone();
  };

  return (
    <div
      ref={box}
      className="rc-para is-editing"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(); }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save(); }
      }}
    >
      <div className="rc-edit-rows">
        {indexes.map((i) => (
          <div key={i} className="rc-edit-row">
            <button type="button" className="rc-stamp tabular" onClick={() => onSeek(segments[i]!.start)} aria-label={`Play from ${clock(segments[i]!.start)}`}>{clock(segments[i]!.start)}</button>
            <textarea
              ref={i === focus ? first : undefined}
              className="textarea rc-edit-text"
              rows={1}
              value={drafts[i] ?? ''}
              aria-label={`Text at ${clock(segments[i]!.start)}`}
              onChange={(e) => setDrafts((d) => ({ ...d, [i]: e.target.value }))}
              onInput={(e) => fit(e.currentTarget)}
            />
          </div>
        ))}
      </div>
      <div className="rc-edit-actions">
        <span className="faint">Enter to save · Esc to cancel · empty a line to remove it</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}><X size={15} /> Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()}><Check size={15} /> Save</button>
      </div>
    </div>
  );
}
