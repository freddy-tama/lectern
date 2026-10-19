import { describe, expect, it } from 'vitest';
import { layoutDay, monthWeeks, weekDates } from '../src/core/schedule/calendar';
import { buildCalendar, escapeText, foldLine, scheduleToIcs } from '../src/core/schedule/ics';
import { nextSlots, planFill, slotsInWeek } from '../src/core/schedule/timetable';
import type { Course, Lesson, Note } from '../src/data/db';

// 2026-10-05 is a Monday. Class meets Tuesday 09:00 (Lab 2) and Thursday 13:30.
const course: Course = {
  id: 'c1', title: 'Physics', subject: '', description: '', color: 'teal', startDate: '2026-10-05', weekTitles: { 1: 'Forces' },
  meetings: [{ weekday: 3, time: '13:30', durationMinutes: 50 }, { weekday: 1, time: '09:00', durationMinutes: 50, room: 'Lab 2' }],
  createdAt: 0, updatedAt: 0,
};

const lesson = (id: string, week: number, order: number, extra: Partial<Lesson> = {}): Lesson => ({
  id, courseId: 'c1', week, order, title: id, summary: '', durationMinutes: 50, createdAt: order, updatedAt: 0, ...extra,
});

describe('timetable', () => {
  it('lists a week’s meeting slots in order', () => {
    expect(slotsInWeek(course, 2).map((s) => [s.date, s.time, s.room])).toEqual([['2026-10-13', '09:00', 'Lab 2'], ['2026-10-15', '13:30', undefined]]);
  });

  it('fills undated lessons into free slots of their week, by order', () => {
    const lessons = [
      lesson('w1a', 1, 0, { date: '2026-10-06', time: '09:00' }),
      lesson('w1b', 1, 1),
      lesson('w2a', 2, 0),
      lesson('w2b', 2, 1),
      lesson('w2c', 2, 2),
    ];
    const plan = planFill(course, lessons, 'undated');
    expect(plan.changes.map((c) => [c.id, c.date, c.time])).toEqual([
      ['w1b', '2026-10-08', '13:30'],
      ['w2a', '2026-10-13', '09:00'],
      ['w2b', '2026-10-15', '13:30'],
    ]);
    expect(plan.unplaced.map((l) => l.id)).toEqual(['w2c']);
  });

  it('re-dates every lesson and skips those already in place', () => {
    const lessons = [lesson('a', 1, 0, { date: '2026-10-06', time: '09:00' }), lesson('b', 1, 1, { date: '2026-10-09', time: '10:00' })];
    const plan = planFill(course, lessons, 'all');
    expect(plan.changes.map((c) => [c.id, c.date, c.time, c.before.date])).toEqual([['b', '2026-10-08', '13:30', '2026-10-09']]);
  });

  it('suggests the next free slots from a date', () => {
    const lessons = [lesson('a', 1, 0, { date: '2026-10-08', time: '13:30' })];
    expect(nextSlots(course, '2026-10-07', 3, lessons).map((s) => `${s.date} ${s.time} w${s.week}`)).toEqual([
      '2026-10-13 09:00 w2', '2026-10-15 13:30 w2', '2026-10-20 09:00 w3',
    ]);
    expect(nextSlots({ ...course, meetings: [] }, '2026-10-07', 3)).toEqual([]);
  });
});

describe('calendar helpers', () => {
  it('builds Monday-first weeks and months', () => {
    expect(weekDates('2026-10-21')).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    const month = monthWeeks('2026-10-19');
    expect(month[0]![0]).toBe('2026-09-28');
    expect(month.at(-1)![6]).toBe('2026-11-01');
  });

  it('places overlapping events side by side', () => {
    const placed = layoutDay([{ start: 540, duration: 60 }, { start: 570, duration: 60 }, { start: 700, duration: 30 }]);
    expect(placed.map((p) => [p.col, p.cols])).toEqual([[0, 2], [1, 2], [0, 1]]);
  });
});

describe('ics export', () => {
  it('escapes text values', () => {
    expect(escapeText('a,b;c\\d\nnext')).toBe('a\\,b\\;c\\\\d\\nnext');
  });

  it('folds long lines at 75 octets without splitting characters', () => {
    const line = `DESCRIPTION:${'Café crème 📚 '.repeat(12)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const [i, part] of parts.entries()) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
      if (i > 0) expect(part.startsWith(' ')).toBe(true);
    }
    expect(folded.replace(/\r\n /g, '')).toBe(line);
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('writes lessons and dated notes with CRLF line endings', () => {
    const lessons = [lesson('l1', 1, 0, { date: '2026-10-06', time: '09:00', title: 'Forces, mass; motion' }), lesson('l2', 1, 1)];
    const notes = [{ id: 'n1', title: 'Parents’ evening', body: 'Bring reports', tags: [], date: '2026-10-07', createdAt: 0, updatedAt: 0 } as Note];
    const ics = scheduleToIcs({ courses: [course], lessons, notes, now: new Date(Date.UTC(2026, 9, 1, 8, 0, 0)) });
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '').includes('\n')).toBe(false);
    expect(ics).toContain('UID:lesson-l1@lectern\r\n');
    expect(ics).toContain('DTSTART:20261006T090000\r\nDTEND:20261006T095000\r\n');
    expect(ics).toContain('SUMMARY:Forces\\, mass\\; motion\r\n');
    expect(ics).toContain('LOCATION:Lab 2\r\n');
    expect(ics).toContain('DTSTAMP:20261001T080000Z');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261007\r\nDTEND;VALUE=DATE:20261008\r\n');
    expect(ics).not.toContain('lesson-l2');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it('ends events that run past midnight on the next day', () => {
    const ics = buildCalendar([{ uid: 'x@lectern', date: '2026-12-31', time: '23:30', durationMinutes: 90, summary: 'Late' }]);
    expect(ics).toContain('DTEND:20270101T010000');
  });
});
