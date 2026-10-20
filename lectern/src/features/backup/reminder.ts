// When to remind someone to download a backup: they have decks of their own, this browser
// hasn't saved a backup in two weeks, and the reminder hasn't shown in the past week.

import type { Deck } from '../../core/deck/types';
import { db } from '../../data/db';

const DAY = 86_400_000;
/** A backup older than this is due again. */
export const BACKUP_DUE_AFTER = 14 * DAY;
/** The reminder shows at most this often. */
export const REMIND_EVERY = 7 * DAY;

const SHOWN_KEY = 'lectern.backupReminder';

export interface ReminderInput {
  now: number;
  /** When this browser last saved a backup (ms), or 0. */
  lastBackup: number;
  /** When the reminder last showed (ms), or 0. */
  lastShown: number;
  /** At least one deck the person made or changed, not only the untouched samples. */
  hasWork: boolean;
}

/**
 * How long ago a moment was. Never is forever ago. A time more than a day ahead means the
 * clock was set back, so it counts as long ago too; a little ahead counts as just now.
 */
function since(time: number, now: number): number {
  if (!(time > 0) || time > now + DAY) return Infinity;
  return Math.max(0, now - time);
}

/** True when the backup reminder should show now. */
export function backupReminderDue({ now, lastBackup, lastShown, hasWork }: ReminderInput): boolean {
  return hasWork && since(lastBackup, now) >= BACKUP_DUE_AFTER && since(lastShown, now) >= REMIND_EVERY;
}

/** When the reminder last showed in this browser (ms), or 0. */
export function lastReminderAt(): number {
  try { return Number(localStorage.getItem(SHOWN_KEY)) || 0; } catch { return 0; }
}

export function markReminderShown(now = Date.now()) {
  try { localStorage.setItem(SHOWN_KEY, String(now)); } catch { /* private mode or full */ }
}

const slidesKey = (deck: Pick<Deck, 'slides'>) => JSON.stringify(deck.slides);

/**
 * The decks someone made or changed. A sample deck that was only opened still has the
 * sample's slides (its save time can change just from opening it), so it doesn't count.
 * Nor does a copy of a sample that nobody edited.
 */
export function ownDecks(decks: Deck[], samples: Pick<Deck, 'slides'>[]): Deck[] {
  const untouched = new Set(samples.map(slidesKey));
  return decks.filter((d) => !untouched.has(slidesKey(d)));
}

/** True when this browser has at least one deck of the person's own. */
export async function hasOwnDecks(): Promise<boolean> {
  const decks = await db.decks.toArray();
  if (!decks.length) return false;
  const { buildSeed } = await import('../../data/seed');
  return ownDecks(decks, buildSeed(new Date()).decks).length > 0;
}
