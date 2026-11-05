// Photo notes: a slide can say what photo the presenter means to add later, such as "Wide shot of a
// Chinese class at a school in Surabaya". The note belongs to the slide type's picture field and is
// open while that field is empty: the editor draws it in the empty frame, the studio lists it under
// "Photos to add", and PowerPoint gets a labelled box in the photo's place. Placing a picture
// settles the note.

import { getKind } from '../kinds/registry';
import type { Deck, Slide } from './types';

/** The most a note keeps. */
export const MAX_PHOTO_NOTE = 240;

/**
 * Stands in for the photo while a note is open, so the layout keeps room for it. Only ever passed to a
 * layout; never saved in a slide.
 */
export const PHOTO_NOTE_SRC = 'lectern:photo-note';

type NoteSlide = Pick<Slide, 'kind' | 'content' | 'photoNote'>;

/** The slide type's first single-picture field, or undefined when it has none. */
export function pictureField(kind: string): string | undefined {
  return getKind(kind)?.fields.find((f) => f.type === 'image')?.key;
}

/** A note as stored: one line, trimmed, at most MAX_PHOTO_NOTE characters. */
export function cleanPhotoNote(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_PHOTO_NOTE) : '';
}

const filled = (v: unknown) => typeof v === 'string' && v.trim() !== '';

/** The note while the slide's picture field is still empty; '' when there is none or the photo is in. */
export function openPhotoNote(slide: NoteSlide): string {
  const note = cleanPhotoNote(slide.photoNote);
  const field = note ? pictureField(slide.kind) : undefined;
  return field && !filled(slide.content?.[field]) ? note : '';
}

/** The slide's content with the stand-in where the photo goes, for laying out. The same content when no note is open. */
export function withPhotoNoteFrame(slide: NoteSlide): Record<string, unknown> {
  const content = slide.content ?? {};
  if (!openPhotoNote(slide)) return content;
  return { ...content, [pictureField(slide.kind)!]: PHOTO_NOTE_SRC };
}

export interface PhotoToAdd {
  slideId: string;
  /** The slide's place in the deck, from 1. */
  number: number;
  /** The picture field the photo goes in. */
  field: string;
  note: string;
}

/** The open notes of the slides that are shown, in deck order. */
export function photosToAdd(deck: Pick<Deck, 'slides'>): PhotoToAdd[] {
  return deck.slides.flatMap((s, i) => {
    const note = s.hidden ? '' : openPhotoNote(s);
    return note ? [{ slideId: s.id, number: i + 1, field: pictureField(s.kind)!, note }] : [];
  });
}

/**
 * The slide without its note once the photo is in, when the note is empty, or when its type has no
 * picture field. The same slide otherwise.
 */
export function settlePhotoNote<S extends NoteSlide>(slide: S): S {
  if (slide.photoNote === undefined || openPhotoNote(slide)) return slide;
  const { photoNote: _gone, ...rest } = slide;
  return rest as S;
}

/** Drops the notes whose photo has been placed. Returns the same deck when nothing changes. */
export function settlePhotoNotes(deck: Deck): Deck {
  let changed = false;
  const slides = deck.slides.map((s) => {
    const next = settlePhotoNote(s);
    if (next !== s) changed = true;
    return next;
  });
  return changed ? { ...deck, slides } : deck;
}

const SHOT = /^(?:an?\s+)?(?:(?:extreme\s+)?(?:wide|close[- ]?up|medium|aerial|overhead|long|tight|high[- ]angle|low[- ]angle)(?:\s+(?:shot|photo|photograph|picture|view))?|photo|photograph|picture|image)\s+of\s+/i;

/** A picture search from a note: what the photo shows, without the kind of shot or the details after a comma. */
export function photoNoteSearch(note: string): string {
  return cleanPhotoNote(note).replace(SHOT, '').split(/[,;:.。，；：]/)[0]!.trim();
}

/** The speaker-notes line for a slide whose photo is still to add, or ''. */
export function photoNoteLine(slide: NoteSlide): string {
  const note = openPhotoNote(slide);
  return note ? `Photo to add: ${note}` : '';
}
