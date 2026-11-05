// Photos from free libraries for a drafted deck. When the presenter asks for them, the outline
// names a search for the slides that would show a photo; once the slides are written, each
// search runs on the libraries this server has (Openverse, Wikimedia Commons, Pexels), and the
// best free picture is downloaded, kept with its credit, and put in the slide's picture field.
// A slide whose search finds nothing keeps a photo note of what was wanted, to add by hand.

import { pictureField } from '../../core/deck/photo-notes';
import type { DeckDraft } from '../../core/plugins/api';
import { type PictureShape, type RankedPicture, rankPictures } from '../../core/pictures/rank';
import type { PlannedSlide } from '../../data/draft-jobs';
import { downloadPicture, pictureProviders, searchLibrary } from '../pictures/api';
import { savePicture } from '../pictures/store';

/** The most photos one deck gets this way. */
export const MAX_FOUND = 12;
const SEARCH_MS = 20_000;

/** The slide type's first single-picture field, or undefined when it has none. */
export const photoField = pictureField;

export interface PhotoDeps {
  providers(): Promise<string[]>;
  search(provider: string, query: string, shape: PictureShape, signal?: AbortSignal): Promise<Parameters<typeof rankPictures>[0]>;
  /** Downloads and keeps a picture with its credit; returns its "asset:…" reference. */
  keep(picture: RankedPicture, query: string, signal?: AbortSignal): Promise<string>;
}

const DEFAULT_DEPS: PhotoDeps = {
  providers: async () => pictureProviders(),
  search: (provider, query, shape, signal) => searchLibrary(provider as Parameters<typeof searchLibrary>[0], query, 1, shape, signal),
  keep: async (p, query, signal) => {
    const { blob, url } = await downloadPicture(p.url, signal);
    return savePicture(blob, p.title || 'Picture', {
      source: p.provider, rights: p.rights, title: p.title, author: p.author, license: p.license, licenseUrl: p.licenseUrl,
      page: p.page, url, query, resultId: p.id,
    });
  },
};

/** Pictures anyone may use: free, or free with a credit. Limited and unclear licences aren't placed without asking. */
const usable = (p: RankedPicture) => p.rights === 'free' || p.rights === 'credit';

/**
 * Fills the picture field of each slide whose outline names a search and whose field is still
 * empty. Fails softly: a slide whose search finds nothing keeps its empty field, with the search as
 * its photo note.
 */
export async function addFoundPhotos(
  draft: DeckDraft,
  outline: Pick<PlannedSlide, 'search'>[],
  o: { signal?: AbortSignal; deps?: PhotoDeps } = {},
): Promise<{ draft: DeckDraft; added: number; wanted: number }> {
  const deps = o.deps ?? DEFAULT_DEPS;
  const todo = draft.slides.flatMap((s, i) => {
    const query = outline[i]?.search?.trim();
    const field = photoField(s.kind);
    return query && field && !s.content?.[field] ? [{ i, query, field }] : [];
  }).slice(0, MAX_FOUND);
  if (!todo.length) return { draft, added: 0, wanted: 0 };
  const providers = await deps.providers().catch(() => []);
  const slides = draft.slides.map((s) => ({ ...s, content: { ...(s.content ?? {}) } }));
  // What was wanted stays on the slide as a note until a photo is in.
  const noteMisses = () => {
    for (const { i, query, field } of todo) if (!slides[i]!.content[field] && !slides[i]!.photoNote) slides[i]!.photoNote = query;
    return { ...draft, slides };
  };
  if (!providers.length) return { draft: noteMisses(), added: 0, wanted: todo.length };
  const taken = new Set<string>();
  let added = 0;
  // Three at a time: libraries are slow, and each answers on its own.
  for (let at = 0; at < todo.length; at += 3) {
    await Promise.all(todo.slice(at, at + 3).map(async ({ i, query, field }) => {
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), SEARCH_MS);
      o.signal?.addEventListener('abort', () => stop.abort());
      try {
        const results = (await Promise.all(providers.map((p) => deps.search(p, query, 'wide', stop.signal).catch(() => [])))).flat();
        const ranked = rankPictures(results, query, { shape: 'wide', dismissed: new Set() }).filter(usable);
        for (const p of ranked.slice(0, 3)) {
          if (taken.has(p.url)) continue;
          taken.add(p.url);
          try {
            slides[i]!.content[field] = await deps.keep(p, query, stop.signal);
            added += 1;
            return;
          } catch {
            // That picture wouldn't download: try the next one.
          }
        }
      } finally {
        clearTimeout(timer);
      }
    }));
  }
  return { draft: noteMisses(), added, wanted: todo.length };
}
