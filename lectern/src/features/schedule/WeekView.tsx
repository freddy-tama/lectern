import { NotebookPen, Plus, Presentation } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { DAY_MINUTES, layoutDay, toHHMM, toMinutes, weekDates } from '../../core/schedule/calendar';
import { DEFAULT_LESSON_MINUTES, isSlotTaken } from '../../core/schedule/timetable';
import type { Course } from '../../data/db';
import { useNow } from '../../ui/hooks';
import { LOCALE, formatTime, weekday } from '../../ui/format';
import { courseWeek } from './actions';
import { type CalEvent, type ScheduleData, courseVar, timeRange } from './model';
import type { RectLike } from './Popover';
import type { DragApi } from './useEventDrag';
import type { CreateRequest } from './CreateForm';

const HOUR_PX = 52;
const PX_PER_MIN = HOUR_PX / 60;
const MAX_ALLDAY = 3;

export interface ViewProps {
  data: ScheduleData;
  anchor: string;
  today: string;
  drag: DragApi;
  /** The slot a create popover is open on, drawn as a placeholder. */
  pending?: CreateRequest | null;
  activeKey?: string | null;
  onOpenEvent(ev: CalEvent, el: HTMLElement): void;
  onOpenDay(date: string, el: HTMLElement): void;
  onCreate(req: CreateRequest, rect: RectLike, el?: HTMLElement | null): void;
}

interface Ghost {
  key: string;
  course: Course;
  date: string;
  time: string;
  start: number;
  duration: number;
  week: number;
  room?: string;
}

/** Weekly meeting slots with no lesson yet, from today on, while the course runs. */
function ghostSlots(data: ScheduleData, days: string[], today: string, courseFilter?: string | null): Ghost[] {
  const out: Ghost[] = [];
  for (const course of data.courses) {
    if (courseFilter && course.id !== courseFilter) continue;
    if (!course.meetings?.length) continue;
    const lessons = data.lessons.filter((l) => l.courseId === course.id);
    const lastWeek = Math.max(1, ...lessons.map((l) => l.week)) + 1;
    for (const m of course.meetings) {
      const date = days[m.weekday];
      if (!date || date < today || date < course.startDate) continue;
      const week = courseWeek(course, date);
      if (week > lastWeek) continue;
      const slot = { date, time: m.time, durationMinutes: m.durationMinutes };
      if (isSlotTaken(course, slot, lessons)) continue;
      out.push({ key: `g:${course.id}:${date}:${m.time}`, course, date, time: m.time, start: toMinutes(m.time), duration: m.durationMinutes ?? DEFAULT_LESSON_MINUTES, week, room: m.room });
    }
  }
  return out;
}

const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(LOCALE, { hour: 'numeric' });

export function WeekView({ data, anchor, today, drag, pending, activeKey, onOpenEvent, onOpenDay, onCreate, courseFilter }: ViewProps & { courseFilter?: string | null }) {
  const days = useMemo(() => weekDates(anchor), [anchor]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const now = useNow(60_000);
  const nowDate = new Date(now);
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();

  const ghosts = useMemo(() => ghostSlots(data, days, today, courseFilter), [data, days, today, courseFilter]);
  const timedByDay = useMemo(() => days.map((d) => (data.byDate.get(d) ?? []).filter((e) => e.time)), [data, days]);
  const allDayByDay = useMemo(() => days.map((d) => (data.byDate.get(d) ?? []).filter((e) => !e.time)), [data, days]);

  // 07:00–21:00, stretched to fit anything earlier or later.
  const starts = [...timedByDay.flat().map((e) => e.start), ...ghosts.map((g) => g.start)];
  const ends = [...timedByDay.flat().map((e) => e.start + e.duration), ...ghosts.map((g) => g.start + g.duration)];
  const startHour = Math.max(0, Math.min(7, ...starts.map((s) => Math.floor(s / 60))));
  const endHour = Math.min(24, Math.max(21, ...ends.map((e) => Math.ceil(e / 60))));
  const startMin = startHour * 60;
  const height = (endHour - startHour) * HOUR_PX;
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

  // Open on now, the first event of the week, or 08:00.
  const first = days[0];
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const earliest = Math.min(...timedByDay.flat().map((e) => e.start), ...ghosts.map((g) => g.start));
    const focus = days.includes(today) ? nowMin - 90 : Number.isFinite(earliest) ? earliest - 30 : 8 * 60;
    el.scrollTop = Math.max(0, (focus - startMin) * PX_PER_MIN);
    if (days.includes(today) && el.scrollWidth > el.clientWidth) {
      const col = el.querySelector<HTMLElement>('.wk-col.is-today');
      if (col) el.scrollLeft = Math.max(0, col.offsetLeft - 56);
    }
    // Only when the week changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first]);

  const target = drag.state?.target;
  const dragKey = drag.state?.ev.key;

  const columnClick = (e: React.MouseEvent<HTMLDivElement>, date: string) => {
    if (drag.consumeClick() || e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const min = Math.floor(((e.clientY - rect.top) / PX_PER_MIN + startMin) / 30) * 30;
    const clamped = Math.max(startMin, Math.min(endHour * 60 - 30, min));
    onCreate({ date, time: toHHMM(clamped) }, { left: rect.left, top: rect.top + (clamped - startMin) * PX_PER_MIN, width: rect.width, height: 30 * PX_PER_MIN });
  };

  const allDayClick = (e: React.MouseEvent<HTMLDivElement>, date: string) => {
    if (drag.consumeClick() || e.target !== e.currentTarget) return;
    onCreate({ date, kind: 'note' }, e.currentTarget.getBoundingClientRect());
  };

  return (
    <div className="wk" style={{ '--hour': `${HOUR_PX}px` } as React.CSSProperties}>
      <div className="wk-scroll" ref={scrollRef} data-scroller>
        <div className="wk-top">
          <div className="wk-gutter wk-corner" />
          {days.map((d, i) => (
            <div key={d} className={`wk-dayhead ${d === today ? 'is-today' : ''} ${i >= 5 ? 'is-weekend' : ''}`}>
              <span className="wk-dow">{weekday(d)}</span>
              <span className="wk-num">{Number(d.slice(8))}</span>
            </div>
          ))}
          <div className="wk-gutter wk-allday-label">All day</div>
          {days.map((d, i) => {
            const items = allDayByDay[i]!;
            const shown = items.length > MAX_ALLDAY ? items.slice(0, MAX_ALLDAY - 1) : items;
            const isTarget = target?.allDay && target.date === d;
            return (
              <div key={d} className={`wk-allday ${isTarget ? 'is-target' : ''} ${i >= 5 ? 'is-weekend' : ''}`} data-drop="allday" data-date={d} onClick={(e) => allDayClick(e, d)}>
                {shown.map((ev) => (
                  <button
                    key={ev.key}
                    type="button"
                    className={`wk-chip ${ev.kind} ${dragKey === ev.key ? 'is-dragging' : ''} ${activeKey === ev.key ? 'is-active' : ''}`}
                    style={courseVar(ev.course)}
                    {...drag.bind(ev)}
                    onClick={(e) => { if (!drag.consumeClick()) onOpenEvent(ev, e.currentTarget); }}
                    aria-label={`${ev.title}, ${ev.kind === 'note' ? 'note' : 'lesson'}, all day${ev.course ? `, ${ev.course.title}` : ''}`}
                  >
                    {ev.kind === 'note' ? <NotebookPen size={11} /> : <span className="dot" />}
                    <span>{ev.title}</span>
                  </button>
                ))}
                {items.length > shown.length && (
                  <button type="button" className="wk-more" onClick={(e) => onOpenDay(d, e.currentTarget)}>+{items.length - shown.length} more</button>
                )}
              </div>
            );
          })}
        </div>

        <div className="wk-body" style={{ height }}>
          <div className="wk-gutter wk-hours" aria-hidden>
            {hours.map((h, i) => i > 0 && <span key={h} style={{ top: i * HOUR_PX }}>{hourLabel(h)}</span>)}
          </div>
          {days.map((d, i) => {
            const isToday = d === today;
            const placed = layoutDay<{ start: number; duration: number; ev?: CalEvent; ghost?: Ghost }>([
              ...timedByDay[i]!.map((ev) => ({ start: ev.start, duration: ev.duration, ev })),
              ...ghosts.filter((g) => g.date === d).map((ghost) => ({ start: ghost.start, duration: ghost.duration, ghost })),
            ]);
            const preview = drag.state && target && target.minutes !== undefined && target.date === d ? { start: target.minutes, duration: drag.state.ev.duration } : null;
            const pend = pending && pending.date === d && pending.time ? toMinutes(pending.time) : null;
            return (
              <div
                key={d}
                className={`wk-col ${isToday ? 'is-today' : ''} ${i >= 5 ? 'is-weekend' : ''}`}
                data-drop="time"
                data-date={d}
                data-start-min={startMin}
                data-px-per-min={PX_PER_MIN}
                onClick={(e) => columnClick(e, d)}
              >
                {placed.map(({ item, col, cols }) => {
                  const top = (item.start - startMin) * PX_PER_MIN;
                  const h = Math.max(item.duration * PX_PER_MIN, 22);
                  const style = {
                    top,
                    height: h - 2,
                    left: `calc(${(col / cols) * 100}% + 3px)`,
                    width: `calc(${100 / cols}% - 6px)`,
                  };
                  if (item.ghost) {
                    const g = item.ghost;
                    return (
                      <button
                        key={g.key}
                        type="button"
                        className="wk-ghost"
                        style={{ ...style, ...courseVar(g.course) }}
                        onClick={(e) => onCreate({ date: g.date, time: g.time, courseId: g.course.id, durationMinutes: g.duration, kind: 'lesson' }, e.currentTarget.getBoundingClientRect(), e.currentTarget)}
                        aria-label={`Add a ${g.course.title} lesson, ${weekday(g.date, 'long')} ${formatTime(g.time)}`}
                        title={`Usual ${g.course.title} class${g.room ? ` · ${g.room}` : ''}`}
                      >
                        <Plus size={12} /> <span>{g.course.title}</span>
                      </button>
                    );
                  }
                  const ev = item.ev!;
                  const short = h < 44;
                  return (
                    <button
                      key={ev.key}
                      type="button"
                      className={`wk-ev ${ev.kind} ${short ? 'is-short' : ''} ${dragKey === ev.key ? 'is-dragging' : ''} ${activeKey === ev.key ? 'is-active' : ''}`}
                      style={{ ...style, ...courseVar(ev.course) }}
                      data-drag-timed="true"
                      {...drag.bind(ev)}
                      onClick={(e) => { e.stopPropagation(); if (!drag.consumeClick()) onOpenEvent(ev, e.currentTarget); }}
                      aria-label={`${ev.title}, ${timeRange(ev)}${ev.course ? `, ${ev.course.title}` : ''}${ev.kind === 'note' ? ', note' : ''}`}
                    >
                      <span className="wk-ev-title">
                        {ev.kind === 'note' && <NotebookPen size={11} />}
                        {ev.lesson?.deckId && ev.kind === 'lesson' && <Presentation size={11} aria-label="Has slides" />}
                        <span>{ev.title}</span>
                      </span>
                      <span className="wk-ev-meta">
                        {short ? formatTime(ev.time) : [timeRange(ev), ev.kind === 'lesson' ? ev.course?.title : ev.open ? `${ev.open} to do` : ''].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  );
                })}
                {pend !== null && (
                  <div className="wk-pending" style={{ top: (pend - startMin) * PX_PER_MIN, height: Math.max(30, pending?.durationMinutes ?? 30) * PX_PER_MIN - 2 }} aria-hidden>
                    <span>{formatTime(pending!.time)}</span>
                  </div>
                )}
                {preview && (
                  <div className="wk-preview" style={{ top: (preview.start - startMin) * PX_PER_MIN, height: Math.max(preview.duration * PX_PER_MIN, 22) - 2, ...courseVar(drag.state!.ev.course) }} aria-hidden>
                    <strong>{drag.state!.ev.title}</strong>
                    <span>{formatTime(toHHMM(preview.start))} – {formatTime(toHHMM(Math.min(DAY_MINUTES - 1, preview.start + preview.duration)))}</span>
                  </div>
                )}
                {isToday && nowMin >= startMin && nowMin <= endHour * 60 && (
                  <div className="wk-now" style={{ top: (nowMin - startMin) * PX_PER_MIN }} aria-hidden />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
