import { ChevronDown, Users } from 'lucide-react';
import { AUDIENCES, type Deck, PURPOSES, deckPurpose } from '../../core/deck/types';
import { Menu } from '../../ui/Menu';

/** The studio's menu for what the deck is for and who it is for. Purpose sets the wording of the key notes; audience sets type size and word budgets. */
export function AudienceMenu({ deck, change }: { deck: Deck; change(fn: (d: Deck) => Deck, key?: string): void }) {
  const purpose = deckPurpose(deck);
  const purposeLabel = PURPOSES.find((p) => p.id === purpose)?.label;
  const audienceLabel = AUDIENCES.find((a) => a.id === deck.audience)?.label;
  return (
    <Menu
      align="end"
      width={300}
      trigger={(p) => (
        <button type="button" className="btn btn-ghost btn-sm" title="What the deck is for, and who it is for" {...p}>
          <Users size={15} /> {purposeLabel} · {audienceLabel} <ChevronDown size={14} />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="menu-label eyebrow">What it’s for</div>
          {PURPOSES.map((p) => (
            <button key={p.id} type="button" className="menu-item" aria-pressed={p.id === purpose} onClick={() => { close(); change((d) => ({ ...d, purpose: p.id })); }}>
              <span>{p.label}<span className="menu-detail">{p.detail}</span></span>
            </button>
          ))}
          <div className="menu-sep" />
          <div className="menu-label eyebrow">Audience</div>
          {AUDIENCES.map((a) => (
            <button key={a.id} type="button" className="menu-item" aria-pressed={a.id === deck.audience} onClick={() => { close(); change((d) => ({ ...d, audience: a.id })); }}>
              <span>{a.label}<span className="menu-detail">{a.detail}</span></span>
            </button>
          ))}
        </>
      )}
    </Menu>
  );
}
