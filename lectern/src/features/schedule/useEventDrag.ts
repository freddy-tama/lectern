// Drag to reschedule, with pointer events. Drop zones are plain elements:
//   data-drop="time"   a day column of the week grid (data-date, data-start-min, data-px-per-min)
//   data-drop="allday" the all-day cell of a day (data-date)
//   data-drop="day"    a month cell (data-date)
// Mouse and pen drag after a few pixels; touch drags after a short press, so scrolling still works.

import { useCallback, useEffect, useRef, useState } from 'react';
import { snapMinutes, DAY_MINUTES } from '../../core/schedule/calendar';
import type { CalEvent } from './model';

export interface DropTarget {
  date: string;
  /** Start in minutes, when dropped on the time grid. */
  minutes?: number;
  /** Dropped on the all-day row: the time is cleared. */
  allDay?: boolean;
}

export interface DragState {
  ev: CalEvent;
  target: DropTarget | null;
  x: number;
  y: number;
}

export interface DragApi {
  state: DragState | null;
  /** Spread onto the element that can be dragged. */
  bind(ev: CalEvent): { onPointerDown(e: React.PointerEvent<HTMLElement>): void };
  /** True once right after a drag, so the click that ends it does not open anything. */
  consumeClick(): boolean;
}

const HOLD_MS = 320;
const SLOP = 6;
const EDGE = 48;

function targetAt(x: number, y: number, grabY: number, duration: number): DropTarget | null {
  const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
  const date = zone?.dataset.date;
  if (!zone || !date) return null;
  if (zone.dataset.drop === 'allday') return { date, allDay: true };
  if (zone.dataset.drop === 'time') {
    const startMin = Number(zone.dataset.startMin) || 0;
    const pxPerMin = Number(zone.dataset.pxPerMin) || 1;
    const top = zone.getBoundingClientRect().top;
    const raw = startMin + (y - grabY - top) / pxPerMin;
    const minutes = Math.max(0, Math.min(DAY_MINUTES - Math.max(15, duration), snapMinutes(raw, 15)));
    return { date, minutes };
  }
  return { date };
}

export function useEventDrag(onDrop: (ev: CalEvent, target: DropTarget) => void): DragApi {
  const [state, setState] = useState<DragState | null>(null);
  const justDragged = useRef(false);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const bind = useCallback((ev: CalEvent) => ({
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      cleanupRef.current?.();
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const timed = el.dataset.dragTimed === 'true';
      // Keep the grabbed point under the pointer on the time grid; chips snap by their top.
      const grabY = timed ? e.clientY - rect.top : 8;
      const scroller = el.closest<HTMLElement>('[data-scroller]');
      const touch = e.pointerType === 'touch';
      const sx = e.clientX;
      const sy = e.clientY;
      let x = sx;
      let y = sy;
      let active = false;
      let frame = 0;
      let hold = 0;

      const update = () => setState({ ev, target: targetAt(x, y, grabY, ev.duration), x, y });
      const begin = () => {
        active = true;
        document.body.classList.add('is-dragging-event');
        update();
        frame = requestAnimationFrame(tick);
      };
      // Scrolls the grid while the pointer rests near its top or bottom edge.
      const tick = () => {
        if (!active) return;
        if (scroller) {
          const r = scroller.getBoundingClientRect();
          const dy = y < r.top + EDGE ? -1 : y > r.bottom - EDGE ? 1 : 0;
          const dx = x < r.left + EDGE ? -1 : x > r.right - EDGE ? 1 : 0;
          if (dy || dx) {
            scroller.scrollBy(dx * 10, dy * 10);
            update();
          }
        }
        frame = requestAnimationFrame(tick);
      };
      const finish = (commit: boolean) => {
        const target = active && commit ? targetAt(x, y, grabY, ev.duration) : null;
        const wasActive = active;
        cleanup();
        if (wasActive) {
          justDragged.current = true;
          window.setTimeout(() => { justDragged.current = false; }, 0);
        }
        setState(null);
        if (target) dropRef.current(ev, target);
      };
      const onMove = (pe: PointerEvent) => {
        x = pe.clientX;
        y = pe.clientY;
        if (!active) {
          if (Math.hypot(x - sx, y - sy) < SLOP) return;
          if (touch) { cleanup(); return; }
          begin();
          return;
        }
        update();
      };
      const onUp = () => finish(true);
      const onCancel = () => finish(false);
      const onKey = (ke: KeyboardEvent) => {
        if (ke.key === 'Escape' && active) { ke.preventDefault(); ke.stopPropagation(); finish(false); }
      };
      // Once a touch drag starts, keep the page from scrolling under the finger.
      const onTouchMove = (te: TouchEvent) => { if (active) te.preventDefault(); };
      const cleanup = () => {
        active = false;
        window.clearTimeout(hold);
        cancelAnimationFrame(frame);
        document.body.classList.remove('is-dragging-event');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('touchmove', onTouchMove);
        cleanupRef.current = null;
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      cleanupRef.current = cleanup;
      if (touch) hold = window.setTimeout(begin, HOLD_MS);
    },
  }), []);

  const consumeClick = useCallback(() => justDragged.current, []);
  return { state, bind, consumeClick };
}
