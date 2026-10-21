import {
  AlertCircle, AudioLines, Check, Download, FileText, Image as ImageIcon, Loader2, MonitorPlay, Pencil,
  RotateCcw, Sparkles, Upload, Wand2, X,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { draftToDeck } from '../../core/deck/draft';
import { fitChanged } from '../../core/deck/fit';
import { AUDIENCES, type Audience, type Deck, type DeckPurpose, PURPOSES, deckMinutes, uid } from '../../core/deck/types';
import { allThemes, fontFamily } from '../../core/engine/themes';
import { DENSITY } from '../../core/kinds/kit';
import { documentPictures, fileToOutline } from '../../core/import/files';
import { draftingHints } from '../../core/plugins/registry';
import { transcriptText } from '../../core/transcribe/segments';
import { db } from '../../data/db';
import { type DraftJob, type DraftRequest, type PlannedSlide, type UsageByModel, deleteJob, getJob, openJob } from '../../data/draft-jobs';
import { DENSITIES, type Density, LENGTHS, rememberDeckPrefs, useProfile } from '../../data/profile';
import { addDeck, isoDate, saveAsset } from '../../data/repo';
import { useToast } from '../../ui/Toast';
import { addRecordingFile } from '../recordings/actions';
import { cancelTranscription, loadPrefs, onTranscriptionEnd, transcribe, useTranscriber } from '../recordings/engine';
import { formatBytes, jobLabel } from '../recordings/status';
import { SlideView } from '../slides/SlideView';
import { type AiStatus, aiStatus, kindCatalogue, saveCode, savedCode } from '../studio/ai';
import { exportPptx } from '../studio/download';
import { fitSummary } from '../studio/fit-deck';
import { type AiQuestion, draftOutline, fetchQuestions } from './ai';
import { approveOutline, createJob, finishJob, recover, runJob, runsSnapshot, saveOutline, stopJob, subscribeRuns, toggleDraftFit } from './drafting';
import { DraftingView, ResumeCard, useJobPictures } from './DraftingView';
import { dragHasFiles, onHandOff, takeHandedOff } from './handoff';
import { ACCEPT_ALL, type Source, buildMaterial, countWords, fallbackTopic, kindOf, offlineDraft, placePictures, purposeLabel, stem } from './make';
import { pictureForAi, pictureForDeck } from './pictures';
import { OutlineEditor } from './OutlineEditor';
import { type Answer, QuestionDialog } from './QuestionDialog';
import { usageCost, usageLine, usageTotals } from './usage';
import '../../styles/autodeck.css';

/** "job" shows the open drafting job: its outline, its slides being written, or the finished deck. */
type Stage = 'gather' | 'reading' | 'asking' | 'outlining' | 'building' | 'job' | 'done';

const NOTHING: ReadonlySet<string> = new Set();

const MAX_FILES = 20;
const PURPOSE_KEY = '__purpose';

const KIND_ICON = {
  doc: <FileText size={18} />,
  audio: <AudioLines size={18} />,
  picture: <ImageIcon size={18} />,
};

const BRIEF_PLACEHOLDER: Record<DeckPurpose, string> = {
  lesson: 'For example: a 40-minute class introducing the topic, with a quick check at the end',
  talk: 'For example: a short talk for the team, focused on what changes next quarter',
  pitch: 'For example: a seed pitch for investors; lead with the problem and the traction',
  report: 'For example: the monthly results for leadership; start with the three numbers that matter',
};

// The files being gathered live outside the page, so they survive a visit to another page,
// and a document that finishes reading (or a transcript that finishes) while you're away
// is still filled in when you come back. So does the open drafting job.
const kept = { sources: [] as Source[], brief: '', jobId: '' };
const keptListeners = new Set<() => void>();

function setSources(update: (all: Source[]) => Source[]) {
  kept.sources = update(kept.sources);
  keptListeners.forEach((l) => l());
}

function patch(id: string, p: Partial<Source>) {
  setSources((all) => all.map((s) => (s.id === id ? { ...s, ...p } : s)));
}

function useSources(): Source[] {
  return useSyncExternalStore(
    (l) => { keptListeners.add(l); return () => { keptListeners.delete(l); }; },
    () => kept.sources,
  );
}

let listening = false;

/** A finished transcript becomes that file's text, whether or not the page is open. */
function listenForTranscripts() {
  if (listening) return;
  listening = true;
  onTranscriptionEnd(async (e) => {
    if (!kept.sources.some((s) => s.recordingId === e.recordingId)) return;
    const rec = await db.recordings.get(e.recordingId);
    setSources((all) => all.map((s) => {
      if (s.recordingId !== e.recordingId) return s;
      if (e.outcome !== 'done' || !rec) return { ...s, status: 'error', error: e.message || 'The transcription stopped. Open it in Recordings to continue.' };
      const text = transcriptText(rec.segments);
      return text.trim() ? { ...s, status: 'ready', text, words: countWords(text) } : { ...s, status: 'error', error: 'No speech was found in this recording.' };
    }));
  });
}

export default function MakePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const profile = useProfile();
  const engine = useTranscriber();
  const sources = useSources();
  const [brief, setBrief] = useState(kept.brief);
  const [doneSources, setDoneSources] = useState<Source[]>([]);
  const [purpose, setPurpose] = useState<DeckPurpose>(profile.deck.purpose);
  const [purposeTouched, setPurposeTouched] = useState(false);
  const [audience, setAudience] = useState<Audience>(profile.deck.audience);
  const [minutes, setMinutes] = useState(profile.deck.minutes);
  const [density, setDensity] = useState<Density>(profile.deck.density);
  const [themeId, setThemeId] = useState(profile.deck.themeId);
  const [ask, setAsk] = useState(profile.askQuestions);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [code, setCode] = useState(savedCode);
  const [stage, setStage] = useState<Stage>(kept.jobId ? 'job' : 'gather');
  const [questions, setQuestions] = useState<AiQuestion[]>([]);
  const [asked, setAsked] = useState(0);
  const [hint, setHint] = useState<{ title: string; topic: string } | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [jobId, setJobIdState] = useState(kept.jobId);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const started = useRef(Date.now());

  const openJobId = useCallback((id: string) => { kept.jobId = id; setJobIdState(id); }, []);
  // Each read says which id it was for: a live query keeps its last result until the new one
  // arrives. undefined while loading; null when there is no such job or deck.
  const jobRead = useLiveQuery(async () => ({ id: jobId, job: jobId ? (await getJob(jobId)) ?? null : null }), [jobId]);
  const job = jobRead && jobRead.id === jobId ? jobRead.job : undefined;
  const waiting = useLiveQuery(async () => (await openJob()) ?? null, []);
  const runs = useSyncExternalStore(subscribeRuns, runsSnapshot);
  const jobPictures = useJobPictures(job);
  const doneId = job?.status === 'done' ? job.decks[0]?.deckId : undefined;
  const deckRead = useLiveQuery(async () => ({ id: doneId, deck: doneId ? (await db.decks.get(doneId)) ?? null : null }), [doneId]);
  const doneDeck = deckRead && deckRead.id === doneId ? deckRead.deck : undefined;

  useEffect(() => { void recover(); }, []);
  useEffect(() => { aiStatus().then(setAi); }, []);
  useEffect(() => { document.title = 'Make a deck · Lectern'; return () => { document.title = 'Lectern'; }; }, []);
  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => { kept.brief = brief; }, [brief]);

  // A discarded job leaves nothing to show: back to the files.
  useEffect(() => {
    if (stage === 'job' && job === null) { openJobId(''); setStage('gather'); }
  }, [stage, job, openJobId]);

  // Once the deck is made, the files have done their job.
  const jobDone = job?.status === 'done';
  useEffect(() => {
    if (!jobDone || !kept.sources.length) return;
    setDoneSources(kept.sources);
    setSources(() => []);
    setBrief('');
  }, [jobDone]);

  const addFiles = useCallback((files: File[]) => {
    setError('');
    setStage((s) => (s === 'done' ? 'gather' : s));
    if (kept.jobId) {
      void getJob(kept.jobId).then((j) => { if (!j || j.status === 'done') { openJobId(''); setStage('gather'); } });
    }
    const room = Math.max(0, MAX_FILES - kept.sources.length);
    if (files.length > room) toast.show(`Up to ${MAX_FILES} files at a time. ${files.length - room} left out.`, { tone: 'error' });
    const fresh: Source[] = files.slice(0, room).map((file) => {
      const kind = kindOf(file);
      return { id: uid('src'), file, kind, status: kind === 'audio' ? 'transcribing' : kind === 'picture' ? 'ready' : 'reading', text: '', words: 0, pictures: kind === 'picture' ? [file] : [] };
    });
    if (!fresh.length) return;
    setSources((existing) => [...existing, ...fresh]);
    if (fresh.some((s) => s.kind === 'audio')) listenForTranscripts();
    for (const s of fresh) {
      if (s.kind === 'doc') {
        Promise.all([fileToOutline(s.file), documentPictures(s.file).catch(() => [])])
          .then(([text, pictures]) => patch(s.id, { status: 'ready', text, words: countWords(text), pictures }))
          .catch((e: Error) => patch(s.id, { status: 'error', error: e.message }));
      } else if (s.kind === 'audio') {
        addRecordingFile(s.file, { title: stem(s.file.name), date: isoDate(new Date()) })
          .then((rec) => { patch(s.id, { recordingId: rec.id }); return transcribe(rec.id, loadPrefs()); })
          .catch((e: Error) => patch(s.id, { status: 'error', error: e.message || 'This file’s audio couldn’t be read.' }));
      }
    }
  }, [toast, openJobId]);

  // Files dropped elsewhere in the app arrive here.
  useEffect(() => {
    const waiting = takeHandedOff();
    if (waiting.length) addFiles(waiting);
    return onHandOff(addFiles);
  }, [addFiles]);

  const remove = (s: Source) => {
    if (s.recordingId && s.status === 'transcribing') void cancelTranscription(s.recordingId);
    setSources((all) => all.filter((x) => x.id !== s.id));
  };

  const ready = sources.filter((s) => s.status === 'ready');
  const busy = sources.filter((s) => s.status === 'reading' || s.status === 'transcribing');
  const pictures = ready.flatMap((s) => s.pictures).slice(0, 8);
  const aiOn = ai?.available === true;

  const draft = async (answers: Answer[], suggestion: { title: string; topic: string } | null) => {
    started.current = Date.now();
    const controller = abort.current ?? new AbortController();
    abort.current = controller;
    let chosen = purpose;
    const purposeAnswer = answers.find((a) => a.key === PURPOSE_KEY);
    const match = PURPOSES.find((p) => purposeAnswer?.answer.startsWith(p.label));
    if (match) { chosen = match.id; setPurpose(match.id); }
    const real = answers.filter((a) => a.key !== PURPOSE_KEY);
    const known = profile.remembered.filter((r) => !real.some((a) => a.key === r.key));
    const remember = () => rememberDeckPrefs(
      { purpose: chosen, audience, minutes, density, themeId },
      real.filter((a) => a.remember).map((a) => ({ key: a.key, question: a.question, answer: a.answer, updatedAt: Date.now() })),
    );
    try {
      if (!aiOn) {
        setStage('building');
        let result = offlineDraft(ready, suggestion?.title || stem(ready.find((s) => s.kind !== 'picture')?.file.name ?? 'New deck'));
        result = await placePictures(result, pictures, async (f) => saveAsset(await pictureForDeck(f), f.name));
        const made = draftToDeck(result, { audience, themeId, purpose: chosen });
        await addDeck(made);
        remember();
        setDeck(made);
        setDoneSources(kept.sources);
        setSources(() => []);
        setBrief('');
        setStage('done');
        return;
      }
      // With AI, the deck starts as an outline to check. Its slides are written once it's approved.
      setStage('outlining');
      const forAi = (await Promise.all(pictures.map(async (f, i) => {
        const p = await pictureForAi(f);
        return p ? { id: `pic${i + 1}`, name: f.name, ...p } : null;
      }))).filter((p): p is NonNullable<typeof p> => p !== null);
      const request: DraftRequest = {
        topic: brief.trim() || suggestion?.topic || fallbackTopic(ready),
        audience,
        purpose: chosen,
        minutes,
        density,
        material: buildMaterial(ready),
        answers: [...real, ...known].map(({ question, answer }) => ({ question, answer })),
        pictures: forAi,
        kinds: kindCatalogue(),
        hints: draftingHints(),
        budget: DENSITY[audience],
      };
      const startedAt = Date.now();
      const res = await draftOutline(request, controller.signal);
      if (!res.outline.length) throw new Error('The AI returned no outline. Try again.');
      remember();
      const made = await createJob({
        request,
        settings: { audience, themeId, purpose: chosen },
        pictures,
        title: res.title || suggestion?.title || 'Untitled deck',
        outline: res.outline,
        usage: res.usage,
        startedAt,
      });
      openJobId(made.id);
      setStage('job');
    } catch (e) {
      if ((e as Error).name === 'AbortError') { setStage('gather'); return; }
      setError((e as Error).message || 'The deck couldn’t be made. Try again.');
      setStage('gather');
    } finally {
      abort.current = null;
    }
  };

  // Outline edits read the job afresh, so a late save never undoes the approval.
  const onOutlineChange = useCallback(async (title: string, outline: PlannedSlide[]) => {
    const current = await getJob(jobId);
    if (current?.status === 'outline') await saveOutline(current, title, outline);
  }, [jobId]);

  const writeSlides = async (title: string, outline: PlannedSlide[]) => {
    const current = await getJob(jobId);
    if (!current) return;
    await approveOutline(current, title, outline);
    void runJob(current.id);
  };

  const continueJob = (target: DraftJob) => {
    openJobId(target.id);
    setStage('job');
    if (target.status !== 'outline') void runJob(target.id);
  };

  const keepJob = async () => {
    if (!job) return;
    setSaving(true);
    try {
      await finishJob(job);
    } catch {
      toast.show('The deck couldn’t be saved. Try again.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const discardJob = async (target: DraftJob) => {
    await stopJob(target.id);
    const snapshot = (await getJob(target.id)) ?? target;
    await deleteJob(target.id);
    if (target.id === jobId) { openJobId(''); setStage('gather'); }
    toast.show('Draft discarded', {
      action: { label: 'Undo', run: () => { void db.jobs.put({ ...snapshot, status: snapshot.status === 'drafting' ? 'interrupted' : snapshot.status }); } },
    });
  };

  const make = async () => {
    if (!ready.length && !brief.trim()) { setError('Add a file, or say what the deck is about.'); return; }
    setError('');
    const status = ai ?? await aiStatus();
    abort.current = new AbortController();
    if (!status.available || !ask) { void draft([], null); return; }
    setStage('reading');
    started.current = Date.now();
    try {
      const res = await fetchQuestions({
        brief: brief.trim(),
        excerpt: buildMaterial(ready, 20_000),
        files: ready.map((s) => ({ name: s.file.name, kind: s.kind, words: s.words })),
        purpose, audience, minutes, density,
        pictures: pictures.length,
        remembered: profile.remembered,
      }, abort.current.signal);
      const suggestion = { title: res.title, topic: res.topic };
      setHint(suggestion);
      const list = [...res.questions];
      if (!purposeTouched && res.purpose && res.purpose !== purpose) {
        const others = PURPOSES.filter((p) => p.id !== res.purpose && p.id !== purpose).map((p) => p.label);
        list.unshift({
          key: PURPOSE_KEY,
          question: `This reads like a ${purposeLabel(res.purpose).toLowerCase()}. What kind of deck should it be?`,
          options: [purposeLabel(res.purpose), `${purposeLabel(purpose)} (your usual)`, ...others],
          multiple: false,
          remember: false,
        });
      }
      if (!list.length) { void draft([], suggestion); return; }
      setQuestions(list);
      setStage('asking');
    } catch (e) {
      if ((e as Error).name === 'AbortError') { setStage('gather'); return; }
      toast.show('Skipped the questions: the AI couldn’t read your files just now.');
      void draft([], null);
    }
  };

  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setStage('gather');
  };

  const reset = () => {
    setSources(() => []);
    setBrief('');
    setDeck(null);
    setHint(null);
    openJobId('');
    setStage('gather');
    setPurposeTouched(false);
  };

  const shownDeck = stage === 'job' ? doneDeck : deck;
  const download = async () => {
    if (!shownDeck) return;
    setExporting(true);
    try {
      const warnings = await exportPptx(shownDeck);
      toast.show(warnings.length ? `PowerPoint saved, with ${warnings.length} note${warnings.length === 1 ? '' : 's'}` : 'PowerPoint saved');
    } catch {
      toast.show('The PowerPoint couldn’t be made. Try again.', { tone: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    setDragging(false);
    if (view === 'gather' || view === 'result') addFiles(Array.from(e.dataTransfer.files));
  };

  const usual = purpose === profile.deck.purpose && audience === profile.deck.audience && minutes === profile.deck.minutes && density === profile.deck.density && themeId === profile.deck.themeId;
  const working = stage === 'reading' || stage === 'asking' || stage === 'outlining' || stage === 'building';
  /** What the page shows; "loading" while the open job is read. */
  const view = stage === 'done' && deck ? 'result'
    : stage !== 'job' ? 'gather'
    : job === undefined || (job?.status === 'done' && doneDeck === undefined) ? 'loading'
    : !job ? 'gather'
    : job.status === 'outline' ? 'outline'
    : job.status === 'done' ? (doneDeck ? 'result' : 'gather')
    : 'drafting';

  return (
    <div
      className={`page ad-page ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(e) => { if (dragHasFiles(e)) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={onDrop}
    >
      {view === 'loading' ? null : view === 'result' && shownDeck ? (
        <Result
          deck={shownDeck}
          sources={doneSources}
          remembered={profile.remembered.length}
          usage={stage === 'job' ? job?.usage : undefined}
          fit={stage === 'job' && job ? fitLine(job, shownDeck) : undefined}
          exporting={exporting}
          onDownload={download}
          onOpen={() => navigate(`/studio/${shownDeck.id}`)}
          onPresent={() => navigate(`/present/${shownDeck.id}`)}
          onAgain={reset}
        />
      ) : view === 'outline' && job ? (
        <OutlineEditor
          key={job.id}
          job={job}
          pictureUrls={jobPictures.map((p) => p.url)}
          onChange={onOutlineChange}
          onWrite={writeSlides}
          onDiscard={() => void discardJob(job)}
        />
      ) : view === 'drafting' && job ? (
        <DraftingView
          job={job}
          running={runs.has(job.id)}
          writing={runs.get(job.id) ?? NOTHING}
          pictures={jobPictures}
          saving={saving}
          onStop={() => void stopJob(job.id)}
          onContinue={() => void runJob(job.id)}
          onKeep={() => void keepJob()}
          onDiscard={() => void discardJob(job)}
        />
      ) : (
        <>
          <header className="ad-head">
            <p className="eyebrow">Make a deck</p>
            <h1 className="display">Drop your files. Get a deck.</h1>
            <p className="muted ad-lead">
              PDFs, Word, PowerPoint, Excel, web pages, pictures and recordings.{' '}
              {aiOn || ai === null
                ? 'Lectern reads them, asks a few questions and plans an outline for you to check. Then it writes the slides and speaker notes.'
                : 'Lectern builds the slides from their headings and points.'}
            </p>
          </header>

          {working ? (
            <Working stage={stage} sources={ready.length} asked={asked} started={started.current} onCancel={cancel} />
          ) : (
            <>
            {waiting && waiting.id !== jobId && (
              <ResumeCard job={waiting} onOpen={() => continueJob(waiting)} onDiscard={() => void discardJob(waiting)} />
            )}
            <div className="ad-grid">
              <div className="ad-main">
                <div
                  className={`ad-drop ${dragging ? 'is-dragging' : ''} ${sources.length ? 'has-files' : ''}`}
                  onClick={(e) => { if (e.target === e.currentTarget) fileInput.current?.click(); }}
                >
                  <div className="ad-drop-art" aria-hidden><Upload size={22} /></div>
                  <div className="ad-drop-text">
                    <strong>{sources.length ? 'Add more files' : 'Drop files here'}</strong>
                    <span>or <button type="button" className="ad-link" onClick={() => fileInput.current?.click()}>choose from your computer</button></span>
                  </div>
                  <span className="ad-formats">PDF · Word · PowerPoint · Excel · CSV · web page · EPUB · text · pictures · audio and video</span>
                  <input ref={fileInput} type="file" multiple accept={ACCEPT_ALL} hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
                </div>

                {sources.length > 0 && (
                  <ul className="ad-files" aria-label="Your files">
                    {sources.map((s) => {
                      const job = s.recordingId ? engine.jobs.find((j) => j.recordingId === s.recordingId) : undefined;
                      const progress = job ? (job.phase === 'model' && job.modelTotal ? job.modelLoaded / job.modelTotal : job.progress) : undefined;
                      return (
                        <li key={s.id} className={`ad-file is-${s.status}`}>
                          <span className="ad-file-icon">{KIND_ICON[s.kind]}</span>
                          <span className="ad-file-body">
                            <strong title={s.file.name}>{s.file.name}</strong>
                            <span className="ad-file-meta">
                              {s.status === 'reading' && <><Loader2 size={13} className="spin" /> Reading…</>}
                              {s.status === 'transcribing' && <><Loader2 size={13} className="spin" /> {job ? jobLabel(job) : 'Preparing the audio…'}</>}
                              {s.status === 'ready' && (
                                <>
                                  <Check size={13} />
                                  {s.kind === 'picture' ? `Picture · ${formatBytes(s.file.size)}` : `${s.words.toLocaleString()} words${s.pictures.length ? ` · ${s.pictures.length} picture${s.pictures.length === 1 ? '' : 's'}` : ''}`}
                                  {s.kind === 'audio' && s.recordingId && <> · <Link to={`/recordings/${s.recordingId}`}>Transcript in Recordings</Link></>}
                                </>
                              )}
                              {s.status === 'error' && <><AlertCircle size={13} /> {s.error}</>}
                            </span>
                            {s.status === 'transcribing' && progress !== undefined && (
                              <span className="progress ad-file-progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></span>
                            )}
                          </span>
                          <button type="button" className="icon-btn" onClick={() => remove(s)} aria-label={`Remove ${s.file.name}`}><X size={16} /></button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <label className="field ad-brief">
                  <span className="field-label">Anything Lectern should know? <span className="faint" style={{ fontWeight: 400 }}>(optional)</span></span>
                  <textarea className="textarea" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={BRIEF_PLACEHOLDER[purpose]} />
                  {!sources.length && <span className="field-help">No files? Describe the topic here and Lectern drafts from that.</span>}
                </label>

                {ai?.available === false && (
                  <div className="notice">
                    <strong>AI isn’t set up on this server.</strong> Lectern builds the slides from your files’ headings and points instead. Recordings are still transcribed on this device.
                  </div>
                )}

                <div className="ad-go">
                  {error && <span role="alert" className="ad-error"><AlertCircle size={15} /> {error}</span>}
                  <button type="button" className="btn btn-brand btn-lg" onClick={make} disabled={busy.length > 0 || (!ready.length && !brief.trim()) || ai === null}>
                    {busy.length ? <><Loader2 size={17} className="spin" /> Waiting for {busy.length} file{busy.length === 1 ? '' : 's'}…</> : <><Wand2 size={17} /> Make the deck</>}
                  </button>
                </div>
              </div>

              <aside className="ad-settings card" aria-labelledby="ad-settings-title">
                <div className="ad-settings-head">
                  <h2 id="ad-settings-title">Settings</h2>
                  <span className={`chip ${usual ? '' : 'chip-brand'}`}>{usual ? 'Your usual' : 'Changed'}</span>
                </div>
                <label className="field">
                  <span className="field-label">Kind of deck</span>
                  <select className="select" value={purpose} onChange={(e) => { setPurpose(e.target.value as DeckPurpose); setPurposeTouched(true); }}>
                    {PURPOSES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Audience</span>
                  <select className="select" value={audience} onChange={(e) => { const a = e.target.value as Audience; setAudience(a); if (a === 'young') setDensity('visual'); }}>
                    {AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </label>
                <div className="ad-settings-row">
                  <label className="field">
                    <span className="field-label">Length</span>
                    <select className="select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                      {[...new Set([...LENGTHS, minutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} min</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">Words on a slide</span>
                    <select className="select" value={density} onChange={(e) => setDensity(e.target.value as Density)}>
                      {DENSITIES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="field">
                  <span className="field-label">Look</span>
                  <div className="ad-looks" role="radiogroup" aria-label="Look">
                    {allThemes().map((t) => (
                      <button key={t.id} type="button" role="radio" aria-checked={themeId === t.id} className="ad-look" onClick={() => setThemeId(t.id)} title={t.name}>
                        <span style={{ background: t.colors.bg, color: t.colors.accent, fontFamily: fontFamily(t, 'display') }}>Aa</span>
                        <span className="visually-hidden">{t.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {aiOn && (
                  <label className="switch ad-ask-toggle">
                    <input type="checkbox" checked={ask} onChange={(e) => setAsk(e.target.checked)} />
                    <span>Ask me a few questions first</span>
                  </label>
                )}
                {ai?.needsCode && (
                  <label className="field">
                    <span className="field-label">Access code</span>
                    <input className="input" type="password" value={code} onChange={(e) => { setCode(e.target.value); saveCode(e.target.value); }} autoComplete="off" />
                    <span className="field-help">This server asks for a code before using AI.</span>
                  </label>
                )}
                <p className="faint ad-settings-foot">
                  Your choices are saved for next time{profile.remembered.length ? `, with ${profile.remembered.length} remembered answer${profile.remembered.length === 1 ? '' : 's'}` : ''}. <Link to="/settings">Preferences</Link>
                </p>
              </aside>
            </div>
            </>
          )}
        </>
      )}

      <QuestionDialog
        open={stage === 'asking'}
        questions={questions}
        onCancel={cancel}
        onDone={(answers) => { setAsked(answers.length); void draft(answers, hint); }}
      />
      {dragging && (view === 'gather' || view === 'result') && <div className="ad-drag-hint" aria-hidden><Upload size={18} /> Drop to add</div>}
    </div>
  );
}

function Working({ stage, sources, asked, started, onCancel }: { stage: Stage; sources: number; asked: number; started: number; onCancel(): void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((now - started) / 1000));
  const steps = [
    { label: `Read ${sources} file${sources === 1 ? '' : 's'}`, state: 'done' },
    { label: stage === 'reading' ? 'Looking for questions to ask' : asked ? `Answered ${asked} question${asked === 1 ? '' : 's'}` : 'Questions skipped', state: stage === 'reading' ? 'active' : 'done' },
    { label: stage === 'building' ? 'Building the slides from your files' : 'Planning the outline', state: stage === 'outlining' || stage === 'building' ? 'active' : 'todo' },
  ];
  return (
    <section className="ad-working card" aria-live="polite" aria-busy="true">
      <div className="ad-working-art" aria-hidden>
        <span /><span /><span />
      </div>
      <ol className="ad-steps">
        {steps.map((s) => (
          <li key={s.label} className={`is-${s.state}`}>
            <span className="ad-step-mark">{s.state === 'done' ? <Check size={13} strokeWidth={3} /> : s.state === 'active' ? <Loader2 size={14} className="spin" /> : null}</span>
            {s.label}
          </li>
        ))}
      </ol>
      <p className="faint ad-working-time">
        {stage === 'outlining'
          ? (secs < 20 ? 'This usually takes under a minute. You’ll check the plan next.' : `Still planning · ${secs} s. Long files take a little longer.`)
          : stage === 'building' ? 'Almost there…' : 'Reading your files…'}
      </p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
    </section>
  );
}

/** Tokens and an estimated cost of the AI calls that made the deck, with the breakdown on request. */
function UsageNote({ usage }: { usage: UsageByModel }) {
  const line = usageLine(usage);
  if (!line) return null;
  const t = usageTotals(usage);
  const cost = usageCost(usage);
  return (
    <details className="ad-usage">
      <summary>AI use: {line}</summary>
      <p className="faint tabular">
        {t.calls} call{t.calls === 1 ? '' : 's'} · {t.input.toLocaleString('en-US')} input · {t.cacheRead.toLocaleString('en-US')} read from the prompt cache · {t.cacheWrite.toLocaleString('en-US')} written to it · {t.output.toLocaleString('en-US')} output, thinking included.
        {cost === null ? ' The price of this model isn’t known to Lectern.' : ' The cost is an estimate at list prices.'}
      </p>
    </details>
  );
}

interface FitLine {
  text: string;
  undone: boolean;
  canUndo: boolean;
  onToggle(): void;
}

/** What the check after drafting changed, with Undo back to the draft as the AI wrote it. */
function fitLine(job: DraftJob, deck: Deck): FitLine | undefined {
  const fit = job.decks[0]?.fit;
  if (!fit) return undefined;
  return {
    text: fit.undone ? 'Showing the draft as the AI wrote it.' : fitSummary(fit.report, deck.minutes),
    undone: fit.undone,
    canUndo: fitChanged(fit.report),
    onToggle: () => void toggleDraftFit(job.id),
  };
}

function Result({ deck, sources, remembered, usage, fit, exporting, onDownload, onOpen, onPresent, onAgain }: {
  deck: Deck;
  sources: Source[];
  remembered: number;
  usage?: UsageByModel;
  fit?: FitLine;
  exporting: boolean;
  onDownload(): void;
  onOpen(): void;
  onPresent(): void;
  onAgain(): void;
}) {
  const shown = deck.slides.filter((s) => !s.hidden);
  const recordings = sources.filter((s) => s.kind === 'audio' && s.recordingId);
  return (
    <section className="ad-result" aria-labelledby="ad-result-title">
      <div className="ad-result-head">
        <p className="eyebrow ad-ready"><Sparkles size={14} /> Your deck is ready</p>
        <h1 id="ad-result-title" className="display">{deck.title}</h1>
        <p className="muted">
          {shown.length} slides with speaker notes · about {Math.round(deckMinutes(deck))} min · {purposeLabel(deck.purpose ?? 'talk')} · {AUDIENCES.find((a) => a.id === deck.audience)?.label}
        </p>
        {fit?.text && (
          <p className="ad-fit" role="status">
            {fit.undone || !fit.canUndo ? <AlertCircle size={15} /> : <Check size={15} />} {fit.text}
            {fit.canUndo && <> <button type="button" className="ad-link" onClick={fit.onToggle}>{fit.undone ? 'Redo' : 'Undo'}</button></>}
          </p>
        )}
        {usage && <UsageNote usage={usage} />}
        <div className="ad-result-actions">
          <button type="button" className="btn btn-brand btn-lg" onClick={onDownload} disabled={exporting}>
            {exporting ? <><Loader2 size={17} className="spin" /> Making the file…</> : <><Download size={17} /> Download PowerPoint</>}
          </button>
          <button type="button" className="btn btn-secondary btn-lg" onClick={onOpen}><Pencil size={16} /> Open in editor</button>
          <button type="button" className="btn btn-ghost btn-lg" onClick={onPresent}><MonitorPlay size={17} /> Present</button>
        </div>
      </div>
      <div className="ad-filmstrip">
        {shown.slice(0, 12).map((s, i) => (
          <button key={s.id} type="button" className="ad-thumb" onClick={onOpen} aria-label={`Slide ${i + 1}, open in the editor`}>
            <SlideView slide={s} deck={deck} number={i + 1} count={shown.length} framed />
            <span>{i + 1}</span>
          </button>
        ))}
        {shown.length > 12 && <button type="button" className="ad-thumb ad-thumb-more" onClick={onOpen}>+{shown.length - 12} more</button>}
      </div>
      <div className="ad-result-foot">
        <p className="faint">
          Saved in <Link to="/decks">Decks</Link>. Lectern will start your next deck with these settings{remembered ? ` and ${remembered} remembered answer${remembered === 1 ? '' : 's'}` : ''}.
          {recordings.length > 0 && <> Transcripts are in <Link to="/recordings">Recordings</Link>.</>}
        </p>
        <button type="button" className="btn btn-ghost" onClick={onAgain}><RotateCcw size={15} /> Make another deck</button>
      </div>
    </section>
  );
}
