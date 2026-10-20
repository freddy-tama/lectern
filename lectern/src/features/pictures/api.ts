// Calls to the picture functions in api/. Every call fails softly: without the server
// (a static copy of the app, or offline) the finder falls back to uploads and plain links.

import type { FoundPicture, PictureProvider } from '../../../api/picture-search';
import type { PictureStyle } from '../../../api/picture-generate';
import type { PictureShape } from '../../core/pictures/rank';
import { savedCode } from '../studio/ai';

export type { PictureProvider, PictureStyle };

export const PROVIDER_LABEL: Record<PictureProvider, string> = { openverse: 'Openverse', commons: 'Wikimedia Commons', pexels: 'Pexels' };

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : fallback;
}

let providers: Promise<PictureProvider[]> | null = null;

/** The libraries this server can search. Empty when there's no server. Cached for the session. */
export function pictureProviders(): Promise<PictureProvider[]> {
  providers ??= fetch('/api/picture-search')
    .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : { providers: [] }))
    .then((j: { providers?: PictureProvider[] }) => (Array.isArray(j.providers) ? j.providers : []))
    .catch(() => []);
  return providers;
}

export async function searchLibrary(from: PictureProvider, q: string, page: number, shape: PictureShape, signal?: AbortSignal): Promise<FoundPicture[]> {
  const params = new URLSearchParams({ q, from, page: String(page), shape });
  const res = await fetch(`/api/picture-search?${params}`, { signal });
  if (!res.ok) throw new Error(await errorOf(res, `${PROVIDER_LABEL[from]} couldn’t be searched.`));
  const body = await res.json() as { results?: FoundPicture[] };
  return Array.isArray(body.results) ? body.results : [];
}

export class NoServerError extends Error {}

/** Downloads a picture through the server, so it's stored here instead of hotlinked. */
export async function downloadPicture(url: string, signal?: AbortSignal): Promise<{ blob: Blob; url: string }> {
  let res: Response;
  try {
    res = await fetch(`/api/picture-fetch?url=${encodeURIComponent(url)}`, { signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new NoServerError('The picture couldn’t be downloaded. Check your connection.');
  }
  const type = res.headers.get('content-type') ?? '';
  if (res.status === 404 && !type.includes('json')) throw new NoServerError('This copy of Lectern has no server to download pictures with.');
  if (!res.ok) throw new Error(await errorOf(res, 'The picture couldn’t be downloaded. Try another one.'));
  if (!type.startsWith('image/')) throw new NoServerError('This copy of Lectern has no server to download pictures with.');
  const blob = await res.blob();
  const final = res.headers.get('x-picture-url');
  return { blob, url: final ? decodeURI(final) : url };
}

export interface GenerateStatus {
  available: boolean;
  provider?: string;
  model?: string;
  needsCode?: boolean;
}

let generateStatus: Promise<GenerateStatus> | null = null;

/** Whether this server can make AI pictures. Cached for the session. */
export function pictureGenerateStatus(): Promise<GenerateStatus> {
  generateStatus ??= fetch('/api/picture-generate')
    .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : { available: false }))
    .then((j: GenerateStatus) => ({ ...j, available: Boolean(j.available) }))
    .catch(() => ({ available: false }));
  return generateStatus;
}

export interface GenerateResult {
  blob: Blob;
  model: string;
  provider: string;
  revisedPrompt: string;
}

export async function generatePicture(prompt: string, shape: PictureShape, style: PictureStyle, signal?: AbortSignal): Promise<GenerateResult> {
  const res = await fetch('/api/picture-generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lectern-code': savedCode() },
    body: JSON.stringify({ prompt, shape, style }),
    signal,
  });
  const body = await res.json().catch(() => ({})) as { image?: string; model?: string; provider?: string; revisedPrompt?: string; error?: string };
  if (!res.ok || !body.image) throw Object.assign(new Error(body.error ?? 'The picture couldn’t be made. Try again.'), { status: res.status });
  const blob = await (await fetch(body.image)).blob();
  return { blob, model: body.model ?? '', provider: body.provider ?? '', revisedPrompt: body.revisedPrompt ?? '' };
}
