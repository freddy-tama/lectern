// After an AI draft: check every slide with the real fonts and fix what doesn't fit before the
// deck is shown (see core/deck/fit). Used by Make a deck and by New deck → With AI. The studio
// picks up a fresh draft's fixes here so one Undo puts the draft back as the AI wrote it.

import { useEffect } from 'react';
import { type FitReport, fitChanged, fitDeck } from '../../core/deck/fit';
import type { Deck } from '../../core/deck/types';
import { loadSlideFonts } from '../../ui/hooks';
import { useToast } from '../../ui/Toast';
import { fitSlide } from './slide-ai';

export interface DraftFit {
  /** The deck with the fixes. */
  deck: Deck;
  /** The draft as the AI wrote it, for Undo. */
  before: Deck;
  report: FitReport;
}

/**
 * Checks a fresh draft and fixes the slides that don't fit: AI first, then a split, then the
 * minutes. `onFixing` runs when there is something to fix, before the first AI call. Stopping
 * (the signal) keeps the fixes made so far.
 */
export async function fitDraft(deck: Deck, o: { signal?: AbortSignal; onFixing?(slides: number): void } = {}): Promise<DraftFit> {
  await loadSlideFonts();
  const { deck: fixed, report } = await fitDeck(deck, {
    signal: o.signal,
    onFixing: o.onFixing,
    fit: (slide, problems) => fitSlide(deck, slide, problems, o.signal),
  });
  return { deck: fixed, before: deck, report };
}

const slides = (n: number) => `${n} slide${n === 1 ? '' : 's'}`;

/** One line for the person: what was fixed, what still doesn't fit. Empty when nothing happened. */
export function fitSummary(report: FitReport, minutes?: number): string {
  const lines: string[] = [];
  if (report.fitted && report.split) lines.push(`Shortened ${slides(report.fitted)} to fit and split ${report.split}.`);
  else if (report.fitted) lines.push(`Shortened ${slides(report.fitted)} to fit.`);
  else if (report.split) lines.push(`Split ${slides(report.split)} that didn’t fit.`);
  if (report.retimed && minutes) lines.push(lines.length ? `Timed to ${minutes} min.` : `Timed the slides to ${minutes} min.`);
  if (report.left) lines.push(`${slides(report.left)} still ${report.left === 1 ? 'doesn’t' : 'don’t'} fit.`);
  return lines.join(' ');
}

// A draft made from the New deck dialog opens in the studio, which owns undo. The dialog leaves
// the fix here and the studio offers Undo once the deck has loaded.
const pending = new Map<string, DraftFit>();

export function handOffDraftFit(fit: DraftFit) {
  if (fitChanged(fit.report) || fit.report.left) pending.set(fit.deck.id, fit);
}

/** In the studio: offers Undo for the fixes made to a fresh draft, once. */
export function useDraftFitNotice(deck: Deck | null | undefined, change: (fn: (d: Deck) => Deck) => void) {
  const toast = useToast();
  const id = deck?.id;
  useEffect(() => {
    if (!id) return;
    const fit = pending.get(id);
    if (!fit) return;
    pending.delete(id);
    const summary = fitSummary(fit.report, fit.deck.minutes);
    if (!summary) return;
    toast.show(summary, fitChanged(fit.report) ? { action: { label: 'Undo', run: () => change(() => fit.before) }, duration: 10_000 } : { duration: 6000 });
  }, [id, change, toast]);
}
