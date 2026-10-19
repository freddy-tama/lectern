// The public front page at /welcome. Every slide on it is drawn live by the
// real slide engine from the app's sample decks.

import '../../styles/landing.css';

import { ArrowRight, FileDown, HardDrive, Monitor, Moon, Puzzle, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LogoMark } from '../../ui/Logo';
import { Brand } from './Brand';
import { Classroom } from './Classroom';
import { Cta } from './Cta';
import { Draft } from './Draft';
import { Hero } from './Hero';
import { KeyNotes } from './KeyNotes';
import { SlideTypes } from './SlideTypes';
import { type ThemePref, usePrefersReducedMotion, useReveal, useThemePref } from './hooks';

const NAV = [
  { id: 'slides', label: 'Slides' },
  { id: 'key-notes', label: 'Key notes' },
  { id: 'looks', label: 'Looks' },
  { id: 'classroom', label: 'Classroom' },
];

const BASICS = [
  { icon: HardDrive, title: 'Stays on your device', body: 'Courses, decks and notes are saved in your browser. No account, no upload.' },
  { icon: FileDown, title: 'Real PowerPoint files', body: 'Export a .pptx with editable charts, real tables and your key notes as speaker notes.' },
  { icon: Puzzle, title: 'Extend with mods', body: 'Optional mods add slide types, fields and exports for a subject or a team.' },
];

const NEXT_PREF: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const PREF_LABEL: Record<ThemePref, string> = { system: 'Theme: match system', light: 'Theme: light', dark: 'Theme: dark' };

export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const [pref, setPref] = useThemePref();
  const [scrolled, setScrolled] = useState(false);
  useReveal(root, reduced);

  useEffect(() => {
    const before = document.title;
    document.title = 'Lectern · Presentations and course planning';
    return () => { document.title = before; };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /** In-page links scroll smoothly and move focus to the section, for keyboard and screen reader users. */
  const jump = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
    history.replaceState(history.state, '', `#${id}`);
  };

  const ThemeIcon = pref === 'light' ? Sun : pref === 'dark' ? Moon : Monitor;

  return (
    <div ref={root} className="landing" id="top">
      <a className="lp-skip" href="#main" onClick={(e) => jump(e, 'main')}>Skip to content</a>

      <header className={`lp-nav ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="lp-container lp-nav-inner">
          <a className="lp-brand" href="#top" onClick={(e) => jump(e, 'top')} aria-label="Lectern, back to top">
            <LogoMark size={28} />
            <span>Lectern</span>
          </a>
          <nav className="lp-nav-links" aria-label="On this page">
            <ul>
              {NAV.map((n) => <li key={n.id}><a href={`#${n.id}`} onClick={(e) => jump(e, n.id)}>{n.label}</a></li>)}
            </ul>
          </nav>
          <div className="lp-nav-actions">
            <button type="button" className="lp-icon-btn" onClick={() => setPref(NEXT_PREF[pref])} aria-label={`${PREF_LABEL[pref]}. Change theme`} title={PREF_LABEL[pref]}>
              <ThemeIcon size={17} />
            </button>
            <Cta to="/" variant="dark">Open Lectern</Cta>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <Hero reduced={reduced} />

        <div className="purposes" data-reveal>
          <div className="lp-container">
            <p className="purposes-label">One tool for</p>
            <ul className="purposes-list">
              {['Conference talks', 'Investor pitches', 'Quarterly reports', 'Lessons', 'Workshops', 'Team updates'].map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        </div>

        <SlideTypes reduced={reduced} />
        <KeyNotes reduced={reduced} />
        <Brand />
        <Draft />
        <Classroom />

        <section className="lp-section basics" aria-labelledby="basics-title">
          <div className="lp-container">
            <h2 id="basics-title" className="visually-hidden">The basics</h2>
            <ul className="basics-grid" data-reveal>
              {BASICS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="basic">
                  <span className="basic-icon"><Icon size={20} aria-hidden /></span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="finale" aria-labelledby="finale-title">
          <div className="lp-container finale-inner" data-reveal>
            <LogoMark size={44} />
            <h2 id="finale-title" className="finale-title">Your next talk <em>starts here.</em></h2>
            <p className="finale-sub">Open the sample decks, or start one of your own in a minute.</p>
            <div className="hero-ctas">
              <Cta to="/decks" variant="brand" size="lg">Start a deck <ArrowRight size={18} aria-hidden /></Cta>
              <Cta to="/" variant="quiet" size="lg">Open Lectern</Cta>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <span className="lp-brand lp-brand-sm"><LogoMark size={22} /> <span>Lectern</span></span>
          <p>For people who present and teach.</p>
          <nav aria-label="Open the app">
            <ul>
              <li><Cta to="/" variant="link">Home</Cta></li>
              <li><Cta to="/decks" variant="link">Decks</Cta></li>
              <li><Cta to="/schedule" variant="link">Schedule</Cta></li>
              <li><Cta to="/notes" variant="link">Notes</Cta></li>
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
