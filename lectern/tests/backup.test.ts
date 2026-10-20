// @vitest-environment node
import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Deck, emptyNotes } from '../src/core/deck/types';
import { THEMES, type Theme, getTheme } from '../src/core/engine/themes';
import { BackupError, createBackup, openBackup, restoreBackup } from '../src/data/backup';
import { blobToDataUrl, dataUrlToBlob } from '../src/data/blobs';
import { type Recording, db } from '../src/data/db';
import { DeckFileError, buildDeckFile, isDeckFile, openDeckFile, readDeckFile } from '../src/data/deck-file';
import { deleteLook, saveLook } from '../src/data/looks';
import { saveAsset } from '../src/data/repo';
import { formatBytes, isQuotaError } from '../src/data/storage';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const AUDIO = new Uint8Array(4096).map((_, i) => i % 251);

async function clearAll() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

async function bytesOf(ref: string) {
  const asset = await db.assets.get(ref.replace(/^asset:/, ''));
  return asset ? new Uint8Array(await asset.blob.arrayBuffer()) : null;
}

function makeDeck(image: string, patch: Partial<Deck> = {}): Deck {
  return {
    id: 'd_original',
    title: 'Tide pools',
    themeId: 'paper',
    audience: 'adult',
    purpose: 'talk',
    lessonId: 'l_somewhere',
    slides: [
      { id: 's1', kind: 'title', content: { eyebrow: '', title: 'Tide pools', subtitle: 'Life between tides', presenter: '', image }, notes: emptyNotes({ script: 'Welcome everyone.', keyPoints: ['Tides shape habitats'] }) },
      { id: 's2', kind: 'chinese.word', content: { hanzi: '海', pinyin: 'hǎi', meaning: 'sea' }, notes: emptyNotes({ extra: { 'lesson-plan': { goal: 'Read 海' } } }) },
    ],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    ...patch,
  };
}

function look(patch: Partial<Theme> = {}): Theme {
  return { ...THEMES[0], id: 'look_bloom', name: 'Bloom', description: 'Your own look.', custom: true, baseId: THEMES[0].id, logoPosition: 'top-right', footerText: 'Bloom Co.', ...patch };
}

beforeEach(clearAll);

describe('data URLs', () => {
  it('turn blobs into text and back', async () => {
    const url = await blobToDataUrl(new Blob([PNG], { type: 'image/png' }));
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    const blob = dataUrlToBlob(url)!;
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PNG);
    expect(await dataUrlToBlob('data:image/svg+xml,%3Csvg%2F%3E')!.text()).toBe('<svg/>');
    expect(dataUrlToBlob('https://example.com/a.png')).toBeNull();
  });
});

describe('deck files', () => {
  it('round-trip a deck with its picture and look, as a new deck', async () => {
    const image = await saveAsset(new Blob([PNG], { type: 'image/png' }), 'pool.png');
    const logo = await saveAsset(new Blob([PNG.slice(0, 12)], { type: 'image/png' }), 'logo.png');
    await saveLook(look({ logo, logoAspect: 2 }));
    const deck = makeDeck(image, { themeId: 'look_bloom' });
    await db.decks.put(deck);

    const built = await buildDeckFile(deck);
    expect(built.pictures).toBe(2);
    expect(built.missing).toBe(0);
    expect(built.file.deck.lessonId).toBeUndefined();
    expect(built.file.theme?.id).toBe('look_bloom');
    const text = JSON.stringify(built.file, null, 2);

    // Another browser: no deck, no pictures, no look.
    await clearAll();
    await deleteLook('look_bloom');
    expect(getTheme('look_bloom').id).not.toBe('look_bloom');

    const opened = await openDeckFile(text);
    expect(opened.deck.id).not.toBe('d_original');
    expect(opened.deck.lessonId).toBeUndefined();
    expect(opened.pictures).toBe(2);
    expect(opened.missing).toBe(0);
    expect(opened.needMods).toBe(1);

    const stored = await db.decks.get(opened.deck.id);
    expect(stored?.title).toBe('Tide pools');
    expect(stored?.slides.map((s) => s.kind)).toEqual(['title', 'chinese.word']);
    expect(stored?.slides[1].content).toEqual({ hanzi: '海', pinyin: 'hǎi', meaning: 'sea' });
    expect(stored?.slides[1].notes.extra).toEqual({ 'lesson-plan': { goal: 'Read 海' } });
    expect(stored?.slides[0].notes.script).toBe('Welcome everyone.');
    expect(await bytesOf(String(stored?.slides[0].content.image))).toEqual(PNG);

    expect(getTheme('look_bloom').name).toBe('Bloom');
    expect(await bytesOf(getTheme('look_bloom').logo!)).toEqual(PNG.slice(0, 12));
  });

  it('links to a lesson when opened for one, and reuses or keeps apart pictures already here', async () => {
    const image = await saveAsset(new Blob([PNG], { type: 'image/png' }));
    const { file } = await buildDeckFile(makeDeck(image));
    const text = JSON.stringify(file);

    const same = await openDeckFile(text, { lessonId: 'l_new' });
    expect(same.deck.lessonId).toBe('l_new');
    expect(same.deck.slides[0].content.image).toBe(image);
    expect(await db.assets.count()).toBe(1);

    // A different picture under the same id gets a new id, so neither is lost.
    await db.assets.put({ id: image.slice(6), blob: new Blob([PNG.slice(0, 3)], { type: 'image/png' }), mime: 'image/png', name: 'other', createdAt: 1 });
    const apart = await openDeckFile(text);
    expect(apart.deck.slides[0].content.image).not.toBe(image);
    expect(await bytesOf(String(apart.deck.slides[0].content.image))).toEqual(PNG);
    expect(await bytesOf(image)).toEqual(PNG.slice(0, 3));
  });

  it('counts pictures an old file without them is missing, and keeps a lesson deck a lesson', async () => {
    const deck = makeDeck('asset:a_gone');
    delete deck.purpose;
    const old = JSON.stringify({ format: 'lectern-deck', version: 1, deck });
    const opened = await openDeckFile(old);
    expect(opened.missing).toBe(1);
    expect(opened.deck.slides).toHaveLength(2);
    expect(opened.deck.lessonId).toBeUndefined();
    expect(opened.deck.purpose).toBe('lesson');
    expect((await buildDeckFile(deck)).file.deck.purpose).toBe('lesson');
  });

  it('explains files it can’t open', () => {
    expect(() => readDeckFile('not json')).toThrow(DeckFileError);
    expect(() => readDeckFile('{"title":"x"}')).toThrow(/isn’t a Lectern deck file/);
    expect(() => readDeckFile(JSON.stringify({ format: 'lectern-deck', version: 2, deck: makeDeck('') }))).toThrow(/newer version of Lectern/);
    expect(() => readDeckFile(JSON.stringify({ format: 'lectern-backup', version: 1 }))).toThrow(/Restore from a backup/);
    expect(() => readDeckFile(JSON.stringify({ format: 'lectern-deck', version: 1, deck: { title: 'x', slides: [] } }))).toThrow(/no slides/);
  });

  it('recognises deck files by name or content', async () => {
    const named = Object.assign(new Blob(['{}']), { name: 'Talk.lectern.json' });
    const sniffed = Object.assign(new Blob(['{\n  "format": "lectern-deck",\n  "version": 1 }']), { name: 'Talk (1).json' });
    const outline = Object.assign(new Blob(['{"slides": []}']), { name: 'outline.json' });
    expect(await isDeckFile(named)).toBe(true);
    expect(await isDeckFile(sniffed)).toBe(true);
    expect(await isDeckFile(outline)).toBe(false);
    expect(await isDeckFile(Object.assign(new Blob(['# Hi']), { name: 'notes.md' }))).toBe(false);
  });
});

describe('backups', () => {
  async function seed() {
    const image = await saveAsset(new Blob([PNG], { type: 'image/png' }), 'pool.png');
    await saveAsset(new Blob([PNG.slice(0, 5)], { type: 'image/png' }), 'unused.png');
    const audio = await saveAsset(new Blob([AUDIO], { type: 'audio/webm' }), 'recording:week 1');
    await db.courses.put({ id: 'c1', title: 'Marine biology', subject: 'Science', description: '', color: 'teal', startDate: '2026-09-07', weekTitles: {}, createdAt: 1, updatedAt: 10 });
    await db.lessons.put({ id: 'l1', courseId: 'c1', week: 1, order: 0, title: 'Tides', summary: '', deckId: 'd_original', createdAt: 1, updatedAt: 10 });
    await db.decks.put(makeDeck(image, { lessonId: 'l1' }));
    await db.notes.put({ id: 'n1', title: 'After class', body: 'Went well', tags: ['reflection'], lessonId: 'l1', createdAt: 1, updatedAt: 10 });
    const recording: Recording = {
      id: 'r1', title: 'Week 1 lecture', courseId: 'c1', durationSec: 60, audio, mime: 'audio/webm', size: AUDIO.length, status: 'done',
      segments: [{ start: 0, end: 4, text: 'Tides come twice a day.' }], createdAt: 1, updatedAt: 10,
    };
    await db.recordings.put(recording);
    await db.study.put({ deckId: 'd_original', slideId: 's1', status: 'known', updatedAt: 10 });
    await db.settings.put({ key: 'looks', value: [look()] });
    await db.settings.put({ key: 'seeded', value: true });
    return { image, audio };
  }

  it('back up everything and restore it into an empty browser', async () => {
    const { image } = await seed();
    const made = await createBackup();
    expect(made.fileName).toMatch(/^Lectern backup \d{4}-\d{2}-\d{2}\.zip$/);
    expect(made.counts).toMatchObject({ decks: 1, courses: 1, lessons: 1, notes: 1, recordings: 1, pictures: 1, audio: 0 });

    await clearAll();
    const backup = await openBackup(made.blob);
    expect(backup.conflicts).toEqual([]);
    expect(backup.manifest.audio).toBe(false);
    const result = await restoreBackup(backup);
    expect(result.added).toMatchObject({ decks: 1, courses: 1, lessons: 1, notes: 1, recordings: 1, pictures: 1, audio: 0 });
    expect(result.withoutAudio).toBe(1);
    expect(result.looks).toBe(1);

    expect((await db.decks.get('d_original'))?.lessonId).toBe('l1');
    expect(await bytesOf(image)).toEqual(PNG);
    expect(await db.assets.count()).toBe(1); // the unused picture and the audio stayed out
    const rec = await db.recordings.get('r1');
    expect(rec?.segments[0].text).toBe('Tides come twice a day.');
    expect(rec?.audio).toBe('');
    expect(await db.study.get(['d_original', 's1'])).toMatchObject({ status: 'known' });
    expect((await db.settings.get('looks'))?.value).toHaveLength(1);
    expect((await db.notes.get('n1'))?.body).toBe('Went well');
  });

  it('includes recordings’ audio when asked', async () => {
    const { audio } = await seed();
    const made = await createBackup({ audio: true });
    expect(made.counts.audio).toBe(1);
    const zip = await JSZip.loadAsync(new Uint8Array(await made.blob.arrayBuffer()));
    expect(Object.keys(zip.files).some((f) => f.endsWith('.webm'))).toBe(true);

    await clearAll();
    const result = await restoreBackup(await openBackup(made.blob));
    expect(result.added.audio).toBe(1);
    expect(result.withoutAudio).toBe(0);
    expect((await db.recordings.get('r1'))?.audio).toBe(audio);
    expect(await bytesOf(audio)).toEqual(AUDIO);
  });

  it('merges without wiping: keeps newer work, and replaces or copies decks that differ', async () => {
    await seed();
    const made = await createBackup();

    // Changes after the backup: a newer note, a new course, an edited deck.
    await db.notes.update('n1', { body: 'Edited later', updatedAt: 20 });
    await db.courses.put({ id: 'c2', title: 'Art', subject: '', description: '', color: 'plum', startDate: '2026-09-07', weekTitles: {}, createdAt: 1, updatedAt: 1 });
    await db.decks.update('d_original', { title: 'Tide pools, edited', updatedAt: 1_800_000_000_000 });

    const again = await openBackup(made.blob);
    expect(again.conflicts).toEqual([{ id: 'd_original', title: 'Tide pools, edited', newerHere: true }]);

    const copied = await restoreBackup(again, 'copy');
    expect(copied.decksCopied).toBe(1);
    expect(copied.added.decks).toBe(0);
    expect(copied.added.notes).toBe(0);
    expect((await db.notes.get('n1'))?.body).toBe('Edited later');
    expect(await db.courses.get('c2')).toBeTruthy();
    const decks = await db.decks.toArray();
    expect(decks.map((d) => d.title).sort()).toEqual(['Tide pools (from backup)', 'Tide pools, edited']);
    expect(decks.find((d) => d.title.endsWith('(from backup)'))?.lessonId).toBeUndefined();

    const replaced = await restoreBackup(await openBackup(made.blob), 'replace');
    expect(replaced.decksReplaced).toBe(1);
    expect((await db.decks.get('d_original'))?.title).toBe('Tide pools');
    // The recording's audio is still here, so its link is kept even though the backup has no audio.
    expect((await db.recordings.get('r1'))?.audio).toMatch(/^asset:/);
  });

  it('explains files it can’t restore', async () => {
    await expect(openBackup(new Blob(['hello']))).rejects.toThrow(BackupError);
    const zip = new JSZip();
    zip.file('lectern-backup.json', JSON.stringify({ format: 'lectern-backup', version: 9, tables: {}, assets: [] }));
    const newer = new Blob([await zip.generateAsync({ type: 'uint8array' }) as Uint8Array<ArrayBuffer>]);
    await expect(openBackup(newer)).rejects.toThrow(/newer version of Lectern/);
    const other = new JSZip();
    other.file('readme.txt', 'hi');
    await expect(openBackup(new Blob([await other.generateAsync({ type: 'uint8array' }) as Uint8Array<ArrayBuffer>]))).rejects.toThrow(/isn’t a Lectern backup/);
  });
});

describe('picture credits', () => {
  const credit = { source: 'openverse' as const, rights: 'credit' as const, title: 'Tide pool', author: 'A. Diver', license: 'CC BY 4.0', page: 'https://example.org/tide', addedAt: 5 };

  async function creditedDeck() {
    const image = await saveAsset(new Blob([PNG], { type: 'image/png' }), 'pool.png');
    await db.assets.update(image.slice(6), { credit });
    const deck = makeDeck(image);
    await db.decks.put(deck);
    return { image, deck };
  }

  it('travel with a deck file', async () => {
    const { deck } = await creditedDeck();
    const text = JSON.stringify((await buildDeckFile(deck)).file);
    await clearAll();
    const opened = await openDeckFile(text);
    const ref = String(opened.deck.slides[0].content.image).slice(6);
    expect((await db.assets.get(ref))?.credit).toEqual(credit);
  });

  it('travel with a backup', async () => {
    const { image } = await creditedDeck();
    const made = await createBackup();
    await clearAll();
    await restoreBackup(await openBackup(made.blob));
    expect((await db.assets.get(image.slice(6)))?.credit).toEqual(credit);
  });
});

describe('storage helpers', () => {
  it('recognises quota errors, also when Dexie wraps them', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'AbortError', message: 'aborted', inner: { name: 'QuotaExceededError' } })).toBe(true);
    expect(isQuotaError(new Error('Network down'))).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(24 * 1024 * 1024)).toBe('24 MB');
    expect(formatBytes(1.25 * 1024 ** 3)).toBe('1.3 GB');
  });
});
