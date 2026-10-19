// Light Markdown for notes: parsed into plain data here, drawn as React elements in NoteBody.
// Supports "# headings", "- points", "1. steps", "- [ ] tasks", "> quotes", "---",
// **bold**, _italic_, `code`, [links](https://…) and bare https:// links.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; c: Inline[] }
  | { t: 'italic'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

export interface ListItem {
  /** Line index in the body, for checkbox toggling. */
  line: number;
  text: string;
  /** Nesting level from leading spaces (two per level). */
  depth: number;
  task?: { done: boolean };
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string; line: number }
  | { type: 'paragraph'; lines: string[]; line: number }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[]; line: number }
  | { type: 'quote'; lines: string[]; line: number }
  | { type: 'rule'; line: number };

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

const depthOf = (indent: string) => Math.min(4, Math.floor(indent.replace(/\t/g, '  ').length / 2));

export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  const close = () => { if (current) blocks.push(current); current = null; };

  body.split('\n').forEach((raw, line) => {
    const text = raw.replace(/\s+$/, '');
    if (!text.trim()) { close(); return; }
    if (RULE.test(text)) { close(); blocks.push({ type: 'rule', line }); return; }

    const h = HEADING.exec(text);
    if (h) {
      close();
      blocks.push({ type: 'heading', level: Math.min(3, h[1].length) as 1 | 2 | 3, text: h[2], line });
      return;
    }

    const task = TASK.exec(text);
    const bullet = task ? null : BULLET.exec(text);
    const ordered = task || bullet ? null : ORDERED.exec(text);
    if (task || bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const item: ListItem = task
        ? { line, text: task[3], depth: depthOf(task[1]), task: { done: task[2] !== ' ' } }
        : bullet
          ? { line, text: bullet[2], depth: depthOf(bullet[1]) }
          : { line, text: ordered![3], depth: depthOf(ordered![1]) };
      const cur = current as Block | null;
      if (cur?.type === 'list' && (cur.ordered === isOrdered || item.depth > 0)) {
        cur.items.push(item);
      } else {
        close();
        current = { type: 'list', ordered: isOrdered, start: ordered ? Number(ordered[2]) || 1 : 1, items: [item], line };
      }
      return;
    }

    const q = QUOTE.exec(text);
    if (q) {
      const cur = current as Block | null;
      if (cur?.type === 'quote') cur.lines.push(q[1]);
      else { close(); current = { type: 'quote', lines: [q[1]], line }; }
      return;
    }

    const cur = current as Block | null;
    if (cur?.type === 'paragraph') cur.lines.push(text.trim());
    else { close(); current = { type: 'paragraph', lines: [text.trim()], line }; }
  });
  close();
  return blocks;
}

const INLINE = /(\*\*|__)(.+?)\1|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])|(?<![\w*])\*(?!\s)([^*]+?)\*(?![\w*])|(?<![\w_])_(?!\s)([^_]+?)_(?![\w_])/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (v: string) => {
    if (!v) return;
    const prev = out[out.length - 1];
    if (prev?.t === 'text') prev.v += v;
    else out.push({ t: 'text', v });
  };
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    push(text.slice(last, at));
    last = at + m[0].length;
    if (m[2] !== undefined) out.push({ t: 'bold', c: parseInline(m[2]) });
    else if (m[3] !== undefined) out.push({ t: 'code', v: m[3] });
    else if (m[4] !== undefined) {
      const href = safeHref(m[5]);
      if (href) out.push({ t: 'link', href, c: parseInline(m[4]) });
      else push(m[4]);
    } else if (m[6] !== undefined) {
      const href = safeHref(m[6]);
      if (href) out.push({ t: 'link', href, c: [{ t: 'text', v: m[6] }] });
      else push(m[6]);
    } else if (m[7] !== undefined) out.push({ t: 'italic', c: parseInline(m[7]) });
    else if (m[8] !== undefined) out.push({ t: 'italic', c: parseInline(m[8]) });
  }
  push(text.slice(last));
  return out;
}

/** Only web, mail and in-app links. Anything else (javascript:, data:) is dropped. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^\/(?!\/)/.test(h)) return h;
  if (/^(https?:|mailto:)/i.test(h)) return h;
  if (/^www\./i.test(h)) return `https://${h}`;
  return null;
}

// ─── Editing helpers ──────────────────────────────────────────────────

/** Replace the text between from and to with insert. */
export interface RangeEdit {
  from: number;
  to: number;
  insert: string;
}

export function applyEdit(value: string, edit: RangeEdit): { value: string; cursor: number } {
  return { value: value.slice(0, edit.from) + edit.insert + value.slice(edit.to), cursor: edit.from + edit.insert.length };
}

function lineAround(value: string, caret: number) {
  const start = value.lastIndexOf('\n', caret - 1) + 1;
  const endIdx = value.indexOf('\n', caret);
  return { start, end: endIdx === -1 ? value.length : endIdx };
}

/**
 * Enter at the end of a list line: continues the list ("- ", "- [ ] ", "2. ").
 * On an empty item it ends the list instead. Returns null when Enter should behave normally.
 */
export function continueList(value: string, caret: number): RangeEdit | null {
  const { start, end } = lineAround(value, caret);
  if (value.slice(caret, end).trim()) return null;
  const m = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|(\d+)([.)])\s+)(.*)$/.exec(value.slice(start, caret));
  if (!m) return null;
  const [, indent, marker, num, sep, rest] = m;
  // An empty item ends the list: remove its marker.
  if (!rest.trim()) return { from: start, to: caret, insert: '' };
  const prefix = num ? `${Number(num) + 1}${sep} ` : /\[[ xX]\]/.test(marker) ? `${marker.trim()[0]} [ ] ` : `${marker.trim()} `;
  return { from: caret, to: caret, insert: `\n${indent}${prefix}` };
}

/** Adds a "- [ ] " task: on the caret's line when it is empty, otherwise on a new line below it. */
export function insertTask(value: string, caret: number): RangeEdit {
  const { start, end } = lineAround(value, caret);
  if (!value.slice(start, end).trim()) return { from: start, to: end, insert: '- [ ] ' };
  return { from: end, to: end, insert: '\n- [ ] ' };
}

/**
 * Splits quick-capture text: the first line becomes the title and the rest the body.
 * A first line that is a list item or very long stays in the body (the list shows its first line anyway).
 */
export function splitCapture(text: string): { title: string; body: string } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  if (!lines.length) return { title: '', body: '' };
  const first = lines[0].trim();
  if (/^([-*+]\s|\d+[.)]\s|>)/.test(first) || first.length > 90) return { title: '', body: lines.join('\n').trim() };
  const rest = lines.slice(1);
  while (rest.length && !rest[0].trim()) rest.shift();
  return { title: first.replace(/^#{1,6}\s+/, '').trim(), body: rest.join('\n').replace(/\s+$/, '') };
}
