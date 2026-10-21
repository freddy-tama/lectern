import { ChartColumn, MousePointerClick, Ruler, Table2 } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { KindIcon } from '../../ui/KindIcon';
import { SlideView } from '../slides/SlideView';
import { useSeen } from './hooks';
import { KIND_GROUPS, type KindSample, type Sample, kindSamples, liveSamples } from './samples';

const FACTS = [
  { icon: ChartColumn, title: 'Charts stay editable in PowerPoint', body: 'Columns, bars, lines, pies and doughnuts open in PowerPoint as native charts.' },
  { icon: Table2, title: 'Real tables, not pictures', body: 'Paste rows from a spreadsheet. They export as a table, not a picture.' },
  { icon: MousePointerClick, title: 'Reveal on click', body: 'Points, steps, milestones and answers can appear one click at a time.' },
  { icon: Ruler, title: 'Too much text gets a warning or a split', body: 'Titles and points resize within their layout. A slide that still holds too much is flagged, and can split in two.' },
];

export function SlideTypes() {
  const items = useMemo(kindSamples, []);
  const live = useMemo(liveSamples, []);
  const groups = KIND_GROUPS.map((g) => ({ group: g, items: items.filter((i) => i.def.group === g) })).filter((g) => g.items.length);

  return (
    <section id="slide-types" className="lp-section types" aria-labelledby="types-title" tabIndex={-1}>
      <div className="lp-container">
        <div className="lp-head">
          <p className="lp-eyebrow">Slide types</p>
          <h2 id="types-title" className="lp-h2">{items.length} slide types that <em>lay themselves out.</em></h2>
          <p className="lp-sub">
            Every slide here is drawn by the same engine as the editor and the PowerPoint export; media types play when
            you present. <span className="lp-tag">Sample content</span>
          </p>
        </div>

        <div className="types-live">
          {live.timer && <LiveCard item={live.timer} label="Timer slide, live" caption="Timer · runs on the slide" icon="timer" />}
          {live.picker && <LiveCard item={live.picker} label="Random picker slide, live" caption="Random picker · spin it" icon="dices" />}
        </div>

        {groups.map(({ group, items: kinds }) => (
          <div key={group} className="types-group">
            <h3 className="types-group-title">{group}</h3>
            <ul className="types-grid">
              {kinds.map((item) => <KindCard key={item.def.kind} item={item} />)}
            </ul>
          </div>
        ))}

        <ul className="fact-grid">
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

/** A slide that runs here: a still frame until it scrolls near, then the real sandboxed page. */
function LiveCard({ item, label, caption, icon }: { item: Sample; label: string; caption: string; icon: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref, '0px');
  return (
    <div ref={ref} className="live-card">
      <SlideView slide={item.slide} deck={item.deck} number={item.number} count={item.count} framed live={seen} label={label} />
      <p className="kind-card-caption">
        <span className="kind-card-icon"><KindIcon name={icon} size={14} /></span>
        <span className="kind-card-name">{caption}</span>
      </p>
    </div>
  );
}

function KindCard({ item }: { item: KindSample }) {
  if (item.tile) {
    return (
      <li className="kind-card kind-tile">
        <div className="kind-tile-face">
          <span className="kind-tile-icon"><KindIcon name={item.def.icon} size={22} /></span>
          <span className="kind-tile-name">{item.def.label}</span>
          <span className="kind-tile-text">{item.tile}</span>
        </div>
        <p className="kind-card-caption">
          <span className="kind-card-icon"><KindIcon name={item.def.icon} size={14} /></span>
          <span className="kind-card-name">{item.def.label}</span>
        </p>
      </li>
    );
  }
  return (
    <li className="kind-card">
      <SlideView slide={item.slide} deck={item.deck} number={item.number} count={item.count} framed label={`${item.def.label} slide`} />
      <p className="kind-card-caption">
        <span className="kind-card-icon"><KindIcon name={item.def.icon} size={14} /></span>
        <span className="kind-card-name">{item.def.label}</span>
      </p>
    </li>
  );
}
