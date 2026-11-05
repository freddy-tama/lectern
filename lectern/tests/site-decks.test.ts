// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyNotes } from '../src/core/deck/types';
import { db } from '../src/data/db';
import { type SiteDeck, addSiteDecks, siteDeckId } from '../src/data/site-decks';

function deckFile(title: string) {
  return JSON.stringify({
    format: 'lectern-deck',
    version: 1,
    deck: {
      id: 'class-quiz',
      title,
      themeId: 'sunny',
      audience: 'young',
      purpose: 'lesson',
      slides: [{ id: 'q1', kind: 'question', content: { question: 'Which year?', options: ['1966', '1866'], correct: 1 }, notes: emptyNotes() }],
      createdAt: 1,
      updatedAt: 1,
    },
    assets: [],
  });
}

function site(title: string, version: string) {
  const load = vi.fn(async () => ({ default: deckFile(title) }));
  const deck: SiteDeck = { id: 'class-quiz', version, load };
  return { deck, load };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('site decks', () => {
  it('adds a site deck once, under a fixed id', async () => {
    const { deck, load } = site('Quiz', 'v1');
    expect(await addSiteDecks([deck])).toBe(1);
    expect(await addSiteDecks([deck])).toBe(0);
    expect(load).toHaveBeenCalledTimes(1);
    const stored = await db.decks.get(siteDeckId('class-quiz'));
    expect(stored?.title).toBe('Quiz');
    expect(stored?.slides[0]?.content).toMatchObject({ correct: 1 });
    expect(await db.decks.count()).toBe(1);
  });

  it('replaces the copy when the site ships a newer one', async () => {
    await addSiteDecks([site('Quiz', 'v1').deck]);
    expect(await addSiteDecks([site('Quiz, revised', 'v2').deck])).toBe(1);
    expect((await db.decks.get(siteDeckId('class-quiz')))?.title).toBe('Quiz, revised');
    expect(await db.decks.count()).toBe(1);
  });

  it('leaves a deleted site deck away until a newer copy ships', async () => {
    await addSiteDecks([site('Quiz', 'v1').deck]);
    await db.decks.delete(siteDeckId('class-quiz'));
    expect(await addSiteDecks([site('Quiz', 'v1').deck])).toBe(0);
    expect(await db.decks.count()).toBe(0);
    expect(await addSiteDecks([site('Quiz', 'v2').deck])).toBe(1);
  });

  it('skips a deck that fails and tries it again next time', async () => {
    const broken: SiteDeck = { id: 'class-quiz', version: 'v1', load: async () => ({ default: 'not a deck' }) };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await addSiteDecks([broken])).toBe(0);
    quiet.mockRestore();
    expect(await addSiteDecks([site('Quiz', 'v1').deck])).toBe(1);
  });

  it('does nothing when the site ships no decks', async () => {
    expect(await addSiteDecks()).toBe(0);
    expect(await db.settings.get('site-decks')).toBeUndefined();
  });
});
