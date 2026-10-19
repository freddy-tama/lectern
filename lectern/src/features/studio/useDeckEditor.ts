import { useCallback, useEffect, useRef, useState } from 'react';
import type { Deck } from '../../core/deck/types';
import { db } from '../../data/db';
import { saveDeck } from '../../data/repo';

type SaveState = 'saved' | 'saving' | 'error';

interface History {
  past: Deck[];
  future: Deck[];
  lastKey: string | null;
  lastAt: number;
}

/**
 * Holds the deck being edited with undo/redo, and saves it shortly after each change.
 * Typing into one field is grouped into a single undo step.
 */
export function useDeckEditor(deckId: string) {
  const [deck, setDeck] = useState<Deck | null | undefined>(undefined);
  const [save, setSave] = useState<SaveState>('saved');
  const history = useRef<History>({ past: [], future: [], lastKey: null, lastAt: 0 });
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<Deck | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    let alive = true;
    history.current = { past: [], future: [], lastKey: null, lastAt: 0 };
    db.decks.get(deckId).then((d) => { if (alive) { setDeck(d ?? null); latest.current = d ?? null; } });
    return () => { alive = false; };
  }, [deckId]);

  const persist = useCallback((next: Deck) => {
    latest.current = next;
    setSave('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      saveDeck(next).then(() => setSave('saved')).catch(() => setSave('error'));
    }, 450);
  }, []);

  // Save immediately when leaving the page.
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    if (latest.current) saveDeck(latest.current).catch(() => {});
  }, []);

  /** Applies a change. Pass a key to group rapid edits of the same field. */
  const change = useCallback((fn: (d: Deck) => Deck, key?: string) => {
    setDeck((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      if (next === prev) return prev;
      const h = history.current;
      const now = Date.now();
      const group = key && h.lastKey === key && now - h.lastAt < 1200;
      if (!group) {
        h.past.push(prev);
        if (h.past.length > 120) h.past.shift();
      }
      h.future = [];
      h.lastKey = key ?? null;
      h.lastAt = now;
      persist(next);
      return next;
    });
  }, [persist]);

  const undo = useCallback(() => {
    setDeck((prev) => {
      const h = history.current;
      const before = h.past.pop();
      if (!prev || !before) return prev;
      h.future.push(prev);
      h.lastKey = null;
      persist(before);
      return before;
    });
    force((n) => n + 1);
  }, [persist]);

  const redo = useCallback(() => {
    setDeck((prev) => {
      const h = history.current;
      const after = h.future.pop();
      if (!prev || !after) return prev;
      h.past.push(prev);
      h.lastKey = null;
      persist(after);
      return after;
    });
    force((n) => n + 1);
  }, [persist]);

  return {
    deck,
    change,
    undo,
    redo,
    canUndo: history.current.past.length > 0,
    canRedo: history.current.future.length > 0,
    save,
  };
}
