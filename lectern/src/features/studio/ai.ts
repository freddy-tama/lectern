import type { Audience, DeckPurpose } from '../../core/deck/types';
import { DENSITY } from '../../core/kinds/kit';
import { allKinds } from '../../core/kinds/registry';
import type { FieldSpec } from '../../core/kinds/types';
import type { DeckDraft } from '../../core/plugins/api';
import { draftingHints } from '../../core/plugins/registry';
import type { Density } from '../../data/profile';
import { aiPost } from '../account/session';

export interface AiStatus {
  available: boolean;
  model?: string;
  needsCode?: boolean;
}

// The access code lives with the sign-in, which sends it with every AI request.
export { saveCode, savedCode } from '../account/session';

let status: Promise<AiStatus> | null = null;

/** Asks the server whether AI drafting is configured. Cached for the session. */
export function aiStatus(): Promise<AiStatus> {
  status ??= fetch('/api/draft-deck', { method: 'GET' })
    .then((r) => (r.ok ? r.json() : { available: false }))
    .then((j: AiStatus) => ({ available: Boolean(j.available), model: j.model, needsCode: Boolean(j.needsCode) }))
    .catch(() => ({ available: false }));
  return status;
}

export interface DraftRequest {
  topic: string;
  audience: Audience;
  purpose: DeckPurpose;
  minutes: number;
  material?: string;
  title?: string;
  /** Answers to the AI's questions and remembered preferences. */
  answers?: { question: string; answer: string }[];
  /** How much goes on a slide. */
  density?: Density;
  /** Pictures the AI may place, by id ("pic1"), as small JPEGs. */
  pictures?: { id: string; name: string; mime: string; data: string }[];
}

/**
 * The field type the AI servers read. Videos travel like pictures (never sent, never changed);
 * an activity's description is plain text, and its code is never sent.
 */
export function aiFieldType(type: FieldSpec['type']): 'text' | 'textarea' | 'list' | 'objects' | 'toggle' | 'image' {
  if (type === 'video') return 'image';
  if (type === 'activity') return 'textarea';
  return type;
}

/** Kinds the server may use: core ones plus any a mod registered, with their fields. */
export function kindCatalogue() {
  return allKinds().map((k) => ({
    kind: k.kind,
    label: k.label,
    description: k.description,
    fields: k.fields.filter((f) => f.ai !== false).map((f) => ({
      key: f.key,
      type: aiFieldType(f.type),
      label: f.label,
      ...(f.type === 'objects' ? {
        fields: f.fields.map((x) => x.key),
        images: f.fields.filter((x) => x.type === 'image').map((x) => x.key),
        ...(f.max ? { max: f.max } : {}),
      } : {}),
    })),
  }));
}

export async function draftWithAI(req: DraftRequest, signal?: AbortSignal): Promise<DeckDraft> {
  const res = await aiPost('/api/draft-deck', JSON.stringify({ ...req, kinds: kindCatalogue(), hints: draftingHints(), budget: DENSITY[req.audience] }), signal);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'The AI draft failed. Try again, or start from your notes.');
  return body.draft as DeckDraft;
}
