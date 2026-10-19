// Reads the audio track of a file into 16 kHz mono samples for the speech model.
// Runs on the main thread: Web Audio decoding isn't available inside workers.

import { SAMPLE_RATE, encodeWav, mixToMono, resample } from '../../core/transcribe/audio';

export interface DecodedAudio {
  samples: Float32Array;
  duration: number;
}

/** Audio and video types people bring. The browser decides what it can actually read. */
export const ACCEPT = 'audio/*,video/mp4,video/quicktime,video/webm,video/ogg,.mp3,.m4a,.wav,.webm,.ogg,.oga,.opus,.aac,.flac,.mp4,.mov,.m4v';

export function isMediaFile(file: File): boolean {
  return /^(audio|video)\//.test(file.type) || /\.(mp3|m4a|wav|webm|ogg|oga|opus|aac|flac|mp4|mov|m4v)$/i.test(file.name);
}

export function isVideo(file: Blob & { name?: string }): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(file.name ?? '');
}

/** Long lectures take a while and use a lot of memory. Past this, people get a gentle warning. */
export const LONG_SECONDS = 2 * 3600;

/** Decodes and mixes down to mono at 16 kHz. Throws a readable message when the browser can't. */
export async function decodeAudio(blob: Blob): Promise<DecodedAudio> {
  let buffer: AudioBuffer;
  try {
    // decodeAudioData resamples to the context's rate, so decoding straight to 16 kHz keeps memory low.
    const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: SAMPLE_RATE });
    buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    // Some browsers refuse a 16 kHz context: decode at the device rate and resample.
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      try {
        buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      } finally {
        ctx.close().catch(() => {});
      }
    } catch {
      throw new Error('This browser couldn’t read the audio in this file. Try an mp3, m4a or wav export.');
    }
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const mono = mixToMono(channels);
  const samples = buffer.sampleRate === SAMPLE_RATE ? mono : resample(mono, buffer.sampleRate, SAMPLE_RATE);
  if (!samples.length) throw new Error('This file has no audio to transcribe.');
  return { samples, duration: samples.length / SAMPLE_RATE };
}

/** The file's length from its metadata, without decoding. Undefined when the browser can't tell. */
export function probeDuration(blob: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement(isVideo(blob) ? 'video' : 'audio');
    let done = false;
    const finish = (value?: number) => {
      if (done) return;
      done = true;
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
      resolve(value && Number.isFinite(value) && value > 0 ? value : undefined);
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () => finish(el.duration);
    el.onerror = () => finish();
    setTimeout(() => finish(), 5000);
    el.src = url;
  });
}

/** A compact 16 kHz WAV of decoded audio: stored instead of a large video file. */
export function wavBlob(samples: Float32Array): Blob {
  return new Blob([encodeWav(samples)], { type: 'audio/wav' });
}
