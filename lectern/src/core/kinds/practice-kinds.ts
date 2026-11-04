// Practice slide types: true or false, fill in the blanks, put in order, and match or sort.
// Registered with the core kinds, next to the question and quick recall slides. Answers appear
// one click at a time.

import type { Box } from '../engine/boxes';
import { type LayoutContext, M, card, heightAt, imageSrc, read, shape, slideTitle, sz, text } from './kit';
import type { AnyKind, SlideKindDefinition } from './types';

type C = Record<string, unknown>;

/** A toggle as stored: true, or "true" from an AI or an import that wrote it as text. */
export function isOn(v: unknown): boolean {
  return v === true || (typeof v === 'string' && /^(true|yes)$/i.test(v.trim()));
}

// ─── True or false ────────────────────────────────────────────────────

interface Statement {
  /** Place in the stored list, for binds. */
  i: number;
  statement: string;
  isTrue: boolean;
  correction: string;
}

function statements(c: C): Statement[] {
  return read.objects<C>(c, 'items')
    .map((o, i) => ({ i, statement: read.str(o, 'statement').trim(), isTrue: isOn(o.isTrue), correction: read.str(o, 'correction').trim() }))
    .filter((s) => s.statement || s.correction);
}

const trueFalse: SlideKindDefinition<C> = {
  kind: 'true-false', label: 'True or false', description: 'Statements to judge true or false. Each verdict appears on its own click, with the correction of a false one.', icon: 'check-check', group: 'Engage',
  fields: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'items', label: 'Statements', type: 'objects', itemLabel: 'Statement', max: 6, min: 1, fields: [
      { key: 'statement', label: 'Statement', type: 'textarea', rows: 2 },
      { key: 'isTrue', label: 'It’s true', type: 'toggle' },
      { key: 'correction', label: 'Correction', type: 'text', help: 'For a false statement: what is true. It appears with the verdict.' },
    ] },
  ],
  create: () => ({
    title: 'True or false?',
    items: [
      { statement: 'The Sun is a star.', isTrue: true, correction: '' },
      { statement: 'The Moon makes its own light.', isTrue: false, correction: 'The Moon reflects light from the Sun.' },
      { statement: 'Earth goes round the Sun once a year.', isTrue: true, correction: '' },
    ],
  }),
  heading: (c) => read.str(c, 'title') || 'True or false',
  text: (c) => [read.str(c, 'title'), ...statements(c).flatMap((s) => [s.statement, s.isTrue ? '' : s.correction])].filter(Boolean),
  checks: (c) => statements(c).filter((s) => s.statement).map((s) => ({ prompt: s.statement, answer: s.isTrue ? s.statement : s.correction })),
  layout(c, ctx) {
    const items = statements(c).slice(0, 6);
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title') || 'True or false?');
    const boxes: Box[] = [box];
    const n = items.length;
    if (!n) return { boxes };
    const colors = ctx.theme.colors;
    const gap = sz(ctx, 24);
    const rowH = Math.min(sz(ctx, 190), (M.bottom - bottom - gap * (n - 1)) / n);
    const padX = sz(ctx, 32);
    const padY = Math.min(sz(ctx, 18), rowH * 0.12);
    const numW = sz(ctx, 60);
    const d = Math.min(rowH - padY * 2, sz(ctx, 80));
    const textX = M.x + padX + numW;
    const textW = M.w - padX * 3 - numW - d;
    items.forEach((s, k) => {
      const y = bottom + k * (rowH + gap);
      const at = `items.${s.i}`;
      const step = k + 1;
      const fix = !s.isTrue && s.correction;
      const statementH = fix ? (rowH - padY * 2) * 0.56 : rowH - padY * 2;
      boxes.push(card(ctx, `item-${k}`, M.x, y, M.w, rowH));
      boxes.push(text(ctx, { id: `num-${k}`, text: String(k + 1), x: M.x + padX, y, w: numW, h: rowH, max: 36, min: 24, weight: 750, color: colors.accent, valign: 'middle', maxLines: 1 }));
      boxes.push(text(ctx, { id: `statement-${k}`, text: s.statement || ' ', x: textX, y: y + padY, w: textW, h: statementH, max: 42, min: 24, weight: 600, valign: fix ? 'bottom' : 'middle', bind: `${at}.statement` }));
      if (fix) {
        boxes.push(text(ctx, { id: `correction-${k}`, text: s.correction, x: textX, y: y + padY + statementH, w: textW, h: rowH - padY * 2 - statementH, max: 34, min: 22, weight: 650, color: colors.good, valign: 'top', step, reveal: 'answer', bind: `${at}.correction` }));
      }
      // An empty ring until the click; then a tick or a cross, in the verdict's colour.
      const bx = M.right - padX - d;
      const by = y + (rowH - d) / 2;
      boxes.push(shape({ id: `slot-${k}`, shape: 'ellipse', x: bx, y: by, w: d, h: d, stroke: colors.line, strokeWidth: 4 }));
      boxes.push(shape({ id: `verdict-${k}`, shape: 'ellipse', x: bx, y: by, w: d, h: d, fill: s.isTrue ? colors.good : colors.accent, step, reveal: 'answer' }));
      boxes.push({
        type: 'text', id: `mark-${k}`, x: bx, y: by, w: d, h: d, text: s.isTrue ? '✓' : '✗', step, reveal: 'answer',
        style: { font: 'body', size: Math.round(d * 0.56), weight: 800, color: s.isTrue ? '#FFFFFF' : colors.onAccent, align: 'center', valign: 'middle', lineHeight: 1 },
      });
    });
    return { boxes };
  },
};

// ─── Fill in the blanks ───────────────────────────────────────────────

/** An answer in square brackets marks a blank: "The Sun is a [star]." */
const BLANK = /\[([^[\]\n]{1,80})\]/g;

/** The answers of a passage's blanks, in order. */
export function blanksOf(passage: string): string[] {
  return [...passage.matchAll(BLANK)].map((m) => m[1]!.trim()).filter(Boolean);
}

/** The passage as the room sees it: each blank numbered and empty. */
function blanked(passage: string): string {
  let n = 0;
  return passage.replace(BLANK, (_, a: string) => (a.trim() ? `(${++n})______` : '______'));
}

/** The passage with every blank filled in. */
const filled = (passage: string) => passage.replace(BLANK, (_, a: string) => a.trim());

/** The words to choose from: the ones given, or else the answers, each once, from A to Z so their order gives nothing away. */
function bankOf(c: C): string[] {
  if (isOn(c.hideBank)) return [];
  const given = read.list(c, 'bank').map((w) => w.trim());
  return given.length ? given : [...new Set(blanksOf(read.str(c, 'passage')))].sort((a, b) => a.localeCompare(b));
}

const fillIn: SlideKindDefinition<C> = {
  kind: 'fill-in', label: 'Fill in the blanks', description: 'A passage with blanks to fill from a word bank. Put each answer in [square brackets] in the passage; each appears on its own click. Blank words that carry the meaning, not names.', icon: 'text-cursor-input', group: 'Engage',
  fields: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'passage', label: 'Passage', type: 'textarea', rows: 5, help: 'Put each answer in [square brackets], for example: The Sun is a [star].' },
    { key: 'bank', label: 'Word bank', type: 'list', itemLabel: 'Word', max: 12, help: 'Left empty, the bank shows the answers from A to Z. Add a word that doesn’t fit to make it harder.' },
    { key: 'hideBank', label: 'Hide the word bank', type: 'toggle', more: true },
  ],
  create: () => ({
    title: 'Fill in the blanks',
    passage: 'Plants take in [carbon dioxide] and water. With energy from [sunlight], they make sugar and give out [oxygen].',
    bank: [],
    hideBank: false,
  }),
  heading: (c) => read.str(c, 'title') || 'Fill in the blanks',
  text: (c) => {
    const answers = new Set(blanksOf(read.str(c, 'passage')));
    return [read.str(c, 'title'), filled(read.str(c, 'passage')), ...bankOf(c).filter((w) => !answers.has(w))].filter(Boolean);
  },
  checks: (c) => blanksOf(read.str(c, 'passage')).map((answer) => ({ prompt: '', answer })),
  layout(c, ctx) {
    const colors = ctx.theme.colors;
    const passage = read.str(c, 'passage');
    const answers = blanksOf(passage).slice(0, 12);
    const bank = bankOf(c);
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title') || 'Fill in the blanks');
    const boxes: Box[] = [box];
    if (passage.trim() && !answers.length && ctx.mode === 'edit') ctx.warnings.push('Put each answer in [square brackets] to make a blank.');
    const gap = sz(ctx, 32);
    const pad = sz(ctx, 28);
    let y = bottom;
    if (bank.length) {
      const words = bank.join('   ·   ');
      const h = Math.min(sz(ctx, 150), Math.ceil(heightAt(ctx, words, sz(ctx, 34), M.w - pad * 2)) + pad * 2);
      boxes.push(card(ctx, 'bank', M.x, y, M.w, h, { stroke: colors.accent, strokeWidth: 3 }));
      boxes.push(text(ctx, { id: 'bank-words', text: words, x: M.x + pad, y: y + pad * 0.6, w: M.w - pad * 2, h: h - pad * 1.2, max: 34, min: 22, weight: 650, align: 'center', valign: 'middle', bind: 'bank' }));
      y += h + gap;
    }
    // One card per blank along the bottom: its number shows from the start, the answer on its click.
    const n = answers.length;
    const cols = Math.min(n, 4);
    const rows = Math.ceil(n / Math.max(cols, 1));
    const chipGap = sz(ctx, 20);
    const chipH = sz(ctx, 84);
    const chipW = cols ? Math.min(560, (M.w - chipGap * (cols - 1)) / cols) : 0;
    const answersH = n ? rows * chipH + (rows - 1) * chipGap : 0;
    const passageH = M.bottom - y - (n ? answersH + gap : 0);
    boxes.push(text(ctx, { id: 'passage', text: blanked(passage) || ' ', x: M.x, y, w: M.w, h: passageH, max: 46, min: 26, lh: 1.55, valign: 'middle', bind: 'passage' }));
    const top = M.bottom - answersH;
    answers.forEach((answer, k) => {
      const x = M.x + (k % cols) * (chipW + chipGap);
      const cy = top + Math.floor(k / cols) * (chipH + chipGap);
      const label = `(${k + 1})`;
      const labelW = sz(ctx, 30) * (label.length * 0.62) + pad;
      boxes.push(card(ctx, `blank-${k}`, x, cy, chipW, chipH));
      boxes.push(text(ctx, { id: `blank-${k}-num`, text: label, x: x + pad, y: cy, w: labelW, h: chipH, max: 30, min: 22, weight: 700, color: colors.muted, valign: 'middle', maxLines: 1 }));
      boxes.push(text(ctx, { id: `blank-${k}-answer`, text: answer, x: x + pad + labelW, y: cy, w: chipW - pad * 2 - labelW, h: chipH, max: 34, min: 20, weight: 700, color: colors.good, valign: 'middle', maxLines: 2, step: k + 1, reveal: 'answer', bind: 'passage' }));
    });
    return { boxes };
  },
};

// ─── Put in order ─────────────────────────────────────────────────────

/** Chinese, Japanese and Korean script, written without spaces between words. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** A small, steady hash of the items, so a slide is mixed up the same way every time it is shown. */
function seedOf(items: string[]): number {
  let h = 2166136261;
  for (const ch of items.join('\u0001')) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
  return h || 1;
}

/**
 * The order the room sees the items in, as indexes into the right order: mixed up, the same for the
 * same items, and never already right.
 */
export function shownOrder(items: string[]): number[] {
  const order = items.map((_, i) => i);
  if (order.length < 2) return order;
  let seed = seedOf(items);
  for (let i = order.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  if (order.every((v, i) => v === i)) order.push(order.shift()!);
  return order;
}

/** The items as one line in the right order: joined without spaces in Chinese, with them otherwise. */
export function inOrder(items: string[]): string {
  const tight = items.every((s) => CJK.test(s) && !/\s/.test(s.trim()));
  return items.map((s) => s.trim()).join(tight ? '' : ' ');
}

/** Short items (a word or a phrase each) sit as tiles in rows; longer ones as a list of cards. */
const isShort = (s: string) => (CJK.test(s) ? s.replace(/\s/g, '').length <= 8 : s.trim().split(/\s+/).length <= 3);
const tilesFit = (items: string[]) => items.length >= 3 && items.every(isShort);

const LETTERS = 'ABCDEFGHIJKL';

/** The place in the stored list of each kept item, blanks included, for binds. */
function storedIndexes(c: C): number[] {
  return read.items(c, 'items').flatMap((s, i) => (s.trim() ? [i] : []));
}

const order: SlideKindDefinition<C> = {
  kind: 'order', label: 'Put in order', description: 'Items to put in the right order: events, the steps of a process, or the words or sentences of a passage. List them in the right order; the slide shows them mixed up, and each click shows where the next one goes.', icon: 'arrow-down-up', group: 'Engage',
  variants: [{ id: 'list', label: 'Cards' }, { id: 'tiles', label: 'Tiles' }],
  autoVariant: (c) => (tilesFit(read.list(c, 'items')) ? 'tiles' : 'list'),
  fields: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'items', label: 'Items, in the right order', type: 'list', itemLabel: 'Item', max: 8, help: 'The slide mixes them up. Each click shows where the next one goes.' },
  ],
  create: () => ({
    title: 'Put these in order',
    items: ['Water evaporates from the sea', 'Vapour cools and forms clouds', 'Rain falls on the land', 'Rivers carry the water back to the sea'],
  }),
  heading: (c) => read.str(c, 'title') || 'Put in order',
  text: (c) => [read.str(c, 'title'), ...read.list(c, 'items')].filter(Boolean),
  checks: (c) => {
    const items = read.list(c, 'items');
    return items.length >= 2 ? [{ prompt: read.str(c, 'title') || 'Put in order', answer: inOrder(items) }] : [];
  },
  layout(c, ctx, variant) {
    const items = read.list(c, 'items').slice(0, 8);
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title') || 'Put these in order');
    const boxes: Box[] = [box];
    if (items.length < 2) {
      if (ctx.mode === 'edit') ctx.warnings.push('Add at least two items to put in order.');
      return { boxes };
    }
    // Item i of the right order sits at place `at`; its number appears on click i + 1.
    const shown = shownOrder(items);
    const binds = storedIndexes(c);
    const colors = ctx.theme.colors;
    const n = items.length;
    const gap = sz(ctx, 22);
    const number = (id: string, x: number, y: number, d: number, i: number): Box[] => [
      shape({ id: `place-${id}`, shape: 'ellipse', x, y, w: d, h: d, fill: colors.accent, step: i + 1, reveal: 'answer' }),
      { type: 'text', id: `number-${id}`, x, y, w: d, h: d, text: String(i + 1), step: i + 1, reveal: 'answer',
        style: { font: 'body', size: Math.round(d * 0.5), weight: 800, color: colors.onAccent, align: 'center', valign: 'middle', lineHeight: 1 } },
    ];

    if ((variant ?? (tilesFit(items) ? 'tiles' : 'list')) === 'tiles') {
      // Tiles in rows, and the whole line in the right order underneath, with the last number.
      const cols = n > 6 ? 4 : n > 4 ? 3 : n;
      const rows = Math.ceil(n / cols);
      const lineH = sz(ctx, 120);
      const tileW = (M.w - gap * (cols - 1)) / cols;
      const tileH = Math.min(sz(ctx, 190), (M.bottom - bottom - lineH - gap * rows) / rows);
      const d = Math.min(sz(ctx, 64), tileH * 0.42);
      const top = bottom + d * 0.3 + Math.max(0, (M.bottom - bottom - d * 0.3 - lineH - gap - rows * tileH - (rows - 1) * gap) / 2);
      shown.forEach((i, at) => {
        const row = Math.floor(at / cols);
        const inRow = Math.min(cols, n - row * cols);
        const x = M.x + (M.w - (inRow * tileW + (inRow - 1) * gap)) / 2 + (at % cols) * (tileW + gap);
        const y = top + row * (tileH + gap);
        boxes.push(card(ctx, `tile-${at}`, x, y, tileW, tileH));
        boxes.push(text(ctx, { id: `item-${at}`, text: items[i]!, x: x + sz(ctx, 20), y: y + d * 0.5, w: tileW - sz(ctx, 40), h: tileH - d * 0.8, max: 48, min: 22, weight: 650, align: 'center', valign: 'middle', bind: `items.${binds[i]}` }));
        boxes.push(...number(String(at), x + tileW - d * 0.75, y - d * 0.3, d, i));
      });
      const lineY = M.bottom - lineH;
      boxes.push(card(ctx, 'answer-card', M.x, lineY, M.w, lineH, { stroke: colors.good, strokeWidth: 3, step: n, reveal: 'answer' }));
      boxes.push(text(ctx, { id: 'answer', text: inOrder(items), x: M.x + sz(ctx, 28), y: lineY, w: M.w - sz(ctx, 56), h: lineH, max: 44, min: 22, weight: 700, color: colors.good, align: 'center', valign: 'middle', maxLines: 2, step: n, reveal: 'answer' }));
      return { boxes };
    }

    // Cards down the slide (two columns past five), each with a letter and an empty ring for its place.
    const cols = n > 5 ? 2 : 1;
    const rows = Math.ceil(n / cols);
    const colW = (M.w - gap * (cols - 1)) / cols;
    const rowH = Math.min(sz(ctx, 150), (M.bottom - bottom - gap * (rows - 1)) / rows);
    const pad = sz(ctx, 28);
    const letterW = sz(ctx, 56);
    const d = Math.min(rowH - sz(ctx, 24), sz(ctx, 76));
    shown.forEach((i, at) => {
      const x = M.x + Math.floor(at / rows) * (colW + gap);
      const y = bottom + (at % rows) * (rowH + gap);
      const bx = x + colW - pad - d;
      const by = y + (rowH - d) / 2;
      boxes.push(card(ctx, `card-${at}`, x, y, colW, rowH));
      boxes.push(text(ctx, { id: `letter-${at}`, text: LETTERS[at]!, x: x + pad, y, w: letterW, h: rowH, max: 36, min: 24, weight: 750, color: colors.accent, valign: 'middle', maxLines: 1 }));
      boxes.push(text(ctx, { id: `item-${at}`, text: items[i]!, x: x + pad + letterW, y: y + sz(ctx, 10), w: bx - (x + pad + letterW) - pad, h: rowH - sz(ctx, 20), max: 40, min: 22, weight: 600, valign: 'middle', bind: `items.${binds[i]}` }));
      boxes.push(shape({ id: `slot-${at}`, shape: 'ellipse', x: bx, y: by, w: d, h: d, stroke: colors.line, strokeWidth: 4 }));
      boxes.push(...number(String(at), bx, by, d, i));
    });
    return { boxes };
  },
};

// ─── Match or sort ────────────────────────────────────────────────────

interface Pair {
  /** Place in the stored list, for binds. */
  i: number;
  item: string;
  picture: string;
  match: string;
}

function pairsOf(c: C): Pair[] {
  return read.objects<C>(c, 'items')
    .map((o, i) => ({ i, item: read.str(o, 'item').trim(), picture: read.str(o, 'picture').trim(), match: read.str(o, 'match').trim() }))
    .filter((p) => (p.item || p.picture) && p.match);
}

/** The groups items are sorted into, in the order they first appear. */
const groupsOf = (pairs: Pair[]) => [...new Set(pairs.map((p) => p.match))];

/** Items that share a match are sorted into groups; otherwise each item has a match of its own. */
const isSort = (pairs: Pair[]) => groupsOf(pairs).length < pairs.length;

/** An item as text: its words, or its letter when it is only a picture. */
const itemLabel = (p: Pair, letter: string) => p.item || `(${letter})`;

/** A card with a picture on its left, when it has one, and its words beside it or under it. */
function itemCard(ctx: LayoutContext, id: string, p: Pair, x: number, y: number, w: number, h: number, o: { pad: number; size: number; stacked?: boolean }): Box[] {
  const boxes: Box[] = [card(ctx, `${id}-card`, x, y, w, h)];
  const src = imageSrc(ctx, p.picture);
  const bind = `items.${p.i}`;
  if (src && o.stacked) {
    const textH = p.item ? Math.min(h * 0.32, sz(ctx, 52)) : 0;
    boxes.push({ type: 'image', id: `${id}-picture`, src, x: x + o.pad / 2, y: y + o.pad / 2, w: w - o.pad, h: h - o.pad - textH, fit: 'cover', radius: ctx.theme.radius, bind: `${bind}.picture` });
    if (p.item) boxes.push(text(ctx, { id: `${id}-text`, text: p.item, x: x + o.pad / 2, y: y + h - o.pad / 2 - textH, w: w - o.pad, h: textH, max: o.size * 0.8, min: 18, weight: 650, align: 'center', valign: 'middle', maxLines: 1, bind: `${bind}.item` }));
    return boxes;
  }
  let left = x + o.pad;
  if (src) {
    const side = h - o.pad;
    const pw = p.item ? side : w - o.pad;
    boxes.push({ type: 'image', id: `${id}-picture`, src, x: x + o.pad / 2, y: y + o.pad / 2, w: pw, h: side, fit: 'cover', radius: ctx.theme.radius, bind: `${bind}.picture` });
    left = x + o.pad / 2 + pw + o.pad / 2;
  }
  if (p.item) boxes.push(text(ctx, { id: `${id}-text`, text: p.item, x: left, y: y + sz(ctx, 8), w: x + w - o.pad - left, h: h - sz(ctx, 16), max: o.size, min: 20, weight: 600, valign: 'middle', bind: `${bind}.item` }));
  return boxes;
}

const match: SlideKindDefinition<C> = {
  kind: 'match', label: 'Match or sort', description: 'Items to match with a partner (a word and its meaning, a term and a picture) or to sort into groups. Each row is an item and its match; when several items share a match, they are sorted into the group it names. The answers appear on click.', icon: 'shuffle', group: 'Engage',
  variants: [{ id: 'pairs', label: 'Pairs' }, { id: 'groups', label: 'Groups' }],
  autoVariant: (c) => (isSort(pairsOf(c)) ? 'groups' : 'pairs'),
  fields: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'items', label: 'Items', type: 'objects', itemLabel: 'Item', max: 12, min: 2, fields: [
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'match', label: 'Its match, or its group', type: 'text', help: 'Items with the same group are sorted together. The matches are shown mixed up.' },
      { key: 'picture', label: 'Picture', type: 'image' },
    ] },
  ],
  create: () => ({
    title: 'Match each word to its meaning',
    items: [
      { item: 'evaporate', match: 'turn from liquid into gas', picture: '' },
      { item: 'condense', match: 'turn from gas into liquid', picture: '' },
      { item: 'precipitation', match: 'water falling from clouds', picture: '' },
    ],
  }),
  heading: (c) => read.str(c, 'title') || (isSort(pairsOf(c)) ? 'Sort into groups' : 'Match'),
  text: (c) => {
    const pairs = pairsOf(c);
    const answers = isSort(pairs) ? groupsOf(pairs) : pairs.map((p) => p.match);
    return [read.str(c, 'title'), ...pairs.map((p) => p.item), ...answers].filter(Boolean);
  },
  // Items sorted into groups share their answers, so like blanks they ask without a prompt of their own.
  checks: (c) => {
    const pairs = pairsOf(c);
    const sort = isSort(pairs);
    return pairs.map((p) => ({ prompt: sort ? '' : p.item, answer: p.match }));
  },
  layout(c, ctx, variant) {
    const all = pairsOf(c);
    const sort = (variant ?? (isSort(all) ? 'groups' : 'pairs')) === 'groups';
    const pairs = all.slice(0, sort ? 12 : 6);
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title') || (sort ? 'Sort into groups' : 'Match'));
    const boxes: Box[] = [box];
    if (pairs.length < 2) {
      if (ctx.mode === 'edit') ctx.warnings.push('Add at least two items, each with its match or group.');
      return { boxes };
    }
    if (all.length > pairs.length && ctx.mode === 'edit') ctx.warnings.push(`Only the first ${pairs.length} items fit. Split the rest onto another slide.`);
    const colors = ctx.theme.colors;
    const gap = sz(ctx, 22);
    const pad = sz(ctx, 24);
    const n = pairs.length;
    const badge = (id: string, x: number, y: number, d: number, value: string, step: number): Box[] => [
      shape({ id: `${id}-dot`, shape: 'ellipse', x, y, w: d, h: d, fill: colors.accent, step, reveal: 'answer' }),
      { type: 'text', id, x, y, w: d, h: d, text: value, step, reveal: 'answer',
        style: { font: 'body', size: Math.round(d * 0.46), weight: 800, color: colors.onAccent, align: 'center', valign: 'middle', lineHeight: 1 } },
    ];

    if (!sort) {
      // Items down the left with letters, their matches mixed up down the right with numbers.
      // Each click puts the number of an item's match beside it.
      const matches = pairs.map((p) => p.match);
      const shown = shownOrder(matches);
      const place = new Map(shown.map((i, at) => [i, at]));
      const mid = sz(ctx, 120);
      const colW = (M.w - mid) / 2;
      const rowH = Math.min(sz(ctx, 150), (M.bottom - bottom - gap * (n - 1)) / n);
      const d = Math.min(rowH * 0.7, sz(ctx, 70));
      const letterW = sz(ctx, 48);
      pairs.forEach((p, k) => {
        const y = bottom + k * (rowH + gap);
        boxes.push(text(ctx, { id: `letter-${k}`, text: LETTERS[k]!, x: M.x, y, w: letterW, h: rowH, max: 34, min: 22, weight: 750, color: colors.accent, valign: 'middle', maxLines: 1 }));
        boxes.push(...itemCard(ctx, `item-${k}`, p, M.x + letterW, y, colW - letterW, rowH, { pad, size: 38 }));
        boxes.push(...badge(`answer-${k}`, M.x + colW + (mid - d) / 2, y + (rowH - d) / 2, d, String(place.get(k)! + 1), k + 1));
      });
      shown.forEach((i, at) => {
        const y = bottom + at * (rowH + gap);
        const x = M.x + colW + mid;
        boxes.push(card(ctx, `match-${at}-card`, x, y, colW, rowH));
        boxes.push(text(ctx, { id: `match-${at}-number`, text: String(at + 1), x: x + pad, y, w: letterW, h: rowH, max: 34, min: 22, weight: 750, color: colors.muted, valign: 'middle', maxLines: 1 }));
        boxes.push(text(ctx, { id: `match-${at}`, text: pairs[i]!.match, x: x + pad + letterW, y: y + sz(ctx, 8), w: colW - pad * 2 - letterW, h: rowH - sz(ctx, 16), max: 38, min: 20, weight: 600, valign: 'middle', bind: `items.${pairs[i]!.i}.match` }));
      });
      return { boxes };
    }

    // The items mixed up in a pool with letters, a column per group underneath. Each click fills a group.
    const groups = groupsOf(pairs).slice(0, 4);
    if (groupsOf(pairs).length > 4 && ctx.mode === 'edit') ctx.warnings.push('Sort into at most four groups.');
    const shown = shownOrder(pairs.map((p) => `${p.item}\u0002${p.picture}\u0002${p.match}`));
    const letterOf = new Map(shown.map((i, at) => [i, LETTERS[at] ?? String(at + 1)]));
    const pictures = pairs.some((p) => p.picture);
    const cols = Math.min(n, pictures ? 6 : 4);
    const rows = Math.ceil(n / cols);
    const tileW = (M.w - gap * (cols - 1)) / cols;
    const tileH = sz(ctx, pictures ? 150 : 84);
    const letterW = sz(ctx, 40);
    shown.forEach((i, at) => {
      const x = M.x + (at % cols) * (tileW + gap);
      const y = bottom + Math.floor(at / cols) * (tileH + gap);
      boxes.push(...itemCard(ctx, `item-${at}`, pairs[i]!, x + letterW, y, tileW - letterW, tileH, { pad: sz(ctx, 16), size: 32, stacked: pictures }));
      boxes.push(text(ctx, { id: `letter-${at}`, text: letterOf.get(i)!, x, y, w: letterW, h: tileH, max: 30, min: 20, weight: 750, color: colors.accent, valign: 'middle', maxLines: 1 }));
    });
    const top = bottom + rows * (tileH + gap) + gap;
    const colW = (M.w - gap * (groups.length - 1)) / groups.length;
    const headH = sz(ctx, 76);
    groups.forEach((g, k) => {
      const x = M.x + k * (colW + gap);
      boxes.push(card(ctx, `group-${k}-card`, x, top, colW, M.bottom - top));
      boxes.push(shape({ id: `group-${k}-head`, shape: 'rect', x, y: top, w: colW, h: headH, fill: colors.accent, radius: ctx.theme.radius }));
      boxes.push(text(ctx, { id: `group-${k}`, text: g, x: x + pad, y: top, w: colW - pad * 2, h: headH, max: 36, min: 20, weight: 750, color: colors.onAccent, align: 'center', valign: 'middle', maxLines: 1 }));
      const members = pairs.map((p, i) => ({ p, i })).filter(({ p }) => p.match === g).map(({ p, i }) => `${letterOf.get(i)}  ${itemLabel(p, letterOf.get(i)!)}`);
      boxes.push(text(ctx, { id: `group-${k}-items`, text: members.join('\n'), x: x + pad, y: top + headH + pad / 2, w: colW - pad * 2, h: M.bottom - top - headH - pad, max: 34, min: 18, weight: 600, color: colors.good, align: 'center', valign: 'top', step: k + 1, reveal: 'answer' }));
    });
    return { boxes };
  },
};

export const PRACTICE_KINDS: AnyKind[] = [trueFalse, fillIn, order, match];
