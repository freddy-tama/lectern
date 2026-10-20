// Pictures in this browser: each one is an asset with its credit, plus a small memory of
// starred pictures (offered again for similar searches) and search results someone removed.

import { useLiveQuery } from 'dexie-react-hooks';
import { uid } from '../../core/deck/types';
import type { PictureCredit } from '../../core/pictures/credits';
import { searchWords } from '../../core/pictures/rank';
import { type Asset, db } from '../../data/db';

// ─── Preparing a file ─────────────────────────────────────────────────

const MAX_SIDE = 2400;

async function sizeOf(blob: Blob): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Checks a file really is a picture and makes it slide-sized: very large photos are scaled to
 * 2400 px on the long side, and WebP becomes JPEG or PNG so PowerPoint can use it as it is.
 * GIFs (which may move) and SVGs are kept as they are.
 */
export async function preparePicture(blob: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  if (blob.type === 'image/svg+xml' || blob.type === 'image/gif') {
    const size = await sizeOf(blob);
    if (!size) throw new Error('This file isn’t a picture that can be shown.');
    return { blob, ...size };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('This file isn’t a picture that can be shown. Try a JPEG, PNG, WebP or GIF.');
  }
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const reencode = scale < 1 || blob.type === 'image/webp' || blob.size > 3_000_000;
    if (!reencode) return { blob, width, height };
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d')!;
    // PNGs and WebPs may be see-through; keep that unless the file is big (then it's a photo).
    const alpha = (blob.type === 'image/png' || blob.type === 'image/webp') && blob.size < 4_000_000;
    if (!alpha) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const type = alpha ? 'image/png' : 'image/jpeg';
    const out = await new Promise<Blob | null>((done) => canvas.toBlob(done, type, 0.88));
    if (!out) return { blob, width, height };
    // A re-encode that came out bigger isn't worth it, unless it removed WebP.
    return out.size < blob.size || blob.type === 'image/webp' ? { blob: out, width: canvas.width, height: canvas.height } : { blob, width, height };
  } finally {
    bitmap.close();
  }
}

/** Stores a picture with its credit. Returns its "asset:<id>" reference. */
export async function savePicture(file: Blob, name: string, credit: Omit<PictureCredit, 'addedAt' | 'width' | 'height'>): Promise<string> {
  const ready = await preparePicture(file);
  const asset: Asset = {
    id: uid('a'),
    blob: ready.blob,
    mime: ready.blob.type || file.type || 'application/octet-stream',
    name: name.slice(0, 160) || 'Picture',
    createdAt: Date.now(),
    credit: { ...credit, width: ready.width, height: ready.height, addedAt: Date.now() },
  };
  await db.assets.add(asset);
  return `asset:${asset.id}`;
}

const assetId = (ref: string) => (ref.startsWith('asset:') ? ref.slice(6) : '');

export async function pictureCredit(ref: string): Promise<PictureCredit | null> {
  const id = assetId(ref);
  return id ? (await db.assets.get(id))?.credit ?? null : null;
}

/** Credits for many pictures at once, keyed by reference. */
export async function pictureCredits(refs: string[]): Promise<Map<string, PictureCredit>> {
  const ids = [...new Set(refs.map(assetId).filter(Boolean))];
  const assets = await db.assets.bulkGet(ids);
  const out = new Map<string, PictureCredit>();
  assets.forEach((a) => { if (a?.credit) out.set(`asset:${a.id}`, a.credit); });
  return out;
}

/** Edits a picture's credit. Pictures stored before credits existed get one. */
export async function updateCredit(ref: string, patch: Partial<PictureCredit>) {
  const id = assetId(ref);
  if (!id) return;
  const asset = await db.assets.get(id);
  if (!asset) return;
  const credit: PictureCredit = { source: 'upload', rights: 'own', addedAt: asset.createdAt, ...asset.credit, ...patch };
  await db.assets.update(id, { credit });
}

/** The credit of one picture, kept up to date. undefined while loading. */
export function useCredit(ref: string): PictureCredit | null | undefined {
  return useLiveQuery(() => (ref ? pictureCredit(ref) : null), [ref]);
}

// ─── Memory: starred pictures and removed results ─────────────────────

interface Starred {
  ref: string;
  /** Search words the picture was found or starred with, to offer it for similar searches. */
  words: string[];
  title: string;
  at: number;
}

interface PictureMemory {
  starred: Starred[];
  /** Removed search result ids, by search. */
  dismissed: Record<string, string[]>;
}

const MEMORY_KEY = 'pictures';
const EMPTY: PictureMemory = { starred: [], dismissed: {} };

/** Searches with the same words in any order count as the same search. */
export function queryKey(query: string): string {
  return searchWords(query).sort().join(' ');
}

async function readMemory(): Promise<PictureMemory> {
  const value = (await db.settings.get(MEMORY_KEY))?.value as Partial<PictureMemory> | undefined;
  return { starred: Array.isArray(value?.starred) ? value.starred : [], dismissed: value?.dismissed && typeof value.dismissed === 'object' ? value.dismissed : {} };
}

async function changeMemory(fn: (m: PictureMemory) => PictureMemory) {
  await db.transaction('rw', db.settings, async () => {
    await db.settings.put({ key: MEMORY_KEY, value: fn(await readMemory()) });
  });
}

export function usePictureMemory(): PictureMemory {
  return useLiveQuery(readMemory, []) ?? EMPTY;
}

export async function starPicture(ref: string, words: string[], title: string) {
  await changeMemory((m) => ({ ...m, starred: [{ ref, words: [...new Set(words)].slice(0, 24), title, at: Date.now() }, ...m.starred.filter((s) => s.ref !== ref)].slice(0, 300) }));
}

export async function unstarPicture(ref: string) {
  await changeMemory((m) => ({ ...m, starred: m.starred.filter((s) => s.ref !== ref) }));
}

export const isStarred = (memory: PictureMemory, ref: string) => memory.starred.some((s) => s.ref === ref);

/** Starred pictures that share a word with the search, best match first, then the newest. */
export function starredFor(memory: PictureMemory, query: string): Starred[] {
  const words = searchWords(query);
  const scored = memory.starred.map((s) => ({ s, hits: words.filter((w) => s.words.some((k) => k.includes(w) || w.includes(k))).length }));
  return scored.filter((x) => !words.length || x.hits > 0).sort((a, b) => b.hits - a.hits || b.s.at - a.s.at).map((x) => x.s);
}

/** Don't suggest this result again for this search. */
export async function dismissResult(query: string, id: string) {
  const key = queryKey(query);
  if (!key || !id) return;
  await changeMemory((m) => {
    const keys = Object.keys(m.dismissed).filter((k) => k !== key);
    const dismissed: Record<string, string[]> = {};
    // Keep the 200 most recent searches.
    for (const k of keys.slice(-199)) dismissed[k] = m.dismissed[k];
    dismissed[key] = [...new Set([...(m.dismissed[key] ?? []), id])].slice(-200);
    return { ...m, dismissed };
  });
}

export async function undismissResult(query: string, id: string) {
  const key = queryKey(query);
  await changeMemory((m) => ({ ...m, dismissed: { ...m.dismissed, [key]: (m.dismissed[key] ?? []).filter((x) => x !== id) } }));
}

export const dismissedFor = (memory: PictureMemory, query: string) => new Set(memory.dismissed[queryKey(query)] ?? []);
