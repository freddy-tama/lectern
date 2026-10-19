// Schedule: lessons and dated notes on a week grid, a month calendar or an agenda list.
// The view, date and course filter live in the address: /schedule?view=week&date=2026-10-19&course=<id>

import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Inbox, List, NotebookPen, Plus, Rows3 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { shiftIso, toHHMM, weekDates } from '../../core/schedule/calendar';
import { meetingOn } from '../../core/schedule/timetable';
import { type Lesson, db } from '../../data/db';
import { isoDate, parseIso } from '../../data/repo';
import { useToast } from '../../ui/Toast';
import { useKeys, useNow } from '../../ui/hooks';
import { LOCALE, formatDate, formatRange, formatTime, plural } from '../../ui/format';
import { NewDeckDialog } from '../studio/NewDeckDialog';
import { AgendaView } from './AgendaView';
import { CreateForm, type CreateRequest } from './CreateForm';
import { DayEvents, EventDetails } from './EventDetails';
import { MonthView } from './MonthView';
import { type Anchor, type CloseReason, Popover, type RectLike, useMediaQuery } from './Popover';
import { WeekView } from './WeekView';
import { courseWeek, exportCalendar, moveEvent } from './actions';
import { type CalEvent, buildSchedule, courseVar } from './model';
import { type DragApi, useEventDrag } from './useEventDrag';

type View = 'week' | 'month' | 'agenda';
const VIEWS: { id: View; label: string; icon: typeof CalendarDays; key: string }[] = [
  { id: 'week', label: 'Week', icon: Rows3, key: 'w' },
  { id: 'month', label: 'Month', icon: CalendarDays, key: 'm' },
  { id: 'agenda', label: 'Agenda', icon: List, key: 'a' },
];

type Pop =
  | { type: 'event'; key: string; anchor: Anchor }
  | { type: 'create'; req: CreateRequest; anchor: Anchor }
  | { type: 'day'; date: string; anchor: Anchor };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default function SchedulePage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const narrow = useMediaQuery('(max-width: 640px)');
  const today = isoDate(new Date(useNow(60_000)));

  const viewParam = params.get('view');
  const view: View = viewParam === 'week' || viewParam === 'month' || viewParam === 'agenda' ? viewParam : narrow ? 'agenda' : 'week';
  const dateParam = params.get('date');
  const anchor = dateParam && ISO.test(dateParam) ? dateParam : today;
  const courseFilter = params.get('course');
  const [span, setSpan] = useState(28);

  const raw = useLiveQuery(async () => {
    const [courses, lessons, notes] = await Promise.all([db.courses.toArray(), db.lessons.toArray(), db.notes.toArray()]);
    courses.sort((a, b) => a.createdAt - b.createdAt);
    return { courses, lessons, notes };
  }, []);
  const data = useMemo(() => (raw ? buildSchedule(raw.courses, raw.lessons, raw.notes, courseFilter) : null), [raw, courseFilter]);
  const filterCourse = courseFilter ? data?.courseById.get(courseFilter) : undefined;

  const setQuery = useCallback((patch: Record<string, string | null>, replace = true) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v == null) next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace });
  }, [setParams]);

  // ─── Popovers ──────────────────────────────────────────
  const [pop, setPop] = useState<Pop | null>(null);
  const lastOutside = useRef(0);
  const closePop = useCallback((reason?: CloseReason) => {
    if (reason === 'outside') lastOutside.current = performance.now();
    setPop(null);
  }, []);
  // A click that only dismissed a popover should not open a new one.
  const justDismissed = () => performance.now() - lastOutside.current < 350;
  useEffect(() => setPop(null), [view, anchor, courseFilter]);

  const openKey = useRef('');
  const openEvent = useCallback((ev: CalEvent, el: HTMLElement) => {
    // A second click on the open event closes it.
    if (justDismissed() && openKey.current === ev.key) return;
    openKey.current = ev.key;
    setPop({ type: 'event', key: ev.key, anchor: { rect: el.getBoundingClientRect(), el } });
  }, []);
  const openDay = useCallback((date: string, el: HTMLElement) => {
    if (justDismissed()) return;
    setPop({ type: 'day', date, anchor: { rect: el.getBoundingClientRect(), el } });
  }, []);
  const openCreate = useCallback((req: CreateRequest, rect: RectLike, el?: HTMLElement | null) => {
    if (justDismissed()) return;
    setPop({ type: 'create', req, anchor: { rect, el } });
  }, []);

  const [makeFor, setMakeFor] = useState<Lesson | null>(null);

  // ─── Moving ────────────────────────────────────────────
  const move = useCallback(async (ev: CalEvent, date: string | undefined, time: string | undefined) => {
    if (ev.date === (date ?? '') && (ev.time ?? '') === (time ?? '')) return;
    try {
      const undo = await moveEvent(ev, date, time);
      const where = date ? `${formatDate(date)}${time ? `, ${formatTime(time)}` : ''}` : 'no date';
      const weekNote = ev.kind === 'lesson' && ev.course && date && ev.lesson && courseWeek(ev.course, date) !== ev.lesson.week ? ` (week ${courseWeek(ev.course, date)})` : '';
      toast.show(`Moved “${ev.title}” to ${where}${weekNote}`, { action: { label: 'Undo', run: () => { undo(); } } });
    } catch {
      toast.show('Couldn’t move that. Try again.', { tone: 'error' });
    }
  }, [toast]);

  const drag = useEventDrag((ev, target) => {
    const time = target.allDay
      ? undefined
      : target.minutes !== undefined
        ? toHHMM(target.minutes)
        : ev.time ?? (ev.kind === 'lesson' && ev.course ? meetingOn(ev.course, target.date)?.time : undefined);
    move(ev, target.date, time);
  });

  // ─── Navigation ────────────────────────────────────────
  const step = (dir: 1 | -1) => {
    let next: string;
    if (view === 'month') {
      const d = parseIso(anchor);
      next = isoDate(new Date(d.getFullYear(), d.getMonth() + dir, 1));
    } else {
      next = shiftIso(anchor, 7 * dir);
    }
    setQuery({ date: next === today ? null : next });
  };
  const goToday = () => { setSpan(28); setQuery({ date: null }); };
  const setView = (v: View) => setQuery({ view: v }, false);

  const exportIcs = async () => {
    try {
      const n = await exportCalendar(courseFilter);
      toast.show(n ? `Saved a calendar file with ${plural(n, 'event')}. Open it to add them to your calendar app.` : 'Nothing with a date to export yet.');
    } catch {
      toast.show('Couldn’t make the calendar file.', { tone: 'error' });
    }
  };

  const newItem = (el: HTMLElement) => {
    const days = view === 'week' ? weekDates(anchor) : [];
    const date = view === 'week' ? (days.includes(today) ? today : days[0]!) : view === 'month' ? (anchor.slice(0, 7) === today.slice(0, 7) ? today : anchor) : today;
    setPop({ type: 'create', req: { date, courseId: courseFilter ?? undefined }, anchor: { rect: el.getBoundingClientRect(), el } });
  };
  const newRef = useRef<HTMLButtonElement>(null);

  useKeys((e) => {
    if (pop || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 't') goToday();
    else if (k === 'n' && newRef.current) { e.preventDefault(); newItem(newRef.current); }
    else if (k === 'j') step(1);
    else if (k === 'k') step(-1);
    else {
      const v = VIEWS.find((x) => x.key === k);
      if (v) setView(v.id);
    }
  }, [pop, view, anchor, today, courseFilter]);

  if (!data) return <div className="page"><div className="skeleton" style={{ height: 480 }} /></div>;

  // ─── Header text ───────────────────────────────────────
  const days = weekDates(anchor);
  const title = view === 'month'
    ? parseIso(anchor).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })
    : view === 'week'
      ? formatRange(parseIso(days[0]!), parseIso(days[6]!))
      : anchor === today ? 'Coming up' : `From ${formatDate(anchor, { month: 'short', day: 'numeric' })}`;
  const year = view === 'week' ? days[6]!.slice(0, 4) : '';
  const filterWeek = filterCourse && view === 'week' ? courseWeek(filterCourse, days[0]!) : 0;
  const eyebrow = filterCourse
    ? `${filterCourse.title}${filterWeek && days[6]! >= filterCourse.startDate ? ` · Week ${filterWeek}${filterCourse.weekTitles?.[filterWeek] ? ` · ${filterCourse.weekTitles[filterWeek]}` : ''}` : ''}`
    : 'Schedule';
  const unit = view === 'month' ? 'month' : 'week';

  const popEvent = pop?.type === 'event' ? data.byKey.get(pop.key) : undefined;
  const viewProps = {
    data,
    anchor,
    today,
    drag,
    pending: pop?.type === 'create' ? pop.req : null,
    activeKey: popEvent?.key ?? null,
    onOpenEvent: openEvent,
    onOpenDay: openDay,
    onCreate: openCreate,
  };
  const floating = drag.state && (!drag.state.target || drag.state.target.minutes === undefined) ? drag.state : null;

  return (
    <div className="page sched-page" style={courseVar(filterCourse)}>
      <div className="page-head sched-head">
        <div>
          <p className="eyebrow sched-eyebrow">{filterCourse && <span className="dot" />}{eyebrow}</p>
          <h1 className="display">{title}{year && <span className="sched-year"> {year}</span>}</h1>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary" onClick={exportIcs} title={filterCourse ? `Export ${filterCourse.title} as an .ics file` : 'Export as an .ics file for Google, Apple or Outlook calendars'}>
            <Download size={16} /> <span className="sched-hide-sm">Export calendar</span><span className="sched-show-sm">Export</span>
          </button>
          <button ref={newRef} type="button" className="btn btn-primary" onClick={(e) => newItem(e.currentTarget)} aria-keyshortcuts="n">
            <Plus size={16} /> New
          </button>
        </div>
      </div>

      <div className="sched-bar">
        <div className="sched-nav">
          <button type="button" className="btn btn-secondary btn-sm" onClick={goToday} aria-keyshortcuts="t">Today</button>
          <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label={`Previous ${unit}`} title={`Previous ${unit}`}><ChevronLeft size={18} /></button>
          <button type="button" className="icon-btn" onClick={() => step(1)} aria-label={`Next ${unit}`} title={`Next ${unit}`}><ChevronRight size={18} /></button>
        </div>
        <div className="segmented sched-views" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)} aria-keyshortcuts={v.key} title={`${v.label} (${v.key.toUpperCase()})`}>
              <v.icon size={14} /> {v.label}
            </button>
          ))}
        </div>
        {data.courses.length > 0 && (
          <div className="sched-filters" role="group" aria-label="Show one course">
            <button type="button" className="sched-filter" aria-pressed={!courseFilter} onClick={() => setQuery({ course: null })}>All</button>
            {data.courses.map((c) => (
              <button
                key={c.id}
                type="button"
                className="sched-filter"
                aria-pressed={courseFilter === c.id}
                style={courseVar(c)}
                onClick={() => setQuery({ course: courseFilter === c.id ? null : c.id })}
              >
                <span className="dot" /> {c.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {view !== 'agenda' && data.unscheduled.length > 0 && (
        <Tray events={data.unscheduled} drag={drag} onOpen={openEvent} />
      )}

      {view === 'week' && <WeekView {...viewProps} courseFilter={courseFilter} />}
      {view === 'month' && <MonthView {...viewProps} onPickWeek={(d) => setQuery({ view: 'week', date: d === today ? null : d }, false)} />}
      {view === 'agenda' && <AgendaView {...viewProps} span={span} onMore={() => setSpan((s) => s + 28)} courseFilter={courseFilter} />}

      {view !== 'agenda' && (
        <p className="sched-tip faint">
          {narrow ? 'Press and hold to move a lesson or note.' : 'Drag to move. Click an empty slot to add a lesson or note.'}
          {view === 'week' && data.courses.some((c) => c.meetings?.length) && <> Dashed slots are usual class times with no lesson yet.</>}
        </p>
      )}

      {floating && (
        <div className="sched-drag-chip" style={{ left: floating.x, top: floating.y, ...courseVar(floating.ev.course) }} aria-hidden>
          {floating.ev.kind === 'note' ? <NotebookPen size={12} /> : <span className="dot" />}
          {floating.ev.title}
          {floating.target && <small>{formatDate(floating.target.date)}{floating.target.allDay ? ' · all day' : floating.ev.time ? ` · ${formatTime(floating.ev.time)}` : ''}</small>}
        </div>
      )}

      {pop && (
        <Popover
          anchor={pop.anchor}
          onClose={closePop}
          label={pop.type === 'create' ? 'Add to the schedule' : pop.type === 'day' ? formatDate(pop.date, { weekday: 'long', month: 'long', day: 'numeric' }) : popEvent?.title ?? 'Details'}
        >
          {pop.type === 'event' && popEvent && (
            <EventDetails
              ev={popEvent}
              data={data}
              onClose={() => closePop()}
              onMove={move}
              onMakeSlides={(ev) => { closePop(); setMakeFor(ev.lesson ?? null); }}
            />
          )}
          {pop.type === 'event' && !popEvent && <MissingEvent onClose={() => closePop()} />}
          {pop.type === 'create' && (
            <CreateForm
              key={`${pop.req.date}-${pop.req.time ?? ''}-${pop.req.courseId ?? ''}`}
              req={{ ...pop.req, courseId: pop.req.courseId ?? courseFilter ?? undefined }}
              courses={data.courses}
              lessons={data.lessons}
              onClose={() => closePop()}
            />
          )}
          {pop.type === 'day' && (
            <DayEvents
              date={pop.date}
              events={data.byDate.get(pop.date) ?? []}
              onPick={(ev) => setPop({ type: 'event', key: ev.key, anchor: { ...pop.anchor } })}
              onAdd={() => setPop({ type: 'create', req: { date: pop.date, courseId: courseFilter ?? undefined }, anchor: { ...pop.anchor } })}
              onClose={() => closePop()}
            />
          )}
        </Popover>
      )}

      <NewDeckDialog open={Boolean(makeFor)} lesson={makeFor ?? undefined} course={makeFor ? data.courseById.get(makeFor.courseId) : undefined} onClose={() => setMakeFor(null)} />
    </div>
  );
}

function MissingEvent({ onClose }: { onClose(): void }) {
  useEffect(() => { onClose(); }, [onClose]);
  return null;
}

/** Lessons without a date, ready to drag onto a day. */
function Tray({ events, drag, onOpen }: { events: CalEvent[]; drag: DragApi; onOpen(ev: CalEvent, el: HTMLElement): void }) {
  return (
    <div className="sched-tray">
      <span className="sched-tray-label"><Inbox size={14} /> Not scheduled</span>
      <div className="sched-tray-items">
        {events.map((ev) => (
          <button
            key={ev.key}
            type="button"
            className={`sched-tray-chip ${drag.state?.ev.key === ev.key ? 'is-dragging' : ''}`}
            style={courseVar(ev.course)}
            {...drag.bind(ev)}
            onClick={(e) => { if (!drag.consumeClick()) onOpen(ev, e.currentTarget); }}
          >
            <span className="dot" />
            <span>{ev.title}</span>
            {ev.lesson && <small>Week {ev.lesson.week}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}
