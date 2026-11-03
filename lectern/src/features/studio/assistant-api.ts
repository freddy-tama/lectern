// Client side of /api/deck-assistant: one request of the deck assistant. The loop (./agent/loop.ts) runs here,
// calling the server once per step; this file is the server call and the request the panel makes.

import { aiPost, refreshCreditsSoon } from '../account/session';
import { type CallEvent, type CallModel, type HistoryMessage, type LoopEvent, type StepCard, type TurnInput, type TurnResult, runTurn } from './agent/loop';
import { SlideAiError } from './slide-ai';

export type { HistoryMessage, StepCard, TurnResult };

const ENDPOINT = '/api/deck-assistant';

export type AssistantEvent = LoopEvent;

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

/** Above this the chat (without its slide pictures) nears Vercel's 4.5 MB limit: it has to start over. */
export const MAX_HISTORY_BYTES = 3_000_000;

export type TurnRequest = TurnInput;

type ServerEvent = CallEvent | { type: 'error'; error: string };

/** The events in a chunk of an event stream, and what is left over for the next chunk. */
export function readEvents(buffer: string): { events: ServerEvent[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const events = parts.flatMap((part) => {
    const data = part.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data) return [];
    try { return [JSON.parse(data) as ServerEvent]; } catch { return []; }
  });
  return { events, rest };
}

/** One model call through the server, streamed: step cards as tool calls start, then the reply. */
export const callModel: CallModel = async (body, onTool, signal) => {
  let res: Response;
  try {
    res = await aiPost(ENDPOINT, JSON.stringify(body), signal);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new SlideAiError('Couldn’t reach the server. Check your connection and try again.');
  }
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    throw new SlideAiError(typeof json.error === 'string' ? json.error : 'The assistant couldn’t start. Try again.', res.status === 401 && json.code !== 'sign_in');
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
      if (e.type === 'tool') onTool(e);
      if (e.type === 'message') return e;
    }
    if (done) break;
  }
  throw new SlideAiError('The connection closed before the assistant finished. Try again.');
};

/**
 * Runs one request. Step cards arrive through `onEvent` as the assistant works; the promise settles with the
 * proposals. Nothing in the deck changes here.
 */
export async function runAssistantTurn(req: TurnRequest, onEvent: (e: AssistantEvent) => void, signal?: AbortSignal, call: CallModel = callModel): Promise<TurnResult> {
  try {
    return await runTurn(req, call, onEvent, signal);
  } finally {
    // Every step was charged as it finished; the balance is read once the request is over.
    refreshCreditsSoon();
  }
}
