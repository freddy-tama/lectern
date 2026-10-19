// iCalendar (RFC 5545) export: lessons and dated notes as events that any
// calendar app can import. Times are floating local times, so a 09:00 lesson
// stays at 09:00 wherever the file is opened.

import type { Course, Lesson, Note } from '../../data/db';
import { noteTitle, notePreview } from '../../data/notes';
import { DEFAULT_LESSON_MINUTES, meetingOn } from './timetable';

export interface IcsEvent {
  /** Stable across exports, so re-importing updates instead of duplicating. */
  uid: string;
  /** YYYY-MM-DD. */
  date: string;
  /** HH:MM; leave out for an all-day event. */
  time?: string;
  durationMinutes?: number;
  summary: string;
  description?: string;
  location?: string;
  categories?: string[];
  url?: string;
}

/** Escapes a TEXT value: backslash, semicolon, comma and line breaks. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

const encoder = new TextEncoder();

/** Folds a content line at 75 octets with CRLF and a space, never splitting a character. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = ch;
      bytes = size;
      // Continuation lines start with a space, which counts toward the 75.
      limit = 74;
    } else {
      current += ch;
      bytes += size;
    }
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function compactDate(date: string): string {
  return date.replace(/-/g, '');
}

/** Floating date-time after adding minutes. Computed in UTC so daylight saving never shifts it. */
function floatingAt(date: string, time: string, plusMinutes = 0): string {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const t = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, h ?? 0, (min ?? 0) + plusMinutes));
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00`;
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + 1));
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
}

function utcStamp(now: Date): string {
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

/** A complete VCALENDAR with CRLF line endings and folded lines. */
export function buildCalendar(events: IcsEvent[], options: { name?: string; now?: Date } = {}): string {
  const stamp = utcStamp(options.now ?? new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lectern//Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (options.name) lines.push(`X-WR-CALNAME:${escapeText(options.name)}`);
  for (const ev of events) {
    lines.push('BEGIN:VEVENT', `UID:${ev.uid}`, `DTSTAMP:${stamp}`);
    if (ev.time) {
      lines.push(`DTSTART:${floatingAt(ev.date, ev.time)}`, `DTEND:${floatingAt(ev.date, ev.time, ev.durationMinutes ?? DEFAULT_LESSON_MINUTES)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(ev.date)}`, `DTEND;VALUE=DATE:${nextDay(ev.date)}`);
    }
    lines.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.categories?.length) lines.push(`CATEGORIES:${ev.categories.map(escapeText).join(',')}`);
    if (ev.url) lines.push(`URL:${ev.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export interface ScheduleExport {
  courses: Course[];
  lessons: Lesson[];
  notes?: Note[];
  /** Deck titles by id, for lesson descriptions. */
  deckTitles?: Map<string, string>;
  /** Calendar name shown by calendar apps. */
  name?: string;
  /** App origin, for links back to lessons and notes. */
  origin?: string;
  now?: Date;
}

/** Turns dated lessons and notes into calendar events. Undated items are skipped. */
export function scheduleEvents({ courses, lessons, notes = [], deckTitles, origin }: Omit<ScheduleExport, 'name' | 'now'>): IcsEvent[] {
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const events: IcsEvent[] = [];
  for (const l of lessons) {
    if (!l.date) continue;
    const course = courseById.get(l.courseId);
    const meeting = course && l.time ? meetingOn(course, l.date, l.time) : undefined;
    const weekName = course?.weekTitles?.[l.week];
    const deck = l.deckId ? deckTitles?.get(l.deckId) : undefined;
    const description = [
      [course?.title, `Week ${l.week}${weekName ? `: ${weekName}` : ''}`].filter(Boolean).join(' · '),
      l.summary,
      deck ? `Slides: ${deck}` : '',
    ].filter(Boolean).join('\n\n');
    events.push({
      uid: `lesson-${l.id}@lectern`,
      date: l.date,
      time: l.time,
      durationMinutes: l.durationMinutes ?? meeting?.durationMinutes ?? DEFAULT_LESSON_MINUTES,
      summary: l.title,
      description,
      location: meeting?.room,
      categories: course ? [course.title] : undefined,
      url: origin ? `${origin}/lessons/${l.id}` : undefined,
    });
  }
  for (const n of notes) {
    if (!n.date) continue;
    const course = n.courseId ? courseById.get(n.courseId) : undefined;
    events.push({
      uid: `note-${n.id}@lectern`,
      date: n.date,
      time: n.time,
      durationMinutes: 30,
      summary: noteTitle(n),
      description: notePreview(n, 600) || undefined,
      categories: course ? [course.title] : undefined,
      url: origin ? `${origin}/notes/${n.id}` : undefined,
    });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
}

export function scheduleToIcs(input: ScheduleExport): string {
  return buildCalendar(scheduleEvents(input), { name: input.name ?? 'Lectern', now: input.now });
}
