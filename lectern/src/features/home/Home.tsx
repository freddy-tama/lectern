import { useLiveQuery } from 'dexie-react-hooks';
import { AudioLines, BookOpen, CalendarDays, Check, Clock, MonitorPlay, NotebookPen, Pencil, Plus, ScrollText, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { type Deck, PURPOSES, deckMinutes, deckPurpose } from '../../core/deck/types';
import { type Course, type Lesson, type Note, db } from '../../data/db';
import { type ChecklistItem, checklistItems, noteTitle, openTasks, stripMarks, toggleChecklistItem, updateNote } from '../../data/notes';
import { type Focus, shows, useProfile } from '../../data/profile';
import { addDays, createCourse, isoDate, mondayOf, parseIso, weekOf } from '../../data/repo';
import { LOCALE, formatTime, greeting, plural, relativeDay, weekday } from '../../ui/format';
import { QuickMake } from '../autodeck/QuickMake';
import { SlideView } from '../slides/SlideView';
import { NewDeckDialog } from '../studio/NewDeckDialog';
import { DeckCard } from './DeckCard';

const courseStyle = (c?: Course) => (c ? ({ '--course': `var(--c-${c.color})` } as React.CSSProperties) : undefined);

export function Home() {
  const navigate = useNavigate();
  const profile = useProfile();
  const [newDeck, setNewDeck] = useState<{ lesson?: Lesson } | null>(null);
  const data = useLiveQuery(async () => {
    const [courses, lessons, decks, notes] = await Promise.all([db.courses.toArray(), db.lessons.toArray(), db.decks.orderBy('updatedAt').reverse().toArray(), db.notes.toArray()]);
    return { courses, lessons, decks, notes };
  }, []);
  const today = isoDate(new Date());
  const view = useMemo(() => {
    if (!data) return null;
    const courseById = new Map(data.courses.map((c) => [c.id, c]));
    const deckById = new Map(data.decks.map((d) => [d.id, d]));
    const dated = data.lessons.filter((l) => l.date).sort((a, b) => `${a.date}${a.time ?? ''}`.localeCompare(`${b.date}${b.time ?? ''}`));
    const next = dated.find((l) => l.date! >= today) ?? null;
    const monday = mondayOf(new Date());
    const datedNotes = data.notes.filter((n) => n.date).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
    const days = Array.from({ length: 7 }, (_, i) => {
      const iso = isoDate(addDays(monday, i));
      return { iso, lessons: dated.filter((l) => l.date === iso), notes: datedNotes.filter((n) => n.date === iso) };
    });
    const clock = new Date();
    const nowTime = `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}`;
    const todayLessons = dated.filter((l) => l.date === today);
    const laterToday = todayLessons.find((l) => l.time && l.time >= nowTime);
    const todayNotes = datedNotes.filter((n) => n.date === today);
    return { courseById, deckById, next, days, todayLessons, laterToday, todayNotes };
  }, [data, today]);

  if (!data || !view) return <div className="page"><div className="skeleton" style={{ height: 320 }} /></div>;

  const { courseById, deckById, next, days, todayLessons, laterToday, todayNotes } = view;
  const nextCourse = next ? courseById.get(next.courseId) : undefined;
  const nextDeck = next?.deckId ? deckById.get(next.deckId) : undefined;
  const now = new Date();

  const focus = profile.focus;
  const hasCourses = shows(profile, 'courses');
  const hasSchedule = shows(profile, 'schedule');
  const hasNotes = shows(profile, 'notes');
  const hasRecordings = shows(profile, 'recordings');
  const latest = data.decks[0];

  const todayLine = todayLessons.length || todayNotes.length
    ? `${[
        todayLessons.length ? plural(todayLessons.length, 'lesson') : '',
        todayNotes.length ? plural(todayNotes.length, 'note') : '',
      ].filter(Boolean).join(' and ')} today${laterToday?.time ? `, the next at ${formatTime(laterToday.time)}` : ''}.`
    : 'Nothing on the schedule today.';
  const lead: Record<Focus, string> = {
    deck: 'Drop in a document, some pictures or a recording, and Lectern makes the slides.',
    present: latest ? `Pick up “${latest.title}”, or start a new deck from your files.` : 'Start your first deck from your files or a topic.',
    teach: todayLine,
    study: 'Your recordings, notes and decks to revise, in one place.',
    all: todayLine,
  };

  const upNext = (
    <section key="up-next" aria-labelledby="up-next-title">
      <h2 id="up-next-title" className="visually-hidden">Up next</h2>
      {next ? (
        <UpNext lesson={next} course={nextCourse} deck={nextDeck} today={today} onMakeSlides={() => setNewDeck({ lesson: next })} />
      ) : (
        <div className="empty">
          <div className="empty-icon"><CalendarDays size={22} /></div>
          <h3>Nothing scheduled yet</h3>
          <p>Add a lesson with a date to a course, and it shows here when it’s next.</p>
        </div>
      )}
    </section>
  );

  const week = (
    <section key="week" className="section" aria-labelledby="week-title">
      <div className="section-head">
        <h2 id="week-title">This week</h2>
        <span className="faint" style={{ fontSize: 13, marginRight: 'auto' }}>
          {plural(days.reduce((n, d) => n + d.lessons.length, 0), 'lesson')}
          {days.some((d) => d.notes.length) ? ` · ${plural(days.reduce((n, d) => n + d.notes.length, 0), 'note')}` : ''}
        </span>
        <Link to="/schedule?view=week" className="btn btn-ghost btn-sm">Schedule</Link>
      </div>
      <div className="week-strip">
        {days.map((d) => (
          <div key={d.iso} className={`day ${d.iso === today ? 'is-today' : ''} ${d.iso < today ? 'is-past' : ''}`}>
            <Link
              className="day-head"
              to={`/schedule?view=week&date=${d.iso}`}
              aria-label={`${parseIso(d.iso).toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric' })}, open in the schedule`}
            >
              <span>{weekday(d.iso)}</span><span className="day-num">{Number(d.iso.slice(8))}</span>
            </Link>
            {d.lessons.map((l) => {
              const c = courseById.get(l.courseId);
              return (
                <Link key={l.id} to={`/lessons/${l.id}`} className="day-lesson" style={courseStyle(c)}>
                  <strong>{l.title}</strong>
                  <span>{[formatTime(l.time), c?.title].filter(Boolean).join(' · ')}</span>
                </Link>
              );
            })}
            {d.notes.slice(0, 2).map((n) => (
              <Link key={n.id} to={`/notes/${n.id}`} className="day-note" style={courseStyle(n.courseId ? courseById.get(n.courseId) : undefined)} title={noteTitle(n)}>
                <NotebookPen size={11} />
                <span>{n.time ? `${formatTime(n.time)} ` : ''}{noteTitle(n)}</span>
              </Link>
            ))}
            {d.notes.length > 2 && (
              <Link to={`/schedule?view=week&date=${d.iso}`} className="day-note">+{d.notes.length - 2} more</Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );

  const decks = (
    <section key="decks" className="section" aria-labelledby="decks-title">
      <div className="section-head">
        <h2 id="decks-title">{focus === 'study' ? 'Decks to revise' : 'Recent decks'}</h2>
        <Link to="/decks" className="btn btn-ghost btn-sm">All decks</Link>
      </div>
      {data.decks.length ? (
        <div className="deck-grid">
          {data.decks.slice(0, focus === 'deck' ? 9 : 6).map((d) => {
            const lesson = data.lessons.find((l) => l.id === d.lessonId);
            return <DeckCard key={d.id} deck={d} course={lesson ? courseById.get(lesson.courseId) : undefined} />;
          })}
        </div>
      ) : (
        <div className="empty">
          <div className="empty-icon"><ScrollText size={22} /></div>
          <h3>No decks yet</h3>
          <p>Drop in your files above, or paste an outline, and Lectern drafts the slides and speaker notes.</p>
          <button type="button" className="btn btn-primary" onClick={() => setNewDeck({})}><Plus size={16} /> New deck</button>
        </div>
      )}
    </section>
  );

  const courseList = data.courses.length > 0 && (
    <section key="courses" className="section" aria-labelledby="courses-title">
      <div className="section-head"><h2 id="courses-title">Courses</h2></div>
      <div className="course-grid">
        {data.courses.map((c) => {
          const lessons = data.lessons.filter((l) => l.courseId === c.id);
          const weeks = Math.max(1, ...lessons.map((l) => l.week));
          const current = Math.min(weeks, Math.max(0, weekOf(c, now)));
          return (
            <Link key={c.id} to={`/courses/${c.id}`} className="card card-hover course-card" style={courseStyle(c)}>
              <span className="eyebrow">{c.subject || 'Course'}</span>
              <h3>{c.title}</h3>
              <div className="deck-card-meta">
                <span>{plural(lessons.length, 'lesson')}</span><span aria-hidden>·</span>
                <span>{plural(lessons.filter((l) => l.deckId).length, 'deck')}</span><span aria-hidden>·</span>
                <span>{current >= 1 ? `Week ${current} of ${weeks}` : `Starts soon`}</span>
              </div>
              <div className="progress" aria-label={`Week ${current} of ${weeks}`}><span style={{ width: `${(Math.max(0, current) / weeks) * 100}%` }} /></div>
            </Link>
          );
        })}
      </div>
    </section>
  );

  const todo = <ToDo key="todo" notes={data.notes} lessons={data.lessons} courseById={courseById} today={today} />;
  const rehearse = latest ? <Rehearse key="rehearse" deck={latest} /> : null;
  const recordings = <RecentRecordings key="recordings" />;

  // What the home page leads with depends on what the person said they came for.
  const sections: Record<Focus, React.ReactNode[]> = {
    deck: [<QuickMake key="make" hero />, decks],
    present: [<QuickMake key="make" />, rehearse, hasSchedule && week, hasNotes && todo, decks],
    teach: [<QuickMake key="make" title="Make slides from your files" />, hasCourses && upNext, hasSchedule && week, hasNotes && todo, decks, hasCourses && courseList],
    study: [<QuickMake key="make" title="Turn notes or a lecture into a deck" detail="Drop class notes, a PDF or a recording. Lectern makes slides to revise from." />, hasRecordings && recordings, hasNotes && todo, decks, hasCourses && courseList],
    all: [<QuickMake key="make" />, hasCourses && upNext, hasSchedule && week, hasNotes && todo, decks, hasCourses && courseList],
  };

  return (
    <div className="page">
      <div className="page-head greeting">
        <div>
          <p className="eyebrow">{now.toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1 className="display">{focus === 'deck' ? 'What are we presenting?' : greeting(now)}</h1>
          <p className="home-today">
            <span>{lead[focus]}</span>
            {(focus === 'teach' || focus === 'all') && hasSchedule && <Link to="/schedule"><CalendarDays size={15} /> Open schedule</Link>}
          </p>
        </div>
        <div className="page-actions">
          {hasCourses && (focus === 'teach' || focus === 'all' || focus === 'study') && (
            <button type="button" className="btn btn-secondary" onClick={async () => { const c = await createCourse({ title: 'New course' }); navigate(`/courses/${c.id}?edit=1`); }}>
              <Plus size={16} /> New course
            </button>
          )}
          <button type="button" className={focus === 'deck' ? 'btn btn-secondary' : 'btn btn-brand'} onClick={() => setNewDeck({})}><Sparkles size={16} /> New deck</button>
        </div>
      </div>

      {sections[focus].filter(Boolean)}

      <NewDeckDialog open={Boolean(newDeck)} lesson={newDeck?.lesson} onClose={() => setNewDeck(null)} />
    </div>
  );
}

/** The latest deck, ready to rehearse or present. */
function Rehearse({ deck }: { deck: Deck }) {
  const navigate = useNavigate();
  const first = deck.slides.find((s) => !s.hidden);
  const count = deck.slides.filter((s) => !s.hidden).length;
  return (
    <section aria-labelledby="rehearse-title">
      <article className="up-next">
        <div className="up-next-body">
          <div className="up-next-meta">
            <span className="chip chip-brand">Latest deck</span>
            <span className="chip">{PURPOSES.find((p) => p.id === deckPurpose(deck))?.label}</span>
          </div>
          <h2 id="rehearse-title"><Link to={`/studio/${deck.id}`}>{deck.title}</Link></h2>
          <div className="up-next-meta faint" style={{ fontSize: 13 }}>
            <Clock size={14} /> {plural(count, 'slide')} · about {Math.max(1, Math.round(deckMinutes(deck)))} min with speaker notes
          </div>
          <div className="up-next-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate(`/present/${deck.id}`)}><MonitorPlay size={18} /> Present</button>
            <button type="button" className="btn btn-secondary btn-lg" onClick={() => navigate(`/prompter/${deck.id}`)}><ScrollText size={18} /> Rehearse with the teleprompter</button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate(`/studio/${deck.id}`)}><Pencil size={16} /> Edit</button>
          </div>
        </div>
        <div className="up-next-visual">
          {first && <SlideView slide={first} deck={deck} number={1} count={deck.slides.length} framed label={`${deck.title}, first slide`} />}
        </div>
      </article>
    </section>
  );
}

/** The newest recordings, for people who study from lectures. */
function RecentRecordings() {
  const list = useLiveQuery(() => db.recordings.orderBy('updatedAt').reverse().limit(4).toArray(), []);
  if (!list) return null;
  return (
    <section className="section" aria-labelledby="rec-title">
      <div className="section-head">
        <h2 id="rec-title">Recent recordings</h2>
        <Link to="/recordings" className="btn btn-ghost btn-sm">All recordings</Link>
      </div>
      {list.length ? (
        <div className="home-recordings">
          {list.map((r) => (
            <Link key={r.id} to={`/recordings/${r.id}`} className="card card-hover home-recording">
              <span className="home-recording-icon"><AudioLines size={17} /></span>
              <span className="home-recording-text">
                <strong>{r.title}</strong>
                <span className="faint">{[r.date ? relativeDay(r.date, isoDate(new Date())) : '', r.status === 'done' ? 'Transcript ready' : r.status === 'transcribing' ? 'Transcribing…' : 'Not transcribed yet'].filter(Boolean).join(' · ')}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty">
          <div className="empty-icon"><AudioLines size={22} /></div>
          <h3>No recordings yet</h3>
          <p>Record a class or upload one, and Lectern writes the transcript on this device.</p>
          <Link to="/recordings" className="btn btn-primary"><AudioLines size={16} /> Go to Recordings</Link>
        </div>
      )}
    </section>
  );
}

function UpNext({ lesson, course, deck, today, onMakeSlides }: { lesson: Lesson; course?: Course; deck?: Deck; today: string; onMakeSlides(): void }) {
  const navigate = useNavigate();
  const first = deck?.slides.find((s) => !s.hidden);
  return (
    <article className="up-next" style={courseStyle(course)}>
      <div className="up-next-body">
        <div className="up-next-meta">
          <span className="chip chip-brand">{relativeDay(lesson.date!, today)}{lesson.time ? ` · ${formatTime(lesson.time)}` : ''}</span>
          {course && <Link to={`/courses/${course.id}`} className="chip"><span className="dot" /> {course.title} · Week {lesson.week}</Link>}
        </div>
        <h2><Link to={`/lessons/${lesson.id}`}>{lesson.title}</Link></h2>
        {lesson.summary && <p className="muted">{lesson.summary}</p>}
        {deck ? (
          <div className="up-next-meta faint" style={{ fontSize: 13 }}>
            <Clock size={14} /> {plural(deck.slides.filter((s) => !s.hidden).length, 'slide')} with key notes
          </div>
        ) : null}
        <div className="up-next-actions">
          {deck ? (
            <>
              <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate(`/present/${deck.id}`)}><MonitorPlay size={18} /> Present</button>
              <button type="button" className="btn btn-secondary btn-lg" onClick={() => navigate(`/prompter/${deck.id}`)}><ScrollText size={18} /> Teleprompter</button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate(`/studio/${deck.id}`)}><Pencil size={16} /> Edit</button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate(`/study/${deck.id}`)}><BookOpen size={16} /> Study</button>
            </>
          ) : (
            <button type="button" className="btn btn-brand btn-lg" onClick={onMakeSlides}><Sparkles size={18} /> Make slides for this lesson</button>
          )}
        </div>
      </div>
      <div className="up-next-visual">
        {deck && first ? (
          <SlideView slide={first} deck={deck} number={1} count={deck.slides.length} framed label={`${deck.title}, first slide`} />
        ) : (
          <div className="up-next-empty">
            <div className="empty-icon"><Sparkles size={22} /></div>
            <p>No slides yet for this lesson.</p>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Open checklist items from notes that matter now: dated in the next week,
 * linked to a lesson in the next two weeks, or pinned. Ticked items stay in
 * place, crossed out, until the page is left, so a slip is easy to undo.
 */
function ToDo({ notes, lessons, courseById, today }: { notes: Note[]; lessons: Lesson[]; courseById: Map<string, Course>; today: string }) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [all, setAll] = useState(false);
  const items = useMemo(() => {
    const in7 = isoDate(addDays(parseIso(today), 7));
    const in14 = isoDate(addDays(parseIso(today), 14));
    const lessonById = new Map(lessons.map((l) => [l.id, l]));
    const due = (n: Note) => {
      if (n.date && n.date >= today && n.date <= in7) return n.date;
      const d = n.lessonId ? lessonById.get(n.lessonId)?.date : undefined;
      return d && d >= today && d <= in14 ? d : undefined;
    };
    const relevant = notes
      .map((note) => ({ note, due: due(note) }))
      .filter((x) => x.due || x.note.pinned)
      .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.note.time ?? '').localeCompare(b.note.time ?? ''));
    const open = new Set(openTasks(relevant.map((x) => x.note)).map((t) => `${t.note.id}:${t.item.line}`));
    return relevant.flatMap(({ note, due: when }) => checklistItems(note.body)
      .map((item) => ({ note, item, when, key: `${note.id}:${item.line}` }))
      .filter((x) => open.has(x.key) || ticked.has(x.key)));
  }, [notes, lessons, today, ticked]);

  if (!items.length) return null;
  const openCount = items.filter((i) => !i.item.done).length;
  const shown = all ? items : items.slice(0, 5);

  const toggle = (note: Note, item: ChecklistItem, key: string) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (item.done) next.delete(key);
      else next.add(key);
      return next;
    });
    updateNote(note.id, { body: toggleChecklistItem(note.body, item.line) });
  };

  return (
    <section className="section" aria-labelledby="todo-title">
      <div className="section-head">
        <h2 id="todo-title">To do</h2>
        <span className="faint" style={{ fontSize: 13, marginRight: 'auto' }}>{openCount ? `${openCount} open` : 'All done'}</span>
        <Link to="/notes" className="btn btn-ghost btn-sm">Notes</Link>
      </div>
      <div className="card todo">
        <ul className="todo-list">
          {shown.map(({ note, item, when, key }) => {
            const course = note.courseId ? courseById.get(note.courseId) : undefined;
            return (
              <li key={key} className="todo-item">
                <label className={`check-row ${item.done ? 'is-done' : ''}`}>
                  <input type="checkbox" checked={item.done} onChange={() => toggle(note, item, key)} />
                  <span className="check-box" aria-hidden><Check size={12} strokeWidth={3} /></span>
                  <span className="check-text">{stripMarks(item.text)}</span>
                </label>
                <span className="todo-meta" style={courseStyle(course)}>
                  {course && <span className="dot" />}
                  <Link to={`/notes/${note.id}`}>{noteTitle(note)}</Link>
                  {when && <span>· {relativeDay(when, today)}</span>}
                </span>
              </li>
            );
          })}
        </ul>
        {items.length > 5 && (
          <div className="todo-foot">
            <span className="faint">{all ? '' : `${items.length - 5} more`}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll((v) => !v)}>{all ? 'Show less' : 'Show all'}</button>
          </div>
        )}
      </div>
    </section>
  );
}
