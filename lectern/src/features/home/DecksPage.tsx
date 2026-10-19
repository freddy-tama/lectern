import { useLiveQuery } from 'dexie-react-hooks';
import { Layers, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PURPOSES, type DeckPurpose, deckPurpose } from '../../core/deck/types';
import { getKind } from '../../core/kinds/registry';
import { db } from '../../data/db';
import { NewDeckDialog } from '../studio/NewDeckDialog';
import { DeckCard } from './DeckCard';

export function DecksPage() {
  const [query, setQuery] = useState('');
  const [courseId, setCourseId] = useState('all');
  const [purpose, setPurpose] = useState<DeckPurpose | 'all'>('all');
  const [open, setOpen] = useState(false);
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Library</p>
          <h1 className="display">Decks</h1>
        </div>
        <button type="button" className="btn btn-brand" onClick={() => setOpen(true)}><Plus size={16} /> New deck</button>
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
