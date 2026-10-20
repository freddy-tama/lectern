// Where each picture came from and how it may be used. Kept with the picture's asset so
// credits travel with the deck to the credits view, the handout and the PowerPoint notes.

import type { Deck } from '../deck/types';
import { getKind } from '../kinds/registry';
import type { FieldSpec } from '../kinds/types';

export type PictureSource = 'openverse' | 'commons' | 'pexels' | 'link' | 'upload' | 'ai';

/**
 * free: no credit needed (CC0, public domain, Pexels). credit: reuse with a credit (CC BY, BY-SA).
 * limited: credit, and no commercial use or no changes (NC, ND). unclear: rights not known.
 * own: added from this device. ai: made with an image model.
 */
export type PictureRights = 'free' | 'credit' | 'limited' | 'unclear' | 'own' | 'ai';

export interface PictureCredit {
  source: PictureSource;
  rights: PictureRights;
  title?: string;
  author?: string;
  /** Licence name, for example "CC BY 4.0". */
  license?: string;
  licenseUrl?: string;
  /** The page that describes the picture: the place to link to in a credit. */
  page?: string;
  /** The address the file was downloaded from. */
  url?: string;
  /** What was searched for, or the description an AI picture was made from. */
  query?: string;
  /** The search result it came from, so a removed one isn't suggested again. */
  resultId?: string;
  /** The image model that made an AI picture. */
  model?: string;
  width?: number;
  height?: number;
  addedAt: number;
}

export const SOURCE_LABEL: Record<PictureSource, string> = {
  openverse: 'Openverse',
  commons: 'Wikimedia Commons',
  pexels: 'Pexels',
  link: 'Web link',
  upload: 'Uploaded',
  ai: 'AI picture',
};

export const RIGHTS_LABEL: Record<PictureRights, string> = {
  free: 'Free to use',
  credit: 'Credit needed',
  limited: 'Credit needed, with limits',
  unclear: 'Rights unknown',
  own: 'Your picture',
  ai: 'AI-made',
};

/** Rights from a licence name as libraries write it. */
export function rightsOf(license: string): PictureRights {
  const l = String(license ?? '').trim().toLowerCase();
  if (!l) return 'unclear';
  if (/\bcc0\b|public domain|\bpdm\b|^pd\b|no restrictions|pexels license|unsplash license/.test(l)) return 'free';
  if (/\b(by-)?nc\b|non-?commercial|\bnd\b|no ?deriv/.test(l)) return 'limited';
  if (/\bcc[\s-]*by\b|creative commons|attribution|\bgfdl\b|\bfal\b|free art/.test(l)) return 'credit';
  return 'unclear';
}

/** What the limits on a "limited" licence are, in plain words. */
export function licenseLimits(license: string): string {
  const l = String(license ?? '').toLowerCase();
  const parts: string[] = [];
  if (/\bnc\b|non-?commercial/.test(l)) parts.push('not for commercial use');
  if (/\bnd\b|no ?deriv/.test(l)) parts.push('don’t crop or change it');
  if (/\bsa\b|share ?alike/.test(l)) parts.push('share changes under the same licence');
  return parts.join('; ');
}

/** True when the audience should see a credit for this picture. */
export function needsCredit(credit: PictureCredit): boolean {
  return credit.rights === 'credit' || credit.rights === 'limited' || (credit.rights === 'unclear' && credit.source !== 'upload');
}

/**
 * One line that credits the picture: title, author, licence and where it came from, the order
 * Creative Commons recommends. Empty for your own uploads that have no details.
 */
export function creditLine(credit: PictureCredit): string {
  if (credit.source === 'ai') return `AI-generated picture${credit.model ? ` (${credit.model})` : ''}`;
  const title = credit.title?.trim();
  const author = credit.author?.trim();
  const license = credit.license?.trim();
  const where = credit.page?.trim() || credit.url?.trim() || '';
  if (credit.source === 'upload' && !title && !author && !license && !where) return '';
  const head = title ? `“${title}”${author ? ` by ${author}` : ''}` : author ? `Picture by ${author}` : 'Picture';
  return [head, license, where || (credit.source === 'upload' ? '' : SOURCE_LABEL[credit.source])].filter(Boolean).join(' · ');
}

/** The credit line for a picture in a deck, including plain links that have no stored credit. */
export function pictureLine(ref: string, credit: PictureCredit | null | undefined): string {
  if (credit) return creditLine(credit);
  return /^https?:\/\//i.test(ref) ? `Picture · ${ref}` : '';
}

/** A few words for the studio, under the picture. */
export function shortCredit(credit: PictureCredit): string {
  if (credit.source === 'ai') return credit.model ? `Made with ${credit.model}` : 'Made with AI';
  const who = credit.author?.trim() ? `by ${credit.author.trim()}` : credit.title?.trim() ? `“${credit.title.trim()}”` : '';
  if (credit.source === 'upload' && !who && !credit.license) return 'Added from this device';
  return [who, credit.license?.trim(), SOURCE_LABEL[credit.source]].filter(Boolean).join(' · ');
}

/** A credit short enough for a caption on the slide: who made it and the licence. */
export function captionCredit(credit: PictureCredit): string {
  const who = credit.author?.trim() || credit.title?.trim() || '';
  return [who ? `Picture: ${who}` : 'Picture', credit.license?.trim()].filter(Boolean).join(' · ');
}

// ─── Pictures in a deck ───────────────────────────────────────────────

export interface DeckPictureUse {
  /** "asset:<id>" or an http(s) link. */
  ref: string;
  /** 1-based positions of the slides that show it, in deck order. */
  slides: number[];
  /** True when every slide that shows it is hidden. */
  hiddenOnly: boolean;
}

function imageValues(fields: FieldSpec[], content: Record<string, unknown>, out: string[]) {
  for (const f of fields) {
    const value = content?.[f.key];
    if (f.type === 'image' && typeof value === 'string' && value.trim()) out.push(value.trim());
    else if (f.type === 'objects' && Array.isArray(value)) for (const item of value) if (item && typeof item === 'object') imageValues(f.fields, item as Record<string, unknown>, out);
  }
}

function assetValues(value: unknown, out: string[]) {
  if (typeof value === 'string') { if (value.startsWith('asset:')) out.push(value); return; }
  if (Array.isArray(value)) { value.forEach((v) => assetValues(v, out)); return; }
  if (value && typeof value === 'object') Object.values(value).forEach((v) => assetValues(v, out));
}

/** The pictures on one slide's fields (a slide from a missing mod gives its stored pictures). */
export function slidePictures(slide: Deck['slides'][number]): string[] {
  const out: string[] = [];
  const def = getKind(slide.kind);
  if (def) imageValues(def.fields, slide.content as Record<string, unknown>, out);
  else assetValues(slide.content, out);
  return [...new Set(out.filter((v) => v.startsWith('asset:') || /^https?:\/\//i.test(v)))];
}

/** The credit line of each picture on one slide, once each. */
export function slideCreditLines(slide: Deck['slides'][number], credits: Map<string, PictureCredit>): string[] {
  return [...new Set(slidePictures(slide).map((ref) => pictureLine(ref, credits.get(ref))).filter(Boolean))];
}

/** Every picture the deck's slides show, in order of first use. */
export function deckPictures(deck: Pick<Deck, 'slides'>): DeckPictureUse[] {
  const uses = new Map<string, DeckPictureUse>();
  deck.slides.forEach((slide, i) => {
    for (const ref of slidePictures(slide)) {
      const use = uses.get(ref) ?? { ref, slides: [], hiddenOnly: true };
      use.slides.push(i + 1);
      if (!slide.hidden) use.hiddenOnly = false;
      uses.set(ref, use);
    }
  });
  return [...uses.values()];
}

/** "Slide 3" or "Slides 3, 5". */
export function slidesLabel(slides: number[]): string {
  return `${slides.length === 1 ? 'Slide' : 'Slides'} ${slides.join(', ')}`;
}

/** The credits list as plain text, ready to paste. */
export function creditsText(title: string, items: { slides: number[]; line: string }[]): string {
  const lines = items.filter((i) => i.line).map((i) => `${slidesLabel(i.slides)}: ${i.line}`);
  return lines.length ? [`Picture credits for “${title}”`, '', ...lines].join('\n') : '';
}
