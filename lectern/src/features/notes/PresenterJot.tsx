// Presenter view: jot a note about the current slide without leaving the presentation.

import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, ChevronUp, NotebookPen } from 'lucide-react';
import type { Deck } from '../../core/deck/types';
import { db } from '../../data/db';
import { notesForSlide } from '../../data/notes';
import { LinkedNotes } from './LinkedNotes';

interface PresenterJotProps {
  deck: Deck;
  slideId: string;
  slideNumber: number;
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function PresenterJot({ deck, slideId, slideNumber, open, onOpenChange }: PresenterJotProps) {
  const lesson = useLiveQuery(async () => (deck.lessonId ? db.lessons.get(deck.lessonId) : undefined), [deck.lessonId]);
  const count = useLiveQuery(() => notesForSlide(deck.id, slideId).then((n) => n.length), [deck.id, slideId]) ?? 0;
  return (
    <section className={`pjot note-dark ${open ? 'is-open' : ''}`} aria-label="Your notes on this slide">
      <button type="button" className="pjot-toggle" aria-expanded={open} onClick={() => onOpenChange(!open)}>
        <NotebookPen size={15} aria-hidden />
        <span>Jot a note</span>
        {count > 0 && <span className="pjot-count">{count} on this slide</span>}
        <kbd>J</kbd>
        {open ? <ChevronDown size={15} aria-hidden /> : <ChevronUp size={15} aria-hidden />}
      </button>
      {open && (
        <div
          className="pjot-body"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            // Keep a half-written note: just hand the keys back to the slides.
            const target = e.target as HTMLElement;
            if (target instanceof HTMLTextAreaElement && target.value.trim()) target.blur();
            else onOpenChange(false);
          }}
        >
          <LinkedNotes
            deckId={deck.id}
            slideId={slideId}
            lessonId={lesson?.id}
            courseId={lesson?.courseId}
            placeholder={`A note on slide ${slideNumber}`}
            autoFocus
            newTab
            max={3}
          />
          <p className="pjot-hint"><kbd>Enter</kbd> saves · <kbd>Esc</kbd> back to the slides · Only you see these</p>
        </div>
      )}
    </section>
  );
}
