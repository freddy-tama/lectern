import { ChartColumn, MousePointerClick, Pause, Play, Ruler, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { KindIcon } from '../../ui/KindIcon';
import { SlideView } from '../slides/SlideView';
import { type KindSample, kindSamples } from './samples';

const FACTS = [
  { icon: ChartColumn, title: 'Editable charts', body: 'Columns, bars, lines, pies and doughnuts open in PowerPoint as native charts.' },
  { icon: Table2, title: 'Real tables', body: 'Paste rows from a spreadsheet. They export as a table, not a picture.' },
  { icon: MousePointerClick, title: 'Reveal on click', body: 'Points, steps, milestones and answers can appear one click at a time.' },
  { icon: Ruler, title: 'Text that fits', body: 'Titles and points resize within their layout, so nothing runs off the slide.' },
];

export function SlideTypes({ reduced }: { reduced: boolean }) {
  const items = useMemo(kindSamples, []);
  const [paused, setPaused] = useState(false);
  const rows = [items.filter((_, i) => i % 2 === 0), items.filter((_, i) => i % 2 === 1)];

  return (
    <section id="slides" className="lp-section types" aria-labelledby="types-title" tabIndex={-1}>
      <div className="lp-container">
        <div className="lp-head lp-head-split" data-reveal>
          <div>
            <p className="lp-eyebrow">Slide types</p>
            <h2 id="types-title" className="lp-h2">{items.length} layouts that set <em>themselves.</em></h2>
            <p className="lp-sub">
              Type the content and Lectern handles the type, spacing and hierarchy. Here is every slide type,
              drawn live from the sample decks.
            </p>
          </div>
          {!reduced && (
            <button type="button" className="lp-btn lp-btn-quiet lp-btn-sm" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
              {paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />} {paused ? 'Play motion' : 'Pause motion'}
            </button>
          )}
        </div>
      </div>

      <div className={`marquee ${reduced ? 'is-static' : ''} ${paused ? 'is-paused' : ''}`} data-reveal>
        {rows.map((row, r) => (
          <div key={r} className={`marquee-row ${r ? 'is-reverse' : ''}`} tabIndex={reduced ? 0 : undefined} aria-label={reduced ? `Slide types, row ${r + 1}` : undefined} role={reduced ? 'region' : undefined}>
            <ul className="marquee-track" style={{ '--count': row.length } as React.CSSProperties}>
              {row.map((item) => <KindCard key={item.def.kind} item={item} />)}
              {!reduced && row.map((item) => <KindCard key={`${item.def.kind}-again`} item={item} hidden />)}
            </ul>
          </div>
        ))}
      </div>

      <div className="lp-container">
        <ul className="fact-grid" data-reveal>
          {FACTS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="fact">
              <span className="fact-icon"><Icon size={18} aria-hidden /></span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function KindCard({ item, hidden }: { item: KindSample; hidden?: boolean }) {
  return (
    <li className="kind-card" aria-hidden={hidden || undefined}>
      <SlideView slide={item.slide} deck={item.deck} number={item.number} count={item.count} framed label={`${item.def.label} slide`} />
      <div className="kind-card-caption">
        <span className="kind-card-icon"><KindIcon name={item.def.icon} size={14} /></span>
        <span className="kind-card-name">{item.def.label}</span>
      </div>
    </li>
  );
}
