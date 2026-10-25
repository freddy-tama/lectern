// One request of the deck assistant, run as a loop in the browser: send the conversation to /api/deck-assistant,
// run the tool calls of the reply against the working copy, send the results back, until Claude answers or the
// step cap is reached. Ends with the proposals and the conversation to keep for the next request.

import { MAX_REVIEW_STEPS, MAX_STEPS, toolSpec } from '../../../core/agent/tools';
import type { Deck } from '../../../core/deck/types';
import { draftingHints } from '../../../core/plugins/registry';
import type { DeckOp } from '../deck-ops';
import { type ToolBlock, asData, kindsText, lookText, runTool } from './tools';
import { Workspace } from './workspace';

/** A message of the conversation as the API takes it. Assistant replies go back exactly as they came. */
export type HistoryMessage = { role: 'user' | 'assistant'; content: string | Record<string, unknown>[] };

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
  stopped?: 'steps' | 'length' | 'refusal' | 'error';
}

export type LoopEvent = { type: 'step'; step: number } | ({ type: 'tool' } & StepCard);

/** What one model call streams back: step cards as tool calls start, then the reply. */
export type CallEvent =
  | { type: 'tool'; id: string; name: string; label: string }
  | { type: 'message'; content: Record<string, unknown>[]; stop_reason: string | null };

/** Sends the conversation for one model call. Throws a readable error when the call fails. */
export type CallModel = (body: { messages: HistoryMessage[]; final: boolean; review: boolean }, onTool: (e: Extract<CallEvent, { type: 'tool' }>) => void, signal?: AbortSignal) => Promise<Extract<CallEvent, { type: 'message' }>>;

export interface TurnInput {
  request: string;
  history: HistoryMessage[];
  deck: Deck;
  plannedMinutes?: number;
  /** Send the slide types again: on the first request, and when mods changed since the last. */
  withKinds: boolean;
  since?: { proposed: number; applied: number };
  /** A design review: more steps, and a little more thought on each. */
  review?: boolean;
}

/** Above this a request nears Vercel's 4.5 MB limit; older slide pictures are dropped first. */
export const MAX_REQUEST_BYTES = 3_900_000;

const ANSWER_NOW = 'You’ve used all your steps for this request. Don’t call more tools. Reply to the presenter now: what you proposed, and what is left to do if they ask again.';

const PICTURE_GONE: ToolBlock = { type: 'text', text: '(A picture was here. View the slides again to see them as they are now.)' };

const isToolResults = (m: HistoryMessage) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result');

/** The conversation with the pictures in tool results replaced by a note, from `from` up to `to`. */
export function withoutPictures(messages: HistoryMessage[], from = 0, to = messages.length): HistoryMessage[] {
  return messages.map((m, i) => {
    if (i < from || i >= to || !isToolResults(m)) return m;
    const content = (m.content as Record<string, unknown>[]).map((b) => {
      if (b.type !== 'tool_result' || !Array.isArray(b.content) || !(b.content as ToolBlock[]).some((x) => x.type === 'image')) return b;
      return { ...b, content: (b.content as ToolBlock[]).map((x) => (x.type === 'image' ? PICTURE_GONE : x)) };
    });
    return { ...m, content };
  });
}

/** The presenter's new request: the slide types on the first one, the deck as it is now, then the request. */
export function turnMessage(input: TurnInput, ws: Workspace): HistoryMessage {
  const blocks: Record<string, unknown>[] = [];
  if (input.withKinds) {
    const hints = draftingHints();
    blocks.push({ type: 'text', text: `Slide types in this deck's editor:\n${asData('SLIDE TYPES', kindsText())}${hints ? `\n\nGuidance from installed mods:\n${hints}` : ''}` });
  }
  const since = input.since && input.since.proposed > 0
    ? `Since your last reply the presenter applied ${input.since.applied} of your ${input.since.proposed} proposed changes${input.since.applied < input.since.proposed ? ' and left the rest' : ''}. `
    : '';
  blocks.push({ type: 'text', text: `${since}The deck as it is now:\n${asData('DECK OUTLINE', ws.outline())}\n\n${asData('LOOK', lookText(ws.theme))}` });
  blocks.push({ type: 'text', text: `The presenter's request:\n<request>\n${input.request}\n</request>` });
  return { role: 'user', content: blocks };
}

/** The reply's words. If a fallback model took over mid-answer, only the text after the last switch counts. */
function replyText(content: Record<string, unknown>[]): string {
  const last = content.map((b) => b.type).lastIndexOf('fallback');
  return content.slice(last + 1).map((b) => (b.type === 'text' ? String(b.text ?? '') : '')).join('').trim();
}

function summaryOf(ops: DeckOp[], why: string): string {
  if (!ops.length) return `${why} Nothing was proposed yet. Try again, or ask for a smaller change.`;
  return `${why} Here ${ops.length === 1 ? 'is the change' : `are the ${ops.length} changes`} proposed so far. Ask again to carry on.`;
}

/**
 * The conversation up to its last complete exchange, to keep for the next request: a reply that asked for tools
 * whose results never went back would be refused.
 */
export function completeHistory(messages: HistoryMessage[]): HistoryMessage[] {
  const out = [...messages];
  for (;;) {
    const tail = out[out.length - 1];
    if (!tail) return out;
    if (tail.role === 'user') { out.pop(); continue; }
    if (Array.isArray(tail.content) && tail.content.some((b) => b.type === 'tool_use')) { out.pop(); continue; }
    return out;
  }
}

/** Runs one request. Step cards arrive through onEvent; nothing in the real deck changes. */
export async function runTurn(input: TurnInput, call: CallModel, onEvent: (e: LoopEvent) => void, signal?: AbortSignal): Promise<TurnResult> {
  const ws = new Workspace(input.deck, input.plannedMinutes);
  const cap = input.review ? MAX_REVIEW_STEPS : MAX_STEPS;
  const tag = Math.random().toString(36).slice(2, 6);
  // Pictures from earlier requests are out of date by now, and they weigh a lot.
  let messages: HistoryMessage[] = [...withoutPictures(input.history), turnMessage(input, ws)];
  const start = messages.length - 1;
  let final = false;
  for (let step = 1; ; step++) {
    onEvent({ type: 'step', step });
    // Keep the request under the size limit: drop pictures from this request's older results, then give up.
    if (JSON.stringify(messages).length > MAX_REQUEST_BYTES) messages = withoutPictures(messages, start, messages.length - 2);
    if (JSON.stringify(messages).length > MAX_REQUEST_BYTES) {
      const ops = ws.ops();
      return { ops, summary: summaryOf(ops, 'This chat has grown too long to send.'), history: completeHistory(messages), stopped: 'length' };
    }
    let reply: Awaited<ReturnType<CallModel>>;
    try {
      reply = await call({ messages, final, review: Boolean(input.review) }, (e) => onEvent({ type: 'tool', id: e.id, name: e.name, label: e.label, status: 'running' }), signal);
    } catch (error) {
      const ops = ws.ops();
      // With nothing proposed yet there is nothing to show: the error is the answer.
      if (!ops.length || (error as Error).name === 'AbortError') throw error;
      return { ops, summary: summaryOf(ops, `The assistant stopped: ${(error as Error).message}`), history: completeHistory(messages), stopped: 'error' };
    }
    messages = [...messages, { role: 'assistant', content: reply.content }];
    const ops = () => ws.ops();
    if (reply.stop_reason === 'refusal') return { ops: ops(), summary: summaryOf(ops(), 'The AI declined to go on with this request.'), history: completeHistory(messages.slice(0, -1)), stopped: 'refusal' };
    if (reply.stop_reason === 'max_tokens') return { ops: ops(), summary: summaryOf(ops(), 'The answer ran too long.'), history: completeHistory(messages), stopped: 'length' };
    const uses = reply.content.filter((b) => b.type === 'tool_use') as { id: string; name: string; input: unknown }[];
    if (reply.stop_reason !== 'tool_use' || !uses.length) {
      return { ops: ops(), summary: replyText(reply.content) || summaryOf(ops(), 'Done.'), history: messages, ...(final ? { stopped: 'steps' as const } : {}) };
    }
    if (final) {
      // Tools after being told to stop: end here with what was proposed.
      return { ops: ops(), summary: summaryOf(ops(), 'I ran out of steps.'), history: completeHistory(messages), stopped: 'steps' };
    }
    const results: Record<string, unknown>[] = [];
    for (const use of uses) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      try {
        const out = await runTool(use.name, use.input, { ws, signal, tag });
        onEvent({ type: 'tool', id: use.id, name: use.name, label: out.label, status: 'done', ...(out.detail ? { detail: out.detail } : {}) });
        results.push({ type: 'tool_result', tool_use_id: use.id, content: typeof out.content === 'string' ? out.content : out.content });
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        const message = (e as Error).message || 'That didn’t work.';
        onEvent({ type: 'tool', id: use.id, name: use.name, label: failedLabel(use.name), status: 'error', detail: message.length > 160 ? `${message.slice(0, 159)}…` : message });
        results.push({ type: 'tool_result', tool_use_id: use.id, content: `Error: ${message}`, is_error: true });
      }
    }
    if (step >= cap) {
      final = true;
      results.push({ type: 'text', text: ANSWER_NOW });
    }
    messages = [...messages, { role: 'user', content: results }];
  }
}

function failedLabel(name: string) {
  return `${toolSpec(name)?.running ?? 'A step'} didn’t work`;
}
