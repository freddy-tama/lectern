// Offline packs: a quiz or a text-only copy of a deck, small enough to travel
// inside a link (and so inside a QR code). The data rides in the URL fragment,
// which browsers never send to a server, so it works without the live connection.

import type { Slide } from '../deck/types';
import { quizItem } from './quiz';

export interface QuizPackItem {
  /** The question. */
  q: string;
  /** Choices. */
  c: string[];
  /** Index of the right choice. */
  a: number;
  /** Explanation shown after answering, when it says more than the choice. */
  e?: string;
}

export interface QuizPack {
  v: 1;
  t: 'quiz';
  title: string;
  items: QuizPackItem[];
}

export interface LiteSlide {
  /** Heading. */
  h: string;
  /** Lines of body text. */
  b: string[];
}

export interface SlidesPack {
  v: 1;
  t: 'slides';
  title: string;
  slides: LiteSlide[];
}

export type Pack = QuizPack | SlidesPack;

/** Longest link we put in a QR code. Past this the code gets too dense to scan from across a room. */
export const QR_MAX = 1600;

export function fitsQr(url: string): boolean {
  return url.length <= QR_MAX;
}

export function packUrl(origin: string, encoded: string): string {
  return `${origin.replace(/\/$/, '')}/pack#${encoded}`;
}

function clean(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** The scored questions of a deck (question slides with a right answer marked). */
export function quizPackFrom(title: string, slides: Pick<Slide, 'id' | 'kind' | 'content' | 'hidden'>[]): QuizPack {
  const items: QuizPackItem[] = [];
  for (const s of slides) {
    if (s.hidden) continue;
    const item = quizItem(s);
    if (!item || !item.question) continue;
    const explain = clean((s.content as { answer?: unknown }).answer);
    const right = item.choices[item.correct] ?? '';
    const said = explain && explain.toLowerCase() !== right.toLowerCase() ? explain : undefined;
    items.push({ q: clean(item.question), c: item.choices.map(clean), a: item.correct, ...(said ? { e: said } : {}) });
  }
  return { v: 1, t: 'quiz', title: clean(title), items };
}

export function isPack(value: unknown): value is Pack {
  const p = value as Pack | null;
  if (!p || p.v !== 1 || typeof p.title !== 'string') return false;
  if (p.t === 'quiz') {
    return Array.isArray(p.items) && p.items.every((i) => typeof i.q === 'string' && Array.isArray(i.c) && i.c.length >= 2 && Number.isInteger(i.a) && i.a >= 0 && i.a < i.c.length);
  }
  if (p.t === 'slides') {
    return Array.isArray(p.slides) && p.slides.every((s) => typeof s.h === 'string' && Array.isArray(s.b));
  }
  return false;
}

// --- Encoding ---------------------------------------------------------------
// "z" + base64url(deflate-raw(json)) where the browser can compress, else "j" + base64url(json).

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Not awaited: the readable side has to be drained at the same time.
  writer.write(bytes as Uint8Array<ArrayBuffer>).then(() => writer.close()).catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export async function encodePack(pack: Pack): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(pack));
  if (typeof CompressionStream !== 'undefined') {
    try { return `z${toBase64Url(await pipe(raw, new CompressionStream('deflate-raw')))}`; } catch { /* fall through */ }
  }
  return `j${toBase64Url(raw)}`;
}

export async function decodePack(encoded: string): Promise<Pack | null> {
  const text = encoded.replace(/^#/, '').trim();
  try {
    let bytes = fromBase64Url(text.slice(1));
    if (text[0] === 'z') {
      if (typeof DecompressionStream === 'undefined') return null;
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    } else if (text[0] !== 'j') {
      return null;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isPack(value) ? value : null;
  } catch {
    return null;
  }
}

// --- Self-scoring -------------------------------------------------------------

export interface PackScore {
  right: number;
  of: number;
  /** 0–100. */
  percent: number;
}

export function scorePack(pack: QuizPack, answers: (number | undefined)[]): PackScore {
  const of = pack.items.length;
  const right = pack.items.reduce((n, item, i) => n + (answers[i] === item.a ? 1 : 0), 0);
  return { right, of, percent: of ? Math.round((right / of) * 100) : 0 };
}
