// Pictures and videos dropped or pasted onto the stage: which field of the slide
// they fill, or which new slide carries them.

import { makeSlide } from '../../core/deck/draft';
import { fieldAt, getAt } from '../../core/deck/paths';
import type { Slide } from '../../core/deck/types';
import { cleanSvg } from '../../core/media/embed';
import { parseVideo } from '../../core/media/video';
import { getKind } from '../../core/kinds/registry';
import { saveAsset } from '../../data/repo';
import { savePicture } from '../pictures/store';
import { sizedSvg } from './code-ai';

export type MediaType = 'image' | 'video';

/** The field a picture or video should fill: the one under the pointer, else the first empty one, else the first. */
export function mediaTarget(slide: Slide, type: MediaType, prefer?: string): string | null {
  const def = getKind(slide.kind);
  if (!def) return null;
  if (prefer && fieldAt(def.fields, prefer)?.type === type) return prefer;
  const binds: string[] = [];
  for (const f of def.fields) {
    if (f.type === type) binds.push(f.key);
    if (f.type === 'objects') {
      const sub = f.fields.find((x) => x.type === type);
      const items = Array.isArray(slide.content[f.key]) ? (slide.content[f.key] as unknown[]) : [];
      if (sub) items.forEach((_, i) => binds.push(`${f.key}.${i}.${sub.key}`));
    }
  }
  return binds.find((b) => !String(getAt(slide.content, b) ?? '').trim()) ?? binds[0] ?? null;
}

/** A new slide that shows the picture or video on its own. */
export function mediaSlide(type: MediaType, ref: string): Slide {
  return type === 'image'
    ? makeSlide('image', { title: '', body: '', image: ref, caption: '' }, { minutes: 1 }, 'full')
    : makeSlide('video', { title: '', video: ref }, { minutes: 2 }, 'full');
}

/** Saves a dropped or pasted file in this browser. Returns its reference and type, or an error to show. */
export async function storeFile(file: File): Promise<{ type: MediaType; ref: string } | { error: string }> {
  if (file.type.startsWith('image/')) {
    if (file.size > 12 * 1024 * 1024) return { error: 'This picture is over 12 MB. Choose a smaller one.' };
    return { type: 'image', ref: await savePicture(file, file.name || 'Pasted picture', { source: 'upload', rights: 'own' }) };
  }
  if (file.type.startsWith('video/')) {
    if (file.size > 300 * 1024 * 1024) return { error: 'This video is over 300 MB. Upload it to YouTube and paste the link instead.' };
    return { type: 'video', ref: await saveAsset(file, file.name || 'Video') };
  }
  return { error: 'Drop a picture or a video file.' };
}

const SVG_START = /^<svg[\s>]|^<\?xml[\s\S]*<svg[\s>]/i;

/** Whether pasted text is something the stage takes: a video link or SVG code. Quick, so a paste can be claimed at once. */
export function placeableText(text: string): boolean {
  const value = text.trim();
  return Boolean(value) && ((/^https?:\/\//i.test(value) && !/\s/.test(value) && Boolean(parseVideo(value))) || SVG_START.test(value));
}

/** Pasted text that Lectern can place: a video link, or SVG code (saved as a picture). */
export async function storeText(text: string): Promise<{ type: MediaType; ref: string } | null> {
  const value = text.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value) && !/\s/.test(value) && parseVideo(value)) return { type: 'video', ref: value };
  if (SVG_START.test(value)) {
    const svg = cleanSvg(value);
    if (!svg) return null;
    const blob = new Blob([sizedSvg(svg)], { type: 'image/svg+xml' });
    return { type: 'image', ref: await savePicture(blob, 'Pasted drawing', { source: 'upload', rights: 'own', title: 'Drawing' }) };
  }
  return null;
}
