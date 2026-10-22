// Auto style: Lectern picks the look and each slide's layout.
//
// The look comes from what the deck is for and who it's for. Layouts come from
// each slide's content (a picture with no text goes full screen, five cards make
// a grid) and from its neighbours (picture slides alternate sides, statements
// alternate colour), so a deck has rhythm without anyone choosing. A layout the
// presenter picks by hand is pinned and left alone, and so is a slide whose boxes
// they moved on the canvas.

import { hasOverrides } from '../engine/overrides';
import { getKind } from '../kinds/registry';
import type { Deck, Slide } from './types';
import { deckPurpose } from './types';

/** Sets every unpinned slide's layout. Returns the same deck when nothing changes. */
export function autoVariants(deck: Deck): Deck {
  const previous = new Map<string, string>();
  const nth = new Map<string, number>();
  const visible = deck.slides.filter((s) => !s.hidden);
  let changed = false;
  const slides = deck.slides.map((slide): Slide => {
    const def = getKind(slide.kind);
    if (!def?.variants?.length) return slide;
    const n = nth.get(slide.kind) ?? 0;
    nth.set(slide.kind, n + 1);
    const current = slide.variant ?? def.variants[0].id;
    if (slide.variantPinned || !def.autoVariant || hasOverrides(slide)) {
      previous.set(slide.kind, current);
      return slide;
    }
    const picked = def.autoVariant(slide.content ?? {}, {
      index: Math.max(0, visible.indexOf(slide)), count: visible.length, nth: n, previous: previous.get(slide.kind),
    });
    const next = picked && def.variants.some((v) => v.id === picked) ? picked : current;
    previous.set(slide.kind, next);
    if (next === slide.variant) return slide;
    changed = true;
    return { ...slide, variant: next };
  });
  return changed ? { ...deck, slides } : deck;
}

const CODE_WORDS = /\b(api|code|coding|software|developer|engineering|javascript|python|database|server|cloud|devops|machine learning|algorithm|data science|security)\b/gi;
const CHALK_WORDS = /\b(math|maths|mathematics|algebra|geometry|calculus|equation|physics|chemistry|science|grammar|history|exam|revision)\b/gi;

/** Whether the deck is about a subject: named in the title, or coming up again and again in the slides. */
function about(words: RegExp, title: string, body: string, times: number): boolean {
  return (title.match(words)?.length ?? 0) > 0 || (body.match(words)?.length ?? 0) >= times;
}

/** The built-in look that suits the deck best. */
export function suggestLook(deck: Pick<Deck, 'audience' | 'purpose' | 'lessonId' | 'slides' | 'title'>): string {
  if (deck.audience === 'young') return 'sunny';
  const purpose = deckPurpose(deck);
  const body = deck.slides.flatMap((s) => getKind(s.kind)?.text(s.content ?? {}) ?? []).join(' ').slice(0, 4000);
  const code = deck.slides.filter((s) => s.kind === 'code').length;
  if (code >= 2 || about(CODE_WORDS, deck.title, body, 4)) return 'midnight';
  if (purpose === 'pitch') return 'midnight';
  if (purpose === 'report') return 'minimal';
  if (purpose === 'lesson') return about(CHALK_WORDS, deck.title, body, 3) ? 'chalk' : deck.audience === 'teen' ? 'campus' : 'paper';
  return 'paper';
}
