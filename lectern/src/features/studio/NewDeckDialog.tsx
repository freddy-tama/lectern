import { ChartColumn, FilePlus2, FileText, GraduationCap, Mic, Rocket, Sparkles, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { blankDeck, draftToDeck } from '../../core/deck/draft';
import { outlineToDraft } from '../../core/deck/outline';
import { wording } from '../../core/deck/purpose';
import { AUDIENCES, type Audience, type DeckPurpose, PURPOSES, uid } from '../../core/deck/types';
import { allThemes } from '../../core/engine/themes';
import { OUTLINE_ACCEPT, fileToOutline } from '../../core/import/files';
import { getKind } from '../../core/kinds/registry';
import type { DeckDraft } from '../../core/plugins/api';
import { deckSources } from '../../core/plugins/registry';
import type { Course, Lesson } from '../../data/db';
import { addDeck } from '../../data/repo';
import { Dialog } from '../../ui/Dialog';
import { KindIcon } from '../../ui/KindIcon';
import { useToast } from '../../ui/Toast';
import { SlideView } from '../slides/SlideView';
import { type AiStatus, aiStatus, draftWithAI, saveCode, savedCode } from './ai';

type Mode = 'notes' | 'ai' | 'blank' | string;

const SAMPLE = `# Why the Moon Has Phases
Week 2 · Space science

## Today
- What we see from Earth
- Why the shape changes
- The full cycle in 29.5 days

## Key terms
Orbit: the path the Moon takes around Earth
Phase: the part of the lit half we can see

## How the cycle goes
1. New moon: the lit side faces away from us
2. First quarter: we see half of the lit side
3. Full moon: the lit side faces us
4. Last quarter: half again, on the other side

## The big idea
The Moon is always half lit by the Sun. As it orbits, we see different amounts of that lit half.
Notes: Use the lamp-and-ball model. Ask students to predict before you move the ball.

## Quick check
Q: Why do we see a full moon?
A) Earth's shadow is gone
B) The lit side faces Earth *
C) The Moon makes its own light
Answer: B. The Sun-lit half of the Moon faces us.

## Key takeaways
- Half the Moon is always lit
- Its orbit changes how much of that half we see
- One cycle takes about 29.5 days`;

const SAMPLE_TALK = `# Why small teams ship faster
A talk for product people

## Today
- Three short stories
- What they have in common
- What to try on Monday

## Key terms
Cycle time: how long an idea takes to reach a customer
Handoff: work passing from one person to another

## How a feature ships
1. Idea: a customer problem is named
2. Build: a small team makes the smallest useful version
3. Ship: it reaches customers within days
4. Learn: usage shows what to do next

## The big idea
Every handoff adds waiting. Fewer people in the chain means less time lost between steps.
Notes: Tell the story of the team that cut its release cycle from six weeks to four days.

## Quick check
Q: Where does your work wait the longest?
A) For a decision
B) For a review
C) For another team *
Answer: Most waiting hides in decisions and reviews, not in the work itself.

## Key takeaways
- Waiting costs more than working
- Fewer handoffs, faster learning
- Start by ending one handoff this month`;

const PURPOSE_ICONS: Record<DeckPurpose, React.ReactNode> = {
  lesson: <GraduationCap size={18} />,
  talk: <Mic size={18} />,
  pitch: <Rocket size={18} />,
  report: <ChartColumn size={18} />,
};

export function NewDeckDialog({ open, onClose, lesson, course }: { open: boolean; onClose(): void; lesson?: Lesson; course?: Course }) {
  const navigate = useNavigate();
  const toast = useToast();
  const sources = deckSources();
  const [mode, setMode] = useState<Mode>('notes');
  const [title, setTitle] = useState('');
  const [purpose, setPurposeState] = useState<DeckPurpose>(lesson ? 'lesson' : 'talk');
  const [audience, setAudience] = useState<Audience>(lesson ? 'teen' : 'adult');
  const [themeId, setThemeId] = useState('paper');
  const [notes, setNotes] = useState('');
  const [topic, setTopic] = useState('');
  const [material, setMaterial] = useState('');
  const [minutes, setMinutes] = useState(40);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [code, setCode] = useState(savedCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPurposeState(lesson ? 'lesson' : 'talk');
    setAudience(lesson ? 'teen' : 'adult');
    setTitle(lesson?.title ?? '');
    setTopic(lesson ? `${lesson.title}${lesson.summary ? `. ${lesson.summary}` : ''}` : '');
    setMinutes(lesson?.durationMinutes ?? 40);
    setError('');
    setBusy(false);
    aiStatus().then(setAi);
  }, [open, lesson]);

  const w = wording(purpose);
  const setPurpose = (p: DeckPurpose) => {
    setPurposeState(p);
    setAudience(p === 'lesson' ? 'teen' : 'adult');
  };

  const preview = useMemo(() => (notes.trim() ? outlineToDraft(notes, title || 'Untitled deck') : null), [notes, title]);

  const close = () => { abort.current?.abort(); onClose(); };

  const finish = async (draft: DeckDraft, source?: string) => {
    const deck = draftToDeck(
      { ...draft, title: title.trim() || draft.title },
      { audience, themeId, lessonId: lesson?.id, source, purpose },
    );
    const first = deck.slides[0];
    if (first?.kind === 'title' && course && lesson && !String(first.content.eyebrow ?? '')) {
      first.content = { ...first.content, eyebrow: `Week ${lesson.week} · ${course.title}` };
    }
    await addDeck(deck);
    onClose();
    navigate(`/studio/${deck.id}`);
    toast.show(`Made ${deck.slides.length} slides with key notes`);
  };

  const create = async () => {
    setError('');
    if (mode === 'blank') {
      const deck = blankDeck({ title: title.trim() || lesson?.title || 'Untitled deck', audience, themeId, purpose, lessonId: lesson?.id, eyebrow: lesson && course ? `Week ${lesson.week} · ${course.title}` : '' });
      deck.id = uid('d');
      await addDeck(deck);
      onClose();
      navigate(`/studio/${deck.id}`);
      return;
    }
    if (mode === 'notes') {
      if (!preview) { setError('Paste your notes or drop a file first.'); return; }
      await finish(preview);
      return;
    }
    if (mode === 'ai') {
      if (!topic.trim()) { setError(purpose === 'lesson' ? 'Describe what the lesson should teach.' : 'Describe what the deck is about.'); return; }
      setBusy(true);
      abort.current = new AbortController();
      try {
        const draft = await draftWithAI({ topic, audience, purpose, minutes, material, title }, abort.current.signal);
        await finish(draft, 'ai');
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }
  };

  const readFile = async (file: File) => {
    setError('');
    try {
      const text = await fileToOutline(file);
      setNotes(text);
      if (!title) setTitle(/^#\s+(.+)$/m.exec(text)?.[1] ?? file.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const source = sources.find((s) => s.id === mode);
  const tabs: { id: Mode; label: string; icon: React.ReactNode }[] = [
    { id: 'notes', label: 'From notes', icon: <FileText size={15} /> },
    { id: 'ai', label: 'With AI', icon: <Sparkles size={15} /> },
    { id: 'blank', label: 'Blank', icon: <FilePlus2 size={15} /> },
    ...sources.map((s) => ({ id: s.id, label: s.label, icon: <KindIcon name={s.icon} size={15} /> })),
  ];

  return (
    <Dialog
      open={open}
      onClose={close}
      wide
      title={lesson ? `Slides for “${lesson.title}”` : 'New deck'}
      description={w.newDeckDescription}
      footer={source ? undefined : (
        <>
          {error && <span role="alert" style={{ color: 'var(--danger)', fontSize: 13.5, marginRight: 'auto' }}>{error}</span>}
          <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy || (mode === 'ai' && ai?.available === false)}>
            {busy ? <><span className="spinner" /> Drafting slides…</> : mode === 'notes' && preview ? `Make ${preview.slides.length} slides` : mode === 'ai' ? 'Draft the deck' : 'Create deck'}
          </button>
        </>
      )}
    >
      <div className="new-deck">
        <div className="segmented" role="tablist" aria-label="How to start">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={mode === t.id} onClick={() => { setMode(t.id); setError(''); }}>{t.icon}{t.label}</button>
          ))}
        </div>

        {source ? (
          <source.Panel audience={audience} lessonTitle={lesson?.title} onCancel={close} onDraft={(d) => finish(d, source.plugin)} />
        ) : (
          <div className="new-deck-grid">
            <div className="new-deck-main">
              {mode === 'notes' && (
                <div
                  className={`dropzone ${dragging ? 'is-dragging' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) readFile(f); }}
                >
                  <label className="field">
                    <span className="field-label">Your notes or outline</span>
                    <textarea className="textarea mono-ish" rows={12} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={w.notesPlaceholder} />
                  </label>
                  <div className="dropzone-foot">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInput.current?.click()}><Upload size={14} /> Open a file</button>
                    <span className="faint">or drop Word, PowerPoint, Markdown or text here</span>
                    {!notes && <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setNotes(purpose === 'lesson' ? SAMPLE : SAMPLE_TALK)}>Try an example</button>}
                    <input ref={fileInput} type="file" accept={OUTLINE_ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }} />
                  </div>
                  {preview && (
                    <div className="outline-preview" aria-live="polite">
                      {preview.slides.map((s, i) => {
                        const def = getKind(s.kind);
                        return <span key={i} className="chip"><KindIcon name={def?.icon ?? 'square'} size={13} />{def?.label ?? s.kind}</span>;
                      })}
                    </div>
                  )}
                </div>
              )}
              {mode === 'ai' && (
                <div style={{ display: 'grid', gap: 14 }}>
                  {ai?.available === false && (
                    <div className="notice">
                      <strong>AI drafting isn’t set up on this server.</strong> Add an <code>ANTHROPIC_API_KEY</code> to the deployment’s environment, or start from your notes. “From notes” works offline.
                    </div>
                  )}
                  <label className="field">
                    <span className="field-label">{w.topicLabel}</span>
                    <textarea className="textarea" rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={w.topicPlaceholder} />
                  </label>
                  <label className="field">
                    <span className="field-label">Material to draw from <span className="faint" style={{ fontWeight: 400 }}>(optional)</span></span>
                    <textarea className="textarea" rows={5} value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Paste a reading, your own notes, data or a brief. Facts here are used as written." />
                  </label>
                  {ai?.needsCode && (
                    <label className="field" style={{ maxWidth: 280 }}>
                      <span className="field-label">Access code</span>
                      <input className="input" type="password" value={code} onChange={(e) => { setCode(e.target.value); saveCode(e.target.value); }} autoComplete="off" />
                      <span className="field-help">This server asks for a code before using AI. Ask whoever runs it.</span>
                    </label>
                  )}
                  <label className="field" style={{ maxWidth: 220 }}>
                    <span className="field-label">Session length</span>
                    <select className="select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                      {[10, 15, 20, 30, 40, 45, 50, 60, 75, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                    </select>
                  </label>
                </div>
              )}
              {mode === 'blank' && (
                <p className="muted">Starts with a title slide, one slide of points and a takeaways slide. Add more from the slide list in the editor.</p>
              )}
            </div>

            <div className="new-deck-side">
              <div className="field">
                <span className="field-label">What’s it for?</span>
                <div className="audience-list" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }} role="radiogroup" aria-label="What it’s for">
                  {PURPOSES.map((p) => (
                    <button key={p.id} type="button" role="radio" aria-checked={purpose === p.id} className="audience-option" style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => setPurpose(p.id)} title={p.detail}>
                      {PURPOSE_ICONS[p.id]}
                      <strong>{p.label}</strong>
                    </button>
                  ))}
                </div>
                <span className="field-help">{PURPOSES.find((p) => p.id === purpose)?.detail}</span>
              </div>
              <label className="field">
                <span className="field-label">Deck title</span>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={lesson?.title ?? 'Taken from your notes'} />
              </label>
              <div className="field">
                <span className="field-label">Audience</span>
                <div className="audience-list" role="radiogroup" aria-label="Audience">
                  {AUDIENCES.map((a) => (
                    <button key={a.id} type="button" role="radio" aria-checked={audience === a.id} className="audience-option" onClick={() => setAudience(a.id)}>
                      <strong>{a.label}</strong><span>{a.detail}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label">Look</span>
                <div className="theme-picker" role="radiogroup" aria-label="Look">
                  {allThemes().map((t) => (
                    <button key={t.id} type="button" role="radio" aria-checked={themeId === t.id} className="theme-option" onClick={() => setThemeId(t.id)} title={t.description}>
                      <SlideView
                        slide={THEME_SAMPLE}
                        deck={{ themeId: t.id, audience: 'adult', title: '' }}
                        framed
                      />
                      <span>{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

const THEME_SAMPLE = {
  id: 'theme-sample',
  kind: 'title',
  content: { eyebrow: 'Deck', title: 'Aa', subtitle: '', presenter: '', image: '' },
  notes: { script: '', keyPoints: [], cues: [], check: null, minutes: 1, links: [] },
};
