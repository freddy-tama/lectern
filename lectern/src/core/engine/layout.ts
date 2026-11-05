import { type Audience, type Deck, type DeckDensity, type DeckPurpose, type Slide, deckPurpose } from '../deck/types';
import { partPlaces } from '../deck/auto-style';
import { PHOTO_NOTE_SRC, openPhotoNote, withPhotoNoteFrame } from '../deck/photo-notes';
import { countWords } from '../deck/words';
import { registerCoreKinds } from '../kinds/core-kinds';
import { type LayoutContext, M, budgetFor, decorate, footer, shape, text, wordBudget } from '../kinds/kit';
import { getKind } from '../kinds/registry';
import { toggleDefaults } from '../plugins/registry';
import { type Box, type ImageBox, type SlideLayout, maxStep } from './boxes';
import { layoutElements } from './elements';
import { type Measure, measureText } from './measure';
import { applyOverrides } from './overrides';
import { type Theme, getTheme } from './themes';

registerCoreKinds();

export interface LayoutOptions {
  theme: Theme;
  audience: Audience;
  target?: 'web' | 'pptx';
  mode?: 'edit' | 'show';
  measure?: Measure;
  slideNumber?: number;
  slideCount?: number;
  deckTitle?: string;
  resolveImage?: (src: string) => string;
  flags?: Record<string, boolean>;
  /** What the deck is for and its drafted density, which set the word budget. */
  purpose?: DeckPurpose;
  density?: DeckDensity;
  /** Where a section slide falls among the deck's parts (see partPlaces). */
  part?: { index: number; count: number };
}

function wordCount(parts: string[]) {
  return countWords(parts.join(' '));
}

/** Lays out one slide. Never throws: a broken or unknown slide becomes a readable placeholder. */
export function layoutSlide(slide: Slide, o: LayoutOptions): SlideLayout {
  const ctx: LayoutContext = {
    theme: o.theme,
    audience: o.audience,
    target: o.target ?? 'web',
    mode: o.mode ?? 'show',
    measure: o.measure ?? measureText,
    slideNumber: o.slideNumber ?? 1,
    slideCount: o.slideCount ?? 1,
    deckTitle: o.deckTitle ?? '',
    warnings: [],
    resolveImage: o.resolveImage,
    flags: { ...toggleDefaults(), ...o.flags },
    purpose: o.purpose,
    density: o.density,
    part: o.part,
  };
  const def = getKind(slide.kind);
  if (!def) return missingKind(slide, ctx);
  try {
    // A photo still to add keeps its place while editing and in PowerPoint, where a labelled box marks it.
    // Presenting shows nothing there, as with any empty picture field.
    const note = ctx.mode === 'edit' || ctx.target === 'pptx' ? openPhotoNote(slide) : '';
    const result = def.layout(note ? withPhotoNoteFrame(slide) : slide.content ?? {}, ctx, slide.variant);
    const frame = result.frame ?? 'content';
    const elements = layoutElements(slide, ctx);
    const own = applyOverrides(result.boxes, slide.overrides, ctx);
    // Overrides reach the theme's decorations too, so one can be moved or left off a single slide.
    const boxes: Box[] = [
      ...applyOverrides(frame === 'bare' ? [] : decorate(ctx, frame), slide.overrides, ctx),
      ...elements.back,
      ...(note ? own.flatMap((b) => (b.type === 'image' && b.src === PHOTO_NOTE_SRC ? photoNoteFrame(ctx, b, note) : [b])) : own),
      ...(frame === 'content' ? footer(ctx) : []),
      ...elements.front,
    ];
    const words = wordCount(def.text(slide.content ?? {}));
    // Questions, practice and data carry the words of the activity or the figures: the audience's budget, whatever the deck is for.
    const structured = def.group === 'Engage' || def.group === 'Data';
    const budget = result.budget ?? (structured ? wordBudget(ctx.audience) : wordBudget(ctx.audience, ctx.purpose, ctx.density));
    if (frame === 'content' && words > budget) {
      ctx.warnings.push(`${words} words on this slide. ${budgetFor(ctx.purpose)}, aim for ${budget} or fewer and move the rest to the key notes.`);
    }
    return {
      background: result.background ?? (frame === 'section' ? o.theme.colors.sectionBg : o.theme.colors.bg),
      boxes,
      steps: maxStep(boxes),
      warnings: [...new Set(ctx.warnings)],
      ...(frame === 'content' ? { words: { count: words, budget } } : {}),
    };
  } catch (error) {
    console.error('Slide layout failed', slide.kind, error);
    return missingKind(slide, ctx, 'This slide could not be drawn. Its content is kept; try another slide type.');
  }
}

/**
 * The box that holds a photo's place: a dashed frame in the accent colour with "Photo to add" and the
 * note, centred. It keeps the photo's box id, so moving it on the canvas moves the photo that replaces it.
 * Small frames show only the label; the note is in the speaker notes and the studio's list.
 */
export function photoNoteFrame(ctx: LayoutContext, box: ImageBox, note: string): Box[] {
  const c = ctx.theme.colors;
  const short = Math.min(box.w, box.h);
  const pad = Math.round(Math.max(16, Math.min(48, short * 0.08)));
  // Type grows with the frame, so the note reads at a glance in a half-slide frame and still fits a small one.
  const size = Math.round(Math.max(24, Math.min(48, short * 0.05)));
  const labelSize = Math.round(size * 0.75);
  const inner = { x: box.x + pad, w: Math.max(40, box.w - 2 * pad) };
  const frame = shape({ id: box.id, shape: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, fill: c.surface, stroke: c.accent, strokeWidth: 3, radius: box.radius, dash: true, bind: box.bind, step: box.step });
  const warned = ctx.warnings.length;
  const labelText = (value: string) => text(ctx, {
    id: `${box.id}-note-label`, text: value, ...inner, y: box.y, h: Math.round(labelSize * 1.6), max: labelSize, min: 16, weight: 700, color: c.accent,
    align: 'center', uppercase: true, tracking: 0.08, maxLines: 1, hug: true, scaled: false, bind: box.bind, step: box.step,
  });
  let label = labelText('Photo to add');
  if (label.overflow) label = labelText('Photo');
  const gap = 12;
  const room = box.h - 2 * pad - label.h - gap;
  let body = room >= 40 && inner.w >= 160
    ? text(ctx, { id: `${box.id}-note`, text: note, ...inner, y: box.y, h: room, max: size, min: 18, color: c.ink, align: 'center', hug: true, scaled: false, bind: box.bind, step: box.step })
    : null;
  if (body?.overflow) body = null;
  // A frame too small for the note isn't a problem with the slide: forget the "too long" notes.
  ctx.warnings.length = warned;
  const total = label.h + (body ? gap + body.h : 0);
  const top = Math.round(box.y + (box.h - total) / 2);
  label = { ...label, y: top, moveWith: box.id };
  return body ? [frame, label, { ...body, y: top + label.h + gap, moveWith: box.id }] : [frame, label];
}

function missingKind(slide: Slide, ctx: LayoutContext, message?: string): SlideLayout {
  const plugin = slide.kind.includes('.') ? slide.kind.split('.')[0] : '';
  const content = (slide.content ?? {}) as Record<string, unknown>;
  const heading = ['title', 'term', 'word', 'question', 'heading'].map((k) => content[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  const note = message ?? (plugin
    ? `This slide comes from the “${plugin}” mod, which isn’t installed here. Its content and key notes are kept.`
    : `Unknown slide type “${slide.kind}”. Its content and key notes are kept.`);
  const boxes: Box[] = [
    text(ctx, { id: 'title', text: heading || 'Slide from a mod', x: M.x, y: 360, w: M.w, h: 200, role: 'display', max: 80, min: 48, hug: true, maxLines: 2 }),
    text(ctx, { id: 'note', text: note, x: M.x, y: 600, w: M.w - 300, h: 160, max: 34, min: 26, color: ctx.theme.colors.muted, hug: true }),
  ];
  return { background: ctx.theme.colors.bg, boxes, steps: 0, warnings: [note] };
}

/** Lays out every visible slide of a deck. */
export function layoutDeck(deck: Deck, o: Omit<LayoutOptions, 'theme' | 'audience'> & { includeHidden?: boolean } = {}) {
  const theme = getTheme(deck.themeId);
  const slides = o.includeHidden ? deck.slides : deck.slides.filter((s) => !s.hidden);
  const parts = partPlaces(deck);
  return slides.map((slide, i) => ({
    slide,
    layout: layoutSlide(slide, { ...o, theme, audience: deck.audience, slideNumber: i + 1, slideCount: slides.length, deckTitle: deck.title, purpose: deckPurpose(deck), density: deck.density, part: parts.get(slide.id) }),
  }));
}
