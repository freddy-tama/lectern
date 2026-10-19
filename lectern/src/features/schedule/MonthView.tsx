import { NotebookPen, Presentation } from 'lucide-react';
import { useMemo } from 'react';
import { monthWeeks, sameMonth } from '../../core/schedule/calendar';
import { WEEKDAY_SHORT } from '../../core/schedule/timetable';
import { formatDate, formatTime } from '../../ui/format';
import { courseVar } from './model';
import { useMediaQuery } from './Popover';
import type { ViewProps } from './WeekView';

export function MonthView({ data, anchor, today, drag, pending, activeKey, onOpenEvent, onOpenDay, onCreate, onPickWeek }: ViewProps & { onPickWeek(date: string): void }) {
  const weeks = useMemo(() => monthWeeks(anchor), [anchor]);
  const compact = useMediaQuery('(max-width: 640px)');
  const max = weeks.length > 5 ? 2 : 3;
  const target = drag.state?.target;
  const dragKey = drag.state?.ev.key;

  const cellClick = (e: React.MouseEvent<HTMLDivElement>, date: string, count: number) => {
    if (drag.consumeClick()) return;
    const el = e.currentTarget;
    if (e.target !== el && !(e.target as HTMLElement).classList.contains('mo-events')) return;
    if (compact && count) onOpenDay(date, el);
    else onCreate({ date }, el.getBoundingClientRect());
  };

  return (
    <div className="mo">
      <div className="mo-head" aria-hidden>
        {WEEKDAY_SHORT.map((d, i) => <span key={d} className={i >= 5 ? 'is-weekend' : ''}>{compact ? d.slice(0, 1) : d}</span>)}
      </div>
      <div className="mo-grid" style={{ '--rows': weeks.length } as React.CSSProperties}>
        {weeks.flat().map((d, i) => {
          const events = data.byDate.get(d) ?? [];
          const shown = compact ? events.slice(0, 4) : events.length > max ? events.slice(0, max - 1) : events;
          const more = events.length - shown.length;
          const outside = !sameMonth(d, anchor);
          const cls = [
            'mo-cell',
            d === today ? 'is-today' : '',
            outside ? 'is-outside' : '',
            i % 7 >= 5 ? 'is-weekend' : '',
            target && target.date === d ? 'is-target' : '',
            pending && pending.date === d ? 'is-pending' : '',
            d < today ? 'is-past' : '',
          ].filter(Boolean).join(' ');
          return (
            <div key={d} className={cls} data-drop="day" data-date={d} onClick={(e) => cellClick(e, d, events.length)}>
              <button
                type="button"
                className="mo-date"
                onClick={() => onPickWeek(d)}
                aria-label={`${formatDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}${events.length ? `, ${events.length} ${events.length === 1 ? 'item' : 'items'}` : ''}. Open the week`}
              >
                {Number(d.slice(8)) === 1 && !compact ? formatDate(d, { month: 'short', day: 'numeric' }) : Number(d.slice(8))}
              </button>
              {compact ? (
                <div className="mo-dots" aria-hidden>
                  {shown.map((ev) => <span key={ev.key} className={`mo-dot ${ev.kind}`} style={courseVar(ev.course)} />)}
                  {more > 0 && <span className="mo-dot-more">+</span>}
                </div>
              ) : (
                <div className="mo-events">
                  {shown.map((ev) => (
                    <button
                      key={ev.key}
                      type="button"
                      className={`mo-ev ${ev.kind} ${ev.time ? '' : 'is-allday'} ${dragKey === ev.key ? 'is-dragging' : ''} ${activeKey === ev.key ? 'is-active' : ''}`}
                      style={courseVar(ev.course)}
                      {...drag.bind(ev)}
                      onClick={(e) => { e.stopPropagation(); if (!drag.consumeClick()) onOpenEvent(ev, e.currentTarget); }}
                      aria-label={`${ev.title}${ev.time ? `, ${formatTime(ev.time)}` : ''}${ev.course ? `, ${ev.course.title}` : ''}${ev.kind === 'note' ? ', note' : ''}`}
                    >
                      {ev.kind === 'note' ? <NotebookPen size={11} /> : <span className="dot" />}
                      {ev.time && <span className="mo-ev-time">{formatTime(ev.time).replace(/:00(?=\s|$)/, '')}</span>}
                      <span className="mo-ev-title">{ev.title}</span>
                      {ev.kind === 'lesson' && ev.lesson?.deckId && <Presentation size={11} className="mo-ev-deck" aria-hidden />}
                    </button>
                  ))}
                  {more > 0 && (
                    <button type="button" className="mo-more" onClick={(e) => { e.stopPropagation(); onOpenDay(d, e.currentTarget); }}>
                      +{more} more
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
