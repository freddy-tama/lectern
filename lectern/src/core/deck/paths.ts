// Content paths. A box's `bind` names the content it shows: "title", "bullets.2"
// (an item of a list) or "stats.1.value" (a field of an item). These read and
// write content by that name, and find the field spec behind it.

import type { FieldSpec } from '../kinds/types';

type Content = Record<string, unknown>;

export function splitBind(bind: string): (string | number)[] {
  return bind.split('.').filter(Boolean).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

/** The value a bind names, or undefined. */
export function getAt(content: Content, bind: string): unknown {
  let v: unknown = content;
  for (const p of splitBind(bind)) {
    if (v == null || typeof v !== 'object') return undefined;
    v = (v as Record<string | number, unknown>)[p];
  }
  return v;
}

/** A copy of the content with one value replaced. Lists and items along the way are copied too. */
export function setAt(content: Content, bind: string, value: unknown): Content {
  const parts = splitBind(bind);
  const write = (node: unknown, i: number): unknown => {
    const key = parts[i];
    if (i === parts.length) return value;
    if (typeof key === 'number') {
      const list = Array.isArray(node) ? [...node] : [];
      while (list.length < key) list.push(typeof parts[i + 1] === 'string' ? {} : '');
      list[key] = write(list[key], i + 1);
      return list;
    }
    const obj = node && typeof node === 'object' && !Array.isArray(node) ? { ...(node as Content) } : {};
    obj[key] = write(obj[key], i + 1);
    return obj;
  };
  return write(content, 0) as Content;
}

/** The field spec a bind points into: the list for "bullets.2", the sub-field for "stats.1.value". */
export function fieldAt(fields: FieldSpec[], bind: string): FieldSpec | undefined {
  const [top, index, sub] = splitBind(bind);
  const spec = fields.find((f) => f.key === top);
  if (!spec) return undefined;
  if (index === undefined) return spec;
  if (spec.type === 'list' && typeof index === 'number' && sub === undefined) return spec;
  if (spec.type === 'objects' && typeof index === 'number' && typeof sub === 'string') return spec.fields.find((f) => f.key === sub);
  return undefined;
}

/** Whether a bind is plain text that can be typed straight onto the slide. */
export function isTextBind(fields: FieldSpec[], content: Content, bind: string): boolean {
  const spec = fieldAt(fields, bind);
  if (!spec) return false;
  const value = getAt(content, bind);
  if (value != null && typeof value !== 'string') return false;
  if (spec.type === 'list') return typeof splitBind(bind)[1] === 'number';
  return spec.type === 'text' || spec.type === 'textarea';
}

/** Whether a bind is one item of a list of strings, where Enter adds the next item. */
export function isListItem(fields: FieldSpec[], bind: string): boolean {
  const parts = splitBind(bind);
  return parts.length === 2 && typeof parts[1] === 'number' && fieldAt(fields, bind)?.type === 'list';
}

/** The list with a blank item after `index`. */
export function insertItem(content: Content, key: string, index: number): Content {
  const list = Array.isArray(content[key]) ? [...(content[key] as unknown[])] : [];
  list.splice(index + 1, 0, '');
  return { ...content, [key]: list };
}

export function removeItem(content: Content, key: string, index: number): Content {
  const list = Array.isArray(content[key]) ? [...(content[key] as unknown[])] : [];
  list.splice(index, 1);
  return { ...content, [key]: list };
}
