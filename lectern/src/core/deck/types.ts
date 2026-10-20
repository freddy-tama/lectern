// The deck model. Framework-free: the studio, presenter, study mode, exporters
// and plugins all read and write these shapes.

export type Audience = 'young' | 'teen' | 'adult';

/** What a deck is for. It sets the wording of key notes, study mode, the handout and AI drafting. */
export type DeckPurpose = 'lesson' | 'talk' | 'pitch' | 'report';

export interface CheckQuestion {
  question: string;
  answer: string;
}

export interface NoteLink {
  label: string;
  url: string;
}

/**
 * Key notes travel with every slide. They serve two readers:
 * the presenter (script on the teleprompter, cues, timing) and the learner
 * (key points and a self-check while studying the deck alone).
 */
export interface KeyNotes {
  /** What to say. Read from the teleprompter or the presenter view. */
  script: string;
  /** The points a learner must remember from this slide. */
  keyPoints: string[];
  /** Short delivery reminders, for example "Pause" or "Ask the room". */
  cues: string[];
  /** One question that checks understanding, with its answer. */
  check: CheckQuestion | null;
  /** Planned minutes for this slide. */
  minutes: number;
  links: NoteLink[];
  /** Fields added by mods, keyed by mod id. Kept even when the mod is not installed. */
  extra?: Record<string, Record<string, string>>;
}

export interface Slide<C = Record<string, unknown>> {
  id: string;
  /** A registered slide kind, for example "bullets" or a plugin kind like "chinese.word". */
  kind: string;
  content: C;
  notes: KeyNotes;
  /** Optional layout variant offered by the kind, for example "image-right". */
  variant?: string;
  /** The presenter chose this layout, so auto style leaves it alone. */
  variantPinned?: boolean;
  /** Skipped when presenting and exporting, kept in the studio. */
  hidden?: boolean;
}

export interface Deck {
  id: string;
  title: string;
  themeId: string;
  audience: Audience;
  slides: Slide[];
  /** What the deck is for. Missing on older decks: see deckPurpose(). */
  purpose?: DeckPurpose;
  /** Lesson this deck belongs to, when it was made from a lesson. */
  lessonId?: string;
  /** Planned length of the session in minutes. */
  minutes?: number;
  /** Lectern picks each slide's layout to suit its content (see autoVariants). */
  autoStyle?: boolean;
  createdAt: number;
  updatedAt: number;
  /** Which plugin (if any) made this deck. Core decks leave it empty. */
  source?: string;
  /** Deck-level values that mods store, keyed by mod id (see deckFields). */
  extra?: Record<string, Record<string, string>>;
}

export const AUDIENCES: { id: Audience; label: string; detail: string }[] = [
  { id: 'young', label: 'Young learners', detail: 'Ages 6–11 · big type, few words' },
  { id: 'teen', label: 'Teens', detail: 'Ages 12–17 · balanced' },
  { id: 'adult', label: 'Adults', detail: 'University, workshops, talks' },
];

export const PURPOSES: { id: DeckPurpose; label: string; detail: string }[] = [
  { id: 'lesson', label: 'Lesson', detail: 'Teach something, with checks for understanding' },
  { id: 'talk', label: 'Talk', detail: 'Share an idea with an audience' },
  { id: 'pitch', label: 'Pitch', detail: 'Make the case for a product, plan or investment' },
  { id: 'report', label: 'Report', detail: 'Walk through results and decisions' },
];

/** The deck's purpose. Older decks have none: those made from a lesson are lessons, the rest are talks. */
export function deckPurpose(deck: Pick<Deck, 'purpose' | 'lessonId'>): DeckPurpose {
  if (deck.purpose && PURPOSES.some((p) => p.id === deck.purpose)) return deck.purpose;
  return deck.lessonId ? 'lesson' : 'talk';
}

export function emptyNotes(partial: Partial<KeyNotes> = {}): KeyNotes {
  return {
    script: '',
    keyPoints: [],
    cues: [],
    check: null,
    minutes: 2,
    links: [],
    ...partial,
  };
}

export function uid(prefix = 'id'): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${random}`;
}

/** Normalises anything that claims to be key notes (old saves, AI output, plugins). */
export function normalizeNotes(value: unknown): KeyNotes {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const strings = (x: unknown) => (Array.isArray(x) ? x.map((s) => String(s ?? '').trim()).filter(Boolean) : []);
  const check = v.check && typeof v.check === 'object' ? (v.check as Record<string, unknown>) : null;
  const minutes = Number(v.minutes);
  return {
    script: typeof v.script === 'string' ? v.script : '',
    keyPoints: strings(v.keyPoints),
    cues: strings(v.cues),
    check: check && String(check.question ?? '').trim()
      ? { question: String(check.question).trim(), answer: String(check.answer ?? '').trim() }
      : null,
    minutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(60, Math.round(minutes * 2) / 2) : 2,
    links: Array.isArray(v.links)
      ? (v.links as Record<string, unknown>[])
          .map((l) => ({ label: String(l?.label ?? '').trim(), url: String(l?.url ?? '').trim() }))
          .filter((l) => /^https?:\/\//i.test(l.url))
      : [],
    ...(v.extra && typeof v.extra === 'object' ? { extra: v.extra as KeyNotes['extra'] } : {}),
  };
}

export function deckMinutes(deck: Pick<Deck, 'slides'>): number {
  return deck.slides.filter((s) => !s.hidden).reduce((sum, s) => sum + (s.notes?.minutes || 0), 0);
}
