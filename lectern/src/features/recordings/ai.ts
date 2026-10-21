// Client for the optional AI step: class notes from a transcript (api/lecture-notes.ts).

import type { LectureNotes } from '../../core/transcribe/types';
import { aiPost } from '../account/session';

export interface NotesAiStatus {
  available: boolean;
  needsCode: boolean;
}

let status: Promise<NotesAiStatus> | null = null;

/** Asks the server whether AI class notes are set up. Cached for the session. */
export function notesAiStatus(): Promise<NotesAiStatus> {
  status ??= fetch('/api/lecture-notes', { method: 'GET' })
    .then((r) => (r.ok && /json/.test(r.headers.get('content-type') ?? '') ? r.json() : { available: false }))
    .then((j: Partial<NotesAiStatus>) => ({ available: Boolean(j.available), needsCode: Boolean(j.needsCode) }))
    .catch(() => ({ available: false, needsCode: false }));
  return status;
}

export interface NotesRequest {
  transcript: string;
  title?: string;
  course?: string;
  lesson?: string;
  language?: string;
}

/** The longest transcript the server takes in one go (characters). */
export const MAX_TRANSCRIPT = 300_000;

export async function makeClassNotes(req: NotesRequest, signal?: AbortSignal): Promise<LectureNotes> {
  const res = await aiPost('/api/lecture-notes', JSON.stringify(req), signal);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Class notes couldn’t be made. Try again.');
  return { ...(body.notes as LectureNotes), createdAt: Date.now() };
}
