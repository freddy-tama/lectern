// Client side of /api/revise-slide: AI help on one slide (revise, key notes, split, ask).
// Whole-deck drafting lives in ./ai.

import { slideProblems } from '../../core/deck/check';
import { type Deck, type KeyNotes, type Slide, deckPurpose, emptyNotes, normalizeNotes, uid } from '../../core/deck/types';
import { getTheme } from '../../core/engine/themes';
import { DENSITY } from '../../core/kinds/kit';
import { getKind } from '../../core/kinds/registry';
import type { AnyKind, FieldSpec } from '../../core/kinds/types';
import { draftingHints } from '../../core/plugins/registry';
import { savedCode } from './ai';

const ENDPOINT = '/api/revise-slide';

export type PresetId = 'shorter' | 'simpler' | 'detail' | 'example' | 'tone' | 'notes' | 'custom' | 'split';

export const PRESETS: { id: Exclude<PresetId, 'tone' | 'custom' | 'split'>; label: string; detail: string }[] = [
  { id: 'shorter', label: 'Shorter', detail: 'Fewer words, same meaning' },
  { id: 'simpler', label: 'Simpler', detail: 'Plainer words for this audience' },
  { id: 'detail', label: 'More detail', detail: 'More specific and concrete' },
  { id: 'example', label: 'Add an example', detail: 'A case, a number or a scenario' },
  { id: 'notes', label: 'Fill key notes', detail: 'Script, key points and a question' },
];

export const TONES: { id: string; label: string }[] = [
  { id: 'warmer', label: 'Warmer' },
  { id: 'formal', label: 'More formal' },
  { id: 'confident', label: 'More confident' },
  { id: 'playful', label: 'More playful' },
  { id: 'neutral', label: 'More neutral' },
];

/** A short name for a request, shown on the suggestion while it is previewed. */
export function requestLabel(preset: PresetId, instruction = ''): string {
  if (preset === 'tone') return `Tone: ${TONES.find((t) => t.id === instruction)?.label ?? 'changed'}`;
  if (preset === 'custom') return instruction.length > 48 ? `${instruction.slice(0, 47)}…` : instruction;
  if (preset === 'split') return 'Split with AI';
  return PRESETS.find((p) => p.id === preset)?.label ?? 'Revised';
}

/** One kind's editable fields as the server reads them. Mod kinds come from the same registry. */
export function kindSpec(def: AnyKind) {
  return {
    kind: def.kind,
    label: def.label,
    description: def.description,
    fields: def.fields.map((f) => ({
      key: f.key,
      type: f.type,
      label: f.label,
      ...('help' in f && f.help ? { help: f.help } : {}),
      ...('max' in f && f.max ? { max: f.max } : {}),
      ...(f.type === 'list' && f.correctKey ? { correctKey: f.correctKey } : {}),
      ...(f.type === 'objects' ? { fields: f.fields.map((x) => ({ key: x.key, type: x.type, label: x.label })) } : {}),
    })),
  };
}

const imageKeys = (fields: FieldSpec[]) => fields.filter((f) => f.type === 'image').map((f) => f.key);

/** The slide's content without pictures: they can be large and the AI never changes them. */
export function contentForAi(def: AnyKind, content: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...content };
  for (const k of imageKeys(def.fields)) delete out[k];
  for (const f of def.fields) {
    if (f.type !== 'objects' || !Array.isArray(out[f.key])) continue;
    const sub = imageKeys(f.fields);
    if (sub.length) out[f.key] = (out[f.key] as Record<string, unknown>[]).map((o) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !sub.includes(k))));
  }
  return out;
}

/**
 * Lays revised content over the slide. Pictures, fields the AI didn't return and mod values stay
 * as they were; items in a list of objects keep their own pictures by position.
 */
export function mergeContent(def: AnyKind | undefined, original: Record<string, unknown>, revised: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...original, ...revised };
  for (const f of def?.fields ?? []) {
    if (f.type === 'image') {
      if (f.key in original) out[f.key] = original[f.key];
      else delete out[f.key];
    }
    if (f.type !== 'objects' || !Array.isArray(revised[f.key])) continue;
    const sub = imageKeys(f.fields);
    if (!sub.length) continue;
    const before = Array.isArray(original[f.key]) ? (original[f.key] as Record<string, unknown>[]) : [];
    out[f.key] = (revised[f.key] as Record<string, unknown>[]).map((item, i) => ({
      ...item,
      ...Object.fromEntries(sub.filter((k) => before[i] && k in before[i]).map((k) => [k, before[i][k]])),
    }));
  }
  return out;
}

/** Revised key notes over the slide's own: links and mod fields are kept, as is the time if none came back. */
export function mergeNotes(original: KeyNotes, revised: Partial<KeyNotes> | undefined): KeyNotes {
  if (!revised) return original;
  return normalizeNotes({ ...original, ...revised, links: original.links, ...(original.extra ? { extra: original.extra } : {}) });
}

export interface SlideRevision {
  content?: Record<string, unknown>;
  notes?: Partial<KeyNotes>;
}

/** The slide with a revision applied. Same id, kind and variant. */
export function applyRevision(slide: Slide, revision: SlideRevision): Slide {
  const def = getKind(slide.kind);
  return {
    ...slide,
    content: revision.content ? mergeContent(def, slide.content, revision.content) : slide.content,
    notes: mergeNotes(slide.notes, revision.notes),
  };
}

/** Two slides from an AI split: the first keeps the original's id, the second is new. */
export function applySplit(slide: Slide, halves: [SlideRevision, SlideRevision]): [Slide, Slide] {
  const first = applyRevision(slide, halves[0]);
  const blank: Slide = { ...slide, id: uid('s'), notes: emptyNotes({ minutes: slide.notes.minutes }) };
  const second = applyRevision(blank, halves[1]);
  return [first, second];
}

/** Headings of up to two slides on each side, so a rewrite fits where it sits. */
export function neighbourHeadings(deck: Deck, index: number) {
  const heading = (s: Slide) => {
    const def = getKind(s.kind);
    try { return def ? def.heading(s.content).trim() : ''; } catch { return ''; }
  };
  return {
    before: deck.slides.slice(Math.max(0, index - 2), index).map(heading).filter(Boolean),
    after: deck.slides.slice(index + 1, index + 3).map(heading).filter(Boolean),
  };
}

function context(deck: Deck, slide: Slide) {
  const def = getKind(slide.kind);
  if (!def) throw new Error('This slide comes from a mod that isn’t installed, so AI can’t edit it.');
  const index = deck.slides.findIndex((s) => s.id === slide.id);
  return {
    deck: { title: deck.title, purpose: deckPurpose(deck), audience: deck.audience, look: lookName(deck.themeId) },
    neighbours: neighbourHeadings(deck, Math.max(0, index)),
    slide: { kind: slide.kind, content: contentForAi(def, slide.content), notes: { ...slide.notes, links: undefined, extra: undefined }, variant: slide.variant },
    kind: kindSpec(def),
    hints: draftingHints(),
    budget: DENSITY[deck.audience],
  };
}

function lookName(themeId: string) {
  const t = getTheme(themeId);
  return t.description ? `${t.name}, ${t.description}` : t.name;
}

export interface SlideAiStatus {
  available: boolean;
  needsCode: boolean;
}

let status: Promise<SlideAiStatus> | null = null;

/** Whether the server has AI set up for slides. Asked once per session; a failed check is asked again. */
export function slideAiStatus(): Promise<SlideAiStatus> {
  status ??= fetch(ENDPOINT, { method: 'GET' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: Partial<SlideAiStatus>) => ({ available: Boolean(j.available), needsCode: Boolean(j.needsCode) }))
    .catch(() => {
      status = null;
      return { available: false, needsCode: false };
    });
  return status;
}

export class SlideAiError extends Error {
  constructor(message: string, readonly needsCode = false) {
    super(message);
  }
}

async function post<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lectern-code': savedCode() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new SlideAiError('Couldn’t reach the server. Check your connection and try again.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new SlideAiError(typeof json.error === 'string' ? json.error : 'The AI request failed. Try again.', res.status === 401);
  return json as T;
}

export type RevisionResult = { kind: 'one'; slide: Slide } | { kind: 'two'; slides: [Slide, Slide] };

/** Asks for one change to the slide. The result is a preview: nothing in the deck changes until it is accepted. */
export async function reviseSlide(deck: Deck, slide: Slide, preset: PresetId, instruction = '', signal?: AbortSignal): Promise<RevisionResult> {
  const mode = preset === 'notes' ? 'notes' : preset === 'split' ? 'split' : 'revise';
  const out = await post<{ revision?: SlideRevision; split?: [SlideRevision, SlideRevision] }>({ mode, preset, instruction, ...context(deck, slide) }, signal);
  if (mode === 'split') {
    if (!out.split || out.split.length !== 2) throw new SlideAiError('The AI didn’t return two slides. Try again.');
    return { kind: 'two', slides: applySplit(slide, out.split) };
  }
  if (!out.revision) throw new SlideAiError('The AI returned nothing. Try again.');
  return { kind: 'one', slide: applyRevision(slide, out.revision) };
}

/**
 * Asks the AI to trim a slide until it fits, given the layout's own warnings. Returns the slide
 * with the change applied (same id and kind). Whether it now fits is for the caller to check.
 */
export async function fitSlide(deck: Deck, slide: Slide, problems: string[], signal?: AbortSignal): Promise<Slide> {
  const words = slideProblems(slide, deck).words?.count;
  const out = await post<{ revision?: SlideRevision }>({ mode: 'fit', problems, words, ...context(deck, slide) }, signal);
  if (!out.revision) throw new SlideAiError('The AI returned nothing. Try again.');
  return applyRevision(slide, out.revision);
}

export interface CheckedRevision {
  result: RevisionResult;
  /** The suggestion was trimmed by an automatic fit. */
  fitted: boolean;
  /** A suggested slide still doesn't fit. */
  overflow: boolean;
}

const slidesOf = (r: RevisionResult): Slide[] => (r.kind === 'one' ? [r.slide] : r.slides);

/**
 * Checks a suggestion before it is shown. A suggested slide that wouldn't fit gets one automatic
 * fit; code then decides whether the fit worked, and a fit that still overflows is dropped.
 */
export async function checkRevision(
  deck: Deck,
  result: RevisionResult,
  o: { signal?: AbortSignal; onFitting?(): void; fit?: typeof fitSlide } = {},
): Promise<CheckedRevision> {
  const slides = slidesOf(result);
  const problems = slides.map((s) => slideProblems(s, deck));
  if (problems.every((p) => !p.overflow.length)) return { result, fitted: false, overflow: false };
  o.onFitting?.();
  const fit = o.fit ?? fitSlide;
  const next = await Promise.all(slides.map(async (s, i) => {
    if (!problems[i].overflow.length) return s;
    try {
      const trimmed = await fit(deck, s, problems[i].warnings, o.signal);
      return slideProblems(trimmed, deck).overflow.length ? s : trimmed;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      return s;
    }
  }));
  const fitted = next.some((s, i) => s !== slides[i]);
  const overflow = next.some((s) => slideProblems(s, deck).overflow.length > 0);
  return { result: result.kind === 'one' ? { kind: 'one', slide: next[0] } : { kind: 'two', slides: [next[0], next[1]] }, fitted, overflow };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

/** A short answer about selected text, with the slide as context. Read-only. */
export async function askAboutSlide(deck: Deck, slide: Slide, selection: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const out = await post<{ reply?: string }>({ mode: 'ask', selection, messages, ...context(deck, slide) }, signal);
  return out.reply?.trim() || 'No answer came back. Try asking again.';
}
