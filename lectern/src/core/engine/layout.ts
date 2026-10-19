import type { Audience, Deck, Slide } from '../deck/types';
import { countWords } from '../deck/words';
import { registerCoreKinds } from '../kinds/core-kinds';
import { DENSITY, type LayoutContext, M, decorate, footer, text } from '../kinds/kit';
import { getKind } from '../kinds/registry';
import { toggleDefaults } from '../plugins/registry';
import { type Box, type SlideLayout, maxStep } from './boxes';
import { type Measure, measureText } from './measure';
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
  };
  const def = getKind(slide.kind);
  if (!def) return missingKind(slide, ctx);
  try {
    const result = def.layout(slide.content ?? {}, ctx, slide.variant);
    const frame = result.frame ?? 'content';
    const boxes: Box[] = [
      ...(frame === 'bare' ? [] : decorate(ctx, frame)),
      ...result.boxes,
      ...(frame === 'content' ? footer(ctx) : []),
    ];
    const words = wordCount(def.text(slide.content ?? {}));
    const budget = DENSITY[ctx.audience].words;
    if (frame === 'content' && words > budget) {
      ctx.warnings.push(`${words} words on this slide. For this audience, aim for ${budget} or fewer and move the rest to the key notes.`);
    }
    return {
      background: result.background ?? (frame === 'section' ? o.theme.colors.sectionBg : o.theme.colors.bg),
      boxes,
      steps: maxStep(boxes),
      warnings: [...new Set(ctx.warnings)],
    };
  } catch (error) {
    console.error('Slide layout failed', slide.kind, error);
    return missingKind(slide, ctx, 'This slide could not be drawn. Its content is kept; try another slide type.');
  }
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
  return slides.map((slide, i) => ({
    slide,
    layout: layoutSlide(slide, { ...o, theme, audience: deck.audience, slideNumber: i + 1, slideCount: slides.length, deckTitle: deck.title }),
  }));
}
