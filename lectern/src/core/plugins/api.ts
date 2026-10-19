// The mod (plugin) contract. A mod can add slide kinds, themes, ways to start a
// deck, exporters, presenter toggles and extra key-note fields. Core features use
// the same contracts, so a mod is never a second-class citizen.
//
// Mods are chosen at build time: LECTERN_PLUGINS=chinese,lesson-plan npm run dev
// The public build ships with none.

import type { ComponentType } from 'react';
import type { Audience, Deck, KeyNotes, Slide } from '../deck/types';
import type { Theme } from '../engine/themes';
import type { AnyKind } from '../kinds/types';

/** What a deck source hands back: a deck without ids or timestamps. */
export interface DeckDraft {
  title: string;
  audience?: Audience;
  themeId?: string;
  minutes?: number;
  slides: Array<Pick<Slide, 'kind' | 'content'> & { notes?: Partial<KeyNotes>; variant?: string }>;
}

export interface DeckSourceProps {
  audience: Audience;
  /** Lesson the deck is for, when started from a lesson. */
  lessonTitle?: string;
  onDraft(draft: DeckDraft): void;
  onCancel(): void;
}

/** A way to start a deck, shown in the "New deck" dialog. */
export interface DeckSource {
  id: string;
  label: string;
  description: string;
  icon: string;
  Panel: ComponentType<DeckSourceProps>;
}

/** The lesson a deck belongs to, when it belongs to one. */
export interface ExportLesson {
  title: string;
  summary: string;
  week: number;
  /** ISO date (YYYY-MM-DD). */
  date?: string;
  /** 24-hour "HH:MM". */
  time?: string;
  durationMinutes?: number;
  courseTitle?: string;
  courseSubject?: string;
}

export interface ExportHelpers {
  /** Turns an image reference ("asset:…", URL) into a data URL, or null. */
  resolveImage(src: string): Promise<string | null>;
  lesson?: ExportLesson;
}

/** Adds an entry to the studio's Export menu. */
export interface DeckExporter {
  id: string;
  label: string;
  description: string;
  run(deck: Deck, helpers: ExportHelpers): Promise<{ data: Blob; fileName: string }>;
}

/** A key the presenter can press to flip a flag that slide layouts read (ctx.flags). */
export interface PresenterToggle {
  key: string;
  flag: string;
  label: string;
  defaultOn?: boolean;
}

/**
 * An extra field a mod adds. On a slide it is stored at notes.extra[modId][key];
 * on a deck (deckFields) at deck.extra[modId][key]. Values are always strings.
 */
export interface NotesField {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  /** 1 draws a single-line input; more draws a textarea (default 2). */
  rows?: number;
  /** Draws a select with these choices. An empty value means "not set". */
  options?: string[];
  /** Label of the empty choice when options are given. */
  emptyOption?: string;
  /** Where the field shows besides the studio: presenter view, study mode, or both. */
  audience?: 'presenter' | 'learner' | 'both';
}

export interface LecternPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  kinds?: AnyKind[];
  themes?: Theme[];
  deckSources?: DeckSource[];
  exporters?: DeckExporter[];
  toggles?: PresenterToggle[];
  notesFields?: NotesField[];
  /** Deck-level details, edited in the studio's Details dialog. */
  deckFields?: NotesField[];
  /** Extra guidance appended to AI drafting requests when this mod is on. */
  draftingHints?: string;
}
