import type { Deck } from '../../core/deck/types';
import { deckPictures, pictureLine } from '../../core/pictures/credits';
import { DECK_FILE_EXT, buildDeckFile } from '../../data/deck-file';
import { imageDataUrl } from '../../data/repo';
import { pictureCredits } from '../pictures/store';

export function downloadBlob(data: Blob, fileName: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeName(title: string) {
  return title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Deck';
}

/** A credit line for each picture in the deck, for the PowerPoint speaker notes. */
async function deckCreditLines(deck: Deck): Promise<Record<string, string>> {
  const refs = deckPictures(deck).map((u) => u.ref);
  const credits = await pictureCredits(refs);
  return Object.fromEntries(refs.map((ref) => [ref, pictureLine(ref, credits.get(ref))]).filter(([, line]) => line));
}

export async function exportPptx(deck: Deck, steps: 'animate' | 'build' | 'final' = 'animate') {
  const { exportDeckToPptx } = await import('../../core/export/pptx');
  const credits = await deckCreditLines(deck).catch(() => ({}));
  const result = await exportDeckToPptx(deck, { steps, includeNotes: true, resolveImage: imageDataUrl, output: 'blob', credits });
  downloadBlob(result.data as Blob, result.fileName);
  return result.warnings;
}

/** Saves the deck with its pictures and look as a .lectern.json file that opens again in any browser. */
export async function exportJson(deck: Deck) {
  const built = await buildDeckFile(deck);
  downloadBlob(new Blob([JSON.stringify(built.file, null, 2)], { type: 'application/json' }), `${safeName(deck.title)}${DECK_FILE_EXT}`);
  return built;
}
