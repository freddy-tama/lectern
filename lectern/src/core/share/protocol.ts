// Sharing a deck with phones: join codes, what each role receives, and the
// messages a live link carries. Framework-free so it can be tested on its own.

import type { Deck, Slide } from '../deck/types';
import { deckPurpose, emptyNotes } from '../deck/types';
import type { Theme } from '../engine/themes';
import { type CloudWord, perPerson } from '../kinds/live-kinds';
import type { PictureCredit } from '../pictures/credits';
import type { Asset } from '../../data/db';
import type { PlayerView, QuizStage, QuizView } from './quiz';

/** The presenter's own phone (teleprompter and remote) or someone watching. */
export type Role = 'presenter' | 'audience';

/** What viewers get. The presenter's phone always gets everything. */
export interface ShareOptions {
  /** Viewers can save the deck as PowerPoint (without your script). */
  allowDownload: boolean;
  /** Viewers see each slide's takeaways and question under the slide. */
  shareTakeaways: boolean;
  /** Viewers can answer question slides that have choices. */
  polls: boolean;
}

export const DEFAULT_OPTIONS: ShareOptions = { allowDownload: true, shareTakeaways: false, polls: true };

/** Same shape as the presenter windows' show state, so a link can relay it as is. */
export interface LiveState {
  index: number;
  step: number;
  blank: boolean;
  flags: Record<string, boolean>;
  startedAt: number | null;
}

export interface SharedAsset {
  id: string;
  mime: string;
  name: string;
  /** Base64 data URL. */
  data: string;
  /** Where a picture came from, so the phone can credit it too. */
  credit?: PictureCredit;
}

/** Everything a phone needs to show the deck with no further connection. */
export interface SharePackage {
  format: 'lectern-share';
  version: 1;
  role: Role;
  deck: Deck;
  /** The deck's look, when it is a custom one the phone may not have. */
  theme?: Theme;
  assets: SharedAsset[];
  options: ShareOptions;
}

export interface PollResult {
  counts: number[];
  total: number;
}

/** A word cloud's answers so far: the words, and how many people sent any. */
export interface CloudResult {
  words: CloudWord[];
  people: number;
}

/** Host to phone. */
export type HostMessage =
  | { t: 'welcome'; role: Role; title: string; parts: number; bytes: number; same?: boolean }
  | { t: 'part'; i: number; data: string }
  | { t: 'state'; state: LiveState }
  | { t: 'votes'; slideId: string; result: PollResult }
  | { t: 'words'; slideId: string; result: CloudResult }
  | { t: 'options'; options: ShareOptions }
  | { t: 'quiz'; quiz: QuizView; stage: QuizStage }
  | { t: 'you'; you: PlayerView }
  | { t: 'bye' };

/** Phone to host. */
export type GuestMessage =
  | { t: 'state'; state: LiveState }
  | { t: 'vote'; slideId: string; choice: number }
  | { t: 'word'; slideId: string; text: string }
  | { t: 'answer'; slideId: string; choice: number }
  | { t: 'name'; name: string }
  | { t: 'stage'; stage: QuizStage };

/** Sent when a phone connects. */
export interface JoinMetadata {
  /** The presenter token from the private link, if any. */
  token?: string;
  /** updatedAt of the copy the phone already has, so an unchanged deck isn't sent again. */
  have?: number;
  device: string;
  /** A stable id per phone, so scores survive reconnecting. */
  player?: string;
  /** The name to show on the leaderboard. */
  name?: string;
}

// ─── Codes and links ──────────────────────────────────────────────────

/** No 0/O, 1/I/L: easy to read out loud and type. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function random(length: number, alphabet = ALPHABET): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function newCode(): string {
  return random(6);
}

export function newToken(): string {
  return random(20, 'abcdefghijkmnopqrstuvwxyz23456789');
}

/** Upper case, without spaces or dashes; returns '' if it can't be a code. */
export function normalizeCode(input: string): string {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === 6 && [...code].every((c) => ALPHABET.includes(c)) ? code : '';
}

/** "ABC123" → "ABC 123", for reading. */
export function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export function peerIdFor(code: string): string {
  return `lectern-v1-${code}`;
}

/** The link a QR code opens. The presenter token rides in the fragment, which never reaches a server. */
export function joinUrl(origin: string, code: string, token?: string): string {
  return `${origin}/join/${code}${token ? `#p=${token}` : ''}`;
}

export function tokenFromHash(hash: string): string | undefined {
  const m = /[#&]p=([a-z0-9]+)/.exec(hash);
  return m?.[1];
}

// ─── Packages ─────────────────────────────────────────────────────────

/**
 * The deck as a role sees it. The presenter gets everything. Viewers get the visible
 * slides only, never the script, cues or mod fields, and the takeaways only when shared.
 */
export function deckForRole(deck: Deck, role: Role, options: ShareOptions): Deck {
  const purpose = deckPurpose(deck);
  const base: Deck = { ...deck, purpose };
  delete base.lessonId;
  if (role === 'presenter') return base;
  delete base.extra;
  return {
    ...base,
    slides: deck.slides.filter((s) => !s.hidden).map((s): Slide => ({
      id: s.id,
      kind: s.kind,
      content: s.content,
      ...(s.variant ? { variant: s.variant } : {}),
      notes: options.shareTakeaways
        ? emptyNotes({ keyPoints: s.notes.keyPoints, check: s.notes.check, links: s.notes.links, minutes: s.notes.minutes })
        : emptyNotes({ minutes: s.notes.minutes }),
    })),
  };
}

/** Every "asset:<id>" reference inside a value. */
export function assetIds(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (value.startsWith('asset:')) found.add(value.slice(6));
  } else if (Array.isArray(value)) {
    for (const v of value) assetIds(v, found);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) assetIds(v, found);
  }
  return found;
}

/** A stored picture as it travels to a phone: the file, with its credit. */
export function sharedAsset(asset: Pick<Asset, 'id' | 'mime' | 'name' | 'credit'>, data: string): SharedAsset {
  return { id: asset.id, mime: asset.mime, name: asset.name, data, ...(asset.credit ? { credit: asset.credit } : {}) };
}

function dataUrlToBlob(data: string): Blob {
  const [head = '', body = ''] = data.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bytes = atob(body);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** A picture from a share package, ready to keep on the phone with its credit. */
export function receivedAsset(shared: SharedAsset, now = Date.now()): Asset {
  const credit = shared.credit && typeof shared.credit === 'object' ? shared.credit : undefined;
  return { id: shared.id, blob: dataUrlToBlob(shared.data), mime: shared.mime, name: shared.name, createdAt: now, ...(credit ? { credit } : {}) };
}

/** Splits text into parts small enough for any browser's data channel. */
/**
 * Cuts text into parts that each stay under maxBytes once sent. The data channel
 * refuses any single message of about 16 KB or more, and quotes, accents and
 * other scripts make the sent form larger than the character count.
 */
export function splitParts(text: string, maxBytes = 12_000): string[] {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let size = maxBytes;
  for (let i = 0; i < text.length;) {
    let slice = text.slice(i, i + size);
    let bytes = encoder.encode(JSON.stringify(slice)).length;
    while (bytes > maxBytes && slice.length > 1) {
      slice = slice.slice(0, Math.max(1, Math.floor(slice.length * (maxBytes / bytes) * 0.95)));
      bytes = encoder.encode(JSON.stringify(slice)).length;
    }
    // Don't split a surrogate pair across two parts.
    const last = slice.charCodeAt(slice.length - 1);
    if (slice.length > 1 && last >= 0xd800 && last <= 0xdbff) slice = slice.slice(0, -1);
    parts.push(slice);
    i += slice.length;
    // Start the next part from a size that worked, growing back when text gets plainer.
    size = Math.min(maxBytes, Math.max(slice.length, Math.floor(slice.length * 1.25)));
  }
  return parts.length ? parts : [''];
}

/** Collects numbered parts in any order. */
export class PartCollector {
  private parts: (string | undefined)[];
  private received = 0;

  constructor(readonly total: number) {
    this.parts = new Array(total);
  }

  add(i: number, data: string): boolean {
    if (i < 0 || i >= this.total || this.parts[i] !== undefined) return this.done;
    this.parts[i] = data;
    this.received += 1;
    return this.done;
  }

  get done() {
    return this.received === this.total;
  }

  get progress() {
    return this.total ? this.received / this.total : 1;
  }

  text(): string {
    return this.parts.join('');
  }
}

export function isPackage(value: unknown): value is SharePackage {
  const v = value as SharePackage | null;
  return !!v && v.format === 'lectern-share' && v.version === 1 && !!v.deck && Array.isArray(v.deck.slides) && Array.isArray(v.assets);
}

// ─── Polls ────────────────────────────────────────────────────────────

/** The choices of a question slide, or null when the slide isn't a poll. */
export function pollChoices(slide: Pick<Slide, 'kind' | 'content'> | undefined): string[] | null {
  if (!slide || slide.kind !== 'question') return null;
  const options = (slide.content as { options?: unknown }).options;
  if (!Array.isArray(options)) return null;
  const list = options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0).slice(0, 6);
  return list.length >= 2 ? list : null;
}

/** Counts one vote per device. */
export function tally(votes: Map<string, number>, choices: number): PollResult {
  const counts = new Array(choices).fill(0) as number[];
  let total = 0;
  for (const choice of votes.values()) {
    if (choice >= 0 && choice < choices) { counts[choice]! += 1; total += 1; }
  }
  return { counts, total };
}

// ─── Word clouds ──────────────────────────────────────────────────────

/** Most different words a cloud keeps; the rest are too rare to show. */
export const CLOUD_WORDS = 60;

/** How many answers one phone may send to a word cloud slide, or null when the slide isn't one. */
export function cloudLimit(slide: Pick<Slide, 'kind' | 'content'> | undefined): number | null {
  if (!slide || slide.kind !== 'wordcloud') return null;
  return perPerson(slide.content ?? {});
}

/** One answer as the cloud shows it: one line, no stray punctuation at the ends, at most 32 characters. */
export function cleanWord(input: string): string {
  return String(input ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'“”‘’.,;:!?()[\]{}<>*_~`-]+|[\s"'“”‘’.,;:!?()[\]{}<>*_~`-]+$/g, '')
    .slice(0, 32)
    .trim();
}

/** The key two answers share when they are the same word: case and Latin accents aside. */
export function wordKey(word: string): string {
  return cleanWord(word).toLocaleLowerCase().normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC');
}

/**
 * Counts each word once per phone, most common first. The spelling shown is the one
 * most people used. Hidden words (by key) are left out.
 */
export function tallyWords(answers: Map<string, string[]>, hidden: ReadonlySet<string> = new Set()): CloudResult {
  const words = new Map<string, { count: number; spellings: Map<string, number>; first: number }>();
  let order = 0;
  let people = 0;
  for (const list of answers.values()) {
    const seen = new Set<string>();
    for (const raw of list) {
      const text = cleanWord(raw);
      const key = wordKey(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (hidden.has(key)) continue;
      const w = words.get(key) ?? { count: 0, spellings: new Map<string, number>(), first: order++ };
      w.count += 1;
      w.spellings.set(text, (w.spellings.get(text) ?? 0) + 1);
      words.set(key, w);
    }
    if (seen.size) people += 1;
  }
  const list = [...words.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .slice(0, CLOUD_WORDS)
    .map((w) => ({ text: [...w.spellings.entries()].sort((a, b) => b[1] - a[1])[0]![0], count: w.count }));
  return { words: list, people };
}

/** The slide with live answers in place of the words it stores, so every screen draws the same cloud. */
export function withLiveWords<S extends Pick<Slide, 'kind' | 'content'>>(slide: S, result: CloudResult | undefined): S {
  if (slide.kind !== 'wordcloud' || !result || !result.words.length) return slide;
  return { ...slide, content: { ...slide.content, answers: result.words.map((w) => ({ text: w.text, count: String(w.count) })) } };
}

// ─── Devices ──────────────────────────────────────────────────────────

/** A friendly name for the connecting device. */
export function deviceLabel(ua: string): string {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/Linux/i.test(ua)) return 'Linux computer';
  return 'Device';
}
