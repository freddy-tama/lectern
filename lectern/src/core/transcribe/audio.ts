// Audio maths for transcription: mono mixdown, resampling, quiet-point sectioning
// and WAV encoding. Pure functions over Float32Array samples.

/** The rate speech models expect. */
export const SAMPLE_RATE = 16_000;

/** Averages channels into one new mono array. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (!channels.length) return new Float32Array(0);
  const length = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(length);
  if (channels.length === 1) {
    out.set(channels[0]!.subarray(0, length));
    return out;
  }
  const scale = 1 / channels.length;
  for (const ch of channels) {
    for (let i = 0; i < length; i++) out[i] += ch[i] * scale;
  }
  return out;
}

/** Linear-interpolation resampling, used when the browser can't decode straight to 16 kHz. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || !samples.length) return samples;
  const ratio = from / to;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const t = x - j;
    const a = samples[j] ?? 0;
    const b = samples[j + 1] ?? a;
    out[i] = a + (b - a) * t;
  }
  return out;
}

/** Root-mean-square level of a range. */
export function rms(samples: Float32Array, start = 0, end = samples.length): number {
  const a = Math.max(0, start);
  const b = Math.min(samples.length, end);
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / (b - a));
}

/** RMS level of each short frame (default 100 ms). */
export function frameLevels(samples: Float32Array, rate = SAMPLE_RATE, frameSeconds = 0.1): Float32Array {
  const size = Math.max(1, Math.round(rate * frameSeconds));
  const count = Math.ceil(samples.length / size);
  const out = new Float32Array(count);
  for (let f = 0; f < count; f++) out[f] = rms(samples, f * size, (f + 1) * size);
  return out;
}

/**
 * True when a stretch has no speech worth sending to the recogniser. Conservative:
 * only near-silence counts, because recognisers invent words on silence.
 */
export function isQuiet(samples: Float32Array, rate = SAMPLE_RATE, threshold = 0.004): boolean {
  const levels = [...frameLevels(samples, rate)].sort((a, b) => a - b);
  if (!levels.length) return true;
  return levels[Math.floor(levels.length * 0.97)]! < threshold;
}

export interface Section {
  /** Sample offsets. */
  start: number;
  end: number;
}

/**
 * Cuts long audio into sections of about `targetSeconds`, each cut placed at the quietest
 * moment near the target so no word is split. Sections let a long transcription save as it
 * goes, report progress and resume. The recogniser still reads each section in 30-second
 * windows with overlap.
 */
export function planSections(samples: Float32Array, o: { rate?: number; startSeconds?: number; targetSeconds?: number; searchSeconds?: number } = {}): Section[] {
  const rate = o.rate ?? SAMPLE_RATE;
  const target = Math.round((o.targetSeconds ?? 240) * rate);
  const search = Math.round((o.searchSeconds ?? 12) * rate);
  const frame = Math.round(rate * 0.1);
  const out: Section[] = [];
  let start = Math.max(0, Math.min(samples.length, Math.round((o.startSeconds ?? 0) * rate)));
  while (start < samples.length) {
    const rest = samples.length - start;
    // Keep a short tail with the section before it.
    if (rest <= target + search * 2) {
      out.push({ start, end: samples.length });
      break;
    }
    const centre = start + target;
    let best = centre;
    let bestLevel = Infinity;
    for (let at = centre - search; at <= centre + search; at += frame) {
      const level = rms(samples, at, at + frame);
      if (level < bestLevel) {
        bestLevel = level;
        best = at + Math.floor(frame / 2);
      }
    }
    out.push({ start, end: best });
    start = best;
  }
  return out;
}

/** How many 30-second windows the recogniser reads for audio of this length (mirrors its chunking loop). */
export function windowCount(length: number, rate = SAMPLE_RATE, chunkSeconds = 30, strideSeconds = 5): number {
  const window = rate * chunkSeconds;
  const jump = window - 2 * rate * strideSeconds;
  let count = 1;
  let offset = 0;
  while (offset + window < length) {
    offset += jump;
    count++;
  }
  return count;
}

/** The liveliest stretch of `seconds` within a range: a good sample for detecting the language. */
export function loudestWindow(samples: Float32Array, o: { rate?: number; seconds?: number; fromSeconds?: number; withinSeconds?: number } = {}): Section {
  const rate = o.rate ?? SAMPLE_RATE;
  const size = Math.round((o.seconds ?? 30) * rate);
  const from = Math.max(0, Math.round((o.fromSeconds ?? 0) * rate));
  const until = Math.min(samples.length, from + Math.round((o.withinSeconds ?? 300) * rate));
  if (until - from <= size) return { start: from, end: Math.min(samples.length, from + size) };
  const step = Math.round(rate * 5);
  let best = from;
  let bestScore = -1;
  for (let at = from; at + size <= until; at += step) {
    // The median frame level rewards steady speech over one loud bang.
    const levels = [...frameLevels(samples.subarray(at, at + size), rate, 0.5)].sort((a, b) => a - b);
    const score = levels[Math.floor(levels.length / 2)] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = at;
    }
  }
  return { start: best, end: best + size };
}

/** 16-bit PCM WAV for mono samples. */
export function encodeWav(samples: Float32Array, rate = SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
