import { useEffect, useState } from 'react';

const WELCOMED_KEY = 'lectern.welcomed';
const THEME_KEY = 'lectern.theme';

/** The page colour behind each theme, for the browser's title bar. The same values as the app's Shell. */
const THEME_COLOR = { light: '#F7F6F3', dark: '#141413' } as const;

/** Remembers that this visitor has seen the front page, so "/" opens the app next time. */
export function markWelcomed() {
  try { localStorage.setItem(WELCOMED_KEY, '1'); } catch { /* private mode */ }
}

/** True while a media query matches, following changes. False where matchMedia is missing. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function usePrefersReducedMotion(): boolean {
  return useMedia('(prefers-reduced-motion: reduce)');
}

export type ThemePref = 'system' | 'light' | 'dark';

/** The same light/dark preference the app uses, so the two always match. */
export function useThemePref(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch { return 'system'; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      const own = meta.media.includes('dark') ? 'dark' : 'light';
      meta.content = THEME_COLOR[pref === 'system' ? own : pref];
    }
    try { localStorage.setItem(THEME_KEY, pref); } catch { /* private mode */ }
  }, [pref]);
  return [pref, setPref];
}

/**
 * Turns true the first time the element comes near the screen, and stays true, so
 * heavier parts (iframes, live slides) mount only when someone scrolls to them.
 * Browsers without IntersectionObserver get them at once.
 */
export function useSeen<T extends HTMLElement>(ref: React.RefObject<T | null>, margin = '200px'): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setSeen(true);
      io.disconnect();
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, seen]);
  return seen;
}
