import { Puzzle, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { installedPlugins } from '../../core/plugins/registry';
import { resetAll } from '../../data/repo';
import { Dialog } from '../../ui/Dialog';
import { useToast } from '../../ui/Toast';
import { BackupPanel } from '../backup/BackupPanel';

export function ModsPage() {
  // Names and descriptions come from each mod, so this page never names a mod the build doesn't have.
  const mods = installedPlugins();
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
            <h3>This build has no mods.</h3>
            <p>This is the general edition. Every core feature is here.</p>
          </div>
        )}
        <p className="faint" style={{ fontSize: 13.5, marginTop: 14 }}>Mods are chosen when the app is built. Set <code>LECTERN_PLUGINS</code> to a comma-separated list of folders in <code>/plugins</code>, for example <code>LECTERN_PLUGINS=my-mod npm run dev</code>. The README lists the mods in the source.</p>
      </section>

      <section className="section" aria-labelledby="data-title">
        <div className="section-head"><h2 id="data-title">Your data</h2></div>
        <BackupPanel />
        <div className="backup-reset">
          <p className="faint">Start over with the sample courses. This deletes everything in this browser.</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(true)}><RotateCcw size={15} /> Reset to the samples…</button>
        </div>
      </section>

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset to the sample courses?"
        description="This deletes every course, lesson, deck, note and recording in this browser and loads the samples again. It can’t be undone."
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Keep my data</button>
          <button type="button" className="btn btn-primary" style={{ background: 'var(--danger)', color: '#fff' }} onClick={async () => { setConfirmReset(false); await resetAll(true); toast.show('Sample courses loaded'); }}>Delete and reset</button>
        </>}
      >
        <p className="muted">Download a backup first if you might want any of it back.</p>
      </Dialog>
    </div>
  );
}
