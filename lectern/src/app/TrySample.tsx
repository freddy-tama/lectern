// /try/:sample/:view opens a sample deck in one of its views. It puts the sample back
// first if it was deleted (never over someone's edits), so links from the front page
// and the setup screen always land on a working deck. /try/course opens the sample course.

import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { db } from '../data/db';
import { ensureSampleDeck, seedOnce } from '../data/repo';
import { markWelcomed } from '../features/landing/hooks';
import { NotFound } from './App';
import { SAMPLES, type SampleName, type SampleView, VIEWS } from './try-samples';

const COURSE_ID = 'course_earth';

/** How each sample is named while it opens. */
const NAMES: Record<SampleName | 'course', string> = {
  talk: 'sample talk',
  report: 'sample report',
  lesson: 'sample lesson',
  writing: 'sample workshop',
  course: 'sample course',
};

const isSample = (s: string): s is SampleName => Object.hasOwn(SAMPLES, s);
const isView = (v: string): v is SampleView => (VIEWS as readonly string[]).includes(v);

export default function TrySample() {
  const { sample = '', view } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const course = sample === 'course' && view === undefined;
  const valid = course || (isSample(sample) && (view === undefined || isView(view)));

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const open = async () => {
      if (course) {
        await seedOnce();
        return (await db.courses.get(COURSE_ID)) ? `/courses/${COURSE_ID}` : '/';
      }
      const id = SAMPLES[sample as SampleName];
      return (await ensureSampleDeck(id)) ? `/${view ?? 'studio'}/${id}${search}` : null;
    };
    open().then(
      (to) => {
        if (cancelled) return;
        if (!to) { setFailed(true); return; }
        markWelcomed();
        navigate(to, { replace: true });
      },
      (error: unknown) => {
        console.error('Could not open the sample', error);
        if (!cancelled) setFailed(true);
      },
    );
    return () => { cancelled = true; };
  }, [valid, course, sample, view, search, navigate]);

  if (!valid) return <NotFound />;
  const name = NAMES[sample as SampleName | 'course'];

  if (failed) {
    return (
      <div className="not-found" role="alert">
        <h1 className="display">Can’t open the {name}</h1>
        <p className="muted">This browser won’t let Lectern save here, so the sample can’t open. Try a normal window.</p>
        <Link className="btn btn-primary" to="/welcome">Back to the intro</Link>
      </div>
    );
  }

  return (
    <div className="page-loading" role="status">
      <div style={{ display: 'grid', justifyItems: 'center', gap: 14 }}>
        <div className="spinner" aria-hidden />
        <p>Opening the {name}…</p>
      </div>
    </div>
  );
}
