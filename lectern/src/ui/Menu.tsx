import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface MenuProps {
  /** Renders the trigger; spread the props onto a button. */
  trigger(props: { onClick(e: React.MouseEvent): void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }): ReactNode;
  children(close: () => void): ReactNode;
  align?: 'start' | 'end';
  width?: number;
}

/** A small popover menu, positioned under its trigger and kept inside the viewport. */
export function Menu({ trigger, children, align = 'start', width }: MenuProps) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const close = useCallback(() => {
    setAnchor(null);
    triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!anchor || !menuRef.current) return;
    const m = menuRef.current.getBoundingClientRect();
    let left = align === 'end' ? anchor.right - m.width : anchor.left;
    left = Math.max(8, Math.min(left, window.innerWidth - m.width - 8));
    let top = anchor.bottom + 6;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, anchor.top - m.height - 6);
    setPos({ top, left });
    menuRef.current.querySelector<HTMLElement>('button:not(:disabled), a')?.focus();
  }, [anchor, align]);

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) setAnchor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
        next?.focus();
        e.preventDefault();
      }
    };
    const onScroll = () => setAnchor(null);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [anchor, close]);

  return (
    <>
      {trigger({
        onClick: (e) => {
          // Measure now: React clears currentTarget once the event is done, before updaters run.
          const el = e.currentTarget as HTMLElement;
          const rect = el.getBoundingClientRect();
          triggerRef.current = el;
          setAnchor((a) => (a ? null : rect));
        },
        'aria-expanded': Boolean(anchor),
        'aria-haspopup': 'menu',
      })}
      {anchor && createPortal(
        <div ref={menuRef} className="menu" role="menu" style={{ top: pos.top, left: pos.left, width }}>
          {children(close)}
        </div>,
        document.body,
      )}
    </>
  );
}
