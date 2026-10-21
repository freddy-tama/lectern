// Client for the AI's questions before drafting (api/deck-questions.ts), and for drafting a
// deck as an outline and then batches of slides (api/draft-deck.ts).

import type { Audience, DeckPurpose } from '../../core/deck/types';
import type { DraftRequest, PlannedSlide, WrittenSlide } from '../../data/draft-jobs';
import type { Density, RememberedAnswer } from '../../data/profile';
import { aiPost } from '../account/session';
import { type CallUsage, readUsage } from './usage';

export interface AiQuestion {
  key: string;
  question: string;
  options: string[];
  multiple: boolean;
  /** A lasting preference the person may want kept for future decks. */
  remember: boolean;
}

export interface QuestionsResult {
  title: string;
  topic: string;
  purpose: DeckPurpose;
  questions: AiQuestion[];
}

export interface QuestionsRequest {
  brief: string;
  excerpt: string;
  files: { name: string; kind: string; words: number }[];
  purpose: DeckPurpose;
  audience: Audience;
  minutes: number;
  density: Density;
  pictures: number;
  remembered: RememberedAnswer[];
}

export async function fetchQuestions(req: QuestionsRequest, signal?: AbortSignal): Promise<QuestionsResult> {
  const res = await aiPost('/api/deck-questions', JSON.stringify({ ...req, remembered: req.remembered.map(({ key, question, answer }) => ({ key, question, answer })) }), signal);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'The AI couldn’t read your files.');
  return {
    title: String(body.title ?? ''),
    topic: String(body.topic ?? ''),
    purpose: body.purpose as DeckPurpose,
    questions: Array.isArray(body.questions) ? (body.questions as AiQuestion[]) : [],
  };
}

/** A drafting call failed. `code` comes from the server ("refused", "too_long", "needs_code", …) or is "network". */
export class DraftCallError extends Error {
  override name = 'DraftCallError';
  constructor(message: string, readonly code: string, readonly status: number, readonly usage: CallUsage[] = []) {
    super(message);
  }
}

/** Errors that no retry will fix: the whole job stops until the person acts. */
export const STOPS_THE_JOB = new Set(['off', 'needs_code', 'auth', 'bad_request']);

async function postDraft(body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await aiPost('/api/draft-deck', JSON.stringify(body), signal);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new DraftCallError('Lectern couldn’t reach the server. Check your connection, then try again.', 'network', 0);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof data.error === 'string' ? data.error : 'The AI draft failed. Try again.';
    throw new DraftCallError(message, typeof data.code === 'string' ? data.code : 'service', res.status, readUsage(data.usage));
  }
  return data;
}

const asText = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

function readOutline(raw: unknown): Omit<PlannedSlide, 'id'>[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    return {
      title: asText(o.title, 200),
      kind: asText(o.kind, 60),
      minutes: Number(o.minutes) || 2,
      point: asText(o.point, 300),
      pictures: Array.isArray(o.pictures) ? o.pictures.filter((p): p is string => typeof p === 'string') : [],
    };
  }).filter((s) => s.kind);
}

/** Plans the deck: each slide's heading, type, minutes, point and pictures. This call also writes the prompt cache. */
export async function draftOutline(request: DraftRequest, signal?: AbortSignal) {
  const data = await postDraft({ ...request, mode: 'outline' }, signal);
  return { title: asText(data.title, 200), outline: readOutline(data.outline), usage: readUsage(data.usage) };
}

/**
 * Writes some slides of an approved outline. `request` must be the one the outline was made
 * from, unchanged, so the call reads the cached prompt; the edited outline travels beside it.
 */
export async function draftSlides(request: DraftRequest, outline: { title: string; slides: Omit<PlannedSlide, 'id'>[] }, numbers: number[], signal?: AbortSignal) {
  const data = await postDraft({ ...request, mode: 'slides', outline, numbers }, signal);
  const slides = (Array.isArray(data.slides) ? data.slides : []).flatMap((s): WrittenSlide[] => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const number = Number(o.number);
    if (!Number.isInteger(number) || typeof o.kind !== 'string') return [];
    return [{ number, kind: o.kind, content: (o.content ?? {}) as Record<string, unknown>, notes: (o.notes ?? {}) as WrittenSlide['notes'] }];
  });
  const missing = Array.isArray(data.missing) ? data.missing.map(Number).filter(Number.isInteger) : [];
  return { slides, missing, usage: readUsage(data.usage) };
}
