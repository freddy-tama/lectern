import {
  ArrowLeft, ArrowRight, AudioLines, BookOpen, CalendarDays, ChartColumn, Check, GraduationCap, House, Layers,
  LayoutGrid, Mic, NotebookPen, Presentation, Rocket, Sparkles, Users, Wand2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AUDIENCES, type Audience, type DeckPurpose, PURPOSES, type Slide, emptyNotes } from '../../core/deck/types';
import { allThemes } from '../../core/engine/themes';
import {
  DENSITIES, type Density, FEATURES, FOCUS_DEFAULTS, type Feature, type Focus, LENGTHS, type Profile,
  densityFor, getProfile, saveProfile,
} from '../../data/profile';
import { Logo } from '../../ui/Logo';
import { useToast } from '../../ui/Toast';
import { SlideView } from '../slides/SlideView';
import '../../styles/onboarding.css';

const FOCUS_OPTIONS: { id: Focus; icon: React.ReactNode; title: string; detail: string }[] = [
  { id: 'deck', icon: <Wand2 size={22} />, title: 'Make a presentation, fast', detail: 'Drop in your files and get a finished PowerPoint.' },
  { id: 'present', icon: <Mic size={22} />, title: 'Give talks, pitches or reports', detail: 'Write, rehearse and present with a teleprompter.' },
  { id: 'teach', icon: <GraduationCap size={22} />, title: 'Teach classes or courses', detail: 'Plan lessons by week, present, and quiz the room.' },
  { id: 'study', icon: <BookOpen size={22} />, title: 'Study and take notes', detail: 'Record lectures, get transcripts, and revise.' },
  { id: 'all', icon: <LayoutGrid size={22} />, title: 'A bit of everything', detail: 'Show me all of Lectern.' },
];

const PURPOSE_ICONS: Record<DeckPurpose, React.ReactNode> = {
  lesson: <GraduationCap size={20} />,
  talk: <Mic size={20} />,
  pitch: <Rocket size={20} />,
  report: <ChartColumn size={20} />,
};

const FEATURE_OPTIONS: { id: Feature; icon: React.ReactNode; title: string; detail: string }[] = [
  { id: 'courses', icon: <GraduationCap size={18} />, title: 'Courses and lessons', detail: 'Group decks by course and week.' },
  { id: 'schedule', icon: <CalendarDays size={18} />, title: 'Schedule', detail: 'A calendar for sessions, timetables and deadlines.' },
  { id: 'notes', icon: <NotebookPen size={18} />, title: 'Notes', detail: 'Jot ideas and to-dos, linked to decks.' },
  { id: 'recordings', icon: <AudioLines size={18} />, title: 'Recordings', detail: 'Record or upload audio and get a transcript.' },
];

const NAV_LABELS: Record<Feature, { label: string; icon: React.ReactNode }> = {
  courses: { label: 'Courses', icon: <GraduationCap size={13} /> },
  schedule: { label: 'Schedule', icon: <CalendarDays size={13} /> },
  notes: { label: 'Notes', icon: <NotebookPen size={13} /> },
  recordings: { label: 'Recordings', icon: <AudioLines size={13} /> },
};

const HOME_LEAD: Record<Focus, string> = {
  deck: 'Drop files, get a deck',
  present: 'Your next talk',
  teach: 'Up next: your lesson',
  study: 'Recordings and notes',
  all: 'Up next and this week',
};

type Step = 'focus' | 'purpose' | 'audience' | 'style' | 'features';
const STEPS: Step[] = ['focus', 'purpose', 'audience', 'style', 'features'];

interface Answers {
  focus: Focus | null;
  purpose: DeckPurpose;
  audience: Audience;
  density: Density;
  minutes: number;
  themeId: string;
  features: Feature[];
  askQuestions: boolean;
}

/** The sample slide in the preview shows how much goes on a slide at the chosen density. */
function sampleSlide(density: Density, purpose: DeckPurpose): Slide {
  const notes = emptyNotes();
  if (density === 'visual') {
    return { id: 'ob-visual', kind: 'image', content: { title: 'Where rain comes from', body: '', image: '/samples/water-cycle.svg', caption: '', whole: false }, notes };
  }
  const titles: Record<DeckPurpose, string> = { lesson: 'How the water cycle works', talk: 'Why small teams ship faster', pitch: 'The problem we solve', report: 'What we found this quarter' };
  const points: Record<DeckPurpose, string[]> = {
    lesson: ['The sun warms the water', 'Vapour rises and cools', 'Clouds form and rain falls', 'Water flows back to the sea', 'The cycle starts again'],
    talk: ['Fewer handoffs', 'Shorter feedback loops', 'Clear ownership', 'Less waiting for decisions', 'Ship, then learn'],
    pitch: ['Teams lose hours to slides', 'Most decks start from scratch', 'Speaker notes are an afterthought', 'Nothing is reused', 'Every deck looks different'],
    report: ['Sign-ups rose 18%', 'Churn fell to 3.1%', 'Support tickets halved', 'Two markets opened', 'Costs held flat'],
  };
  return { id: `ob-${density}`, kind: 'bullets', content: { title: titles[purpose], bullets: points[purpose].slice(0, density === 'detailed' ? 5 : 3), reveal: false, image: '' }, notes };
}

const THEME_SAMPLE: Slide = {
  id: 'ob-theme',
  kind: 'title',
  content: { eyebrow: 'Deck', title: 'Aa', subtitle: '', presenter: '', image: '' },
  notes: emptyNotes(),
};

export default function Onboarding() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  // Where to go afterwards: a link followed from the front page, or Home.
  const nextPath = /^\/(?!\/)/.test(params.get('next') ?? '') && !(params.get('next') ?? '').startsWith('/start') ? params.get('next')! : '/';
  const saved = useMemo(() => getProfile(), []);
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Answers>(() => ({
    focus: saved.onboarded && saved.completedAt ? saved.focus : null,
    purpose: saved.deck.purpose,
    audience: saved.deck.audience,
    density: saved.deck.density,
    minutes: saved.deck.minutes,
    themeId: saved.deck.themeId,
    features: saved.features,
    askQuestions: saved.askQuestions,
  }));
  const heading = useRef<HTMLHeadingElement>(null);
  const current = STEPS[step]!;

  // Move focus to the new question so keyboard and screen-reader users start at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => { document.title = 'Set up Lectern'; return () => { document.title = 'Lectern'; }; }, []);

  const pickFocus = (focus: Focus) => {
    const d = FOCUS_DEFAULTS[focus];
    setA((prev) => ({ ...prev, focus, purpose: d.purpose, audience: d.audience, minutes: d.minutes, density: densityFor(d.audience), features: [...d.features] }));
  };
  const pickAudience = (audience: Audience) => setA((prev) => ({ ...prev, audience, density: densityFor(audience) === 'visual' ? 'visual' : prev.density === 'visual' ? 'balanced' : prev.density }));
  const toggleFeature = (f: Feature) => setA((prev) => ({ ...prev, features: prev.features.includes(f) ? prev.features.filter((x) => x !== f) : FEATURES.filter((x) => x === f || prev.features.includes(x)) }));

  const finish = (skipped: boolean) => {
    const base = getProfile();
    const focus = a.focus ?? 'all';
    const next: Profile = skipped
      ? { ...base, onboarded: true }
      : {
          ...base,
          onboarded: true,
          completedAt: Date.now(),
          focus,
          features: a.features,
          askQuestions: a.askQuestions,
          deck: { purpose: a.purpose, audience: a.audience, density: a.density, minutes: a.minutes, themeId: a.themeId },
        };
    saveProfile(next);
    if (!skipped) toast.show('All set. Change these any time in Preferences.');
    navigate(!skipped && focus === 'deck' ? '/make' : nextPath, { replace: true });
  };

  const canContinue = current !== 'focus' || a.focus !== null;
  const next = () => {
    if (!canContinue) return;
    if (step < STEPS.length - 1) setStep(step + 1);
    else finish(false);
  };

  const people = a.purpose === 'lesson' ? 'learners' : 'the audience';
  const titles: Record<Step, { title: string; help: string }> = {
    focus: { title: 'What brings you to Lectern?', help: 'Your home page and sidebar are set up around your answer.' },
    purpose: { title: 'What do you make most often?', help: 'It sets the wording of speaker notes, handouts and AI drafts. Each deck can still be different.' },
    audience: { title: `Who are ${people === 'learners' ? 'your learners' : 'you usually presenting to'}?`, help: 'Younger audiences get bigger type, fewer words and more pictures.' },
    style: { title: 'How should your slides feel?', help: 'These become the starting point for every new deck.' },
    features: { title: 'What else do you want close at hand?', help: 'Turned-off parts leave the sidebar but keep working. Turn them back on in Preferences.' },
  };

  return (
    <div className="ob">
      <header className="ob-top">
        <Logo />
        <ol className="ob-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => <li key={s} className={i < step ? 'is-done' : i === step ? 'is-current' : ''} />)}
        </ol>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => finish(true)}>Skip for now</button>
      </header>

      <div className="ob-layout">
        <main className="ob-main" id="main">
          <form className="ob-step" key={current} onSubmit={(e) => { e.preventDefault(); next(); }}>
            <p className="eyebrow">Step {step + 1} of {STEPS.length}</p>
            <h1 className="display ob-title" ref={heading} tabIndex={-1}>{titles[current].title}</h1>
            <p className="muted ob-help">{titles[current].help}</p>

            {current === 'focus' && (
              <div className="ob-cards" role="radiogroup" aria-label="What brings you to Lectern">
                {FOCUS_OPTIONS.map((o) => (
                  <button key={o.id} type="button" role="radio" aria-checked={a.focus === o.id} className="ob-card" onClick={() => pickFocus(o.id)} onDoubleClick={() => { pickFocus(o.id); setStep(1); }}>
                    <span className="ob-card-icon">{o.icon}</span>
                    <span className="ob-card-text"><strong>{o.title}</strong><span>{o.detail}</span></span>
                    <span className="ob-check" aria-hidden><Check size={14} strokeWidth={3} /></span>
                  </button>
                ))}
              </div>
            )}

            {current === 'purpose' && (
              <div className="ob-cards ob-cards-2" role="radiogroup" aria-label="What you make most often">
                {PURPOSES.map((p) => (
                  <button key={p.id} type="button" role="radio" aria-checked={a.purpose === p.id} className="ob-card" onClick={() => setA({ ...a, purpose: p.id })}>
                    <span className="ob-card-icon">{PURPOSE_ICONS[p.id]}</span>
                    <span className="ob-card-text"><strong>{p.label}s</strong><span>{p.detail}</span></span>
                    <span className="ob-check" aria-hidden><Check size={14} strokeWidth={3} /></span>
                  </button>
                ))}
              </div>
            )}

            {current === 'audience' && (
              <div className="ob-cards" role="radiogroup" aria-label="Audience">
                {AUDIENCES.map((o) => (
                  <button key={o.id} type="button" role="radio" aria-checked={a.audience === o.id} className="ob-card" onClick={() => pickAudience(o.id)}>
                    <span className="ob-card-icon"><Users size={o.id === 'young' ? 16 : o.id === 'teen' ? 19 : 22} /></span>
                    <span className="ob-card-text"><strong>{o.label}</strong><span>{o.detail}</span></span>
                    <span className="ob-check" aria-hidden><Check size={14} strokeWidth={3} /></span>
                  </button>
                ))}
              </div>
            )}

            {current === 'style' && (
              <div className="ob-style">
                <fieldset className="ob-field">
                  <legend className="field-label">Words on a slide</legend>
                  <div className="ob-pills" role="radiogroup" aria-label="Words on a slide">
                    {DENSITIES.map((d) => (
                      <button key={d.id} type="button" role="radio" aria-checked={a.density === d.id} className="ob-pill" onClick={() => setA({ ...a, density: d.id })}>
                        <strong>{d.label}</strong><span>{d.detail}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="ob-field">
                  <legend className="field-label">Usual length</legend>
                  <div className="ob-chips" role="radiogroup" aria-label="Usual length">
                    {LENGTHS.map((m) => (
                      <button key={m} type="button" role="radio" aria-checked={a.minutes === m} className="ob-chip" onClick={() => setA({ ...a, minutes: m })}>{m} min</button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="ob-field">
                  <legend className="field-label">Look</legend>
                  <div className="theme-picker ob-themes" role="radiogroup" aria-label="Look">
                    {allThemes().map((t) => (
                      <button key={t.id} type="button" role="radio" aria-checked={a.themeId === t.id} className="theme-option" onClick={() => setA({ ...a, themeId: t.id })} title={t.description}>
                        <SlideView slide={THEME_SAMPLE} deck={{ themeId: t.id, audience: 'adult', title: '' }} framed />
                        <span>{t.name}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
            )}

            {current === 'features' && (
              <div className="ob-style">
                <div className="ob-toggles">
                  {FEATURE_OPTIONS.map((f) => (
                    <label key={f.id} className="ob-toggle switch">
                      <span className="ob-toggle-icon">{f.icon}</span>
                      <span className="ob-card-text"><strong>{f.title}</strong><span>{f.detail}</span></span>
                      <input type="checkbox" checked={a.features.includes(f.id)} onChange={() => toggleFeature(f.id)} />
                    </label>
                  ))}
                </div>
                <label className="ob-toggle ob-toggle-ai switch">
                  <span className="ob-toggle-icon"><Sparkles size={18} /></span>
                  <span className="ob-card-text"><strong>Let the AI ask before it drafts</strong><span>A few quick questions about your files make the deck fit better. You can skip them each time.</span></span>
                  <input type="checkbox" checked={a.askQuestions} onChange={(e) => setA({ ...a, askQuestions: e.target.checked })} />
                </label>
              </div>
            )}

            <div className="ob-actions">
              {step > 0 && (
                <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={16} /> Back</button>
              )}
              <button type="submit" className="btn btn-primary btn-lg" disabled={!canContinue}>
                {step === STEPS.length - 1 ? (a.focus === 'deck' ? <>Make my first deck <Wand2 size={17} /></> : <>{nextPath === '/' ? 'Go to Home' : 'Finish'} <ArrowRight size={17} /></>) : <>Continue <ArrowRight size={17} /></>}
              </button>
            </div>
          </form>
        </main>

        <aside className="ob-preview" aria-label="Preview of your Lectern">
          <p className="eyebrow">Your Lectern</p>
          <div className="ob-mock">
            <div className="ob-mock-nav">
              <span className="ob-mock-make"><Wand2 size={13} /> Make a deck</span>
              <span className="ob-mock-link is-on"><House size={13} /> Home</span>
              <span className="ob-mock-link"><Layers size={13} /> Decks</span>
              {FEATURES.filter((f) => a.features.includes(f)).map((f) => (
                <span key={f} className="ob-mock-link">{NAV_LABELS[f].icon} {NAV_LABELS[f].label}</span>
              ))}
            </div>
            <div className="ob-mock-home">
              <span className="ob-mock-lead">{HOME_LEAD[a.focus ?? 'all']}</span>
              {a.focus === 'deck' || a.focus === 'present' ? (
                <span className="ob-mock-drop"><Wand2 size={16} /> Drop files here</span>
              ) : (
                <span className="ob-mock-card"><Presentation size={16} /></span>
              )}
              <span className="ob-mock-row"><i /><i /><i /></span>
            </div>
          </div>
          <div className="ob-sample">
            <SlideView slide={sampleSlide(a.density, a.purpose)} deck={{ themeId: a.themeId, audience: a.audience, title: '' }} framed label="Sample slide in your style" />
          </div>
          <p className="ob-summary">
            {PURPOSES.find((p) => p.id === a.purpose)?.label}s · {AUDIENCES.find((x) => x.id === a.audience)?.label} · {a.minutes} min · {DENSITIES.find((d) => d.id === a.density)?.label}
          </p>
        </aside>
      </div>
    </div>
  );
}
