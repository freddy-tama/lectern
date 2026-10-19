import { useEffect, useRef, useState } from 'react';
import { resetMeasureCache } from '../core/engine/measure';

const FAMILIES = ['"Inter Variable"', '"Fraunces Variable"', '"Nunito Variable"'];
let fontsPromise: Promise<void> | null = null;

/** Loads the slide fonts once; text is measured with real metrics only after this. */
export function loadSlideFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  const loads = FAMILIES.flatMap((f) => [400, 600, 800].map((w) => document.fonts.load(`${w} 48px ${f}`)));
  loads.push(document.fonts.load('italic 500 48px "Fraunces Variable"'));
  fontsPromise = Promise.allSettled(loads).then(() => document.fonts.ready).then(() => resetMeasureCache());
  return fontsPromise;
}

/** Changes value once fonts are ready, so layouts recompute with real metrics. */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    loadSlideFonts().then(() => alive && setReady(true));
    return () => { alive = false; };
  }, []);
  return ready;
}

/** Width of an element, tracked with ResizeObserver. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Keyboard shortcuts that ignore keys typed into fields. */
export function useKeys(handler: (e: KeyboardEvent) => void, deps: unknown[] = []) {
  const saved = useRef(handler);
  saved.current = handler;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('dialog[open]') && !target?.closest('dialog')) return;
      saved.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
