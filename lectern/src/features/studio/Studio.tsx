import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle, ArrowLeft, BookOpen, ChevronDown, ClipboardList, Copy, Copyright, Download, EyeOff, FileJson, FileText, MonitorPlay,
  Plus, PresentationIcon, Redo2, Scissors, ScrollText, Shapes, Trash2, Undo2,
  Globe, QrCode as QrIcon, Trophy,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { NotFound } from '../../app/App';
import { cloneSlide, makeSlide } from '../../core/deck/draft';
import { wording } from '../../core/deck/purpose';
import { canSplit, fitsOnSlide, isOverflowWarning, splitInDeck, splitSlide } from '../../core/deck/split';
import { type KeyNotes, type Slide, deckMinutes, deckPurpose } from '../../core/deck/types';
import type { SlideLayout } from '../../core/engine/boxes';
import { getTheme } from '../../core/engine/themes';
import { getKind } from '../../core/kinds/registry';
import { deckFields, exporters } from '../../core/plugins/registry';
import { db } from '../../data/db';
import { imageDataUrl } from '../../data/repo';
import { KindIcon } from '../../ui/KindIcon';
import { Menu } from '../../ui/Menu';
import { useToast } from '../../ui/Toast';
import { minutesLabel } from '../../ui/format';
import { SlideNotesButton } from '../notes/SlideNotesButton';
import { PictureContext, type PictureSlideContext } from '../pictures/context';
import { PictureCredits } from '../pictures/PictureCredits';
import { openPresenter } from '../present/sync';
import { SlideView } from '../slides/SlideView';
import { AskAboutThis } from './AskAboutThis';
import { AudienceMenu } from './AudienceMenu';
import { convertSlide } from './convert';
import { DeckDetailsDialog } from './DeckDetailsDialog';
import { useDraftFitNotice } from './fit-deck';
import { downloadBlob, exportJson, exportPptx, safeName } from './download';
import { Fields } from './Fields';
import { makeQuiz } from '../../core/deck/quiz-maker';
import { openShare, useLiveHost } from '../share/host';
import { KindPicker } from './KindPicker';
import { LookMenu } from './LookMenu';
import { NotesPanel } from './NotesPanel';
import { SlideRail } from './SlideRail';
import { AiMenu, ProposalBar, ProposalNotes, ProposalStage, useSlideRevision } from './SlideAi';
import { useDeckEditor } from './useDeckEditor';

export default function Studio() {
  const { deckId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { deck, change, undo, redo, canUndo, canRedo, save } = useDeckEditor(deckId);
  useDraftFitNotice(deck, change);
  const [selectedId, setSelectedId] = useState('');
  const [activeBind, setActiveBind] = useState<string | null>(null);
  const [step, setStep] = useState<number | undefined>(undefined);
  const [layout, setLayout] = useState<SlideLayout | null>(null);
  const [busy, setBusy] = useState('');
  const [details, setDetails] = useState(false);
  const [credits, setCredits] = useState(false);
  const context = useLiveQuery(async () => {
    if (!deck?.lessonId) return null;
    const lesson = await db.lessons.get(deck.lessonId);
    const course = lesson ? await db.courses.get(lesson.courseId) : undefined;
    return { lesson, course };
  }, [deck?.lessonId]);

  useEffect(() => {
    if (!deck || selectedId && deck.slides.some((s) => s.id === selectedId)) return;
    const wanted = params.get('slide');
    setSelectedId(deck.slides.find((s) => s.id === wanted)?.id ?? deck.slides[0]?.id ?? '');
  }, [deck, selectedId, params]);

  useEffect(() => { setStep(undefined); setActiveBind(null); }, [selectedId]);

  const index = deck ? Math.max(0, deck.slides.findIndex((s) => s.id === selectedId)) : 0;
  const slide = deck?.slides[index];
  const revision = useSlideRevision({ deck, slide, change });

  const updateSlide = useCallback((id: string, fn: (s: Slide) => Slide, key?: string) => {
    change((d) => ({ ...d, slides: d.slides.map((s) => (s.id === id ? fn(s) : s)) }), key);
  }, [change]);

  const insertSlide = (kind: string) => {
    const s = makeSlide(kind);
    change((d) => {
      const slides = [...d.slides];
      slides.splice(index + 1, 0, s);
      return { ...d, slides };
    });
    setSelectedId(s.id);
  };

  const duplicate = (id: string) => {
    const i = deck!.slides.findIndex((s) => s.id === id);
    const copy = cloneSlide(deck!.slides[i]);
    change((d) => {
      const slides = [...d.slides];
      slides.splice(i + 1, 0, copy);
      return { ...d, slides };
    });
    setSelectedId(copy.id);
  };

  const remove = (id: string) => {
    if (!deck || deck.slides.length < 2) return;
    const i = deck.slides.findIndex((s) => s.id === id);
    const next = deck.slides[i + 1] ?? deck.slides[i - 1];
    change((d) => ({ ...d, slides: d.slides.filter((s) => s.id !== id) }));
    if (next) setSelectedId(next.id);
    toast.show('Slide deleted', { action: { label: 'Undo', run: () => { undo(); setSelectedId(id); } } });
  };

  /** Moves the items that don't fit onto a new slide of the same kind, in one undo step. */
  const splitHere = () => {
    if (!deck || !slide) return;
    const pair = splitSlide(slide, { fits: (s) => fitsOnSlide(s, deck) });
    if (!pair) return;
    const id = slide.id;
    change((d) => splitInDeck(d, id, pair));
    toast.show('Split into two slides', { action: { label: 'Undo', run: () => { undo(); setSelectedId(id); } } });
  };

  /** Adds an answer from Ask to the end of the script. */
  const insertIntoNotes = (id: string, value: string) => {
    updateSlide(id, (s) => ({ ...s, notes: { ...s.notes, script: s.notes.script.trim() ? `${s.notes.script.trimEnd()}\n\n${value}` : value } }));
    toast.show('Added to the script', { action: { label: 'Undo', run: () => undo() } });
  };

  const move = (delta: number) => {
    if (!deck) return;
    const to = index + delta;
    if (to < 0 || to >= deck.slides.length) return;
    change((d) => {
      const slides = [...d.slides];
      const [s] = slides.splice(index, 1);
      slides.splice(to, 0, s);
      return { ...d, slides };
    });
  };

  // Keyboard: undo works everywhere; slide commands only outside text fields.
  const keyState = useRef({ deck, index, selectedId });
  keyState.current = { deck, index, selectedId };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (document.querySelector('dialog[open], .menu')) return;
      if ((e.target as HTMLElement | null)?.closest?.('.ask-pop')) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]');
      if (typing) { if (e.key === 'Escape') (e.target as HTMLElement).blur(); return; }
      const { deck: d, index: i, selectedId: id } = keyState.current;
      if (!d) return;
      if (e.key === 'Escape' && revision.proposal) { e.preventDefault(); revision.discard(); return; }
      if (e.key === 'F5' || (mod && e.key === 'Enter')) { e.preventDefault(); navigate(`/present/${d.id}${e.shiftKey ? `?from=${i}` : ''}`); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(id); return; }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(e.key === 'ArrowUp' ? -1 : 1); return; }
      if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); setSelectedId(d.slides[Math.max(0, i - 1)].id); return; }
      if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); setSelectedId(d.slides[Math.min(d.slides.length - 1, i + 1)].id); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const focusBind = useCallback((bind: string) => {
    // Selecting text on the slide is for Ask, not for jumping to its field.
    if (window.getSelection()?.toString().trim()) return;
    setActiveBind(bind);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-bind="${CSS.escape(bind)}"]`) ?? document.querySelector<HTMLElement>(`[data-bind="${CSS.escape(bind.split('.')[0])}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    });
  }, []);

  /** Appends multiple-choice questions built from the deck's own check questions and key terms. */
  const addQuiz = () => {
    if (!deck) return;
    const quiz = makeQuiz(deck);
    if (!quiz.length) {
      toast.show('Not enough to quiz on yet. Add a check question to a few slides’ key notes, or some key-term slides.', { tone: 'error', duration: 6000 });
      return;
    }
    change((d) => ({ ...d, slides: [...d.slides, ...quiz] }));
    setSelectedId(quiz[1]?.id ?? quiz[0]!.id);
    toast.show(`Added ${quiz.length - 1} quiz questions at the end`, { action: { label: 'Undo', run: () => undo() } });
  };

  const doExport = async (kind: string) => {
    if (!deck) return;
    setBusy(kind);
    try {
      if (kind === 'pptx' || kind === 'pptx-build') {
        const warnings = await exportPptx(deck, kind === 'pptx' ? 'animate' : 'build');
        toast.show(warnings.length ? `PowerPoint saved. ${warnings.length} item${warnings.length === 1 ? '' : 's'} could not be included.` : 'PowerPoint saved, with key notes as speaker notes');
      } else if (kind === 'json') {
        const { pictures, missing } = await exportJson(deck);
        const withPictures = pictures ? `, with ${pictures} picture${pictures === 1 ? '' : 's'}` : '';
        toast.show(missing
          ? `Deck file saved${withPictures}. ${missing} picture${missing === 1 ? ' was' : 's were'} no longer in this browser.`
          : `Deck file saved${withPictures}. Open it from Decks → Open a deck file.`, { duration: 5000 });
      } else if (kind === 'web') {
        const { deckHtml } = await import('../share/standalone');
        downloadBlob(new Blob([await deckHtml(deck)], { type: 'text/html;charset=utf-8' }), `${safeName(deck.title)}.html`);
        toast.show('Web page saved. It opens in any browser, even offline.');
      } else {
        const ex = exporters().find((x) => x.id === kind);
        if (ex) {
          const lesson = context?.lesson;
          const out = await ex.run(deck, {
            resolveImage: imageDataUrl,
            lesson: lesson && {
              title: lesson.title, summary: lesson.summary, week: lesson.week, date: lesson.date, time: lesson.time,
              durationMinutes: lesson.durationMinutes, courseTitle: context?.course?.title, courseSubject: context?.course?.subject,
            },
          });
          downloadBlob(out.data, out.fileName);
          toast.show(`${ex.label} saved`);
        }
      }
    } catch (e) {
      toast.show(`Export failed. ${(e as Error).message}`, { tone: 'error' });
    } finally {
      setBusy('');
    }
  };

  const minutes = deck ? deckMinutes(deck) : 0;
  const planned = context?.lesson?.durationMinutes;
  const def = slide ? getKind(slide.kind) : undefined;
  const flags = useMemo(() => ({}), []);

  // What the picture finder knows about this slide: words to search for, the frame's shape, and the deck's look.
  const pictureContext = useMemo<PictureSlideContext | null>(() => {
    if (!deck || !slide) return null;
    const kind = getKind(slide.kind);
    const heading = kind?.heading(slide.content) ?? '';
    return {
      kind: slide.kind,
      variant: slide.variant,
      // Kinds name themselves when they have no title ("Gallery"): search for the deck's subject instead.
      heading: heading && heading !== kind?.label ? heading : deck.title,
      text: kind?.text(slide.content) ?? [],
      deckTitle: deck.title,
      theme: getTheme(deck.themeId),
      audience: deck.audience,
      purpose: deckPurpose(deck),
    };
  }, [deck, slide]);

  /** Adds a credits slide at the end, or refreshes the deck's credits slide. */
  const creditsSlide = (lines: string[]) => {
    if (!deck) return;
    const existing = deck.slides.find((s) => s.kind === 'credits');
    if (existing) {
      updateSlide(existing.id, (s) => ({ ...s, content: { ...s.content, lines } }));
      setSelectedId(existing.id);
      return;
    }
    const made = makeSlide('credits', { lines }, { minutes: 0.5, script: '' });
    change((d) => ({ ...d, slides: [...d.slides, made] }));
    setSelectedId(made.id);
  };

  if (deck === undefined) return <div className="page-loading"><div className="spinner" /></div>;
  if (deck === null) return <NotFound message="This deck was deleted or never existed." />;
  const back = context?.lesson ? `/lessons/${context.lesson.id}` : '/decks';
  const shown = deck.slides.filter((s) => !s.hidden);
  const shownNumber = slide ? shown.indexOf(slide) + 1 : 0;
  const shownCount = shown.length;

  return (
    <div className="studio">
      <header className="studio-top">
        <Link to={back} className="icon-btn" aria-label={context?.lesson ? 'Back to lesson' : 'Back to decks'} title={context?.lesson ? `Back to ${context.lesson.title}` : 'Back to decks'}><ArrowLeft size={18} /></Link>
        <div className="studio-title">
          {context?.course && <span className="studio-crumb"><span className="dot" style={{ '--course': `var(--c-${context.course.color})` } as React.CSSProperties} /> {context.course.title} · Week {context.lesson?.week}</span>}
          <input
            className="input-bare"
            value={deck.title}
            onChange={(e) => change((d) => ({ ...d, title: e.target.value }), 'title')}
            aria-label="Deck title"
          />
        </div>
        <span className={`save-state ${save}`} aria-live="polite">{save === 'saving' ? 'Saving…' : save === 'error' ? 'Couldn’t save' : 'Saved'}</span>
        <div className="studio-tools">
          <button type="button" className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl Z)"><Undo2 size={17} /></button>
          <button type="button" className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl Shift Z)"><Redo2 size={17} /></button>
          <span className={`chip ${planned && minutes > planned ? 'chip-warn' : ''}`} title="Planned time from the key notes">
            {minutesLabel(minutes)}{planned ? ` of ${planned}` : ''}
          </span>
          <LookMenu deck={deck} change={change} />
          <AudienceMenu deck={deck} change={change} />
          {deckFields().length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetails(true)} title="Details that mods use, such as a lesson plan header"><ClipboardList size={15} /> Details</button>
          )}
          <ShareButton deckId={deck.id} />
          <Menu align="end" width={300} trigger={(p) => <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} {...p}>{busy ? <span className="spinner" /> : <Download size={15} />} Export</button>}>
            {(close) => (
              <>
                <button type="button" className="menu-item" onClick={() => { close(); doExport('pptx'); }}><PresentationIcon size={16} /><span>PowerPoint<span className="menu-detail">Reveals on click, key notes as speaker notes</span></span></button>
                <button type="button" className="menu-item" onClick={() => { close(); doExport('pptx-build'); }}><Copy size={16} /><span>PowerPoint, one slide per step<span className="menu-detail">For Google Slides and Keynote</span></span></button>
                <button type="button" className="menu-item" onClick={() => { close(); doExport('web'); }}><Globe size={16} /><span>Web page, view only<span className="menu-detail">One file that opens in any browser, offline. No notes</span></span></button>
                <button type="button" className="menu-item" onClick={() => { close(); navigate(`/print/${deck.id}`); }}><FileText size={16} /><span>Key notes handout<span className="menu-detail">Print or save as PDF</span></span></button>
                <button type="button" className="menu-item" onClick={() => { close(); doExport('json'); }}><FileJson size={16} /><span>Lectern deck file<span className="menu-detail">The whole deck with its pictures, to open again in Lectern</span></span></button>
                <button type="button" className="menu-item" onClick={() => { close(); setCredits(true); }}><Copyright size={16} /><span>Picture credits<span className="menu-detail">Where each picture came from. Copy them or add a credits slide</span></span></button>
                {exporters().map((x) => (
                  <button key={x.id} type="button" className="menu-item" onClick={() => { close(); doExport(x.id); }}><Shapes size={16} /><span>{x.label}<span className="menu-detail">{x.description}</span></span></button>
                ))}
              </>
            )}
          </Menu>
          <div className="split-btn">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate(`/present/${deck.id}?from=${index}`)} title="Present from this slide (Shift F5)"><MonitorPlay size={15} /> Present</button>
            <Menu align="end" width={280} trigger={(p) => <button type="button" className="btn btn-primary btn-sm split-caret" aria-label="More ways to present" {...p}><ChevronDown size={15} /></button>}>
              {(close) => (
                <>
                  <button type="button" className="menu-item" onClick={() => { close(); navigate(`/present/${deck.id}`); }}><MonitorPlay size={16} /><span>From the beginning<span className="menu-detail">F5</span></span></button>
                  <button type="button" className="menu-item" onClick={() => { close(); openPresenter(deck.id, navigate); }}><PresentationIcon size={16} /><span>Presenter view<span className="menu-detail">Audience window plus notes, next slide, timer</span></span></button>
                  <button type="button" className="menu-item" onClick={() => { close(); navigate(`/prompter/${deck.id}`); }}><ScrollText size={16} /><span>Teleprompter<span className="menu-detail">Your script, scrolling</span></span></button>
                  <button type="button" className="menu-item" onClick={() => { close(); openShare(deck.id); }}><QrIcon size={16} /><span>Share to phones<span className="menu-detail">Your phone as a remote, slides on theirs</span></span></button>
                  <button type="button" className="menu-item" onClick={() => { close(); addQuiz(); }}><Trophy size={16} /><span>Make a quiz<span className="menu-detail">Questions from your key notes and terms, added at the end</span></span></button>
                  <button type="button" className="menu-item" onClick={() => { close(); navigate(`/study/${deck.id}`); }}><BookOpen size={16} /><span>{wording(deckPurpose(deck)).studyName}<span className="menu-detail">{wording(deckPurpose(deck)).studyDetail}</span></span></button>
                </>
              )}
            </Menu>
          </div>
        </div>
      </header>

      <SlideRail
        deck={deck}
        selectedId={slide?.id ?? ''}
        onSelect={setSelectedId}
        onReorder={(slides) => change((d) => ({ ...d, slides }))}
        onDuplicate={duplicate}
        onDelete={remove}
        onToggleHidden={(id) => updateSlide(id, (s) => ({ ...s, hidden: !s.hidden }))}
        footer={
          <Menu width={340} trigger={(p) => <button type="button" className="btn btn-secondary add-slide" {...p}><Plus size={16} /> Add slide</button>}>
            {(close) => <KindPicker onPick={(k) => { close(); insertSlide(k); }} />}
          </Menu>
        }
      />

      <div className="studio-center">
        {slide && (
          <>
            <Stage>
              {revision.proposal ? (
                <ProposalStage revision={revision} slide={slide} deck={deck} number={shownNumber} count={shownCount} />
              ) : (
                <SlideView
                  slide={slide}
                  deck={deck}
                  number={shownNumber}
                  count={shownCount}
                  mode="edit"
                  step={step}
                  ghostLater
                  flags={flags}
                  onSelectBind={focusBind}
                  activeBind={activeBind}
                  onLayout={setLayout}
                  className="stage-slide"
                  label={`Slide ${index + 1} preview`}
                />
              )}
            </Stage>
            <div className="stage-bar">
              {revision.proposal ? <ProposalBar revision={revision} /> : (
                <>
                  {layout && layout.steps > 0 ? (
                    <div className="segmented" role="group" aria-label="Preview reveal step">
                      <button type="button" aria-pressed={step === undefined} onClick={() => setStep(undefined)}>All</button>
                      {Array.from({ length: layout.steps + 1 }, (_, k) => (
                        <button key={k} type="button" aria-pressed={step === k} onClick={() => setStep(k)}>{k === 0 ? 'Start' : `Click ${k}`}</button>
                      ))}
                    </div>
                  ) : <span className="faint" style={{ fontSize: 13 }}>Click any text on the slide to edit it. Select text to ask about it.</span>}
                  {layout?.warnings.length ? (
                    <StageWarning warnings={layout.warnings} canSplit={canSplit(slide)} onSplit={splitHere} />
                  ) : null}
                  <span className="stage-tools">
                    <AiMenu slide={slide} disabled={!def} onRun={revision.run} onSplit={splitHere} />
                  </span>
                </>
              )}
            </div>
            {revision.proposal?.status === 'ready' ? (
              <ProposalNotes revision={revision} slide={slide} purpose={deckPurpose(deck)} />
            ) : (
              <NotesPanel
                slide={slide}
                purpose={deckPurpose(deck)}
                onChange={(notes: KeyNotes, key) => updateSlide(slide.id, (s) => ({ ...s, notes }), key)}
                aside={<SlideNotesButton deckId={deck.id} slideId={slide.id} slideNumber={index + 1} lessonId={context?.lesson?.id} courseId={context?.course?.id} />}
              />
            )}
            <AskAboutThis deck={deck} slide={slide} disabled={Boolean(revision.proposal)} onInsert={(t) => insertIntoNotes(slide.id, t)} />
          </>
        )}
      </div>

      <aside className="inspector" aria-label="Slide content">
        {slide && (
          <>
            <div className="inspector-head">
              <Menu width={340} trigger={(p) => (
                <button type="button" className="kind-switch" {...p} title="Change slide type">
                  <span className="kind-icon"><KindIcon name={def?.icon ?? 'puzzle'} size={16} /></span>
                  <span><strong>{def?.label ?? slide.kind}</strong><span className="faint">Change type</span></span>
                  <ChevronDown size={15} />
                </button>
              )}>
                {(close) => <KindPicker current={slide.kind} onPick={(k) => { close(); updateSlide(slide.id, (s) => convertSlide(s, k)); }} />}
              </Menu>
            </div>
            {def?.variants && (
              <div className="field" style={{ marginBottom: 18 }}>
                <span className="field-label">Layout</span>
                <div className="segmented">
                  {def.variants.map((v) => (
                    <button key={v.id} type="button" aria-pressed={(slide.variant ?? def.variants![0].id) === v.id} onClick={() => updateSlide(slide.id, (s) => ({ ...s, variant: v.id }))}>{v.label}</button>
                  ))}
                </div>
              </div>
            )}
            {def ? (
              <PictureContext.Provider value={pictureContext}>
                <Fields
                  fields={def.fields}
                  content={slide.content}
                  onChange={(key, value) => updateSlide(slide.id, (s) => ({ ...s, content: { ...s.content, [key]: value } }), `${slide.id}:${key}`)}
                />
              </PictureContext.Provider>
            ) : (
              <p className="muted">This slide comes from a mod that isn’t installed. Its content is kept and shows again when the mod is on.</p>
            )}
            <div className="inspector-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => duplicate(slide.id)}><Copy size={14} /> Duplicate</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateSlide(slide.id, (s) => ({ ...s, hidden: !s.hidden }))}><EyeOff size={14} /> {slide.hidden ? 'Unhide' : 'Hide'}</button>
              <button type="button" className="btn btn-ghost btn-sm btn-danger" disabled={deck.slides.length < 2} onClick={() => remove(slide.id)}><Trash2 size={14} /> Delete</button>
            </div>
          </>
        )}
      </aside>
      <PictureCredits open={credits} deck={deck} onClose={() => setCredits(false)} onCreditsSlide={creditsSlide} />
      {deckFields().length > 0 && (
        <DeckDetailsDialog open={details} deck={deck} onClose={() => setDetails(false)} onSave={(extra) => change((d) => ({ ...d, extra }), 'details')} />
      )}
    </div>
  );
}

/** The stage's first warning, overflow first; when the slide is too full, a one-click Split. */
function StageWarning({ warnings, canSplit: splittable, onSplit }: { warnings: string[]; canSplit: boolean; onSplit(): void }) {
  const overflow = warnings.find(isOverflowWarning);
  return (
    <span className="stage-warning-group">
      <span className="stage-warning" role="status"><AlertTriangle size={14} /> {overflow ?? warnings[0]}</span>
      {overflow && splittable && (
        <button type="button" className="btn btn-secondary btn-sm stage-split" onClick={onSplit} title="Move what doesn’t fit onto a new slide of the same type">
          <Scissors size={14} /> Split
        </button>
      )}
    </span>
  );
}

/** Fits a 16:9 slide inside the available space. */
function Stage({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width: w, height: h } = e.contentRect;
      setWidth(Math.floor(Math.min(w, h * (16 / 9))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="stage" ref={ref}>
      <div className="stage-inner" style={{ width }}>{width > 0 && children}</div>
    </div>
  );
}

/** Opens the share window; shows that the deck is live while phones are connected. */
function ShareButton({ deckId }: { deckId: string }) {
  const live = useLiveHost();
  const on = live.status === 'live' && live.deckId === deckId;
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openShare(deckId)} title="Share to phones: your phone as a remote, slides on theirs">
      {on ? <span className="live-dot" aria-hidden /> : <QrIcon size={15} />} {on ? `Live · ${live.guests.length}` : 'Share'}
    </button>
  );
}
