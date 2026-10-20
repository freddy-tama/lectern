import { useLayoutEffect, useRef } from 'react';
import type { TextBox } from '../../core/engine/boxes';
import { type Theme, fontFamily } from '../../core/engine/themes';

export interface InlineKeys {
  /** Enter in a list item: add the next item. */
  onEnterItem?(): void;
  /** Backspace in an empty list item: remove it. */
  onRemoveItem?(): void;
  /** Tab: the next (or with Shift, the previous) text on the slide. */
  onTab?(back: boolean): void;
}

/**
 * Typing straight onto the slide. A textarea sits exactly over the text box it edits,
 * in the slide's own coordinates and type, while the slide redraws around it.
 */
export function InlineEditor({ box, theme, value, multiline, onInput, onDone, keys }: {
  box: TextBox; theme: Theme; value: string; multiline: boolean;
  onInput(value: string): void; onDone(): void; keys: InlineKeys;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const s = box.style;

  // Focus once, with the caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Grow with the text, and sit where the slide puts text in this box (top, middle or bottom).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    const h = Math.max(Math.ceil(s.size * (s.lineHeight ?? 1.3)), el.scrollHeight);
    el.style.height = `${h}px`;
    const room = Math.max(0, box.h - h);
    el.style.top = `${box.y + (s.valign === 'middle' ? room / 2 : s.valign === 'bottom' ? room : 0)}px`;
  }, [value, box, s.size, s.lineHeight, s.valign]);

  return (
    <textarea
      ref={ref}
      className="inline-edit"
      value={value}
      spellCheck
      aria-label="Edit text on the slide"
      style={{
        left: box.x,
        width: box.w,
        fontFamily: fontFamily(theme, s.font, 'web'),
        fontSize: s.size,
        fontWeight: s.weight,
        fontStyle: s.italic ? 'italic' : undefined,
        color: s.color,
        textAlign: s.align ?? 'left',
        lineHeight: s.lineHeight ?? 1.3,
        letterSpacing: s.tracking ? `${s.tracking}em` : undefined,
        textTransform: s.uppercase ? 'uppercase' : undefined,
      }}
      onChange={(e) => onInput(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); onDone(); return; }
        if (e.key === 'Tab' && keys.onTab) { e.preventDefault(); keys.onTab(e.shiftKey); return; }
        if (e.key === 'Enter' && !e.shiftKey) {
          if (keys.onEnterItem) { e.preventDefault(); keys.onEnterItem(); return; }
          if (!multiline || e.ctrlKey || e.metaKey) { e.preventDefault(); onDone(); return; }
        }
        if (e.key === 'Backspace' && !value && keys.onRemoveItem) { e.preventDefault(); keys.onRemoveItem(); }
      }}
    />
  );
}
