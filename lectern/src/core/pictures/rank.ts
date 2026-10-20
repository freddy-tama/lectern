// Ranks picture search results for a slide: relevant, big enough, the right shape and free to
// reuse come first. Logos and icons are dropped unless they're what was searched for.

import type { FoundPicture } from '../../../api/picture-search';
import { type PictureRights, rightsOf } from './credits';

export type { FoundPicture };
export type PictureShape = 'wide' | 'tall' | 'square';

export interface RankedPicture extends FoundPicture {
  rights: PictureRights;
  score: number;
}

const TARGET_RATIO: Record<PictureShape, number> = { wide: 16 / 9, tall: 3 / 4, square: 1 };
const RASTER = /^image\/(jpeg|png|webp|gif)$/i;
const LOGO = /\b(logos?|logotype|wordmark|icons?|icon ?set|favicon|emoji|emoticons?|pictograms?|clip ?art|emblem|coat of arms|seal of|badges?|sprites?|avatar)\b/i;
const WEAK = /\b(screenshot|screen shot|watermark|locator map|blank map|flag of|coat of arms)\b/i;
const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'at', 'for', 'to', 'with', 'from', 'by', 'is', 'are', 'how', 'what', 'why']);

const RIGHTS_SCORE: Partial<Record<PictureRights, number>> = { free: 30, credit: 22, limited: 4, unclear: -24 };

/** Search words without filler words. Letters and numbers in any script count. */
export function searchWords(query: string): string[] {
  return [...new Set(String(query ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w) && (w.length > 1 || /\p{Script=Han}/u.test(w))))];
}

/** True for logos, icons and clip art, unless the search asked for them. */
export function isLogoOrIcon(p: Pick<FoundPicture, 'title' | 'text'>, query = ''): boolean {
  if (LOGO.test(query)) return false;
  return LOGO.test(p.title ?? '') || LOGO.test(p.text ?? '');
}

/** Pictures too small or in a format slides can't use are left out. Unknown sizes are kept. */
export function isUsable(p: Pick<FoundPicture, 'mime' | 'width' | 'height' | 'url'>): boolean {
  if (!p.url || (p.mime && !RASTER.test(p.mime))) return false;
  if (!p.width || !p.height) return true;
  return Math.max(p.width, p.height) >= 480 && Math.min(p.width, p.height) >= 240;
}

/** Higher is better. Null when the picture should not be suggested at all. */
export function scorePicture(p: FoundPicture, query: string, shape: PictureShape = 'wide'): number | null {
  if (!isUsable(p) || isLogoOrIcon(p, query)) return null;
  const words = searchWords(query);
  const title = (p.title ?? '').toLowerCase();
  const text = (p.text ?? '').toLowerCase();
  const matched = words.reduce((sum, w) => sum + (title.includes(w) ? 1 : text.includes(w) ? 0.6 : 0), 0);
  const phrase = words.length > 1 && title.includes(words.join(' ')) ? 12 : 0;
  const relevance = words.length ? (40 * matched) / words.length + phrase : 0;
  const order = Math.max(0, 14 - (p.order ?? 0) * 1.2);
  const known = p.width > 0 && p.height > 0;
  const size = known ? Math.min(30, Math.log10(p.width * p.height) * 4.5) + (Math.max(p.width, p.height) >= 1600 ? 4 : 0) : 12;
  const ratio = known ? p.width / p.height : TARGET_RATIO[shape];
  const aspect = known ? 22 * Math.max(0, 1 - Math.abs(Math.log(ratio / TARGET_RATIO[shape])) / Math.log(2.2)) : 8;
  const rights = RIGHTS_SCORE[rightsOf(p.license)] ?? 0;
  const weak = WEAK.test(`${title} ${text}`) && !WEAK.test(query) ? 18 : 0;
  return relevance + order + size + aspect + rights - weak;
}

/** The same picture found twice (Openverse also indexes Commons) is shown once. */
function sameKey(p: FoundPicture): string[] {
  const keys = [`url:${p.url.replace(/[?#].*$/, '')}`];
  const title = p.title.trim().toLowerCase();
  if (title && p.author) keys.push(`ta:${title}|${p.author.trim().toLowerCase()}`);
  return keys;
}

export interface RankOptions {
  shape?: PictureShape;
  /** Result ids not to suggest again. */
  dismissed?: Set<string>;
  limit?: number;
}

/** Best first, logos, icons, tiny pictures, duplicates and dismissed results removed. */
export function rankPictures(list: FoundPicture[], query: string, options: RankOptions = {}): RankedPicture[] {
  const scored = list.flatMap((p): RankedPicture[] => {
    if (options.dismissed?.has(p.id)) return [];
    const score = scorePicture(p, query, options.shape ?? 'wide');
    return score === null ? [] : [{ ...p, rights: rightsOf(p.license), score }];
  }).sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: RankedPicture[] = [];
  for (const p of scored) {
    const keys = sameKey(p);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(p);
  }
  return options.limit ? out.slice(0, options.limit) : out;
}
