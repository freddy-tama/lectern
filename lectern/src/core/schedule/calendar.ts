// Calendar arithmetic for the schedule: ISO dates, minutes, grids and the
// side-by-side layout of overlapping events. Pure functions, no storage.

import { addDays, isoDate, mondayOf, parseIso } from '../../data/repo';

export const DAY_MINUTES = 24 * 60;

/** "09:30" → 570. Anything unreadable counts as midnight. */
export function toMinutes(hhmm: string | undefined): number {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h! : 0) * 60 + (Number.isFinite(m) ? m! : 0);
}

/** 570 → "09:30", kept inside one day. */
export function toHHMM(minutes: number): string {
  const clamped = Math.max(0, Math.min(DAY_MINUTES - 1, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

export function snapMinutes(minutes: number, step = 15): number {
  return Math.round(minutes / step) * step;
}

export function shiftIso(iso: string, days: number): string {
  return isoDate(addDays(parseIso(iso), days));
}

/** Whole days from a to b (b later is positive). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86_400_000);
}

/** Monday to Sunday of the week that holds the date. */
export function weekDates(anchor: string): string[] {
  const monday = mondayOf(parseIso(anchor));
  return Array.from({ length: 7 }, (_, i) => isoDate(addDays(monday, i)));
}

/** Rows of Monday-to-Sunday dates covering the month that holds the date. */
export function monthWeeks(anchor: string): string[][] {
  const d = parseIso(anchor);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const rows: string[][] = [];
  for (let monday = mondayOf(first); monday <= last; monday = addDays(monday, 7)) {
    rows.push(Array.from({ length: 7 }, (_, i) => isoDate(addDays(monday, i))));
  }
  return rows;
}

export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** 0 = Monday … 6 = Sunday, matching CourseMeeting.weekday. */
export function weekdayIndex(iso: string): number {
  return (parseIso(iso).getDay() + 6) % 7;
}

export function overlaps(aStart: number, aMinutes: number, bStart: number, bMinutes: number): boolean {
  return aStart < bStart + bMinutes && bStart < aStart + aMinutes;
}

export interface Timed {
  start: number;
  duration: number;
}

export interface Placed<T> {
  item: T;
  /** Column inside its overlap group, from 0. */
  col: number;
  /** Columns in its overlap group. */
  cols: number;
}

/**
 * Places overlapping events side by side, like a paper diary: each group of
 * events that overlap shares the width, and each event takes the first free column.
 * minVisible keeps very short events from being drawn on top of each other.
 */
export function layoutDay<T extends Timed>(items: T[], minVisible = 20): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.duration - a.duration);
  const out: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let columnsEnd: number[] = [];
  let groupEnd = -1;
  const flush = () => {
    for (const p of group) p.cols = columnsEnd.length;
    group = [];
    columnsEnd = [];
  };
  for (const item of sorted) {
    const end = item.start + Math.max(item.duration, minVisible);
    if (group.length && item.start >= groupEnd) flush();
    let col = columnsEnd.findIndex((e) => e <= item.start);
    if (col === -1) {
      col = columnsEnd.length;
      columnsEnd.push(end);
    } else {
      columnsEnd[col] = end;
    }
    const placed = { item, col, cols: 1 };
    group.push(placed);
    out.push(placed);
    groupEnd = Math.max(groupEnd, end);
  }
  flush();
  return out;
}
