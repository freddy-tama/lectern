// Shapes shared by the transcriber, the recordings store and the AI notes route.

/** One timed piece of a transcript. Times are seconds from the start of the audio. */
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

/** A multiple-choice question made from a lecture. */
export interface LectureQuestion {
  question: string;
  /** Exactly four choices. */
  options: string[];
  /** Index of the right choice. */
  correct: number;
  explanation: string;
}

/** Class notes made from a transcript by the AI step. */
export interface LectureNotes {
  title: string;
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  questions: LectureQuestion[];
  /** When the notes were made (ms). */
  createdAt?: number;
}
