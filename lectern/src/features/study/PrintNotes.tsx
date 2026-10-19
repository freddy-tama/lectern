import { ArrowLeft, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { NotFound } from '../../app/App';
import { wording } from '../../core/deck/purpose';
import { deckMinutes, deckPurpose } from '../../core/deck/types';
import { getKind } from '../../core/kinds/registry';
import { minutesLabel } from '../../ui/format';
import { useLiveDeck } from '../present/useLiveDeck';
import { SlideView } from '../slides/SlideView';

/** A printable handout: each slide with its key notes. Presenter or learner version. */
export default function PrintNotes() {
  const { deckId = '' } = useParams();
  const { deck, slides } = useLiveDeck(deckId);
  const [forLearners, setForLearners] = useState(false);
  if (deck === undefined) return null;
  if (deck === null) return <NotFound message="This deck was deleted." />;
  const w = wording(deckPurpose(deck));
  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Link to={`/studio/${deck.id}`} className="btn btn-ghost btn-sm"><ArrowLeft size={15} /> Back</Link>
        <div className="segmented">
          <button type="button" aria-pressed={!forLearners} onClick={() => setForLearners(false)}>{w.handoutPresenter}</button>
          <button type="button" aria-pressed={forLearners} onClick={() => setForLearners(true)}>{w.handoutAudience}</button>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}><Printer size={15} /> Print or save as PDF</button>
      </div>
      <header className="print-head">
        <p className="eyebrow">{forLearners ? w.handoutAudienceHeading : 'Key notes'}</p>
        <h1 className="display">{deck.title}</h1>
        <p className="muted">{slides.length} slides · about {minutesLabel(deckMinutes(deck))}</p>
      </header>
      {slides.map((s, i) => {
        const def = getKind(s.kind);
        const n = s.notes;
        return (
          <section key={s.id} className="print-row">
            <div className="print-thumb"><SlideView slide={s} deck={deck} number={i + 1} count={slides.length} framed /></div>
            <div className="print-notes">
              <h2><span className="faint tabular">{i + 1}</span> {def ? def.heading(s.content) : 'Slide'}{!forLearners && <span className="faint print-min">{n.minutes} min</span>}</h2>
              {n.keyPoints.length > 0 && <ul>{n.keyPoints.map((p, k) => <li key={k}>{p}</li>)}</ul>}
              {n.script && (forLearners ? <p className="print-script">{n.script}</p> : <p className="print-script">{n.script}</p>)}
              {!forLearners && n.cues.length > 0 && <p className="faint">Cues: {n.cues.join(' · ')}</p>}
              {n.check && <p><strong>{forLearners ? w.handoutCheck : `${w.askEyebrow}:`}</strong> {n.check.question}{!forLearners && n.check.answer ? ` — ${n.check.answer}` : ''}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
