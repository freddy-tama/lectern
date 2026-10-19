// Transcript files: plain text, SRT and WebVTT subtitles.

import { paragraphs } from './segments';
import { clock, srtTime, vttTime } from './time';
import type { TranscriptSegment } from './types';

export type TranscriptFormat = 'txt' | 'srt' | 'vtt';

/** Readable text in paragraphs, with a "[12:03]" stamp before each one when asked. */
export function toTxt(segments: TranscriptSegment[], o: { title?: string; timestamps?: boolean } = {}): string {
  const body = paragraphs(segments)
    .map((p) => {
      const text = p.indexes.map((i) => segments[i]!.text).join(' ');
      return o.timestamps === false ? text : `[${clock(p.start)}] ${text}`;
    })
    .join('\n\n');
  return `${o.title ? `${o.title}\n\n` : ''}${body}\n`;
}

/** Subtitle cues never run longer than this, so long segments are split. */
const MAX_CUE = 7;

function cues(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.flatMap((s) => {
    const length = s.end - s.start;
    if (length <= MAX_CUE) return [s];
    const words = s.text.split(/\s+/);
    const pieces = Math.min(words.length, Math.ceil(length / MAX_CUE));
    if (pieces <= 1) return [s];
    const per = Math.ceil(words.length / pieces);
    const step = length / pieces;
    return Array.from({ length: pieces }, (_, i) => ({
      start: s.start + i * step,
      end: i === pieces - 1 ? s.end : s.start + (i + 1) * step,
      text: words.slice(i * per, (i + 1) * per).join(' '),
    })).filter((c) => c.text);
  });
}

export function toSrt(segments: TranscriptSegment[]): string {
  return cues(segments)
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}`)
    .join('\n\n') + '\n';
}

export function toVtt(segments: TranscriptSegment[]): string {
  const body = cues(segments).map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text.replace(/-->/g, '→')}`).join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

export function exportTranscript(segments: TranscriptSegment[], format: TranscriptFormat, title?: string): { text: string; mime: string; ext: string } {
  if (format === 'srt') return { text: toSrt(segments), mime: 'application/x-subrip', ext: 'srt' };
  if (format === 'vtt') return { text: toVtt(segments), mime: 'text/vtt', ext: 'vtt' };
  return { text: toTxt(segments, { title }), mime: 'text/plain', ext: 'txt' };
}

/** A file name without characters that file systems reject. */
export function fileName(title: string, ext: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'transcript';
  return `${base}.${ext}`;
}
