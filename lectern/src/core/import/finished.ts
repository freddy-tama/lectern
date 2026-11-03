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
  /** Every paragraph on the slide, one per line, tables included. */
  text: string;
  /** The speaker notes, one paragraph per line. */
  notes: string;
  hidden: boolean;
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

/** Title and text of a slide, in the order they appear in the file. */
export function slideWords(xml: string): { title: string; text: string; hidden: boolean } {
  const doc = parse(xml);
  const title: string[] = [];
  const lines: string[] = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(A, 'p'))) {
    const words = paragraphText(p);
    if (!words) continue;
    const ph = placeholderOf(p);
    if (FURNITURE.has(ph)) continue;
    if (ph === 'title' || ph === 'ctrTitle') title.push(words);
    lines.push(words);
  }
  const hidden = doc.documentElement.getAttribute('show') === '0';
  return { title: title.join(' '), text: lines.join('\n'), hidden };
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
  const slides: PptxSlide[] = [];
  for (const [i, file] of files.entries()) {
    const words = slideWords((await read(file)) ?? '');
    const folder = file.slice(0, file.lastIndexOf('/'));
    const slideRels = relationships(await read(`${folder}/_rels/${file.slice(folder.length + 1)}.rels`), folder);
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

const OPTION = /^[(（]?([A-Fa-f])\s*[).:．、）]\s*(.+)$/;
const MARK = /\s*(?:[✓✔☑✅]|\((?:correct|right|answer)\)|\*)\s*$|^\s*(?:[✓✔☑✅]|\*)\s*/i;
const ANSWER_IN_NOTES = /(?:answer|correct(?:\s+answer)?|solution|答案|正确答案)\s*(?:is|:|：|-|–|=)?\s*[(（]?([A-F])(?![A-Za-z])/i;

/**
 * A multiple-choice question written on a slide: a question line, then choices lettered
 * A, B, C… in order. The right choice is the one marked with a tick or "(correct)", or the
 * letter the speaker notes give ("Answer: B"). Null when the slide asks nothing like that.
 */
export function findQuestion(text: string, notes = ''): FoundQuestion | null {
  const lines = text.split('\n').map(tidy).filter(Boolean);
  const start = lines.findIndex((l) => OPTION.exec(l)?.[1]?.toUpperCase() === 'A');
  if (start < 1) return null;
  const options: string[] = [];
  let marked = -1;
  for (const line of lines.slice(start)) {
    const m = OPTION.exec(line);
    if (!m || m[1]!.toUpperCase() !== 'ABCDEF'[options.length]) break;
    let value = m[2]!;
    if (MARK.test(value)) { marked = options.length; value = value.replace(MARK, '').trim(); }
    options.push(value);
    if (options.length === 6) break;
  }
  if (options.length < 2) return null;
  const before = lines.slice(0, start);
  const question = [...before].reverse().find((l) => /[?？]\s*$/.test(l)) ?? before[before.length - 1]!;
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
