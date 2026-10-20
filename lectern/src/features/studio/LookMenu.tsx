import { ChevronDown, Copy, Palette, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import type { Deck } from '../../core/deck/types';
import { type Theme, THEMES, allThemes, getTheme, isBuiltInTheme, subscribeThemes, themesRevision } from '../../core/engine/themes';
import { autoVariants } from '../../core/deck/auto-style';
import { copyLook, deleteLook, saveLook, savedLooks } from '../../data/looks';
import { autoLook, isAutoLook } from '../looks/auto-look';
import { Menu } from '../../ui/Menu';
import { useToast } from '../../ui/Toast';
import { LookEditor } from '../looks/LookEditor';
import { SlideView } from '../slides/SlideView';

type Editing = { look: Theme; heading: string; apply: boolean };

/** The studio's Look menu: every look previewed on the deck's first slide, plus the user's own looks. */
export function LookMenu({ deck, change, undo: undoAuto }: { deck: Deck; change(fn: (d: Deck) => Deck, key?: string): void; undo?(): void }) {
  useSyncExternalStore(subscribeThemes, themesRevision);
  const [editing, setEditing] = useState<Editing | null>(null);
  const toast = useToast();
  const theme = getTheme(deck.themeId);
  // Looks auto style made for other decks stay out of the list.
  const mine = savedLooks().filter((t) => !isAutoLook(t.id) || t.id === deck.themeId);
  const use = (id: string) => change((d) => ({ ...d, themeId: id }));
  const [styling, setStyling] = useState(false);

  /** Turns auto style on (picking a look and every layout) or off (keeping what it chose). */
  async function toggleAuto() {
    if (deck.autoStyle) {
      change((d) => ({ ...d, autoStyle: false }));
      toast.show('Auto style is off. Layouts stay as they are; change any of them yourself.');
      return;
    }
    setStyling(true);
    try {
      const { themeId, matched } = await autoLook(deck);
      change((d) => autoVariants({ ...d, autoStyle: true, themeId, slides: d.slides.map((s) => ({ ...s, variantPinned: undefined })) }));
      toast.show(matched ? 'Auto style is on, with colours from your pictures' : `Auto style is on, in ${getTheme(themeId).name}`, { action: { label: 'Undo', run: () => undoAuto?.() } });
    } finally {
      setStyling(false);
    }
  }

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
      <Menu align="end" width={320} trigger={(p) => (
        <button type="button" className="btn btn-ghost btn-sm look-trigger" title={deck.autoStyle ? `Auto style · ${theme.name}` : theme.name} {...p}>
          {styling ? <span className="spinner" /> : deck.autoStyle ? <Sparkles size={15} /> : <Palette size={15} />} <span className="look-name">{deck.autoStyle ? 'Auto' : theme.name}</span> <ChevronDown size={14} />
        </button>
      )}>
        {(close) => (
          <div className="theme-menu">
            <button type="button" className="auto-style-row" role="switch" aria-checked={Boolean(deck.autoStyle)} disabled={styling} onClick={() => { close(); void toggleAuto(); }}>
              <span className="auto-style-icon"><Sparkles size={16} /></span>
              <span>
                <strong>Auto style</strong>
                <span className="menu-detail">{deck.autoStyle ? `On · ${theme.name}. Layouts follow each slide’s content.` : 'Lectern picks the look, colours from your pictures, and a layout for every slide.'}</span>
              </span>
              <span className={`mini-switch ${deck.autoStyle ? 'on' : ''}`} aria-hidden />
            </button>
            <div className="menu-sep" />
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
