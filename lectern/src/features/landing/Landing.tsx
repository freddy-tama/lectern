// The public front page at /welcome. Every slide on it is drawn live by the
// real slide engine from the app's sample decks, and every number is computed.

import '../../styles/landing.css';

import { Cloud, HardDrive, Monitor, Moon, Play, Sun, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { tryHref } from '../../app/try-samples';
import { THEMES } from '../../core/engine/themes';
import { installedPlugins } from '../../core/plugins/registry';
import { LogoMark } from '../../ui/Logo';
import { Brand } from './Brand';
import { Cta } from './Cta';
import { FromNotes } from './FromNotes';
import { Hero, TrySample } from './HeroStage';
import { KeyNotes } from './KeyNotes';
import { PhoneQuiz } from './PhoneQuiz';
import { SlideTypes } from './SlideTypes';
import { Tour } from './Tour';
import { Uses } from './Uses';
import { type ThemePref, usePrefersReducedMotion, useThemePref } from './hooks';
import { coreKinds, sampleData } from './samples';

export const NAV = [
  { id: 'tour', label: 'Watch' },
  { id: 'phone-quiz', label: 'Phone quiz' },
  { id: 'from-notes', label: 'From notes' },
  { id: 'key-notes', label: 'Key notes' },
  { id: 'uses', label: 'Uses' },
  { id: 'slide-types', label: 'Slide types' },
  { id: 'how-it-works', label: 'How it works' },
];

export const PAGE_TITLE = 'Lectern · Slides with your script built in';

const NEXT_PREF: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const PREF_LABEL: Record<ThemePref, string> = { system: 'Theme: match system', light: 'Theme: light', dark: 'Theme: dark' };

const BUILT_WITH = 'React 19, Vite, Dexie, pptxgenjs, PeerJS, Transformers.js (Whisper), qrcode-generator';

export default function Landing() {
  const reduced = usePrefersReducedMotion();
  const [pref, setPref] = useThemePref();
  const [scrolled, setScrolled] = useState(false);
  const kindCount = useMemo(() => coreKinds().length, []);
  const mods = installedPlugins();
  const deckCount = sampleData().decks.length;
  const testedBy = import.meta.env.VITE_TESTSPRITE_URL;

  useEffect(() => {
    const before = document.title;
    document.title = PAGE_TITLE;
    return () => { document.title = before; };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /** In-page links scroll smoothly and move focus to the section, for keyboard and screen reader users. */
  const go = (id: string): boolean => {
    const target = document.getElementById(id);
    if (!target) return false;
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
    history.replaceState(history.state, '', `#${id}`);
    return true;
  };
  const jump = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (go(id)) e.preventDefault();
  };

  const ThemeIcon = pref === 'light' ? Sun : pref === 'dark' ? Moon : Monitor;

  const PROOF = [
    { label: `${kindCount} slide types`, to: 'slide-types' },
    { label: `${THEMES.length} built-in looks`, to: 'looks' },
    { label: 'PowerPoint with editable charts', to: 'key-notes' },
    { label: 'One-file web page', to: 'key-notes' },
    { label: 'Phones join by QR', to: 'phone-quiz' },
    { label: 'No sign-up to start', to: 'how-it-works' },
  ];

  const WHERE = [
    {
      icon: HardDrive,
      title: 'On this device',
      items: [
        'Decks, notes, pictures and recordings, saved in this browser (IndexedDB).',
        `The slide engine and all ${kindCount} built-in slide types.`,
        'Speech-to-text.',
        'PowerPoint and web-page export.',
        'The phone quiz in a link.',
      ],
    },
    {
      icon: Cloud,
      title: 'Only when you use it',
      items: [
        "AI drafting, the deck assistant and AI pictures send your text to this site's server, which passes it to the AI provider (Anthropic for text; OpenAI or Google for pictures). They work only when the site has an AI key. Where the site has accounts, they ask you to sign in, and your AI credits and study progress are kept with your account.",
        'Picture search sends your search words to Openverse and Wikimedia Commons (and Pexels, when the site has a Pexels key) through this site.',
        'Transcription downloads its speech model from Hugging Face once; your audio stays on this device.',
        'Live sharing finds phones through a public signalling server, then connects them directly.',
      ],
    },
    {
      icon: Wrench,
      title: 'Not in this build',
      items: [
        'No cloud sync for decks: download a backup now and then.',
        mods.length
          ? `Mods are chosen when the app is built; this one has ${mods.map((m) => m.name).join(' and ')}.`
          : 'Mods are chosen when the app is built; this one has none.',
        'AI features say "AI isn\'t set up" when the server has no key.',
      ],
    },
  ];

  return (
    <div className="landing" id="top">
      <a className="lp-skip" href="#main" onClick={(e) => jump(e, 'main')}>Skip to content</a>

      {/* One nav: centred in the bar on wide screens, a row of chips under the bar on narrow ones. */}
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
              <ThemeIcon size={17} aria-hidden />
            </button>
            <Cta to="/" variant="dark" setup="ask" testId="nav-open-lectern" className="lp-nav-cta">Open Lectern</Cta>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <Hero onNotes={() => go('from-notes')} onWatch={(e) => jump(e, 'tour')} />

        <div className="proof">
          <div className="lp-container">
            <ul className="proof-list" aria-label="At a glance">
              {PROOF.map((p) => (
                <li key={p.label}><a href={`#${p.to}`} onClick={(e) => jump(e, p.to)}>{p.label}</a></li>
              ))}
            </ul>
          </div>
        </div>

        <Tour reduced={reduced} />
        <TrySample />
        <PhoneQuiz />
        <FromNotes />
        <KeyNotes reduced={reduced} />
        <Uses />
        <SlideTypes />
        <Brand />

        <section id="how-it-works" className="lp-section where" aria-labelledby="where-title" tabIndex={-1}>
          <div className="lp-container">
            <div className="lp-head">
              <p className="lp-eyebrow">How it works</p>
              <h2 id="where-title" className="lp-h2">What runs <em>where.</em></h2>
            </div>
            <div className="where-grid">
              {WHERE.map(({ icon: Icon, title, items }) => (
                <div key={title} className="where-col">
                  <h3><span className="where-icon"><Icon size={18} aria-hidden /></span> {title}</h3>
                  <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
                </div>
              ))}
            </div>
            <p className="where-built"><span>Built with</span> {BUILT_WITH}.</p>
          </div>
        </section>

        <section className="finale" aria-labelledby="finale-title">
          <div className="lp-container finale-inner">
            <LogoMark size={44} />
            <h2 id="finale-title" className="finale-title">Your next talk <em>starts here.</em></h2>
            <p className="finale-sub">{deckCount} sample decks come with Lectern. Present one now, or open Lectern and make your own.</p>
            <div className="hero-ctas">
              <Cta to={tryHref('talk', 'present')} variant="brand" size="lg" testId="finale-present"><Play size={18} aria-hidden /> Present the sample talk</Cta>
              <Cta to="/" variant="quiet" size="lg" setup="ask" testId="finale-open-lectern">Open Lectern</Cta>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <span className="lp-brand lp-brand-sm"><LogoMark size={22} /> <span>Lectern v{__APP_VERSION__}</span></span>
          <p>Your decks live in this browser's storage, which a browser can clear. Download a backup or export a .pptx to keep a copy.</p>
          {testedBy && <a className="lp-footer-link" href={testedBy} target="_blank" rel="noopener noreferrer">TestSprite test results for this site</a>}
          <Cta to="/" variant="link" setup="ask" className="lp-footer-open">Open Lectern</Cta>
        </div>
      </footer>
    </div>
  );
}
