import { useEffect, useState } from 'react';
import type { Deck } from '../../core/deck/types';
import { deckFields } from '../../core/plugins/registry';
import { Dialog } from '../../ui/Dialog';
import { ModField } from './ModField';

/** Deck-level details that mods ask for, such as the header of a lesson plan. */
export function DeckDetailsDialog({ open, deck, onClose, onSave }: { open: boolean; deck: Deck; onClose(): void; onSave(extra: NonNullable<Deck['extra']>): void }) {
  const groups = deckFields();
  const [draft, setDraft] = useState<NonNullable<Deck['extra']>>({});
  useEffect(() => { if (open) setDraft(structuredClone(deck.extra ?? {})); }, [open, deck.extra]);
  const set = (plugin: string, key: string, value: string) => setDraft((d) => ({ ...d, [plugin]: { ...d[plugin], [key]: value } }));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Deck details"
      description="Details that installed mods use, for example in documents they export."
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => { onSave(draft); onClose(); }}>Save details</button>
        </>
      )}
    >
      <div className="details-form">
        {groups.map((g) => (
          <section key={g.plugin} aria-label={g.name}>
            <h3 className="mod-notes-title" style={{ marginBottom: 10 }}>{g.name}</h3>
            <div className="details-grid">
              {g.fields.map((f) => (
                <div key={f.key} className={(f.rows ?? 2) > 1 && !f.options ? 'wide' : undefined}>
                  <ModField field={f} value={draft[g.plugin]?.[f.key] ?? ''} onChange={(v) => set(g.plugin, f.key, v)} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
