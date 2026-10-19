// Messages between the transcription engine (main thread) and its worker.

import type { TranscriptSegment } from '../../core/transcribe/types';

export type Device = 'webgpu' | 'wasm';

export type ToWorker =
  | {
    type: 'run';
    jobId: number;
    /** Hugging Face model id. */
    model: string;
    /** ISO 639-1 code, or null to detect it. */
    language: string | null;
    /** 16 kHz mono. */
    samples: Float32Array;
    /** Where to start, for a resumed transcription. */
    startSeconds: number;
  }
  | { type: 'cancel'; jobId: number };

export type FromWorker =
  | { type: 'model'; jobId: number; loaded: number; total: number }
  | { type: 'phase'; jobId: number; phase: 'model' | 'detecting' | 'transcribing'; device?: Device }
  | { type: 'language'; jobId: number; language: string }
  | { type: 'progress'; jobId: number; progress: number; preview: string }
  | { type: 'section'; jobId: number; segments: TranscriptSegment[]; endSeconds: number; progress: number }
  | { type: 'done'; jobId: number; language: string | null; device: Device }
  | { type: 'error'; jobId: number; message: string; cancelled?: boolean };
