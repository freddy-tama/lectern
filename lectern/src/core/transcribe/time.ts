// Time formatting for players, transcripts and subtitle files.

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** "4:05", "1:02:03". Seconds are floored. */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function parts(seconds: number) {
  const ms = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000));
  return { h: Math.floor(ms / 3_600_000), m: Math.floor((ms % 3_600_000) / 60_000), s: Math.floor((ms % 60_000) / 1000), ms: ms % 1000 };
}

/** "00:01:02,345" for SRT files. */
export function srtTime(seconds: number): string {
  const p = parts(seconds);
  return `${pad(p.h)}:${pad(p.m)}:${pad(p.s)},${pad(p.ms, 3)}`;
}

/** "00:01:02.345" for WebVTT files. */
export function vttTime(seconds: number): string {
  const p = parts(seconds);
  return `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}.${pad(p.ms, 3)}`;
}

/** A short length: "45 s", "12 min", "1 h 5 min". */
export function lengthLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Reads "1:02:03", "62:03" or "75" (seconds). Returns null when it can't. */
export function parseClock(value: string): number | null {
  const bits = value.trim().split(':');
  if (!bits.length || bits.length > 3 || bits.some((b) => !/^\d+(\.\d+)?$/.test(b))) return null;
  return bits.map(Number).reduce((sum, n) => sum * 60 + n, 0);
}
