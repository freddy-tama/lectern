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
import { withPhotoNoteFrame } from './photo-notes';
import type { Deck, Slide } from './types';
import { deckPurpose } from './types';

/** Where a section slide falls among the deck's parts: the second of four is { index: 2, count: 4 }. */
export interface PartPlace {
  index: number;
  count: number;
}

/**
 * The place of each shown section slide among the deck's parts, when auto style is on and the deck
 * has two parts or more. Section slides then show their number and progress dots, so the room
 * always knows where the talk is.
 */
export function partPlaces(deck: Pick<Deck, 'slides' | 'autoStyle'>): Map<string, PartPlace> {
  const sections = deck.autoStyle ? deck.slides.filter((s) => !s.hidden && s.kind === 'section') : [];
  return new Map(sections.length >= 2 ? sections.map((s, i) => [s.id, { index: i + 1, count: sections.length }]) : []);
}

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
    // A photo still to add counts as a photo, so the layout keeps a place for it.
    const picked = def.autoVariant(withPhotoNoteFrame(slide), {
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
  // Pitches are light: of eight real pitch decks studied, none was mostly dark.
  if (purpose === 'pitch') return 'campus';
  if (purpose === 'report') return 'minimal';
  if (purpose === 'lesson') return about(CHALK_WORDS, deck.title, body, 3) ? 'chalk' : deck.audience === 'teen' ? 'campus' : 'paper';
  return 'paper';
}
