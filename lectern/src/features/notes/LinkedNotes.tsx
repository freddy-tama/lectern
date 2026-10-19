// A compact list of the notes linked to a lesson, course, deck or slide, with an inline composer.
// Used on the lesson page, in the presenter view and in the studio.

import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, CornerDownLeft, Plus } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Note } from '../../data/db';
import { checklistItems, createNote, notesForCourse, notesForDeck, notesForLesson, notesForSlide, stripMarks, toggleChecklistItem, updateNote } from '../../data/notes';
import { isoDate } from '../../data/repo';
import { formatTime, relativeDay, timeAgo } from '../../ui/format';
import { splitCapture } from './markdown';
import { MoodIcon } from './mood';
import { InlineText } from './NoteBody';
import { autoGrow } from './textarea';

export interface NoteScope {
  courseId?: string;
  lessonId?: string;
  deckId?: string;
  slideId?: string;
}

/** The list a scope shows: the most specific link wins. */
export function scopeQuery(scope: NoteScope): { kind: 'slide' | 'lesson' | 'deck' | 'course' | null; href: string } {
  const p = new URLSearchParams();
  if (scope.deckId && scope.slideId) { p.set('deck', scope.deckId); p.set('slide', scope.slideId); return { kind: 'slide', href: `/notes?${p}` }; }
  if (scope.lessonId) { p.set('lesson', scope.lessonId); return { kind: 'lesson', href: `/notes?${p}` }; }
  if (scope.deckId) { p.set('deck', scope.deckId); return { kind: 'deck', href: `/notes?${p}` }; }
  if (scope.courseId) { p.set('course', scope.courseId); return { kind: 'course', href: `/notes?${p}` }; }
  return { kind: null, href: '/notes' };
}

async function loadScope(scope: NoteScope): Promise<Note[]> {
  if (scope.deckId && scope.slideId) return notesForSlide(scope.deckId, scope.slideId);
  if (scope.lessonId) return notesForLesson(scope.lessonId);
  if (scope.deckId) return notesForDeck(scope.deckId);
  if (scope.courseId) return notesForCourse(scope.courseId);
  return [];
}

/** Prose lines of a note (no tasks), without the line that already serves as its title. */
function prose(note: Note, max = 120): string {
  const lines = note.body.split('\n').filter((l) => !/^\s*[-*+]\s+\[[ xX]\]/.test(l)).map(stripMarks).filter(Boolean);
  if (!note.title.trim()) lines.shift();
  const text = lines.join(' · ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

interface LinkedNotesProps extends NoteScope {
  /** Heading over the list. */
  title?: ReactNode;
  /** Placeholder in the composer. Without one the composer is hidden. */
  placeholder?: string;
  emptyText?: ReactNode;
  /** More fields for new notes, for example a date. */
  extra?: Partial<Note>;
  /** Hide some notes (shown elsewhere on the page). */
  hide?(note: Note): boolean;
  /** How many notes to show before "Show all". */
  max?: number;
  autoFocus?: boolean;
  /** Open note links in a new tab, so a presentation keeps running. */
  newTab?: boolean;
  className?: string;
  /** Called after a note is added from the composer. */
  onAdded?(note: Note): void;
}

export function LinkedNotes({ title, placeholder = 'Add a note', emptyText, extra, hide, max = 4, autoFocus, newTab, className, onAdded, ...scope }: LinkedNotesProps) {
  const { courseId, lessonId, deckId, slideId } = scope;
  const all = useLiveQuery(() => loadScope({ courseId, lessonId, deckId, slideId }), [courseId, lessonId, deckId, slideId]);
  const [expanded, setExpanded] = useState(false);
  const notes = all?.filter((n) => !hide?.(n));
  const { href } = scopeQuery(scope);
  const shown = expanded ? notes : notes?.slice(0, max);
  const target = newTab ? '_blank' : undefined;

  return (
    <div className={`ln ${className ?? ''}`}>
      {title && <div className="ln-head-row">{title}</div>}
      {placeholder && <Composer placeholder={placeholder} autoFocus={autoFocus} onAdd={async (text) => {
        const { title: t, body } = splitCapture(text);
        const note = await createNote({ title: t, body, courseId, lessonId, deckId, slideId, ...extra });
        onAdded?.(note);
      }} />}
      {notes && notes.length === 0 && emptyText && <p className="ln-empty">{emptyText}</p>}
      {shown && shown.length > 0 && (
        <ul className="ln-list">
          {shown.map((n) => <LinkedNote key={n.id} note={n} target={target} />)}
        </ul>
      )}
      {notes && notes.length > 0 && (
        <div className="ln-foot">
          {notes.length > max && (
            <button type="button" className="ln-more" onClick={() => setExpanded((x) => !x)}>{expanded ? 'Show fewer' : `Show all ${notes.length}`}</button>
          )}
          <Link className="ln-open" to={href} target={target}>Open in Notes <ArrowRight size={13} /></Link>
        </div>
      )}
    </div>
  );
}

function LinkedNote({ note, target }: { note: Note; target?: string }) {
  const tasks = checklistItems(note.body);
  const text = prose(note);
  const today = isoDate(new Date());
  return (
    <li className="ln-item">
      <div className="ln-item-head">
        {note.mood && <MoodIcon mood={note.mood} size={14} />}
        <Link className="ln-title" to={`/notes/${note.id}`} target={target}>{titleOf(note)}</Link>
        <span className="ln-time">{note.date ? `${relativeDay(note.date, today)}${note.time ? `, ${formatTime(note.time)}` : ''}` : timeAgo(note.updatedAt)}</span>
      </div>
      {text && <p className="ln-preview">{text}</p>}
      {tasks.length > 0 && (
        <ul className="ln-tasks">
          {tasks.slice(0, 6).map((item) => (
            <li key={item.line} className={item.done ? 'is-done' : undefined}>
              <label className="nt-check">
                <input type="checkbox" checked={item.done} onChange={() => updateNote(note.id, { body: toggleChecklistItem(note.body, item.line) })} />
                <span><InlineText text={item.text} /></span>
              </label>
            </li>
          ))}
          {tasks.length > 6 && <li className="ln-preview">and {tasks.length - 6} more</li>}
        </ul>
      )}
      {note.tags.length > 0 && <div className="ln-tags">{note.tags.slice(0, 4).map((t) => <span key={t} className="nt-tag">#{t}</span>)}</div>}
    </li>
  );
}

function titleOf(note: Note) {
  if (note.title.trim()) return note.title.trim();
  const first = note.body.split('\n').map(stripMarks).find(Boolean);
  return first ? (first.length > 80 ? `${first.slice(0, 79)}…` : first) : 'Untitled note';
}

/** A one-line box that grows: Enter adds, Shift Enter starts a new line. */
export function Composer({ placeholder, onAdd, autoFocus, buttonLabel = 'Add' }: { placeholder: string; onAdd(text: string): Promise<void> | void; autoFocus?: boolean; buttonLabel?: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => autoGrow(ref.current, 180), [text]);
  useLayoutEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(text);
      setText('');
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  };
  return (
    <div className="ln-composer">
      <textarea
        ref={ref}
        rows={1}
        className="ln-input"
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          else if (e.key === 'Escape' && !text) (e.target as HTMLElement).blur();
        }}
      />
      <button type="button" className="ln-add" onClick={submit} disabled={!text.trim() || busy} aria-label={buttonLabel} title={`${buttonLabel} (Enter)`}>
        {text.trim() ? <CornerDownLeft size={15} /> : <Plus size={15} />}
      </button>
    </div>
  );
}
