import { CalendarCheck2, CheckSquare, MapPin, NotebookPen, Plus, Presentation } from 'lucide-react';
import { useMemo } from 'react';
import { shiftIso, toHHMM, weekDates } from '../../core/schedule/calendar';
import { parseIso } from '../../data/repo';
import { formatDate, formatRange, formatTime, relativeDay } from '../../ui/format';
import { courseWeek } from './actions';
import { type CalEvent, courseVar } from './model';
import type { ViewProps } from './WeekView';

/** "Today" and "Mon, Oct 19"; "Wednesday" and "Oct 21". */
function dayLabels(date: string, today: string): [string, string] {
  const rel = relativeDay(date, today);
  if (rel === 'Today' || rel === 'Tomorrow' || rel === 'Yesterday') return [rel, formatDate(date)];
  return [formatDate(date, { weekday: 'long' }), formatDate(date, { month: 'short', day: 'numeric' })];
}

interface DayGroup {
  date: string;
  weekLabel?: string;
  events: CalEvent[];
}

export function AgendaView({ data, anchor, today, activeKey, onOpenEvent, onCreate, span, onMore, courseFilter }: ViewProps & { span: number; onMore(): void; courseFilter?: string | null }) {
  const groups = useMemo(() => {
    const out: DayGroup[] = [];
    const thisMonday = weekDates(today)[0]!;
    const course = courseFilter ? data.courseById.get(courseFilter) : undefined;
    let lastWeek = '';
    for (let i = 0; i < span; i++) {
      const date = shiftIso(anchor, i);
      const events = data.byDate.get(date) ?? [];
      if (!events.length && date !== today) continue;
      const monday = weekDates(date)[0]!;
      let weekLabel: string | undefined;
      if (monday !== lastWeek) {
        lastWeek = monday;
        const sunday = shiftIso(monday, 6);
        const range = formatRange(parseIso(monday), parseIso(sunday));
        const named = course ? `Week ${courseWeek(course, date)}${course.weekTitles?.[courseWeek(course, date)] ? ` · ${course.weekTitles[courseWeek(course, date)]}` : ''}` : '';
        weekLabel = named || (monday === thisMonday ? `This week · ${range}` : monday === shiftIso(thisMonday, 7) ? `Next week · ${range}` : range);
      }
      out.push({ date, weekLabel, events });
    }
    return out;
  }, [data, anchor, today, span, courseFilter]);

  const total = groups.reduce((n, g) => n + g.events.length, 0);

  return (
    <div className="ag">
      {total === 0 && (
        <div className="empty ag-empty">
          <div className="empty-icon"><CalendarCheck2 size={22} /></div>
          <h3>Nothing scheduled</h3>
          <p>Lessons with a date and dated notes show up here.</p>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.date} className={`ag-day ${g.date === today ? 'is-today' : ''}`} aria-label={formatDate(g.date, { weekday: 'long', month: 'long', day: 'numeric' })}>
          {g.weekLabel && <h2 className="ag-week eyebrow">{g.weekLabel}</h2>}
          <div className="ag-day-head">
            <div className="ag-date">
              <strong>{dayLabels(g.date, today)[0]}</strong>
              <span>{dayLabels(g.date, today)[1]}</span>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Add on ${formatDate(g.date, { weekday: 'long', month: 'long', day: 'numeric' })}`}
              title="Add a lesson or note"
              onClick={(e) => onCreate({ date: g.date }, e.currentTarget.getBoundingClientRect(), e.currentTarget)}
            >
              <Plus size={16} />
            </button>
          </div>
          {g.events.length ? (
            <ul className="ag-list">
              {g.events.map((ev) => (
                <li key={ev.key}>
                  <button type="button" className={`ag-ev ${ev.kind} ${activeKey === ev.key ? 'is-active' : ''}`} style={courseVar(ev.course)} onClick={(e) => onOpenEvent(ev, e.currentTarget)}>
                    <span className="ag-time">
                      {ev.time ? <>{formatTime(ev.time)}<small>{formatTime(toHHMM(ev.start + ev.duration))}</small></> : <small>All day</small>}
                    </span>
                    <span className="ag-bar" aria-hidden />
                    <span className="ag-main">
                      <strong>{ev.kind === 'note' && <NotebookPen size={13} />}{ev.title}</strong>
                      <span className="ag-meta">
                        {[
                          ev.course?.title,
                          ev.kind === 'lesson' && ev.lesson ? `Week ${ev.lesson.week}` : ev.lesson ? ev.lesson.title : '',
                        ].filter(Boolean).join(' · ')}
                        {ev.room && <span className="ag-room"><MapPin size={12} /> {ev.room}</span>}
                      </span>
                    </span>
                    <span className="ag-side">
                      {ev.kind === 'lesson' && ev.lesson?.deckId && <span className="chip"><Presentation size={12} /> Slides</span>}
                      {ev.open > 0 && <span className="chip chip-warn"><CheckSquare size={12} /> {ev.open} to do</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ag-free faint">Nothing scheduled.</p>
          )}
        </section>
      ))}
      <div className="ag-more">
        <button type="button" className="btn btn-secondary" onClick={onMore}>Show four more weeks</button>
      </div>
    </div>
  );
}
