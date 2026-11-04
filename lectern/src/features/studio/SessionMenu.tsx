import { Clock, Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SESSION_RANGE, hasSession, minutesPerSlide, sessionMinutes, setSessionMinutes, slideTimeLabel, timeByNotes, timeEvenly } from '../../core/deck/timing';
import type { Deck } from '../../core/deck/types';
import { Menu } from '../../ui/Menu';
import { minutesLabel } from '../../ui/format';

const round = (m: number) => Math.round(m * 10) / 10;

/**
 * The studio's session length. Slide times are shares of it: change it and every slide rescales.
 * `planned` is the lesson's length, when the deck belongs to a lesson.
 */
export function SessionMenu({ deck, change, planned }: { deck: Deck; change(fn: (d: Deck) => Deck, key?: string): void; planned?: number }) {
  const total = sessionMinutes(deck);
  const set = hasSession(deck);
  const shown = deck.slides.filter((s) => !s.hidden).length;
  const [draft, setDraft] = useState(String(round(total)));
  useEffect(() => setDraft(String(round(total))), [total]);

  const commit = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) { setDraft(String(round(total))); return; }
    change((d) => setSessionMinutes(d, value), 'session');
  };
  const step = (by: number) => commit(Math.max(SESSION_RANGE.min, Math.round((total + by) / 5) * 5 || total + by));

  return (
    <Menu
      align="end"
      width={300}
      trigger={(p) => (
        <button
          type="button"
          className={`chip chip-button ${planned && total > planned ? 'chip-warn' : ''}`}
          title="Session length. Slide times are shares of it."
          {...p}
        >
          <Clock size={13} aria-hidden /> {minutesLabel(total)}{planned && planned !== Math.round(total) ? ` of ${planned}` : ''}
        </button>
      )}
    >
      {(close) => (
        <div className="session-menu">
          <div className="menu-label eyebrow">Session length</div>
          <div className="session-length">
            <button type="button" className="icon-btn" aria-label="5 minutes shorter" onClick={() => step(-5)} disabled={total <= SESSION_RANGE.min}><Minus size={15} /></button>
            <input
              className="input tabular"
              inputMode="decimal"
              value={draft}
              aria-label="Session length in minutes"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(Number(draft))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(Number(draft)); } }}
            />
            <span className="faint">min</span>
            <button type="button" className="icon-btn" aria-label="5 minutes longer" onClick={() => step(5)} disabled={total >= SESSION_RANGE.max}><Plus size={15} /></button>
          </div>
          <p className="session-note faint">
            {set
              ? <>Slide times are shares of this. Change it and every slide rescales. {shown > 0 && <>About {slideTimeLabel(minutesPerSlide(deck))} a slide.</>}</>
              : <>Not set yet: the slides add up to {minutesLabel(total)}. Set a length and slide times become shares of it.</>}
          </p>
          {planned && planned !== Math.round(total) && (
            <button type="button" className="menu-item" onClick={() => { close(); commit(planned); }}>
              <span>Match the lesson: {planned} min<span className="menu-detail">Every slide rescales to fit</span></span>
            </button>
          )}
          <div className="menu-sep" />
          <button type="button" className="menu-item" onClick={() => { close(); change(timeByNotes, 'session'); }} disabled={!shown}>
            <span>Share by the notes<span className="menu-detail">Slides with more to say get more time</span></span>
          </button>
          <button type="button" className="menu-item" onClick={() => { close(); change(timeEvenly, 'session'); }} disabled={!shown}>
            <span>Share evenly<span className="menu-detail">Every slide gets the same time</span></span>
          </button>
        </div>
      )}
    </Menu>
  );
}
