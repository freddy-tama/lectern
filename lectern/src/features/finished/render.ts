// Turns a PDF of a finished deck, or pictures of its slides, into slide pictures: each page
// drawn whole at presentation size, as the audience will see it. PDF.js loads only here.

import type { PageInfo } from '../../core/import/finished';

export interface SlidePicture extends PageInfo {
  blob: Blob;
  width: number;
  height: number;
}

/** Slides are drawn to fit 1920 × 1080, the canvas every Lectern slide uses. */
const MAX_W = 1920;
const MAX_H = 1080;
const MAX_PAGES = 300;
const QUALITY = 0.88;

function canvasBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The slide picture could not be made.'))), type, quality);
  });
}

function sizeFor(width: number, height: number, maxW = MAX_W, maxH = MAX_H) {
  const scale = Math.min(maxW / width, maxH / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

async function openPdf(buffer: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  // PDF.js takes the bytes over: keep the caller's copy usable.
  return pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
}

/** How many pages a PDF has. */
export async function pdfPageCount(buffer: ArrayBuffer): Promise<number> {
  const pdf = await openPdf(buffer);
  try { return pdf.numPages; } finally { await pdf.destroy(); }
}

/** Every page of a PDF as a slide picture, with the page's text. */
export async function pdfPictures(buffer: ArrayBuffer, onPage?: (done: number, total: number) => void, signal?: AbortSignal): Promise<SlidePicture[]> {
  const pdf = await openPdf(buffer);
  const out: SlidePicture[] = [];
  try {
    const total = Math.min(pdf.numPages, MAX_PAGES);
    for (let n = 1; n <= total; n++) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const { width, height, scale } = sizeFor(base.width, base.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser can’t draw slide pictures.');
      // PDF pages have no background of their own; slides are seen on white.
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : ''))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
      out.push({ blob: await canvasBlob(canvas), width, height, text });
      canvas.width = canvas.height = 0;
      page.cleanup();
      onPage?.(n, total);
    }
  } finally {
    await pdf.destroy();
  }
  return out;
}

/** "Slide10.PNG" after "Slide9.PNG": names compared with their numbers as numbers. */
export function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

async function drawScaled(blob: Blob, maxW: number, maxH: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = sizeFor(bitmap.width, bitmap.height, maxW, maxH);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser can’t draw slide pictures.');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas;
}

/** Pictures of slides (PowerPoint's "Export → PNG"), in file-name order, at presentation size. */
export async function imagePictures(files: File[], onPage?: (done: number, total: number) => void): Promise<SlidePicture[]> {
  const sorted = [...files].sort(byName);
  const out: SlidePicture[] = [];
  for (const [i, file] of sorted.entries()) {
    const canvas = await drawScaled(file, MAX_W, MAX_H);
    out.push({ blob: await canvasBlob(canvas), width: canvas.width, height: canvas.height, text: '' });
    onPage?.(i + 1, sorted.length);
  }
  return out;
}

/** A small copy of a slide picture for the AI to look at, as a base64 JPEG. */
export async function aiCopy(blob: Blob, width = 1024): Promise<string> {
  const canvas = await drawScaled(blob, width, Math.round((width * 9) / 16));
  const small = await canvasBlob(canvas, 'image/jpeg', 0.72);
  const bytes = new Uint8Array(await small.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
