// What you can make from a recording: notes, a quiz deck, and new recordings from files.

import { draftToDeck } from '../../core/deck/draft';
import type { Deck } from '../../core/deck/types';
import { registerCoreKinds } from '../../core/kinds/core-kinds';
import { paragraphs } from '../../core/transcribe/segments';
import { clock } from '../../core/transcribe/time';
import type { LectureNotes, TranscriptSegment } from '../../core/transcribe/types';
import type { Course, Lesson, Recording } from '../../data/db';
import { AUDIO_ASSET, createRecording, deleteRecording, noteFromRecording } from '../../data/recordings';
import { addDeck, saveAsset } from '../../data/repo';
import { decodeAudio, isVideo, wavBlob } from './decode';
import { cancelTranscription, isTranscribing } from './engine';

const LETTERS = 'ABCD';

/** Transcript text with a time stamp on each paragraph, for notes and the AI step. */
export function stampedTranscript(segments: TranscriptSegment[]): string {
  return paragraphs(segments).map((p) => `[${clock(p.start)}] ${p.indexes.map((i) => segments[i]!.text).join(' ')}`).join('\n\n');
}

/** Class notes as a note body, with action items as a checklist. */
export function classNotesBody(notes: LectureNotes): string {
  const parts: string[] = [];
  if (notes.summary) parts.push(`## Summary\n${notes.summary}`);
  if (notes.keyPoints.length) parts.push(`## Key points\n${notes.keyPoints.map((p) => `- ${p}`).join('\n')}`);
  if (notes.actionItems.length) parts.push(`## To do\n${notes.actionItems.map((a) => `- [ ] ${a}`).join('\n')}`);
  if (notes.questions.length) {
    parts.push(`## Check your understanding\n${notes.questions.map((q, i) => {
      const right = q.options[q.correct];
      return `${i + 1}. ${q.question}\n   Answer: ${LETTERS[q.correct] ?? '?'}) ${right ?? ''}${q.explanation ? ` — ${q.explanation}` : ''}`;
    }).join('\n')}`);
  }
  return parts.join('\n\n');
}

export async function saveClassNotesAsNote(rec: Recording, notes: LectureNotes, lesson?: Lesson) {
  return noteFromRecording(rec, { title: notes.title || rec.title, body: classNotesBody(notes), tags: ['lecture'], lesson });
}

/** Saves the transcript, or a selected passage of it, as a note. */
export async function saveTranscriptAsNote(rec: Recording, lesson: Lesson | undefined, selection?: { text: string; at?: number }) {
  if (selection?.text.trim()) {
    const from = selection.at !== undefined ? ` at ${clock(selection.at)}` : '';
    return noteFromRecording(rec, {
      title: `From “${rec.title}”`,
      body: `> ${selection.text.trim().replace(/\s*\n\s*/g, '\n> ')}\n\nFrom the recording${from}.`,
      tags: ['transcript'],
      lesson,
    });
  }
  return noteFromRecording(rec, { title: `Transcript: ${rec.title}`, body: stampedTranscript(rec.segments), tags: ['transcript'], lesson });
}

/**
 * A deck of question slides from the class notes, with key notes for the presenter.
 * It becomes the lesson's deck when the lesson has none; otherwise it stands alone.
 */
export async function makeQuizDeck(rec: Recording, notes: LectureNotes, lesson?: Lesson, course?: Course): Promise<Deck> {
  registerCoreKinds();
  const title = `Quiz: ${notes.title || rec.title}`;
  const n = notes.questions.length;
  const deck = draftToDeck({
    title,
    slides: [
      {
        kind: 'title',
        content: { title, eyebrow: lesson && course ? `Week ${lesson.week} · ${course.title}` : 'Check your understanding', subtitle: `${n} question${n === 1 ? '' : 's'} from the class`, presenter: '' },
        notes: { script: `Let’s check what we remember from ${notes.title || 'the last class'}. Answer each question on your own first, then we’ll look at the answer together.` },
      },
      ...notes.questions.map((q) => {
        const right = q.options[q.correct] ?? '';
        return {
          kind: 'question',
          content: { question: q.question, options: q.options, correct: q.correct, answer: q.explanation },
          notes: {
            script: `Read the question aloud and give everyone a moment to choose.\n\nThen reveal the answer: ${LETTERS[q.correct] ?? ''}) ${right}. ${q.explanation}`.trim(),
            keyPoints: q.explanation ? [q.explanation] : [],
            cues: ['Pause for answers'],
          },
        };
      }),
      ...(notes.keyPoints.length ? [{
        kind: 'summary',
        content: { title: 'Key points', points: notes.keyPoints.slice(0, 6) },
        notes: { script: notes.summary, keyPoints: notes.keyPoints.slice(0, 6) },
      }] : []),
    ],
  }, {
    audience: lesson ? 'teen' : 'adult',
    themeId: 'paper',
    purpose: 'lesson',
    lessonId: lesson && !lesson.deckId ? lesson.id : undefined,
  });
  await addDeck(deck);
  return deck;
}

export interface NewRecordingInput {
  title: string;
  courseId?: string;
  lessonId?: string;
  date?: string;
  durationSec?: number;
}

/**
 * Stores an uploaded file as a recording. Audio files are kept as they are; a video's sound
 * is stored as compact 16 kHz audio instead of the whole video.
 */
export async function addRecordingFile(file: File, input: NewRecordingInput): Promise<Recording> {
  let blob: Blob = file;
  let duration = input.durationSec ?? 0;
  if (isVideo(file)) {
    const decoded = await decodeAudio(file);
    blob = wavBlob(decoded.samples);
    duration = decoded.duration;
  }
  const audio = await saveAsset(blob, `${AUDIO_ASSET}${file.name}`);
  return createRecording({
    ...input,
    audio,
    mime: blob.type || file.type || 'audio/mpeg',
    size: blob.size,
    durationSec: Math.round(duration),
    source: 'upload',
    fileName: file.name,
  });
}

/** Deletes a recording, stopping its transcription first. Returns undo. */
export async function removeRecording(id: string) {
  if (isTranscribing(id)) await cancelTranscription(id);
  return deleteRecording(id);
}

/** A file extension for an audio type. */
export function audioExtension(mime: string): string {
  if (/mpeg|mp3/.test(mime)) return 'mp3';
  if (/mp4|m4a|aac/.test(mime)) return 'm4a';
  if (/wav/.test(mime)) return 'wav';
  if (/ogg|opus/.test(mime)) return 'ogg';
  if (/flac/.test(mime)) return 'flac';
  return 'webm';
}
