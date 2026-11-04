// /finished: present slides finished elsewhere, as they are. The presenter brings a
// PowerPoint (for its words and speaker notes) and a PDF of it (for the look), or pictures
// of the slides. Lectern keeps every slide as a picture, AI writes the teleprompter notes,
// and questions on the slides become quizzes people answer on their phones.

import { AlertCircle, Check, FileImage, FileText, Loader2, MonitorPlay, Pencil, Presentation, ScrollText, Smartphone, Upload, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { sessionMinutes } from '../../core/deck/timing';
import { type Audience, AUDIENCES, type Deck, type DeckPurpose, PURPOSES } from '../../core/deck/types';
import { type FinishedSlide, type PptxDeck, finishedDeck, pairPages, readPptx } from '../../core/import/finished';
import { getProfile } from '../../data/profile';
import { addDeck, saveAsset, saveDeck } from '../../data/repo';
import { formatBytes } from '../../data/storage';
import { plural } from '../../ui/format';
import { AiAccessNotice } from '../account/AccountUi';
import { useAiAccess } from '../account/session';
import { dragHasFiles, handOffFiles } from '../autodeck/handoff';
import { addUsage, usageLine } from '../autodeck/usage';
import { openShare } from '../share/host';
import { SlideView } from '../slides/SlideView';
import { type NotesStatus, notesStatus, writeNotes } from './ai';
import { FINISHED_ACCEPT, takeFinished } from './handoff';
import { type SlidePicture, byName, imagePictures, pdfPageCount, pdfPictures } from './render';
import '../../styles/autodeck.css';
import '../../styles/finished.css';

const MAX_BYTES = 150 * 1024 * 1024;

/** Files people often try that can't be read here, with what to do instead. */
const SAVE_AS: Record<string, string> = {
  ppt: 'This is an older PowerPoint file. Open it in PowerPoint, save it as .pptx, then add it again.',
  key: 'Keynote files can’t be read here. In Keynote, choose File → Export To → PowerPoint, and PDF for the look.',
  odp: 'Open this in LibreOffice or PowerPoint, save it as .pptx, and export a PDF for the look.',
};

interface Picked {
  pptx: { file: File; deck: PptxDeck | null; error?: string } | null;
  /** The look: one PDF, or pictures of the slides. */
  pdf: { file: File; pages: number | null; error?: string } | null;
  images: File[];
}

type Stage = 'reading' | 'drawing' | 'saving' | 'writing';

interface Made {
  deck: Deck;
  warning?: string;
  /** Slides whose notes the AI couldn't write, and why. */
  missed: number;
  error?: string;
  usage: string;
  quizzes: number;
  wrote: boolean;
}

const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
const stem = (name: string) => name.replace(/\.[a-z0-9]+$/i, '').trim();

function startAudience(purpose: DeckPurpose): Audience {
  const saved = getProfile().deck;
  if (purpose === saved.purpose) return saved.audience;
  return purpose === 'lesson' ? 'teen' : 'adult';
}

function Working({ stage, done, total, onCancel }: { stage: Stage; done: number; total: number; onCancel(): void }) {
  const steps: { id: Stage; label: string }[] = [
    { id: 'reading', label: 'Reading your PowerPoint' },
    { id: 'drawing', label: total && stage === 'drawing' ? `Drawing slide ${Math.min(done + 1, total)} of ${total}` : 'Drawing your slides' },
    { id: 'saving', label: 'Saving the deck' },
    { id: 'writing', label: total && stage === 'writing' ? `Writing notes · ${done} of ${total} slides` : 'Writing teleprompter notes' },
  ];
  const at = steps.findIndex((s) => s.id === stage);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <section className="fin-working" aria-live="polite">
      <ol className="fin-steps">
        {steps.map((s, i) => (
          <li key={s.id} className={i < at ? 'is-done' : i === at ? 'is-now' : ''}>
            {i < at ? <Check size={16} /> : i === at ? <Loader2 size={16} className="spin" /> : <span className="fin-dot" />}
            {s.label}
          </li>
        ))}
      </ol>
      {(stage === 'drawing' || stage === 'writing') && total > 0 && <span className="progress"><span style={{ width: `${pct}%` }} /></span>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Stop</button>
    </section>
  );
}

function Result({ made, onAgain }: { made: Made; onAgain(): void }) {
  const navigate = useNavigate();
  const { deck } = made;
  const visible = deck.slides.filter((s) => !s.hidden);
  const scripted = visible.filter((s) => s.notes.script.trim()).length;
  const sample = visible.find((s) => Array.isArray(s.content.options) && (s.content.options as unknown[]).length > 1) ?? visible[1] ?? visible[0];
  return (
    <section className="fin-result" aria-labelledby="fin-result-title">
      <p className="eyebrow">Ready to present</p>
      <h1 id="fin-result-title" className="display">{deck.title}</h1>
      <ul className="fin-facts">
        <li>{plural(visible.length, 'slide')}, as you designed them</li>
        <li>{scripted === visible.length ? 'Teleprompter notes on every slide' : `Teleprompter notes on ${scripted} of ${visible.length}`}</li>
        {made.quizzes > 0 && <li>{plural(made.quizzes, 'quiz question')} for phones</li>}
        <li>About {Math.round(sessionMinutes(deck))} min</li>
      </ul>
      {made.warning && <p className="notice" role="note"><AlertCircle size={16} /> {made.warning}</p>}
      {made.missed > 0 && (
        <p className="notice" role="note">
          <AlertCircle size={16} /> Notes for {plural(made.missed, 'slide')} weren’t written{made.error ? `: ${made.error}` : '.'} Those keep your own speaker notes. In the studio, the assistant can write them.
        </p>
      )}
      {sample && (
        <div className="fin-sample">
          <SlideView slide={sample} deck={deck} step={0} framed label="A slide from your deck" />
          <div className="fin-sample-notes">
            <p className="eyebrow">On your teleprompter</p>
            {sample.notes.cues.length > 0 && <div className="cue-row">{sample.notes.cues.map((c) => <span key={c} className="cue">{c}</span>)}</div>}
            {sample.notes.script
              ? sample.notes.script.split(/\n\s*\n/).slice(0, 4).map((p, i) => <p key={i}>{p}</p>)
              : <p className="faint">No notes on this slide yet.</p>}
          </div>
        </div>
      )}
      <div className="fin-actions">
        <button type="button" className="btn btn-brand btn-lg" onClick={() => navigate(`/present/${deck.id}`)}><MonitorPlay size={18} /> Present</button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={() => openShare(deck.id)}><Smartphone size={18} /> Share to phones</button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={() => navigate(`/prompter/${deck.id}`)}><ScrollText size={18} /> Rehearse</button>
        <button type="button" className="btn btn-ghost" onClick={() => navigate(`/studio/${deck.id}`)}><Pencil size={16} /> Check the notes</button>
      </div>
      <p className="faint fin-foot">
        {made.usage && <>{made.usage} · </>}
        <button type="button" className="ad-link" onClick={onAgain}>Bring another deck</button>
      </p>
    </section>
  );
}

export default function FinishedPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [picked, setPicked] = useState<Picked>({ pptx: null, pdf: null, images: [] });
  const [notice, setNotice] = useState('');
  const [purpose, setPurposeState] = useState<DeckPurpose>(() => getProfile().deck.purpose);
  const [audience, setAudience] = useState<Audience>(() => startAudience(getProfile().deck.purpose));
  const [useAi, setUseAi] = useState(true);
  const [quizzes, setQuizzes] = useState(true);
  const [ai, setAi] = useState<NotesStatus | null>(null);
  const access = useAiAccess();
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [made, setMade] = useState<Made | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // For comparing models on a test site: /finished?model=opus or ?model=sonnet.
  const model = params.get('model') === 'opus' || params.get('model') === 'sonnet' ? params.get('model') as 'opus' | 'sonnet' : undefined;
  const aiOn = !!ai?.available && access !== 'sign_in' && access !== 'no_credits';

  const setPurpose = (p: DeckPurpose) => { setPurposeState(p); setAudience(startAudience(p)); };

  const addFiles = (files: File[]) => {
    setNotice('');
    const images: File[] = [];
    for (const file of files) {
      const kind = ext(file.name);
      if (SAVE_AS[kind]) { setNotice(SAVE_AS[kind]!); continue; }
      if (file.size > MAX_BYTES) { setNotice(`“${file.name}” is over 150 MB. Export it again with smaller pictures.`); continue; }
      if (kind === 'pptx') {
        setPicked((p) => ({ ...p, pptx: { file, deck: null } }));
        void file.arrayBuffer().then(readPptx)
          .then((deck) => setPicked((p) => (p.pptx?.file === file ? { ...p, pptx: { file, deck } } : p)))
          .catch((e) => setPicked((p) => (p.pptx?.file === file ? { ...p, pptx: { file, deck: null, error: (e as Error).message || 'This PowerPoint file couldn’t be read.' } } : p)));
      } else if (kind === 'pdf' || file.type === 'application/pdf') {
        setPicked((p) => ({ ...p, pdf: { file, pages: null }, images: [] }));
        void file.arrayBuffer().then(pdfPageCount)
          .then((pages) => setPicked((p) => (p.pdf?.file === file ? { ...p, pdf: { file, pages } } : p)))
          .catch(() => setPicked((p) => (p.pdf?.file === file ? { ...p, pdf: { file, pages: null, error: 'This PDF couldn’t be opened.' } } : p)));
      } else if (file.type.startsWith('image/')) {
        images.push(file);
      } else {
        setNotice(`“${file.name}” isn’t a PowerPoint, PDF or picture.`);
      }
    }
    if (images.length) setPicked((p) => ({ ...p, pdf: null, images: [...p.images, ...images].sort(byName) }));
  };

  useEffect(() => {
    notesStatus().then(setAi);
    const handed = takeFinished();
    if (handed.length) addFiles(handed);
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pages = picked.pdf?.pages ?? (picked.images.length || null);
  const pairing = useMemo(() => (picked.pptx?.deck && pages ? pairPages(picked.pptx.deck, pages) : null), [picked.pptx?.deck, pages]);
  const hasLook = !!picked.pdf && !picked.pdf.error || picked.images.length > 0;
  const reading = (!!picked.pptx && !picked.pptx.deck && !picked.pptx.error) || (!!picked.pdf && picked.pdf.pages === null && !picked.pdf.error);
  const working = stage !== null;

  const make = async () => {
    const controller = new AbortController();
    abort.current = controller;
    const signal = controller.signal;
    setError('');
    setProgress({ done: 0, total: 0 });
    let deck: Deck | null = null;
    try {
      setStage('reading');
      const info = picked.pptx ? picked.pptx.deck ?? await readPptx(await picked.pptx.file.arrayBuffer()) : null;
      setStage('drawing');
      const onPage = (done: number, total: number) => setProgress({ done, total });
      let pictures: SlidePicture[] = [];
      if (picked.pdf) pictures = await pdfPictures(await picked.pdf.file.arrayBuffer(), onPage, signal);
      else if (picked.images.length) pictures = await imagePictures(picked.images, onPage);
      if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      setStage('saving');
      const title = info?.title || stem((picked.pptx ?? picked.pdf)?.file.name ?? '') || 'Finished deck';
      const { paired, warning } = pairPages(info, pictures.length);
      const slides: FinishedSlide[] = [];
      for (const [i, p] of paired.entries()) {
        const picture = p.page !== undefined ? pictures[p.page] : undefined;
        slides.push({
          picture: picture ? await saveAsset(picture.blob, `${title} · slide ${i + 1}`) : '',
          title: p.slide?.title ?? '',
          text: p.slide?.text || picture?.text || '',
          notes: p.slide?.notes ?? '',
          hidden: p.hidden,
        });
      }
      deck = finishedDeck(slides, { title, audience, purpose, themeId: getProfile().deck.themeId, quizzes });
      // Saved before the AI runs, so nothing is lost if it fails or is stopped.
      await addDeck(deck);
      let result: Omit<Made, 'quizzes'> = { deck, warning, missed: 0, usage: '', wrote: false };
      if (useAi && aiOn) {
        setStage('writing');
        const written = await writeNotes(deck, { quizzes, model, signal, onProgress: (done, total) => setProgress({ done, total }) });
        deck = { ...written.deck, updatedAt: Date.now() };
        await saveDeck(deck);
        result = { deck, warning, missed: written.missed, error: written.error, usage: usageLine(addUsage({}, written.usage)), wrote: true };
      }
      const asked = deck.slides.filter((s) => !s.hidden && Array.isArray(s.content.options) && (s.content.options as unknown[]).length > 1).length;
      setMade({ ...result, quizzes: asked });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // Stopped while the AI was writing: the deck is saved with the presenter's own notes.
        if (deck) setMade({ deck, missed: deck.slides.filter((s) => !s.hidden).length, error: 'you stopped it', usage: '', quizzes: 0, wrote: false });
      } else {
        setError((e as Error).message || 'The deck couldn’t be made. Try again.');
      }
    } finally {
      setStage(null);
    }
  };

  const again = () => { setMade(null); setPicked({ pptx: null, pdf: null, images: [] }); setNotice(''); };

  return (
    <div
      className={`ad-page fin-page ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(e) => { if (!working && !made && dragHasFiles(e)) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => { if (working || made || !dragHasFiles(e)) return; e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
    >
      {made ? <Result made={made} onAgain={again} /> : (
        <>
          <header className="ad-head">
            <p className="eyebrow">Finished slides</p>
            <h1 className="display">Bring your finished slides.</h1>
            <p className="muted ad-lead">
              Lectern keeps every slide exactly as you designed it. AI writes what to say on each one for your phone’s teleprompter, starting from your speaker notes, and turns questions on your slides into quizzes people answer on their phones.
            </p>
          </header>

          {working ? <Working stage={stage} done={progress.done} total={progress.total} onCancel={() => abort.current?.abort()} /> : (
            <div className="fin-grid">
              <div className="ad-main">
                <div className={`ad-drop ${dragging ? 'is-dragging' : ''} ${picked.pptx || hasLook ? 'has-files' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) input.current?.click(); }}>
                  <div className="ad-drop-art" aria-hidden><Upload size={22} /></div>
                  <div className="ad-drop-text">
                    <strong>{picked.pptx || hasLook ? 'Add or replace a file' : 'Drop your PowerPoint and its PDF'}</strong>
                    <span>or <button type="button" className="ad-link" onClick={() => input.current?.click()}>choose files</button></span>
                  </div>
                  <span className="ad-formats">PowerPoint (.pptx) for your speaker notes · PDF or slide pictures for the look</span>
                  <input ref={input} type="file" multiple accept={FINISHED_ACCEPT} hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
                </div>

                {notice && <p className="notice" role="alert"><AlertCircle size={16} /> {notice}</p>}

                {(picked.pptx || picked.pdf || picked.images.length > 0) && (
                  <ul className="ad-files" aria-label="Your files">
                    {picked.pptx && (
                      <li className={`ad-file ${picked.pptx.error ? 'is-error' : picked.pptx.deck ? 'is-ready' : 'is-reading'}`}>
                        <span className="ad-file-icon"><Presentation size={18} /></span>
                        <span className="ad-file-body">
                          <strong title={picked.pptx.file.name}>{picked.pptx.file.name}</strong>
                          <span className="ad-file-meta">
                            {picked.pptx.error ? <><AlertCircle size={13} /> {picked.pptx.error}</>
                              : picked.pptx.deck ? <><Check size={13} /> {pptxLine(picked.pptx.deck)}</>
                                : <><Loader2 size={13} className="spin" /> Reading…</>}
                          </span>
                        </span>
                        <button type="button" className="icon-btn" aria-label={`Remove ${picked.pptx.file.name}`} onClick={() => setPicked((p) => ({ ...p, pptx: null }))}><X size={16} /></button>
                      </li>
                    )}
                    {picked.pdf && (
                      <li className={`ad-file ${picked.pdf.error ? 'is-error' : picked.pdf.pages !== null ? 'is-ready' : 'is-reading'}`}>
                        <span className="ad-file-icon"><FileText size={18} /></span>
                        <span className="ad-file-body">
                          <strong title={picked.pdf.file.name}>{picked.pdf.file.name}</strong>
                          <span className="ad-file-meta">
                            {picked.pdf.error ? <><AlertCircle size={13} /> {picked.pdf.error}</>
                              : picked.pdf.pages !== null ? <><Check size={13} /> {plural(picked.pdf.pages, 'page')} · {formatBytes(picked.pdf.file.size)} · the look of your slides</>
                                : <><Loader2 size={13} className="spin" /> Opening…</>}
                          </span>
                        </span>
                        <button type="button" className="icon-btn" aria-label={`Remove ${picked.pdf.file.name}`} onClick={() => setPicked((p) => ({ ...p, pdf: null }))}><X size={16} /></button>
                      </li>
                    )}
                    {picked.images.length > 0 && (
                      <li className="ad-file is-ready">
                        <span className="ad-file-icon"><FileImage size={18} /></span>
                        <span className="ad-file-body">
                          <strong>{plural(picked.images.length, 'slide picture')}</strong>
                          <span className="ad-file-meta"><Check size={13} /> In file-name order, from {picked.images[0]!.name}</span>
                        </span>
                        <button type="button" className="icon-btn" aria-label="Remove the slide pictures" onClick={() => setPicked((p) => ({ ...p, images: [] }))}><X size={16} /></button>
                      </li>
                    )}
                  </ul>
                )}

                {picked.pptx && !hasLook && (
                  <div className="fin-need" role="note">
                    <p><strong>Add a PDF of this deck to keep your design exactly.</strong></p>
                    <ul>
                      <li>PowerPoint: File → Export → Create PDF/XPS</li>
                      <li>Keynote: File → Export To → PDF</li>
                      <li>Google Slides: File → Download → PDF</li>
                    </ul>
                    <p className="faint">
                      Or <button type="button" className="ad-link" onClick={() => { handOffFiles([picked.pptx!.file]); navigate('/make'); }}>rebuild it in Lectern’s own layouts</button> instead.
                    </p>
                  </div>
                )}
                {!picked.pptx && hasLook && (
                  <p className="faint fin-hint">Add the .pptx too, and the notes start from your own speaker notes.</p>
                )}
                {pairing?.warning && <p className="notice" role="note"><AlertCircle size={16} /> {pairing.warning}</p>}
                {error && <p className="notice is-error" role="alert"><AlertCircle size={16} /> {error}</p>}
              </div>

              <aside className="fin-side" aria-label="Settings">
                <fieldset className="fin-field">
                  <legend className="field-label">What it’s for</legend>
                  <div className="segmented fin-purpose">
                    {PURPOSES.map((p) => <button key={p.id} type="button" aria-pressed={purpose === p.id} onClick={() => setPurpose(p.id)}>{p.label}</button>)}
                  </div>
                </fieldset>
                <label className="fin-field">
                  <span className="field-label">Who it’s for</span>
                  <select className="input" value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
                    {AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </label>
                <label className="switch"><input type="checkbox" checked={useAi && aiOn} disabled={!aiOn} onChange={(e) => setUseAi(e.target.checked)} /><span>Write teleprompter notes with AI</span></label>
                <label className="switch"><input type="checkbox" checked={quizzes} onChange={(e) => setQuizzes(e.target.checked)} /><span>Turn questions on the slides into phone quizzes</span></label>
                {ai && !ai.available && <p className="field-help">AI isn’t set up on this server, so your speaker notes become the script.</p>}
                {ai?.available && <AiAccessNotice access={access} what="write notes with AI">Without AI, your speaker notes become the script.</AiAccessNotice>}
                {model && <p className="field-help">Notes model: {model}</p>}
                <button type="button" className="btn btn-brand btn-lg fin-go" disabled={!hasLook || reading} onClick={() => void make()}>
                  <Wand2 size={18} /> Make the deck
                </button>
                <p className="field-help">Your slides stay on this device. {useAi && aiOn ? 'Small copies go to the AI to write the notes.' : ''}</p>
                <Link className="fin-back" to="/make">Want Lectern to design the slides instead?</Link>
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function pptxLine(deck: PptxDeck): string {
  const hidden = deck.slides.filter((s) => s.hidden).length;
  const noted = deck.slides.filter((s) => s.notes.trim()).length;
  return [
    plural(deck.slides.length, 'slide') + (hidden ? ` (${hidden} hidden)` : ''),
    noted ? `speaker notes on ${noted}` : 'no speaker notes',
  ].join(' · ');
}
