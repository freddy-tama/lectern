// Quick capture: press N anywhere in the app (or use the sidebar button) to jot a note
// without leaving the page. Links to the lesson or course on screen are filled in.

import { useEffect, useRef, useState } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { db } from '../../data/db';
import { createNote } from '../../data/notes';
import { Dialog } from '../../ui/Dialog';
import { useToast } from '../../ui/Toast';
import { useKeys } from '../../ui/hooks';
import { CourseSelect, LessonSelect } from './LinkPickers';
import { splitCapture } from './markdown';
import { useNoteRefs } from './refs';
import { handleListEnter } from './textarea';

const EVENT = 'lectern:quick-note';

interface Preset {
  courseId?: string;
  lessonId?: string;
  deckId?: string;
  date?: string;
}

/** Opens the quick capture dialog from anywhere inside the app shell. */
export function openQuickCapture(preset?: Preset) {
  window.dispatchEvent(new CustomEvent<Preset | undefined>(EVENT, { detail: preset }));
}

/** Links suggested by the page on screen. */
async function presetFromRoute(pathname: string, search: string): Promise<Preset> {
  const params = new URLSearchParams(search);
  const lessonMatch = matchPath('/lessons/:lessonId', pathname);
  const lessonId = lessonMatch?.params.lessonId ?? (pathname.startsWith('/notes') ? params.get('lesson') ?? undefined : undefined);
  if (lessonId) {
    const lesson = await db.lessons.get(lessonId);
    if (lesson) return { lessonId: lesson.id, courseId: lesson.courseId, deckId: lesson.deckId };
  }
  const courseId = matchPath('/courses/:courseId', pathname)?.params.courseId ?? (pathname.startsWith('/notes') ? params.get('course') ?? undefined : undefined);
  if (courseId && (await db.courses.get(courseId))) return { courseId };
  const date = pathname.startsWith('/schedule') ? params.get('date') : null;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return { date };
  return {};
}

export function QuickCapture() {
  const [open, setOpen] = useState(false);
  // The draft survives closing the dialog, until it is saved.
  const [text, setText] = useState('');
  const [links, setLinks] = useState<Preset>({});
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const refs = useNoteRefs();
  const where = useRef(location);
  where.current = location;

  useEffect(() => {
    const onOpen = async (e: Event) => {
      const detail = (e as CustomEvent<Preset | undefined>).detail;
      const preset = detail ?? (await presetFromRoute(where.current.pathname, where.current.search));
      setLinks(preset);
      setOpen(true);
    };
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  useKeys((e) => {
    if (e.key !== 'n' && e.key !== 'N') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || open) return;
    if (document.querySelector('.menu')) return;
    e.preventDefault();
    openQuickCapture();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const ta = textRef.current;
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }, 20);
    return () => window.clearTimeout(t);
  }, [open]);

  const save = async (andOpen: boolean) => {
    const { title, body } = splitCapture(text);
    if ((!title && !body) || busy) { textRef.current?.focus(); return; }
    setBusy(true);
    try {
      const lesson = links.lessonId ? refs?.lesson.get(links.lessonId) : undefined;
      const note = await createNote({
        title,
        body,
        courseId: links.courseId,
        lessonId: links.lessonId,
        deckId: lesson?.deckId ?? (links.lessonId ? links.deckId : undefined),
        date: links.date,
      });
      setText('');
      setOpen(false);
      if (andOpen) navigate(`/notes/${note.id}`);
      else toast.show('Note saved', { action: { label: 'Open', run: () => navigate(`/notes/${note.id}`) } });
    } catch (error) {
      toast.show(`Couldn’t save the note. ${(error as Error).message}`, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const empty = !text.trim();

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="New note"
      className="nt-capture"
      footer={
        <>
          <span className="nt-capture-hint faint"><kbd>Ctrl</kbd> <kbd>Enter</kbd> to save</span>
          <button type="button" className="btn btn-secondary" onClick={() => save(true)} disabled={empty || busy}>Save and open</button>
          <button type="button" className="btn btn-primary" onClick={() => save(false)} disabled={empty || busy}>Save</button>
        </>
      }
    >
      <textarea
        ref={textRef}
        className="textarea nt-capture-text"
        rows={6}
        value={text}
        placeholder={'The first line becomes the title.\n\n- [ ] Tasks work too'}
        aria-label="Note"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(e.shiftKey); return; }
          handleListEnter(e, setText);
        }}
      />
      {refs && (
        <div className="nt-capture-links">
          <label className="field">
            <span className="field-label">Course</span>
            <CourseSelect
              refs={refs}
              value={links.courseId}
              onChange={(courseId) => setLinks((l) => ({ ...l, courseId, ...(l.lessonId && refs.lesson.get(l.lessonId)?.courseId !== courseId ? { lessonId: undefined, deckId: undefined } : {}) }))}
            />
          </label>
          <label className="field">
            <span className="field-label">Lesson</span>
            <LessonSelect
              refs={refs}
              courseId={links.courseId}
              value={links.lessonId}
              onChange={(lessonId) => setLinks((l) => {
                const lesson = lessonId ? refs.lesson.get(lessonId) : undefined;
                return { ...l, lessonId, deckId: lesson?.deckId, courseId: lesson?.courseId ?? l.courseId };
              })}
            />
          </label>
          <label className="field">
            <span className="field-label">Date <span className="faint">(optional)</span></span>
            <input className="input" type="date" value={links.date ?? ''} onChange={(e) => setLinks((l) => ({ ...l, date: e.target.value || undefined }))} />
          </label>
        </div>
      )}
    </Dialog>
  );
}
