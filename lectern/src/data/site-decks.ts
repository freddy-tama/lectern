// Site decks: decks a deployment is built with (LECTERN_SITE_DECKS, see vite.config.ts), so they
// show up in every browser that opens the site, with nothing to import by hand.
//
// - Each one is stored under a fixed id (site_<its deck id>), so it is never added twice.
// - When the site ships a newer copy, that copy replaces the one in the browser.
// - A site deck someone deletes stays away until the site ships a newer copy.
// - Phones joining a live share (/join) or opening a hand-out link (/pack) don't fetch them.

import shipped from 'virtual:lectern-site-decks';
import { db } from './db';
import { openDeckFile } from './deck-file';

export interface SiteDeck {
  /** The deck's id in its file. */
  id: string;
  /** Changes whenever the file does. */
  version: string;
  /** The deck file's text. */
  load(): Promise<{ default: string }>;
}

const KEY = 'site-decks';

/**
 * Whether a page should fetch the site's decks. Phones that only join a live share or open a
 * hand-out link (/join, /pack) don't, since site decks can be large and a class has many phones.
 */
export function wantsSiteDecks(pathname: string): boolean {
  return !/^\/(join|pack)(\/|$)/.test(pathname);
}

/** The id a site deck is stored under. */
export const siteDeckId = (id: string) => `site_${id}`;

/** Adds the site's decks this browser hasn't got in their current version. Returns how many. */
export async function addSiteDecks(decks: SiteDeck[] = shipped): Promise<number> {
  if (!decks.length) return 0;
  const stored = (await db.settings.get(KEY))?.value;
  const have: Record<string, string> = stored && typeof stored === 'object' ? { ...(stored as Record<string, string>) } : {};
  let added = 0;
  for (const deck of decks) {
    if (have[deck.id] === deck.version) continue;
    try {
      const { default: text } = await deck.load();
      await openDeckFile(text, { id: siteDeckId(deck.id) });
      have[deck.id] = deck.version;
      await db.settings.put({ key: KEY, value: have });
      added++;
    } catch (error) {
      console.error(`Could not add the site deck “${deck.id}”`, error);
    }
  }
  return added;
}
