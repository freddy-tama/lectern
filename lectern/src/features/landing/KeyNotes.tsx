import { Clock, Download, FileDown, FileCode2, FlipHorizontal2, GraduationCap, MonitorPlay, Pause, Play, Printer, ScrollText } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { type SampleView, tryHref } from '../../app/try-samples';
import { type Deck, deckMinutes } from '../../core/deck/types';
import { formatClock } from '../../ui/hooks';
import { DEFAULT_PROMPTER_WPM } from '../present/prompter-defaults';
import { SlideView } from '../slides/SlideView';
import { Cta } from './Cta';
import { type Sample, TALK_ID, deckRun, sample, sampleDeck, slideHeading } from './samples';

type OutputId = 'presenter' | 'prompter' | 'study' | 'handout' | 'pptx';
type Field = 'script' | 'points' | 'cues' | 'check';

const OUTPUTS: { id: OutputId; label: string; icon: typeof MonitorPlay; uses: Field[]; blurb: string; open?: { view: SampleView; label: string } }[] = [
  { id: 'presenter', label: 'Presenter view', icon: MonitorPlay, uses: ['script', 'points', 'cues'], blurb: 'Script, cues and a timer beside the next slide. The room sees only the slide.', open: { view: 'presenter', label: 'Open presenter view' } },
  { id: 'prompter', label: 'Teleprompter', icon: ScrollText, uses: ['script', 'cues'], blurb: 'Your script scrolls at speaking pace, large enough to read from across the room.', open: { view: 'prompter', label: 'Open the teleprompter' } },
  { id: 'study', label: 'Study mode', icon: GraduationCap, uses: ['points', 'check'], blurb: 'Review alone: read, flip flashcards, mark what you know.', open: { view: 'study', label: 'Open study mode' } },
  { id: 'handout', label: 'Handout', icon: Printer, uses: ['points', 'check'], blurb: 'Print each slide with its key points, or save as PDF.', open: { view: 'print', label: 'Open the handout' } },
  { id: 'pptx', label: 'PowerPoint', icon: FileDown, uses: ['script', 'points', 'cues', 'check'], blurb: 'Download a .pptx. Key notes become speaker notes; charts and tables stay editable.' },
];

const FIELD_LABEL: Record<Field, string> = { script: 'Script', points: 'Key points', cues: 'Cues', check: 'Check question' };

type FileKind = 'pptx' | 'html';

/** Makes a file from the in-memory sample talk on click. The heavy exporters load only then. */
function useDownloads(deck: Deck | null) {
  const [busy, setBusy] = useState<FileKind | null>(null);
  const [failed, setFailed] = useState<FileKind | null>(null);
  const make = async (kind: FileKind) => {
    if (!deck || busy) return;
    setBusy(kind);
    setFailed(null);
    try {
      if (kind === 'pptx') {
        const { exportPptx } = await import('../studio/download');
        await exportPptx(deck, 'animate');
      } else {
        const { deckHtml } = await import('../share/standalone');
        const { downloadBlob, safeName } = await import('../studio/download');
        downloadBlob(new Blob([await deckHtml(deck)], { type: 'text/html' }), `${safeName(deck.title)}.html`);
      }
    } catch (error) {
      console.error('Could not make the sample file', error);
      setFailed(kind);
    } finally {
      setBusy(null);
    }
  };
  return { busy, failed, make };
}

function DownloadButton({ kind, label, downloads, className = 'lp-btn-quiet' }: { kind: FileKind; label: string; downloads: ReturnType<typeof useDownloads>; className?: string }) {
  const busy = downloads.busy === kind;
  const Icon = kind === 'pptx' ? Download : FileCode2;
  return (
    <button type="button" className={`lp-btn lp-btn-sm ${className}`} onClick={() => downloads.make(kind)} aria-busy={busy || undefined} disabled={downloads.busy !== null && !busy}>
      <Icon size={15} aria-hidden /> {busy ? 'Preparing…' : label}
    </button>
  );
}

export function KeyNotes({ reduced }: { reduced: boolean }) {
  const samples = useMemo(() => ['s_mt_03', 's_mt_04', 's_mt_05', 's_mt_06'].map(sample).filter((s): s is Sample => Boolean(s)), []);
  const deck = useMemo(() => sampleDeck(TALK_ID), []);
  const [active, setActive] = useState<OutputId>('presenter');
  const [visited, setVisited] = useState<Set<OutputId>>(() => new Set(['presenter']));
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();
  const downloads = useDownloads(deck);
  const main = samples[1];
  if (!main || !deck) return null;
  const n = main.slide.notes;
  const output = OUTPUTS.find((o) => o.id === active) ?? OUTPUTS[0];

  const select = (id: OutputId) => {
    setActive(id);
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)));
  };

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const last = OUTPUTS.length - 1;
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i === last ? 0 : i + 1)
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i === 0 ? last : i - 1)
      : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (to < 0) return;
    e.preventDefault();
    select(OUTPUTS[to].id);
    tabs.current[to]?.focus();
  };

  const used = (f: Field) => output.uses.includes(f);

  return (
    <section id="key-notes" className="lp-section kn" aria-labelledby="kn-title" tabIndex={-1}>
      <div className="lp-container">
        <div className="lp-head lp-head-center">
          <p className="lp-eyebrow">Key notes</p>
          <h2 id="kn-title" className="lp-h2">Write it once. <em>Use it five ways.</em></h2>
          <p className="lp-sub">
            Every slide has key notes: a script, the points that matter, delivery cues and a question to check
            understanding. Lectern turns them into everything you need before, during and after the talk.
          </p>
        </div>

        <div className="kn-layout">
          <article className="kn-source" aria-label="Key notes for one slide">
            <div className="kn-source-head">
              <span className="lp-eyebrow">Slide {main.number} · Key notes</span>
              <span className="kn-min"><Clock size={13} aria-hidden /> {n.minutes} min</span>
            </div>
            <SlideView slide={main.slide} deck={main.deck} number={main.number} count={main.count} framed label={`${slideHeading(main.slide)} slide`} />
            <dl className="kn-fields">
              <div className={`kn-field ${used('script') ? 'is-used' : ''}`}>
                <dt>{FIELD_LABEL.script}</dt>
                <dd className="kn-script">{n.script}</dd>
              </div>
              <div className={`kn-field ${used('points') ? 'is-used' : ''}`}>
                <dt>{FIELD_LABEL.points}</dt>
                <dd><ul className="kn-points">{n.keyPoints.map((p) => <li key={p}>{p}</li>)}</ul></dd>
              </div>
              <div className={`kn-field ${used('cues') ? 'is-used' : ''}`}>
                <dt>{FIELD_LABEL.cues}</dt>
                <dd className="kn-cues">{n.cues.map((c) => <span key={c} className="lp-cue">{c}</span>)}</dd>
              </div>
              {n.check && (
                <div className={`kn-field ${used('check') ? 'is-used' : ''}`}>
                  <dt>{FIELD_LABEL.check}</dt>
                  <dd>{n.check.question}</dd>
                </div>
              )}
            </dl>
          </article>

          <div className="kn-outputs">
            <div className="kn-tabs" role="tablist" aria-label="Where key notes go">
              {OUTPUTS.map((o, i) => {
                const Icon = o.icon;
                const selected = o.id === active;
                return (
                  <button
                    key={o.id}
                    ref={(el) => { tabs.current[i] = el; }}
                    type="button"
                    role="tab"
                    id={`${base}-tab-${o.id}`}
                    aria-selected={selected}
                    aria-controls={`${base}-panel-${o.id}`}
                    tabIndex={selected ? 0 : -1}
                    className={`kn-tab ${selected ? 'is-active' : ''}`}
                    onClick={() => select(o.id)}
                    onKeyDown={(e) => onKey(e, i)}
                  >
                    <Icon size={16} aria-hidden /> {o.label}
                  </button>
                );
              })}
            </div>
            {OUTPUTS.map((o) => (
              <div
                key={o.id}
                className="kn-panel"
                role="tabpanel"
                id={`${base}-panel-${o.id}`}
                aria-labelledby={`${base}-tab-${o.id}`}
                tabIndex={0}
                hidden={o.id !== active}
              >
                {visited.has(o.id) && (
                  <>
                    <div className="kn-panel-head">
                      <div>
                        <p className="kn-blurb">{o.blurb}</p>
                        <p className="kn-uses">
                          Uses {o.uses.map((f) => FIELD_LABEL[f].toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' and $1')}
                        </p>
                      </div>
                      {o.open
                        ? <Cta to={tryHref('talk', o.open.view)} variant="quiet" className="lp-btn-sm kn-open">{o.open.label}</Cta>
                        : <DownloadButton kind="pptx" label="Download .pptx" downloads={downloads} className="lp-btn-quiet kn-open" />}
                    </div>
                    <div className="kn-mock">
                      <span className="mock-tag">Illustration</span>
                      {o.id === 'presenter' && <PresenterMock samples={samples} deck={deck} />}
                      {o.id === 'prompter' && <PrompterMock samples={samples} reduced={reduced} />}
                      {o.id === 'study' && <StudyMock main={main} />}
                      {o.id === 'handout' && <HandoutMock samples={samples} />}
                      {o.id === 'pptx' && <PptxMock samples={samples} />}
                    </div>
                  </>
                )}
              </div>
            ))}

            <div className="kn-try">
              <p className="kn-try-label">Try the real thing on the sample talk:</p>
              <div className="kn-try-actions">
                <Cta to={tryHref('talk', 'present')} variant="brand" className="lp-btn-sm"><Play size={14} aria-hidden /> Present</Cta>
                <DownloadButton kind="pptx" label="Download .pptx" downloads={downloads} />
                <DownloadButton kind="html" label="Download web page" downloads={downloads} />
              </div>
              {downloads.failed && (
                <p className="kn-error" role="alert">
                  Couldn't make the file. Try again.
                  <button type="button" className="lp-btn lp-btn-link" onClick={() => downloads.failed && downloads.make(downloads.failed)}>Retry</button>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PresenterMock({ samples, deck }: { samples: Sample[]; deck: Deck }) {
  const [, cur, next] = samples;
  const n = cur.slide.notes;
  const clicks = useMemo(() => {
    const run = deckRun(deck);
    return run.steps[run.slides.findIndex((s) => s.id === cur.slide.id)] ?? 0;
  }, [deck, cur]);
  // The same planned length the real presenter view shows.
  const total = formatClock(deckMinutes(deck) * 60_000);
  return (
    <div className="mock mock-presenter" role="img" aria-label={`Presenter view: slide ${cur.number} with its script and cues, the next slide, and a clock at 0:00 of ${total}`}>
      <div className="mp-top">
        <strong>{cur.deck.title}</strong>
        <span className="mp-clock">
          <span className="mp-time">0:00</span>
          <span className="mp-of">of {total}</span>
          <span className="mp-pace">On time</span>
        </span>
      </div>
      <div className="mp-main">
        <div className="mp-current">
          <SlideView slide={cur.slide} deck={cur.deck} number={cur.number} count={cur.count} step={0} framed />
          <div className="mp-under">
            <span>Slide {cur.number} of {cur.count}</span>
            {clicks > 0 && <span className="mp-step">{clicks} more {clicks === 1 ? 'click' : 'clicks'} on this slide</span>}
          </div>
        </div>
        <div className="mp-side">
          {next && (
            <div className="mp-next">
              <span className="mp-label">Next</span>
              <SlideView slide={next.slide} deck={next.deck} number={next.number} count={next.count} framed />
            </div>
          )}
          <div className="mp-notes">
            <div className="mp-cues">{n.cues.map((c) => <span key={c} className="mp-cue">{c}</span>)}</div>
            <p>{n.script}</p>
            <span className="mp-label">Remember</span>
            <ul>{n.keyPoints.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function PrompterMock({ samples, reduced }: { samples: Sample[]; reduced: boolean }) {
  // Scrolls only after a click on Play, and never under reduced motion.
  const [playing, setPlaying] = useState(false);
  const run = samples.slice(1);
  return (
    <div className={`mock mock-prompter ${playing && !reduced ? '' : 'is-paused'}`}>
      <div className="tp-viewport" role="img" aria-label={`Teleprompter: the script for slides ${run[0]?.number ?? ''} to ${run[run.length - 1]?.number ?? ''} in large type, with the reading line`}>
        <div className="tp-text" aria-hidden>
          {run.map((s) => (
            <section key={s.slide.id} className="tp-section">
              <div className="tp-marker"><span>{s.number}</span>{slideHeading(s.slide)}</div>
              <p>{s.slide.notes.script}</p>
              {s.slide.notes.cues.length > 0 && <p className="tp-cues">{s.slide.notes.cues.join(' · ')}</p>}
            </section>
          ))}
        </div>
      </div>
      <div className="tp-line" aria-hidden />
      <div className="tp-hud">
        {!reduced && (
          <button type="button" className="tp-btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause teleprompter preview' : 'Play teleprompter preview'}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
        )}
        <span className="tp-value">{DEFAULT_PROMPTER_WPM} wpm</span>
        <span className="tp-sep" aria-hidden />
        <span className="tp-value"><FlipHorizontal2 size={14} aria-hidden /> Mirror off</span>
      </div>
    </div>
  );
}

function StudyMock({ main }: { main: Sample }) {
  const [shown, setShown] = useState(false);
  const n = main.slide.notes;
  const answerId = useId();
  return (
    <div className="mock mock-study">
      <div className="st-head">
        <span>Study · Slide {main.number} of {main.count}</span>
        <span className="st-bar" aria-hidden><span style={{ width: `${(main.number / main.count) * 100}%` }} /></span>
      </div>
      <div className="st-body">
        <SlideView slide={main.slide} deck={main.deck} number={main.number} count={main.count} framed label={`${slideHeading(main.slide)} slide`} />
        <div className="st-card">
          <span className="lp-eyebrow">Remember</span>
          <ul>{n.keyPoints.map((p) => <li key={p}>{p}</li>)}</ul>
          {n.check && (
            <div className="st-check">
              <span className="lp-eyebrow">Check yourself</span>
              <p className="st-q">{n.check.question}</p>
              <p id={answerId} className="st-answer" hidden={!shown}>{n.check.answer}</p>
              <button type="button" className="lp-btn lp-btn-quiet lp-btn-sm" aria-expanded={shown} aria-controls={answerId} onClick={() => setShown((s) => !s)}>
                {shown ? 'Hide answer' : 'Show answer'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HandoutMock({ samples }: { samples: Sample[] }) {
  const rows = samples.slice(0, 2);
  return (
    <div className="mock mock-handout" role="img" aria-label={`Printed handout: slides ${rows.map((r) => r.number).join(' and ')}, each beside its key points and a check question`}>
      <div className="ho-page">
        <header className="ho-head">
          <strong>{rows[0]?.deck.title}</strong>
          <span>Handout</span>
        </header>
        {rows.map((s) => (
          <div key={s.slide.id} className="ho-row">
            <SlideView slide={s.slide} deck={s.deck} number={s.number} count={s.count} framed />
            <div className="ho-notes">
              <h4>{s.number}. {slideHeading(s.slide)}</h4>
              <ul>{s.slide.notes.keyPoints.slice(0, 3).map((p) => <li key={p}>{p}</li>)}</ul>
              {s.slide.notes.check && <p className="ho-check"><strong>Check:</strong> {s.slide.notes.check.question}</p>}
              <div className="ho-lines" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PptxMock({ samples }: { samples: Sample[] }) {
  const cur = samples[1];
  const n = cur.slide.notes;
  return (
    <div className="mock mock-pptx" role="img" aria-label={`The exported PowerPoint file: slide ${cur.number}, an editable chart, with the key notes as speaker notes`}>
      <div className="px-bar"><FileDown size={14} aria-hidden /> {cur.deck.title}.pptx</div>
      <div className="px-body">
        <ol className="px-rail">
          {samples.slice(0, 3).map((s) => (
            <li key={s.slide.id} className={s === cur ? 'is-active' : ''}>
              <span>{s.number}</span>
              <SlideView slide={s.slide} deck={s.deck} number={s.number} count={s.count} framed />
            </li>
          ))}
        </ol>
        <div className="px-main">
          <div className="px-slide">
            <SlideView slide={cur.slide} deck={cur.deck} number={cur.number} count={cur.count} framed />
            <span className="px-tag">Editable chart</span>
          </div>
          <div className="px-notes">
            <span className="px-notes-label">Speaker notes</span>
            <p>{n.script}</p>
            <p><strong>Key points:</strong> {n.keyPoints.join('; ')}</p>
            {n.cues.length > 0 && <p><strong>Cues:</strong> {n.cues.join('; ')}</p>}
            {n.check && <p><strong>Check:</strong> {n.check.question} {n.check.answer}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
