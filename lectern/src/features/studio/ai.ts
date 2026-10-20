import type { Audience, DeckPurpose } from '../../core/deck/types';
import { allKinds } from '../../core/kinds/registry';
import type { DeckDraft } from '../../core/plugins/api';
import { draftingHints } from '../../core/plugins/registry';
import type { Density } from '../../data/profile';

export interface AiStatus {
  available: boolean;
  model?: string;
  needsCode?: boolean;
}

const CODE_KEY = 'lectern.aiCode';

export function savedCode(): string {
  try { return localStorage.getItem(CODE_KEY) ?? ''; } catch { return ''; }
}

export function saveCode(code: string) {
  try { localStorage.setItem(CODE_KEY, code); } catch { /* private mode */ }
}

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

/** Kinds the server may use: core ones plus any a mod registered, with their fields. */
function kindCatalogue() {
  return allKinds().map((k) => ({
    kind: k.kind,
    label: k.label,
    description: k.description,
    fields: k.fields.map((f) => ({ key: f.key, type: f.type, label: f.label, ...(f.type === 'objects' ? { fields: f.fields.map((x) => x.key) } : {}) })),
  }));
}

export async function draftWithAI(req: DraftRequest, signal?: AbortSignal): Promise<DeckDraft> {
  const res = await fetch('/api/draft-deck', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lectern-code': savedCode() },
    body: JSON.stringify({ ...req, kinds: kindCatalogue(), hints: draftingHints() }),
    signal,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'The AI draft failed. Try again, or start from your notes.');
  return body.draft as DeckDraft;
}
