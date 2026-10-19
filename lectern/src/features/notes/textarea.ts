// Small textarea helpers shared by the editor and the composers.

import type { KeyboardEvent } from 'react';
import { type RangeEdit, applyEdit, continueList } from './markdown';

/**
 * Applies an edit the way typing would, so Ctrl Z still works. Falls back to setting
 * the value when the browser refuses (onValue then receives the new text).
 */
export function replaceRange(ta: HTMLTextAreaElement, edit: RangeEdit, onValue: (value: string) => void) {
  ta.focus();
  ta.setSelectionRange(edit.from, edit.to);
  let ok = false;
  try {
    ok = edit.insert ? document.execCommand('insertText', false, edit.insert) : edit.from === edit.to || document.execCommand('delete');
  } catch {
    ok = false;
  }
  if (!ok) {
    const next = applyEdit(ta.value, edit);
    onValue(next.value);
    requestAnimationFrame(() => ta.setSelectionRange(next.cursor, next.cursor));
  }
}

/** Enter on a list line continues the list. Returns true when it handled the key. */
export function handleListEnter(e: KeyboardEvent<HTMLTextAreaElement>,onValue: (value: string) => void): boolean {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return false;
  const ta = e.currentTarget;
  if (ta.selectionStart !== ta.selectionEnd) return false;
  const edit = continueList(ta.value, ta.selectionStart);
  if (!edit) return false;
  e.preventDefault();
  replaceRange(ta, edit, onValue);
  return true;
}

/** Grows a textarea to fit its text. */
export function autoGrow(ta: HTMLTextAreaElement | null, max?: number) {
  if (!ta) return;
  ta.style.height = 'auto';
  const h = max ? Math.min(max, ta.scrollHeight) : ta.scrollHeight;
  ta.style.height = `${h + 2}px`;
  ta.style.overflowY = max && ta.scrollHeight > max ? 'auto' : 'hidden';
}
