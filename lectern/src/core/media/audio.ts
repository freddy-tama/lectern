// Sounds on slides: what a file is, and what to say when one won't play.

/** Largest sound file kept with a slide. */
export const SLIDE_AUDIO_MAX = 30 * 1024 * 1024;

const AUDIO_NAME = /\.(mp3|m4a|aac|wav|wma|ogg|oga|opus|flac)$/i;

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', wma: 'audio/x-ms-wma',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
};

export function isAudioName(name: string): boolean {
  return AUDIO_NAME.test(name);
}

/** The sound type a file name stands for, for files that don't say. */
export function audioMime(name: string): string {
  return MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'audio/mpeg';
}

/** What to tell someone when a sound didn't start. Empty when there is nothing to say. */
export function audioProblem(err: { name?: string; code?: number } | null | undefined): string {
  // The browser only lets sound start from a tap. Rare from our own button, but it can happen.
  if (err?.name === 'NotAllowedError') return 'Your browser stopped the sound. Tap play again.';
  // A newer tap took over from this one.
  if (err?.name === 'AbortError') return '';
  if (err?.name === 'NotSupportedError' || err?.code === 4) return 'This device can’t play this sound file.';
  if (err?.code === 2) return 'The sound couldn’t load. Check the connection and tap play again.';
  if (err?.code === 3) return 'This sound file looks damaged, so it can’t play.';
  return 'The sound couldn’t play. Tap play to try again.';
}

/** Seconds as 1:05. */
export function audioClock(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
