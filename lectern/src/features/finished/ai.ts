// Client for teleprompter notes on a finished deck (api/teleprompter.ts): sends the slides a
// few at a time, two calls at once, with small copies of their pictures, and puts the notes
// and quizzes that come back into the deck.

import type { CallUsage } from '../../core/ai/prices';
import { findQuestion } from '../../core/import/finished';
import { type Deck, type Slide, deckPurpose } from '../../core/deck/types';
import { db } from '../../data/db';
import { aiPost, aiStatus } from '../account/session';
import { readUsage } from '../autodeck/usage';
import { aiCopy } from './render';

export interface NotesStatus {
  available: boolean;
  needsCode: boolean;
}

let status: Promise<NotesStatus> | null = null;

/** Asks the server whether AI notes are set up. Cached for the session. */
export function notesStatus(): Promise<NotesStatus> {
  status ??= aiStatus('/api/teleprompter')
    .then((r) => (r.ok && /json/.test(r.headers.get('content-type') ?? '') ? r.json() : { available: false }))
    .then((j: Partial<NotesStatus>) => ({ available: Boolean(j.available), needsCode: Boolean(j.needsCode) }))
    .catch(() => ({ available: false, needsCode: false }));
  return status;
}

/** What the server sends back for one slide. */
export interface SlideNotes {
  id: string;
  script: string;
  keyPoints: string[];
  cues: string[];
  minutes: number;
  quiz: { question: string; options: string[]; correct: number } | null;
}

export const BATCH = 6;
const AT_ONCE = 2;

const str = (c: Record<string, unknown>, key: string) => (typeof c[key] === 'string' ? (c[key] as string) : '');

/** The speaker notes the slide came with, kept when it was imported. */
export function speakerNotes(slide: Slide): string {
  return slide.notes.extra?.pptx?.notes ?? '';
}

/** Puts notes and quizzes into the deck. Slides without an answer keep what they had. */
export function applyNotes(deck: Deck, notes: SlideNotes[], quizzes: boolean): Deck {
  const byId = new Map(notes.map((n) => [n.id, n]));
  return {
    ...deck,
    slides: deck.slides.map((s) => {
      const n = byId.get(s.id);
      if (!n) return s;
      const quiz = quizzes && s.kind === 'designed'
        ? { question: n.quiz?.question ?? '', options: n.quiz?.options ?? [], correct: n.quiz?.correct ?? -1 }
        : {};
      return {
        ...s,
        content: { ...s.content, ...quiz },
        notes: { ...s.notes, script: n.script || s.notes.script, keyPoints: n.keyPoints, cues: n.cues, minutes: n.minutes },
      };
    }),
  };
}

async function picture(slide: Slide): Promise<string> {
  const ref = str(slide.content, 'image');
  if (!ref.startsWith('asset:')) return '';
  const asset = await db.assets.get(ref.slice(6));
  return asset ? aiCopy(asset.blob).catch(() => '') : '';
}

async function callBatch(deck: Deck, batch: { slide: Slide; n: number }[], o: WriteOptions): Promise<{ notes: SlideNotes[]; usage: CallUsage[] }> {
  const slides = await Promise.all(batch.map(async ({ slide, n }) => {
    const c = slide.content;
    return {
      id: slide.id,
      n,
      title: str(c, 'title'),
      text: str(c, 'text'),
      notes: speakerNotes(slide) || slide.notes.script,
      found: str(c, 'question') ? { question: str(c, 'question'), options: c.options, correct: c.correct } : findQuestion(str(c, 'text'), speakerNotes(slide)),
      image: await picture(slide),
    };
  }));
  const outline = deck.slides.filter((s) => !s.hidden).map((s, i) => ({ n: i + 1, title: str(s.content, 'title') }));
  const body = { title: deck.title, purpose: deckPurpose(deck), audience: deck.audience, outline, slides, quizzes: o.quizzes, ...(o.model ? { model: o.model } : {}) };
  const res = await aiPost('/api/teleprompter', JSON.stringify(body), o.signal);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(typeof out.error === 'string' ? out.error : 'The notes couldn’t be written. Try again.'), { usage: readUsage(out.usage) });
  return { notes: Array.isArray(out.slides) ? out.slides as SlideNotes[] : [], usage: readUsage(out.usage) };
}

export interface WriteOptions {
  quizzes: boolean;
  /** For comparing models: "opus" or "sonnet". The server picks otherwise. */
  model?: 'opus' | 'sonnet';
  signal?: AbortSignal;
  onProgress?(done: number, total: number): void;
}

export interface WriteResult {
  deck: Deck;
  usage: CallUsage[];
  /** Slides whose notes couldn't be written. */
  missed: number;
  /** The first error, when some calls failed. */
  error?: string;
}

/** Writes teleprompter notes for every visible slide of a deck. Never throws for a failed call: the slides keep their own notes. */
export async function writeNotes(deck: Deck, o: WriteOptions): Promise<WriteResult> {
  const visible = deck.slides.filter((s) => !s.hidden).map((slide, i) => ({ slide, n: i + 1 }));
  const batches: (typeof visible)[] = [];
  for (let i = 0; i < visible.length; i += BATCH) batches.push(visible.slice(i, i + BATCH));
  const notes: SlideNotes[] = [];
  const usage: CallUsage[] = [];
  let done = 0;
  let error: string | undefined;
  o.onProgress?.(0, visible.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++]!;
      try {
        const got = await callBatch(deck, batch, o);
        notes.push(...got.notes);
        usage.push(...got.usage);
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        error ??= (e as Error).message;
        usage.push(...((e as { usage?: CallUsage[] }).usage ?? []));
      }
      done += batch.length;
      o.onProgress?.(done, visible.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, batches.length) }, worker));
  const answered = new Set(notes.map((n) => n.id));
  return { deck: applyNotes(deck, notes, o.quizzes), usage, missed: visible.filter((v) => !answered.has(v.slide.id)).length, ...(error ? { error } : {}) };
}
