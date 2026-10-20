// What the picture finder knows about the slide it's filling: the words to search for,
// the frame's shape, and the deck's look and audience for AI pictures.

import { createContext, useContext } from 'react';
import type { Audience, DeckPurpose } from '../../core/deck/types';
import type { PictureShape } from '../../core/pictures/rank';
import type { Theme } from '../../core/engine/themes';

export interface PictureSlideContext {
  kind: string;
  variant?: string;
  /** The slide's heading, the default search. */
  heading: string;
  /** More of the slide's text, for describing an AI picture. */
  text: string[];
  deckTitle: string;
  theme?: Theme;
  audience: Audience;
  purpose: DeckPurpose;
}

export const PictureContext = createContext<PictureSlideContext | null>(null);

export const usePictureContext = () => useContext(PictureContext);

/** The shape of the frame a field's picture fills, so search and AI pictures fit it. */
export function frameShape(kind: string, variant: string | undefined, key: string): PictureShape {
  if (key === 'photo') return 'square';
  switch (kind) {
    case 'title': return 'tall';
    case 'image': return variant === 'full' ? 'wide' : 'square';
    case 'bullets':
    case 'term': return 'square';
    case 'gallery': return variant === 'strip' ? 'tall' : 'wide';
    default: return 'wide';
  }
}

/** A short search from a heading or caption: no punctuation, at most eight words. */
export function searchFrom(...candidates: (string | undefined)[]): string {
  return searchesFrom(...candidates)[0] ?? '';
}

/** Captions that are already a credit ("Photo: …", "© …") say nothing about the picture. */
const CREDIT_LIKE = /^\s*(photo|picture|image|credit|source|©|\(c\))\b|^\s*©/i;

/** Distinct searches from several texts, best first: the default and a few alternatives to try. */
export function searchesFrom(...candidates: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    if (!c?.trim() || CREDIT_LIKE.test(c)) continue;
    const q = c.replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' ');
    if (q.length >= 2 && !out.some((x) => x.toLowerCase() === q.toLowerCase())) out.push(q);
  }
  return out;
}
