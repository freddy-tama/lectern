// Notes to a finished deck, offline: the outline parser, starter key notes and,
// with Auto chosen, the look and layouts that suit the deck. The New deck dialog
// and the front page's "From notes" both build through here, so they can't drift.

import { autoVariants, suggestLook } from './auto-style';
import { draftToDeck } from './draft';
import { outlineSlides, outlineToDraft } from './outline';
import type { Audience, Deck, DeckPurpose } from './types';

/** The look choice that turns on auto style. */
export const AUTO_LOOK = 'auto';

/** Most slides notesToDeck makes unless told otherwise. */
export const MAX_NOTES_SLIDES = 24;

/** With Auto chosen, the deck gets the look that suits it and auto style for its layouts. */
export function styleDeck(deck: Deck, look: string): Deck {
  if (look !== AUTO_LOOK) return deck;
  return autoVariants({ ...deck, themeId: suggestLook(deck), autoStyle: true });
}

export function notesToDeck(text: string, o: {
  audience: Audience;
  purpose: DeckPurpose;
  /** A theme id, or 'auto'. */
  look: string;
  /** Keeps the deck's id the same across calls, so saving again updates one deck. */
  id?: string;
  /** The deck's title when the notes have none. */
  fallbackTitle?: string;
  /** Replaces the title taken from the notes, when not blank. */
  title?: string;
  lessonId?: string;
  /** Defaults to MAX_NOTES_SLIDES; pass Infinity for no limit. */
  maxSlides?: number;
}): Deck {
  const draft = outlineToDraft(text, o.fallbackTitle ?? 'Untitled deck');
  const max = o.maxSlides ?? MAX_NOTES_SLIDES;
  const deck = styleDeck(draftToDeck(
    { ...draft, title: o.title?.trim() || draft.title, slides: draft.slides.slice(0, max) },
    { audience: o.audience, themeId: o.look, lessonId: o.lessonId, purpose: o.purpose },
  ), o.look);
  return o.id ? { ...deck, id: o.id } : deck;
}

/**
 * The index in notesToDeck(text).slides of the slide the caret is writing: 0 on the title,
 * then the slide whose part of the notes holds the caret's line. Callers clamp it to the
 * deck's slide count, which notesToDeck may have capped.
 */
export function slideAtCaret(text: string, caret: number): number {
  const lead = text.length - text.trimStart().length;
  const line = text.trim().slice(0, Math.max(0, caret - lead)).replace(/\r\n?/g, '\n').split('\n').length - 1;
  const { lines } = outlineSlides(text);
  let at = 0;
  let previous = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] > line) break;
    // Slides from one part of the notes (each key term, say) share its first line: take the first.
    if (lines[i] !== previous) at = i;
    previous = lines[i];
  }
  return at;
}
