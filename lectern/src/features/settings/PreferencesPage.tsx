import { AudioLines, BookOpen, Bookmark, CalendarDays, GraduationCap, LayoutGrid, Mic, NotebookPen, RotateCcw, Trash2, Wand2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AUDIENCES, type Audience, type DeckPurpose, PURPOSES } from '../../core/deck/types';
import { allThemes } from '../../core/engine/themes';
import {
  DENSITIES, type Density, FEATURES, type Feature, type Focus, LENGTHS, forgetAnswer, updateProfile, useProfile,
} from '../../data/profile';
import { useToast } from '../../ui/Toast';
import { BackupPanel } from '../backup/BackupPanel';

const FOCUS: { id: Focus; label: string; detail: string; icon: React.ReactNode }[] = [
  { id: 'deck', label: 'Make presentations fast', detail: 'Home leads with the file drop.', icon: <Wand2 size={17} /> },
  { id: 'present', label: 'Talks, pitches and reports', detail: 'Home leads with your latest deck and rehearsal.', icon: <Mic size={17} /> },
  { id: 'teach', label: 'Teaching', detail: 'Home leads with the next lesson and the week.', icon: <GraduationCap size={17} /> },
  { id: 'study', label: 'Studying', detail: 'Home leads with recordings and notes.', icon: <BookOpen size={17} /> },
  { id: 'all', label: 'A bit of everything', detail: 'Home shows it all.', icon: <LayoutGrid size={17} /> },
];

const FEATURE_LABELS: Record<Feature, { label: string; icon: React.ReactNode }> = {
  courses: { label: 'Courses and lessons', icon: <GraduationCap size={16} /> },
  schedule: { label: 'Schedule', icon: <CalendarDays size={16} /> },
  notes: { label: 'Notes', icon: <NotebookPen size={16} /> },
  recordings: { label: 'Recordings', icon: <AudioLines size={16} /> },
};

export function PreferencesPage() {
  const profile = useProfile();
  const toast = useToast();
  const deck = profile.deck;
  const setDeck = (patch: Partial<typeof deck>) => updateProfile((p) => ({ deck: { ...p.deck, ...patch } }));
  const toggle = (f: Feature) => updateProfile((p) => ({ features: p.features.includes(f) ? p.features.filter((x) => x !== f) : FEATURES.filter((x) => x === f || p.features.includes(x)) }));

  return (
    <div className="page prefs">
      <div className="page-head">
        <div>
          <p className="eyebrow">Make Lectern yours</p>
          <h1 className="display">Preferences</h1>
        </div>
        <Link to="/start" className="btn btn-secondary"><RotateCcw size={15} /> Answer the setup questions again</Link>
      </div>

      <section className="section prefs-section" aria-labelledby="pf-focus">
        <div className="section-head"><h2 id="pf-focus">What you mostly use Lectern for</h2></div>
        <div className="prefs-focus" role="radiogroup" aria-labelledby="pf-focus">
          {FOCUS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={profile.focus === f.id} className="audience-option prefs-option" onClick={() => updateProfile({ focus: f.id, onboarded: true })}>
              <span className="prefs-option-icon">{f.icon}</span>
              <span><strong>{f.label}</strong><span>{f.detail}</span></span>
            </button>
          ))}
        </div>
      </section>

      <section className="section prefs-section" aria-labelledby="pf-sidebar">
        <div className="section-head"><h2 id="pf-sidebar">In the sidebar</h2></div>
        <p className="muted prefs-help">Home, Make a deck and Decks always show. Hidden parts keep their data and still open from links.</p>
        <div className="card prefs-list">
          {FEATURES.map((f) => (
            <label key={f} className="switch prefs-row">
              <span className="prefs-row-label">{FEATURE_LABELS[f].icon} {FEATURE_LABELS[f].label}</span>
              <input type="checkbox" checked={profile.features.includes(f)} onChange={() => toggle(f)} />
            </label>
          ))}
        </div>
      </section>

      <section className="section prefs-section" aria-labelledby="pf-deck">
        <div className="section-head"><h2 id="pf-deck">New decks start with</h2></div>
        <p className="muted prefs-help">Lectern also updates these from the last deck you made with Make a deck.</p>
        <div className="card prefs-grid">
          <label className="field">
            <span className="field-label">Kind of deck</span>
            <select className="select" value={deck.purpose} onChange={(e) => setDeck({ purpose: e.target.value as DeckPurpose })}>
              {PURPOSES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Audience</span>
            <select className="select" value={deck.audience} onChange={(e) => setDeck({ audience: e.target.value as Audience })}>
              {AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.detail}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Length</span>
            <select className="select" value={deck.minutes} onChange={(e) => setDeck({ minutes: Number(e.target.value) })}>
              {[...new Set([...LENGTHS, deck.minutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Words on a slide</span>
            <select className="select" value={deck.density} onChange={(e) => setDeck({ density: e.target.value as Density })}>
              {DENSITIES.map((d) => <option key={d.id} value={d.id}>{d.label} · {d.detail}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Look</span>
            <select className="select" value={deck.themeId} onChange={(e) => setDeck({ themeId: e.target.value })}>
              {allThemes().map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="section prefs-section" aria-labelledby="pf-ai">
        <div className="section-head"><h2 id="pf-ai">AI questions</h2></div>
        <div className="card prefs-list">
          <label className="switch prefs-row">
            <span className="prefs-row-label">Ask a few questions before drafting a deck from files</span>
            <input type="checkbox" checked={profile.askQuestions} onChange={(e) => updateProfile({ askQuestions: e.target.checked })} />
          </label>
        </div>
        <h3 className="prefs-sub"><Bookmark size={15} /> Remembered answers</h3>
        {profile.remembered.length ? (
          <>
            <ul className="card prefs-list prefs-remembered">
              {profile.remembered.map((r) => (
                <li key={r.key} className="prefs-row">
                  <span className="prefs-answer">
                    <span className="faint">{r.question || r.key}</span>
                    <strong>{r.answer}</strong>
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { forgetAnswer(r.key); toast.show('Answer forgotten'); }}>Forget</button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-ghost btn-sm prefs-forget-all" onClick={() => { updateProfile({ remembered: [] }); toast.show('All remembered answers forgotten'); }}><Trash2 size={14} /> Forget all</button>
          </>
        ) : (
          <p className="muted prefs-help">Nothing yet. When the AI asks about something like tone or how to end, tick “Remember this” and the answer shows here. Lectern sends it with every new deck.</p>
        )}
      </section>

      <section className="section prefs-section" aria-labelledby="pf-data">
        <div className="section-head"><h2 id="pf-data">Your data</h2></div>
        <BackupPanel />
      </section>
    </div>
  );
}
