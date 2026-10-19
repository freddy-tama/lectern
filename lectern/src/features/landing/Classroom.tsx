import { CalendarDays, ChevronRight, Layers, Mic, NotebookPen } from 'lucide-react';
import { useMemo } from 'react';
import { LOCALE, formatDate, formatRange, formatTime } from '../../ui/format';
import { SlideView } from '../slides/SlideView';
import { courseSample, isoDay, sampleData, weekSample } from './samples';

const FLOW = ['Course', 'Week', 'Lesson', 'Deck', 'Key notes', 'Present, study, print'];

export function Classroom() {
  const course = useMemo(() => courseSample('course_earth'), []);
  const week = useMemo(() => weekSample(), []);
  const today = isoDay(new Date());
  const decks = sampleData().decks;

  return (
    <section id="classroom" className="lp-section classroom" aria-labelledby="class-title" tabIndex={-1}>
      <div className="lp-container">
        <div className="lp-head lp-head-center" data-reveal>
          <p className="lp-eyebrow">For classrooms</p>
          <h2 id="class-title" className="lp-h2">Plan the course, <em>not just the class.</em></h2>
          <p className="lp-sub">
            Lay out a course week by week, give each lesson its deck, and keep your schedule and class notes beside
            them. Open a lesson and everything for it is there.
          </p>
          <ol className="flow" aria-label="How it connects">
            {FLOW.map((f, i) => (
              <li key={f}>
                <span className="flow-step">{f}</span>
                {i < FLOW.length - 1 && <ChevronRight size={14} className="flow-arrow" aria-hidden />}
              </li>
            ))}
          </ol>
        </div>

        <div className="bento">
          {course && (
            <article className="bento-card bento-course" data-reveal style={{ '--course': `var(--c-${course.course.color})` } as React.CSSProperties}>
              <header className="bento-head">
                <span className="bento-icon"><Layers size={16} aria-hidden /></span>
                <div>
                  <h3>{course.course.title}</h3>
                  <p>{course.course.subject} · {course.weeks.length} weeks</p>
                </div>
              </header>
              <ol className="cw-list">
                {course.weeks.map((w) => {
                  const start = addDays(course.course.startDate, (w.week - 1) * 7);
                  const now = today >= start && today < addDays(start, 7);
                  return (
                    <li key={w.week} className={`cw ${now ? 'is-now' : ''}`}>
                      <div className="cw-head">
                        <span className="cw-num">Week {w.week}</span>
                        {now && <span className="cw-now">This week</span>}
                      </div>
                      <p className="cw-title">{w.title}</p>
                      <ul className="cw-lessons">
                        {w.lessons.map((l) => {
                          const deck = l.deckId ? decks.find((d) => d.id === l.deckId) : undefined;
                          const first = deck?.slides.find((s) => !s.hidden);
                          return (
                            <li key={l.id} className={`cw-lesson ${deck ? 'has-deck' : ''}`}>
                              {deck && first
                                ? <span className="cw-thumb"><SlideView slide={first} deck={deck} number={1} count={deck.slides.length} label={`${deck.title} deck`} /></span>
                                : <span className="cw-thumb is-empty" aria-hidden />}
                              <span className="cw-text">
                                <span className="cw-name">{l.title}</span>
                                <span className="cw-date">{l.date ? formatDate(l.date) : 'Not scheduled'}{deck ? ' · Deck ready' : ''}</span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ol>
            </article>
          )}

          <article className="bento-card bento-week" data-reveal>
            <header className="bento-head">
              <span className="bento-icon"><CalendarDays size={16} aria-hidden /></span>
              <div>
                <h3>This week</h3>
                <p>{week.length ? formatRange(week[0].day, week[week.length - 1].day) : ''}</p>
              </div>
            </header>
            <ol className="wk-grid">
              {week.map((d) => (
                <li key={d.iso} className={`wk-day ${d.iso === today ? 'is-today' : ''}`}>
                  <div className="wk-dayhead">
                    <span className="wk-name">{d.day.toLocaleDateString(LOCALE, { weekday: 'short' })}</span>
                    <span className="wk-num">{d.day.getDate()}</span>
                  </div>
                  <ul className="wk-items">
                    {d.items.map(({ lesson, course: c }) => (
                      <li key={lesson.id} className="wk-item" style={{ '--course': `var(--c-${c?.color ?? 'slate'})` } as React.CSSProperties}>
                        <span className="wk-time">{formatTime(lesson.time)}</span>
                        <span className="wk-title">{lesson.title}</span>
                      </li>
                    ))}
                    {d.items.length === 0 && <li className="wk-free">No classes</li>}
                  </ul>
                </li>
              ))}
            </ol>
          </article>

          <article className="bento-card bento-notes" data-reveal>
            <header className="bento-head">
              <span className="bento-icon"><NotebookPen size={16} aria-hidden /></span>
              <div>
                <h3>Class notes</h3>
                <p>Filed under the lesson they belong to</p>
              </div>
            </header>
            <div className="note-mock">
              <div className="note-meta">
                <span className="note-course" style={{ '--course': 'var(--c-teal)' } as React.CSSProperties}>Earth &amp; Climate</span>
                <span>Week 3 · After class</span>
              </div>
              <p className="note-title">Weather vs. Climate</p>
              <ul className="note-list">
                <li className="is-done">Warm-up showed most groups mixed up the two</li>
                <li>Open next lesson with the 30-year rainfall example</li>
                <li>Share the climate zone map before Thursday</li>
              </ul>
            </div>
          </article>

          <article className="bento-card bento-record" data-reveal>
            <header className="bento-head">
              <span className="bento-icon"><Mic size={16} aria-hidden /></span>
              <div>
                <span className="lp-soon">Coming soon</span>
                <h3>Lecture to notes</h3>
                <p>Record a class, get the summary</p>
              </div>
            </header>
            <div className="wave" aria-hidden>
              {WAVE.map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}
            </div>
            <p className="record-copy">Turn a recorded lecture into tidy notes and key points, filed under the lesson you taught.</p>
          </article>
        </div>
      </div>
    </section>
  );
}

const WAVE = [22, 38, 30, 54, 70, 46, 62, 84, 58, 40, 66, 92, 74, 50, 36, 58, 80, 64, 42, 28, 48, 72, 88, 60, 44, 30, 52, 68, 46, 34, 24, 40];

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDay(new Date(y, (m || 1) - 1, (d || 1) + days));
}
