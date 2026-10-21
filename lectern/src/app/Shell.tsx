import { useLiveQuery } from 'dexie-react-hooks';
import { AudioLines, CalendarDays, House, Layers, Menu as MenuIcon, Monitor, Moon, NotebookPen, Plus, Puzzle, SlidersHorizontal, SquarePen, Sun, Upload, Wand2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { installedPlugins } from '../core/plugins/registry';
import { db } from '../data/db';
import { DECK_FILE_EXT } from '../data/deck-file';
import { getProfile, shows, useProfile } from '../data/profile';
import { createCourse } from '../data/repo';
import { dragHasFiles, handOffFiles } from '../features/autodeck/handoff';
import { useOpenDeckFile } from '../features/backup/actions';
import { BackupNudge } from '../features/backup/BackupNudge';
import { QuickCapture, openQuickCapture } from '../features/notes/QuickCapture';
import { RecordingsNavBadge } from '../features/recordings/NavBadge';
import { RecordingsGlobal } from '../features/recordings/RecorderDialog';
import { Logo } from '../ui/Logo';
import { useToast } from '../ui/Toast';

type ThemePref = 'system' | 'light' | 'dark';

/** The page colour behind each theme, for the browser's and the installed app's title bar. */
const THEME_COLOR = { light: '#F7F6F3', dark: '#141413' } as const;

function useThemePref(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(() => {
    try { return (localStorage.getItem('lectern.theme') as ThemePref) || 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      const own = meta.media.includes('dark') ? 'dark' : 'light';
      meta.content = THEME_COLOR[pref === 'system' ? own : pref];
    }
    try { localStorage.setItem('lectern.theme', pref); } catch { /* private mode */ }
  }, [pref]);
  return [pref, setPref];
}

export function Shell() {
  const courses = useLiveQuery(() => db.courses.orderBy('updatedAt').reverse().toArray(), []);
  const [open, setOpen] = useState(false);
  const [pref, setPref] = useThemePref();
  const [dropHint, setDropHint] = useState(false);
  const profile = useProfile();
  const location = useLocation();
  const navigate = useNavigate();
  const openDeck = useOpenDeckFile();
  const toast = useToast();
  const mods = installedPlugins();
  useEffect(() => setOpen(false), [location.pathname]);

  // First visit: show the front page, then the setup questions, before the app.
  useEffect(() => {
    let welcomed = true;
    try { welcomed = !!localStorage.getItem('lectern.welcomed'); } catch { /* private mode */ }
    if (location.pathname !== '/') return;
    if (!welcomed) navigate('/welcome', { replace: true });
    else if (!getProfile().onboarded) navigate('/start', { replace: true });
    // Only on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newCourse = async () => {
    const course = await createCourse({ title: 'New course' });
    navigate(`/courses/${course.id}?edit=1`);
  };

  const nextPref: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
  const ThemeIcon = pref === 'light' ? Sun : pref === 'dark' ? Moon : Monitor;
  const onMake = location.pathname === '/make';

  // Files dropped anywhere that nothing else takes become a new deck, instead of the
  // browser opening the file and leaving the app. Saved deck files open as they are.
  const onDragOver = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    const overZone = (e.target as HTMLElement).closest('.ad-page, .qm, .dropzone, .rc-page, .rc-lesson, dialog, [data-dropzone]');
    setDropHint(!overZone && !onMake);
  };
  const onDrop = (e: React.DragEvent) => {
    setDropHint(false);
    if (e.defaultPrevented || !dragHasFiles(e) || !e.dataTransfer.files.length) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const deckFiles = files.filter((f) => f.name.toLowerCase().endsWith(DECK_FILE_EXT));
    const others = files.filter((f) => !deckFiles.includes(f));
    if (others.length) {
      handOffFiles(others);
      if (!onMake) navigate('/make');
      return;
    }
    void (async () => {
      for (const file of deckFiles) {
        try { await openDeck(file); } catch (err) { toast.show((err as Error).message, { tone: 'error' }); }
      }
    })();
  };

  return (
    <div
      className={`shell ${open ? 'nav-open' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!e.relatedTarget) setDropHint(false); }}
      onDrop={onDrop}
    >
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => setOpen(true)} aria-label="Open navigation"><MenuIcon size={20} /></button>
        <Logo />
        <NavLink to="/make" className="icon-btn nt-topbar-new" aria-label="Make a deck" title="Make a deck"><Wand2 size={19} /></NavLink>
        {shows(profile, 'notes') && <button type="button" className="icon-btn" onClick={() => openQuickCapture()} aria-label="New note" title="New note (N)"><SquarePen size={19} /></button>}
      </header>
      <div className="nav-scrim" onClick={() => setOpen(false)} />
      <nav className="sidebar" aria-label="Main">
        <div className="sidebar-head">
          <Logo />
          <button type="button" className="icon-btn nav-close" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <NavLink to="/make" className="nav-make" title="Drop in files and get a finished deck">
          <Wand2 size={16} /> Make a deck
        </NavLink>
        {shows(profile, 'notes') && (
          <button type="button" className="nt-new-note" onClick={() => { setOpen(false); openQuickCapture(); }} title="Jot a note from anywhere (N)">
            <SquarePen size={16} /> New note <kbd>N</kbd>
          </button>
        )}
        <div className="nav-group">
          <NavLink to="/" end className="nav-link"><House size={17} /> Home</NavLink>
          <NavLink to="/decks" className="nav-link"><Layers size={17} /> Decks</NavLink>
          {shows(profile, 'schedule') && <NavLink to="/schedule" className="nav-link"><CalendarDays size={17} /> Schedule</NavLink>}
          {shows(profile, 'notes') && <NavLink to="/notes" className="nav-link"><NotebookPen size={17} /> Notes</NavLink>}
          {shows(profile, 'recordings') && <NavLink to="/recordings" className="nav-link"><AudioLines size={17} /> Recordings <RecordingsNavBadge /></NavLink>}
        </div>
        {shows(profile, 'courses') && (
          <>
            <div className="nav-section">
              <span className="eyebrow">Courses</span>
              <button type="button" className="icon-btn" onClick={newCourse} aria-label="New course" title="New course"><Plus size={16} /></button>
            </div>
            <div className="nav-group nav-courses">
              {courses?.map((c) => (
                <NavLink key={c.id} to={`/courses/${c.id}`} className="nav-link" style={{ '--course': `var(--c-${c.color})` } as React.CSSProperties}>
                  <span className="dot" />
                  <span className="nav-text">{c.title}</span>
                </NavLink>
              ))}
              {courses && !courses.length && (
                <button type="button" className="nav-link nav-empty" onClick={newCourse}><Plus size={16} /> Add your first course</button>
              )}
            </div>
          </>
        )}
        <div className="sidebar-foot">
          <NavLink to="/settings" className="nav-link"><SlidersHorizontal size={17} /> Preferences</NavLink>
          <NavLink to="/mods" className="nav-link">
            <Puzzle size={17} /> Mods
            {mods.length > 0 && <span className="nav-count">{mods.length}</span>}
          </NavLink>
          <button type="button" className="nav-link" onClick={() => setPref(nextPref[pref])} title="Change appearance">
            <ThemeIcon size={17} /> {pref === 'system' ? 'Match system' : pref === 'light' ? 'Light' : 'Dark'}
          </button>
        </div>
      </nav>
      <main className="main" id="main">
        <BackupNudge />
        <Outlet />
      </main>
      {dropHint && <div className="ad-drag-hint shell-drop-hint" aria-hidden><Upload size={18} /> Drop to make a deck from these files</div>}
      <QuickCapture />
      <RecordingsGlobal />
    </div>
  );
}
