// Deck files (*.lectern.json): one deck with its pictures and its look, to keep
// or to open in another browser. Opening one always makes a new deck.

import { AUDIENCES, type Audience, type Deck, type DeckPurpose, PURPOSES, type Slide, deckPurpose, normalizeNotes, uid } from '../core/deck/types';
import { cleanElements } from '../core/engine/elements';
import { cleanOverride } from '../core/engine/overrides';
import { type Theme, allThemes, getTheme } from '../core/engine/themes';
import { registerCoreKinds } from '../core/kinds/core-kinds';
import { getKind } from '../core/kinds/registry';
import { type SharedAsset, sharedAsset } from '../core/share/protocol';
import { assetRefs, blobToDataUrl, dataUrlToBlob, renameAssets } from './blobs';
import { type Asset, db } from './db';
import { normalizeLook, saveLook } from './looks';
import { addDeck } from './repo';

export const DECK_FILE_FORMAT = 'lectern-deck';
export const DECK_FILE_VERSION = 1;
export const DECK_FILE_EXT = '.lectern.json';

export interface DeckFile {
  format: typeof DECK_FILE_FORMAT;
  version: typeof DECK_FILE_VERSION;
  /** When the file was saved (ISO time). */
  exportedAt?: string;
  deck: Deck;
  /** The deck's look, when it is one the person made. */
  theme?: Theme;
  /** Pictures the deck and its look use, as data URLs. Files saved before pictures were included have none. */
  assets?: SharedAsset[];
}

/** A file that can't be opened as a deck. The message is written for the person. */
export class DeckFileError extends Error {
  override name = 'DeckFileError';
}

const NOT_A_DECK = 'This isn’t a Lectern deck file. Choose a file that ends in .lectern.json.';

/** True when a file is a deck file by name, or a .json file that says it is one. */
export async function isDeckFile(file: Blob & { name?: string }): Promise<boolean> {
  const name = (file.name ?? '').toLowerCase();
  if (name.endsWith(DECK_FILE_EXT)) return true;
  if (!name.endsWith('.json')) return false;
  const head = await file.slice(0, 2048).text();
  return /"format"\s*:\s*"lectern-(deck|backup)"/.test(head);
}

// ─── Saving ───────────────────────────────────────────────────────────

export interface BuiltDeckFile {
  file: DeckFile;
  /** Pictures included. */
  pictures: number;
  /** Pictures the deck points to that aren't in this browser any more. */
  missing: number;
}

export async function buildDeckFile(deck: Deck): Promise<BuiltDeckFile> {
  // Older decks have no purpose and count as lessons through their lesson link, which the file leaves out.
  const copy: Deck = { ...structuredClone(deck), purpose: deckPurpose(deck) };
  delete copy.lessonId;
  const look = getTheme(deck.themeId);
  const theme = look.id === deck.themeId && look.custom ? look : undefined;
  const assets: SharedAsset[] = [];
  let missing = 0;
  for (const id of assetRefs({ deck: copy, theme })) {
    const asset = await db.assets.get(id);
    if (!asset) { missing++; continue; }
    assets.push(sharedAsset(asset, await blobToDataUrl(asset.blob)));
  }
  const file: DeckFile = {
    format: DECK_FILE_FORMAT,
    version: DECK_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    deck: copy,
    ...(theme ? { theme } : {}),
    assets,
  };
  return { file, pictures: assets.length, missing };
}

// ─── Reading ──────────────────────────────────────────────────────────

/**
 * Checks a stored deck and fills in anything missing. Slide kinds from mods that aren't
 * installed are kept as they are, so the deck still works where the mod is.
 */
export function normalizeDeck(value: unknown): Deck | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as Record<string, unknown>;
  if (!Array.isArray(d.slides)) return null;
  const seen = new Set<string>();
  const slides: Slide[] = [];
  for (const raw of d.slides) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    if (typeof s.kind !== 'string' || !s.kind.trim()) continue;
    let id = typeof s.id === 'string' && s.id ? s.id : uid('s');
    if (seen.has(id)) id = uid('s');
    seen.add(id);
    const elements = cleanElements(s.elements);
    slides.push({
      id,
      kind: s.kind,
      content: s.content && typeof s.content === 'object' && !Array.isArray(s.content) ? s.content as Record<string, unknown> : {},
      notes: normalizeNotes(s.notes),
      ...(typeof s.variant === 'string' && s.variant ? { variant: s.variant } : {}),
      ...(s.variantPinned === true ? { variantPinned: true } : {}),
      ...(s.hidden === true ? { hidden: true } : {}),
      ...overridesOf(s.overrides),
      ...(elements.length ? { elements } : {}),
    });
  }
  const now = Date.now();
  const positive = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : undefined);
  const minutes = positive(d.minutes);
  return {
    id: typeof d.id === 'string' && d.id ? d.id : uid('d'),
    title: typeof d.title === 'string' && d.title.trim() ? d.title : 'Untitled deck',
    themeId: typeof d.themeId === 'string' && d.themeId ? d.themeId : 'paper',
    audience: AUDIENCES.some((a) => a.id === d.audience) ? d.audience as Audience : 'adult',
    slides,
    ...(PURPOSES.some((p) => p.id === d.purpose) ? { purpose: d.purpose as DeckPurpose } : {}),
    ...(typeof d.lessonId === 'string' && d.lessonId ? { lessonId: d.lessonId } : {}),
    ...(minutes ? { minutes } : {}),
    createdAt: positive(d.createdAt) ?? now,
    updatedAt: positive(d.updatedAt) ?? now,
    ...(d.autoStyle === true ? { autoStyle: true } : {}),
    ...(typeof d.source === 'string' && d.source ? { source: d.source } : {}),
    ...(d.extra && typeof d.extra === 'object' && !Array.isArray(d.extra) ? { extra: d.extra as Deck['extra'] } : {}),
  };
}

/** Boxes moved by hand, as they were saved. */
function overridesOf(raw: unknown): Pick<Slide, 'overrides'> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: NonNullable<Slide['overrides']> = {};
  for (const [id, o] of Object.entries(raw)) {
    const clean = cleanOverride(o);
    if (clean && id.length <= 80) out[id] = clean;
  }
  return Object.keys(out).length ? { overrides: out } : {};
}

function isSharedAsset(value: unknown): value is SharedAsset {
  const a = value as SharedAsset | null;
  return !!a && typeof a.id === 'string' && !!a.id && typeof a.data === 'string' && a.data.startsWith('data:');
}

/** Reads a deck file's text, or explains why it can't be opened. */
export function readDeckFile(text: string): DeckFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DeckFileError(NOT_A_DECK);
  }
  if (!value || typeof value !== 'object') throw new DeckFileError(NOT_A_DECK);
  const o = value as Record<string, unknown>;
  if (o.format === 'lectern-backup') throw new DeckFileError('This file comes from inside a full Lectern backup. Restore the backup’s .zip file with “Restore from a backup” instead.');
  if (o.format !== DECK_FILE_FORMAT) throw new DeckFileError(NOT_A_DECK);
  const version = Number(o.version);
  if (Number.isInteger(version) && version > DECK_FILE_VERSION) {
    throw new DeckFileError('This deck file was saved by a newer version of Lectern. Reload Lectern to update it, then open the file again.');
  }
  if (version !== DECK_FILE_VERSION) throw new DeckFileError('This deck file is damaged, so it can’t be opened.');
  const deck = normalizeDeck(o.deck);
  if (!deck || !deck.slides.length) throw new DeckFileError('This deck file has no slides, so there’s nothing to open.');
  const theme = normalizeLook(o.theme) ?? undefined;
  const assets = Array.isArray(o.assets) ? o.assets.filter(isSharedAsset) : [];
  return {
    format: DECK_FILE_FORMAT,
    version: DECK_FILE_VERSION,
    ...(typeof o.exportedAt === 'string' ? { exportedAt: o.exportedAt } : {}),
    deck,
    ...(theme ? { theme } : {}),
    assets,
  };
}

export interface OpenedDeck {
  deck: Deck;
  /** Pictures the file brought with it. */
  pictures: number;
  /** Pictures the deck uses that the file didn't include and this browser doesn't have. */
  missing: number;
  /** Slides whose kind comes from a mod that isn't in this build. Their content is kept. */
  needMods: number;
}

/**
 * Opens a deck file as a new deck: it gets a new id, its pictures are stored,
 * and its look is added when this browser doesn't have it yet.
 */
export async function openDeckFile(input: string | Blob, options: { lessonId?: string } = {}): Promise<OpenedDeck> {
  const file = readDeckFile(typeof input === 'string' ? input : await input.text());
  const now = Date.now();
  const included = new Map((file.assets ?? []).map((a) => [a.id, a]));
  const renamed = new Map<string, string>();
  const add: Asset[] = [];
  let pictures = 0;
  let missing = 0;
  for (const id of assetRefs({ deck: file.deck, theme: file.theme })) {
    const item = included.get(id);
    const blob = item ? dataUrlToBlob(item.data, item.mime) : null;
    const here = await db.assets.get(id);
    if (!item || !blob) {
      if (!here) missing++;
      continue;
    }
    pictures++;
    // The same picture is already here (the deck came from this browser). Otherwise keep both.
    if (here && here.blob.size === blob.size) continue;
    const newId = here ? uid('a') : id;
    if (here) renamed.set(id, newId);
    const credit = item.credit && typeof item.credit === 'object' ? item.credit : undefined;
    add.push({ id: newId, blob, mime: item.mime || blob.type, name: item.name || 'image', createdAt: now, ...(credit ? { credit } : {}) });
  }

  const deck: Deck = { ...renameAssets(file.deck, renamed), id: uid('d'), purpose: deckPurpose(file.deck), createdAt: now, updatedAt: now };
  delete deck.lessonId;
  if (options.lessonId) deck.lessonId = options.lessonId;
  const theme = file.theme ? renameAssets(file.theme, renamed) : undefined;

  if (add.length) await db.assets.bulkPut(add);
  if (theme && theme.id === deck.themeId && !allThemes().some((t) => t.id === theme.id)) await saveLook(theme);
  await addDeck(deck);
  registerCoreKinds();
  return { deck, pictures, missing, needMods: deck.slides.filter((s) => !getKind(s.kind)).length };
}
