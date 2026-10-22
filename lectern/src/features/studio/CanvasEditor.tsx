import { Check, ChevronDown, LayoutTemplate, Sparkles } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { BoxOverride, Slide } from '../../core/deck/types';
import { type Box, CANVAS_W, type SlideLayout } from '../../core/engine/boxes';
import type { AnyKind } from '../../core/kinds/types';
import { Menu } from '../../ui/Menu';
import { useWidth } from '../../ui/hooks';
import { type Guide, type Handle, type Rect, keepsShape, resizeRect, snapLines, snapMove, snapResize } from './canvas';

// Canvas editing in the studio: press and drag any box to move it, pull a handle to
// resize it, and use the small toolbar beside the selection. The layout engine still
// places everything; a move is stored as an override on the slide.

/** Screen px a press must travel before it counts as a drag rather than a click. */
const DRAG_START = 4;
/** Screen px within which an edge or centre snaps to a line. */
const SNAP = 8;

/**
 * Moving and resizing boxes by pointer. While a drag runs, onPreview gets the box's new place
 * (null when it ends); onCommit gets the final place once, for a single undo step.
 */
export function useBoxDrag(o: {
  layout: SlideLayout | null;
  /** The text scale a box has from earlier resizes (1 when none). */
  scaleOf(id: string): number;
  onPreview(id: string, place: BoxOverride | null): void;
  onCommit(box: Box, place: BoxOverride): void;
}) {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [active, setActive] = useState<'move' | 'resize' | null>(null);
  const dragged = useRef(false);
  const latest = useRef(o);
  latest.current = o;

  const begin = useCallback((e: React.PointerEvent, box: Box, handle: Handle | null = null) => {
    if (e.button !== 0) return;
    const stage = (e.currentTarget as HTMLElement).closest('.stage-inner');
    const width = stage?.getBoundingClientRect().width ?? 0;
    if (!width) return;
    if (handle) { e.preventDefault(); e.stopPropagation(); }
    const ratio = CANVAS_W / width;
    const boxes = latest.current.layout?.boxes ?? [];
    const skip = new Set(boxes.filter((b) => b.id === box.id || b.moveWith === box.id).map((b) => b.id));
    const lines = snapLines(boxes, skip);
    const start: Rect = { x: box.x, y: box.y, w: box.w, h: box.h };
    const scale0 = latest.current.scaleOf(box.id);
    const px = e.clientX;
    const py = e.clientY;
    let moved = false;
    let place: BoxOverride | null = null;
    let frame = 0;

    const move = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - px, ev.clientY - py) < DRAG_START) return;
        moved = true;
        window.getSelection()?.removeAllRanges();
        document.body.classList.add('is-dragging-box');
        setActive(handle ? 'resize' : 'move');
      }
      const dx = (ev.clientX - px) * ratio;
      const dy = (ev.clientY - py) * ratio;
      // Alt turns snapping off; Shift swaps keeping the shape on a corner.
      const within = ev.altKey ? 0 : SNAP * ratio;
      let snapped: { rect: Rect; guides: Guide[] };
      let scale = scale0;
      if (handle) {
        const keep = keepsShape(box, handle) !== ev.shiftKey;
        const rect = resizeRect(start, handle, dx, dy, keep);
        snapped = keep ? { rect, guides: [] } : snapResize(rect, handle, lines, within);
        if (box.type === 'text' && keep) scale = scale0 * (snapped.rect.w / start.w);
      } else {
        snapped = snapMove({ ...start, x: start.x + dx, y: start.y + dy }, lines, within);
      }
      place = { ...snapped.rect, scale };
      const next = place;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        latest.current.onPreview(box.id, next);
        setGuides(snapped.guides);
      });
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      cancelAnimationFrame(frame);
      document.body.classList.remove('is-dragging-box');
      setGuides([]);
      setActive(null);
      if (!moved || !place) return;
      // The click that ends a drag neither selects nor starts typing.
      dragged.current = true;
      window.setTimeout(() => { dragged.current = false; }, 0);
      latest.current.onPreview(box.id, null);
      latest.current.onCommit(box, place);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }, []);

  return { begin, guides, active, justDragged: () => dragged.current };
}

/**
 * Drawn over the slide in screen px: the selection's frame with its handles, snap guides
 * while dragging, and the toolbar beside the selection. Only the frame's edges, the handles
 * and the toolbar take the pointer, so clicks inside the frame still reach the slide.
 */
export function CanvasOverlay({ frame, handles, guides, busy, onMove, onResize, toolbar, label }: {
  /** The selection, in canvas px. */
  frame: Rect | null;
  handles: Handle[];
  guides: Guide[];
  /** A drag is running: hide the toolbar. */
  busy: boolean;
  onMove(e: React.PointerEvent): void;
  onResize(e: React.PointerEvent, handle: Handle): void;
  toolbar: React.ReactNode;
  /** Names the selection for screen readers. */
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const k = width / CANVAS_W;
  const pad = 6;
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const r = frame && width ? { left: frame.x * k - pad, top: frame.y * k - pad, width: frame.w * k + pad * 2, height: frame.h * k + pad * 2 } : null;
  return (
    <div className="canvas-overlay" ref={ref}>
      {width > 0 && guides.map((g, i) => (
        <div key={i} className={`canvas-guide is-${g.axis}`} style={g.axis === 'x' ? { left: g.at * k } : { top: g.at * k }} aria-hidden />
      ))}
      {r && (
        <div className={`canvas-frame${busy ? ' is-busy' : ''}`} style={r} role="group" aria-label={label}>
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <span key={side} className={`canvas-edge is-${side}`} onPointerDown={onMove} onMouseDown={keep} title="Drag to move" aria-hidden />
          ))}
          {handles.map((h) => (
            <span key={h} className={`canvas-handle is-${h}`} onPointerDown={(e) => onResize(e, h)} onMouseDown={keep} aria-hidden />
          ))}
        </div>
      )}
      {r && !busy && toolbar && <ToolbarSpot frame={r} width={width}>{toolbar}</ToolbarSpot>}
    </div>
  );
}

/** Puts the toolbar above the selection, or below it near the top of the slide, kept inside the stage. */
function ToolbarSpot({ frame, width, children }: { frame: { left: number; top: number; width: number; height: number }; width: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 40 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && (el.offsetWidth !== size.w || el.offsetHeight !== size.h)) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  });
  const gap = 8;
  const above = frame.top - size.h - gap;
  const top = above >= -18 ? above : frame.top + frame.height + gap;
  const left = Math.max(0, Math.min(width - size.w, frame.left + frame.width / 2 - size.w / 2));
  return (
    <div ref={ref} className="canvas-toolbar-spot" style={{ top, left, visibility: size.w ? 'visible' : 'hidden' }} onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input, textarea')) e.preventDefault(); }}>
      {children}
    </div>
  );
}

export interface ToolAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  run(): void;
  /** Show the words beside the icon, for the action people look for most. */
  wide?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  title?: string;
  danger?: boolean;
}

/** The small toolbar beside the selection. */
export function CanvasToolbar({ layouts, actions }: { layouts: React.ReactNode; actions: ToolAction[] }) {
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Selected item">
      {layouts}
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          className={`canvas-tool${a.wide ? ' is-wide' : ''}${a.danger ? ' is-danger' : ''}`}
          onClick={a.run}
          disabled={a.disabled}
          aria-pressed={a.pressed}
          aria-label={a.wide ? undefined : a.label}
          title={a.title ?? a.label}
        >
          {a.icon}{a.wide && <span>{a.label}</span>}
        </button>
      ))}
    </div>
  );
}

/** Picks the slide's layout: Auto (when auto style is on) or one of its type's layouts. */
export function LayoutMenu({ slide, def, autoStyle, onPick, compact }: {
  slide: Slide; def: AnyKind; autoStyle: boolean; onPick(variant: string | null): void; compact?: boolean;
}) {
  if (!def.variants?.length) return null;
  const current = slide.variant ?? def.variants[0]!.id;
  const auto = autoStyle && Boolean(def.autoVariant) && !slide.variantPinned;
  const name = def.variants.find((v) => v.id === current)?.label ?? 'Layout';
  return (
    <Menu width={240} trigger={(p) => (
      <button type="button" className={compact ? 'canvas-tool is-wide' : 'btn btn-ghost btn-sm'} title="Change the layout of this slide" {...p}>
        <LayoutTemplate size={15} /> <span>{compact ? 'Layout' : name}</span> <ChevronDown size={14} />
      </button>
    )}>
      {(close) => (
        <>
          {autoStyle && def.autoVariant && (
            <button type="button" className="menu-item" aria-pressed={auto} onClick={() => { close(); onPick(null); }}>
              <Sparkles size={16} /><span>Auto<span className="menu-detail">Picks the layout from what’s on the slide</span></span>{auto && <Check size={15} className="menu-check" />}
            </button>
          )}
          {def.variants!.map((v) => {
            const on = !auto && v.id === current;
            return (
              <button key={v.id} type="button" className="menu-item" aria-pressed={on} onClick={() => { close(); onPick(v.id); }}>
                <LayoutTemplate size={16} /><span>{v.label}{auto && v.id === current && <span className="menu-detail">Auto’s pick for now</span>}</span>{on && <Check size={15} className="menu-check" />}
              </button>
            );
          })}
        </>
      )}
    </Menu>
  );
}
