import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Anchor {
  rect: RectLike;
  /** Gets focus back when the popover closes. */
  el?: HTMLElement | null;
}

export type CloseReason = 'escape' | 'outside' | 'done';

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * A small non-modal panel next to an event or slot. On phones it becomes a
 * bottom sheet. Escape, a click outside or scrolling the page closes it.
 */
export function Popover({ anchor, onClose, label, children }: { anchor: Anchor; onClose(reason: CloseReason): void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const sheet = useMediaQuery('(max-width: 640px)');
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || sheet) return;
    const place = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const r = anchor.rect;
      const gap = 10;
      let left: number;
      let top = r.top;
      if (r.left + r.width + gap + w <= vw - 8) left = r.left + r.width + gap;
      else if (r.left - gap - w >= 8) left = r.left - gap - w;
      else {
        left = r.left + r.width / 2 - w / 2;
        top = r.top + r.height + gap;
        if (top + h > vh - 8) top = r.top - h - gap;
      }
      setPos({ left: clamp(left, 8, vw - w - 8), top: clamp(top, 8, Math.max(8, vh - h - 8)) });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor, sheet]);

  useEffect(() => {
    const el = ref.current;
    const target = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('button, a, input, select, textarea');
    target?.focus({ preventScroll: true });
    const returnTo = anchor.el;
    let reason: CloseReason = 'done';
    const close = (r: CloseReason) => { reason = r; closeRef.current(r); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      // Leave open while a dialog (for example "Make slides") is on top.
      if ((t as Element).closest?.('dialog[open], .menu, .toasts')) return;
      close('outside');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      close('escape');
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      if (reason !== 'outside' && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
    // Mounted once per anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  // Next to an event, scrolling would leave the panel behind, so it closes. A bottom sheet stays put.
  useEffect(() => {
    if (sheet) return;
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      closeRef.current('outside');
    };
    // Wait a frame so scrolls caused by opening (focus, auto-scroll) don't close it.
    const id = requestAnimationFrame(() => window.addEventListener('scroll', onScroll, true));
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [sheet, anchor]);

  return createPortal(
    <>
      {sheet && <div className="sched-pop-scrim" aria-hidden />}
      <div
        ref={ref}
        role="dialog"
        aria-label={label}
        className={`sched-pop ${sheet ? 'is-sheet' : ''}`}
        style={sheet ? undefined : { left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
