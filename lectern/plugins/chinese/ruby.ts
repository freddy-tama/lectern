// Pinyin over each character, the way the book prints a 课文: a 段's characters paired with their
// syllables, and line breaking of those cells. Ported from Lesson Studio (public/slides/boxes/ruby.js).
// Also finds the names in a 段 (a capitalised syllable marks one), so a cloze never blanks them.

const VOWELS = 'aeiouüvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ';
const SYLLABLE = new RegExp(`(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?[${VOWELS}]+(?:ng(?![${VOWELS}])|n(?![${VOWELS}]))?(?:r(?![${VOWELS}]))?`, 'giu');
const HAN = /\p{Script=Han}/u;
const DIGIT = /[0-9０-９]/u;
const ALNUM = /[0-9A-Za-z０-９]/u;

/** Marks a line may not start with. */
export const NO_START = new Set([...'，。、；：！？）」』”’》〉】〕…—,.;:!?)]}%·～']);
/** Marks a line may not end with. */
export const NO_END = new Set([...'“‘（《〈「『【〔([{']);

/** One character and the syllable over it ('' for punctuation, spaces and anything else without one). */
export interface RubyCell {
  ch: string;
  py: string;
  /** Set on the cells of a cloze blank: which blank, in reading order. */
  blank?: number;
}

/** The syllables of a pinyin text as written (capitals kept: Sūn Zhōngshān). */
export function syllablesOf(pinyin: string): string[] {
  return String(pinyin || '').normalize('NFC').match(SYLLABLE) ?? [];
}

/** Where each syllable sits in the NFC pinyin text. The text between two syllables keeps its spaces and marks. */
export function syllableSpans(pinyin: string): { start: number; end: number }[] {
  return [...String(pinyin || '').normalize('NFC').matchAll(SYLLABLE)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}

function pair(chars: string[], syllables: string[], carries: (ch: string) => boolean): RubyCell[] | null {
  const out: RubyCell[] = [];
  let s = 0;
  const left = (from: number) => chars.slice(from).filter(carries).length;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (!carries(ch)) { out.push({ ch, py: '' }); continue; }
    const prev = [...out].reverse().find((cell) => cell.py);
    // 儿 run onto the syllable before it (哪儿 nǎr) has no syllable of its own.
    if (ch === '儿' && prev && /r$/iu.test(prev.py) && !/^[eēéěè]r$/iu.test(prev.py) && syllables.length - s < left(i)) { out.push({ ch, py: '' }); continue; }
    if (s >= syllables.length) return null;
    out.push({ ch, py: syllables[s] });
    s += 1;
  }
  return s === syllables.length ? out : null;
}

/**
 * Every character of a 段 with its syllable. A year written in digits takes one syllable per digit when
 * the pinyin reads it out. Null when the characters and the pinyin don't line up.
 */
export function rubyCells(hanzi: string, pinyin: string): RubyCell[] | null {
  const chars = Array.from(String(hanzi || ''));
  const syllables = syllablesOf(pinyin);
  if (!syllables.length || !chars.some((ch) => HAN.test(ch))) return null;
  return pair(chars, syllables, (ch) => HAN.test(ch)) ?? pair(chars, syllables, (ch) => HAN.test(ch) || DIGIT.test(ch));
}

/** The characters of a 段 with no syllables over them. */
export function plainCells(hanzi: string): RubyCell[] {
  return Array.from(String(hanzi || '')).map((ch) => ({ ch, py: '' }));
}

/**
 * Letter spacing (px) that gives most syllables room over their character: the 90th percentile of how far
 * a syllable is wider than its character, kept between a tenth and a little over half a character.
 */
export function rubyTracking(cells: RubyCell[], size: number, advance: (ch: string) => number, pyWidth: (py: string) => number): number {
  const over = cells.filter((cell) => cell.py).map((cell) => pyWidth(cell.py) - advance(cell.ch)).sort((a, b) => a - b);
  const p90 = over.length ? over[Math.min(over.length - 1, Math.floor(over.length * 0.9))] : 0;
  return Math.round(Math.min(size * 0.55, Math.max(size * 0.1, p90 + size * 0.06)));
}

export interface LineOptions {
  /** Widest a line may be, in px. */
  width: number;
  /** A character's advance, in px. */
  advance(ch: string): number;
  /** Letter spacing after every character, in px. */
  tracking: number;
}

/** Cells that stay on one line together: a run of digits or Latin letters, or one cloze blank. */
const glued = (a: RubyCell, b: RubyCell) => (a.blank !== undefined && a.blank === b.blank) || (a.blank === undefined && b.blank === undefined && ALNUM.test(a.ch) && ALNUM.test(b.ch));

/** Width of a run of cells, letter spacing included. */
export function cellsWidth(cells: RubyCell[], o: Pick<LineOptions, 'advance' | 'tracking'>): number {
  return cells.reduce((sum, cell) => sum + o.advance(cell.ch) + o.tracking, 0);
}

/** Lines of cells at most `width` wide. A line never starts with a closing mark or ends with an opening one. */
export function rubyLines(cells: RubyCell[], o: LineOptions): RubyCell[][] {
  const tokens: RubyCell[][] = [];
  for (const cell of cells) {
    const last = tokens.at(-1);
    if (last && glued(last.at(-1)!, cell)) last.push(cell);
    else tokens.push([cell]);
  }
  const widthOf = (token: RubyCell[]) => cellsWidth(token, o);
  const lines: RubyCell[][] = [];
  let line: RubyCell[][] = [];
  let w = 0;
  for (const token of tokens) {
    const tw = widthOf(token);
    if (w + tw <= o.width || !line.length) { line.push(token); w += tw; continue; }
    const carry: RubyCell[][] = [];
    if (NO_START.has(token[0].ch)) while (line.length > 1) { carry.unshift(line.pop()!); if (!NO_START.has(carry[0][0].ch)) break; }
    while (line.length > 1 && NO_END.has(line.at(-1)!.at(-1)!.ch)) carry.unshift(line.pop()!);
    lines.push(line.flat());
    line = [...carry, token];
    w = line.reduce((sum, item) => sum + widthOf(item), 0);
  }
  if (line.length) lines.push(line.flat());
  return lines;
}

/** True when the last line holds only one or two characters (spaces and marks aside). */
export function hasWidow(lines: RubyCell[][]): boolean {
  if (lines.length < 2) return false;
  const last = lines.at(-1)!;
  if (last.some((cell) => cell.blank !== undefined)) return false;
  return last.filter((cell) => HAN.test(cell.ch) || ALNUM.test(cell.ch)).length <= 2;
}

/** rubyLines without a one- or two-character last line: the narrowest width that keeps the line count, when it ends that short. */
export function evenLines(cells: RubyCell[], o: LineOptions): RubyCell[][] {
  const lines = rubyLines(cells, o);
  if (!hasWidow(lines)) return lines;
  let lo = o.width / lines.length;
  let hi = o.width;
  for (let i = 0; i < 14; i += 1) {
    const mid = (lo + hi) / 2;
    if (rubyLines(cells, { ...o, width: mid }).length <= lines.length) hi = mid; else lo = mid;
  }
  const even = rubyLines(cells, { ...o, width: hi });
  return even.length === lines.length && !hasWidow(even) ? even : lines;
}

// ─── Names ──────────────────────────────────────────────────────────────

/** A sentence starts after an end mark, or after a colon that opens a quotation (说：“Wǒ…”). */
const SENTENCE_GAP = /[.!?。！？]|[:：]\s*["“「『‘]/u;
/** Two pinyin words of one name sit side by side: Sūn Zhōngshān. */
const NAME_GAP = /^[\s·・‧-]*$/u;
const capital = (syllable: string) => /^\p{Lu}/u.test(syllable);

/**
 * The names in a 段, as [start, end) ranges of its characters (Array.from indices). Pinyin capitalises a
 * name (Yīngguó, Sūn Zhōngshān); a capital at the start of a sentence counts when the name has two words,
 * or when the same characters are capitalised elsewhere in the 段. Empty when the pinyin doesn't line up.
 */
export function nameSpans(hanzi: string, pinyin: string): [number, number][] {
  const cells = rubyCells(hanzi, pinyin);
  if (!cells) return [];
  const py = String(pinyin).normalize('NFC');
  const spans = syllableSpans(py);
  const syllables = syllablesOf(py);
  const at = cells.flatMap((cell, i) => (cell.py ? [i] : []));
  // Pinyin words: syllables written together (Zhōngshān, Xī'ān) are one word.
  const words: { from: number; to: number; gapBefore: string }[] = [];
  spans.forEach((span, j) => {
    const gap = py.slice(j ? spans[j - 1].end : 0, span.start);
    if (j && /^['’-]?$/u.test(gap)) words.at(-1)!.to = j;
    else words.push({ from: j, to: j, gapBefore: gap });
  });
  const isCapital = (k: number) => capital(syllables[words[k].from]);
  const opensSentence = (k: number) => k === 0 || SENTENCE_GAP.test(words[k].gapBefore);
  const joined = (k: number) => k + 1 < words.length && NAME_GAP.test(words[k + 1].gapBefore);
  const name = words.map((_, k) => isCapital(k) && (!opensSentence(k) || (joined(k) && isCapital(k + 1))));
  // A name of several words is one name (孙中山), so its parts alone (小 of 小明) don't protect 小鸟.
  const known = new Set<string>();
  for (let k = 0; k < words.length; k += 1) {
    if (!name[k]) continue;
    let end = k;
    while (joined(end) && name[end + 1]) end += 1;
    known.add(cells.slice(at[words[k].from], at[words[end].to] + 1).map((cell) => cell.ch).join(''));
    k = end;
  }
  // Every place the 段 says a known name, the start of a sentence included.
  const chars = cells.map((cell) => cell.ch);
  const out: [number, number][] = [];
  for (const value of known) {
    const len = Array.from(value).length;
    for (let i = 0; i + len <= chars.length; i += 1) {
      if (chars.slice(i, i + len).join('') === value) out.push([i, i + len]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// ─── Cloze blanks ───────────────────────────────────────────────────────

export interface Blank {
  word: string;
  /** [start, end) in the 段's characters. */
  start: number;
  end: number;
}

export interface BlankPlan {
  /** In reading order. */
  blanks: Blank[];
  /** Words that could not be blanked, and why. */
  skipped: { word: string; why: 'name' | 'missing' | 'touching' }[];
}

/**
 * Where the words of a cloze go: each word at its first place in the 段 that is not part of a name and
 * does not touch another blank. A word found only inside names is never blanked.
 */
export function placeBlanks(hanzi: string, words: string[], names: [number, number][]): BlankPlan {
  const chars = Array.from(hanzi);
  const blanks: Blank[] = [];
  const skipped: BlankPlan['skipped'] = [];
  const inName = (start: number, end: number) => names.some(([a, b]) => start < b && end > a);
  const touches = (start: number, end: number) => blanks.some((blank) => start <= blank.end && end >= blank.start);
  for (const raw of words) {
    const word = raw.trim();
    if (!word || blanks.some((blank) => blank.word === word) || skipped.some((s) => s.word === word)) continue;
    const parts = Array.from(word);
    const places: number[] = [];
    for (let i = 0; i + parts.length <= chars.length; i += 1) {
      if (parts.every((ch, k) => chars[i + k] === ch)) places.push(i);
    }
    const free = places.filter((i) => !inName(i, i + parts.length));
    const start = free.find((i) => !touches(i, i + parts.length));
    if (start !== undefined) blanks.push({ word, start, end: start + parts.length });
    else skipped.push({ word, why: !places.length ? 'missing' : !free.length ? 'name' : 'touching' });
  }
  return { blanks: blanks.sort((a, b) => a.start - b.start), skipped };
}
