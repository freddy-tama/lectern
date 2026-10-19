import { useLiveQuery } from 'dexie-react-hooks';
import { AudioLines, CalendarDays, House, Layers, Menu as MenuIcon, Monitor, Moon, NotebookPen, Plus, Puzzle, SquarePen, Sun, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { installedPlugins } from '../core/plugins/registry';
import { db } from '../data/db';
import { createCourse } from '../data/repo';
import { QuickCapture, openQuickCapture } from '../features/notes/QuickCapture';
import { RecordingsNavBadge } from '../features/recordings/NavBadge';
import { RecordingsGlobal } from '../features/recordings/RecorderDialog';
import { Logo } from '../ui/Logo';

type ThemePref = 'system' | 'light' | 'dark';

function useThemePref(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(() => {
    try { return (localStorage.getItem('lectern.theme') as ThemePref) || 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);
    try { localStorage.setItem('lectern.theme', pref); } catch { /* private mode */ }
  }, [pref]);
  return [pref, setPref];
}

export function Shell() {
  const courses = useLiveQuery(() => db.courses.orderBy('updatedAt').reverse().toArray(), []);
  const [open, setOpen] = useState(false);
  const [pref, setPref] = useThemePref();
  const location = useLocation();
  const navigate = useNavigate();
  const mods = installedPlugins();
  useEffect(() => setOpen(false), [location.pathname]);

  // First visit: show the front page before the app.
  useEffect(() => {
    let welcomed = true;
    try { welcomed = !!localStorage.getItem('lectern.welcomed'); } catch { /* private mode */ }
    if (!welcomed && location.pathname === '/') navigate('/welcome', { replace: true });
    // Only on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newCourse = async () => {
    const course = await createCourse({ title: 'New course' });
    navigate(`/courses/${course.id}?edit=1`);
  };

  const nextPref: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
  const ThemeIcon = pref === 'light' ? Sun : pref === 'dark' ? Moon : Monitor;

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => setOpen(true)} aria-label="Open navigation"><MenuIcon size={20} /></button>
        <Logo />
        <button type="button" className="icon-btn nt-topbar-new" onClick={() => openQuickCapture()} aria-label="New note" title="New note (N)"><SquarePen size={19} /></button>
      </header>
      <div className="nav-scrim" onClick={() => setOpen(false)} />
      <nav className="sidebar" aria-label="Main">
        <div className="sidebar-head">
          <Logo />
          <button type="button" className="icon-btn nav-close" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <button type="button" className="nt-new-note" onClick={() => { setOpen(false); openQuickCapture(); }} title="Jot a note from anywhere (N)">
          <SquarePen size={16} /> New note <kbd>N</kbd>
        </button>
        <div className="nav-group">
          <NavLink to="/" end className="nav-link"><House size={17} /> Home</NavLink>
          <NavLink to="/schedule" className="nav-link"><CalendarDays size={17} /> Schedule</NavLink>
          <NavLink to="/notes" className="nav-link"><NotebookPen size={17} /> Notes</NavLink>
          <NavLink to="/recordings" className="nav-link"><AudioLines size={17} /> Recordings <RecordingsNavBadge /></NavLink>
          <NavLink to="/decks" className="nav-link"><Layers size={17} /> Decks</NavLink>
        </div>
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
        <div className="sidebar-foot">
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
        <Outlet />
      </main>
      <QuickCapture />
      <RecordingsGlobal />
    </div>
  );
}
