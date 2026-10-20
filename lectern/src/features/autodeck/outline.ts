// Editing an outline before its slides are written.

import { getKind } from '../../core/kinds/registry';
import type { AnyKind } from '../../core/kinds/types';
import type { PlannedSlide } from '../../data/draft-jobs';

/** The most slides an outline can hold. The server keeps no more than this. */
export const MAX_OUTLINE = 60;

export function outlineMinutes(slides: Pick<PlannedSlide, 'minutes'>[]): number {
  return slides.reduce((t, s) => t + (Number(s.minutes) || 0), 0);
}

/** How many pictures a slide type shows: one per image field, and each item of a list of pictures. */
export function pictureRoom(kind: Pick<AnyKind, 'fields'>): number {
  return kind.fields.reduce((n, f) => n + (f.type === 'image' ? 1 : f.type === 'objects' && f.fields.some((x) => x.type === 'image') ? (f.max ?? 4) : 0), 0);
}

/** A slide changed to another type, keeping only the pictures the new type has room for. */
export function withKind(slide: PlannedSlide, kind: string): Partial<PlannedSlide> {
  const def = getKind(kind);
  const room = def ? pictureRoom(def) : 0;
  return { kind, pictures: slide.pictures.slice(0, room) };
}
