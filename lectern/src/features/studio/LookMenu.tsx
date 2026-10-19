import { ChevronDown, Copy, Palette, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import type { Deck } from '../../core/deck/types';
import { type Theme, THEMES, allThemes, getTheme, isBuiltInTheme, subscribeThemes, themesRevision } from '../../core/engine/themes';
import { copyLook, deleteLook, saveLook, savedLooks } from '../../data/looks';
import { Menu } from '../../ui/Menu';
import { useToast } from '../../ui/Toast';
import { LookEditor } from '../looks/LookEditor';
import { SlideView } from '../slides/SlideView';

type Editing = { look: Theme; heading: string; apply: boolean };

/** The studio's Look menu: every look previewed on the deck's first slide, plus the user's own looks. */
export function LookMenu({ deck, change }: { deck: Deck; change(fn: (d: Deck) => Deck, key?: string): void }) {
  useSyncExternalStore(subscribeThemes, themesRevision);
  const [editing, setEditing] = useState<Editing | null>(null);
  const toast = useToast();
  const theme = getTheme(deck.themeId);
  const mine = savedLooks();
  const use = (id: string) => change((d) => ({ ...d, themeId: id }));

  function create() {
    const from = copyLook(theme, 'My look');
    setEditing({ look: from, heading: 'Create a look', apply: true });
  }

  async function remove(look: Theme) {
    await deleteLook(look.id);
    toast.show(`Deleted “${look.name}”`, { action: { label: 'Undo', run: () => { saveLook(look).catch(() => {}); } } });
  }

  const item = (t: Theme, close: () => void) => (
    <button key={t.id} type="button" className="theme-menu-item" aria-pressed={t.id === deck.themeId} onClick={() => { close(); use(t.id); }}>
      <SlideView slide={deck.slides[0]} deck={{ ...deck, themeId: t.id }} framed />
      <span><strong>{t.name}</strong><span className="menu-detail">{t.description}</span></span>
    </button>
  );

  return (
    <>
      <Menu align="end" width={320} trigger={(p) => <button type="button" className="btn btn-ghost btn-sm" {...p}><Palette size={15} /> {theme.name} <ChevronDown size={14} /></button>}>
        {(close) => (
          <div className="theme-menu">
            {mine.length > 0 && <div className="menu-label muted">Your looks</div>}
            {mine.map((t) => (
              <div key={t.id} className="look-menu-row">
                {item(t, close)}
                <div className="look-menu-actions">
                  <button type="button" className="icon-btn" aria-label={`Edit ${t.name}`} title="Edit" onClick={() => { close(); setEditing({ look: t, heading: 'Edit look', apply: false }); }}><Pencil size={14} /></button>
                  <button type="button" className="icon-btn" aria-label={`Duplicate ${t.name}`} title="Duplicate" onClick={() => { close(); setEditing({ look: copyLook(t), heading: 'Duplicate look', apply: true }); }}><Copy size={14} /></button>
                  <button type="button" className="icon-btn" aria-label={`Delete ${t.name}`} title="Delete" onClick={() => { close(); remove(t); }}><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            {mine.length > 0 && <div className="menu-label muted">Built in</div>}
            {THEMES.map((t) => item(t, close))}
            {allThemes().filter((t) => !t.custom && !isBuiltInTheme(t.id)).map((t) => item(t, close))}
            <div className="menu-sep" />
            <button type="button" className="menu-item" onClick={() => { close(); create(); }}>
              <Plus size={16} />
              <span>Create a look<span className="menu-detail">Your colours, fonts, logo and footer</span></span>
            </button>
          </div>
        )}
      </Menu>
      {editing && (
        <LookEditor
          key={editing.look.id}
          open
          initial={editing.look}
          heading={editing.heading}
          audience={deck.audience}
          onClose={() => setEditing(null)}
          onSaved={(look) => {
            const apply = editing.apply;
            setEditing(null);
            if (apply) use(look.id);
            toast.show(apply ? `Saved “${look.name}” and applied it to this deck` : `Saved “${look.name}”`);
          }}
        />
      )}
    </>
  );
}
