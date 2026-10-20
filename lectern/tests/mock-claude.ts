// A stand-in for the Claude Messages API, for tests and for trying the deck assistant in the browser without a key.
// It answers POST /v1/messages with scripted replies streamed as server-sent events, so the real SDK, its tool
// runner and the real api/deck-assistant.ts all run as they would against the API.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Plugin } from 'vite';

export type FakeBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

export interface FakeReply {
  content: FakeBlock[];
  stop_reason: 'tool_use' | 'end_turn' | 'max_tokens' | 'refusal';
}

/** The request body the SDK sent, as JSON. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SentRequest = Record<string, any>;

let counter = 0;

/** One reply as the event stream the API sends. Tool input arrives in pieces, as it does with eager input streaming. */
export function sseEvents(reply: FakeReply): string {
  const id = `msg_mock_${++counter}`;
  const out: string[] = [];
  const event = (type: string, data: unknown) => out.push(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  event('message_start', {
    type: 'message_start',
    message: { id, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
  reply.content.forEach((block, index) => {
    if (block.type === 'text') {
      event('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      event('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
    } else if (block.type === 'thinking') {
      event('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      if (block.thinking) event('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } });
      event('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } });
    } else {
      event('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      const json = JSON.stringify(block.input);
      for (let i = 0; i < json.length; i += 40) {
        event('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(i, i + 40) } });
      }
    }
    event('content_block_stop', { type: 'content_block_stop', index });
  });
  event('message_delta', { type: 'message_delta', delta: { stop_reason: reply.stop_reason, stop_sequence: null }, usage: { output_tokens: 20 } });
  event('message_stop', { type: 'message_stop' });
  return out.join('');
}

export type Script = (request: SentRequest, call: number) => FakeReply;

/**
 * A fetch for `new Anthropic({ fetch })` that answers each call from the script and records what was sent.
 * Requests are deep-copied when they arrive, so later changes to the runner's arrays don't rewrite them.
 */
export function fakeClaude(script: Script | FakeReply[]) {
  const requests: SentRequest[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? '{}')) as SentRequest;
    requests.push(structuredClone(body));
    const call = requests.length - 1;
    const reply = typeof script === 'function' ? script(body, call) : script[call];
    if (!reply) return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'No more scripted replies' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    return new Response(sseEvents(reply), { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': `req_${call}` } });
  };
  return { fetch, requests };
}

const thinking = (n: number): FakeBlock => ({ type: 'thinking', thinking: '', signature: `mock-signature-${n}` });

/** Slides listed in the newest outline the model was sent: "3. s_ab12 · bullets · “Heading” · 2 min". */
function outlineSlides(request: SentRequest): { id: string; kind: string; heading: string; minutes: number; titled: boolean }[] {
  const texts: string[] = [];
  for (const m of request.messages ?? []) {
    if (m.role !== 'user') continue;
    for (const b of Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]) if (b.type === 'text') texts.push(b.text);
  }
  const outline = [...texts].reverse().find((t) => t.includes('DECK OUTLINE')) ?? '';
  const titled = new Set([...(texts.find((t) => t.includes('SLIDE TYPES')) ?? '').matchAll(/^([a-z][\w.-]*): .*Fields: title \(/gm)].map((m) => m[1]));
  return [...outline.matchAll(/^\d+\. (\S+) · (\S+) · “(.*)” · ([\d.]+) min/gm)].map((m) => ({ id: m[1], kind: m[2], heading: m[3], minutes: Number(m[4]), titled: titled.has(m[2]) }));
}

/** Calls made since the presenter's newest request: 0 for the first step of a turn. */
function stepOfTurn(request: SentRequest): number {
  const messages: SentRequest[] = request.messages ?? [];
  let start = messages.length - 1;
  while (start >= 0 && !(messages[start].role === 'user' && Array.isArray(messages[start].content) && messages[start].content.some((b: SentRequest) => b.type === 'text' && String(b.text).includes('<request>')))) start--;
  return messages.slice(start + 1).filter((m) => m.role === 'assistant').length;
}

/**
 * A short, believable turn for any deck: read a few slides, propose an edit, new timings, a summary slide and one
 * deletion, then reply. Used by the browser check (see vite.mock.config.ts).
 */
export const demoScript: Script = (request) => {
  const step = stepOfTurn(request);
  const slides = outlineSlides(request);
  const pick = slides.find((s, i) => i > 0 && s.titled) ?? slides[0];
  const last = slides[slides.length - 1];
  const doomed = slides.length > 3 ? slides[slides.length - 2] : undefined;
  const turn = request.messages.length;
  if (step === 0) {
    return {
      stop_reason: 'tool_use',
      content: [thinking(turn), { type: 'tool_use', id: `toolu_read_${turn}`, name: 'read_slide', input: { slides: slides.slice(0, 4).map((s) => s.id) } }],
    };
  }
  if (step === 1 && pick) {
    return {
      stop_reason: 'tool_use',
      content: [
        thinking(turn + 1),
        { type: 'tool_use', id: `toolu_edit_${turn}`, name: 'edit_slide', input: { slide: pick.id, content_json: JSON.stringify({ title: `${pick.heading.replace(/\s*\(shorter\)$/, '')} (shorter)` }), reason: 'A shorter heading reads faster' } },
        { type: 'tool_use', id: `toolu_time_${turn}`, name: 'edit_notes', input: { slide: slides[0].id, script: null, keyPoints: null, cues: null, checkQuestion: null, checkAnswer: null, minutes: slides[0].minutes > 1 ? 1 : 0.5, reason: 'Open quickly' } },
        { type: 'tool_use', id: `toolu_add_${turn}`, name: 'add_slide', input: { after: last.id, kind: 'summary', content_json: JSON.stringify({ title: 'Key takeaways', points: ['The main idea in one line', 'What to do next'] }), script: 'Let’s bring it together.', keyPoints: ['The main idea'], minutes: 1, reason: 'End on the takeaways' } },
        ...(doomed ? [{ type: 'tool_use' as const, id: `toolu_del_${turn}`, name: 'delete_slide', input: { slide: doomed.id, reason: 'It repeats the slide before it' } }] : []),
        { type: 'tool_use', id: `toolu_bad_${turn}`, name: 'edit_slide', input: { slide: pick.id, content_json: '{"colour": "red"}', reason: 'Testing a bad field' } },
      ],
    };
  }
  return {
    stop_reason: 'end_turn',
    content: [thinking(turn + 2), { type: 'text', text: 'I shortened one heading, gave the opening a minute, added a takeaways slide at the end and suggest deleting a slide that repeats the one before it. That deletion needs your tick.' }],
  };
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Serves the demo script at /__mock-claude/v1/messages and points the SDK at it, so the dev server's
 * /api/deck-assistant runs end to end with no key. Each reply is slowed a little so the step cards can be seen.
 */
export function mockClaude(script: Script = demoScript): Plugin {
  return {
    name: 'lectern-mock-claude',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const { port } = server.httpServer!.address() as AddressInfo;
        process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}/__mock-claude`;
        process.env.ANTHROPIC_API_KEY = 'mock-key';
        server.config.logger.info(`  Claude is mocked: /api/deck-assistant answers from tests/mock-claude.ts`);
      });
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/__mock-claude/v1/messages')) return next();
        const body = JSON.parse(await readBody(req)) as SentRequest;
        const reply = script(body, 0);
        res.setHeader('content-type', 'text/event-stream');
        for (const chunk of sseEvents(reply).split('\n\n').filter(Boolean)) {
          res.write(`${chunk}\n\n`);
          await new Promise((r) => setTimeout(r, 25));
        }
        res.end();
      });
    },
  };
}
