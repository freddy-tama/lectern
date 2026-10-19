import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { layoutSlide } from '../../core/engine/layout';
import { getTheme } from '../../core/engine/themes';
import { db } from '../../data/db';
import { useFontsReady } from '../../ui/hooks';

/** The deck as stored, live: edits in the studio show up in open presentations. */
export function useLiveDeck(deckId: string) {
  const deck = useLiveQuery(() => db.decks.get(deckId).then((d) => d ?? null), [deckId]);
  const fonts = useFontsReady();
  const slides = useMemo(() => deck?.slides.filter((s) => !s.hidden) ?? [], [deck]);
  /** Reveal steps per visible slide. */
  const steps = useMemo(() => {
    if (!deck) return [];
    const theme = getTheme(deck.themeId);
    return slides.map((s, i) => layoutSlide(s, { theme, audience: deck.audience, slideNumber: i + 1, slideCount: slides.length }).steps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, slides, fonts]);
  return { deck, slides, steps };
}

/** Moves forward one reveal step, or to the next slide. */
export function advance(state: { index: number; step: number }, steps: number[], count: number) {
  const max = steps[state.index] ?? 0;
  if (state.step < max) return { index: state.index, step: state.step + 1 };
  if (state.index < count - 1) return { index: state.index + 1, step: 0 };
  return state;
}

/** Moves back one reveal step, or to the end of the previous slide. */
export function retreat(state: { index: number; step: number }, steps: number[]) {
  if (state.step > 0) return { index: state.index, step: state.step - 1 };
  if (state.index > 0) return { index: state.index - 1, step: steps[state.index - 1] ?? 0 };
  return state;
}
