import { parseIso } from '../data/repo';

/** The interface is written in English, so dates follow English conventions too. */
export const LOCALE = typeof navigator !== 'undefined' && /^en(-|$)/i.test(navigator.language) ? navigator.language : 'en-US';

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' }) : null;

export function timeAgo(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000_000], ['month', 2_592_000_000], ['week', 604_800_000], ['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000]];
  for (const [unit, size] of units) {
    if (abs >= size) return rtf ? rtf.format(Math.round(diff / size), unit) : `${Math.round(abs / size)} ${unit}s ago`;
  }
  return 'just now';
}

export function weekday(iso: string, style: 'short' | 'long' = 'short') {
  return parseIso(iso).toLocaleDateString(LOCALE, { weekday: style });
}

export function dayOfMonth(iso: string) {
  return parseIso(iso).getDate();
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return parseIso(iso).toLocaleDateString(LOCALE, opts);
}

export function formatRange(a: Date, b: Date) {
  const sameMonth = a.getMonth() === b.getMonth();
  const left = a.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' });
  const right = b.toLocaleDateString(LOCALE, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${left} – ${right}`;
}

export function formatTime(hhmm?: string) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
}

/** "Today", "Tomorrow", or a short date. */
export function relativeDay(iso: string, today: string) {
  if (iso === today) return 'Today';
  const d = parseIso(iso).getTime();
  const t = parseIso(today).getTime();
  const days = Math.round((d - t) / 86_400_000);
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return weekday(iso, 'long');
  return formatDate(iso);
}

export function minutesLabel(min: number) {
  const rounded = Math.round(min);
  if (rounded < 60) return `${rounded} min`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
