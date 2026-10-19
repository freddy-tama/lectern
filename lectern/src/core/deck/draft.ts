import { getKind } from '../kinds/registry';
import type { DeckDraft } from '../plugins/api';
import { type Audience, type Deck, type DeckPurpose, type KeyNotes, type Slide, emptyNotes, normalizeNotes, uid } from './types';
import { countWords } from './words';

/** Words a presenter says per minute, for timing estimates. */
export const SPEAKING_WPM = 130;

export function makeSlide(kind: string, content?: Record<string, unknown>, notes?: Partial<KeyNotes>, variant?: string): Slide {
  const def = getKind(kind);
  return {
    id: uid('s'),
    kind,
    content: { ...(def?.create() ?? {}), ...(content ?? {}) },
    notes: normalizeNotes({ ...emptyNotes(), ...(notes ?? {}) }),
    ...(variant ? { variant } : {}),
  };
}

export function estimateMinutes(notes: Pick<KeyNotes, 'script' | 'check'>, kind: string): number {
  const words = countWords(notes.script);
  const talk = words / SPEAKING_WPM;
  const activity = kind === 'question' || kind === 'recall' || kind === 'closing' ? 2 : 0;
  const total = Math.max(kind === 'section' || kind === 'title' ? 0.5 : 1, talk + activity + (notes.check ? 0.5 : 0));
  return Math.round(total * 2) / 2;
}

/**
 * Fills key points and a starter script from the slide's own text when they are empty.
 * Existing notes are never overwritten.
 */
/** Framing slides: their text is not something learners need to keep. */
const NO_AUTO_POINTS = new Set(['title', 'section', 'agenda', 'closing']);

export function completeNotes(slide: Slide): Slide {
  const def = getKind(slide.kind);
  const notes = { ...slide.notes };
  const parts = def ? def.text(slide.content).map((s) => s.trim()).filter(Boolean) : [];
  const [head, ...rest] = parts;
  if (!notes.keyPoints.length && rest.length && !NO_AUTO_POINTS.has(slide.kind)) notes.keyPoints = rest.slice(0, 4).map((s) => s.replace(/\s+/g, ' ').slice(0, 160));
  if (!notes.script.trim() && head) {
    notes.script = rest.length
      ? `${head}. ${rest.slice(0, 4).map((r) => r.replace(/[.\s]+$/, '')).join('. ')}.`
      : `${head}.`;
  }
  if (!slide.notes.minutes || slide.notes.minutes === 2) notes.minutes = estimateMinutes(notes, slide.kind);
  return { ...slide, notes };
}

export function draftToDeck(draft: DeckDraft, o: { audience: Audience; themeId: string; lessonId?: string; source?: string; purpose?: DeckPurpose }): Deck {
  const now = Date.now();
  const slides = draft.slides
    .filter((s) => s && typeof s.kind === 'string')
    .map((s) => {
      const known = getKind(s.kind);
      const slide: Slide = {
        id: uid('s'),
        kind: s.kind,
        content: { ...(known?.create() ?? {}), ...(s.content ?? {}) },
        notes: normalizeNotes({ ...emptyNotes(), ...(s.notes ?? {}) }),
        ...(s.variant ? { variant: s.variant } : {}),
      };
      return completeNotes(slide);
    });
  return {
    id: uid('d'),
    title: draft.title?.trim() || 'Untitled deck',
    themeId: draft.themeId || o.themeId,
    audience: draft.audience || o.audience,
    slides,
    ...(o.purpose ? { purpose: o.purpose } : {}),
    lessonId: o.lessonId,
    minutes: draft.minutes,
    createdAt: now,
    updatedAt: now,
    ...(o.source ? { source: o.source } : {}),
  };
}

export function blankDeck(o: { title: string; audience: Audience; themeId: string; lessonId?: string; eyebrow?: string; purpose?: DeckPurpose }): Deck {
  return draftToDeck({
    title: o.title,
    slides: [
      { kind: 'title', content: { title: o.title, eyebrow: o.eyebrow ?? '', subtitle: '', presenter: '' } },
      { kind: 'bullets', content: { title: 'Main idea', bullets: ['First point', 'Second point', 'Third point'] } },
      { kind: 'summary', content: {} },
    ],
  }, o);
}

export function cloneSlide(slide: Slide): Slide {
  return { ...structuredClone(slide), id: uid('s') };
}
