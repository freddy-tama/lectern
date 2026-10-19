// Speech-to-text worker. Runs Whisper with transformers.js on this device: WebGPU when
// the browser has it, WebAssembly otherwise. Audio never leaves the browser; only the
// model files are downloaded (once, then cached).
//
// Long audio is cut into sections of a few minutes at quiet moments. Each section is read
// in 30-second windows with a 5-second overlap on each side, and its segments are sent
// back as soon as it is done, so the transcript saves as it goes and can resume.

import { Tensor, WhisperTextStreamer, env, pipeline } from '@huggingface/transformers';
import { SAMPLE_RATE, isQuiet, loudestWindow, planSections, windowCount } from '../../core/transcribe/audio';
import { cleanSegments, offsetSegments } from '../../core/transcribe/segments';
import type { TranscriptSegment } from '../../core/transcribe/types';
import type { Device, FromWorker, ToWorker } from './protocol';

env.allowLocalModels = false;
env.useBrowserCache = true;
// Without cross-origin isolation (sharing needs cross-origin connections) WebAssembly runs on one thread.
const wasm = (env.backends.onnx as { wasm?: { numThreads?: number } } | undefined)?.wasm;
if (wasm && !(self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated) wasm.numThreads = 1;

const CHUNK_SECONDS = 30;
const STRIDE_SECONDS = 5;
const SECTION_SECONDS = 240;

interface AsrOutput {
  text: string;
  chunks?: { timestamp: [number | null, number | null]; text: string }[];
}

/** The parts of the transformers.js speech pipeline this worker uses. */
interface Asr {
  (audio: Float32Array, options: Record<string, unknown>): Promise<AsrOutput>;
  tokenizer: unknown;
  processor: (audio: Float32Array) => Promise<{ input_features: Tensor }>;
  model: ((inputs: Record<string, unknown>) => Promise<{ logits: Tensor }>) & {
    generation_config?: { lang_to_id?: Record<string, number>; decoder_start_token_id?: number };
  };
  dispose(): Promise<void>;
}

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (e: MessageEvent<ToWorker>) => void): void;
};

const post = (message: FromWorker) => scope.postMessage(message);

class Cancelled extends Error {}

let loaded: { key: string; asr: Asr; device: Device } | null = null;
let cancelled = new Set<number>();

const ATTEMPTS: { device: Device; dtype: 'fp32' | Record<string, 'fp32' | 'q8' | 'q4'> }[] = [
  { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
  { device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } },
  { device: 'wasm', dtype: 'fp32' },
];

async function webgpuUsable(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean } } | null> } }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter && !adapter.isFallbackAdapter && !adapter.info?.isFallbackAdapter);
  } catch {
    return false;
  }
}

/** Loads the model, trying WebGPU first and falling back to WebAssembly. Reports download progress. */
async function load(jobId: number, model: string, avoidWebgpu = false): Promise<{ asr: Asr; device: Device }> {
  const gpu = !avoidWebgpu && (await webgpuUsable());
  const attempts = ATTEMPTS.filter((a) => a.device === 'wasm' || gpu);
  if (loaded && loaded.key.startsWith(`${model}|`) && attempts.some((a) => a.device === loaded!.device)) return loaded;
  if (loaded) {
    await loaded.asr.dispose().catch(() => {});
    loaded = null;
  }
  const files = new Map<string, { loaded: number; total: number }>();
  let last = 0;
  const progress_callback = (info: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (info.status !== 'progress' || !info.file) return;
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
    const now = Date.now();
    if (now - last < 120) return;
    last = now;
    let sum = 0;
    let total = 0;
    for (const f of files.values()) { sum += f.loaded; total += f.total; }
    post({ type: 'model', jobId, loaded: sum, total });
  };
  let lastError: unknown = null;
  for (const attempt of attempts) {
    post({ type: 'phase', jobId, phase: 'model', device: attempt.device });
    try {
      const asr = (await pipeline('automatic-speech-recognition', model, {
        device: attempt.device,
        dtype: attempt.dtype,
        progress_callback,
      })) as unknown as Asr;
      loaded = { key: `${model}|${attempt.device}`, asr, device: attempt.device };
      return loaded;
    } catch (error) {
      lastError = error;
      console.warn(`Speech model didn’t load on ${attempt.device}`, error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('The speech model couldn’t load.');
}

/** Asks the model which language the loudest half-minute is in. */
async function detectLanguage(asr: Asr, samples: Float32Array, fromSeconds: number): Promise<string | null> {
  try {
    const win = loudestWindow(samples, { fromSeconds, withinSeconds: 300, seconds: CHUNK_SECONDS });
    const { input_features } = await asr.processor(samples.subarray(win.start, win.end));
    const config = asr.model.generation_config;
    const ids = config?.lang_to_id;
    if (!ids) return null;
    const start = config.decoder_start_token_id ?? 50258;
    const decoder_input_ids = new Tensor('int64', BigInt64Array.from([BigInt(start)]), [1, 1]);
    const { logits } = await asr.model({ input_features, decoder_input_ids });
    const scores = logits.data as Float32Array;
    const offset = scores.length - (logits.dims.at(-1) ?? scores.length);
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const [token, id] of Object.entries(ids)) {
      const score = scores[offset + id] ?? -Infinity;
      if (score > bestScore) {
        bestScore = score;
        best = token.replace(/^<\|/, '').replace(/\|>$/, '');
      }
    }
    return best;
  } catch (error) {
    console.warn('Language detection failed; using English.', error);
    return null;
  }
}

/** Transcribes one section. Reports progress within it from the token stream. */
async function transcribeSection(
  jobId: number,
  asr: Asr,
  audio: Float32Array,
  language: string | null,
  onProgress: (fraction: number, preview: string) => void,
): Promise<TranscriptSegment[]> {
  const windows = windowCount(audio.length, SAMPLE_RATE, CHUNK_SECONDS, STRIDE_SECONDS);
  let finished = 0;
  let within = 0;
  let preview = '';
  const check = () => { if (cancelled.has(jobId)) throw new Cancelled('Stopped'); };
  const report = () => onProgress(Math.min(1, (finished + Math.min(1, within / (CHUNK_SECONDS - STRIDE_SECONDS))) / windows), preview);
  const streamer = new WhisperTextStreamer(asr.tokenizer as ConstructorParameters<typeof WhisperTextStreamer>[0], {
    skip_prompt: true,
    callback_function: (text: string) => {
      check();
      preview = `${preview}${text}`.slice(-240);
      report();
    },
    on_chunk_start: (time: number) => {
      check();
      within = time;
    },
    on_finalize: () => {
      finished += 1;
      within = 0;
      report();
    },
  });
  const out = await asr(audio, {
    ...(language ? { language } : {}),
    task: 'transcribe',
    chunk_length_s: CHUNK_SECONDS,
    stride_length_s: STRIDE_SECONDS,
    return_timestamps: true,
    streamer,
  });
  const length = audio.length / SAMPLE_RATE;
  const chunks = out.chunks ?? (out.text?.trim() ? [{ timestamp: [0, length] as [number, number], text: out.text }] : []);
  return chunks.map((c, i) => ({
    start: c.timestamp[0] ?? 0,
    end: c.timestamp[1] ?? chunks[i + 1]?.timestamp[0] ?? length,
    text: c.text,
  }));
}

async function run(msg: Extract<ToWorker, { type: 'run' }>) {
  const { jobId, model, samples } = msg;
  const total = samples.length / SAMPLE_RATE;
  let { asr, device } = await load(jobId, model);
  let language = msg.language;
  if (!language) {
    post({ type: 'phase', jobId, phase: 'detecting', device });
    language = await detectLanguage(asr, samples, msg.startSeconds);
    if (language) post({ type: 'language', jobId, language });
  }
  post({ type: 'phase', jobId, phase: 'transcribing', device });
  const sections = planSections(samples, { startSeconds: msg.startSeconds, targetSeconds: SECTION_SECONDS });
  for (const section of sections) {
    if (cancelled.has(jobId)) throw new Cancelled('Stopped');
    const audio = samples.subarray(section.start, section.end);
    const from = section.start / SAMPLE_RATE;
    const to = section.end / SAMPLE_RATE;
    let segments: TranscriptSegment[] = [];
    if (!isQuiet(audio)) {
      const onProgress = (fraction: number, preview: string) => {
        post({ type: 'progress', jobId, progress: (from + fraction * (to - from)) / total, preview });
      };
      try {
        segments = await transcribeSection(jobId, asr, audio, language, onProgress);
      } catch (error) {
        if (error instanceof Cancelled || device !== 'webgpu') throw error;
        // The GPU path failed mid-way (a lost device, an unsupported operator): retry on the CPU.
        console.warn('WebGPU transcription failed; retrying with WebAssembly.', error);
        ({ asr, device } = await load(jobId, model, true));
        post({ type: 'phase', jobId, phase: 'transcribing', device });
        segments = await transcribeSection(jobId, asr, audio, language, onProgress);
      }
    }
    post({
      type: 'section',
      jobId,
      segments: offsetSegments(cleanSegments(segments, to - from), from),
      endSeconds: to,
      progress: to / total,
    });
  }
  post({ type: 'done', jobId, language, device });
}

scope.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.jobId);
    return;
  }
  if (msg.type === 'run') {
    cancelled = new Set();
    run(msg).catch((error: unknown) => {
      const stopped = error instanceof Cancelled;
      post({
        type: 'error',
        jobId: msg.jobId,
        cancelled: stopped,
        message: stopped ? 'Stopped' : error instanceof Error ? error.message : String(error),
      });
    });
  }
});
