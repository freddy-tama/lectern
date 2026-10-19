import type { Box } from '../engine/boxes';
import type { LayoutContext } from './kit';

/** Describes one editable field. The studio draws its form from these. */
export type FieldSpec =
  | { key: string; label: string; type: 'text'; placeholder?: string; help?: string }
  | { key: string; label: string; type: 'textarea'; placeholder?: string; rows?: number; help?: string }
  | {
      key: string; label: string; type: 'list'; itemLabel: string; placeholder?: string; max?: number; help?: string;
      /** Name of a numeric content field that marks one item as correct. */
      correctKey?: string;
    }
  | { key: string; label: string; type: 'objects'; itemLabel: string; fields: FieldSpec[]; max?: number; min?: number; help?: string }
  | { key: string; label: string; type: 'image'; help?: string }
  | { key: string; label: string; type: 'toggle'; help?: string };

/** Where a slide type sits in the Add slide menu. */
export type KindGroup = 'Open' | 'Explain' | 'Data' | 'Visual' | 'Engage' | 'Close';

export interface KindLayout {
  boxes: Box[];
  background?: string;
  /** Which decoration and footer to add. "bare" adds neither. */
  frame?: 'content' | 'title' | 'section' | 'bare';
}

export interface SlideKindDefinition<C extends Record<string, unknown> = Record<string, unknown>> {
  kind: string;
  label: string;
  description: string;
  /** A lucide icon name, for example "list" or "quote". */
  icon: string;
  group: KindGroup;
  variants?: { id: string; label: string }[];
  fields: FieldSpec[];
  create(): C;
  layout(content: C, ctx: LayoutContext, variant?: string): KindLayout;
  /** Visible text in reading order. Used for search, word counts and drafting key notes. */
  text(content: C): string[];
  /** One line naming the slide, for thumbnails and outlines. */
  heading(content: C): string;
  /** The plugin that registered this kind. Empty for core kinds. */
  plugin?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyKind = SlideKindDefinition<any>;
