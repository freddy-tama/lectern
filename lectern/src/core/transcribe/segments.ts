// Transcript segments: clean-up after speech recognition, paragraphs for reading,
// lookups by time and search.

import type { TranscriptSegment } from './types';

/** Annotations the recogniser adds for non-speech, such as "[Music]" or "(applause)". */
const BRACKETED = /^\s*[[(][^\])]*[\])]\s*$/;

function normalize(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** The same short phrase four or more times in a row, with only spaces or punctuation between. */
const LOOP = /(\p{L}[^\n]{0,23}?)(?:[\s\p{P}]*\1){3,}/gu;

/**
 * Collapses a recogniser loop ("Thank you. Thank you. Thank you. Thank you.") into one.
 * Three in a row is left alone: people do say "no, no, no".
 */
export function collapseRepeats(text: string): string {
  return text.replace(LOOP, '$1').replace(/\s+/g, ' ').trim();
}

/** Rough speaking time for text without a usable end time. */
function spokenSeconds(text: string) {
  const words = text.split(/\s+/).filter(Boolean).length || Math.ceil(text.length / 3);
  return Math.max(1, Math.min(15, words * 0.4));
}

/**
 * Tidies recogniser output: trims text, drops empty pieces and non-speech annotations,
 * repairs missing or backwards end times, keeps everything inside [0, duration],
 * sorts by time and folds repeats (a common recogniser loop on noise or music) into one.
 */
export function cleanSegments(input: TranscriptSegment[], duration = Infinity): TranscriptSegment[] {
  const list = input
    .map((s) => ({ start: Number(s.start), end: Number(s.end), text: collapseRepeats(String(s.text ?? '').replace(/\s+/g, ' ').trim()) }))
    .filter((s) => s.text && Number.isFinite(s.start) && !BRACKETED.test(s.text) && /[\p{L}\p{N}]/u.test(s.text))
    .sort((a, b) => a.start - b.start);
  const out: TranscriptSegment[] = [];
  list.forEach((s, i) => {
    const start = Math.max(0, Math.min(s.start, duration));
    const next = list[i + 1]?.start;
    let end = Number.isFinite(s.end) && s.end > start ? s.end : start + spokenSeconds(s.text);
    if (!(Number.isFinite(s.end) && s.end > start) && next !== undefined && next > start) end = Math.min(end, next);
    end = Math.min(end, duration);
    if (end <= start) end = start + 0.5;
    const prev = out[out.length - 1];
    if (prev && normalize(prev.text) === normalize(s.text) && start - prev.end < 3) {
      prev.end = Math.max(prev.end, end);
      return;
    }
    out.push({ start: round(start), end: round(end), text: s.text });
  });
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Moves segments by an offset in seconds, for audio cut into sections. */
export function offsetSegments(segments: TranscriptSegment[], seconds: number): TranscriptSegment[] {
  return segments.map((s) => ({ ...s, start: round(s.start + seconds), end: round(s.end + seconds) }));
}

export interface Paragraph {
  start: number;
  end: number;
  /** Indexes into the segment list. */
  indexes: number[];
}

/**
 * Groups segments into readable paragraphs: a new one starts after a pause,
 * or once a paragraph is long and the last sentence has ended.
 */
export function paragraphs(segments: TranscriptSegment[], o: { pause?: number; maxSeconds?: number; maxChars?: number } = {}): Paragraph[] {
  const pause = o.pause ?? 2;
  const maxSeconds = o.maxSeconds ?? 50;
  const maxChars = o.maxChars ?? 700;
  const out: Paragraph[] = [];
  let current: Paragraph | null = null;
  let chars = 0;
  segments.forEach((s, i) => {
    const prev = segments[i - 1];
    const sentenceEnded = prev ? /[.!?\u3002\uFF01\uFF1F…]["')\]]?$/.test(prev.text) : true;
    const breakHere = !current
      || s.start - (prev?.end ?? s.start) > pause
      || (sentenceEnded && (s.end - current.start > maxSeconds || chars > maxChars * 0.6))
      || chars > maxChars;
    if (breakHere) {
      current = { start: s.start, end: s.end, indexes: [] };
      out.push(current);
      chars = 0;
    }
    current!.indexes.push(i);
    current!.end = Math.max(current!.end, s.end);
    chars += s.text.length + 1;
  });
  return out;
}

/** Index of the segment playing at a time: the last one that has started, or -1 before the first. */
export function segmentAt(segments: TranscriptSegment[], time: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid]!.start <= time + 0.05) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export interface Match {
  segment: number;
  from: number;
  to: number;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every place the query appears, ignoring case. Offsets are in the segment's own text. */
export function findMatches(segments: TranscriptSegment[], query: string): Match[] {
  const q = query.trim();
  if (!q) return [];
  const re = new RegExp(escapeRegExp(q).replace(/\s+/g, '\\s+'), 'giu');
  const out: Match[] = [];
  segments.forEach((s, segment) => {
    for (const m of s.text.matchAll(re)) {
      if (m[0]) out.push({ segment, from: m.index ?? 0, to: (m.index ?? 0) + m[0].length });
    }
  });
  return out;
}

/** Splits text into plain and highlighted runs for the given ranges. */
export function highlightRuns(text: string, ranges: { from: number; to: number; key?: number }[]): { text: string; mark?: number }[] {
  if (!ranges.length) return [{ text }];
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const out: { text: string; mark?: number }[] = [];
  let at = 0;
  for (const r of sorted) {
    if (r.from < at) continue;
    if (r.from > at) out.push({ text: text.slice(at, r.from) });
    out.push({ text: text.slice(r.from, r.to), mark: r.key ?? 0 });
    at = r.to;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** The transcript as plain paragraphs. */
export function transcriptText(segments: TranscriptSegment[]): string {
  return paragraphs(segments).map((p) => p.indexes.map((i) => segments[i]!.text).join(' ')).join('\n\n');
}

export function wordCount(segments: TranscriptSegment[]): number {
  return segments.reduce((n, s) => n + (s.text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0), 0);
}

/** Segments that overlap a time range. */
export function segmentsBetween(segments: TranscriptSegment[], from: number, to: number): TranscriptSegment[] {
  return segments.filter((s) => s.end > from && s.start < to);
}
