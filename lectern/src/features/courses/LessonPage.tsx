import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, ChevronRight, Download, MonitorPlay, MoreHorizontal, Pencil, PresentationIcon, ScrollText, Sparkles, Trash2, Unlink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { NotFound } from '../../app/App';
import { deckMinutes } from '../../core/deck/types';
import { db } from '../../data/db';
import { deleteLesson, isoDate, updateLesson } from '../../data/repo';
import { Menu } from '../../ui/Menu';
import { useToast } from '../../ui/Toast';
import { minutesLabel, plural } from '../../ui/format';
import { lessonOver } from '../notes/filters';
import { LessonTasks, ReflectCard } from '../notes/LessonNotes';
import { LinkedNotes } from '../notes/LinkedNotes';
import { SlideView } from '../slides/SlideView';
import { NewDeckDialog } from '../studio/NewDeckDialog';
import { openPresenter } from '../present/sync';
import { LessonRecordings } from '../recordings/LessonRecordings';

export function LessonPage() {
  const { lessonId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [makeOpen, setMakeOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const data = useLiveQuery(async () => {
    const lesson = await db.lessons.get(lessonId);
    if (!lesson) return { lesson: null };
    const [course, deck] = await Promise.all([db.courses.get(lesson.courseId), lesson.deckId ? db.decks.get(lesson.deckId) : undefined]);
    return { lesson, course, deck };
  }, [lessonId]);

  useEffect(() => {
    if (params.get('edit') && data?.lesson) {
      titleRef.current?.focus();
      titleRef.current?.select();
      setParams({}, { replace: true });
    }
  }, [params, data?.lesson, setParams]);

  if (data === undefined) return <div className="page"><div className="skeleton" style={{ height: 240 }} /></div>;
  if (!data.lesson) return <NotFound message="This lesson was deleted or never existed." />;
  const { lesson, course, deck } = data;
  const style = course ? ({ '--course': `var(--c-${course.color})` } as React.CSSProperties) : undefined;
  const visible = deck?.slides.filter((s) => !s.hidden) ?? [];
  const keyPoints = visible.flatMap((s) => s.notes.keyPoints).slice(0, 8);
  const checks = visible.filter((s) => s.notes.check || s.kind === 'question' || s.kind === 'recall').length;

  const save = (patch: Parameters<typeof updateLesson>[1]) => updateLesson(lesson.id, patch);
  // Before class: open tasks lead. After class: "How did it go?" leads.
  const today = isoDate(new Date());
  const past = lessonOver(lesson, today);
  const showReflect = !lesson.date || lesson.date <= today;

  return (
    <div className="page" style={style}>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        {course && <><Link to={`/courses/${course.id}`}>{course.title}</Link><ChevronRight size={14} /></>}
        <span>Week {lesson.week}{course?.weekTitles?.[lesson.week] ? ` · ${course.weekTitles[lesson.week]}` : ''}</span>
      </nav>

      <div className="lesson-layout">
        <div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <input
              ref={titleRef}
              className="input-bare lesson-title-input"
              defaultValue={lesson.title}
              key={`t-${lesson.id}`}
              aria-label="Lesson title"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== lesson.title) save({ title: v }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
            <Menu align="end" trigger={(p) => <button type="button" className="icon-btn" aria-label="Lesson actions" style={{ marginTop: 8 }} {...p}><MoreHorizontal size={18} /></button>}>
              {(close) => (
                <>
                  {deck && (
                    <button type="button" className="menu-item" onClick={async () => { close(); await save({ deckId: undefined }); await db.decks.update(deck.id, { lessonId: undefined }); toast.show('Slides unlinked. The deck is still in Decks.'); }}>
                      <Unlink size={16} /> Unlink slides
                    </button>
                  )}
                  <button type="button" className="menu-item btn-danger" onClick={async () => {
                    close();
                    const undo = await deleteLesson(lesson.id);
                    navigate(course ? `/courses/${course.id}` : '/');
                    toast.show(`Deleted “${lesson.title}”`, { action: { label: 'Undo', run: () => { undo(); } } });
                  }}><Trash2 size={16} /> Delete lesson</button>
                </>
              )}
            </Menu>
          </div>

          <div className="meta-row">
            <label className="field">
              <span className="field-label">Date</span>
              <input className="input" type="date" defaultValue={lesson.date ?? ''} key={`d-${lesson.id}-${lesson.date}`} onChange={(e) => save({ date: e.target.value || undefined })} />
            </label>
            <label className="field" style={{ minWidth: 120 }}>
              <span className="field-label">Time</span>
              <input className="input" type="time" defaultValue={lesson.time ?? ''} key={`h-${lesson.id}`} onBlur={(e) => save({ time: e.target.value || undefined })} />
            </label>
            <label className="field" style={{ minWidth: 110 }}>
              <span className="field-label">Minutes</span>
              <input className="input" type="number" min={5} max={480} step={5} defaultValue={lesson.durationMinutes ?? 45} key={`m-${lesson.id}`} onBlur={(e) => save({ durationMinutes: Number(e.target.value) || 45 })} />
            </label>
            <label className="field" style={{ minWidth: 90 }}>
              <span className="field-label">Week</span>
              <input className="input" type="number" min={1} max={60} defaultValue={lesson.week} key={`w-${lesson.id}-${lesson.week}`} onBlur={(e) => { const w = Math.max(1, Number(e.target.value) || 1); if (w !== lesson.week) save({ week: w }); }} />
            </label>
          </div>

          <label className="field" style={{ marginTop: 10 }}>
            <span className="field-label">Summary</span>
            <textarea className="textarea" rows={3} defaultValue={lesson.summary} key={`s-${lesson.id}`} placeholder="What this lesson covers and why it matters." onBlur={(e) => e.target.value !== lesson.summary && save({ summary: e.target.value })} />
          </label>

          {/* On narrow screens the side column drops below, so the lead card shows here instead. */}
          <div className="nt-narrow-only">
            {past && showReflect ? <ReflectCard lesson={lesson} prominent /> : <LessonTasks lessonId={lesson.id} upcoming />}
          </div>

          <section className="section card deck-panel" aria-labelledby="slides-title">
            <div className="deck-panel-head">
              <div>
                <h2 id="slides-title" style={{ fontSize: 18 }}>Slides</h2>
                {deck && <p className="faint" style={{ fontSize: 13 }}>{plural(visible.length, 'slide')} · about {minutesLabel(deckMinutes(deck))}{lesson.durationMinutes ? ` of ${lesson.durationMinutes} planned` : ''}</p>}
              </div>
              {deck && <Link className="btn btn-secondary btn-sm" to={`/studio/${deck.id}`}><Pencil size={15} /> Edit slides</Link>}
            </div>
            {deck ? (
              <>
                <div className="filmstrip" role="list" aria-label="Slides">
                  {visible.map((s, i) => (
                    <Link key={s.id} role="listitem" to={`/studio/${deck.id}?slide=${s.id}`} aria-label={`Edit slide ${i + 1}`}>
                      <SlideView slide={s} deck={deck} number={i + 1} count={visible.length} framed />
                    </Link>
                  ))}
                </div>
                <div className="mode-grid">
                  <button type="button" className="mode-card primary" onClick={() => navigate(`/present/${deck.id}`)}>
                    <span className="mode-icon"><MonitorPlay size={18} /></span><strong>Present</strong><span>Full screen, click to reveal</span>
                  </button>
                  <button type="button" className="mode-card" onClick={() => openPresenter(deck.id, navigate)}>
                    <span className="mode-icon"><PresentationIcon size={18} /></span><strong>Presenter view</strong><span>Notes, next slide and timer</span>
                  </button>
                  <button type="button" className="mode-card" onClick={() => navigate(`/prompter/${deck.id}`)}>
                    <span className="mode-icon"><ScrollText size={18} /></span><strong>Teleprompter</strong><span>Scrolling script from key notes</span>
                  </button>
                  <button type="button" className="mode-card" onClick={() => navigate(`/study/${deck.id}`)}>
                    <span className="mode-icon"><BookOpen size={18} /></span><strong>Study</strong><span>Learn from the slides and notes</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="empty" style={{ padding: 32 }}>
                <div className="empty-icon"><Sparkles size={22} /></div>
                <h3>No slides for this lesson yet</h3>
                <p>Start from your notes, a topic, or a blank deck. Every slide gets key notes you can present or study from.</p>
                <button type="button" className="btn btn-brand" onClick={() => setMakeOpen(true)}><Sparkles size={16} /> Make slides</button>
              </div>
            )}
          </section>

          <LessonRecordings lesson={lesson} past={past} />

          <section className="section card nt-lesson-notes" aria-labelledby="lesson-notes-title">
            <LinkedNotes
              lessonId={lesson.id}
              courseId={lesson.courseId}
              deckId={lesson.deckId}
              title={
                <>
                  <h2 id="lesson-notes-title">Notes</h2>
                  <span className="faint">Plans, reminders and how it went. Only you see these.</span>
                </>
              }
              placeholder="Add a note for this lesson"
              emptyText="Nothing yet. Jot down a plan, something to bring, or a task with “- [ ]”."
              max={5}
            />
          </section>
        </div>

        <aside style={{ display: 'grid', gap: 18 }}>
          {past && showReflect && <div className="nt-wide-only"><ReflectCard lesson={lesson} prominent /></div>}
          <div className={past ? undefined : 'nt-wide-only'}><LessonTasks lessonId={lesson.id} upcoming={!past} /></div>
          {deck ? (
            <>
              <div className="card takeaways">
                <h2 style={{ fontSize: 16 }}>What learners should remember</h2>
                {keyPoints.length ? (
                  <ol>{keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ol>
                ) : (
                  <p className="faint" style={{ fontSize: 14 }}>Add key points to your slides’ key notes, and they collect here.</p>
                )}
              </div>
              <div className="stat-row">
                <div className="stat"><strong className="tabular">{visible.length}</strong><span>Slides</span></div>
                <div className="stat"><strong className="tabular">{Math.round(deckMinutes(deck))}</strong><span>Minutes</span></div>
                <div className="stat"><strong className="tabular">{checks}</strong><span>Checks</span></div>
              </div>
              <Link className="btn btn-secondary" to={`/print/${deck.id}`}><Download size={16} /> Key notes handout</Link>
            </>
          ) : (
            <div className="card takeaways">
              <h2 style={{ fontSize: 16 }}>How a lesson comes together</h2>
              <ol>
                <li>Make slides from your notes or a topic.</li>
                <li>Check the key notes on each slide: the script you’ll say and the points learners keep.</li>
                <li>Present with the teleprompter, then share Study mode with learners.</li>
              </ol>
            </div>
          )}
          {!past && showReflect && <ReflectCard lesson={lesson} prominent={false} />}
        </aside>
      </div>

      <NewDeckDialog open={makeOpen} lesson={lesson} course={course} onClose={() => setMakeOpen(false)} />
    </div>
  );
}
