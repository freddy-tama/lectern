import type { Box } from '../engine/boxes';
import type { LayoutContext } from './kit';

interface FieldCommon {
  key: string;
  label: string;
  help?: string;
  /** Tucked under "More options" in the studio, so the main fields stay short. */
  more?: boolean;
  /** False keeps the field from AI drafting, for content only people supply (answers from the room). */
  ai?: false;
}

/** Describes one editable field. The studio draws its form from these. */
export type FieldSpec = FieldCommon & (
  | { type: 'text'; placeholder?: string }
  | { type: 'textarea'; placeholder?: string; rows?: number }
  | {
      type: 'list'; itemLabel: string; placeholder?: string; max?: number;
      /** Name of a numeric content field that marks one item as correct. */
      correctKey?: string;
    }
  | { type: 'objects'; itemLabel: string; fields: FieldSpec[]; max?: number; min?: number }
  | { type: 'image' }
  | { type: 'toggle' }
  /** A video file, or a YouTube, Vimeo or video link. */
  | { type: 'video' }
  /**
   * A live activity: the key holds what to build (the prompt) and htmlKey the code
   * that runs. The studio offers AI to write or change the code, and a paste box.
   */
  | { type: 'activity'; htmlKey: string; placeholder?: string }
);

/** Where a slide type sits in the Add slide menu. */
export type KindGroup = 'Open' | 'Explain' | 'Data' | 'Visual' | 'Media' | 'Engage' | 'Close';

export interface KindLayout {
  boxes: Box[];
  background?: string;
  /** Which decoration and footer to add. "bare" adds neither. */
  frame?: 'content' | 'title' | 'section' | 'bare';
}

/** What auto style knows about a slide's place in the deck when it picks a layout. */
export interface AutoContext {
  /** Position among the deck's visible slides, from 0. */
  index: number;
  count: number;
  /** How many slides of this kind come before this one. */
  nth: number;
  /** The layout auto style gave the previous slide of this kind. */
  previous?: string;
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
  /**
   * The layout that suits this content best, for auto style. Kinds without variants leave it out;
   * kinds with variants that leave it out alternate their layouts down the deck.
   */
  autoVariant?(content: C, auto: AutoContext): string | undefined;
  /** The plugin that registered this kind. Empty for core kinds. */
  plugin?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyKind = SlideKindDefinition<any>;
