// Slides being written from an approved outline. Each batch shows up in the strip as it lands;
// a stopped or failed job offers to continue with only the missing slides.

import { AlertCircle, History, Loader2, Play, Save, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { draftToDeck } from '../../core/deck/draft';
import type { Deck, Slide } from '../../core/deck/types';
import { getKind } from '../../core/kinds/registry';
import { type DraftJob, jobProgress } from '../../data/draft-jobs';
import { KindIcon } from '../../ui/KindIcon';
import { SlideView } from '../slides/SlideView';
import { placePictures } from './make';

/** The job's pictures as files and object URLs, for previews. The URLs are freed when the page closes. */
export function useJobPictures(job: Pick<DraftJob, 'id' | 'pictures'> | null | undefined) {
  const id = job?.id;
  const count = job?.pictures.length ?? 0;
  // Pictures never change within a job; they are only dropped once it is done.
  const pics = useMemo(
    () => (job?.pictures ?? []).map((p) => ({ file: new File([p.blob], p.name, { type: p.blob.type }), url: URL.createObjectURL(p.blob) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, count],
  );
  useEffect(() => () => pics.forEach((p) => URL.revokeObjectURL(p.url)), [pics]);
  return pics;
}

/** The written slides as a deck the strip can draw, with pictures shown from this browser. */
function usePreview(job: DraftJob, pics: { file: File; url: string }[]) {
  const [preview, setPreview] = useState<{ deck: Deck; byNumber: Map<number, Slide> } | null>(null);
  useEffect(() => {
    let alive = true;
    const plan = job.decks[0]!;
    const files = pics.map((p) => p.file);
    const written = plan.slides;
    placePictures(
      { title: plan.title, slides: written.map((s) => ({ kind: s.kind, content: s.content, notes: s.notes })) },
      files,
      async (f) => pics[files.indexOf(f)]?.url ?? '',
    ).then((draft) => {
      if (!alive) return;
      const deck = draftToDeck(draft, job.settings);
      setPreview({ deck, byNumber: new Map(written.map((s, i) => [s.number, deck.slides[i]!])) });
    });
    return () => { alive = false; };
  }, [job, pics]);
  return preview;
}

interface Props {
  job: DraftJob;
  running: boolean;
  /** "<deck key>:<number>" of the slides being written now. */
  writing: ReadonlySet<string>;
  pictures: { file: File; url: string }[];
  saving: boolean;
  onStop(): void;
  onContinue(): void;
  onKeep(): void;
  onDiscard(): void;
}

export function DraftingView({ job, running, writing, pictures, saving, onStop, onContinue, onKeep, onDiscard }: Props) {
  const plan = job.decks[0]!;
  const preview = usePreview(job, pictures);
  const { written, planned } = jobProgress(job);
  const failed = new Set(plan.batches.filter((b) => b.status === 'failed').flatMap((b) => b.numbers));
  const now = [...writing].filter((k) => k.startsWith(`${plan.key}:`)).length;
  // After the last slide, every slide is checked against the layout before the deck is saved.
  const checking = running && !!job.checking;
  return (
    <section className="ad-drafting" aria-labelledby="ad-drafting-title">
      <header className="ad-result-head">
        <p className={`eyebrow ${running ? '' : 'ad-stopped'}`}>{checking ? 'Checking every slide fits' : running ? 'Writing the slides' : 'Drafting stopped'}</p>
        <h1 id="ad-drafting-title" className="display">{plan.title}</h1>
        <p className="muted tabular" aria-live="polite">
          {checking ? `${planned} slides written · shortening any that don’t fit` : `${written} of ${planned} slides written${running && now ? ` · writing ${now} now` : ''}`}
        </p>
        <span className="progress ad-drafting-progress" role="progressbar" aria-valuemin={0} aria-valuemax={planned} aria-valuenow={written} aria-label="Slides written">
          <span style={{ width: `${planned ? Math.round((written / planned) * 100) : 0}%` }} />
        </span>
      </header>

      {!running && (
        <div className="ad-drafting-stop" role="status">
          {job.error && <p className="ad-error"><AlertCircle size={15} /> {job.error}</p>}
          <div className="ad-result-actions">
            <button type="button" className="btn btn-brand btn-lg" onClick={onContinue} disabled={saving}>
              <Play size={16} /> Continue drafting ({written} of {planned} slides)
            </button>
            {written > 0 && (
              <button type="button" className="btn btn-secondary btn-lg" onClick={onKeep} disabled={saving}>
                {saving ? <><Loader2 size={16} className="spin" /> Saving…</> : <><Save size={16} /> Save the deck as it is</>}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-lg" onClick={onDiscard} disabled={saving}><Trash2 size={16} /> Discard</button>
          </div>
          {written > 0 && <p className="faint ad-drafting-help">Saving now keeps the unwritten slides with their heading and point from the outline.</p>}
        </div>
      )}

      <ol className="ad-filmstrip" aria-label="Slides">
        {plan.outline.map((s, i) => {
          const n = i + 1;
          const slide = preview?.byNumber.get(n);
          const state = slide ? 'done' : writing.has(`${plan.key}:${n}`) ? 'writing' : failed.has(n) ? 'failed' : 'waiting';
          return (
            <li key={s.id} className={`ad-thumb is-${state}`}>
              {slide && preview ? (
                <SlideView slide={slide} deck={preview.deck} number={n} count={planned} framed />
              ) : (
                <div className="ad-slot">
                  <span className="ad-slot-kind"><KindIcon name={getKind(s.kind)?.icon ?? 'square'} size={14} /> {getKind(s.kind)?.label ?? s.kind}</span>
                  <strong>{s.title || 'Untitled slide'}</strong>
                  <span className="ad-slot-state">
                    {state === 'writing' && <><Loader2 size={13} className="spin" /> Writing…</>}
                    {state === 'failed' && <><AlertCircle size={13} /> Not written</>}
                    {state === 'waiting' && (running ? 'Waiting' : 'Not written yet')}
                  </span>
                </div>
              )}
              <span>{n}</span>
            </li>
          );
        })}
      </ol>

      {running && (
        <div className="ad-result-foot">
          {checking ? (
            <>
              <p className="faint">Skipping the check saves the deck now, with the fixes made so far.</p>
              <button type="button" className="btn btn-ghost" onClick={onStop}><Square size={14} /> Skip the check</button>
            </>
          ) : (
            <>
              <p className="faint">You can leave this page. Drafting carries on, and a closed tab can pick up where it stopped.</p>
              <button type="button" className="btn btn-ghost" onClick={onStop}><Square size={14} /> Stop</button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Offered on the deck maker when a job is waiting: an outline to approve, or slides left to write. */
export function ResumeCard({ job, onOpen, onDiscard }: { job: DraftJob; onOpen(): void; onDiscard(): void }) {
  const plan = job.decks[0]!;
  const { written, planned } = jobProgress(job);
  const outline = job.status === 'outline';
  return (
    <section className="card ad-resume" aria-labelledby="ad-resume-title">
      <span className="ad-resume-icon" aria-hidden><History size={18} /></span>
      <div className="ad-resume-body">
        <strong id="ad-resume-title">{plan.title || 'Untitled deck'}</strong>
        <span>{outline ? `Outline of ${planned} slides, waiting for you to check it` : `${written} of ${planned} slides written`}</span>
        <span className="faint">Making another deck replaces it.</span>
      </div>
      <div className="ad-resume-actions">
        <button type="button" className="btn btn-brand" onClick={onOpen}>
          {outline ? 'Review the outline' : `Continue drafting (${written} of ${planned} slides)`}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDiscard}>Discard</button>
      </div>
    </section>
  );
}
