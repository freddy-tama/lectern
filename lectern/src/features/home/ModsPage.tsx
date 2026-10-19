import { Puzzle, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { installedPlugins } from '../../core/plugins/registry';
import { resetAll } from '../../data/repo';
import { Dialog } from '../../ui/Dialog';
import { useToast } from '../../ui/Toast';

/** Mods that live in this repository's /plugins folder. */
const KNOWN = [
  { id: 'chinese', name: 'Chinese lessons', description: 'Character, word-card and sentence slides with pinyin, a word-list starter, and a P key that hides or shows pinyin while you present.' },
  { id: 'lesson-plan', name: '教案 · Lesson plan', description: 'Teaching fields on each slide’s key notes, lesson-plan details on the deck, and a Word 教案 export in the thirteen-item course format.' },
];

export function ModsPage() {
  const mods = installedPlugins();
  const available = KNOWN.filter((k) => !mods.some((m) => m.id === k.id));
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Extend Lectern</p>
          <h1 className="display">Mods</h1>
        </div>
      </div>
      <div className="prose" style={{ marginBottom: 28 }}>
        <p>Mods add slide types, themes, ways to start a deck, exports and key-note fields for a subject or a school. Lectern works fully without them. A deck made with a mod still opens without it: its slides show a short note, and their content and key notes are kept.</p>
      </div>

      <section aria-labelledby="installed-title">
        <div className="section-head"><h2 id="installed-title">In this build</h2></div>
        {mods.length ? (
          <div className="course-grid">
            {mods.map((m) => (
              <article key={m.id} className="card mod-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <h3 style={{ fontSize: 17 }}>{m.name}</h3>
                  <span className="chip chip-good">On</span>
                </div>
                <p className="muted" style={{ fontSize: 14 }}>{m.description}</p>
                <ul>
                  {m.kinds?.length ? <li>{m.kinds.length} slide {m.kinds.length === 1 ? 'type' : 'types'}: {m.kinds.map((k) => k.label).join(', ')}</li> : null}
                  {m.deckSources?.length ? <li>Start a deck: {m.deckSources.map((s) => s.label).join(', ')}</li> : null}
                  {m.exporters?.length ? <li>Export: {m.exporters.map((e) => e.label).join(', ')}</li> : null}
                  {m.toggles?.length ? <li>Presenter keys: {m.toggles.map((t) => `${t.key.toUpperCase()} ${t.label}`).join(', ')}</li> : null}
                  {m.notesFields?.length ? <li>Key-note fields: {m.notesFields.map((f) => f.label).join(', ')}</li> : null}
                  {m.deckFields?.length ? <li>Deck details: {m.deckFields.length} fields, under Details in the studio</li> : null}
                </ul>
                <span className="faint" style={{ fontSize: 12.5 }}>Version {m.version}</span>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon"><Puzzle size={22} /></div>
            <h3>No mods in this build</h3>
            <p>This is the general edition. Every core feature is here.</p>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="available-title">
        <div className="section-head"><h2 id="available-title">Available in the source</h2></div>
        {available.length === 0 && <p className="muted" style={{ fontSize: 14 }}>Every mod in the source is on in this build.</p>}
        <div className="course-grid">
          {available.map((k) => (
            <article key={k.id} className="card mod-card">
              <h3 style={{ fontSize: 17 }}>{k.name}</h3>
              <p className="muted" style={{ fontSize: 14 }}>{k.description}</p>
              <code className="code-block">LECTERN_PLUGINS={k.id} npm run dev</code>
            </article>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 13.5, marginTop: 14 }}>Mods are chosen when the app is built. Set <code>LECTERN_PLUGINS</code> to a comma-separated list of folders in <code>/plugins</code>.</p>
      </section>

      <section className="section" aria-labelledby="data-title">
        <div className="section-head"><h2 id="data-title">Your data</h2></div>
        <div className="prose">
          <p>Courses, lessons and decks are saved in this browser only. Clearing site data removes them.</p>
        </div>
        <button type="button" className="btn btn-secondary" style={{ marginTop: 14 }} onClick={() => setConfirmReset(true)}><RotateCcw size={16} /> Restore the sample courses</button>
      </section>

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Restore the sample courses?"
        description="This deletes every course, lesson and deck in this browser and loads the samples again. It can’t be undone."
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Keep my data</button>
          <button type="button" className="btn btn-primary" style={{ background: 'var(--danger)', color: '#fff' }} onClick={async () => { setConfirmReset(false); await resetAll(true); toast.show('Sample courses restored'); }}>Delete and restore</button>
        </>}
      >
        <p className="muted">Export any deck you want to keep first (Studio → Export).</p>
      </Dialog>
    </div>
  );
}
