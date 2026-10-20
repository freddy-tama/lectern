// Client side of /api/deck-assistant: one turn of the deck assistant, streamed as step cards and ending with the
// proposals. The conversation is kept here exactly as the server returns it and only ever appended to.

import type { Deck } from '../../core/deck/types';
import { draftingHints } from '../../core/plugins/registry';
import { savedCode } from './ai';
import { type DeckOp, assistantKinds, assistantSnapshot } from './deck-ops';
import { SlideAiError } from './slide-ai';

const ENDPOINT = '/api/deck-assistant';

/** A message of the conversation as the API takes it. Kept opaque: it goes back to the server unchanged. */
export type HistoryMessage = { role: 'user' | 'assistant'; content: unknown };

export interface StepCard {
  id: string;
  name: string;
  label: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
}

export interface TurnResult {
  ops: DeckOp[];
  summary: string;
  history: HistoryMessage[];
  stopped?: 'steps' | 'time' | 'length' | 'refusal';
}

export type AssistantEvent =
  | { type: 'step'; step: number }
  | ({ type: 'tool' } & StepCard)
  | ({ type: 'done' } & TurnResult)
  | { type: 'error'; error: string };

let status: Promise<{ available: boolean; needsCode: boolean }> | null = null;

/** Whether the server has the assistant set up. Asked once per session; a failed check is asked again. */
export function assistantStatus() {
  status ??= fetch(ENDPOINT, { method: 'GET' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: { available?: boolean; needsCode?: boolean }) => ({ available: Boolean(j.available), needsCode: Boolean(j.needsCode) }))
    .catch(() => {
      status = null;
      return { available: false, needsCode: false };
    });
  return status;
}

/** Above this the request nears Vercel's 4.5 MB limit: the chat has to start over. */
export const MAX_HISTORY_BYTES = 3_000_000;

export interface TurnRequest {
  request: string;
  history: HistoryMessage[];
  deck: Deck;
  plannedMinutes?: number;
  /** Send the slide types again: on the first turn, and when mods changed since the last. */
  withKinds: boolean;
  since?: { proposed: number; applied: number };
}

/** The events in a chunk of an event stream, and what is left over for the next chunk. */
export function readEvents(buffer: string): { events: AssistantEvent[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const events = parts.flatMap((part) => {
    const data = part.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data) return [];
    try { return [JSON.parse(data) as AssistantEvent]; } catch { return []; }
  });
  return { events, rest };
}

/**
 * Runs one turn. Step cards arrive through `onEvent` as the assistant works; the promise settles with the
 * proposals. Nothing in the deck changes here.
 */
export async function runAssistantTurn(req: TurnRequest, onEvent: (e: AssistantEvent) => void, signal?: AbortSignal): Promise<TurnResult> {
  const body = JSON.stringify({
    request: req.request,
    history: req.history,
    deck: assistantSnapshot(req.deck, req.plannedMinutes),
    kinds: assistantKinds(),
    withKinds: req.withKinds,
    hints: draftingHints(),
    ...(req.since ? { since: req.since } : {}),
  });
  let res: Response;
  try {
    res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lectern-code': savedCode() }, body, signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new SlideAiError('Couldn’t reach the server. Check your connection and try again.');
  }
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    throw new SlideAiError(typeof json.error === 'string' ? json.error : 'The assistant couldn’t start. Try again.', res.status === 401);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const { events, rest } = readEvents(done ? `${buffer}\n\n` : buffer);
    buffer = rest;
    for (const e of events) {
      if (e.type === 'error') throw new SlideAiError(e.error);
      onEvent(e);
      if (e.type === 'done') return { ops: e.ops, summary: e.summary, history: e.history, ...(e.stopped ? { stopped: e.stopped } : {}) };
    }
    if (done) break;
  }
  throw new SlideAiError('The connection closed before the assistant finished. Try again.');
}
