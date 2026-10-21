// AI that writes code for one slide: activities (HTML) and drawings (SVG).
// The server is api/make-code.ts. What comes back is cleaned again here.

import type { Audience, DeckPurpose } from '../../core/deck/types';
import { type Theme, THEMES, fontFamily } from '../../core/engine/themes';
import { cleanSvg, extractHtml, looksLikeHtml, svgAspect } from '../../core/media/embed';
import { savedCode } from './ai';

const ENDPOINT = '/api/make-code';

export interface CodeAiStatus {
  available: boolean;
  needsCode: boolean;
}

let status: Promise<CodeAiStatus> | null = null;

/** Whether the server can write code. Asked once per session; a failed check is asked again. */
export function codeAiStatus(): Promise<CodeAiStatus> {
  status ??= fetch(ENDPOINT, { method: 'GET' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: Partial<CodeAiStatus>) => ({ available: Boolean(j.available), needsCode: Boolean(j.needsCode) }))
    .catch(() => {
      status = null;
      return { available: false, needsCode: false };
    });
  return status;
}

export class CodeAiError extends Error {
  constructor(message: string, readonly needsCode = false) {
    super(message);
  }
}

/** What the AI is told about the deck. */
export interface DeckInfo {
  deckTitle: string;
  audience: Audience;
  purpose: DeckPurpose;
  theme?: Theme;
}

/** The deck's look as the server reads it, so the code matches the slides. */
export function deckLook(theme: Theme = THEMES[0]) {
  return { ...theme.colors, font: fontFamily(theme, 'body', 'web') };
}

function deckFields(deck: DeckInfo) {
  return { deckTitle: deck.deckTitle, audience: deck.audience, purpose: deck.purpose, look: deckLook(deck.theme) };
}

async function post<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lectern-code': savedCode() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new CodeAiError('Couldn’t reach the server. Check your connection and try again.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new CodeAiError(typeof json.error === 'string' ? json.error : 'The AI request failed. Try again.', res.status === 401);
  return json as T;
}

export interface ActivityResult {
  html: string;
  title: string;
  instructions: string;
}

/** Builds an activity from a description, or changes the current one when a change is given. */
export async function makeActivity(deck: DeckInfo, o: { prompt: string; title?: string; current?: string; change?: string }, signal?: AbortSignal): Promise<ActivityResult> {
  const out = await post<Partial<ActivityResult>>({
    mode: 'activity', prompt: o.prompt, title: o.title, current: o.change ? o.current : undefined, change: o.change, ...deckFields(deck),
  }, signal);
  const html = extractHtml(out.html ?? '');
  if (!looksLikeHtml(html)) throw new CodeAiError('The AI didn’t return an activity. Try again.');
  return { html, title: out.title?.trim() ?? '', instructions: out.instructions?.trim() ?? '' };
}

export interface DrawingResult {
  svg: string;
  alt: string;
}

/** Draws an SVG illustration for a picture frame of the given width-to-height ratio. */
export async function makeDrawing(deck: DeckInfo, o: { prompt: string; aspect: number; title?: string; current?: string; change?: string }, signal?: AbortSignal): Promise<DrawingResult> {
  const out = await post<Partial<DrawingResult>>({
    mode: 'drawing', prompt: o.prompt, aspect: o.aspect, title: o.title, current: o.change ? o.current : undefined, change: o.change, ...deckFields(deck),
  }, signal);
  const svg = cleanSvg(out.svg ?? '');
  if (!svg) throw new CodeAiError('The AI didn’t return a drawing. Try again.');
  return { svg: sizedSvg(svg), alt: out.alt?.trim() ?? '' };
}

/**
 * Gives an SVG a pixel size from its viewBox when it has none, so browsers and the
 * PowerPoint export know how big it is.
 */
export function sizedSvg(svg: string): string {
  const head = svg.slice(0, svg.indexOf('>') + 1);
  if (/\swidth\s*=/.test(head) && /\sheight\s*=/.test(head)) return svg;
  const aspect = svgAspect(svg) || 16 / 9;
  const w = aspect >= 1 ? 1600 : Math.round(1600 * aspect);
  const h = aspect >= 1 ? Math.round(1600 / aspect) : 1600;
  const bare = head.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|\S+)/g, '');
  return bare.replace(/<svg/i, `<svg width="${w}" height="${h}"`) + svg.slice(head.length);
}
