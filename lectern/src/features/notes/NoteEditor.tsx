// The note editor: title, light-Markdown body with autosave, links, tags, date, pin and mood.

import { ArrowLeft, CalendarDays, Eye, GraduationCap, Layers, ListTodo, MoreHorizontal, PenLine, Pin, PinOff, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { type Note, db } from '../../data/db';
import { checklistProgress, deleteNote, stripMarks, toggleChecklistItem, updateNote } from '../../data/notes';
import { isoDate } from '../../data/repo';
import { Menu } from '../../ui/Menu';
import { formatTime, relativeDay, timeAgo } from '../../ui/format';
import { linkCourse, linkDeck, linkLesson } from './filters';
import { CourseSelect, DeckSelect, LessonSelect, SlideSelect } from './LinkPickers';
import { insertTask } from './markdown';
import { MoodPicker } from './mood';
import { NoteBody } from './NoteBody';
import { RecordingLink } from './RecordingLink';
import { type NoteRefs, courseStyle } from './refs';
import { TagEditor } from './TagEditor';
import { autoGrow, handleListEnter, replaceRange } from './textarea';

type Mode = 'write' | 'read';

function readModePref(): Mode {
  try { return localStorage.getItem('lectern.noteMode') === 'write' ? 'write' : 'read'; } catch { return 'read'; }
}

function saveModePref(mode: Mode) {
  try { localStorage.setItem('lectern.noteMode', mode); } catch { /* private mode */ }
}

/** How many editors show each note. An empty note is removed once none do. */
const openEditors = new Map<string, number>();

export function isBlankNote(note: Pick<Note, 'title' | 'body'>): boolean {
  return !note.title.trim() && !note.body.split('\n').map(stripMarks).join('').trim();
}

interface NoteEditorProps {
  note: Note;
  refs: NoteRefs;
  /** A note just made: start in Write mode with the title focused. */
  fresh?: boolean;
  /** Leave the editor: Esc, Ctrl Enter or the back button. */
  onLeave(): void;
  onDeleted(undo: () => Promise<void>): void;
}

export function NoteEditor({ note, refs, fresh, onLeave, onDeleted }: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [mode, setModeState] = useState<Mode>(() => (fresh || !note.body.trim() ? 'write' : readModePref()));
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<Partial<Note>>({});
  const timer = useRef<number | undefined>(undefined);
  /** Where the caret was when the body lost focus, so the Task button inserts there. */
  const lastCaret = useRef<number | null>(null);
  /** Titles and bodies this editor wrote, so their echoes from the database are ignored. */
  const written = useRef({ title: new Set([note.title]), body: new Set([note.body]) });
  const uid = useId();
  const id = note.id;

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    if (patch.title !== undefined) written.current.title.add(patch.title);
    if (patch.body !== undefined) written.current.body.add(patch.body);
    updateNote(id, patch).then(() => setSaveState('saved'), () => setSaveState('error'));
  }, [id]);

  const queue = (patch: Partial<Note>) => {
    Object.assign(pending.current, patch);
    setSaveState('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 600);
  };

  const changeBody = (value: string) => { setBody(value); queue({ body: value }); };

  // Changes made elsewhere (a box ticked on the lesson page) show up here unless we're mid-edit.
  useEffect(() => {
    if (pending.current.body === undefined && !written.current.body.has(note.body)) {
      written.current.body.add(note.body);
      setBody(note.body);
    }
    if (pending.current.title === undefined && !written.current.title.has(note.title)) {
      written.current.title.add(note.title);
      setTitle(note.title);
    }
  }, [note.body, note.title]);

  // Save on the way out, and drop the note if it was left blank.
  useEffect(() => {
    openEditors.set(id, (openEditors.get(id) ?? 0) + 1);
    return () => {
      flush();
      openEditors.set(id, (openEditors.get(id) ?? 1) - 1);
      window.setTimeout(async () => {
        if (openEditors.get(id)) return;
        openEditors.delete(id);
        const stored = await db.notes.get(id);
        if (stored && isBlankNote(stored)) await db.notes.delete(id);
      }, 60);
    };
  }, [id, flush]);

  useEffect(() => {
    if (!fresh) return;
    const t = window.setTimeout(() => {
      const ta = bodyRef.current;
      if (!note.title && !note.body) titleRef.current?.focus();
      else if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }, 30);
    return () => window.clearTimeout(t);
    // Only when the note opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useLayoutEffect(() => { if (mode === 'write') autoGrow(bodyRef.current); }, [body, mode]);

  const setMode = (next: Mode, focus = false) => {
    flush();
    setModeState(next);
    saveModePref(next);
    if (next === 'write' && focus) requestAnimationFrame(() => { const ta = bodyRef.current; if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } });
  };

  const leave = () => {
    flush();
    if (body.trim()) { setModeState('read'); }
    (document.activeElement as HTMLElement | null)?.blur();
    onLeave();
  };

  const addTask = () => {
    const run = () => {
      const ta = bodyRef.current;
      if (!ta) return;
      const caret = document.activeElement === ta ? ta.selectionStart : Math.min(lastCaret.current ?? ta.value.length, ta.value.length);
      replaceRange(ta, insertTask(ta.value, caret), changeBody);
    };
    if (mode === 'read') { lastCaret.current = null; setModeState('write'); requestAnimationFrame(run); } else run();
  };

  const toggle = (line: number) => changeBody(toggleChecklistItem(body, line));
  const set = (patch: Partial<Note>) => updateNote(id, patch);

  const remove = async () => {
    flush();
    const undo = await deleteNote(id);
    onDeleted(undo);
  };

  const course = note.courseId ? refs.course.get(note.courseId) : undefined;
  const lesson = note.lessonId ? refs.lesson.get(note.lessonId) : undefined;
  const deck = note.deckId ? refs.deck.get(note.deckId) : undefined;
  const slide = deck && note.slideId ? deck.slides.find((s) => s.id === note.slideId) : undefined;
  const day = note.date ?? lesson?.date;
  const today = isoDate(new Date());
  const progress = checklistProgress(body);

  return (
    <article
      className="nt-editor"
      aria-label="Note"
      style={courseStyle(course)}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); leave(); }
        else if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); leave(); }
      }}
    >
      <header className="nt-ed-top">
        <button type="button" className="icon-btn nt-back" onClick={leave} aria-label="Back to notes"><ArrowLeft size={18} /></button>
        <span className={`nt-saved ${saveState}`} aria-live="polite">{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Couldn’t save' : 'Saved'}</span>
        <div className="nt-ed-actions">
          <button
            type="button"
            className="icon-btn"
            aria-pressed={Boolean(note.pinned)}
            onClick={() => set({ pinned: !note.pinned })}
            title={note.pinned ? 'Unpin' : 'Pin to the top'}
            aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
          >
            {note.pinned ? <PinOff size={17} /> : <Pin size={17} />}
          </button>
          <Menu align="end" trigger={(p) => <button type="button" className="icon-btn" aria-label="Note actions" {...p}><MoreHorizontal size={18} /></button>}>
            {(close) => (
              <>
                {lesson && <Link className="menu-item" to={`/lessons/${lesson.id}`} onClick={close}><GraduationCap size={16} /> Open the lesson</Link>}
                {deck && <Link className="menu-item" to={`/studio/${deck.id}${slide ? `?slide=${slide.id}` : ''}`} onClick={close}><Layers size={16} /> Open the deck</Link>}
                <button type="button" className="menu-item btn-danger" onClick={() => { close(); remove(); }}><Trash2 size={16} /> Delete note</button>
              </>
            )}
          </Menu>
        </div>
      </header>

      <div className="nt-ed-body">
        {(course || lesson || deck || day || note.recordingId) && (
          <nav className="nt-links" aria-label="Linked to">
            {course && (
              <Link className="nt-link" to={`/courses/${course.id}`} title="Open the course"><span className="dot" /><span className="nt-link-text">{course.title}</span></Link>
            )}
            {lesson && (
              <Link className="nt-link" to={`/lessons/${lesson.id}`} title="Open the lesson"><GraduationCap size={14} /><span className="nt-link-text">{lesson.title}</span></Link>
            )}
            {deck && (
              <Link className="nt-link" to={`/studio/${deck.id}${slide ? `?slide=${slide.id}` : ''}`} title={slide ? `Edit slide ${slide.number}: ${slide.heading}` : 'Edit the deck'}>
                <Layers size={14} /><span className="nt-link-text">{deck.title}{slide ? ` · slide ${slide.number}` : ''}</span>
              </Link>
            )}
            <RecordingLink id={note.recordingId} />
            {day && (
              <Link className="nt-link" to={`/schedule?view=week&date=${day}`} title="See this day on the schedule">
                <CalendarDays size={14} /><span className="nt-link-text">{relativeDay(day, today)}{note.date && note.time ? `, ${formatTime(note.time)}` : ''}</span>
              </Link>
            )}
          </nav>
        )}

        <input
          ref={titleRef}
          className="input-bare nt-title"
          value={title}
          placeholder="Untitled note"
          aria-label="Title"
          onChange={(e) => { setTitle(e.target.value); queue({ title: e.target.value }); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setMode('write', true); }
          }}
        />

        <div className="nt-props">
          <label className="nt-prop" htmlFor={`${uid}-course`}>
            <span className="nt-prop-label">Course</span>
            <CourseSelect id={`${uid}-course`} className="select nt-select" refs={refs} value={note.courseId} onChange={(v) => set(linkCourse(note, v, refs))} />
          </label>
          <label className="nt-prop" htmlFor={`${uid}-lesson`}>
            <span className="nt-prop-label">Lesson</span>
            <LessonSelect id={`${uid}-lesson`} className="select nt-select" refs={refs} courseId={note.courseId} value={note.lessonId} onChange={(v) => set(linkLesson(note, v, refs))} />
          </label>
          <label className="nt-prop" htmlFor={`${uid}-deck`}>
            <span className="nt-prop-label">Deck</span>
            <DeckSelect id={`${uid}-deck`} className="select nt-select" refs={refs} value={note.deckId} onChange={(v) => set(linkDeck(note, v, refs))} />
          </label>
          <label className="nt-prop" htmlFor={`${uid}-slide`}>
            <span className="nt-prop-label">Slide</span>
            <SlideSelect id={`${uid}-slide`} className="select nt-select" refs={refs} deckId={note.deckId} value={note.slideId} onChange={(v) => set({ slideId: v })} />
          </label>
          <div className="nt-prop">
            <label className="nt-prop-label" htmlFor={`${uid}-date`}>Date</label>
            <div className="nt-date">
              <input id={`${uid}-date`} className="input nt-select" type="date" value={note.date ?? ''} onChange={(e) => set(e.target.value ? { date: e.target.value } : { date: undefined, time: undefined })} />
              {note.date && (
                <>
                  <input className="input nt-select nt-time" type="time" value={note.time ?? ''} onChange={(e) => set({ time: e.target.value || undefined })} aria-label="Time (optional)" />
                  <button type="button" className="icon-btn" onClick={() => set({ date: undefined, time: undefined })} aria-label="Clear the date" title="Clear the date"><X size={15} /></button>
                </>
              )}
            </div>
          </div>
          <div className="nt-prop">
            <label className="nt-prop-label" htmlFor={`${uid}-tags`}>Tags</label>
            <TagEditor id={`${uid}-tags`} tags={note.tags} onChange={(tags) => set({ tags })} />
          </div>
        </div>

        {note.lessonId && (
          <div className="nt-mood-row">
            <span className="nt-prop-label">How did it go?</span>
            <MoodPicker
              value={note.mood}
              compact
              onChange={(mood) => set({ mood, ...(mood && !note.tags.includes('reflection') ? { tags: [...note.tags, 'reflection'] } : {}) })}
            />
          </div>
        )}

        <div className="nt-bar">
          <div className="segmented" role="group" aria-label="Body view">
            <button type="button" aria-pressed={mode === 'write'} onClick={() => setMode('write', true)}><PenLine size={14} /> Write</button>
            <button type="button" aria-pressed={mode === 'read'} onClick={() => setMode('read')}><Eye size={14} /> Read</button>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addTask} title="Add a task: - [ ]"><ListTodo size={15} /> Task</button>
          {progress.total > 0 && (
            <span className={`nt-progress ${progress.done === progress.total ? 'is-done' : ''}`} title="Tasks done">
              <span className="nt-progress-track"><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></span>
              <span className="tabular">{progress.done}/{progress.total}</span>
            </span>
          )}
        </div>

        {mode === 'write' ? (
          <textarea
            ref={bodyRef}
            className="nt-body-input"
            value={body}
            aria-label="Note"
            placeholder={'Write anything. Try:\n# A heading\n- a point\n- [ ] a task'}
            onChange={(e) => changeBody(e.target.value)}
            onKeyDown={(e) => { handleListEnter(e, changeBody); }}
            onBlur={(e) => { lastCaret.current = e.currentTarget.selectionStart; flush(); }}
          />
        ) : (
          <div
            className="nt-read"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a, input, label, button')) return;
              if (window.getSelection()?.toString()) return;
              setMode('write', true);
            }}
          >
            <NoteBody body={body} onToggle={toggle} empty={<p className="faint">Nothing written yet. Click to start.</p>} />
          </div>
        )}

        <p className="nt-stamp faint">
          {note.updatedAt - note.createdAt > 60_000 ? `Edited ${timeAgo(note.updatedAt)} · created ${timeAgo(note.createdAt)}` : `Created ${timeAgo(note.createdAt)}`}
          <span className="nt-keys"> · <kbd>Esc</kbd> to finish</span>
        </p>
      </div>
    </article>
  );
}
