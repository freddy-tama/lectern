// Client for the AI's questions before drafting (api/deck-questions.ts).

import type { Audience, DeckPurpose } from '../../core/deck/types';
import type { Density, RememberedAnswer } from '../../data/profile';
import { savedCode } from '../studio/ai';

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
  const res = await fetch('/api/deck-questions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lectern-code': savedCode() },
    body: JSON.stringify({ ...req, remembered: req.remembered.map(({ key, question, answer }) => ({ key, question, answer })) }),
    signal,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'The AI couldn’t read your files.');
  return {
    title: String(body.title ?? ''),
    topic: String(body.topic ?? ''),
    purpose: body.purpose as DeckPurpose,
    questions: Array.isArray(body.questions) ? (body.questions as AiQuestion[]) : [],
  };
}
