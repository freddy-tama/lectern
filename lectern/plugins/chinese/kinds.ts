// Slide kinds for Chinese lessons. Everything students see stays student-facing:
// characters, pinyin, words and sentences. Teaching terms live in the key notes.

import { type Box, CANVAS_H, type TextBox } from '../../src/core/engine/boxes';
import { cssFont } from '../../src/core/engine/measure';
import { fontWeight } from '../../src/core/engine/themes';
import { M, type LayoutContext, card, fam, imageSrc, read, shape, slideTitle, sz, text } from '../../src/core/kinds/kit';
import type { SlideKindDefinition } from '../../src/core/kinds/types';
import { toneMarks } from './pinyin';

type C = Record<string, unknown>;

export const PINYIN_FLAG = 'chinese.pinyin';
const showPinyin = (ctx: LayoutContext) => ctx.flags[PINYIN_FLAG] !== false;

/** Pinyin keeps its space when hidden, so nothing on the slide moves when the presenter presses P. */
function pinyinBox(ctx: LayoutContext, box: TextBox): TextBox {
  return showPinyin(ctx) ? box : { ...box, text: '' };
}
const PINYIN_HELP = 'Tone numbers work too: xue2 becomes xué.';

/** Stacks boxes top to bottom from y, with a gap after each. Returns the bottom edge. */
function stack(boxes: Box[], y: number, gaps: number[]) {
  boxes.forEach((b, i) => { b.y = y; y += b.h + (i < boxes.length - 1 ? gaps[i] ?? 24 : 0); });
  return y;
}

function shiftBy(boxes: Box[], dy: number) {
  boxes.forEach((b) => { b.y += dy; });
}

// ─── 生字: the characters of the lesson at a glance ─────────────────────

export const characters: SlideKindDefinition<C> = {
  kind: 'chinese.characters',
  label: 'Characters',
  description: 'The new characters or words of the lesson at a glance, each with its pinyin.',
  icon: 'grid-2x2',
  group: 'Explain',
  fields: [
    { key: 'title', label: 'Title', type: 'text', placeholder: '生字' },
    {
      key: 'items', label: 'Characters', type: 'objects', itemLabel: 'Character', min: 1, max: 10,
      fields: [
        { key: 'hanzi', label: 'Character or word', type: 'text' },
        { key: 'pinyin', label: 'Pinyin', type: 'text', help: PINYIN_HELP },
      ],
    },
    { key: 'oneByOne', label: 'Show one at a time', type: 'toggle', help: 'Each click shows the next character.' },
  ],
  create: () => ({
    title: '生字',
    items: [{ hanzi: '山', pinyin: 'shān' }, { hanzi: '水', pinyin: 'shuǐ' }, { hanzi: '火', pinyin: 'huǒ' }, { hanzi: '木', pinyin: 'mù' }],
    oneByOne: false,
  }),
  heading: (c) => read.str(c, 'title') || '生字',
  text: (c) => [read.str(c, 'title'), ...read.objects(c, 'items').flatMap((i) => [String(i.hanzi ?? ''), toneMarks(String(i.pinyin ?? ''))])].filter(Boolean),
  layout(c, ctx) {
    const items = read.objects(c, 'items').filter((i) => String(i.hanzi ?? '').trim()).slice(0, 10);
    const boxes: Box[] = [];
    const titleText = read.str(c, 'title');
    let top = M.top;
    if (titleText) {
      const t = slideTitle(ctx, titleText);
      boxes.push(t.box);
      top = t.bottom;
    }
    if (!items.length) return { boxes };
    const n = items.length;
    const cols = n <= 4 ? n : n <= 6 ? 3 : n <= 8 ? 4 : 5;
    const rows = Math.ceil(n / cols);
    const gap = 40;
    const areaH = M.bottom - top;
    const cellW = (M.w - gap * (cols - 1)) / cols;
    const cellH = Math.min((areaH - gap * (rows - 1)) / rows, cellW * 1.05);
    const gridH = cellH * rows + gap * (rows - 1);
    const y0 = top + Math.max(0, (areaH - gridH) / 2);
    const reveal = read.bool(c, 'oneByOne');
    items.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const lastRowCount = row === rows - 1 ? n - cols * (rows - 1) : cols;
      const offset = ((cols - lastRowCount) * (cellW + gap)) / 2;
      const x = M.x + offset + col * (cellW + gap);
      const y = y0 + row * (cellH + gap);
      const step = reveal ? i + 1 : undefined;
      boxes.push({ ...card(ctx, `cell-${i}`, x, y, cellW, cellH), step });
      const pinyin = toneMarks(String(item.pinyin ?? ''));
      const pinyinH = pinyin ? cellH * 0.2 : 0;
      if (pinyinH) {
        boxes.push(pinyinBox(ctx, text(ctx, {
          id: `py-${i}`, text: pinyin, x: x + 16, y: y + cellH * 0.08, w: cellW - 32, h: pinyinH, max: Math.min(64, pinyinH * 0.8), min: 22,
          align: 'center', valign: 'middle', color: ctx.theme.colors.accent, weight: 600, maxLines: 1, scaled: false, step, bind: `items.${i}.pinyin`,
        })));
      }
      const hanziTop = y + (pinyinH ? cellH * 0.08 + pinyinH : cellH * 0.08);
      const hanziH = y + cellH - cellH * 0.08 - hanziTop;
      boxes.push(text(ctx, {
        id: `hz-${i}`, text: String(item.hanzi), x: x + 16, y: hanziTop, w: cellW - 32, h: hanziH,
        role: 'display', max: Math.min(hanziH * 0.8, cellW * 0.62), min: 40, maxLines: 1, align: 'center', valign: 'middle',
        lh: 1.1, scaled: false, step, bind: `items.${i}.hanzi`,
      }));
    });
    return { boxes };
  },
};

// ─── One character or word, with pinyin, words and an example ───────────

export const word: SlideKindDefinition<C> = {
  kind: 'chinese.word',
  label: 'Word card',
  description: 'One character or word large, with pinyin, a picture, words that use it and an example sentence.',
  icon: 'languages',
  group: 'Explain',
  fields: [
    { key: 'hanzi', label: 'Character or word', type: 'text' },
    { key: 'pinyin', label: 'Pinyin', type: 'text', help: PINYIN_HELP },
    { key: 'meaning', label: 'Meaning', type: 'text', help: 'Optional. A picture often teaches the meaning better than a translation.' },
    { key: 'words', label: 'Words with it', type: 'list', itemLabel: 'Word', max: 4, placeholder: '学生' },
    { key: 'example', label: 'Example sentence', type: 'text' },
    { key: 'examplePinyin', label: 'Example pinyin', type: 'text', help: PINYIN_HELP },
    { key: 'image', label: 'Picture', type: 'image' },
  ],
  create: () => ({
    hanzi: '学', pinyin: 'xué', meaning: '', words: ['学生', '学校'],
    example: '我在学校学中文。', examplePinyin: 'Wǒ zài xuéxiào xué Zhōngwén.', image: '',
  }),
  heading: (c) => [read.str(c, 'hanzi'), toneMarks(read.str(c, 'pinyin'))].filter(Boolean).join(' ') || 'Word card',
  text: (c) => [read.str(c, 'hanzi'), toneMarks(read.str(c, 'pinyin')), read.str(c, 'meaning'), ...read.list(c, 'words'), read.str(c, 'example')].filter(Boolean),
  layout(c, ctx) {
    const src = imageSrc(ctx, c.image);
    const colW = src ? 1000 : M.w;
    const align = src ? 'left' : 'center';
    const parts: Box[][] = [];
    const gaps: number[] = [];

    const pinyin = toneMarks(read.str(c, 'pinyin'));
    if (pinyin) {
      parts.push([pinyinBox(ctx, text(ctx, { id: 'pinyin', text: pinyin, x: M.x, y: 0, w: colW, h: 120, max: 76, min: 40, weight: 600, color: ctx.theme.colors.accent, align, maxLines: 1, hug: true, bind: 'pinyin' }))]);
      gaps.push(8);
    }
    const hanzi = read.str(c, 'hanzi') || ' ';
    parts.push([text(ctx, { id: 'hanzi', text: hanzi, x: M.x, y: 0, w: colW, h: 360, role: 'display', max: hanzi.length > 2 ? 220 : 300, min: 110, lh: 1.1, align, maxLines: 1, hug: true, bind: 'hanzi' })]);
    gaps.push(20);

    const meaning = read.str(c, 'meaning');
    if (meaning) {
      parts.push([text(ctx, { id: 'meaning', text: meaning, x: M.x, y: 0, w: colW, h: 120, max: 44, min: 30, color: ctx.theme.colors.muted, align, maxLines: 2, hug: true, bind: 'meaning' })]);
      gaps.push(40);
    }

    const words = read.list(c, 'words').slice(0, 4);
    if (words.length) {
      const size = sz(ctx, 46);
      const font = cssFont(fam(ctx, 'body'), size, 600);
      const padX = size * 0.7;
      const chipH = Math.round(size * 1.8);
      const widths = words.map((w) => Math.min(colW, ctx.measure(w, font) + padX * 2));
      const total = widths.reduce((a, b) => a + b, 0) + 24 * (words.length - 1);
      let x = align === 'center' ? M.x + Math.max(0, (colW - total) / 2) : M.x;
      const row: Box[] = [];
      words.forEach((w, i) => {
        row.push(shape({ id: `word-bg-${i}`, shape: 'rect', x, y: 0, w: widths[i], h: chipH, fill: ctx.theme.colors.surface, stroke: ctx.theme.colors.line, strokeWidth: 2, radius: chipH / 2 }));
        row.push({
          type: 'text', id: `word-${i}`, x, y: 0, w: widths[i], h: chipH, text: w, bind: `words.${i}`,
          style: { font: 'body', size, weight: 600, color: ctx.theme.colors.ink, align: 'center', valign: 'middle', lineHeight: 1.2 },
        });
        x += widths[i] + 24;
      });
      parts.push(row);
      gaps.push(40);
    }

    const example = read.str(c, 'example');
    if (example) {
      const pad = 36;
      const exW = src ? colW : Math.min(colW, 1240);
      const exX = M.x + (colW - exW) / 2;
      const inner: Box[] = [];
      const exPinyin = toneMarks(read.str(c, 'examplePinyin'));
      if (exPinyin) inner.push(pinyinBox(ctx, text(ctx, { id: 'example-pinyin', text: exPinyin, x: exX + pad + 14, y: 0, w: exW - pad * 2 - 14, h: 90, max: 32, min: 22, color: ctx.theme.colors.muted, maxLines: 2, hug: true, bind: 'examplePinyin' })));
      inner.push(text(ctx, { id: 'example', text: example, x: exX + pad + 14, y: 0, w: exW - pad * 2 - 14, h: 150, max: 50, min: 32, weight: fontWeight(ctx.theme, 'body'), maxLines: 2, hug: true, bind: 'example' }));
      const innerH = stack(inner, 0, [6]);
      const h = innerH + pad * 2;
      const bg = card(ctx, 'example-card', exX, 0, exW, h, { stroke: undefined, strokeWidth: 0 });
      const bar = shape({ id: 'example-bar', shape: 'rect', x: exX, y: 0, w: 12, h, fill: ctx.theme.colors.accent, radius: 0 });
      shiftBy(inner, pad);
      parts.push([bg, bar, ...inner]);
      gaps.push(0);
    }

    // Lay the groups out top to bottom, centred on the slide.
    const heights = parts.map((group) => Math.max(...group.map((b) => b.y + b.h)) - Math.min(...group.map((b) => b.y)));
    const blockH = heights.reduce((a, b) => a + b, 0) + gaps.slice(0, parts.length - 1).reduce((a, b) => a + b, 0);
    let y = Math.max(M.top, (CANVAS_H - blockH) / 2);
    const boxes: Box[] = [];
    parts.forEach((group, i) => {
      const top = Math.min(...group.map((b) => b.y));
      shiftBy(group, y - top);
      boxes.push(...group);
      y += heights[i] + (gaps[i] ?? 0);
    });
    if (blockH > M.bottom - M.top) ctx.warnings.push('This card holds a lot. Move the example to its own slide, or drop a word.');
    if (src) {
      const x = M.x + colW + 80;
      boxes.push({ type: 'image', id: 'image', src, x, y: M.top, w: M.right - x, h: M.bottom - M.top, fit: 'cover', radius: ctx.theme.radius, bind: 'image' });
    }
    return { boxes };
  },
};

// ─── Sentences with a pinyin line ───────────────────────────────────────

export const sentence: SlideKindDefinition<C> = {
  kind: 'chinese.sentence',
  label: 'Sentences',
  description: 'Up to four sentences to read aloud, each with its pinyin. A meaning can appear on click.',
  icon: 'message-square-text',
  group: 'Explain',
  fields: [
    { key: 'title', label: 'Title', type: 'text', placeholder: '读一读' },
    {
      key: 'lines', label: 'Sentences', type: 'objects', itemLabel: 'Sentence', min: 1, max: 4,
      fields: [
        { key: 'text', label: 'Sentence', type: 'text' },
        { key: 'pinyin', label: 'Pinyin', type: 'text', help: PINYIN_HELP },
      ],
    },
    { key: 'oneByOne', label: 'Show one at a time', type: 'toggle' },
    { key: 'meaning', label: 'Shown on click', type: 'textarea', rows: 2, help: 'Optional: a meaning, a picture prompt or a question.' },
  ],
  create: () => ({
    title: '读一读',
    lines: [{ text: '你叫什么名字？', pinyin: 'Nǐ jiào shénme míngzi?' }, { text: '我叫小明。', pinyin: 'Wǒ jiào Xiǎo Míng.' }],
    oneByOne: false,
    meaning: '',
  }),
  heading: (c) => read.str(c, 'title') || String(read.objects(c, 'lines')[0]?.text ?? '') || 'Sentences',
  text: (c) => [read.str(c, 'title'), ...read.objects(c, 'lines').flatMap((l) => [String(l.text ?? ''), toneMarks(String(l.pinyin ?? ''))]), read.str(c, 'meaning')].filter(Boolean),
  layout(c, ctx) {
    const lines = read.objects(c, 'lines').filter((l) => String(l.text ?? '').trim()).slice(0, 4);
    const boxes: Box[] = [];
    let top = M.top;
    const titleText = read.str(c, 'title');
    if (titleText) {
      const t = slideTitle(ctx, titleText);
      boxes.push(t.box);
      top = t.bottom;
    }
    const reveal = read.bool(c, 'oneByOne');
    const meaning = read.str(c, 'meaning');
    const per = lines.length > 2 ? { py: 34, hz: 70, gap: 44 } : { py: 42, hz: 92, gap: 64 };
    const blocks: Box[][] = lines.map((l, i) => {
      const step = reveal ? i + 1 : undefined;
      const group: Box[] = [];
      const py = toneMarks(String(l.pinyin ?? ''));
      if (py) group.push(pinyinBox(ctx, text(ctx, { id: `py-${i}`, text: py, x: M.x, y: 0, w: M.w, h: per.py * 3, max: per.py, min: 22, color: ctx.theme.colors.accent, weight: 600, align: 'center', maxLines: 2, hug: true, step, bind: `lines.${i}.pinyin` })));
      group.push(text(ctx, { id: `hz-${i}`, text: String(l.text), x: M.x, y: 0, w: M.w, h: per.hz * 2.6, max: per.hz, min: 44, weight: 600, align: 'center', maxLines: 2, lh: 1.25, hug: true, step, bind: `lines.${i}.text` }));
      stack(group, 0, [10]);
      return group;
    });
    const meaningBox = meaning
      ? text(ctx, { id: 'meaning', text: meaning, x: M.x + 120, y: 0, w: M.w - 240, h: 150, max: 40, min: 28, italic: true, color: ctx.theme.colors.muted, align: 'center', maxLines: 3, hug: true, step: (reveal ? lines.length : 0) + 1, bind: 'meaning' })
      : null;
    const heights = blocks.map((g) => g.reduce((m, b) => Math.max(m, b.y + b.h), 0));
    const total = heights.reduce((a, b) => a + b, 0) + per.gap * Math.max(0, blocks.length - 1) + (meaningBox ? 56 + meaningBox.h : 0);
    let y = top + Math.max(0, (M.bottom - top - total) / 2);
    blocks.forEach((g, i) => { shiftBy(g, y); boxes.push(...g); y += heights[i] + per.gap; });
    if (meaningBox) {
      meaningBox.y = y - per.gap + 56;
      boxes.push(meaningBox);
    }
    if (total > M.bottom - top) ctx.warnings.push('These sentences don’t all fit. Split them over two slides.');
    return { boxes };
  },
};

export const chineseKinds = [characters, word, sentence];
