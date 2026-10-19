import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarCheck2, CalendarClock, CalendarDays, CalendarPlus, Clock, Download, MoreHorizontal, Palette, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { NotFound } from '../../app/App';
import { WEEKDAY_SHORT, isSlotTaken, slotsInWeek, sortMeetings } from '../../core/schedule/timetable';
import { COURSE_COLORS, type Course, type Lesson, db } from '../../data/db';
import { addDays, createLesson, deleteCourse, isoDate, updateCourse, weekOf, weekRange } from '../../data/repo';
import { Dialog } from '../../ui/Dialog';
import { Menu } from '../../ui/Menu';
import { useToast } from '../../ui/Toast';
import { formatRange, formatTime, plural, weekday } from '../../ui/format';
import { TimetableDialog } from '../schedule/TimetableDialog';
import { exportCalendar } from '../schedule/actions';
import { SlideView } from '../slides/SlideView';

export function CoursePage() {
  const { courseId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const data = useLiveQuery(async () => {
    const course = await db.courses.get(courseId);
    if (!course) return { course: null, lessons: [] as Lesson[], decks: [] };
    const lessons = await db.lessons.where('courseId').equals(courseId).toArray();
    const decks = (await db.decks.bulkGet(lessons.map((l) => l.deckId).filter(Boolean) as string[])).filter(Boolean);
    return { course, lessons, decks };
  }, [courseId]);
  const [extraWeeks, setExtraWeeks] = useState(0);
  const [colorOpen, setColorOpen] = useState(false);
  const [timetable, setTimetable] = useState<'edit' | 'fill' | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (params.get('edit') && data?.course) {
      titleRef.current?.focus();
      titleRef.current?.select();
      setParams({}, { replace: true });
    }
  }, [params, data?.course, setParams]);
  useEffect(() => setExtraWeeks(0), [courseId]);

  const weeks = useMemo(() => {
    if (!data?.course) return [];
    const max = Math.max(1, ...data.lessons.map((l) => l.week)) + extraWeeks;
    return Array.from({ length: max }, (_, i) => i + 1).map((n) => ({
      n,
      lessons: data.lessons.filter((l) => l.week === n).sort((a, b) => `${a.date ?? '9'}${a.time ?? ''}${a.order}`.localeCompare(`${b.date ?? '9'}${b.time ?? ''}${b.order}`)),
    }));
  }, [data, extraWeeks]);

  if (data === undefined) return <div className="page"><div className="skeleton" style={{ height: 200 }} /></div>;
  if (!data.course) return <NotFound message="This course was deleted or never existed." />;
  const course = data.course;
  const today = isoDate(new Date());
  const current = weekOf(course, new Date());
  const style = { '--course': `var(--c-${course.color})` } as React.CSSProperties;
  const deckById = new Map(data.decks.map((d) => [d!.id, d!]));

  const meetings = sortMeetings(course.meetings);

  // A new lesson takes the week's next free class time, or a free weekday when there is no timetable.
  const addLesson = async (week: number) => {
    const slot = slotsInWeek(course, week).find((s) => !isSlotTaken(course, s, data.lessons));
    let input: Partial<Lesson>;
    if (slot) {
      input = { date: slot.date, time: slot.time, durationMinutes: slot.durationMinutes };
    } else {
      const [start] = weekRange(course, week);
      const taken = new Set(data.lessons.filter((l) => l.week === week).map((l) => l.date));
      const day = [1, 3, 0, 2, 4].map((i) => isoDate(addDays(start, i))).find((d) => !taken.has(d));
      input = { date: day, time: meetings[0]?.time ?? '09:00', durationMinutes: meetings[0]?.durationMinutes };
    }
    const lesson = await createLesson(course.id, week, input);
    navigate(`/lessons/${lesson.id}?edit=1`);
  };

  const exportIcs = async () => {
    const n = await exportCalendar(course.id);
    toast.show(n ? `Saved a calendar file with ${plural(n, 'event')}` : 'No dated lessons to export yet.');
  };

  const remove = async () => {
    const undo = await deleteCourse(course.id);
    navigate('/');
    toast.show(`Deleted “${course.title}”`, { action: { label: 'Undo', run: () => { undo(); } } });
  };

  return (
    <div className="page" style={style}>
      <header className="course-hero">
        <div className="course-hero-top">
          <input
            className="input-bare eyebrow"
            style={{ color: 'var(--course)', maxWidth: 420 }}
            defaultValue={course.subject}
            key={`s-${course.id}`}
            placeholder="Subject · group"
            aria-label="Subject"
            onBlur={(e) => e.target.value !== course.subject && updateCourse(course.id, { subject: e.target.value })}
          />
          <div className="course-hero-actions">
            <Link className="btn btn-ghost btn-sm" to={`/schedule?view=week&course=${course.id}`} aria-label="View on schedule" title="View on schedule"><CalendarDays size={15} /> <span className="sched-hide-sm">Schedule</span></Link>
            <Menu align="end" trigger={(p) => <button type="button" className="icon-btn" aria-label="Course actions" {...p}><MoreHorizontal size={18} /></button>}>
              {(close) => (
                <>
                  <button type="button" className="menu-item" onClick={() => { close(); setTimetable('edit'); }}><CalendarClock size={16} /> Weekly timetable</button>
                  <button type="button" className="menu-item" disabled={!meetings.length} onClick={() => { close(); setTimetable('fill'); }}>
                    <CalendarCheck2 size={16} />
                    <span>Fill dates from timetable{!meetings.length && <span className="menu-detail">Set a timetable first</span>}</span>
                  </button>
                  <button type="button" className="menu-item" onClick={() => { close(); exportIcs(); }}><Download size={16} /> Export calendar (.ics)</button>
                  <div className="menu-sep" />
                  <button type="button" className="menu-item" onClick={() => { close(); setColorOpen(true); }}><Palette size={16} /> Colour and start date</button>
                  <div className="menu-sep" />
                  <button type="button" className="menu-item btn-danger" onClick={() => { close(); remove(); }}><Trash2 size={16} /> Delete course</button>
                </>
              )}
            </Menu>
          </div>
        </div>
        <h1>
          <input
            ref={titleRef}
            className="input-bare"
            defaultValue={course.title}
            key={`t-${course.id}`}
            aria-label="Course title"
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== course.title) updateCourse(course.id, { title: v }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
        </h1>
        <textarea
          className="input-bare muted"
          rows={2}
          style={{ resize: 'none', marginLeft: -6, maxWidth: 760 }}
          defaultValue={course.description}
          key={`d-${course.id}`}
          placeholder="What this course is about, in a sentence or two."
          aria-label="Description"
          onBlur={(e) => e.target.value !== course.description && updateCourse(course.id, { description: e.target.value })}
        />
        <div className="course-stats">
          <span><strong>{current >= 1 && current <= weeks.length ? `Week ${current}` : current < 1 ? 'Not started' : 'Finished'}</strong> of {weeks.length}</span>
          <span><strong>{data.lessons.length}</strong> {data.lessons.length === 1 ? 'lesson' : 'lessons'}</span>
          <span><strong>{data.decks.length}</strong> with slides</span>
        </div>
        <div className="course-timetable" role="group" aria-label="Weekly timetable">
          {meetings.length ? meetings.map((m, i) => (
            <button key={i} type="button" className="chip tt-chip" onClick={() => setTimetable('edit')} title="Edit the weekly timetable">
              <Clock size={13} /> {WEEKDAY_SHORT[m.weekday]} {formatTime(m.time)}{m.room && <small>· {m.room}</small>}
            </button>
          )) : (
            <button type="button" className="chip tt-add" onClick={() => setTimetable('edit')}><CalendarClock size={13} /> Set the weekly timetable</button>
          )}
        </div>
      </header>

      {weeks.map(({ n, lessons }) => {
        const [a, b] = weekRange(course, n);
        const isCurrent = n === current;
        return (
          <section key={n} className="week" aria-labelledby={`week-${n}`}>
            <div className="week-head">
              <span className="week-num" id={`week-${n}`}>Week {n}</span>
              <div className="week-title">
                <input
                  className="input-bare"
                  defaultValue={course.weekTitles?.[n] ?? ''}
                  key={`w-${course.id}-${n}`}
                  placeholder="Name this week"
                  aria-label={`Week ${n} name`}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (course.weekTitles?.[n] ?? '')) updateCourse(course.id, { weekTitles: { ...course.weekTitles, [n]: v } });
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
              </div>
              {isCurrent && <span className="chip chip-brand">This week</span>}
              <Link className="week-dates" to={`/schedule?view=week&date=${isoDate(a)}&course=${course.id}`} title="Open this week in the schedule">{formatRange(a, b)}</Link>
            </div>
            <div className="lesson-list">
              {lessons.map((l) => {
                const deck = l.deckId ? deckById.get(l.deckId) : undefined;
                const first = deck?.slides.find((s) => !s.hidden);
                return (
                  <div key={l.id} className={`lesson-row ${l.date === today ? 'is-today' : ''}`}>
                    <div className={`lesson-date ${l.date ? '' : 'none'}`}>
                      {l.date ? <><small>{weekday(l.date)}</small><strong>{Number(l.date.slice(8))}</strong></> : <strong>No date</strong>}
                    </div>
                    <div className="lesson-main">
                      <h3><Link to={`/lessons/${l.id}`}>{l.title}</Link></h3>
                      <p>{[l.time ? formatTime(l.time) : '', l.summary].filter(Boolean).join(' · ') || 'No summary yet'}</p>
                    </div>
                    <div className="lesson-side">
                      {deck && first ? (
                        <>
                          <span className="chip">{plural(deck.slides.length, 'slide')}</span>
                          <div className="lesson-thumb"><SlideView slide={first} deck={deck} framed label={`${deck.title}, first slide`} /></div>
                        </>
                      ) : (
                        <span className="chip">No slides</span>
                      )}
                    </div>
                  </div>
                );
              })}
              <button type="button" className="add-row" onClick={() => addLesson(n)}><Plus size={16} /> Add a lesson to week {n}</button>
            </div>
          </section>
        );
      })}

      <div style={{ marginTop: 28 }}>
        <button type="button" className="btn btn-secondary" onClick={() => setExtraWeeks((x) => x + 1)}><CalendarPlus size={16} /> Add week {weeks.length + 1}</button>
      </div>

      <CourseSettings course={course} open={colorOpen} onClose={() => setColorOpen(false)} />
      {timetable && <TimetableDialog course={course} lessons={data.lessons} open step={timetable} onClose={() => setTimetable(null)} />}
    </div>
  );
}

function CourseSettings({ course, open, onClose }: { course: Course; open: boolean; onClose(): void }) {
  const [color, setColor] = useState(course.color);
  const [start, setStart] = useState(course.startDate);
  useEffect(() => { setColor(course.color); setStart(course.startDate); }, [course, open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Colour and start date"
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={async () => { await updateCourse(course.id, { color, startDate: start }); onClose(); }}>Save changes</button>
      </>}
    >
      <div style={{ display: 'grid', gap: 20 }}>
        <div className="field">
          <span className="field-label">Colour</span>
          <div className="swatches">
            {COURSE_COLORS.map((c) => (
              <button key={c} type="button" className="swatch" aria-label={c} aria-pressed={c === color} style={{ '--course': `var(--c-${c})` } as React.CSSProperties} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field-label">First day of week 1</span>
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ maxWidth: 220 }} />
          <span className="field-help">Week numbers and “This week” follow from this date.</span>
        </label>
      </div>
    </Dialog>
  );
}
