import { ArrowRight, Layers } from 'lucide-react';
import { useMemo } from 'react';
import { type SampleName, SAMPLES, tryHref } from '../../app/try-samples';
import { SlideView } from '../slides/SlideView';
import { Cta } from './Cta';
import { type Sample, courseSample, sample, sampleData } from './samples';

const CARDS: { name: SampleName; title: string; body: string; cover: string | null; link: string }[] = [
  { name: 'report', title: 'Quarterly report', body: 'Charts and tables that stay editable in PowerPoint.', cover: 's_q3_03', link: 'Present the sample report' },
  { name: 'lesson', title: 'Science lesson', body: 'Key terms and checks become flashcards and a quiz.', cover: 's_wc_07', link: 'Present the sample lesson' },
  { name: 'writing', title: 'Writing workshop', body: 'A workshop with steps, examples and practice.', cover: null, link: 'Present the sample workshop' },
];

/** A deck's first visible slide, for a cover. */
function coverOf(deckId: string): Sample | null {
  const first = sampleData().decks.find((d) => d.id === deckId)?.slides.find((s) => !s.hidden);
  return first ? sample(first.id) : null;
}

export function Uses() {
  const covers = useMemo(() => CARDS.map((c) => (c.cover ? sample(c.cover) : coverOf(SAMPLES[c.name]))), []);
  const course = useMemo(() => courseSample('course_earth'), []);
  const decks = sampleData().decks;

  return (
    <section id="uses" className="lp-section uses" aria-labelledby="uses-title" tabIndex={-1}>
      <div className="lp-container">
        <div className="lp-head">
          <p className="lp-eyebrow">Uses</p>
          <h2 id="uses-title" className="lp-h2">A talk is <em>one use.</em></h2>
          <p className="lp-sub">Each deck says what it's for, and Lectern adjusts the wording of its notes, its review mode and its drafting.</p>
        </div>

        <ul className="uses-grid">
          {CARDS.map((c, i) => {
            const cover = covers[i];
            return (
              <li key={c.name} className="use-card">
                <div className="use-cover">
                  {cover && <SlideView slide={cover.slide} deck={cover.deck} number={cover.number} count={cover.count} framed label={`${c.title} cover slide`} />}
                </div>
                <div className="use-body">
                  <h3 className="use-title">{c.title} <span className="lp-tag use-tag">Sample</span></h3>
                  <p className="use-text">{c.body}</p>
                  <Cta to={tryHref(c.name, 'present')} variant="link" className="use-go">{c.link} <ArrowRight size={15} aria-hidden /></Cta>
                </div>
              </li>
            );
          })}

          {course && (
            <li className="use-card use-course">
              <div className="use-weeks" style={{ '--course': `var(--c-${course.course.color})` } as React.CSSProperties}>
                <p className="use-weeks-head"><Layers size={15} aria-hidden /> <span>{course.course.title}</span><span className="lp-tag">Sample</span></p>
                <ol className="use-week-list" aria-label={`${course.course.title}, week by week`}>
                  {course.weeks.map((w) => {
                    const lesson = w.lessons.find((l) => l.deckId) ?? w.lessons[0];
                    const deck = lesson?.deckId ? decks.find((d) => d.id === lesson.deckId) : undefined;
                    const first = deck?.slides.find((s) => !s.hidden);
                    return (
                      <li key={w.week} className="use-week">
                        {deck && first
                          ? <span className="use-week-thumb"><SlideView slide={first} deck={deck} number={1} count={deck.slides.length} label={`${deck.title} deck`} /></span>
                          : <span className="use-week-thumb is-empty" aria-hidden />}
                        <span className="use-week-text">
                          <span className="use-week-num">Week {w.week}{!deck && ' · no deck yet'}</span>
                          <span className="use-week-title">{lesson?.title ?? w.title}</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
              <div className="use-body">
                <h3 className="use-title">A whole course <span className="use-optional">(optional)</span></h3>
                <p className="use-text">
                  Group decks into weeks, see them on a calendar and export to any calendar app (.ics). Record a session
                  and it's transcribed on this device; the first run downloads a speech model of about 40–600 MB, depending on the quality you pick.
                  Switch courses off if you only make decks.
                </p>
                <Cta to="/try/course" variant="link" className="use-go">See the sample course <ArrowRight size={15} aria-hidden /></Cta>
              </div>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
