import { useLiveQuery } from 'dexie-react-hooks';
import { FileUp, Layers, Plus, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { PURPOSES, type DeckPurpose, deckPurpose } from '../../core/deck/types';
import { getKind } from '../../core/kinds/registry';
import { db } from '../../data/db';
import { isDeckFile } from '../../data/deck-file';
import { useToast } from '../../ui/Toast';
import { useOpenDeckFile } from '../backup/actions';
import { NewDeckDialog } from '../studio/NewDeckDialog';
import { DeckCard } from './DeckCard';

export function DecksPage() {
  const [query, setQuery] = useState('');
  const [courseId, setCourseId] = useState('all');
  const [purpose, setPurpose] = useState<DeckPurpose | 'all'>('all');
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [opening, setOpening] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const openDeck = useOpenDeckFile();
  const data = useLiveQuery(async () => {
    const [decks, lessons, courses] = await Promise.all([db.decks.orderBy('updatedAt').reverse().toArray(), db.lessons.toArray(), db.courses.toArray()]);
    return { decks, lessons, courses };
  }, []);
  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.decks
      .map((deck) => {
        const lesson = data.lessons.find((l) => l.id === deck.lessonId);
        const course = lesson ? data.courses.find((c) => c.id === lesson.courseId) : undefined;
        return { deck, course };
      })
      .filter(({ deck }) => purpose === 'all' || deckPurpose(deck) === purpose)
      .filter(({ course }) => courseId === 'all' || (courseId === 'none' ? !course : course?.id === courseId))
      .filter(({ deck }) => {
        if (!q) return true;
        if (deck.title.toLowerCase().includes(q)) return true;
        return deck.slides.some((s) => {
          const def = getKind(s.kind);
          const text = [...(def ? def.text(s.content) : []), s.notes.script, ...s.notes.keyPoints].join(' ').toLowerCase();
          return text.includes(q);
        });
      });
  }, [data, query, courseId, purpose]);

  const openFile = async (file: File) => {
    setOpening(true);
    try {
      if (!(await isDeckFile(file))) throw new Error('That isn’t a Lectern deck file. Choose a file that ends in .lectern.json, or use New deck to start from other files.');
      await openDeck(file);
    } catch (e) {
      toast.show((e as Error).message, { tone: 'error', duration: 8000 });
    } finally {
      setOpening(false);
    }
  };

  // Only JSON files are taken here (some systems don't name the type); other drops are left for the rest of the app.
  const carriesJson = (e: React.DragEvent) => Array.from(e.dataTransfer.items).some((i) => i.kind === 'file' && (!i.type || /json/i.test(i.type)));

  return (
    <div
      className={`page deck-drop ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(e) => { if (!carriesJson(e)) return; e.preventDefault(); e.stopPropagation(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => {
        setDragging(false);
        const file = Array.from(e.dataTransfer.files).find((f) => /\.json$/i.test(f.name));
        if (!file) return;
        e.preventDefault();
        e.stopPropagation();
        void openFile(file);
      }}
    >
      <div className="page-head">
        <div>
          <p className="eyebrow">Library</p>
          <h1 className="display">Decks</h1>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()} disabled={opening} title="Open a .lectern.json file saved from Export">
            {opening ? <span className="spinner" /> : <FileUp size={16} />} Open a deck file
          </button>
          <button type="button" className="btn btn-brand" onClick={() => setOpen(true)}><Plus size={16} /> New deck</button>
        </div>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ''; }} />
      </div>
      <div className="toolbar">
        <label className="search">
          <Search size={16} />
          <span className="visually-hidden">Search decks</span>
          <input className="input" type="search" placeholder="Search slides and key notes" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select className="select" style={{ width: 'auto' }} value={purpose} onChange={(e) => setPurpose(e.target.value as DeckPurpose | 'all')} aria-label="Filter by purpose">
          <option value="all">All kinds of deck</option>
          {PURPOSES.map((p) => <option key={p.id} value={p.id}>{p.label}s</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label="Filter by course">
          <option value="all">All courses</option>
          {data?.courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          <option value="none">Not in a course</option>
        </select>
      </div>
      {data && rows.length > 0 && (
        <div className="deck-grid">
          {rows.map(({ deck, course }) => <DeckCard key={deck.id} deck={deck} course={course} />)}
        </div>
      )}
      {data && !rows.length && (
        <div className="empty">
          <div className="empty-icon"><Layers size={22} /></div>
          {data.decks.length ? (
            <>
              <h3>No decks match</h3>
              <p>Try another word, or clear the filters.</p>
            </>
          ) : (
            <>
              <h3>No decks yet</h3>
              <p>Paste an outline or describe a topic, and Lectern drafts the slides and key notes.</p>
              <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> New deck</button>
            </>
          )}
        </div>
      )}
      <NewDeckDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
