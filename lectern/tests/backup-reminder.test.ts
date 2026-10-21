// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/data/db';
import { loadSampleData, saveDeck } from '../src/data/repo';
import { buildSeed } from '../src/data/seed';
import { BACKUP_DUE_AFTER, REMIND_EVERY, backupReminderDue, hasOwnDecks, ownDecks } from '../src/features/backup/reminder';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 21, 9);

const due = (patch: Partial<Parameters<typeof backupReminderDue>[0]> = {}) =>
  backupReminderDue({ now: NOW, lastBackup: 0, lastShown: 0, hasWork: true, ...patch });

describe('backup reminder timing', () => {
  it('waits for two weeks without a backup and shows at most once a week', () => {
    expect(BACKUP_DUE_AFTER).toBe(14 * DAY);
    expect(REMIND_EVERY).toBe(7 * DAY);
  });

  it('shows when there is work, no backup and no reminder yet', () => {
    expect(due()).toBe(true);
  });

  it('never shows without work of the person’s own', () => {
    expect(due({ hasWork: false })).toBe(false);
    expect(due({ hasWork: false, lastBackup: NOW - 90 * DAY })).toBe(false);
  });

  it('stays quiet while the last backup is under 14 days old', () => {
    expect(due({ lastBackup: NOW - 1000 })).toBe(false);
    expect(due({ lastBackup: NOW - 13 * DAY })).toBe(false);
    expect(due({ lastBackup: NOW - 14 * DAY + 1 })).toBe(false);
  });

  it('shows once the last backup is 14 days old or more', () => {
    expect(due({ lastBackup: NOW - 14 * DAY })).toBe(true);
    expect(due({ lastBackup: NOW - 60 * DAY })).toBe(true);
  });

  it('shows at most once a week', () => {
    expect(due({ lastShown: NOW - 60_000 })).toBe(false);
    expect(due({ lastShown: NOW - 6 * DAY })).toBe(false);
    expect(due({ lastShown: NOW - 7 * DAY + 1 })).toBe(false);
    expect(due({ lastShown: NOW - 7 * DAY })).toBe(true);
    expect(due({ lastBackup: NOW - 30 * DAY, lastShown: NOW - 8 * DAY })).toBe(true);
  });

  it('needs both: an old backup and no reminder in the last week', () => {
    expect(due({ lastBackup: NOW - 20 * DAY, lastShown: NOW - 2 * DAY })).toBe(false);
    expect(due({ lastBackup: NOW - 2 * DAY, lastShown: NOW - 20 * DAY })).toBe(false);
  });

  it('treats times well in the future as a clock that was set back', () => {
    // A backup "next month" can't be trusted, so it counts as long ago.
    expect(due({ lastBackup: NOW + 30 * DAY })).toBe(true);
    expect(due({ lastShown: NOW + 30 * DAY })).toBe(true);
    // A few minutes ahead is just clock drift: that reminder showed moments ago.
    expect(due({ lastShown: NOW + 5 * 60_000 })).toBe(false);
    expect(due({ lastBackup: NOW + 5 * 60_000 })).toBe(false);
  });

  it('ignores stored values that aren’t times', () => {
    expect(due({ lastBackup: Number.NaN, lastShown: Number.NaN })).toBe(true);
    expect(due({ lastBackup: -5 })).toBe(true);
  });
});

describe('work of the person’s own', () => {
  const samples = buildSeed(new Date(NOW)).decks;

  it('doesn’t count the samples, even after they were opened and saved', () => {
    const opened = samples.map((d) => ({ ...d, updatedAt: NOW }));
    expect(ownDecks(opened, samples)).toEqual([]);
  });

  it('doesn’t count an unedited copy of a sample', () => {
    const copy = { ...structuredClone(samples[0]), id: 'd_copy', title: `${samples[0].title} (copy)` };
    expect(ownDecks([...samples, copy], samples)).toEqual([]);
  });

  it('counts a sample whose slides were changed', () => {
    const edited = structuredClone(samples[1]);
    edited.slides[0].content = { ...edited.slides[0].content, title: 'My own title' };
    expect(ownDecks([samples[0], edited], samples).map((d) => d.id)).toEqual([edited.id]);
  });

  it('counts a new deck', () => {
    const mine = { ...structuredClone(samples[0]), id: 'd_mine', slides: samples[0].slides.slice(0, 2) };
    expect(ownDecks([...samples, mine], samples).map((d) => d.id)).toEqual(['d_mine']);
  });

  describe('in this browser', () => {
    beforeEach(async () => {
      await Promise.all(db.tables.map((t) => t.clear()));
    });

    it('is false with no decks or only the samples', async () => {
      expect(await hasOwnDecks()).toBe(false);
      await loadSampleData();
      const sample = (await db.decks.toArray())[0];
      await saveDeck(sample);
      expect(await hasOwnDecks()).toBe(false);
    });

    it('is true once a sample deck is edited', async () => {
      await loadSampleData();
      const sample = (await db.decks.toArray())[0];
      await saveDeck({ ...sample, slides: sample.slides.slice(1) });
      expect(await hasOwnDecks()).toBe(true);
    });
  });
});
