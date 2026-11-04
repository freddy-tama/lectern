// Client for the web search before drafting (api/research.ts). The notes it returns become a
// source in the deck maker's list, like a file: the person sees what was found, can remove it,
// and the draft uses its figures as material.

import { aiPost } from '../account/session';
import { type FoundPage, type Source, countWords, shortDate } from './make';
import { type CallUsage, readUsage } from './usage';

export interface ResearchRequest {
  topic: string;
  brief: string;
  purpose: string;
  /** The start of the material already gathered, so the search looks for what is missing or newer. */
  excerpt: string;
  language: string;
  /** Today as YYYY-MM-DD. */
  today: string;
}

export interface ResearchResult {
  notes: string;
  sources: FoundPage[];
  usage: CallUsage[];
}

/** Searches the web for the deck's topic. Throws an Error with a message for people; `code` says why. */
export async function researchTopic(req: ResearchRequest, signal?: AbortSignal): Promise<ResearchResult> {
  let res: Response;
  try {
    res = await aiPost('/api/research', JSON.stringify(req), signal);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error('Lectern couldn’t reach the server to search the web. Check your connection.');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw Object.assign(new Error(typeof body.error === 'string' ? body.error : 'The web search failed. Try again.'), { code: String(body.code ?? 'service') });
  const sources = (Array.isArray(body.sources) ? body.sources : []).flatMap((s): FoundPage[] => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    return typeof o.url === 'string' && /^https?:\/\//.test(o.url)
      ? [{ title: String(o.title ?? o.url).slice(0, 200), url: o.url, ...(typeof o.date === 'string' && o.date ? { date: o.date } : {}) }]
      : [];
  });
  return { notes: String(body.notes ?? ''), sources, usage: readUsage(body.usage) };
}

/** The research as material: the notes, then every source with its address and date. */
export function researchText(result: Pick<ResearchResult, 'notes' | 'sources'>, today: string): string {
  const list = result.sources.map((s) => `- ${s.title}${s.date ? ` (${s.date})` : ''}: ${s.url}`);
  return [`# Web research`, `Searched on ${shortDate(today)}.`, result.notes.trim(), list.length ? `## Sources\n${list.join('\n')}` : ''].filter(Boolean).join('\n\n');
}

/** A ready source for the deck maker's list, holding the research. */
export function researchSource(id: string, result: Pick<ResearchResult, 'notes' | 'sources'>, today: string): Source {
  const text = researchText(result, today);
  return {
    id,
    file: new File([text], `Web research · ${shortDate(today)}.md`, { type: 'text/markdown' }),
    kind: 'doc',
    status: 'ready',
    text,
    words: countWords(text),
    pictures: [],
    found: result.sources,
  };
}

/** Whether a source is web research, which a new search replaces. */
export const isResearch = (s: Pick<Source, 'found'>) => Array.isArray(s.found);
