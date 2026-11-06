// EdgeOne Makers: runs Lectern's routes in api/ there. The routes are Web Request → Response
// handlers (the Vercel style), so they run unchanged; this module hands each request to the right
// one. The thin files in cloud-functions/api/ and agents/api/ call it. Vercel never reads those
// folders or this one. See docs/china-hosting.md.
//
// Makers has two kinds of Node function, and the routes are split by how long they may run:
// - Cloud Functions stop after 120 s (a test on 4 November 2026 confirmed it, streaming or not).
//   Routes Vercel gives 120 s or less run there.
// - Agents functions run for up to 1,800 s; edgeone.json sets 300 s, as on Vercel. The routes
//   that can take longer (drafting, revisions, notes, activities, AI pictures and the deck
//   assistant) run there. Agents functions hand over the body already parsed and the headers as a
//   plain object, so the Request is rebuilt, and they refuse requests without a
//   makers-conversation-id header, which the browser sends (src/features/account/session.ts).
//
// Settings arrive in context.env. The routes read process.env, so they're copied across. EdgeOne's
// guide warns that process.env is shared by every handler in a process. That's harmless here:
// every route gets the same project settings, and nothing else writes them.

import * as account from '../api/account.js';
import * as deckAssistant from '../api/deck-assistant.js';
import * as deckQuestions from '../api/deck-questions.js';
import * as draftDeck from '../api/draft-deck.js';
import * as ice from '../api/ice.js';
import * as lectureNotes from '../api/lecture-notes.js';
import * as makeCode from '../api/make-code.js';
import * as pictureFetch from '../api/picture-fetch.js';
import * as pictureGenerate from '../api/picture-generate.js';
import * as pictureSearch from '../api/picture-search.js';
import * as reviseSlide from '../api/revise-slide.js';
import * as teleprompter from '../api/teleprompter.js';

type Handler = (request: Request) => Promise<Response>;
type Route = { GET?: Handler; POST?: Handler };

/** Every route in api/, by the name in its address (/api/<name>). */
export const ROUTES: Record<string, Route> = {
  account,
  'deck-assistant': deckAssistant,
  'deck-questions': deckQuestions,
  'draft-deck': draftDeck,
  ice,
  'lecture-notes': lectureNotes,
  'make-code': makeCode,
  'picture-fetch': pictureFetch,
  'picture-generate': pictureGenerate,
  'picture-search': pictureSearch,
  'revise-slide': reviseSlide,
  teleprompter,
};

/** The routes that run as Agents functions, because they can take longer than 120 s. */
export const AGENT_ROUTES = ['deck-assistant', 'draft-deck', 'lecture-notes', 'make-code', 'picture-generate', 'revise-slide', 'teleprompter'];

/** Copies the project's settings into process.env, without overriding what's already there. */
export function shareEnv(env: unknown, target: Record<string, string | undefined> = process.env) {
  if (!env || typeof env !== 'object') return;
  for (const [key, value] of Object.entries(env)) if (typeof value === 'string' && target[key] === undefined) target[key] = value;
}

const plain = (body: string, status: number, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers } });

/** Calls the named route's handler for the request's method. */
export async function serve(name: string, request: Request): Promise<Response> {
  const route = Object.hasOwn(ROUTES, name) ? ROUTES[name] : undefined;
  if (!route) return plain('Not found', 404);
  const method = request.method.toUpperCase();
  const handler = method === 'GET' || method === 'HEAD' ? route.GET : method === 'POST' ? route.POST : undefined;
  if (!handler) return plain('Method not allowed', 405, { allow: [route.GET && 'GET', route.POST && 'POST'].filter(Boolean).join(', ') });
  return handler(request);
}

/** What a Cloud Function receives: a standard Request, and the settings. */
export interface CloudContext {
  request: Request;
  env?: Record<string, unknown>;
}

/** Serves a route from a Cloud Function. */
export function fromCloud(name: string, context: CloudContext): Promise<Response> {
  shareEnv(context.env);
  return serve(name, context.request);
}

/** What an Agents function receives: the parts of the request, with the body already parsed. */
export interface AgentContext {
  request: Request | {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    body?: unknown;
    signal?: AbortSignal;
  };
  env?: Record<string, unknown>;
}

function isRequest(value: unknown): value is Request {
  return typeof Request !== 'undefined' && value instanceof Request;
}

/**
 * The standard Request the routes expect, rebuilt from an Agents function's request. A parsed body
 * goes back to JSON. The original headers stay, content-length included, so the routes' own size
 * checks see what the browser sent.
 */
export function agentRequest(raw: AgentContext['request']): Request {
  if (isRequest(raw)) return raw;
  const method = (raw.method ?? 'GET').toUpperCase();
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw.headers ?? {})) {
    if (value === undefined) continue;
    try { headers.set(key, Array.isArray(value) ? value.join(', ') : String(value)); } catch { /* a header Headers won't hold */ }
  }
  let body: BodyInit | undefined;
  const given = raw.body;
  if (method !== 'GET' && method !== 'HEAD' && given !== undefined && given !== null) {
    if (typeof given === 'string' || given instanceof ArrayBuffer || ArrayBuffer.isView(given)) body = given as BodyInit;
    else {
      body = JSON.stringify(given);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
  }
  return new Request(raw.url ?? 'http://localhost/', { method, headers, body, signal: raw.signal });
}

/** Serves a route from an Agents function. */
export function fromAgent(name: string, context: AgentContext): Promise<Response> {
  shareEnv(context.env);
  return serve(name, agentRequest(context.request));
}
