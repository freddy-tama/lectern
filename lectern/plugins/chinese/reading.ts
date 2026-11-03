// 课文 slides: a passage read 段 by 段 with pinyin over each character and questions beside it, and a
// 选一选，填一填 cloze of a 段 that never blanks a name. Students see the text, the questions and the
// words; how the class reads it lives in the key notes.

import type { Box, ImageBox, TextBox } from '../../src/core/engine/boxes';
import { cssFont } from '../../src/core/engine/measure';
import { fontWeight } from '../../src/core/engine/themes';
import { DENSITY, M, type LayoutContext, card, fam, imageSrc, read, shape, slideTitle, sz, text } from '../../src/core/kinds/kit';
import type { SlideKindDefinition } from '../../src/core/kinds/types';
import { PINYIN_HELP, pinyinBox } from './kinds';
import { toneMarks } from './pinyin';
import { type RubyCell, evenLines, nameSpans, placeBlanks, plainCells, rubyCells, rubyTracking } from './ruby';

type C = Record<string, unknown>;

/** 首行缩进两格: two ideographic spaces before the first line of a 段, as a teacher types it in PowerPoint. */
const INDENT = '　　';
/** Reading sizes in canvas px, before the audience scale: the largest, one that reads well from the back, and the floor. */
const READ_MAX = 64;
const READ_GOOD = 52;
const READ_FLOOR = 40;
/** Picture widths beside the text, widest first. Narrower than the last, the picture is left out. */
const PIC_WIDTHS = [800, 720, 640, 560, 480, 400, 320];
/** The smallest picture kept over the text when the questions sit beside it (px tall). */
const PIC_MIN = 260;
const READ_GAP = 64;
/** Kinds meant to be read carry more words than a talk slide: the book's text can't be trimmed. */
const READING_BUDGET = 4;

const pySize = (s: number) => Math.max(16, Math.round(s * 0.5));
/** Row heights of one line: its pinyin (0 without) and its characters. */
const rows = (s: number, ruby: boolean) => ({ py: ruby ? Math.round(pySize(s) * 1.3) : 0, han: Math.round(s * (ruby ? 1.42 : 1.6)) });

function sizes(from: number, floor: number) {
  const out: number[] = [];
  for (let s = from; s > floor; s -= 2) out.push(s);
  return [...out, floor];
}

function faces(ctx: LayoutContext, s: number) {
  const weight = fontWeight(ctx.theme, 'body');
  const han = cssFont(fam(ctx, 'body'), s, weight);
  const py = cssFont(fam(ctx, 'body'), pySize(s), weight);
  return { weight, adv: (ch: string) => ctx.measure(ch, han), pyW: (value: string) => ctx.measure(value, py) };
}

// ─── Paragraphs with pinyin over each character ─────────────────────────

interface Para {
  /** Index in the stored list, for binds. */
  i: number;
  cells: RubyCell[];
  ruby: boolean;
}

/** A 段's cells: its indent, then its characters with their syllables when the pinyin lines up. */
function paragraph(i: number, value: string, pinyin: string, indent: boolean, ctx: LayoutContext, warn: string): Para {
  const body = value.replace(/\s*\n\s*/gu, '').replace(/^[\s　]+|\s+$/gu, '');
  const py = toneMarks(pinyin.trim());
  const paired = py ? rubyCells(body, py) : null;
  if (py && !paired) ctx.warnings.push(warn);
  return { i, cells: [...(indent ? plainCells(INDENT) : []), ...(paired ?? plainCells(body))], ruby: Boolean(paired) };
}

interface Laid {
  s: number;
  tracking: number;
  lines: { cells: RubyCell[]; y: number; ruby: boolean; para: number }[];
  h: number;
}

/** The paragraphs at size s in a column w wide, laid out from y = 0. */
function layParagraphs(ctx: LayoutContext, paras: Para[], w: number, s: number): Laid {
  const f = faces(ctx, s);
  const ruby = paras.filter((p) => p.ruby).flatMap((p) => p.cells);
  const tracking = ruby.length ? rubyTracking(ruby, s, f.adv, f.pyW) : 0;
  const lines: Laid['lines'] = [];
  let y = 0;
  paras.forEach((p, k) => {
    if (k) y += Math.round(s * 0.5);
    const r = rows(s, p.ruby);
    for (const cells of evenLines(p.cells, { width: w * 0.97, advance: f.adv, tracking })) {
      lines.push({ cells, y, ruby: p.ruby, para: p.i });
      y += r.py + r.han;
    }
  });
  return { s, tracking, lines, h: y };
}

/** The largest size at which the paragraphs fit `room`; the floor when none does. */
function fitParagraphs(ctx: LayoutContext, paras: Para[], w: number, room: number, from: number, floor: number) {
  let laid: Laid | null = null;
  for (const s of sizes(from, floor)) {
    laid = layParagraphs(ctx, paras, w, s);
    if (laid.h <= room) return { laid, fits: true };
  }
  return { laid: laid!, fits: false };
}

interface Slot { blank: number; x: number; w: number; y: number; h: number }

/**
 * Boxes for laid-out paragraphs at (x, y0): each line of characters is one text box (letter-spaced so a
 * syllable has room), each syllable a small box centred over its character. Returns the places of any
 * cloze blanks too.
 */
function drawParagraphs(ctx: LayoutContext, laid: Laid, x: number, y0: number, w: number, bindOf: (para: number) => { text: string; pinyin: string }) {
  const c = ctx.theme.colors;
  const { s, tracking } = laid;
  const f = faces(ctx, s);
  const pys = pySize(s);
  const boxes: Box[] = [];
  const slots: Slot[] = [];
  laid.lines.forEach((line, k) => {
    const r = rows(s, line.ruby);
    const top = y0 + line.y;
    const bind = bindOf(line.para);
    boxes.push({
      type: 'text', id: `p${line.para}-l${k}`, x, y: top + r.py, w, h: r.han, text: line.cells.map((cell) => cell.ch).join(''), bind: bind.text,
      style: { font: 'body', size: s, weight: f.weight, color: c.ink, align: 'left', valign: 'top', lineHeight: r.han / s, tracking: tracking / s },
    });
    let cx = x;
    line.cells.forEach((cell, j) => {
      const a = f.adv(cell.ch);
      if (cell.blank !== undefined) {
        const slot = slots.find((item) => item.blank === cell.blank && item.y === top + r.py);
        if (slot) slot.w += a + tracking;
        else slots.push({ blank: cell.blank, x: cx, w: a + tracking, y: top + r.py, h: r.han });
      }
      if (line.ruby && cell.py) {
        const bw = Math.ceil(Math.max(f.pyW(cell.py) * 1.15 + 8, a + tracking));
        boxes.push(pinyinBox(ctx, {
          type: 'text', id: `p${line.para}-l${k}-py${j}`, x: cx + a / 2 - bw / 2, y: top, w: bw, h: r.py, text: cell.py, bind: bind.pinyin,
          style: { font: 'body', size: pys, weight: f.weight, color: c.muted, align: 'center', valign: 'top', lineHeight: r.py / pys },
        }));
      }
      cx += a + tracking;
    });
  });
  return { boxes, slots };
}

function moveDown(boxes: Box[], dy: number): Box[] {
  return boxes.map((b) => ({ ...b, y: b.y + dy }));
}

// ─── Questions ──────────────────────────────────────────────────────────

interface Question { q: string; a: string; i: number }
interface QuestionList { boxes: Box[]; h: number }

const QL = { pad: 28, d: 52, after: 18, gap: 24, size: 40 };
/** How much wider the list is than its question text: padding, the number and the gap after it. */
const listChrome = (ctx: LayoutContext) => sz(ctx, QL.pad) * 2 + sz(ctx, QL.d) + sz(ctx, QL.after);

/**
 * The questions as one card laid out at y = 0: a numbered row per question, its answer under it (or beside
 * it in a column, when that is shorter), answer k on click k, dashed lines between the rows.
 */
function questionList(ctx: LayoutContext, questions: Question[], x: number, w: number): QuestionList {
  const c = ctx.theme.colors;
  const pad = sz(ctx, QL.pad);
  const d = sz(ctx, QL.d);
  const gap = sz(ctx, QL.gap);
  const s = sz(ctx, QL.size);
  const qx = x + pad + d + sz(ctx, QL.after);
  const inner = x + w - pad - qx;
  const steps = new Map<number, number>();
  questions.forEach((item) => { if (item.a) steps.set(item.i, steps.size + 1); });
  const line = (id: string, value: string, lx: number, lw: number, o: { weight?: number; color?: string; bind: string; step?: number }) => text(ctx, {
    id, text: value, x: lx, y: 0, w: lw, h: s * 1.3 * 8, max: s, min: s, scaled: false, hug: true, lh: 1.3, weight: o.weight, color: o.color, bind: o.bind,
    ...(o.step ? { step: o.step, reveal: 'answer' as const } : {}),
  });
  const answer = (item: Question, ax: number, aw: number, y: number) => (item.a
    ? [{ ...line(`a-${item.i}`, item.a, ax, aw, { color: c.good, bind: `questions.${item.i}.a`, step: steps.get(item.i) }), y }]
    : []);
  const stacked = questions.map((item) => {
    const q = line(`q-${item.i}`, item.q, qx, inner, { weight: 650, bind: `questions.${item.i}.q` });
    const a = answer(item, qx, inner, q.h);
    return { boxes: [q, ...a], h: q.h + (a[0]?.h ?? 0) };
  });
  const qw = Math.ceil(Math.max(...questions.map((item) => ctx.measure(item.q, cssFont(fam(ctx, 'body'), s, 650))))) + 4;
  const ax = qx + qw + sz(ctx, 32);
  const aw = x + w - pad - ax;
  const beside = qw <= inner * 0.6 && aw >= s * 4 ? questions.map((item) => {
    const q = line(`q-${item.i}`, item.q, qx, qw / 0.97 + 2, { weight: 650, bind: `questions.${item.i}.q` });
    const a = answer(item, ax, aw, 0);
    return { boxes: [q, ...a], h: Math.max(q.h, a[0]?.h ?? 0) };
  }) : null;
  const height = (list: { h: number }[]) => list.reduce((sum, row) => sum + row.h, 0) + gap * (list.length - 1) + pad * 2;
  const chosen = beside && height(beside) < height(stacked) ? beside : stacked;
  const h = height(chosen);
  const boxes: Box[] = [card(ctx, 'q-card', x, 0, w, h)];
  let y = pad;
  chosen.forEach((row, k) => {
    const item = questions[k];
    const discY = y + (s * 1.3 - d) / 2;
    boxes.push(shape({ id: `q-${item.i}-no`, shape: 'ellipse', x: x + pad, y: discY, w: d, h: d, fill: c.accent }));
    boxes.push({
      type: 'text', id: `q-${item.i}-n`, x: x + pad, y: discY, w: d, h: d, text: String(k + 1),
      style: { font: 'body', size: Math.round(d * 0.55), weight: 700, color: c.onAccent, align: 'center', valign: 'middle', lineHeight: 1 },
    });
    boxes.push(...moveDown(row.boxes, y));
    if (k < chosen.length - 1) boxes.push(shape({ id: `q-${item.i}-rule`, shape: 'line', x: qx, y: y + row.h + gap / 2, w: inner, h: 0, stroke: c.line, strokeWidth: 3, dash: true }));
    y += row.h + gap;
  });
  return { boxes, h };
}

// ─── The reading slide ──────────────────────────────────────────────────

interface Plan {
  arrange: 'under' | 'beside';
  picW: number;
  textX: number;
  textW: number;
  list: QuestionList | null;
  listX: number;
  gap: number;
  room: number;
}

/**
 * Where the text, the picture and the questions go. In order: the questions under the text with the picture
 * beside them (the picture narrowing first); the questions beside the text with the picture over it; the
 * questions under the text, no picture; the questions beside it, no picture. The first at which the text
 * reads at a good size wins, else the first at which it fits at the floor, else the one that runs over least.
 */
function readingPlan(ctx: LayoutContext, paras: Para[], questions: Question[], hasPic: boolean, top: number, variant: string) {
  const body = M.bottom - top;
  const gap = sz(ctx, 32);
  const under = (picW: number): Plan => {
    const textX = picW ? M.x + picW + READ_GAP : M.x;
    const textW = M.right - textX;
    const list = questions.length ? questionList(ctx, questions, textX, textW) : null;
    return { arrange: 'under', picW, textX, textW, list, listX: textX, gap, room: body - (list ? list.h + gap : 0) };
  };
  // Beside: the list from as wide as its longest question on one line (at least 42 % of the slide) up to
  // 60 %, narrowest first, so the text gets the most room.
  const qSize = sz(ctx, QL.size);
  const need = Math.ceil(Math.max(0, ...questions.map((item) => ctx.measure(item.q, cssFont(fam(ctx, 'body'), qSize, 650))))) + listChrome(ctx) + 4;
  const lo = Math.round(Math.min(M.w * 0.6, Math.max(M.w * 0.42, need)));
  const listWs = [...new Set([...Array.from({ length: Math.ceil((M.w * 0.6 - lo) / 60) }, (_, i) => lo + i * 60), Math.round(M.w * 0.6)])];
  const beside = (pic: boolean, listW: number): Plan => {
    const textW = M.w - listW - READ_GAP;
    const list = questionList(ctx, questions, M.right - listW, listW);
    return { arrange: 'beside', picW: pic ? textW : 0, textX: M.x, textW, list, listX: M.right - listW, gap, room: list.h <= body ? body - (pic ? PIC_MIN + gap : 0) : -1 };
  };
  const unders = variant !== 'beside' || !questions.length;
  const besides = variant !== 'under' && questions.length > 0;
  const withPic = hasPic ? [...(unders ? PIC_WIDTHS.map(under) : []), ...(besides ? listWs.map((w) => beside(true, w)) : [])] : [];
  const bare = [...(unders ? [under(0)] : []), ...(besides ? listWs.map((w) => beside(false, w)) : [])];
  const textH = (o: Plan, s: number) => layParagraphs(ctx, paras, o.textW, s).h;
  const good = (o: Plan) => o.room > 0 && textH(o, sz(ctx, READ_GOOD)) <= o.room;
  const fits = (o: Plan) => o.room > 0 && textH(o, sz(ctx, READ_FLOOR)) <= o.room;
  const found = withPic.find(good) ?? withPic.find(fits) ?? bare.find(good) ?? bare.find(fits);
  const over = (o: Plan) => (o.arrange === 'under' ? (o.list ? o.list.h + o.gap : 0) + textH(o, sz(ctx, READ_FLOOR)) : Math.max(o.list!.h, textH(o, sz(ctx, READ_FLOOR)))) - body;
  const plan = found ?? bare.reduce((a, b) => (over(b) < over(a) ? b : a));
  return { plan, fit: Boolean(found), dropped: hasPic && !plan.picW };
}

function picture(ctx: LayoutContext, src: string, x: number, y: number, w: number, h: number): ImageBox {
  return { type: 'image', id: 'image', src, x, y, w, h, fit: 'cover', radius: ctx.theme.radius, bind: 'image' };
}

const paragraphsOf = (c: C) => read.objects(c, 'paragraphs').map((p, i) => ({ i, text: String(p.text ?? ''), pinyin: String(p.pinyin ?? '') }));
const questionsOf = (c: C): Question[] => read.objects(c, 'questions')
  .map((item, i) => ({ i, q: String(item.q ?? '').trim(), a: String(item.a ?? '').trim() })).filter((item) => item.q).slice(0, 4);

export const reading: SlideKindDefinition<C> = {
  kind: 'chinese.reading',
  label: 'Reading',
  description: 'A passage of the text as the book prints it: each paragraph indented, pinyin over each character, and up to four questions whose answers appear one click at a time.',
  icon: 'book-open-text',
  group: 'Explain',
  variants: [{ id: 'fit', label: 'Best fit' }, { id: 'under', label: 'Questions under the text' }, { id: 'beside', label: 'Questions beside the text' }],
  autoVariant: () => 'fit',
  fields: [
    { key: 'title', label: 'Title', type: 'text', placeholder: '读一读，想一想' },
    {
      key: 'paragraphs', label: 'Paragraphs', type: 'objects', itemLabel: 'Paragraph', min: 1, max: 4,
      fields: [
        { key: 'text', label: 'Text', type: 'textarea', rows: 3, help: 'One paragraph, as the book prints it. Its first line is indented two characters.' },
        { key: 'pinyin', label: 'Pinyin', type: 'textarea', rows: 3, help: `Optional. Shown over each character when it matches the text syllable for syllable. ${PINYIN_HELP}` },
      ],
    },
    {
      key: 'questions', label: 'Questions', type: 'objects', itemLabel: 'Question', max: 4,
      fields: [
        { key: 'q', label: 'Question', type: 'text' },
        { key: 'a', label: 'Answer', type: 'text', help: 'Appears on its own click.' },
      ],
    },
    { key: 'image', label: 'Picture', type: 'image', help: 'Optional: the scene. It shrinks to make room for the text and is left out when the text needs the whole slide.' },
    { key: 'continues', label: 'Starts mid-paragraph', type: 'toggle', more: true, help: 'The first paragraph goes on from the slide before, so its first line isn’t indented.' },
  ],
  create: () => ({
    title: '读一读，想一想',
    paragraphs: [
      {
        text: '小明和妈妈去英国看奶奶。奶奶住在伦敦，她的家旁边有一个美丽的公园。',
        pinyin: 'Xiǎo Míng hé māma qù Yīngguó kàn nǎinai. Nǎinai zhù zài Lúndūn, tā de jiā pángbiān yǒu yí gè měilì de gōngyuán.',
      },
      {
        text: '每天早上，小明和奶奶去公园散步。他们看小鸟，也看花。',
        pinyin: 'Měi tiān zǎoshang, Xiǎo Míng hé nǎinai qù gōngyuán sànbù. Tāmen kàn xiǎo niǎo, yě kàn huā.',
      },
    ],
    questions: [
      { q: '小明去哪儿看奶奶？', a: '去英国伦敦。' },
      { q: '每天早上，他们做什么？', a: '去公园散步，看小鸟，看花。' },
    ],
    image: '',
    continues: false,
  }),
  heading: (c) => read.str(c, 'title') || paragraphsOf(c).map((p) => p.text.trim()).find(Boolean)?.slice(0, 16) || 'Reading',
  // Pinyin is left out: it would double the word count of a text the teacher can't shorten.
  text: (c) => [read.str(c, 'title'), ...paragraphsOf(c).map((p) => p.text), ...questionsOf(c).flatMap((item) => [item.q, item.a])].filter((s) => s.trim()),
  layout(c, ctx, variant) {
    const boxes: Box[] = [];
    const budget = DENSITY[ctx.audience].words * READING_BUDGET;
    let top = M.top;
    const titleText = read.str(c, 'title');
    if (titleText) {
      const t = slideTitle(ctx, titleText);
      boxes.push(t.box);
      top = t.bottom;
    }
    const stored = paragraphsOf(c);
    const paras = stored.filter((p) => p.text.trim()).map((p, k) => paragraph(p.i, p.text, p.pinyin, !(k === 0 && read.bool(c, 'continues')), ctx,
      `The pinyin of paragraph ${p.i + 1} doesn’t match its characters, so it shows without pinyin. Check for a missing or extra syllable.`));
    if (!paras.length) return { boxes, budget };
    const questions = questionsOf(c);
    const src = imageSrc(ctx, c.image);
    const { plan, fit, dropped } = readingPlan(ctx, paras, questions, Boolean(src), top, variant ?? 'fit');
    if (!fit) ctx.warnings.push('This passage doesn’t fit on one slide. Split it over two slides, or shorten the answers.');
    else if (dropped) ctx.warnings.push('The text needs the whole slide, so the picture is left out. Split the passage to keep it.');
    const body = M.bottom - top;
    const floor = sz(ctx, READ_FLOOR);
    const bindOf = (i: number) => ({ text: `paragraphs.${i}.text`, pinyin: `paragraphs.${i}.pinyin` });
    if (plan.arrange === 'under') {
      // Every slide reads at the largest size that fits it.
      const { laid } = fitParagraphs(ctx, paras, plan.textW, plan.room, sz(ctx, READ_MAX), floor);
      const groupH = laid.h + (plan.list ? plan.gap + plan.list.h : 0);
      const y0 = top + Math.max(0, (body - groupH) / 2);
      boxes.push(...drawParagraphs(ctx, laid, plan.textX, y0, plan.textW, bindOf).boxes);
      if (plan.list) boxes.push(...moveDown(plan.list.boxes, y0 + laid.h + plan.gap));
      if (plan.picW) {
        // 4:3, a narrow one square.
        const picH = Math.min(Math.round(plan.picW * (plan.picW <= 460 ? 1 : 0.75)), body);
        boxes.push(picture(ctx, src, M.x, top + (body - picH) / 2, plan.picW, picH));
      }
      return { boxes, budget };
    }
    // Questions beside the text. With a picture, the text reads at a good size and the picture takes the rest of the column.
    const { laid } = fitParagraphs(ctx, paras, plan.textW, plan.room, sz(ctx, plan.picW ? READ_GOOD : READ_MAX), floor);
    let picH = 0;
    let picW = 0;
    if (plan.picW) {
      picH = Math.min(body - laid.h - plan.gap, Math.round(plan.textW * 0.75));
      if (picH < PIC_MIN / 2) picH = 0;
      picW = Math.min(plan.textW, Math.round((picH * 4) / 3));
    }
    const groupH = laid.h + (picH ? picH + plan.gap : 0);
    const y0 = top + Math.max(0, (body - groupH) / 2);
    if (picH) boxes.push(picture(ctx, src, plan.textX + (plan.textW - picW) / 2, y0, picW, picH));
    boxes.push(...drawParagraphs(ctx, laid, plan.textX, y0 + (picH ? picH + plan.gap : 0), plan.textW, bindOf).boxes);
    boxes.push(...moveDown(plan.list!.boxes, top + Math.max(0, (body - plan.list!.h) / 2)));
    return { boxes, budget };
  },
};

// ─── 选一选，填一填: a 段 with blanks and a word bank ────────────────────

/** A word bank order of its own, the same every time: sorted by a hash of each word. */
function bankOrder(words: string[]): number[] {
  const hash = (value: string) => [...value].reduce((h, ch) => Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0, 2166136261);
  const order = words.map((_, i) => i).sort((a, b) => hash(words[a]) - hash(words[b]) || a - b);
  // Never the reading order: that would give the answers away.
  return words.length > 1 && order.every((v, i) => v === i) ? [...order.slice(1), order[0]] : order;
}

/** A blank is as wide as its word and one character more, at least two. */
const slotLength = (word: string) => Math.max(2, Array.from(word).length + 1);

export const cloze: SlideKindDefinition<C> = {
  kind: 'chinese.cloze',
  label: 'Fill the blanks',
  description: 'A paragraph of the text with words taken out and a word bank above it. Each answer appears in its blank on its own click. Names are never blanked.',
  icon: 'text-cursor-input',
  group: 'Engage',
  fields: [
    { key: 'title', label: 'Title', type: 'text', placeholder: '选一选，填一填' },
    { key: 'text', label: 'Paragraph', type: 'textarea', rows: 4, help: 'One paragraph of the text, as the book prints it.' },
    { key: 'pinyin', label: 'Pinyin', type: 'textarea', rows: 3, help: `Optional. Names in it, such as Yīngguó, are never blanked. ${PINYIN_HELP}` },
    { key: 'words', label: 'Words to blank', type: 'list', itemLabel: 'Word', max: 6, placeholder: '美丽', help: 'Two to four words from the paragraph. Each is blanked where it first appears.' },
    { key: 'showPinyin', label: 'Show pinyin', type: 'toggle', help: 'Over the text and the word bank. Blanks never show theirs.' },
    { key: 'continues', label: 'Starts mid-paragraph', type: 'toggle', more: true, help: 'The text goes on from the slide before, so its first line isn’t indented.' },
  ],
  create: () => ({
    title: '选一选，填一填',
    text: '小明和妈妈去英国看奶奶。奶奶住在伦敦，她的家旁边有一个美丽的公园。',
    pinyin: 'Xiǎo Míng hé māma qù Yīngguó kàn nǎinai. Nǎinai zhù zài Lúndūn, tā de jiā pángbiān yǒu yí gè měilì de gōngyuán.',
    words: ['看', '旁边', '美丽'],
    showPinyin: true,
    continues: false,
  }),
  heading: (c) => read.str(c, 'title') || 'Fill the blanks',
  text: (c) => [read.str(c, 'title'), read.str(c, 'text'), ...read.list(c, 'words')].filter((s) => s.trim()),
  layout(c, ctx) {
    const colors = ctx.theme.colors;
    const boxes: Box[] = [];
    const budget = DENSITY[ctx.audience].words * READING_BUDGET;
    let top = M.top;
    const titleText = read.str(c, 'title');
    if (titleText) {
      const t = slideTitle(ctx, titleText);
      boxes.push(t.box);
      top = t.bottom;
    }
    const body = read.str(c, 'text').replace(/\s*\n\s*/gu, '').replace(/^[\s　]+|\s+$/gu, '');
    if (!body) return { boxes, budget };
    const pinyin = toneMarks(read.str(c, 'pinyin').trim());
    const paired = pinyin ? rubyCells(body, pinyin) : null;
    if (pinyin && !paired) ctx.warnings.push('The pinyin doesn’t match the text, so it isn’t shown and names in it can’t be found. Check for a missing or extra syllable.');
    const ruby = Boolean(paired) && read.bool(c, 'showPinyin', true);
    const stored = read.items(c, 'words');
    const { blanks, skipped } = placeBlanks(body, stored, paired ? nameSpans(body, pinyin) : []);
    for (const s of skipped) {
      ctx.warnings.push(s.why === 'name' ? `“${s.word}” is a name, so it stays in the text. Blank another word.`
        : s.why === 'missing' ? `“${s.word}” isn’t in the paragraph. Check the word, or blank another one.`
          : `“${s.word}” sits right next to another blank. Blank another word.`);
    }
    // The 段's cells with each blank's characters swapped for a run of ideographic spaces.
    const source = paired ?? plainCells(body);
    const cells: RubyCell[] = read.bool(c, 'continues') ? [] : plainCells(INDENT);
    for (let i = 0; i < source.length;) {
      const k = blanks.findIndex((b) => b.start === i);
      if (k < 0) { cells.push(ruby ? source[i] : { ch: source[i].ch, py: '' }); i += 1; continue; }
      for (let n = 0; n < slotLength(blanks[k].word); n += 1) cells.push({ ch: '　', py: '', blank: k });
      i = blanks[k].end;
    }
    const para: Para = { i: 0, cells, ruby };
    const wordIndex = (word: string) => stored.findIndex((w) => w.trim() === word);
    const pyOf = (k: number) => (paired ? paired.slice(blanks[k].start, blanks[k].end).map((cell) => cell.py).join('') : '');

    // The word bank: a row of pills (two when they don't fit one), each word with its pinyin over it.
    const ws = sz(ctx, 44);
    const wf = faces(ctx, ws);
    const wr = rows(ws, ruby);
    const padX = Math.round(ws * 0.7);
    const padY = Math.round(ws * 0.25);
    const pillH = padY * 2 + wr.py + Math.round(ws * 1.3);
    const gapX = sz(ctx, 28);
    const gapY = sz(ctx, 20);
    const pills = bankOrder(blanks.map((b) => b.word)).map((k) => {
      const word = blanks[k].word;
      const py = pyOf(k);
      return { k, word, py, w: Math.ceil(Math.max(ctx.measure(word, cssFont(fam(ctx, 'body'), ws, 600)), ruby ? wf.pyW(py) : 0)) + padX * 2 };
    });
    const bankRows: (typeof pills)[] = [];
    for (const pill of pills) {
      const row = bankRows.at(-1);
      if (row && row.reduce((sum, p) => sum + p.w + gapX, 0) + pill.w <= M.w) row.push(pill);
      else bankRows.push([pill]);
    }
    const bankH = bankRows.length ? bankRows.length * pillH + (bankRows.length - 1) * gapY + sz(ctx, 40) : 0;

    // The paragraph card, at the largest size that fits under the bank.
    const pad = sz(ctx, 44);
    const innerW = M.w - pad * 2;
    const room = M.bottom - top - bankH - pad * 2;
    const { laid, fits } = fitParagraphs(ctx, [para], innerW, room, sz(ctx, 56), sz(ctx, READ_FLOOR));
    if (!fits) ctx.warnings.push('This paragraph doesn’t fit with its word bank. Use a shorter paragraph, or split it over two slides.');
    const cardH = laid.h + pad * 2;
    const y0 = top + Math.max(0, (M.bottom - top - bankH - cardH) / 2);
    bankRows.forEach((row, r) => {
      const rowW = row.reduce((sum, p) => sum + p.w, 0) + gapX * (row.length - 1);
      let x = M.x + (M.w - rowW) / 2;
      const y = y0 + r * (pillH + gapY);
      for (const p of row) {
        const bind = `words.${wordIndex(p.word)}`;
        boxes.push(shape({ id: `bank-${p.k}-bg`, shape: 'rect', x, y, w: p.w, h: pillH, fill: colors.surface, stroke: colors.line, strokeWidth: 2, radius: pillH / 2 }));
        if (ruby) {
          boxes.push(pinyinBox(ctx, {
            type: 'text', id: `bank-${p.k}-py`, x, y: y + padY, w: p.w, h: wr.py, text: p.py,
            style: { font: 'body', size: pySize(ws), weight: wf.weight, color: colors.muted, align: 'center', valign: 'top', lineHeight: wr.py / pySize(ws) },
          }));
        }
        boxes.push({
          type: 'text', id: `bank-${p.k}`, x, y: y + padY + wr.py, w: p.w, h: Math.round(ws * 1.3), text: p.word, bind,
          style: { font: 'body', size: ws, weight: 600, color: colors.ink, align: 'center', valign: 'top', lineHeight: 1.3 },
        });
        x += p.w + gapX;
      }
    });
    const cardY = y0 + bankH;
    boxes.push(card(ctx, 'text-card', M.x, cardY, M.w, cardH));
    const drawn = drawParagraphs(ctx, laid, M.x + pad, cardY + pad, innerW, () => ({ text: 'text', pinyin: 'pinyin' }));
    boxes.push(...drawn.boxes);
    // Each blank: a line under its spaces, and its word standing on it on click k (reading order).
    const s = laid.s;
    for (const slot of drawn.slots) {
      const word = blanks[slot.blank].word;
      const w = slot.w - laid.tracking;
      const lineY = slot.y + Math.round((slot.h + s) / 2 + s * 0.04);
      boxes.push(shape({ id: `blank-${slot.blank}-line`, shape: 'line', x: slot.x, y: lineY, w, h: 0, stroke: colors.ink, strokeWidth: Math.max(3, Math.round(s * 0.06)) }));
      const answer: TextBox = {
        type: 'text', id: `blank-${slot.blank}`, x: slot.x, y: slot.y, w, h: slot.h, text: word, bind: `words.${wordIndex(word)}`, step: slot.blank + 1, reveal: 'answer',
        style: { font: 'body', size: s, weight: 600, color: colors.good, align: 'center', valign: 'top', lineHeight: slot.h / s },
      };
      boxes.push(answer);
    }
    return { boxes, budget };
  },
};

export const readingKinds = [reading, cloze];
