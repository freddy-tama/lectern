import { useEffect, useState } from 'react';

const WELCOMED_KEY = 'lectern.welcomed';
const THEME_KEY = 'lectern.theme';

/** Remembers that this visitor has seen the front page, so "/" opens the app next time. */
export function markWelcomed() {
  try { localStorage.setItem(WELCOMED_KEY, '1'); } catch { /* private mode */ }
}

export function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
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
    try { localStorage.setItem(THEME_KEY, pref); } catch { /* private mode */ }
  }, [pref]);
  return [pref, setPref];
}

/**
 * Fades sections in as they scroll into view. Content stays visible when
 * IntersectionObserver is missing or the visitor prefers less motion.
 */
export function useReveal(root: React.RefObject<HTMLElement | null>, reduced: boolean) {
  useEffect(() => {
    const el = root.current;
    if (!el || reduced || typeof IntersectionObserver === 'undefined') return;
    const targets = [...el.querySelectorAll<HTMLElement>('[data-reveal]')];
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -40px 0px', threshold: 0 });
    // Anything already on screen shows at once; the rest waits for the scroll.
    const fold = window.innerHeight;
    for (const t of targets) {
      if (t.getBoundingClientRect().top < fold * 0.92) t.classList.add('is-in');
      else io.observe(t);
    }
    el.classList.add('reveal-on');
    return () => {
      io.disconnect();
      el.classList.remove('reveal-on');
    };
  }, [root, reduced]);
}

/** True while the element is at least partly on screen. Used to pause motion off-screen. */
export function useOnScreen<T extends HTMLElement>(ref: React.RefObject<T | null>): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setOn(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}
