// The deck assistant's proposals: what each one changes, which ones need an explicit tick, and applying them.
// The assistant works on a copy (./agent/workspace.ts) and only proposes; everything here runs on the presenter's yes.

import { makeSlide } from '../../core/deck/draft';
import { fitsOnSlide } from '../../core/deck/split';
import type { CheckQuestion, Deck, Slide, SlideElement } from '../../core/deck/types';
import { allKinds, getKind } from '../../core/kinds/registry';
import { kindSpec, mergeNotes } from './slide-ai';

export interface OpNotes {
  script?: string;
  keyPoints?: string[];
  cues?: string[];
  check?: CheckQuestion | null;
  minutes?: number;
}

/** A new slide as the assistant proposes it. Content and notes are filled in from the slide type when applied. */
export interface ProposedSlide {
  id: string;
  kind: string;
  content: Record<string, unknown>;
  notes: OpNotes;
  variant?: string;
  overrides?: Slide['overrides'];
  elements?: SlideElement[];
}

/**
 * One proposed change, named by slide id so the presenter can take some and leave others. An edit carries only
 * the fields it changes. `after` lists the slides before this one in the proposed order, nearest first: it goes
 * after the first of them still in the deck, or at the start.
 */
export type DeckOp =
  | {
      op: 'edit'; slideId: string; content?: Record<string, unknown>; notes?: OpNotes;
      /** A new slide type: the content then replaces the old content outright. */
      kind?: string;
      /** A new layout, or null for the slide type's first. */
      variant?: string | null;
      /** Boxes moved, resized or left off, or null for none. */
      overrides?: Slide['overrides'] | null;
      /** The slide's free elements as they should be, or null for none. */
      elements?: SlideElement[] | null;
      reason: string;
    }
  | { op: 'add'; slide: ProposedSlide; after: string[]; reason: string }
  | { op: 'move'; slideId: string; after: string[]; reason: string }
  | { op: 'delete'; slideId: string; reason: string };

export const opSlideId = (op: DeckOp) => (op.op === 'add' ? op.slide.id : op.slideId);

/** A key for one op in a list: a slide can have both a move and an edit. */
export const opKey = (op: DeckOp) => `${op.op}:${opSlideId(op)}`;

function insertAfter(slides: Slide[], slide: Slide, after: string[]): Slide[] {
  const out = slides.filter((s) => s.id !== slide.id);
  const anchor = after.map((id) => out.findIndex((s) => s.id === id)).find((i) => i >= 0) ?? -1;
  out.splice(anchor + 1, 0, slide);
  return out;
}

/** The new slide an add op makes, with the slide type's defaults under what was proposed. */
export function proposedSlide(p: ProposedSlide): Slide {
  const base = makeSlide(p.kind, p.content, p.notes as Parameters<typeof makeSlide>[2], p.variant);
  return { ...base, id: p.id, ...(p.overrides ? { overrides: p.overrides } : {}), ...(p.elements?.length ? { elements: p.elements } : {}) };
}

/**
 * A slide with an edit laid over it, field by field, so changes the presenter made since stay where the edit
 * doesn't touch them. A chosen layout is pinned, so auto style keeps it.
 */
export function editedSlide(slide: Slide, op: Extract<DeckOp, { op: 'edit' }>, autoStyle = false): Slide {
  const next: Slide = { ...slide };
  if (op.kind && op.kind !== slide.kind) {
    next.kind = op.kind;
    next.content = op.content ?? getKind(op.kind)?.create() ?? {};
  } else if (op.content) {
    next.content = { ...slide.content, ...op.content };
  }
  if (op.notes) next.notes = mergeNotes(slide.notes, op.notes);
  if (op.variant !== undefined) {
    if (op.variant === null) { delete next.variant; delete next.variantPinned; } else { next.variant = op.variant; if (autoStyle) next.variantPinned = true; }
  }
  if (op.overrides !== undefined) {
    if (op.overrides && Object.keys(op.overrides).length) next.overrides = op.overrides;
    else delete next.overrides;
  }
  if (op.elements !== undefined) {
    if (op.elements?.length) next.elements = op.elements;
    else delete next.elements;
  }
  return next;
}

/** Whether the op can still be applied to this deck: its slide is there (or, for a new slide, isn't yet). */
export function opApplies(deck: Deck, op: DeckOp): boolean {
  const has = deck.slides.some((s) => s.id === opSlideId(op));
  if (op.op === 'add') return !has;
  if (op.op === 'delete') return has && deck.slides.length > 1;
  return has;
}

/** The deck with one op applied, or the same deck when it no longer applies. Pictures and mod values are kept. */
export function applyOp(deck: Deck, op: DeckOp): Deck {
  if (!opApplies(deck, op)) return deck;
  switch (op.op) {
    case 'edit':
      return { ...deck, slides: deck.slides.map((s) => (s.id === op.slideId ? editedSlide(s, op, deck.autoStyle) : s)) };
    case 'add':
      return { ...deck, slides: insertAfter(deck.slides, proposedSlide(op.slide), op.after) };
    case 'move': {
      const slide = deck.slides.find((s) => s.id === op.slideId)!;
      return { ...deck, slides: insertAfter(deck.slides, slide, op.after.filter((id) => id !== op.slideId)) };
    }
    case 'delete':
      return { ...deck, slides: deck.slides.filter((s) => s.id !== op.slideId) };
  }
}

/** Several ops in order: one deck change, so one undo puts all of it back. */
export function applyOps(deck: Deck, ops: DeckOp[]): Deck {
  return ops.reduce(applyOp, deck);
}

const words = (s: Slide) => {
  const def = getKind(s.kind);
  let parts: string[] = [];
  try { parts = def ? def.text(s.content) : []; } catch { /* a broken mod */ }
  return parts.join(' ').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
};

/**
 * True when an edit replaces what the slide says rather than adjusting it: less than a quarter of its words
 * survive. Such edits, like deletions, are never applied without a tick.
 */
export function rewritesSlide(before: Slide, after: Slide): boolean {
  const was = words(before);
  if (was.length < 4) return false;
  const now = new Set(words(after));
  const kept = was.filter((w) => now.has(w)).length;
  return kept / was.length < 0.25;
}

/** Why an op needs the presenter's explicit tick, or null when it can go with Accept all. Decided here, never by the AI. */
export function needsTick(deck: Deck, op: DeckOp): string | null {
  if (op.op === 'delete') return 'Deletes this slide';
  if (op.op !== 'edit' || !op.content || op.kind) return null;
  const before = deck.slides.find((s) => s.id === op.slideId);
  if (!before) return null;
  return rewritesSlide(before, applyOp(deck, op).slides.find((s) => s.id === op.slideId)!) ? 'Rewrites the whole slide' : null;
}

/** The slide before and after an op, for the review. A new slide has no before; a deleted one has no after. */
export function opPreview(deck: Deck, op: DeckOp): { before?: Slide; after?: Slide } {
  if (op.op === 'add') return { after: proposedSlide(op.slide) };
  const before = deck.slides.find((s) => s.id === op.slideId);
  if (!before || op.op === 'delete') return { before };
  if (op.op === 'move') return { before, after: before };
  return { before, after: editedSlide(before, op, deck.autoStyle) };
}

/** True when the proposed slide doesn't fit in this deck's look: the review flags it. */
export function overflows(deck: Deck, slide: Slide): boolean {
  if (!getKind(slide.kind)) return false;
  try { return !fitsOnSlide(slide, deck); } catch { return false; }
}

/** Every slide type the studio has, core and mods, as the assistant reads them. */
export function assistantKinds() {
  return allKinds().map(kindSpec);
}

/** Changes when mods add or remove slide types, so the assistant hears about them again. */
export function kindsKey(): string {
  return allKinds().map((k) => k.kind).sort().join(',');
}
