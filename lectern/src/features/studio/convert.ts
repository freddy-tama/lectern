import type { Slide } from '../../core/deck/types';
import { getKind } from '../../core/kinds/registry';

const HEADING_KEYS = ['title', 'question', 'term', 'quote'];

/**
 * Changes a slide to another kind, carrying over its heading and its list items
 * so the presenter does not lose work. Key notes are kept as they are.
 */
export function convertSlide(slide: Slide, kind: string): Slide {
  const from = getKind(slide.kind);
  const to = getKind(kind);
  if (!to || kind === slide.kind) return slide;
  const content = to.create();
  const c = slide.content as Record<string, unknown>;
  const heading = from ? from.heading(c) : '';
  const items: string[] = [];
  for (const f of from?.fields ?? []) {
    const v = c[f.key];
    if (f.type === 'list' && Array.isArray(v)) items.push(...v.map(String).filter((s) => s.trim()));
    if (f.type === 'objects' && Array.isArray(v)) {
      for (const o of v as Record<string, unknown>[]) {
        const first = Object.values(o ?? {}).find((x) => typeof x === 'string' && x.trim());
        if (first) items.push(String(first));
      }
    }
  }
  const headingKey = to.fields.find((f) => HEADING_KEYS.includes(f.key))?.key;
  if (headingKey && heading) content[headingKey] = heading;
  const listField = to.fields.find((f) => f.type === 'list' || f.type === 'objects');
  if (listField && items.length) {
    if (listField.type === 'list') content[listField.key] = items.slice(0, listField.max ?? 8);
    else if (listField.type === 'objects') {
      const firstKey = listField.fields[0]?.key ?? 'label';
      content[listField.key] = items.slice(0, listField.max ?? 6).map((s) => {
        const o: Record<string, string> = {};
        for (const f of listField.fields) o[f.key] = '';
        o[firstKey] = s;
        return o;
      });
    }
  }
  // Keep an image when both kinds have one.
  if (typeof c.image === 'string' && c.image && to.fields.some((f) => f.key === 'image')) content.image = c.image;
  return { ...slide, kind, content, variant: undefined };
}
