// Notes: every note, searchable and filterable, beside an editor.
// Deep links: /notes?course=, ?lesson=, ?deck=, ?slide=, ?tag=, ?q=, and /notes/<id>.

import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, CalendarDays, GraduationCap, Hash, Layers, ListTodo, NotebookPen, Pin, Plus, Search, X } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db } from '../../data/db';
import { createNote, sortNotes } from '../../data/notes';
import { Menu } from '../../ui/Menu';
import { useToast } from '../../ui/Toast';
import { useKeys } from '../../ui/hooks';
import { plural } from '../../ui/format';
import { type NoteFilter, applyFilter, defaultsFor, filterFromParams, filterToParams, isFiltering, tagCounts } from './filters';
import { NoteEditor } from './NoteEditor';
import { NoteItem, NotesOverview } from './NoteList';
import { courseStyle, useNoteRefs } from './refs';

const TAG_CHIPS = 6;

export default function NotesPage() {
  const { noteId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const notes = useLiveQuery(() => db.notes.toArray(), []);
  const refs = useNoteRefs();
  const filter = useMemo(() => filterFromParams(params), [params]);
  const search = params.toString() ? `?${params.toString()}` : '';
  const fresh = Boolean((location.state as { fresh?: boolean } | null)?.fresh);

  const setFilter = (patch: Partial<NoteFilter>) => setParams(filterToParams({ ...filter, ...patch }), { replace: true });

  const shown = useMemo(() => {
    if (!notes) return [];
    const list = applyFilter(notes, filter);
    // The open note stays in view even when it no longer matches.
    const open = noteId && !list.some((n) => n.id === noteId) ? notes.find((n) => n.id === noteId) : undefined;
    return sortNotes(open ? [...list, open] : list);
  }, [notes, filter, noteId]);
  const pinned = shown.filter((n) => n.pinned);
  const rest = shown.filter((n) => !n.pinned);
  const tags = useMemo(() => tagCounts(notes ?? []), [notes]);
  const active = noteId ? notes?.find((n) => n.id === noteId) : undefined;
  const filtering = isFiltering(filter);

  const newNote = async () => {
    const note = await createNote(defaultsFor(filter, refs));
    navigate(`/notes/${note.id}${search}`, { state: { fresh: true } });
  };

  const leaveEditor = () => {
    const id = noteId;
    if (window.matchMedia('(max-width: 768px)').matches) navigate(`/notes${search}`);
    else requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-note="${id}"]`)?.focus());
  };

  useKeys((e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); searchRef.current?.focus(); }
  });

  // Up and down move through the list.
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-note]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[i < 0 ? 0 : Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) { e.preventDefault(); next.focus(); }
  };

  const scoped = [
    filter.lesson && { key: 'lesson' as const, icon: <GraduationCap size={13} />, label: refs?.lesson.get(filter.lesson)?.title ?? 'A lesson' },
    filter.deck && { key: 'deck' as const, icon: <Layers size={13} />, label: refs?.deck.get(filter.deck)?.title ?? 'A deck' },
    filter.slide && { key: 'slide' as const, icon: <Layers size={13} />, label: (() => { const s = refs?.deck.get(filter.deck ?? '')?.slides.find((x) => x.id === filter.slide); return s ? `Slide ${s.number}` : 'A slide'; })() },
  ].filter(Boolean) as { key: 'lesson' | 'deck' | 'slide'; icon: React.ReactNode; label: string }[];

  const tagChips = tags.slice(0, TAG_CHIPS);
  if (filter.tag && !tagChips.some((t) => t.tag === filter.tag)) tagChips.push({ tag: filter.tag, count: tags.find((t) => t.tag === filter.tag)?.count ?? 0 });
  const moreTags = tags.filter((t) => !tagChips.some((c) => c.tag === t.tag));

  return (
    <div className={`nt-page ${noteId ? 'has-note' : ''}`}>
      <section className="nt-list-pane" aria-label="All notes">
        <div className="nt-list-top">
          <div className="nt-list-head">
            <div>
              <h1 className="display">Notes</h1>
              <p className="faint nt-count">{notes ? (filtering ? `${shown.length} of ${plural(notes.length, 'note')}` : plural(notes.length, 'note')) : ' '}</p>
            </div>
            <button type="button" className="btn btn-brand btn-sm" onClick={newNote}><Plus size={15} /> New note</button>
          </div>

          <label className="search nt-search">
            <Search size={16} />
            <span className="visually-hidden">Search notes</span>
            <input
              ref={searchRef}
              className="input"
              type="search"
              placeholder="Search notes"
              value={filter.q}
              onChange={(e) => setFilter({ q: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && filter.q) { e.preventDefault(); setFilter({ q: '' }); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); document.querySelector<HTMLElement>('.nt-list [data-note]')?.focus(); }
              }}
            />
          </label>

          {refs && refs.courses.length > 0 && (
            <div className="nt-chips" role="group" aria-label="Filter by course">
              {refs.courses.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="nt-fchip is-course"
                  style={courseStyle(c)}
                  aria-pressed={filter.course === c.id}
                  onClick={() => setFilter({ course: filter.course === c.id ? undefined : c.id })}
                >
                  <span className="dot" /> {c.title}
                </button>
              ))}
            </div>
          )}

          <div className="nt-chips" role="group" aria-label="More filters">
            <button type="button" className="nt-fchip" aria-pressed={Boolean(filter.linked)} onClick={() => setFilter({ linked: !filter.linked })}><GraduationCap size={13} /> Linked to a lesson</button>
            <button type="button" className="nt-fchip" aria-pressed={Boolean(filter.tasks)} onClick={() => setFilter({ tasks: !filter.tasks })}><ListTodo size={13} /> Has open tasks</button>
            <button type="button" className="nt-fchip" aria-pressed={Boolean(filter.dated)} onClick={() => setFilter({ dated: !filter.dated })}><CalendarDays size={13} /> Dated</button>
            {tagChips.map((t) => (
              <button key={t.tag} type="button" className="nt-fchip is-tag" aria-pressed={filter.tag === t.tag} onClick={() => setFilter({ tag: filter.tag === t.tag ? undefined : t.tag })}>
                #{t.tag}
              </button>
            ))}
            {moreTags.length > 0 && (
              <Menu width={240} trigger={(p) => <button type="button" className="nt-fchip" {...p}><Hash size={13} /> More tags</button>}>
                {(close) => moreTags.map((t) => (
                  <button key={t.tag} type="button" className="menu-item" onClick={() => { close(); setFilter({ tag: t.tag }); }}>
                    #{t.tag}<span className="faint" style={{ marginLeft: 'auto' }}>{t.count}</span>
                  </button>
                ))}
              </Menu>
            )}
          </div>

          {(scoped.length > 0 || filtering) && (
            <div className="nt-scoped">
              {scoped.map((s) => (
                <span key={s.key} className="nt-fchip is-scope">
                  {s.icon}<span className="nt-meta-text">{s.label}</span>
                  <button type="button" onClick={() => setFilter(s.key === 'deck' ? { deck: undefined, slide: undefined } : { [s.key]: undefined })} aria-label={`Stop filtering by ${s.key}`}><X size={12} /></button>
                </span>
              ))}
              {filtering && <button type="button" className="nt-clear" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</button>}
            </div>
          )}
        </div>

        <div className="nt-list" onKeyDown={onListKey}>
          {notes === undefined && (
            <div className="nt-skeletons" aria-busy="true">
              {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 76 }} />)}
            </div>
          )}
          {notes && notes.length === 0 && (
            <div className="empty nt-empty">
              <div className="empty-icon"><NotebookPen size={22} /></div>
              <h3>No notes yet</h3>
              <p>Plans, reflections after class, reminders and ideas live here, linked to your lessons and slides.</p>
              <button type="button" className="btn btn-primary" onClick={newNote}><Plus size={16} /> Write the first one</button>
            </div>
          )}
          {notes && notes.length > 0 && shown.length === 0 && (
            <div className="empty nt-empty">
              <div className="empty-icon"><Search size={22} /></div>
              <h3>No notes match</h3>
              <p>Try other words, or clear the filters.</p>
              <button type="button" className="btn btn-secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</button>
            </div>
          )}
          {pinned.length > 0 && (
            <>
              <h2 className="eyebrow nt-group"><Pin size={12} /> Pinned</h2>
              <div className="nt-items">
                {pinned.map((n) => <NoteItem key={n.id} note={n} refs={refs} active={n.id === noteId} to={`/notes/${n.id}${search}`} />)}
              </div>
            </>
          )}
          {rest.length > 0 && (
            <>
              {pinned.length > 0 && <h2 className="eyebrow nt-group">Notes</h2>}
              <div className="nt-items">
                {rest.map((n) => <NoteItem key={n.id} note={n} refs={refs} active={n.id === noteId} to={`/notes/${n.id}${search}`} />)}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="nt-editor-pane" aria-label="Note editor">
        {noteId ? (
          active && refs ? (
            <NoteEditor
              key={active.id}
              note={active}
              refs={refs}
              fresh={fresh}
              onLeave={leaveEditor}
              onDeleted={(undo) => {
                const id = active.id;
                navigate(`/notes${search}`, { replace: true });
                toast.show('Note deleted', { action: { label: 'Undo', run: async () => { await undo(); navigate(`/notes/${id}${search}`); } } });
              }}
            />
          ) : notes && !active ? (
            <div className="nt-missing">
              <div className="empty">
                <div className="empty-icon"><NotebookPen size={22} /></div>
                <h3>This note is gone</h3>
                <p>It was deleted, or the link is wrong.</p>
                <Link className="btn btn-secondary" to={`/notes${search}`}><ArrowLeft size={16} /> All notes</Link>
              </div>
            </div>
          ) : (
            <div className="nt-editor-loading"><div className="skeleton" style={{ height: 44, width: '60%' }} /><div className="skeleton" style={{ height: 220 }} /></div>
          )
        ) : notes ? (
          <NotesOverview notes={shown} refs={refs} search={search} onNew={newNote} />
        ) : null}
      </section>
    </div>
  );
}
