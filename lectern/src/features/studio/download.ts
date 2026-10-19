import type { Deck } from '../../core/deck/types';
import { imageDataUrl } from '../../data/repo';

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

export async function exportPptx(deck: Deck, steps: 'animate' | 'build' | 'final' = 'animate') {
  const { exportDeckToPptx } = await import('../../core/export/pptx');
  const result = await exportDeckToPptx(deck, { steps, includeNotes: true, resolveImage: imageDataUrl, output: 'blob' });
  downloadBlob(result.data as Blob, result.fileName);
  return result.warnings;
}

export function exportJson(deck: Deck) {
  const data = new Blob([JSON.stringify({ format: 'lectern-deck', version: 1, deck }, null, 2)], { type: 'application/json' });
  downloadBlob(data, `${safeName(deck.title)}.lectern.json`);
}
