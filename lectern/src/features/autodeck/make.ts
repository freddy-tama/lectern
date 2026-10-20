// The deck maker's logic, apart from React: what kind of file each drop is, the material
// sent to the AI, an offline draft when no AI is set up, and placing pictures on slides.

import { outlineToDraft } from '../../core/deck/outline';
import { type DeckPurpose, PURPOSES } from '../../core/deck/types';
import { OUTLINE_ACCEPT } from '../../core/import/files';
import { getKind } from '../../core/kinds/registry';
import type { FieldSpec } from '../../core/kinds/types';
import type { DeckDraft } from '../../core/plugins/api';
import { ACCEPT as MEDIA_ACCEPT, isMediaFile } from '../recordings/decode';

export type SourceKind = 'doc' | 'audio' | 'picture';
export type SourceStatus = 'reading' | 'transcribing' | 'ready' | 'error';

export interface Source {
  id: string;
  file: File;
  kind: SourceKind;
  status: SourceStatus;
  /** Outline text of a document, or the transcript of a recording. */
  text: string;
  words: number;
  error?: string;
  /** The recording made from an audio or video file, so its transcript stays in Recordings. */
  recordingId?: string;
  /** Pictures: the file itself, or pictures found inside a document. */
  pictures: File[];
}

/** What the file picker offers: every document type, pictures, and audio or video. */
export const ACCEPT_ALL = `${OUTLINE_ACCEPT},.png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp,${MEDIA_ACCEPT}`;

const PICTURE = /\.(png|jpe?g|gif|webp)$/i;

export function kindOf(file: { name: string; type: string }): SourceKind {
  if (isMediaFile(file as File)) return 'audio';
  if (/^image\/(png|jpeg|gif|webp)$/.test(file.type) || PICTURE.test(file.name)) return 'picture';
  return 'doc';
}

export const stem = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

const KIND_LABEL: Record<SourceKind, string> = { doc: 'document', audio: 'transcript of a recording', picture: 'picture' };

/**
 * Every file's text, labelled, within a character budget. When the files are too long
 * together, each gets a fair share, so one long file doesn't crowd out the others.
 */
export function buildMaterial(sources: Pick<Source, 'file' | 'kind' | 'text'>[], limit = 60_000): string {
  const parts = sources.filter((s) => s.kind !== 'picture' && s.text.trim());
  if (!parts.length) return '';
  const budgets = new Map<number, number>();
  let left = limit - parts.length * 80;
  const order = parts.map((p, i) => ({ i, len: p.text.length })).sort((a, b) => a.len - b.len);
  order.forEach(({ i, len }, n) => {
    const share = Math.floor(left / (order.length - n));
    const take = Math.max(0, Math.min(len, share));
    budgets.set(i, take);
    left -= take;
  });
  return parts.map((p, i) => {
    const take = budgets.get(i) ?? 0;
    const body = p.text.length > take ? `${p.text.slice(0, take).replace(/\s+\S*$/, '')}\n[…cut for length]` : p.text;
    return `=== ${p.file.name} (${KIND_LABEL[p.kind]}) ===\n${body.trim()}`;
  }).join('\n\n');
}

/** What the deck is about, for the AI, when the person wrote nothing. */
export function fallbackTopic(sources: Pick<Source, 'file' | 'kind'>[]): string {
  const names = sources.filter((s) => s.kind !== 'picture').map((s) => `“${stem(s.file.name)}”`);
  return names.length ? `A deck based on ${names.join(', ')}.` : 'A deck based on the attached pictures.';
}

/**
 * A deck draft built offline from the files' headings, for servers without AI.
 * One file reads as it is; several become sections of one deck.
 */
export function offlineDraft(sources: Pick<Source, 'file' | 'kind' | 'text' | 'pictures'>[], title: string): DeckDraft {
  const parts = sources.filter((s) => s.kind !== 'picture' && s.text.trim());
  // A document with its own title opens the deck; the other files follow as sections.
  const lead = parts.find((p) => p.kind === 'doc' && /^# \S/m.test(p.text));
  const rest = parts.filter((p) => p !== lead);
  const section = (p: (typeof parts)[number]) => {
    const demoted = p.text.replace(/^# (.+)$/gm, '## $1');
    return /^## /m.test(demoted) ? demoted : `## ${stem(p.file.name)}\n${demoted}`;
  };
  const outline = parts.length === 1 && parts[0]!.kind === 'doc'
    ? parts[0]!.text
    : [lead ? lead.text : `# ${title}`, ...rest.map(section)].join('\n\n');
  const draft = outlineToDraft(outline, title);
  const pictures = sources.flatMap((s) => s.pictures).slice(0, 4);
  const opening = draft.slides[0];
  if (pictures.length === 1 && opening?.kind === 'title' && !opening.content.image) {
    opening.content = { ...opening.content, image: 'pic1' };
  } else if (pictures.length) {
    const summaryAt = draft.slides.findIndex((s) => s.kind === 'summary');
    draft.slides.splice(summaryAt > 0 ? summaryAt : draft.slides.length, 0, pictures.length === 1
      ? { kind: 'image', content: { title: stem(pictures[0]!.name), body: '', image: 'pic1', caption: '', whole: true } }
      : { kind: 'gallery', content: { title: 'In pictures', images: pictures.map((_, i) => ({ image: `pic${i + 1}`, caption: '' })) } });
  }
  return { ...draft, title: draft.title || title };
}

export const PICTURE_ID = /^pic(\d{1,2})$/;

/**
 * Puts the files' pictures on the slides that asked for them by id ("pic2"). Each picture
 * is saved once as an asset; ids that point nowhere are cleared.
 */
export async function placePictures(draft: DeckDraft, pictures: File[], save: (file: File) => Promise<string>): Promise<DeckDraft> {
  const saved = new Map<number, Promise<string>>();
  const resolve = (value: unknown): Promise<string> | string => {
    if (typeof value !== 'string') return '';
    const m = PICTURE_ID.exec(value.trim());
    if (!m) return value;
    const index = Number(m[1]) - 1;
    const file = pictures[index];
    if (!file) return '';
    if (!saved.has(index)) saved.set(index, save(file));
    return saved.get(index)!;
  };
  const fill = async (content: Record<string, unknown>, fields: FieldSpec[]) => {
    for (const f of fields) {
      if (f.type === 'image') content[f.key] = await resolve(content[f.key]);
      else if (f.type === 'objects' && Array.isArray(content[f.key])) {
        content[f.key] = await Promise.all((content[f.key] as Record<string, unknown>[]).map(async (item) => {
          const copy = { ...(item ?? {}) };
          await fill(copy, f.fields);
          return copy;
        }));
      }
    }
  };
  const slides = await Promise.all(draft.slides.map(async (s) => {
    const def = getKind(s.kind);
    if (!def) return s;
    const content = { ...(s.content ?? {}) };
    await fill(content, def.fields);
    return { ...s, content };
  }));
  return { ...draft, slides };
}

export function purposeLabel(p: DeckPurpose): string {
  return PURPOSES.find((x) => x.id === p)?.label ?? p;
}
