// Practice slide types: true or false, and fill in the blanks. Registered with the core kinds,
// next to the question and quick recall slides. Answers appear one click at a time.

import type { Box } from '../engine/boxes';
import { M, card, heightAt, read, shape, slideTitle, sz, text } from './kit';
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

export const PRACTICE_KINDS: AnyKind[] = [trueFalse, fillIn];
