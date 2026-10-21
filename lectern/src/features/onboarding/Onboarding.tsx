import {
  ArrowLeft, ArrowRight, AudioLines, BookOpen, CalendarDays, ChartColumn, Check, FileUp, GraduationCap, House, Layers,
  Mic, NotebookPen, Play, Presentation, Rocket, Sparkles, Users, Wand2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { tryHref } from '../../app/try-samples';
import { AUDIENCES, type Audience, type DeckPurpose, PURPOSES, type Slide, emptyNotes } from '../../core/deck/types';
import { allThemes } from '../../core/engine/themes';
import {
  DENSITIES, type Density, FEATURES, FOCUS_DEFAULTS, type Feature, type Focus, LENGTHS, type Profile,
  densityFor, getProfile, saveProfile,
} from '../../data/profile';
import { buildSeed } from '../../data/seed';
import { Logo } from '../../ui/Logo';
import { useToast } from '../../ui/Toast';
import { markWelcomed } from '../landing/hooks';
import { SlideView } from '../slides/SlideView';
import { pageName, resolveNext, safeNext } from './next';
import '../../styles/onboarding.css';

interface Tile {
  testId: string;
  focus: Focus;
  to: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
}

/** The ways in. Each one sets up the app for that kind of work and opens a page that's ready to use. */
function tiles(sampleSlides: number): Tile[] {
  return [
    { testId: 'start-sample', focus: 'present', to: tryHref('talk', 'studio'), icon: <Play size={22} />, title: 'Open the sample talk', detail: `A finished ${sampleSlides}-slide talk with a script on every slide. Edit it, present it, share it.` },
    { testId: 'start-notes', focus: 'present', to: '/decks?new=notes', icon: <NotebookPen size={22} />, title: 'Start from my notes', detail: 'Paste an outline or rough notes. Slides and starter key notes in seconds, no AI needed.' },
    { testId: 'start-file', focus: 'deck', to: '/make', icon: <FileUp size={22} />, title: 'Turn a file into a deck', detail: 'PowerPoint, Word, PDF, Excel and more.' },
    { testId: 'start-course', focus: 'teach', to: '/try/course', icon: <GraduationCap size={22} />, title: 'Plan a course', detail: 'Weeks of lessons, each with its deck, notes and recordings.' },
    { testId: 'start-record', focus: 'study', to: '/recordings', icon: <Mic size={22} />, title: 'Record and review', detail: 'Record a talk or class and get a transcript made on this device.' },
  ];
}

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

interface Answers {
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

/** Arrow keys, Home and End move through a radio group and pick, as native radios do. */
function radioKeys(e: React.KeyboardEvent<HTMLElement>) {
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  const at = radios.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  const n = radios.length;
  const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (at + 1) % n
    : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (at - 1 + n) % n
    : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
  if (to < 0) return;
  e.preventDefault();
  radios[to].focus();
  radios[to].click();
}

/** One Tab stop per group: the picked option, or the first when none is. */
function rove<T>(options: readonly T[], value: T, at: number) {
  return options[at] === value || (at === 0 && !options.includes(value)) ? 0 : -1;
}

export default function Onboarding() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  // Where to go afterwards: a link followed from the front page, or Home.
  const next = safeNext(params.get('next'));
  const saved = useMemo(() => getProfile(), []);
  const [a, setA] = useState<Answers>(() => ({
    purpose: saved.deck.purpose,
    audience: saved.deck.audience,
    density: saved.deck.density,
    minutes: saved.deck.minutes,
    themeId: saved.deck.themeId,
    features: saved.features,
    askQuestions: saved.askQuestions,
  }));
  const heading = useRef<HTMLHeadingElement>(null);
  // The slide count comes from the sample itself, so the tile can't go out of date.
  const ways = useMemo(() => {
    const talk = buildSeed(new Date()).decks.find((d) => d.id === 'deck_meetings_talk');
    return tiles(talk?.slides.filter((s) => !s.hidden).length ?? 0);
  }, []);

  // Start keyboard and screen-reader users at the question.
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { document.title = 'Set up Lectern'; return () => { document.title = 'Lectern'; }; }, []);

  const pickAudience = (audience: Audience) => setA((prev) => ({ ...prev, audience, density: densityFor(audience) === 'visual' ? 'visual' : prev.density === 'visual' ? 'balanced' : prev.density }));
  const toggleFeature = (f: Feature) => setA((prev) => ({ ...prev, features: prev.features.includes(f) ? prev.features.filter((x) => x !== f) : FEATURES.filter((x) => x === f || prev.features.includes(x)) }));

  /** One click: the defaults for that kind of work, then straight to its page. */
  // Each way out of /start counts as having seen the front page, so landing on "/" opens the app, not /welcome.
  const choose = (focus: Focus, tileTo?: string) => {
    markWelcomed();
    const base = getProfile();
    const d = FOCUS_DEFAULTS[focus];
    saveProfile({
      ...base,
      onboarded: true,
      completedAt: Date.now(),
      focus,
      features: [...d.features],
      deck: { ...base.deck, purpose: d.purpose, audience: d.audience, minutes: d.minutes, density: densityFor(d.audience) },
    });
    navigate(resolveNext(focus, next, tileTo), { replace: true });
  };

  // Skipping keeps the defaults and leaves completedAt unset, so the app knows nothing was chosen.
  const skip = () => {
    markWelcomed();
    saveProfile({ ...getProfile(), onboarded: true });
    navigate(resolveNext('all', next), { replace: true });
  };

  const saveTuned = (e: React.FormEvent) => {
    e.preventDefault();
    markWelcomed();
    const base = getProfile();
    const focus = base.completedAt ? base.focus : 'all';
    const profile: Profile = {
      ...base,
      onboarded: true,
      completedAt: Date.now(),
      focus,
      features: a.features,
      askQuestions: a.askQuestions,
      deck: { purpose: a.purpose, audience: a.audience, density: a.density, minutes: a.minutes, themeId: a.themeId },
    };
    saveProfile(profile);
    toast.show('All set. Change these any time in Preferences.');
    navigate(resolveNext(focus, next), { replace: true });
  };

  return (
    <div className="ob">
      <header className="ob-top">
        <Logo />
        <Link to="/welcome" className="ob-back"><ArrowLeft size={15} /> Back to the tour</Link>
        <button type="button" className="btn btn-ghost btn-sm ob-skip" onClick={skip}>Skip for now</button>
      </header>

      <main className="ob-main" id="main">
        <h1 className="display ob-title" ref={heading} tabIndex={-1}>Where do you want to start?</h1>
        <p className="muted ob-help">One click and you’re in. Change anything later in Preferences.</p>

        <ul className="ob-tiles">
          {ways.map((t, i) => (
            <li key={t.testId} className={i === 0 ? 'ob-tile-first' : undefined}>
              <button type="button" className="ob-tile" data-testid={t.testId} onClick={() => choose(t.focus, t.to)}>
                <span className="ob-card-icon" aria-hidden>{t.icon}</span>
                <span className="ob-card-text"><strong>{t.title}</strong><span>{t.detail}</span></span>
                <ArrowRight size={18} className="ob-tile-go" aria-hidden />
              </button>
            </li>
          ))}
        </ul>

        <div className="ob-after">
          <button type="button" className="btn btn-ghost ob-look" data-testid="start-look-around" onClick={() => choose('all')}>Just look around</button>
          {next && next !== '/' && (
            <button type="button" className="btn btn-secondary" onClick={() => choose('all')}>Continue to {pageName(next)} <ArrowRight size={16} /></button>
          )}
        </div>

        <details className="ob-tune" open={params.get('tune') === '1'}>
          <summary>Fine-tune first (optional)</summary>
          <form className="ob-tune-body" onSubmit={saveTuned}>
            <div className="ob-style">
              <fieldset className="ob-field">
                <legend className="field-label">What you make most often</legend>
                <p className="faint ob-field-help">It sets the wording of key notes, handouts and AI drafts. Each deck can still be different.</p>
                <div className="ob-cards ob-cards-2" role="radiogroup" aria-label="What you make most often" onKeyDown={radioKeys}>
                  {PURPOSES.map((p, i) => (
                    <button key={p.id} type="button" role="radio" aria-checked={a.purpose === p.id} tabIndex={rove(PURPOSES.map((x) => x.id), a.purpose, i)} className="ob-card" onClick={() => setA({ ...a, purpose: p.id })}>
                      <span className="ob-card-icon">{PURPOSE_ICONS[p.id]}</span>
                      <span className="ob-card-text"><strong>{p.label}s</strong><span>{p.detail}</span></span>
                      <span className="ob-check" aria-hidden><Check size={14} strokeWidth={3} /></span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="ob-field">
                <legend className="field-label">Who you usually present to</legend>
                <p className="faint ob-field-help">Younger audiences get bigger type, fewer words and more pictures.</p>
                <div className="ob-cards" role="radiogroup" aria-label="Audience" onKeyDown={radioKeys}>
                  {AUDIENCES.map((o, i) => (
                    <button key={o.id} type="button" role="radio" aria-checked={a.audience === o.id} tabIndex={rove(AUDIENCES.map((x) => x.id), a.audience, i)} className="ob-card" onClick={() => pickAudience(o.id)}>
                      <span className="ob-card-icon"><Users size={o.id === 'young' ? 16 : o.id === 'teen' ? 19 : 22} /></span>
                      <span className="ob-card-text"><strong>{o.label}</strong><span>{o.detail}</span></span>
                      <span className="ob-check" aria-hidden><Check size={14} strokeWidth={3} /></span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="ob-field">
                <legend className="field-label">Words on a slide</legend>
                <div className="ob-pills" role="radiogroup" aria-label="Words on a slide" onKeyDown={radioKeys}>
                  {DENSITIES.map((d, i) => (
                    <button key={d.id} type="button" role="radio" aria-checked={a.density === d.id} tabIndex={rove(DENSITIES.map((x) => x.id), a.density, i)} className="ob-pill" onClick={() => setA({ ...a, density: d.id })}>
                      <strong>{d.label}</strong><span>{d.detail}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="ob-field">
                <legend className="field-label">Usual length</legend>
                <div className="ob-chips" role="radiogroup" aria-label="Usual length" onKeyDown={radioKeys}>
                  {LENGTHS.map((m, i) => (
                    <button key={m} type="button" role="radio" aria-checked={a.minutes === m} tabIndex={rove(LENGTHS, a.minutes, i)} className="ob-chip" onClick={() => setA({ ...a, minutes: m })}>{m} min</button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="ob-field">
                <legend className="field-label">Look</legend>
                <div className="theme-picker ob-themes" role="radiogroup" aria-label="Look" onKeyDown={radioKeys}>
                  {allThemes().map((t, i, all) => (
                    <button key={t.id} type="button" role="radio" aria-checked={a.themeId === t.id} tabIndex={rove(all.map((x) => x.id), a.themeId, i)} className="theme-option" onClick={() => setA({ ...a, themeId: t.id })} title={t.description}>
                      <SlideView slide={THEME_SAMPLE} deck={{ themeId: t.id, audience: 'adult', title: '' }} framed />
                      <span>{t.name}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="ob-field">
                <legend className="field-label">Close at hand</legend>
                <p className="faint ob-field-help">Turned-off parts leave the sidebar but keep working. Turn them back on in Preferences.</p>
                <div className="ob-toggles">
                  {FEATURE_OPTIONS.map((f) => (
                    <label key={f.id} className="ob-toggle switch">
                      <span className="ob-toggle-icon">{f.icon}</span>
                      <span className="ob-card-text"><strong>{f.title}</strong><span>{f.detail}</span></span>
                      <input type="checkbox" checked={a.features.includes(f.id)} onChange={() => toggleFeature(f.id)} />
                    </label>
                  ))}
                  <label className="ob-toggle ob-toggle-ai switch">
                    <span className="ob-toggle-icon"><Sparkles size={18} /></span>
                    <span className="ob-card-text"><strong>Let the AI ask before it drafts</strong><span>A few quick questions about your files make the deck fit better. You can skip them each time.</span></span>
                    <input type="checkbox" checked={a.askQuestions} onChange={(e) => setA({ ...a, askQuestions: e.target.checked })} />
                  </label>
                </div>
              </fieldset>

              <div className="ob-actions">
                <button type="submit" className="btn btn-primary btn-lg">Save and continue <ArrowRight size={17} /></button>
              </div>
            </div>

            <aside className="ob-preview" aria-label="Preview of your Lectern">
              <p className="eyebrow">Your Lectern</p>
              <div className="ob-mock" aria-hidden>
                <div className="ob-mock-nav">
                  <span className="ob-mock-make"><Wand2 size={13} /> Make a deck</span>
                  <span className="ob-mock-link is-on"><House size={13} /> Home</span>
                  <span className="ob-mock-link"><Layers size={13} /> Decks</span>
                  {FEATURES.filter((f) => a.features.includes(f)).map((f) => (
                    <span key={f} className="ob-mock-link">{NAV_LABELS[f].icon} {NAV_LABELS[f].label}</span>
                  ))}
                </div>
                <div className="ob-mock-home">
                  <span className="ob-mock-lead">{a.purpose === 'lesson' ? 'Up next: your lesson' : 'Your next talk'}</span>
                  <span className="ob-mock-card">{a.purpose === 'lesson' ? <BookOpen size={16} /> : <Presentation size={16} />}</span>
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
          </form>
        </details>
      </main>
    </div>
  );
}
