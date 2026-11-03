// The deck as the assistant has changed it so far in one request: a copy of the real deck in this browser.
// Tools read and change the copy; the layout engine lays it out and the slide pictures draw it, so the
// assistant sees its own changes. When the request ends, ops() turns the difference from the deck as it was
// into proposals the presenter reviews. Nothing here touches the real deck.

import { type Deck, type Slide, deckMinutes, deckPurpose } from '../../../core/deck/types';
import type { SlideLayout } from '../../../core/engine/boxes';
import { layoutSlide } from '../../../core/engine/layout';
import { getTheme } from '../../../core/engine/themes';
import { getKind } from '../../../core/kinds/registry';
import type { AnyKind } from '../../../core/kinds/types';
import type { FoundPicture } from '../../../core/pictures/rank';
import type { PictureRights } from '../../../core/pictures/credits';
import { assetRefs } from '../../../data/blobs';
import type { DeckOp, OpNotes } from '../deck-ops';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** What a slide is called in outlines: its title, or the first words it shows. */
export function headingOf(slide: Slide): string {
  const def = getKind(slide.kind);
  try {
    const h = def ? def.heading(slide.content).trim() : '';
    if (h) return clip(h.replace(/\s+/g, ' '), 80);
  } catch { /* a broken mod */ }
  return def?.label ?? slide.kind;
}

export interface FoundCandidate extends FoundPicture {
  rights: PictureRights;
  query: string;
}

export class Workspace {
  deck: Deck;
  private readonly original: Map<string, Slide>;
  private readonly added = new Set<string>();
  private readonly moved = new Set<string>();
  private readonly deleted = new Map<string, { slide: Slide; reason: string }>();
  private readonly reasons = new Map<string, string[]>();
  /** Pictures the assistant may put on slides: those already in the deck, and those it drew or downloaded. */
  readonly pictures = new Set<string>();
  /** Candidates from find_pictures, by their "found:…" reference, and what each became once downloaded. */
  readonly found = new Map<string, FoundCandidate>();
  readonly fetched = new Map<string, string>();
  private layouts = new Map<string, { key: string; layout: SlideLayout }>();

  constructor(deck: Deck, readonly plannedMinutes?: number) {
    this.deck = structuredClone(deck);
    this.original = new Map(deck.slides.map((s) => [s.id, s]));
    for (const id of assetRefs(deck.slides)) this.pictures.add(`asset:${id}`);
  }

  get slides() {
    return this.deck.slides;
  }

  get theme() {
    return getTheme(this.deck.themeId);
  }

  /** A slide by id, or by its number in the deck as it is now ("3", "#3", "slide 3"). */
  find(ref: string): { slide: Slide; index: number } {
    const r = String(ref ?? '').trim();
    const byId = this.slides.findIndex((s) => s.id === r);
    if (byId >= 0) return { slide: this.slides[byId], index: byId };
    const n = /^(?:slide\s*)?#?(\d{1,4})$/i.exec(r)?.[1];
    if (n && Number(n) >= 1 && Number(n) <= this.slides.length) return { slide: this.slides[Number(n) - 1], index: Number(n) - 1 };
    if (this.deleted.has(r)) throw new Error(`Slide ${r} is already proposed for deletion.`);
    throw new Error(`There's no slide "${clip(r, 40)}". Use a slide id from the outline (like ${this.slides[0]?.id ?? 's_…'}) or a slide number from 1 to ${this.slides.length}.`);
  }

  kindOf(slide: Slide): AnyKind {
    const kind = getKind(slide.kind);
    if (!kind) throw new Error(`Slide type "${slide.kind}" comes from a mod that isn't installed, so this slide can't be changed.`);
    return kind;
  }

  /** The slide laid out as the studio draws it (with empty picture frames showing), cached until it changes. */
  layout(slide: Slide): SlideLayout {
    const shown = this.slides.filter((s) => !s.hidden);
    const number = Math.max(1, shown.indexOf(slide) + 1);
    const key = JSON.stringify([slide, number, shown.length, this.deck.themeId, this.deck.audience, this.deck.title]);
    const hit = this.layouts.get(slide.id);
    if (hit?.key === key) return hit.layout;
    const layout = layoutSlide(slide, {
      theme: this.theme, audience: this.deck.audience, mode: 'edit', slideNumber: number, slideCount: shown.length, deckTitle: this.deck.title,
    });
    this.layouts.set(slide.id, { key, layout });
    return layout;
  }

  /** Problems the audience would see: text that doesn't fit, too many words, empty picture frames. */
  warnings(slide: Slide): string[] {
    const layout = this.layout(slide);
    const out = layout.boxes.some((b) => b.type === 'text' && b.overflow) ? ['text overflows'] : [];
    if (layout.words && layout.words.count > layout.words.budget) out.push(`${layout.words.count} words, aim for ${layout.words.budget}`);
    const empty = layout.boxes.filter((b) => b.id.endsWith('-ph')).length;
    if (empty) out.push(empty === 1 ? 'an empty picture frame' : `${empty} empty picture frames`);
    return out;
  }

  /** Replaces a slide of the copy and remembers why. */
  replace(id: string, next: Slide, reason: string) {
    const i = this.slides.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.deck = { ...this.deck, slides: this.slides.map((s, k) => (k === i ? next : s)) };
    this.note(id, reason);
  }

  insert(at: number, slide: Slide, reason: string) {
    const slides = [...this.slides];
    slides.splice(at, 0, slide);
    this.deck = { ...this.deck, slides };
    this.added.add(slide.id);
    this.note(slide.id, reason);
  }

  move(ref: string, after: string, reason: string): { slide: Slide; index: number } {
    const { slide, index } = this.find(ref);
    if (after.trim() === slide.id) throw new Error('A slide can’t go after itself.');
    const slides = [...this.slides];
    slides.splice(index, 1);
    this.deck = { ...this.deck, slides };
    const at = this.anchor(after) + 1;
    slides.splice(at, 0, slide);
    if (!this.added.has(slide.id)) this.moved.add(slide.id);
    this.note(slide.id, reason);
    return { slide, index: at };
  }

  remove(ref: string, reason: string): { slide: Slide; wasNew: boolean } {
    const { slide } = this.find(ref);
    if (this.slides.length < 2) throw new Error('A deck needs at least one slide, so the last one can’t be deleted.');
    this.deck = { ...this.deck, slides: this.slides.filter((s) => s.id !== slide.id) };
    if (this.added.delete(slide.id)) {
      // Dropping a slide this request added just takes back the proposal.
      this.reasons.delete(slide.id);
      return { slide, wasNew: true };
    }
    this.moved.delete(slide.id);
    this.deleted.set(slide.id, { slide: this.original.get(slide.id) ?? slide, reason });
    return { slide, wasNew: false };
  }

  /** Where "after" points: -1 for the start of the deck. */
  anchor(after: string): number {
    if (/^(start|beginning|top|0)$/i.test(after.trim())) return -1;
    return this.find(after).index;
  }

  private note(id: string, reason: string) {
    const list = this.reasons.get(id) ?? [];
    if (reason && !list.includes(reason)) list.push(reason);
    this.reasons.set(id, list);
  }

  /** "· new", "· edited, moved" or "", for outlines. */
  state(id: string): string {
    if (this.added.has(id)) return ' · new';
    const o = this.original.get(id);
    const s = this.slides.find((x) => x.id === id);
    const tags = [o && s && !same(o, s) ? 'edited' : '', this.moved.has(id) ? 'moved' : ''].filter(Boolean);
    return tags.length ? ` · ${tags.join(', ')}` : '';
  }

  outline(): string {
    const d = this.deck;
    const t = this.theme;
    const total = deckMinutes(d);
    const planned = this.plannedMinutes ?? d.minutes;
    const lines = [
      `Deck: “${d.title || 'Untitled'}” · a ${deckPurpose(d)} for ${d.audience === 'young' ? 'young learners aged 6-11' : d.audience === 'teen' ? 'teenagers' : 'adults'} · look: ${t.name}`,
      `${planned ? `Planned length: ${planned} min. ` : ''}The slides add up to ${total} min (hidden slides don't count).`,
      `${this.slides.length} slides:`,
      ...this.slides.map((s, i) => {
        const def = getKind(s.kind);
        const layout = def?.variants?.length ? ` · layout ${s.variant ?? def.variants[0].id}` : '';
        const warn = this.warnings(s);
        const extras = s.elements?.length ? ` · ${s.elements.length} element${s.elements.length === 1 ? '' : 's'}` : '';
        return `${i + 1}. ${s.id} · ${s.kind} · “${headingOf(s)}” · ${s.notes.minutes} min${layout}${extras}${s.hidden ? ' · hidden' : ''}${warn.length ? ` · ⚠ ${warn.join('; ')}` : ''}${this.state(s.id)}`;
      }),
    ];
    if (this.deleted.size) lines.push(`Proposed for deletion: ${[...this.deleted.values()].map(({ slide }) => `${slide.id} “${headingOf(slide)}”`).join(', ')}`);
    return lines.join('\n');
  }

  /** The proposals: the difference from the deck as it came in, one op per slide and kind of change. */
  ops(): DeckOp[] {
    const reason = (id: string) => (this.reasons.get(id) ?? []).join('; ');
    const before = (i: number) => this.slides.slice(0, i).map((s) => s.id).reverse();
    const ops: DeckOp[] = [];
    this.slides.forEach((s, i) => {
      if (this.added.has(s.id)) {
        ops.push({
          op: 'add',
          slide: {
            id: s.id, kind: s.kind, content: structuredClone(s.content), notes: structuredClone(s.notes) as OpNotes,
            ...(s.variant ? { variant: s.variant } : {}),
            ...(s.overrides ? { overrides: structuredClone(s.overrides) } : {}),
            ...(s.elements ? { elements: structuredClone(s.elements) } : {}),
          },
          after: before(i),
          reason: reason(s.id),
        });
        return;
      }
      if (this.moved.has(s.id)) ops.push({ op: 'move', slideId: s.id, after: before(i), reason: reason(s.id) });
      const o = this.original.get(s.id);
      if (!o) return;
      const kind = s.kind !== o.kind ? s.kind : undefined;
      // A new type replaces the content outright; otherwise only the fields that changed travel.
      const content = kind ? structuredClone(s.content) : Object.fromEntries(Object.keys(s.content).filter((k) => !same(s.content[k], o.content[k])).map((k) => [k, structuredClone(s.content[k])]));
      const notes = Object.fromEntries((Object.keys(s.notes) as (keyof typeof s.notes)[]).filter((k) => !same(s.notes[k], o.notes[k])).map((k) => [k, s.notes[k]])) as OpNotes;
      const edit: Extract<DeckOp, { op: 'edit' }> = { op: 'edit', slideId: s.id, reason: reason(s.id) };
      if (kind) edit.kind = kind;
      if (Object.keys(content).length) edit.content = content;
      if (Object.keys(notes).length) edit.notes = notes;
      if ((s.variant ?? null) !== (o.variant ?? null)) edit.variant = s.variant ?? null;
      if (!same(s.overrides ?? null, o.overrides ?? null)) edit.overrides = s.overrides ? structuredClone(s.overrides) : null;
      if (!same(s.elements ?? null, o.elements ?? null)) edit.elements = s.elements ? structuredClone(s.elements) : null;
      if (Object.keys(edit).length > 3) ops.push(edit);
    });
    for (const [id, { reason: why }] of this.deleted) ops.push({ op: 'delete', slideId: id, reason: why });
    return ops;
  }
}
