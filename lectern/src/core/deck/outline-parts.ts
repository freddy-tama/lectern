// Outlines as chat assistants and planning templates write them, slide by slide, with each
// part of a slide under a label (outline.ts sends a block here when it has such parts):
//
//   **演讲者备注：** / **Speaker notes:**  → key notes        **课堂操作：** → cues
//   **角标：程序公正** / **Tag:**          → a tag in the slide's top corner
//   **页面用时间轴呈现：** / **版式建议：** → layout advice: followed, not shown
//   **左栏：…** + a list, **右栏：…** + a list → Compare; three to six such lists → cards
//   A ↓ B ↓ C on their own lines, or A → B → C → steps, in order
//   - A. 应该 / - B. 不应该               → a question; what the slide shows before it, a slide of its own
//   **追问：** / **Follow-up:**            → the question's answer, shown on click
//   > a key line / **底部大字：** …         → the slide's bottom line (a table's caption)
//   two small tables side by side          → cards; tables of the same width → one table
//
// Bold is dropped from what the slide shows. Text with no place on the slide goes to the key
// notes, so nothing pasted is lost.

import { CANVAS_W } from '../engine/boxes';
import type { DeckDraft } from '../plugins/api';
import { type SlideElement, uid } from './types';
import { cjkChars, countWords } from './words';

type DraftSlide = DeckDraft['slides'][number];

export interface OutlineBlock {
  heading: string;
  level: number;
  lines: string[];
  /** The line of the notes the block starts on. */
  start: number;
  /** A numbered slide heading ("第3页｜…", "Slide 3: …") started it. */
  page?: boolean;
  /** Not a slide: the plan's own heading or notes around the slides, when slides are numbered. */
  meta?: boolean;
}

/** Markdown bold and underline, gone: slides show the words, not the stars. */
export function unemphasize(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/\*\*/g, '');
}

// ─── What a label means ───────────────────────────────────────────────

const NOTES = /^(?:notes?|say|script|speaker ?notes?|presenter ?notes?|teacher'?s? notes?|演讲者?备注|讲者备注|讲师备注|教师备注|备注|讲稿|演讲稿|讲解词|讲解|旁白|口播)$/i;
const CUES = /^(?:cues?|stage directions?|课堂操作|课堂互动|互动(?:方式|环节)?|教学提示|教师提示|操作(?:提示|建议|方式)?|教学活动)$/i;
const TAG = /^(?:角标|标签|徽标|tag|badge|corner tag)$/i;
const ANSWER = /^(?:追问|答案|参考答案|解析|答案解析|answer|follow[- ]?up|explanation)$/i;
/** Advice on how the slide should look, which Lectern follows rather than shows. */
const HINT = /版式|布局|排版|layout|^页面(?:用|采用|做成|保留|呈现|设计|以)/i;
/** Where on the slide a part goes: the words show, the label doesn't. */
const PLACE = /^(?:页面)?(?:底部|页底|底栏|下方|顶部|页顶|上方|中心|中央|居中|左下|右下|左上|右上)|(?:背景条|大字|高亮|警示)$/;
const COLUMN = /^(?:左栏|右栏|中栏|左侧|右侧|左边|右边|左列|右列|中列|第[一二三四五六1-6][栏列]|left(?: column| side)?|right(?: column| side)?|middle(?: column)?|column \d)$/i;
const TITLE_L = /^(?:主标题|大标题|标题|title|main title)$/i;
const SUBTITLE_L = /^(?:副标题|小标题|subtitle)$/i;
const PRESENTER_L = /^(?:汇报人|主讲人|主讲|讲者|演讲者|报告人|presenter|speaker)$/i;
const COVER = /^(?:封面|封面页|首页|标题页|题目页|cover(?: slide| page)?|title (?:slide|page))$/i;
/** Parts that end at a blank line, as "Notes:" always has; other parts run to the next label. */
const ENDS_AT_GAP = (label: string) => NOTES.test(label) || CUES.test(label) || TAG.test(label) || ANSWER.test(label);

const NOTES_INLINE = new RegExp(`^(${NOTES.source.slice(4, -2)})\\s*[:：]\\s*(.*)$`, 'i');

// ─── Lines ────────────────────────────────────────────────────────────

const ITEM = /^\s*(?:[-*•▪◦]\s+|(\d+)(?:[.)]\s+|[、．]\s*))(.*)$/;
const CHOICE = /^\s*(?:[-*•]\s+)?[(（]?([A-Fa-f])[).:、．）]\s*(\S.*)$/;
const CHECKBOX = /^\s*-\s*\[( |x|X)\]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const ARROW_LINE = /^\s*(?:[↓⬇⇩▼↘→⟶➔➜⇒]|->)+\s*$/;
const ARROW = /\s*(?:→|⟶|➔|➜|⇒|->)\s*/;
const CHAIN = /\S\s*(?:→|⟶|➔|➜|⇒|->)\s*\S.*?(?:→|⟶|➔|➜|⇒|->)\s*\S/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const ATTRIBUTION = /^\s*[—–]{1,2}\s*\S|^\s*-{2}\s*\S/;
const PLAIN_NOTES = /^\s*(?:notes?|say|script|speaker notes?)\s*:/i;
const LABEL_ALONE = /^([^\s#>|*\-•\d(（[][^:：。！？!?|]{0,39}?)\s*[:：]\s*$/;

type Line =
  | { t: 'item'; text: string; ordered: boolean; more: string[] }
  | { t: 'choice'; letter: string; text: string; item: boolean; checked: boolean }
  | { t: 'quote'; text: string }
  | { t: 'table'; rows: string[] }
  | { t: 'arrow' }
  | { t: 'text'; text: string };

interface Segment {
  label: string;
  /** The label had its words on the same line, as the segment's first line. */
  inline: boolean;
  lines: Line[];
}

function readLabel(line: string, next: string | undefined): { label: string; rest: string } | null {
  const t = line.trim();
  const forms = [
    /^\*\*([^*]{1,40}?)\s*[:：]\s*\*\*\s*(.*)$/, // **Label：** rest
    /^\*\*([^*]{1,40}?)\*\*\s*[:：]\s*(.*)$/, // **Label**：rest
    /^\*\*([^*:：]{1,40}?)\s*[:：]\s*([^*]+?)\*\*\s*$/, // **Label：rest**
  ];
  for (const re of forms) {
    const m = re.exec(t);
    if (m) return { label: m[1].trim(), rest: unemphasize(m[2]).trim() };
  }
  const notes = NOTES_INLINE.exec(t);
  if (notes) return { label: notes[1].trim(), rest: unemphasize(notes[2]).trim() };
  const alone = LABEL_ALONE.exec(t);
  if (alone) return { label: alone[1].trim(), rest: '' };
  // A bold line over a list is that list's heading.
  const bold = /^\*\*([^*]{1,60})\*\*$/.exec(t);
  if (bold && next !== undefined && ITEM.test(next) && !CHOICE.test(next)) return { label: bold[1].trim(), rest: '' };
  return null;
}

function classify(line: string): Line {
  const q = QUOTE.exec(line);
  if (q) return { t: 'quote', text: unemphasize(q[1]).trim() };
  if (TABLE_ROW.test(line) || (line.includes('|') && TABLE_SEP.test(line))) return { t: 'table', rows: [line.trim()] };
  if (ARROW_LINE.test(line)) return { t: 'arrow' };
  const box = CHECKBOX.exec(line);
  if (box) return { t: 'choice', letter: '', text: unemphasize(box[2]).trim(), item: true, checked: /x/i.test(box[1]) };
  const c = CHOICE.exec(line);
  if (c) return { t: 'choice', letter: c[1].toUpperCase(), text: unemphasize(c[2]).trim(), item: /^\s*[-*•]\s/.test(line), checked: false };
  const it = ITEM.exec(line);
  if (it) return { t: 'item', text: unemphasize(it[2]).trim(), ordered: Boolean(it[1]), more: [] };
  return { t: 'text', text: unemphasize(line).trim() };
}

function readSegments(raw: string[]): Segment[] {
  const segments: Segment[] = [{ label: '', inline: false, lines: [] }];
  let seg = segments[0]!;
  let gap = false;
  const nextLine = (i: number) => raw.slice(i + 1).find((l) => l.trim());
  raw.forEach((rawLine, i) => {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) { gap = true; return; }
    const last = seg.lines[seg.lines.length - 1];
    // An indented line under a list item, with no gap, carries on that item.
    if (last?.t === 'item' && !gap && /^\s{2,}\S/.test(line) && !ITEM.test(line) && !QUOTE.test(line) && !TABLE_ROW.test(line)) {
      last.more.push(unemphasize(line).trim());
      return;
    }
    const label = ITEM.test(line) || CHOICE.test(line) ? null : readLabel(line, nextLine(i));
    if (label) {
      seg = { label: label.label, inline: Boolean(label.rest), lines: label.rest ? [{ t: 'text', text: label.rest }] : [] };
      segments.push(seg);
      gap = false;
      return;
    }
    if (gap && seg.lines.length && ENDS_AT_GAP(seg.label)) {
      seg = { label: '', inline: false, lines: [] };
      segments.push(seg);
    }
    const kind = classify(line);
    if (kind.t === 'table' && last?.t === 'table' && !gap) last.rows.push(...kind.rows);
    else seg.lines.push(kind);
    gap = false;
  });
  return segments.filter((s) => s.label || s.lines.length);
}

/** Whether a block has the labelled parts this reader is for, so plain outlines read as they always have. */
export function isRich(lines: string[]): boolean {
  const content = lines.filter((l) => l.trim());
  if (content.some((l) => /\*\*/.test(l) || ARROW_LINE.test(l) || CHAIN.test(l) || LABEL_ALONE.test(l.trim()) || (NOTES_INLINE.test(l.trim()) && !PLAIN_NOTES.test(l)))) return true;
  if (choiceRun(content.filter((l) => /^\s*[-*•]\s/.test(l) && CHOICE.test(l)).map((l) => CHOICE.exec(l)![1]!))) return true;
  const quotes = content.filter((l) => QUOTE.test(l)).length;
  const other = content.filter((l) => !QUOTE.test(l) && !(ATTRIBUTION.test(l) && !ITEM.test(l)) && !PLAIN_NOTES.test(l)).length;
  return quotes > 0 && other > 0;
}

/** Letters that run A, B, C… from A: choices, not two lines that happen to start with a letter. */
function choiceRun(letters: string[]): boolean {
  if (letters.length < 2) return false;
  return letters.every((l, i) => l.toUpperCase() === 'ABCDEF'[i]);
}

// ─── Text helpers ─────────────────────────────────────────────────────

const CJK_EDGE = /[　-〿㐀-鿿＀-￯]/;

/** Lines of one paragraph back together: no space between Chinese or Japanese text. */
function joinText(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).reduce((a, p) => {
    if (!a) return p;
    return CJK_EDGE.test(a.slice(-1)) && CJK_EDGE.test(p[0]!) ? a + p : `${a} ${p}`;
  }, '');
}

function itemText(l: Extract<Line, { t: 'item' }>, sep = ' '): string {
  return l.more.length ? `${l.text}${sep}${joinText(l.more)}` : l.text;
}

function lineText(l: Line): string {
  switch (l.t) {
    case 'item': return itemText(l);
    case 'choice': return l.letter ? `${l.letter}. ${l.text}` : l.text;
    case 'table': return l.rows.filter((r) => !TABLE_SEP.test(r)).map((r) => cells(r).join(' ')).join(' ');
    case 'arrow': return '';
    default: return l.text;
  }
}

function segmentText(s: Segment): string {
  return joinText(s.lines.map(lineText));
}

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

/** A key line for the bottom of the slide: the words, with their label unless it only says where they go. */
function calloutOf(s: Segment): string {
  const words = segmentText(s);
  if (!words) return '';
  return s.label && !PLACE.test(s.label) && !COLUMN.test(s.label) && !HINT.test(s.label) ? `${s.label}：${words}` : words;
}

function labelWords(s: Segment): string {
  return s.inline ? lineText(s.lines[0]!) : '';
}

// ─── Building slides ──────────────────────────────────────────────────

interface Extras {
  notes: string[];
  cues: string[];
  tag: string;
}

interface Built {
  slides: DraftSlide[];
  callouts: string[];
  leftover: string[];
}

type Plain = (block: OutlineBlock, index: number) => DraftSlide[];

/** The parts of a block: what the slide shows, and what goes to the notes, the cues and the corner. */
function sortParts(lines: string[]) {
  const shown: Segment[] = [];
  const extras: Extras = { notes: [], cues: [], tag: '' };
  const answers: string[] = [];
  const tags: string[] = [];
  for (const s of readSegments(lines)) {
    if (NOTES.test(s.label)) extras.notes.push(segmentText(s));
    else if (CUES.test(s.label)) extras.cues.push(...s.lines.map(lineText).filter(Boolean));
    else if (TAG.test(s.label)) tags.push(segmentText(s));
    else if (ANSWER.test(s.label)) answers.push(segmentText(s));
    else if (HINT.test(s.label)) {
      // Advice written beside its label is for whoever makes the slide; what follows a bare label is the slide's.
      const rest = s.inline ? s.lines.slice(1) : s.lines;
      if (rest.length) shown.push({ label: '', inline: false, lines: rest });
    } else shown.push(s);
  }
  extras.tag = tags.filter(Boolean).join(' · ');
  return { shown, extras, answer: answers.filter(Boolean).join(' ') };
}

/** The title slide from a cover page: 主标题 / 副标题 / 角标 and the like, each in its place. */
export function coverSlide(block: OutlineBlock): { slide: DraftSlide; title: string } | null {
  const heading = unemphasize(block.heading).trim();
  const segments = readSegments(block.lines);
  const find = (re: RegExp) => segments.find((s) => re.test(s.label));
  if (!COVER.test(heading) && !(block.page && find(TITLE_L))) return null;
  const words = (s: Segment | undefined) => (s ? segmentText(s) : '');
  const known = [TITLE_L, SUBTITLE_L, PRESENTER_L, TAG, NOTES, CUES, HINT];
  const loose = segments.filter((s) => !s.label).flatMap((s) => s.lines.map(lineText)).filter(Boolean);
  const credits = segments.filter((s) => s.label && !known.some((re) => re.test(s.label)) && segmentText(s)).map((s) => `${s.label}：${segmentText(s)}`);
  const title = words(find(TITLE_L)) || loose.shift() || (COVER.test(heading) ? '' : heading);
  const subtitle = [words(find(SUBTITLE_L)), ...loose].filter(Boolean).join(' · ');
  const script = joinText(segments.filter((s) => NOTES.test(s.label)).map(segmentText));
  return {
    title,
    slide: {
      kind: 'title',
      content: { title, subtitle, eyebrow: segments.filter((s) => TAG.test(s.label)).map(segmentText).join(' · '), presenter: words(find(PRESENTER_L)), credit: credits.join(' · ') },
      notes: script ? { script } : {},
    },
  };
}

/** The steps of a part written as a sequence: lines with arrows between them, or one line of A → B → C. */
function sequenceOf(s: Segment): string[] | null {
  const words = s.lines.filter((l) => l.t !== 'arrow');
  const arrows = s.lines.length - words.length;
  if (arrows && words.length >= 2 && arrows >= words.length - 1 && words.every((l) => l.t === 'text' || l.t === 'quote' || l.t === 'item')) {
    return words.map(lineText).filter(Boolean);
  }
  const chain = s.lines.length === 1 && s.lines[0]!.t === 'text' && CHAIN.test(s.lines[0]!.text) ? s.lines[0]!.text : '';
  return chain ? chain.split(ARROW).map((p) => p.trim()).filter(Boolean) : null;
}

function stepOf(text: string) {
  const m = /^(.{1,40}?)\s*(?:[:：]|\s[—–]\s)\s*(.+)$/.exec(text);
  return m && countWords(m[1]!) <= 6 ? { label: m[1]!.trim(), detail: m[2]!.trim() } : { label: text, detail: '' };
}

interface Table { header: string[]; rows: string[][]; aligned: string }

function tableOf(l: Extract<Line, { t: 'table' }>): Table | null {
  const sep = l.rows.findIndex((r, i) => i > 0 && TABLE_SEP.test(r));
  if (sep < 1) return null;
  return {
    header: cells(l.rows[sep - 1]!),
    rows: l.rows.slice(sep + 1).filter((r) => !TABLE_SEP.test(r)).map(cells),
    aligned: /:/.test(l.rows[sep]!) ? l.rows[sep]! : '',
  };
}

/** One slide from the parts it shows: steps, a table or cards, columns, or a list or text for the plain reader. */
function build(heading: string, shown: Segment[], index: number, plain: Plain): Built {
  const callouts: string[] = [];
  const leftover: string[] = [];
  const title = heading;

  // A sequence: steps, with everything else on the slide as its bottom line.
  const seqAt = shown.findIndex((s) => { const q = sequenceOf(s); return Boolean(q && q.length >= 2 && q.length <= 6); });
  if (seqAt >= 0) {
    shown.forEach((s, i) => { if (i !== seqAt) callouts.push(calloutOf(s)); });
    const steps = sequenceOf(shown[seqAt]!)!.map(stepOf);
    return { slides: [{ kind: 'steps', content: { title: title || 'Steps', steps, reveal: true }, notes: {} }], callouts, leftover };
  }

  // Tables.
  const tableLines = shown.flatMap((s) => s.lines.filter((l): l is Extract<Line, { t: 'table' }> => l.t === 'table'));
  const tables = tableLines.map(tableOf).filter((t): t is Table => Boolean(t));
  if (tables.length) {
    for (const s of shown) {
      const rest: Segment = { ...s, lines: s.lines.filter((l) => l.t !== 'table') };
      if (rest.lines.length) callouts.push(calloutOf(rest));
    }
    const width = tables[0]!.header.length;
    const cardsOf = tables.flatMap((t) => t.header.map((h, k) => ({ icon: '', heading: h, text: t.rows[0]?.[k] ?? '' })));
    // Small tables of one row each, side by side, are a grid of labelled boxes.
    if (tables.length >= 2 && tables.every((t) => t.rows.length === 1 && t.header.length === width) && cardsOf.length >= 2 && cardsOf.length <= 6) {
      return { slides: [{ kind: 'cards', content: { title, cards: cardsOf, reveal: false }, notes: {} }], callouts, leftover };
    }
    const same = tables.filter((t) => t.header.length === width);
    for (const t of tables) if (!same.includes(t)) leftover.push([t.header, ...t.rows].map((r) => r.join(' | ')).join('\n'));
    const rows = [same[0]!.header, ...same[0]!.rows, ...same.slice(1).flatMap((t) => [t.header, ...t.rows])];
    const cellsText = [rows[0]!.join(' | '), ...(same[0]!.aligned ? [cells(same[0]!.aligned).join(' | ')] : []), ...rows.slice(1).map((r) => r.join(' | '))].join('\n');
    return { slides: [{ kind: 'table', content: { title: title || 'Table', cells: cellsText, header: true, stripes: true, caption: '' }, notes: {} }], callouts, leftover };
  }

  // Lists under their own headings: columns.
  const lists = shown.filter((s) => s.lines.some((l) => l.t === 'item'));
  if (lists.length >= 2 && lists.length <= 6 && lists.every((s) => s.label && !PLACE.test(s.label))) {
    for (const s of shown) if (!lists.includes(s)) callouts.push(calloutOf(s));
    const columns = lists.map((s) => {
      const words = labelWords(s);
      const head = COLUMN.test(s.label) ? words : words ? `${s.label}：${words}` : s.label;
      const body = s.inline ? s.lines.slice(1) : s.lines;
      const points = body.filter((l): l is Extract<Line, { t: 'item' }> => l.t === 'item').map((l) => itemText(l));
      leftover.push(...body.filter((l) => l.t !== 'item').map(lineText).filter(Boolean));
      return { head, points };
    });
    if (columns.length === 2) {
      const [left, right] = columns as [typeof columns[0], typeof columns[0]];
      leftover.push(...left.points.slice(6), ...right.points.slice(6));
      return {
        slides: [{ kind: 'compare', content: { title, leftHeading: left.head, leftPoints: left.points.slice(0, 6), rightHeading: right.head, rightPoints: right.points.slice(0, 6), reveal: false }, notes: {} }],
        callouts, leftover,
      };
    }
    return { slides: [{ kind: 'cards', content: { title, cards: columns.map((c) => ({ icon: '', heading: c.head, text: c.points.join('\n') })), reveal: false }, notes: {} }], callouts, leftover };
  }

  // A list, perhaps with prose: the plain reader picks its kind. Labelled text and quotes are key lines.
  const lines: string[] = [];
  if (lists.length) {
    for (const s of shown) {
      if (!lists.includes(s)) {
        if (!s.label && s.lines.every((l) => l.t === 'text')) lines.push(...s.lines.map(lineText));
        else callouts.push(calloutOf(s));
        continue;
      }
      const body = s.inline ? s.lines.slice(1) : s.lines;
      if (s.inline) leftover.push(`${s.label}：${labelWords(s)}`);
      for (const l of body) {
        if (l.t === 'item') lines.push(l.ordered ? `1. ${itemText(l, '：')}` : `- ${itemText(l)}`);
        else if (l.t === 'text' && !s.label) lines.push(l.text);
        else if (lineText(l)) callouts.push(lineText(l));
      }
    }
  } else {
    // Text only: the part with the most lines is the slide; the others are key lines.
    const main = shown.reduce<Segment | null>((best, s) => (!best || s.lines.length > best.lines.length ? s : best), null);
    for (const s of shown) if (s !== main) callouts.push(calloutOf(s));
    if (main) {
      const body = main.lines.filter((l) => l.t !== 'arrow');
      const quotes = body.filter((l) => l.t === 'quote');
      if (body.length >= 2 && quotes.length === body.length) lines.push(...body.map((l) => `- ${lineText(l)}`));
      else if (body.length === 1 && quotes.length === 1 && !main.label) lines.push(`> ${lineText(body[0]!)}`);
      else lines.push(...body.map(lineText));
    }
  }
  const made = plain({ heading: title, level: 2, lines, start: 0 }, index);
  return { slides: made, callouts, leftover };
}

const CALLOUT_KINDS = new Set(['bullets', 'steps', 'compare', 'cards']);

/** Key lines, notes, cues and the corner tag onto a built slide. */
function finish(slide: DraftSlide, callouts: string[], leftover: string[], extras: Extras): DraftSlide {
  const content = { ...slide.content } as Record<string, unknown>;
  const lines = callouts.map((l) => l.trim()).filter(Boolean);
  const rest = [...leftover];
  if (lines.length && CALLOUT_KINDS.has(slide.kind)) {
    content.callout = lines.slice(0, 3).join('\n');
    rest.push(...lines.slice(3));
  } else if (lines.length && slide.kind === 'table') {
    content.caption = [String(content.caption ?? ''), ...lines].filter((s) => s.trim()).join(' ');
  } else rest.push(...lines);
  const script = [...extras.notes, slide.notes?.script ?? '', ...rest].map((s) => s.trim()).filter(Boolean).join('\n');
  const notes = { ...(slide.notes ?? {}), ...(script ? { script } : {}), ...(extras.cues.length ? { cues: extras.cues } : {}) };
  return {
    ...slide, content, notes,
    ...(extras.tag ? { elements: [...(slide.elements ?? []), cornerTag(extras.tag)] } : {}),
  };
}

const QUESTION_LINE = /^\s*(?:q|question|问题|提问)\s*[:.：]\s*/i;
const ANSWER_LINE = /^\s*(?:a|answer|答案)\s*[:：]\s*/i;

/** A block with choices: the question, and before it a slide of whatever the page shows first. */
function questionSlides(heading: string, shown: Segment[], answer: string, extras: Extras, index: number, plain: Plain): DraftSlide[] | null {
  const flat = shown.flatMap((s, si) => s.lines.map((l) => ({ si, l })));
  const choices = flat.filter((e) => e.l.t === 'choice');
  const letters = choices.map((e) => (e.l as Extract<Line, { t: 'choice' }>).letter).filter(Boolean);
  const qLine = flat.findIndex((e) => e.l.t === 'text' && QUESTION_LINE.test(e.l.text));
  if (!choices.length || (qLine < 0 && !choiceRun(letters) && !choices.every((e) => (e.l as Extract<Line, { t: 'choice' }>).letter === ''))) return null;
  if (qLine < 0 && choices.length < 2) return null;
  const first = flat.indexOf(choices[0]!);
  const last = flat.indexOf(choices[choices.length - 1]!);
  let at = qLine >= 0 && qLine < first ? qLine : -1;
  if (at < 0) {
    for (let k = first - 1; k >= 0; k--) {
      const l = flat[k]!.l;
      if (l.t === 'quote' || l.t === 'text' || (l.t === 'item' && /[?？]$/.test(l.text))) { at = k; break; }
      if (l.t !== 'arrow') break;
    }
  }
  const question = at >= 0 ? lineText(flat[at]!.l).replace(QUESTION_LINE, '').trim() : heading;
  let correct = -1;
  const options = choices.map((e, i) => {
    const c = e.l as Extract<Line, { t: 'choice' }>;
    if (c.checked || /\s\*$|\(correct\)|[✓✔]$/i.test(c.text)) correct = i;
    return c.text.replace(/\s*(?:\*|\(correct\)|[✓✔])\s*$/i, '').trim();
  });
  const after = flat.slice(last + 1).filter((e) => e !== flat[qLine]);
  const answerLine = after.find((e) => e.l.t === 'text' && ANSWER_LINE.test(e.l.text));
  let answerText = answer || (answerLine ? lineText(answerLine.l).replace(ANSWER_LINE, '').trim() : '');
  if (correct < 0 && answerText && options.length) {
    const letter = /^([A-F])\b/i.exec(answerText)?.[1];
    if (letter) correct = letter.toUpperCase().charCodeAt(0) - 65;
  }
  const extra = after.filter((e) => e !== answerLine).map((e) => lineText(e.l)).filter(Boolean);
  if (!answerText && extra.length) answerText = joinText(extra.splice(0));
  const ask: DraftSlide = finish(
    { kind: 'question', content: { question, options, correct, answer: answerText }, notes: { check: null } },
    [], extra, { ...extras, tag: '' },
  );
  // What the page shows before the question is a slide of its own, just before it.
  const before = flat.slice(0, at >= 0 ? at : first).filter((e) => e.l.t !== 'arrow');
  if (!before.length) return [extras.tag ? { ...ask, elements: [cornerTag(extras.tag)] } : ask];
  const segs = shown.map((s, si) => {
    const kept = before.filter((e) => e.si === si).map((e) => e.l);
    return { ...s, inline: s.inline && kept[0] === s.lines[0], lines: kept };
  }).filter((s) => s.lines.length);
  const built = build(heading, segs, index, plain);
  const opening = built.slides.map((s, i) => finish(s, i ? [] : built.callouts, i ? [] : built.leftover, { notes: [], cues: [], tag: i ? '' : extras.tag }));
  return [...opening, ask];
}

/** Lines that looked like choices but aren't a question's: points or text again. */
function unchoose(shown: Segment[]): Segment[] {
  return shown.map((s) => ({
    ...s,
    lines: s.lines.map((l): Line => {
      if (l.t !== 'choice') return l;
      const text = l.letter ? `${l.letter}. ${l.text}` : l.text;
      return l.item ? { t: 'item', text, ordered: false, more: [] } : { t: 'text', text };
    }),
  }));
}

/** A block with labelled parts, as slides. `plain` is the outline reader for what is left once the parts are sorted. */
export function richBlockToSlides(block: OutlineBlock, index: number, plain: Plain): DraftSlide[] {
  const heading = unemphasize(block.heading).replace(/[:：]\s*$/, '').trim();
  const { shown, extras, answer } = sortParts(block.lines);
  const asked = questionSlides(heading, shown, answer, extras, index, plain);
  if (asked) return asked;
  const built = build(heading, unchoose(shown), index, plain);
  if (answer) built.leftover.push(answer);
  return built.slides.map((s, i) => finish(s, i ? [] : built.callouts, i ? [] : built.leftover, i ? { notes: [], cues: [], tag: '' } : extras));
}

// ─── On the slide: a corner tag and a progress strip ──────────────────

const RIGHT = CANVAS_W - 128;
const LEFT = 128;

function textWidth(s: string, size: number): number {
  const cjk = cjkChars(s);
  return cjk * size + (s.length - cjk) * size * 0.56;
}

/** A short label in the slide's top corner, such as the theory a slide applies. */
export function cornerTag(value: string): SlideElement {
  const text = value.trim().slice(0, 40);
  const size = 26;
  const w = Math.min(640, Math.round(textWidth(text, size) + 56));
  return { id: uid('e'), type: 'text', text, x: RIGHT - w, y: 16, w, h: 68, size, weight: 700, color: 'onAccent', fill: 'accent', align: 'center', valign: 'middle', font: 'body' };
}

const NUMERALS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const num = (s: string | undefined) => (s === undefined ? NaN : /^\d+$/.test(s) ? Number(s) : NUMERALS[s] ?? NaN);
const STEP_REF = /^(?:第\s*([0-9]+|[一二三四五六七八九十])(?:\s*[、,，和与及至到~～\-–—]\s*第?\s*([0-9]+|[一二三四五六七八九十]))?\s*步|steps?\s+(\d+)(?:\s*(?:[-–—&,]|and|to)\s*(\d+))?\b)/i;

/** The steps a slide's title says it covers: "第5、6步：…" → [5, 6], "Step 2: …" → [2]. */
export function stepsNamed(title: string): number[] {
  const m = STEP_REF.exec(title.trim());
  if (!m) return [];
  const a = num(m[1] ?? m[3]);
  const b = num(m[2] ?? m[4]);
  if (!Number.isFinite(a)) return [];
  if (!Number.isFinite(b) || b < a) return [a];
  return Array.from({ length: Math.min(b - a + 1, 10) }, (_, i) => a + i);
}

function titleOf(s: DraftSlide): string {
  const c = s.content as Record<string, unknown>;
  return String(c.title ?? c.question ?? '');
}

/**
 * After a slide of steps, slides titled "第1步…", "第2步…" (or Step 1, Step 2) get the steps
 * across their top, with theirs marked, so the room can see where the talk has got to.
 */
export function addProgress(slides: DraftSlide[]): void {
  const named = slides.map((s) => stepsNamed(titleOf(s)));
  if (named.filter((n) => n.length).length < 2) return;
  slides.forEach((slide, i) => {
    const current = named[i]!;
    if (!current.length) return;
    const highest = Math.max(...current);
    let map: DraftSlide | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const s = slides[j]!;
      const steps = (s.content as { steps?: unknown }).steps;
      if (s.kind === 'steps' && !named[j]!.length && Array.isArray(steps) && steps.length >= highest) { map = s; break; }
    }
    if (!map) return;
    const labels = ((map.content as { steps: { label?: unknown }[] }).steps).map((st) => String(st.label ?? '').trim());
    const tag = slide.elements?.find((e) => e.type === 'text' && e.y < 60 && e.x > CANVAS_W / 2);
    // Clear of the tag, or of the small ornament many looks put in that corner.
    const right = tag ? tag.x - 24 : RIGHT - 48;
    const gap = 12;
    const w = (right - LEFT - gap * (labels.length - 1)) / labels.length;
    const strip: SlideElement[] = labels.map((label, k) => {
      const on = current.includes(k + 1);
      return {
        id: uid('e'), type: 'text', text: `${k + 1} ${label}`, x: Math.round(LEFT + k * (w + gap)), y: 16, w: Math.round(w), h: 64,
        size: 22, weight: on ? 700 : 500, color: on ? 'onAccent' : 'muted', fill: on ? 'accent' : 'surface', align: 'center', valign: 'middle', font: 'body',
      };
    });
    slide.elements = [...strip, ...(slide.elements ?? [])];
  });
}
