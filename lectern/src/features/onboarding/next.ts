// Where the setup screen sends someone afterwards. Kept apart from the page so the rules
// can be tested without rendering it.

import type { Focus } from '../../data/profile';

/**
 * The ?next= path, when it is safe to follow: a path on this site (one leading slash,
 * not two, no backslash tricks) that isn't the setup screen itself. Otherwise null.
 */
export function safeNext(raw: string | null): string | null {
  if (!raw || !/^\/(?![/\\])/.test(raw) || /^\/start(?:[/?#]|$)/.test(raw)) return null;
  return raw;
}

/** The page to open: the tile's own page, then a safe ?next= other than Home, then /make for decks-only people, then Home. */
export function resolveNext(focus: Focus, next: string | null, tileTo?: string): string {
  if (tileTo) return tileTo;
  const safe = safeNext(next);
  if (safe && safe !== '/') return safe;
  return focus === 'deck' ? '/make' : '/';
}

const PAGE_NAMES: [RegExp, string][] = [
  [/^\/decks(?:[/?#]|$)/, 'Decks'],
  [/^\/make(?:[/?#]|$)/, 'Make a deck'],
  [/^\/schedule(?:[/?#]|$)/, 'Schedule'],
  [/^\/notes(?:[/?#]|$)/, 'Notes'],
  [/^\/recordings(?:[/?#]|$)/, 'Recordings'],
  [/^\/settings(?:[/?#]|$)/, 'Preferences'],
  [/^\/mods(?:[/?#]|$)/, 'Mods'],
  [/^\/courses\//, 'the course'],
  [/^\/lessons\//, 'the lesson'],
  [/^\/(?:studio|present|presenter|prompter|study|print)\//, 'the deck'],
];

/** A short name for the page a ?next= path opens, for "Continue to …". */
export function pageName(path: string): string {
  return PAGE_NAMES.find(([re]) => re.test(path))?.[1] ?? 'your page';
}
