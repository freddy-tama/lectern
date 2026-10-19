import { Check, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { getKind } from '../../core/kinds/registry';
import { SlideView } from '../slides/SlideView';
import { type Sample, sample } from './samples';

const NOTES = `Q3 update for leadership

- weekly users 128k, up 22%
- onboarding now 74%, churn down to 4.6%
- shipped: workspaces, mobile beta, faster search
- mobile app 2 weeks late (sync bug)
- Q4: crash fixes first, then offline mode`;

const POINTS = [
  'Chooses charts, timelines and steps where they fit',
  'Writes a script, cues and a check question for every slide',
  'Matches the purpose: talk, pitch, report or lesson',
];

export function Draft() {
  const drafted = useMemo(() => ['s_q3_01', 's_q3_02', 's_q3_06'].map(sample).filter((s): s is Sample => Boolean(s)), []);
  return (
    <section id="draft" className="lp-section draft" aria-labelledby="draft-title" tabIndex={-1}>
      <div className="lp-container draft-layout">
        <div className="draft-copy" data-reveal>
          <p className="lp-eyebrow">AI drafting</p>
          <h2 id="draft-title" className="lp-h2">From rough notes to a <em>first draft.</em></h2>
          <p className="lp-sub">
            Paste an outline or a page of notes. Lectern picks the slide types, writes the slides and drafts key
            notes for each one. Every word stays yours to edit.
          </p>
          <ul className="draft-points">
            {POINTS.map((p) => <li key={p}><Check size={16} aria-hidden /> {p}</li>)}
          </ul>
        </div>

        <div className="draft-visual" data-reveal aria-hidden>
          <div className="draft-notes">
            <span className="lp-eyebrow">Your notes</span>
            <pre>{NOTES}</pre>
          </div>
          <div className="draft-arrow"><Sparkles size={16} /> Draft deck</div>
          <ol className="draft-out">
            {drafted.map((s, i) => (
              <li key={s.slide.id} style={{ '--i': i } as React.CSSProperties}>
                <SlideView slide={s.slide} deck={s.deck} number={s.number} count={s.count} framed />
                <span className="draft-chip">
                  <span>{getKind(s.slide.kind)?.label}</span>
                  <span className="draft-chip-notes">Key notes drafted</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
