// Studio: a button showing how many of your notes are about the current slide, with a popover to read and add them.

import { useLiveQuery } from 'dexie-react-hooks';
import { NotebookPen, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { notesForSlide } from '../../data/notes';
import { LinkedNotes } from './LinkedNotes';

interface SlideNotesButtonProps {
  deckId: string;
  slideId: string;
  slideNumber: number;
  lessonId?: string;
  courseId?: string;
}

export function SlideNotesButton({ deckId, slideId, slideNumber, lessonId, courseId }: SlideNotesButtonProps) {
  const count = useLiveQuery(() => notesForSlide(deckId, slideId).then((n) => n.length), [deckId, slideId]) ?? 0;
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const close = (focus = true) => {
    setAnchor(null);
    if (focus) buttonRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!anchor || !popRef.current) return;
    const m = popRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.right - m.width, window.innerWidth - m.width - 8));
    let top = anchor.bottom + 6;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, anchor.top - m.height - 6);
    setPos({ top, left });
  }, [anchor, count]);

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !buttonRef.current?.contains(t)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      // A half-written note survives the first Escape.
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement && popRef.current?.contains(active) && active.value.trim()) active.blur();
      else close();
    };
    const onResize = () => close(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [anchor]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn-ghost btn-sm nt-slide-btn ${count ? 'has-notes' : ''}`}
        aria-expanded={Boolean(anchor)}
        aria-haspopup="dialog"
        title="Your own notes on this slide. They aren’t shown when presenting."
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor((a) => (a ? null : rect));
        }}
      >
        <NotebookPen size={14} /> My notes
        {count > 0 && <span className="nt-badge tabular">{count}</span>}
      </button>
      {anchor && createPortal(
        <div ref={popRef} className="menu nt-pop" role="dialog" aria-label={`Your notes on slide ${slideNumber}`} style={{ top: pos.top, left: pos.left }}>
          <div className="nt-pop-head">
            <div>
              <strong>Notes on slide {slideNumber}</strong>
              <span className="faint">Plans, fixes and ideas. Separate from key notes.</span>
            </div>
            <button type="button" className="icon-btn" onClick={() => close()} aria-label="Close"><X size={16} /></button>
          </div>
          <LinkedNotes
            deckId={deckId}
            slideId={slideId}
            lessonId={lessonId}
            courseId={courseId}
            placeholder="Add a note about this slide"
            autoFocus
            max={4}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
