// Reads a finished deck, to present it as it is: the PowerPoint gives each slide's words,
// speaker notes, place in the order and whether it is hidden; a PDF of the same deck (or
// pictures of its slides) gives the look. Questions already on the slides are found here
// too, so they can be asked on phones. Rendering PDF pages needs a canvas and lives in
// src/features/finished; everything here is plain parsing, so it can be tested.

import { estimateMinutes } from '../deck/draft';
import { type Audience, type Deck, type DeckPurpose, type Slide, emptyNotes, normalizeNotes, uid } from '../deck/types';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DC = 'http://purl.org/dc/elements/1.1/';

export interface PptxSlide {
  /** Its place in the PowerPoint, from 1, hidden slides included. */
  number: number;
  title: string;
  /** Every paragraph on the slide, one per line; a table row is one line, cells split by " | ". */
  text: string;
  /** The speaker notes, one paragraph per line. */
  notes: string;
  hidden: boolean;
  /** The paragraphs that are neither the title nor in a table. */
  body?: string[];
  /** Each table's rows of cells. */
  tables?: string[][][];
}

export interface PptxDeck {
  title: string;
  slides: PptxSlide[];
  /** Slide width over height. */
  aspect: number;
}

/** A page of the PDF, or a picture of a slide, before it is stored. */
export interface PageInfo {
  /** Text found on the page, when it is a PDF page. */
  text: string;
}

/** A question on a slide, ready to ask on phones. correct is -1 when the slide doesn't say. */
export interface FoundQuestion {
  question: string;
  options: string[];
  correct: number;
}

function parse(xml: string) {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

const tidy = (s: string) => s.replace(/[ \t ]+/g, ' ').trim();

/** A paragraph's text, with line breaks inside it kept as spaces. */
function paragraphText(p: Element): string {
  let out = '';
  for (const node of Array.from(p.getElementsByTagNameNS(A, '*'))) {
    if (node.localName === 't') out += node.textContent ?? '';
    else if (node.localName === 'br') out += ' ';
  }
  return tidy(out);
}

/** The placeholder type of the shape a paragraph sits in ("title", "body", "sldNum"…), or "". */
function placeholderOf(p: Element): string {
  for (let el: Element | null = p.parentElement; el; el = el.parentElement) {
    if (el.namespaceURI === P && el.localName === 'sp') {
      const ph = el.getElementsByTagNameNS(P, 'ph')[0];
      return ph ? ph.getAttribute('type') ?? 'body' : '';
    }
  }
  return '';
}

const FURNITURE = new Set(['sldNum', 'dt', 'ftr', 'hdr']);

/** A text box (or table) on a slide: where it sits, how big its type is and what it says. */
export interface SlideShape {
  /** Placeholder type ("title", "body"…), or "" for a plain text box. */
  ph: string;
  /** Top-left corner in EMU; NaN when the slide leaves it to the layout. */
  x: number;
  y: number;
  /** The largest type size in it, in points; 0 when the slide leaves it to the layout. */
  size: number;
  lines: string[];
  /** A table's rows of cells. */
  rows?: string[][];
  /** A picture's description or a chart's words, written "(Picture: …)" or "(Chart: …)". */
  role?: 'picture' | 'chart';
}

const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';

/** Descriptions Office writes by itself, or that only name the file. */
const NO_DESCRIPTION = /automatically generated|^(?:picture|image|graphic|图片|图像)\s*\d*$|\.(?:png|jpe?g|gif|bmp|svg|emf|wmf|tiff?)$/i;

const textIn = (el: Element | undefined, ns: string, name: string, sep: string) =>
  el ? tidy(Array.from(el.getElementsByTagNameNS(ns, name)).map((t) => t.textContent ?? '').join(sep)) : '';

/** A native chart's words: its title, series names, first categories and axis titles. */
export function chartWords(xml: string): string {
  const doc = parse(xml);
  const named = (el: Element | undefined) => {
    const tx = el && child(el, C, 'tx');
    return textIn(tx, A, 't', '') || textIn(tx, C, 'v', ' ');
  };
  const chart = doc.getElementsByTagNameNS(C, 'chart')[0];
  const title = chart ? named(child(chart, C, 'title')) : '';
  const series = Array.from(doc.getElementsByTagNameNS(C, 'ser'));
  const names = [...new Set(series.map((s) => named(s)).filter(Boolean))];
  const cat = series[0] && child(series[0], C, 'cat');
  const cats = cat ? Array.from(cat.getElementsByTagNameNS(C, 'pt')).map((pt) => tidy(child(pt, C, 'v')?.textContent ?? '')).filter(Boolean) : [];
  const axes = ['catAx', 'dateAx', 'valAx'].flatMap((n) => Array.from(doc.getElementsByTagNameNS(C, n)))
    .map((ax) => named(child(ax, C, 'title'))).filter(Boolean);
  return [title, names.join(', '), cats.slice(0, 12).join(', ') + (cats.length > 12 ? '…' : ''), axes.join(', ')].filter(Boolean).join(' · ');
}

const child = (el: Element, ns: string, name: string) =>
  Array.from(el.children).find((c) => c.namespaceURI === ns && c.localName === name);

function offsetOf(el: Element): { x: number; y: number } {
  const holder = child(el, P, 'spPr') ?? child(el, P, 'grpSpPr') ?? el;
  const xfrm = child(holder, A, 'xfrm') ?? child(holder, P, 'xfrm');
  const off = xfrm && child(xfrm, A, 'off');
  return off ? { x: Number(off.getAttribute('x')), y: Number(off.getAttribute('y')) } : { x: NaN, y: NaN };
}

/** The largest type size set on a run with words, else the box's own default, in points. */
function sizeOf(body: Element): number {
  let most = 0;
  for (const run of Array.from(body.getElementsByTagNameNS(A, 'r'))) {
    if (!run.getElementsByTagNameNS(A, 't')[0]?.textContent?.trim()) continue;
    most = Math.max(most, Number(run.getElementsByTagNameNS(A, 'rPr')[0]?.getAttribute('sz')) || 0);
  }
  if (!most) for (const d of Array.from(body.getElementsByTagNameNS(A, 'defRPr'))) most = Math.max(most, Number(d.getAttribute('sz')) || 0);
  return most / 100;
}

function shapesIn(parent: Element, charts: Map<string, string>, at?: { x: number; y: number }): SlideShape[] {
  const out: SlideShape[] = [];
  for (const el of Array.from(parent.children)) {
    if (el.localName === 'AlternateContent') {
      const pick = child(el, el.namespaceURI ?? '', 'Fallback') ?? child(el, el.namespaceURI ?? '', 'Choice');
      if (pick) out.push(...shapesIn(pick, charts, at));
      continue;
    }
    if (el.namespaceURI !== P) continue;
    const pos = at ?? offsetOf(el);
    if (el.localName === 'sp') {
      const body = child(el, P, 'txBody');
      const lines = body ? Array.from(body.getElementsByTagNameNS(A, 'p')).map(paragraphText).filter(Boolean) : [];
      if (!body || !lines.length) continue;
      const ph = el.getElementsByTagNameNS(P, 'ph')[0];
      out.push({ ph: ph ? ph.getAttribute('type') ?? 'body' : '', ...pos, size: sizeOf(body), lines });
    } else if (el.localName === 'pic') {
      const info = el.getElementsByTagNameNS(P, 'cNvPr')[0];
      const said = tidy(info?.getAttribute('descr') || info?.getAttribute('title') || '');
      if (said && !NO_DESCRIPTION.test(said)) out.push({ ph: '', ...pos, size: 0, lines: [`(Picture: ${said})`], role: 'picture' });
    } else if (el.localName === 'graphicFrame') {
      const id = el.getElementsByTagNameNS(C, 'chart')[0]?.getAttributeNS(R, 'id');
      const words = id ? charts.get(id) : '';
      if (words) { out.push({ ph: '', ...pos, size: 0, lines: [`(Chart: ${words})`], role: 'chart' }); continue; }
      const table = el.getElementsByTagNameNS(A, 'tbl')[0];
      if (!table) continue;
      const rows = Array.from(table.getElementsByTagNameNS(A, 'tr'))
        .map((tr) => Array.from(tr.getElementsByTagNameNS(A, 'tc')).map((tc) => Array.from(tc.getElementsByTagNameNS(A, 'p')).map(paragraphText).filter(Boolean).join(' ')))
        .filter((r) => r.some(Boolean));
      if (rows.length) out.push({ ph: '', ...pos, size: 0, lines: rows.map((r) => r.join(' | ')), rows });
    } else if (el.localName === 'grpSp') {
      // A group's members keep their own order, at the group's place on the slide.
      out.push(...shapesIn(el, charts, pos));
    }
  }
  return out;
}

/** About a fifth of an inch: boxes this close in height read as one row. */
const ROW = 182_880;

/**
 * What a slide says, box by box, in reading order: top to bottom, then left to right, when
 * every box has a place on the slide (blank-layout decks are often built in any order);
 * otherwise in the file's order, which placeholder layouts keep sensible.
 */
export function slideShapes(xml: string, charts: Map<string, string> = new Map()): { shapes: SlideShape[]; hidden: boolean } {
  const doc = parse(xml);
  const tree = doc.getElementsByTagNameNS(P, 'spTree')[0];
  const shapes = tree ? shapesIn(tree, charts) : [];
  if (shapes.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y))) {
    shapes.sort((a, b) => Math.round(a.y / ROW) - Math.round(b.y / ROW) || a.x - b.x);
  }
  return { shapes, hidden: doc.documentElement.getAttribute('show') === '0' };
}

/** A short plain text box at one spot: if it is on most slides, it is a label, not content. */
export function labelKey(s: SlideShape): string {
  const words = s.lines.join(' ');
  if (s.rows || (s.ph && s.ph !== 'body') || words.length > 80 || !Number.isFinite(s.x)) return '';
  return `${words}@${Math.round(s.x / ROW)},${Math.round(s.y / ROW)}`;
}

/** Labels repeated at the same spot on at least half the slides (and on three or more). */
export function repeatedLabels(slides: SlideShape[][]): Set<string> {
  const seen = new Map<string, number>();
  for (const shapes of slides) {
    for (const key of new Set(shapes.map(labelKey).filter(Boolean))) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const least = Math.max(3, slides.length / 2);
  return new Set([...seen].filter(([, n]) => n >= least).map(([k]) => k));
}

const LINK = /^(?:https?:\/\/|www\.)\S+$|^[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|edu|gov|io|co|uk|cn|ai|app|dev)(?:\/\S*)?$/i;

/**
 * The slide's name: its title placeholder; on a slide without one, the box in the largest
 * type, skipping labels repeated on every slide, web addresses and long passages.
 */
function pickTitle(shapes: SlideShape[], repeated: Set<string>): SlideShape[] {
  const placed = shapes.filter((s) => s.ph === 'title' || s.ph === 'ctrTitle');
  if (placed.length) return placed;
  let best: SlideShape | undefined;
  for (const s of shapes) {
    const words = s.lines.join(' ');
    if (s.rows || s.role || FURNITURE.has(s.ph) || repeated.has(labelKey(s)) || LINK.test(words) || words.length > 90 || s.lines.length > 2) continue;
    if (!best || s.size > best.size) best = s;
  }
  return best ? [best] : [];
}

/** Title and text of a slide, in reading order. Labels found on most slides are left out. */
export function slideWords(xml: string, repeated: Set<string> = new Set(), charts: Map<string, string> = new Map()): Omit<PptxSlide, 'number' | 'notes'> {
  const { shapes, hidden } = slideShapes(xml, charts);
  const kept = shapes.filter((s) => !FURNITURE.has(s.ph) && !repeated.has(labelKey(s)));
  const named = pickTitle(kept, repeated);
  return {
    title: named.map((s) => s.lines.join(' ')).join(' '),
    text: kept.flatMap((s) => s.lines).join('\n'),
    hidden,
    body: kept.filter((s) => !s.rows && !named.includes(s)).flatMap((s) => s.lines),
    tables: kept.flatMap((s) => (s.rows ? [s.rows] : [])),
  };
}

/** The speaker notes of a notes slide: the body placeholder's paragraphs. */
export function notesWords(xml: string): string {
  const doc = parse(xml);
  return Array.from(doc.getElementsByTagNameNS(A, 'p'))
    .filter((p) => placeholderOf(p) === 'body')
    .map(paragraphText)
    .filter(Boolean)
    .join('\n');
}

/** Relationship id → target path, resolved against the part's folder. */
function relationships(xml: string | undefined, folder: string): Map<string, { target: string; type: string }> {
  const out = new Map<string, { target: string; type: string }>();
  if (!xml) return out;
  for (const rel of Array.from(parse(xml).getElementsByTagNameNS(PKG, 'Relationship'))) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (!id || !target || rel.getAttribute('TargetMode') === 'External') continue;
    out.set(id, { target: resolvePath(folder, target), type: rel.getAttribute('Type') ?? '' });
  }
  return out;
}

function resolvePath(folder: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = folder.split('/').filter(Boolean);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

/** Reads a .pptx: slides in the presentation's own order (not file names), with words and notes. */
export async function readPptx(buffer: ArrayBuffer): Promise<PptxDeck> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const read = (name: string) => zip.file(name)?.async('string');
  const presentation = await read('ppt/presentation.xml');
  const rels = relationships(await read('ppt/_rels/presentation.xml.rels'), 'ppt');
  let files: string[] = [];
  let aspect = 16 / 9;
  if (presentation) {
    const doc = parse(presentation);
    files = Array.from(doc.getElementsByTagNameNS(P, 'sldId'))
      .map((s) => rels.get(s.getAttributeNS(R, 'id') ?? s.getAttribute('r:id') ?? '')?.target)
      .filter((t): t is string => !!t && !!zip.file(t));
    const size = doc.getElementsByTagNameNS(P, 'sldSz')[0];
    const cx = Number(size?.getAttribute('cx'));
    const cy = Number(size?.getAttribute('cy'));
    if (cx > 0 && cy > 0) aspect = cx / cy;
  }
  if (!files.length) {
    files = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  }
  if (!files.length) throw new Error('This PowerPoint file has no slides.');
  const parts = await Promise.all(files.map(async (file) => {
    const folder = file.slice(0, file.lastIndexOf('/'));
    const slideRels = relationships(await read(`${folder}/_rels/${file.slice(folder.length + 1)}.rels`), folder);
    const charts = new Map<string, string>();
    for (const [id, rel] of slideRels) {
      const chart = rel.type.endsWith('/chart') ? await read(rel.target) : undefined;
      if (chart) charts.set(id, chartWords(chart));
    }
    return { xml: (await read(file)) ?? '', slideRels, charts };
  }));
  const repeated = repeatedLabels(parts.map((p) => slideShapes(p.xml, p.charts).shapes));
  const slides: PptxSlide[] = [];
  for (const [i, { xml, slideRels, charts }] of parts.entries()) {
    const words = slideWords(xml, repeated, charts);
    const notesPart = [...slideRels.values()].find((r) => r.type.endsWith('/notesSlide'))?.target;
    const notesXml = notesPart ? await read(notesPart) : undefined;
    slides.push({ number: i + 1, ...words, notes: notesXml ? notesWords(notesXml) : '' });
  }
  const core = await read('docProps/core.xml');
  const docTitle = core ? tidy(parse(core).getElementsByTagNameNS(DC, 'title')[0]?.textContent ?? '') : '';
  const first = slides.find((s) => !s.hidden) ?? slides[0]!;
  return { title: docTitle || first.title || first.text.split('\n')[0] || '', slides, aspect };
}

// ─── Questions on slides ──────────────────────────────────────────────

const OPTION = /^[(（]?([A-Fa-f])\s*([).:：．、）])\s*(.+)$/;
const ASKS = /[?？]\s*$/;
/** Lines that sound like speech, not choices: "A: Let's go!" */
const SAID = /[!！]["”’」]?\s*$/;
const MARK = /\s*(?:[✓✔☑✅]|\((?:correct|right|answer)\)|\*)\s*$|^\s*(?:[✓✔☑✅]|\*)\s*/i;
const ANSWER_IN_NOTES = /(?:answer|correct(?:\s+answer)?|solution|答案|正确答案)\s*(?:is|:|：|-|–|=)?\s*[(（]?([A-F])(?![A-Za-z])/i;

/**
 * A multiple-choice question written on a slide: a question line, then choices lettered
 * A, B, C… in order. The right choice is the one marked with a tick or "(correct)", or the
 * letter the speaker notes give ("Answer: B"). Null when the slide asks nothing like that,
 * as with a dialogue between A and B ("A: Let's cross!") and no question asked.
 */
export function findQuestion(text: string, notes = ''): FoundQuestion | null {
  const lines = text.split('\n').map(tidy).filter(Boolean);
  const start = lines.findIndex((l) => OPTION.exec(l)?.[1]?.toUpperCase() === 'A');
  if (start < 1) return null;
  const options: string[] = [];
  const marks: string[] = [];
  let marked = -1;
  for (const line of lines.slice(start)) {
    const m = OPTION.exec(line);
    if (!m || m[1]!.toUpperCase() !== 'ABCDEF'[options.length]) break;
    let value = m[3]!;
    if (MARK.test(value)) { marked = options.length; value = value.replace(MARK, '').trim(); }
    options.push(value);
    marks.push(m[2]!);
    if (options.length === 6) break;
  }
  if (options.length < 2) return null;
  const before = lines.slice(0, start);
  const asked = [...before].reverse().find((l) => ASKS.test(l));
  // Speakers A and B, or lines exclaimed: a dialogue, unless a question comes first.
  if (!asked && (marks.every((s) => s === ':' || s === '：') || options.some((o) => SAID.test(o)))) return null;
  const question = asked ?? before[before.length - 1]!;
  const fromNotes = ANSWER_IN_NOTES.exec(notes)?.[1]?.toUpperCase();
  const noted = fromNotes ? 'ABCDEF'.indexOf(fromNotes) : -1;
  const correct = marked >= 0 ? marked : noted < options.length ? noted : -1;
  return { question, options, correct };
}

// ─── Pairing the PowerPoint with its pictures ─────────────────────────

export interface Paired {
  /** The PowerPoint slide, when there is a PowerPoint. */
  slide?: PptxSlide;
  /** Index of the PDF page or picture showing it, when there is one. */
  page?: number;
  hidden: boolean;
}

/**
 * Matches the PowerPoint's slides to the PDF's pages. PowerPoint leaves hidden slides out
 * of a PDF unless asked: with as many pages as visible slides, hidden slides are left out;
 * with as many as all slides, every slide gets its page and hidden ones stay hidden.
 * Otherwise they are matched in order, and the warning says so.
 */
export function pairPages(pptx: PptxDeck | null, pages: number): { paired: Paired[]; warning?: string } {
  if (!pptx) return { paired: Array.from({ length: pages }, (_, i) => ({ page: i, hidden: false })) };
  const all = pptx.slides;
  const visible = all.filter((s) => !s.hidden);
  if (!pages) return { paired: visible.map((slide) => ({ slide, hidden: false })) };
  if (pages === all.length) return { paired: all.map((slide, i) => ({ slide, page: i, hidden: slide.hidden })) };
  if (pages === visible.length) return { paired: visible.map((slide, i) => ({ slide, page: i, hidden: false })) };
  const n = Math.max(pages, visible.length);
  const paired: Paired[] = Array.from({ length: n }, (_, i) => ({ slide: visible[i], page: i < pages ? i : undefined, hidden: false }));
  return {
    paired,
    warning: `The PDF has ${pages} ${pages === 1 ? 'page' : 'pages'} and the PowerPoint ${visible.length} ${visible.length === 1 ? 'slide' : 'slides'} to show, so they were matched in order. Check that each slide's notes belong to it, or export the PDF again from the same file.`,
  };
}

// ─── The deck ─────────────────────────────────────────────────────────

/** One slide of a finished deck, with its picture stored. */
export interface FinishedSlide {
  /** "asset:…", or "" when there is no picture yet. */
  picture: string;
  title: string;
  text: string;
  notes: string;
  hidden: boolean;
}

/** The first line that could name a slide. */
function firstLine(text: string): string {
  return text.split('\n').map(tidy).find((l) => l.length > 1)?.slice(0, 90) ?? '';
}

/**
 * A deck of designed slides: each picture as it is, its words kept beside it, the speaker
 * notes as the starting script, and any question on it set up as a phone quiz.
 */
export function finishedDeck(slides: FinishedSlide[], o: { title: string; audience: Audience; purpose: DeckPurpose; themeId: string; quizzes?: boolean }): Deck {
  const now = Date.now();
  const made: Slide[] = slides.map((s, i) => {
    const found = o.quizzes === false ? null : findQuestion(s.text, s.notes);
    const notes = normalizeNotes({
      ...emptyNotes(),
      script: s.notes,
      ...(s.notes ? { extra: { pptx: { notes: s.notes } } } : {}),
    });
    notes.minutes = estimateMinutes(notes, found ? 'question' : 'designed');
    return {
      id: uid('s'),
      kind: 'designed',
      content: {
        image: s.picture,
        title: tidy(s.title) || firstLine(s.text) || `Slide ${i + 1}`,
        text: s.text,
        question: found?.question ?? '',
        options: found?.options ?? [],
        correct: found?.correct ?? -1,
      },
      notes,
      ...(s.hidden ? { hidden: true } : {}),
    };
  });
  return {
    id: uid('deck'),
    title: tidy(o.title) || 'Finished deck',
    themeId: o.themeId,
    audience: o.audience,
    purpose: o.purpose,
    slides: made,
    source: 'finished',
    createdAt: now,
    updatedAt: now,
  };
}
