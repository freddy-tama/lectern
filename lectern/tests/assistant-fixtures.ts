import { makeSlide } from '../src/core/deck/draft';
import type { Deck, Slide } from '../src/core/deck/types';
import { registerCoreKinds } from '../src/core/kinds/core-kinds';

registerCoreKinds();

export const slide = (id: string, kind: string, content: Record<string, unknown>, minutes = 2, script = ''): Slide => ({ ...makeSlide(kind, content, { minutes, script }), id });

/** A short talk for the deck assistant's tests: a title, three bullet slides and takeaways. */
export function sampleDeck(): Deck {
  return {
    id: 'd_sample',
    title: 'Caching in practice',
    themeId: 'paper',
    audience: 'adult',
    purpose: 'talk',
    minutes: 12,
    createdAt: 0,
    updatedAt: 0,
    slides: [
      slide('s_title', 'title', { title: 'Caching in practice', subtitle: 'Faster pages for less' }, 1, 'Welcome, everyone.'),
      slide('s_why', 'bullets', { title: 'Why caching matters', bullets: ['Faster pages', 'Lower hosting cost', 'Less load on the database'], image: 'asset:pic1' }, 3, 'Caching makes pages faster.'),
      slide('s_how', 'bullets', { title: 'How a cache works', bullets: ['Keys map to stored responses', 'TTL decides freshness', 'LRU eviction frees memory'] }, 4, 'A cache stores responses by key.'),
      slide('s_inval', 'bullets', { title: 'Invalidation', bullets: ['Purge on write', 'Version your keys'] }, 3, 'There are only two hard things.'),
      slide('s_end', 'summary', { title: 'Key takeaways', points: ['Cache what is read often', 'Plan invalidation first'] }, 1),
    ],
  };
}
