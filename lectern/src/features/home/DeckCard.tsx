import { Copy, MoreHorizontal, Pencil, Play, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PURPOSES, deckMinutes, deckPurpose, type Deck } from '../../core/deck/types';
import type { Course } from '../../data/db';
import { deleteDeck, duplicateDeck } from '../../data/repo';
import { Menu } from '../../ui/Menu';
import { useToast } from '../../ui/Toast';
import { minutesLabel, plural, timeAgo } from '../../ui/format';
import { SlideView } from '../slides/SlideView';

/** The decks that come with Lectern have ids that start with deck_; decks people make never do. */
const isSampleDeck = (deck: Pick<Deck, 'id'>) => deck.id.startsWith('deck_');

export function DeckCard({ deck, course }: { deck: Deck; course?: Course }) {
  const toast = useToast();
  const navigate = useNavigate();
  const first = deck.slides.find((s) => !s.hidden) ?? deck.slides[0];
  const count = deck.slides.filter((s) => !s.hidden).length;
  const purpose = PURPOSES.find((p) => p.id === deckPurpose(deck));
  return (
    <article className="card card-hover deck-card" style={course ? ({ '--course': `var(--c-${course.color})` } as React.CSSProperties) : undefined}>
      <div className="deck-card-visual">
        {first ? <SlideView slide={first} deck={deck} number={1} count={count} label={`${deck.title}, first slide`} /> : <div className="slide-frame" />}
      </div>
      <div className="deck-card-body">
        <h3><Link className="deck-card-link" to={`/studio/${deck.id}`}>{deck.title}</Link></h3>
        <div className="deck-card-meta">
          {course && <><span className="dot" /> <span>{course.title}</span> <span aria-hidden>·</span></>}
          <span>{plural(count, 'slide')}</span>
          <span aria-hidden>·</span>
          <span>{minutesLabel(deckMinutes(deck))}</span>
        </div>
        <div className="deck-card-meta">
          {isSampleDeck(deck) && <span className="chip chip-brand" title="A sample deck that comes with Lectern">Sample</span>}
          {purpose && <span className="chip">{purpose.label}</span>}
          <span>Edited {timeAgo(deck.updatedAt)}</span>
        </div>
      </div>
      <div className="deck-card-menu">
        <Menu align="end" trigger={(p) => <button type="button" className="icon-btn" aria-label={`More actions for ${deck.title}`} {...p}><MoreHorizontal size={18} /></button>}>
          {(close) => (
            <>
              <button type="button" className="menu-item" onClick={() => { close(); navigate(`/present/${deck.id}`); }}><Play size={16} /> Present</button>
              <button type="button" className="menu-item" onClick={() => { close(); navigate(`/studio/${deck.id}`); }}><Pencil size={16} /> Edit slides</button>
              <button type="button" className="menu-item" onClick={async () => { close(); const copy = await duplicateDeck(deck.id); if (copy) toast.show(`Made a copy: ${copy.title}`); }}><Copy size={16} /> Duplicate</button>
              <div className="menu-sep" />
              <button type="button" className="menu-item btn-danger" onClick={async () => {
                close();
                const undo = await deleteDeck(deck.id);
                toast.show(`Deleted “${deck.title}”`, { action: { label: 'Undo', run: () => { undo(); } } });
              }}><Trash2 size={16} /> Delete</button>
            </>
          )}
        </Menu>
      </div>
    </article>
  );
}
